"""Conditioning + AV Latent Encoding Engine for MiniMax H3 with Raw Latent Continuity, Auto Spatial Alignment, and Auto Master Audio Slicing."""

from __future__ import annotations

import math
import logging
import torch

try:
    import torchaudio
except ImportError:
    torchaudio = None

import node_helpers
import comfy.nested_tensor
import comfy.utils
from comfy.ldm.minimax.model import FRAME_PER_TOKEN
from comfy_extras.nodes_minimax_h3 import (
    CANVAS_MULTIPLE,
    FPS,
    REF_IMAGE_SHORT_EDGE,
    MiniMaxH3ReferenceToVideo,
    _empty_av_latent,
    _resize,
    adapt_canvas,
)

from .h3_timing import (
    AUDIO_HZ,
    largest_h3_video_run,
    pixel_frames_to_latent_t,
    latent_t_to_pixel_frames,
)
from .h3_mask_compat import ensure_h3_mask_compat
from .h3_mask_payload_compat import ensure_av_mask_payload_compat
from .payload import AUDIO_END_KEY, FRAME_INDEX_KEY

_LOG = logging.getLogger("minimax_creator.encode")
_encode_ref_audio = MiniMaxH3ReferenceToVideo._encode_ref_audio

PREV_FRAME = "__prev__"
PREV_AUDIO = "__prev_audio__"
PREV_LATENT = "__prev_latent__"
MASTER_AUDIO = "__master_audio__"
SOURCE_VIDEO = "__source_video__"


def _require_mask_support():
    ensure_h3_mask_compat()
    ensure_av_mask_payload_compat()


def _frames_covered(steps: int) -> int:
    return sum(FRAME_PER_TOKEN[k % 5] for k in range(int(steps)))


def _streams_from_latent(latent_dict):
    samples = latent_dict["samples"]
    if hasattr(samples, "unbind"):
        parts = list(samples.unbind())
    elif isinstance(samples, (tuple, list)):
        parts = list(samples)
    else:
        raise ValueError(f"Expected joint H3 AV latent, got {type(samples)!r}")
    if len(parts) < 2:
        raise ValueError("H3 latent must contain both video and audio streams")
    video, audio = parts[0], parts[1]
    if video.ndim == 4:
        video = video.unsqueeze(0)
    if audio.ndim == 3:
        audio = audio.unsqueeze(0)
    if video.ndim != 5:
        raise ValueError(f"Video latent must be [B,C,T,H,W], got {tuple(video.shape)}")
    if audio.ndim != 4:
        raise ValueError(f"Audio latent must be [B,C,2,T], got {tuple(audio.shape)}")
    return video, audio


def _stereo_first_batch(waveform: torch.Tensor, label: str = "audio") -> torch.Tensor:
    if getattr(waveform, "ndim", 0) != 3:
        raise ValueError(f"{label} waveform must be [B,C,L], got {tuple(getattr(waveform, 'shape', ()))}")
    waveform = waveform[:1]
    channels = int(waveform.shape[1])
    if channels == 1:
        return waveform.repeat(1, 2, 1)
    if channels == 2:
        return waveform
    return waveform[:, :2]


def _resample_waveform(waveform: torch.Tensor, source_sr: int, target_sr: int, label: str = "audio") -> torch.Tensor:
    source_sr, target_sr = int(source_sr), int(target_sr)
    if source_sr == target_sr:
        return waveform
    if torchaudio is None:
        raise RuntimeError(f"{label} is {source_sr} Hz but requires {target_sr} Hz and torchaudio is unavailable")
    return torchaudio.functional.resample(waveform, source_sr, target_sr)


def _cfr_index_map(frame_count: int, source_fps: float, device, target_fps: float = FPS):
    source_fps = float(source_fps)
    n = int(frame_count)
    if n < 1:
        raise ValueError("Source video contains no frames")
    out_n = max(1, int(round(n * float(target_fps) / source_fps)))
    if out_n == n and abs(source_fps - target_fps) < 1e-6:
        return torch.arange(n, device=device, dtype=torch.long)
    i = torch.arange(out_n, device=device, dtype=torch.float64)
    t = (i + 0.5) / float(target_fps)
    src = torch.round(t * source_fps - 0.5).to(torch.long)
    return src.clamp_(0, n - 1)


def _resize_images(images: torch.Tensor, width: int, height: int, crop: str = "disabled", chunk: int = 32):
    if int(images.shape[0]) <= chunk:
        x = images[..., :3].movedim(-1, 1)
        x = comfy.utils.common_upscale(x, width, height, "lanczos", crop)
        return x.movedim(1, -1)
    out = []
    for start in range(0, int(images.shape[0]), chunk):
        part = images[start : start + chunk, ..., :3].movedim(-1, 1)
        part = comfy.utils.common_upscale(part, width, height, "lanczos", crop)
        out.append(part.movedim(1, -1))
    return torch.cat(out, dim=0)


def _match_latent_spatial_size(raw_v_slice: torch.Tensor, target_h: int, target_w: int) -> torch.Tensor:
    """Spatially aligns inherited raw latent slices to the target generation canvas."""
    target_lat_h = target_h // 16
    target_lat_w = target_w // 16

    if raw_v_slice.ndim == 4:
        raw_v_slice = raw_v_slice.unsqueeze(0)

    if raw_v_slice.shape[-2:] == (target_lat_h, target_lat_w):
        return raw_v_slice

    b, c, t, h, w = raw_v_slice.shape
    reshaped = raw_v_slice.movedim(2, 0).reshape(t * b, c, h, w)
    resized = torch.nn.functional.interpolate(
        reshaped.float(),
        size=(target_lat_h, target_lat_w),
        mode="bicubic",
        align_corners=False,
    ).to(raw_v_slice.dtype)

    return resized.reshape(t, b, c, target_lat_h, target_lat_w).movedim(0, 2)


def _context_keyframes_from_raw_latent(raw_latent_steps: torch.Tensor):
    steps = int(raw_latent_steps.shape[2])
    return [{
        "resolved_frame_index": 0,
        FRAME_INDEX_KEY: _frames_covered(k),
        "latent": raw_latent_steps[:, :, k:k + 1],
    } for k in range(steps)]


def _context_keyframes(vae, tail: torch.Tensor, feather: int):
    encoded = vae.encode(tail)
    if getattr(encoded, "ndim", 0) != 5:
        raise ValueError(
            f"Encoding inherited run returned shape {tuple(getattr(encoded, 'shape', ()))}, expected [B, C, T, H, W]"
        )
    steps = int(encoded.shape[2])
    return [{
        "resolved_frame_index": 0,
        FRAME_INDEX_KEY: _frames_covered(k),
        "latent": encoded[:, :, k:k + 1],
    } for k in range(steps)]


def _seam_audio(audio_vae, compiled, loaded):
    audio_latent, ref_audio_t = _encode_ref_audio(audio_vae, loaded[PREV_AUDIO]["audio"])
    seam = {"kind": "audio", "ref_audio_t": ref_audio_t, "audio_latent": audio_latent}
    if compiled.feather > 1:
        seam[AUDIO_END_KEY] = compiled.feather
    return seam


def prepare_master_song_latent(target_latent_dict, audio_vae, master_audio, clip_start_seconds: float = 0.0):
    """Injects exact master song slice into target audio stream and pins it with an AV noise mask for lip-sync diffusion."""
    _require_mask_support()
    target_v, target_a = _streams_from_latent(target_latent_dict)
    expected_audio_steps = int(target_a.shape[-1])

    vae_sr = int(getattr(audio_vae, "audio_sample_rate", 32000))
    waveform = _stereo_first_batch(master_audio["waveform"], "master_audio")
    waveform = _resample_waveform(waveform, int(master_audio["sample_rate"]), vae_sr, "master_audio")

    start_sample = max(0, int(round(float(clip_start_seconds) * vae_sr)))
    needed_samples = int(math.ceil(expected_audio_steps / AUDIO_HZ * vae_sr))
    end_sample = start_sample + needed_samples

    audio_slice = waveform[..., start_sample:end_sample]
    if int(audio_slice.shape[-1]) < needed_samples:
        audio_slice = torch.nn.functional.pad(audio_slice, (0, needed_samples - int(audio_slice.shape[-1])))

    audio_latent = audio_vae.encode(audio_slice.movedim(1, -1))
    if int(audio_latent.shape[-1]) > expected_audio_steps:
        audio_latent = audio_latent[..., :expected_audio_steps]
    elif int(audio_latent.shape[-1]) < expected_audio_steps:
        audio_latent = torch.nn.functional.pad(audio_latent, (0, expected_audio_steps - int(audio_latent.shape[-1])))

    out_video = target_v.clone()
    out_audio = target_a.clone()
    out_audio.copy_(audio_latent[:1].to(device=out_audio.device, dtype=out_audio.dtype))

    v_mask = torch.ones((out_video.shape[0], 1, out_video.shape[2], out_video.shape[3], out_video.shape[4]), 
                        device=out_video.device, dtype=out_video.dtype)
    a_mask = torch.zeros((out_audio.shape[0], 1, 2, out_audio.shape[-1]), 
                         device=out_audio.device, dtype=out_audio.dtype)

    out = target_latent_dict.copy()
    out["samples"] = comfy.nested_tensor.NestedTensor((out_video, out_audio))
    out["noise_mask"] = comfy.nested_tensor.NestedTensor((v_mask, a_mask))
    return out


def encode(clip, vae, audio_vae, compiled, loaded):
    """Dispatch conditioning & latent building using pristine raw keyframe tokens."""
    if compiled.mode == "REF2VA":
        cond, latent = _encode_references(clip, vae, audio_vae, compiled, loaded)
    else:
        cond, latent = _encode_frames(clip, vae, audio_vae, compiled, loaded)

    if getattr(compiled, "master_audio_track", False) and MASTER_AUDIO in loaded:
        clip_start = getattr(compiled, "clip_start_seconds", 0.0)
        latent = prepare_master_song_latent(latent, audio_vae, loaded[MASTER_AUDIO]["audio"], clip_start)

    return cond, latent


def _encode_frames(clip, vae, audio_vae, compiled, loaded):
    latent, frame_count = _empty_av_latent(compiled.width, compiled.height, compiled.frames)
    images = []
    keyframes = []

    if compiled.continues:
        if PREV_LATENT in loaded and loaded[PREV_LATENT].get("latent") is not None:
            prev_samples = loaded[PREV_LATENT]["latent"]["samples"]
            raw_v = prev_samples.unbind()[0] if hasattr(prev_samples, "unbind") else prev_samples[0]
            if raw_v.ndim == 4:
                raw_v = raw_v.unsqueeze(0)
            
            latent_t_count = pixel_frames_to_latent_t(compiled.feather if compiled.feather > 1 else 1)
            raw_v_slice = raw_v[:, :, -latent_t_count:].to(
                device=vae.device if hasattr(vae, "device") else "cuda", 
                dtype=torch.bfloat16
            )
            raw_v_slice = _match_latent_spatial_size(raw_v_slice, compiled.height, compiled.width)
            keyframes.extend(_context_keyframes_from_raw_latent(raw_v_slice))

        elif PREV_FRAME in loaded:
            tail = _resize(loaded[PREV_FRAME]["image"], compiled.width, compiled.height, "center")
            images.append(tail[-1:])
            feather_count = compiled.feather if compiled.feather > 1 else 1
            keyframes.extend(_context_keyframes(vae, tail[-feather_count:], feather_count))
        elif SOURCE_VIDEO in loaded:
            src_frames = loaded[SOURCE_VIDEO]["frames"]
            src_fps = getattr(compiled, "source_fps", 24.0)
            idx = _cfr_index_map(int(src_frames.shape[0]), float(src_fps), src_frames.device, FPS)
            feather_count = min(int(idx.numel()), compiled.feather if compiled.feather > 1 else 1)
            tail_frames = src_frames.index_select(0, idx[-feather_count:])
            tail_resized = _resize_images(tail_frames, compiled.width, compiled.height, "center")
            images.append(tail_resized[-1:])
            keyframes.extend(_context_keyframes(vae, tail_resized, feather_count))
    elif compiled.first_frame is not None and compiled.first_frame.handle in loaded:
        image = _resize(loaded[compiled.first_frame.handle]["image"], compiled.width, compiled.height, "disabled")
        images.append(image)
        keyframes.append({"resolved_frame_index": 0, "image": image})

    if compiled.last_frame is not None and compiled.last_frame.handle in loaded:
        crop = "center" if (compiled.first_frame is not None or compiled.continues) else "disabled"
        image = _resize(loaded[compiled.last_frame.handle]["image"], compiled.width, compiled.height, crop)
        images.append(image)
        keyframes.append({"resolved_frame_index": frame_count - 1, "image": image})

    if compiled.continues_audio and compiled.feather == 1 and PREV_AUDIO in loaded:
        items = [{"type": "image", "data": img} for img in images]
        items.append({"type": "audio"})
        tokens = clip.tokenize(compiled.prompt, minimax_ref_items=items)
    else:
        tokens = clip.tokenize(compiled.prompt, images=images)

    cond = clip.encode_from_tokens_scheduled(tokens)

    if keyframes:
        for kf in keyframes:
            if "image" in kf:
                kf["latent"] = vae.encode(kf.pop("image"))
        cond = node_helpers.conditioning_set_values(cond, {
            "minimax_keyframes": keyframes,
            "minimax_frame_count": frame_count,
        })

    if compiled.continues_audio and PREV_AUDIO in loaded:
        cond = node_helpers.conditioning_set_values(cond, {"minimax_refs": [_seam_audio(audio_vae, compiled, loaded)]})

    return cond, latent


def _snap(value):
    return max(CANVAS_MULTIPLE, round(value / CANVAS_MULTIPLE) * CANVAS_MULTIPLE)


def video_canvas(source_w, source_h, gen_w, gen_h, ref_size):
    width, height = adapt_canvas(source_w, source_h)
    if source_w * source_h < width * height:
        width, height = _snap(source_w), _snap(source_h)
    if ref_size == "match":
        scale = min(1.0, math.sqrt((gen_w * gen_h) / (width * height)))
        width, height = _snap(width * scale), _snap(height * scale)
    return width, height


def _encode_references(clip, vae, audio_vae, compiled, loaded):
    latent, frame_count = _empty_av_latent(compiled.width, compiled.height, compiled.frames)
    items = []
    blocks = []
    pending_soundtrack = None

    for step in compiled.plan:
        asset = step["asset"]
        if asset.handle not in loaded:
            continue
        entry = loaded[asset.handle]

        if step["op"] == "image":
            image = entry["image"]
            height, width = image.shape[1], image.shape[2]
            scale = min(1.0, math.sqrt((compiled.width * compiled.height) / (width * height))) if asset.ref_size == "match" else min(1.0, REF_IMAGE_SHORT_EDGE / min(width, height))
            target_w, target_h = _snap(width * scale), _snap(height * scale)
            resized = _resize(image, target_w, target_h, "disabled")
            items.append({"type": "image", "data": resized})
            blocks.append({
                "kind": "image",
                "latent_h": target_h // 16,
                "latent_w": target_w // 16,
                "latent": vae.encode(resized),
            })
        elif step["op"] == "soundtrack":
            pending_soundtrack = _encode_ref_audio(audio_vae, entry["audio"])
            items.append({"type": "audio"})
        elif step["op"] == "video":
            frames = entry["frames"]
            source_h, source_w = frames.shape[1], frames.shape[2]
            canvas_w, canvas_h = video_canvas(source_h, source_w, compiled.width, compiled.height, asset.ref_size)
            frames = _resize(frames, canvas_w, canvas_h, "disabled")
            if frames.shape[0] > frame_count:
                frames = frames[:frame_count]
            count = frames.shape[0]
            if count < 5:
                raise ValueError(f"@{asset.handle}: Reference videos need at least 5 frames, got {count}")
            while count % 17 != 5:
                count -= 1
            frames = frames[:count]

            audio_latent, ref_audio_t = pending_soundtrack or (None, 0)
            pending_soundtrack = None
            sampled = list(range(0, frames.shape[0], int(FPS) // 2))
            items.append({
                "type": "video",
                "data": frames[sampled],
                "timestamps": [i / 2.0 for i in range(len(sampled))],
            })
            encoded = vae.encode(frames)
            blocks.append({
                "kind": "video_audio" if ref_audio_t else "video",
                "latent_t": encoded.shape[2],
                "latent_h": canvas_h // 16,
                "latent_w": canvas_w // 16,
                "ref_audio_t": ref_audio_t,
                "latent": encoded,
                "audio_latent": audio_latent,
            })
        elif step["op"] == "audio":
            audio_latent, ref_audio_t = _encode_ref_audio(audio_vae, entry["audio"])
            items.append({"type": "audio"})
            blocks.append({"kind": "audio", "ref_audio_t": ref_audio_t, "audio_latent": audio_latent})

    if compiled.continues_audio and PREV_AUDIO in loaded:
        blocks.append(_seam_audio(audio_vae, compiled, loaded))

    tokens = clip.tokenize(compiled.prompt, minimax_ref_items=items)
    cond = clip.encode_from_tokens_scheduled(tokens)
    if blocks:
        cond = node_helpers.conditioning_set_values(cond, {"minimax_refs": blocks})

    if compiled.continues:
        if PREV_LATENT in loaded and loaded[PREV_LATENT].get("latent") is not None:
            prev_samples = loaded[PREV_LATENT]["latent"]["samples"]
            raw_v = prev_samples.unbind()[0] if hasattr(prev_samples, "unbind") else prev_samples[0]
            if raw_v.ndim == 4:
                raw_v = raw_v.unsqueeze(0)
            
            latent_t_count = pixel_frames_to_latent_t(compiled.feather if compiled.feather > 1 else 1)
            raw_v_slice = raw_v[:, :, -latent_t_count:].to(
                device=vae.device if hasattr(vae, "device") else "cuda", 
                dtype=torch.bfloat16
            )
            raw_v_slice = _match_latent_spatial_size(raw_v_slice, compiled.height, compiled.width)
            cond = node_helpers.conditioning_set_values(cond, {
                "minimax_keyframes": _context_keyframes_from_raw_latent(raw_v_slice),
                "minimax_frame_count": frame_count,
            })
        elif PREV_FRAME in loaded:
            tail = _resize(loaded[PREV_FRAME]["image"], compiled.width, compiled.height, "center")
            feather_count = compiled.feather if compiled.feather > 1 else 1
            keyframes = _context_keyframes(vae, tail[-feather_count:], feather_count)
            cond = node_helpers.conditioning_set_values(cond, {
                "minimax_keyframes": keyframes,
                "minimax_frame_count": frame_count,
            })

    return cond, latent