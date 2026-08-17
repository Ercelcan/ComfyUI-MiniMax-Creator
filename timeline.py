"""MiniMax H3 Timeline: Multi-shot sequence execution, Photometric seam matching, and audio assembly."""

from __future__ import annotations

import gc
import json
import math
import os
import shutil
import subprocess
import tempfile
import logging
import torch

import comfy.nested_tensor
import folder_paths
from comfy.cli_args import args as cli_args
from comfy_api.latest import io, InputImpl, Types

from . import (
    accel,
    canvas,
    compile as compiler,
    encode as encoder,
    lora,
    media,
    models,
    outputs,
    payload as payload_repair,
    settings,
)
from .h3_timing import FPS, largest_h3_video_run, crossfade_plan

_LOG = logging.getLogger("minimax_creator.timeline")

try:
    from safetensors.torch import load_file as _st_load, save_file as _st_save
except ImportError:
    _st_load = _st_save = None

DEFAULT_DATA = json.dumps({
    "version": 2,
    "render": "chained",
    "prompt": "",
    "soundscape": "",
    "music": "",
    "aspect": "16:9",
    "short_edge": 768,
    "loras": [],
    "assets": [],
    "output_prefix": outputs.VIDEO_PREFIX,
    "models": {},
    "tracks": {
        "video": {"muted": False, "locked": False},
        "soundscape": {"muted": False, "volume": 1.0},
        "music": {"muted": False, "volume": 1.0},
        "master": {"muted": False, "volume": 1.0},
    },
    "segments": [
        {"prompt": "", "assets": [], "loras": [], "duration_s": 6, "checkpoint": "auto", "gain": 1.0, "ducking": True},
    ],
}, indent=2)


def _remove_dc_offset(waveform: torch.Tensor) -> torch.Tensor:
    return waveform - waveform.mean(dim=-1, keepdim=True)


def _fit_audio_to_frames(waveform: torch.Tensor, num_frames: int, fps: float, sample_rate: int) -> torch.Tensor:
    clean = _remove_dc_offset(waveform)
    target_samples = int(round(num_frames / float(fps) * sample_rate))
    current_samples = clean.shape[-1]
    if current_samples > target_samples:
        return clean[..., :target_samples]
    elif current_samples < target_samples:
        return torch.nn.functional.pad(clean, (0, target_samples - current_samples))
    return clean


def _equal_power_audio_blend(wave_a: torch.Tensor, wave_b: torch.Tensor, sample_rate: int, fade_ms: float = 100.0) -> torch.Tensor:
    fade_len = min(int(round((fade_ms / 1000.0) * sample_rate)), wave_a.shape[-1], wave_b.shape[-1])
    if fade_len <= 16:
        return wave_b

    a_tail = wave_a[..., -fade_len:]
    b_head = wave_b[..., :fade_len]

    rms_a = torch.sqrt(torch.mean(a_tail ** 2) + 1e-8)
    rms_b = torch.sqrt(torch.mean(b_head ** 2) + 1e-8)
    gain_match = (rms_a / rms_b).clamp(0.65, 1.5)
    matched_b = b_head * gain_match

    t = torch.linspace(0.0, 1.0, fade_len, device=wave_a.device, dtype=wave_a.dtype)
    w_a = torch.cos(0.5 * torch.pi * t)
    w_b = torch.sin(0.5 * torch.pi * t)

    return a_tail * w_a + matched_b * w_b


def _luma_map(frames: torch.Tensor) -> torch.Tensor:
    return frames[..., 0] * 0.299 + frames[..., 1] * 0.587 + frames[..., 2] * 0.114


def _luma_stats(frames: torch.Tensor):
    y = _luma_map(frames).detach().float().reshape(-1)
    if int(y.numel()) == 0:
        return 0.5, 0.1, 0.5
    return (
        float(y.mean().item()),
        float(y.std(unbiased=False).clamp_min(1e-5).item()),
        float(y.median().item()),
    )


def _photometric_match_seam(images_a: torch.Tensor, images_b: torch.Tensor, overlap_frames: int = 39) -> torch.Tensor:
    if images_a is None or images_b is None or images_a.numel() == 0 or images_b.numel() == 0:
        return images_b

    detect_window = max(2, min(8, int(overlap_frames) if overlap_frames > 0 else 4))
    ref = images_a[-detect_window:]
    src = images_b[:detect_window]

    ref_mean, ref_std, ref_med = _luma_stats(ref)
    src_mean, src_std, src_med = _luma_stats(src)

    if abs(ref_mean - src_mean) < 0.005 and abs(ref_med - src_med) < 0.008:
        return images_b

    eps = 1e-4
    src_med_c = min(max(src_med, 0.05), 0.95)
    ref_med_c = min(max(ref_med, 0.05), 0.95)

    gamma = float(max(0.90, min(1.10, math.log(ref_med_c) / math.log(src_med_c))))
    src_y = _luma_map(src).detach().float()
    src_y_gamma = src_y.clamp(eps, 1.0).pow(gamma)
    gamma_mean = float(src_y_gamma.mean().item())

    if gamma_mean <= eps:
        return images_b

    gain = float(max(0.90, min(1.10, ref_mean / gamma_mean)))

    out = images_b.clone()
    rgb = out.float()
    y = _luma_map(rgb)
    y_corr = y.clamp(eps, 1.0).pow(gamma) * gain
    delta = (y_corr - y) * 0.65

    out[..., :3] = (rgb + delta.unsqueeze(-1)).clamp(0.0, 1.0)
    return out.to(images_b.dtype)


def _parse(timeline_data):
    try:
        return json.loads(timeline_data)
    except json.JSONDecodeError as exc:
        raise ValueError(f"timeline_data is not valid JSON: {exc}") from exc


def _announce(unique_id, progress):
    from server import PromptServer
    server = getattr(PromptServer, "instance", None)
    if server is not None:
        server.send_sync("mmc_segment", {"node": unique_id, **progress})


def _stamps(data):
    out = []

    def stamp(path_of, item, key):
        try:
            out.append(os.path.getmtime(path_of(item.get(key, ""))))
        except Exception:
            out.append(None)

    for entry in data.get("loras", []) or []:
        stamp(lora.resolve, entry, "name")
    for asset in data.get("assets", []) or []:
        stamp(media.resolve, asset, "filename")
    for segment in data.get("segments", []):
        if not isinstance(segment, dict):
            continue
        for asset in segment.get("assets", []) or []:
            stamp(media.resolve, asset, "filename")
        for entry in segment.get("loras", []) or []:
            stamp(lora.resolve, entry, "name")
    return tuple(out)


class MiniMaxH3Timeline(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        import comfy.samplers

        return io.Schema(
            node_id="MiniMaxH3Timeline",
            display_name="MiniMax H3 Timeline",
            category="MiniMax",
            description="Director NLE timeline: chained latent-masked shots or single-pass multi-cut rendering.",
            enable_expand=True,
            is_output_node=True,
            inputs=[
                io.String.Input("timeline_data", multiline=True, default=DEFAULT_DATA),
                io.Int.Input("seed", default=0, min=0, max=0xffffffffffffffff, control_after_generate=True),
                io.Int.Input("steps", default=20, min=1, max=10000),
                io.Float.Input("cfg", default=1.0, min=0.0, max=100.0, step=0.1, round=0.01),
                io.Combo.Input("sampler_name", options=comfy.samplers.KSampler.SAMPLERS, default="res_multistep"),
                io.Combo.Input("scheduler", options=comfy.samplers.KSampler.SCHEDULERS, default="simple"),
                io.Combo.Input("block_cache", options=accel.BLOCK_CACHE_MODES, default="off"),
                io.Boolean.Input("spectrum", default=False),
                io.Float.Input("spectrum_blend", default=0.5, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[
                io.Image.Output("images", display_name="images"),
                io.Audio.Output("audio", display_name="audio"),
                io.Model.Output("model_fl2va", display_name="model_fl2va"),
                io.Model.Output("model_ref2va", display_name="model_ref2va"),
                io.Vae.Output("vae", display_name="vae"),
                io.Clip.Output("clip", display_name="clip"),
                io.Latent.Output("latent", display_name="latent"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def fingerprint_inputs(cls, timeline_data, **kwargs):
        try:
            return (timeline_data, _stamps(json.loads(timeline_data)))
        except Exception:
            return (timeline_data, ())

    @classmethod
    def execute(cls, timeline_data, seed, steps, cfg, sampler_name, scheduler,
                block_cache="off", spectrum=False, spectrum_blend=0.5) -> io.NodeOutput:
        from . import render
        data = _parse(timeline_data)
        single = compiler.render_mode(data) == "single"
        payloads = (
            [compiler.single_payload(data)]
            if single else
            compiler.timeline_payloads(data, image_size_lookup=media.image_size)
        )
        labels = ["This one-pass render"] if single else [f"Segment {i + 1}" for i in range(len(payloads))]

        graph, result_links = render.emit(
            payloads, labels,
            models.Weights.from_blob(data),
            render.Sampling(seed=seed, steps=steps, cfg=cfg,
                            sampler_name=sampler_name, scheduler=scheduler),
            accel.Settings(block_cache=block_cache, spectrum=spectrum,
                           spectrum_blend=spectrum_blend),
            cls.hidden.unique_id,
            filename_prefix=outputs.video(data, settings.video_prefix()),
        )
        return render.expanded(graph, result_links)


class MiniMaxH3TimelineSegment(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3TimelineSegment",
            display_name="MiniMaxH3 Timeline Segment",
            category="MiniMax/internal",
            description="Executes one segment of a timeline using raw latent keyframe continuity and clean sliced master audio.",
            is_dev_only=True,
            inputs=[
                io.Clip.Input("clip"),
                io.Vae.Input("vae", optional=True),
                io.Vae.Input("audio_vae", optional=True),
                io.String.Input("segment_data", multiline=True),
                io.Model.Input("model_fl2va", optional=True),
                io.Model.Input("model_ref2va", optional=True),
                io.Image.Input("prev_image", optional=True),
                io.Audio.Input("prev_audio", optional=True),
                io.Latent.Input("prev_latent", optional=True),
                io.Audio.Input("master_audio", optional=True),
                io.Image.Input("source_frames", optional=True),
                io.Audio.Input("source_audio", optional=True),
                io.Image.Input("prev_step", optional=True),
            ],
            outputs=[
                io.Model.Output(display_name="model"),
                io.Conditioning.Output(display_name="positive"),
                io.Latent.Output(display_name="latent"),
                io.Audio.Output(display_name="clean_audio"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def fingerprint_inputs(cls, segment_data, **kwargs):
        try:
            payload = json.loads(segment_data)
            return (segment_data, _stamps({"segments": [payload.get("request", {})]}))
        except Exception:
            return (segment_data, ())

    @classmethod
    def execute(cls, clip, segment_data, vae=None, audio_vae=None,
                model_fl2va=None, model_ref2va=None,
                prev_image=None, prev_audio=None, prev_latent=None,
                master_audio=None, source_frames=None, source_audio=None,
                prev_step=None) -> io.NodeOutput:
        payload = _parse(segment_data)
        progress = payload.get("progress")
        if progress:
            _announce(cls.hidden.unique_id, progress)

        compiled = compiler.compile_segment(payload, image_size_lookup=media.image_size)

        if vae is None and compiled.encodes_video():
            raise ValueError("This generation encodes a keyframe or visual reference; video VAE is required.")
        if audio_vae is None and compiled.encodes_audio():
            raise ValueError("This generation encodes audio; audio VAE is required.")

        override = payload.get("prompt_override")
        if override:
            compiled.prompt = override

        model = {"fl2va": model_fl2va, "ref2va": model_ref2va}[compiled.checkpoint]
        if model is None:
            raise ValueError(f"Segment {compiled.mode} requires {compiled.checkpoint.upper()} checkpoint.")
        model = lora.apply(model, payload["request"].get("loras"), compiled.checkpoint)

        loaded = media.load_all(compiled)

        if prev_latent is not None and getattr(prev_latent, "get", None) and prev_latent.get("samples") is not None:
            loaded[encoder.PREV_LATENT] = {"latent": prev_latent}

        if prev_image is not None and getattr(prev_image, "shape", [0])[0] > 0:
            count = min(int(prev_image.shape[0]), compiled.feather if compiled.feather > 1 else 1)
            loaded[encoder.PREV_FRAME] = {"image": prev_image[-count:]}

        if source_frames is not None and getattr(source_frames, "shape", [0])[0] > 0:
            loaded[encoder.SOURCE_VIDEO] = {
                "frames": source_frames,
                "audio": source_audio if source_audio is not None else prev_audio
            }

        if prev_audio is not None:
            loaded[encoder.PREV_AUDIO] = {"audio": prev_audio}

        if master_audio is not None:
            loaded[encoder.MASTER_AUDIO] = {"audio": master_audio}

        if compiled.continues or compiled.continues_audio:
            model = payload_repair.repair(model)

        cond, latent = encoder.encode(clip, vae, audio_vae, compiled, loaded)

        clean_audio = None
        if encoder.MASTER_AUDIO in loaded:
            master_raw = loaded[encoder.MASTER_AUDIO]["audio"]
            sr = int(master_raw["sample_rate"])
            clip_start = float(getattr(compiled, "clip_start_seconds", 0.0))
            dur = float(compiled.seconds)
            start_samp = max(0, int(round(clip_start * sr)))
            needed_samp = int(round(dur * sr))
            end_samp = start_samp + needed_samp

            wave = master_raw["waveform"]
            slice_w = wave[..., start_samp:end_samp]
            if slice_w.shape[-1] < needed_samp:
                slice_w = torch.nn.functional.pad(slice_w, (0, needed_samp - slice_w.shape[-1]))
            clean_audio = {"waveform": slice_w, "sample_rate": sr}

        return io.NodeOutput(model, cond, latent, clean_audio)


class MiniMaxH3TimelineJoin(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3TimelineJoin",
            display_name="MiniMax H3 Timeline Join",
            category="MiniMax/internal",
            description="Joins two segments using linear visual blending, Photometric Seam matching, and equal-power audio crossfade.",
            is_dev_only=True,
            inputs=[
                io.Image.Input("images_a"),
                io.Audio.Input("audio_a"),
                io.Image.Input("images_b"),
                io.Audio.Input("audio_b"),
                io.Int.Input("overlap_frames", default=39, min=0, max=512),
                io.Float.Input("gain_b", default=1.0, min=0.0, max=4.0, step=0.05, optional=True),
            ],
            outputs=[io.Image.Output(display_name="images"), io.Audio.Output(display_name="audio")],
        )

    @classmethod
    def execute(cls, images_a, audio_a, images_b, audio_b, overlap_frames=39, gain_b=1.0) -> io.NodeOutput:
        if images_a.shape[1:] != images_b.shape[1:]:
            raise ValueError(f"Segment geometry differs: {images_a.shape[2]}x{images_a.shape[1]} vs {images_b.shape[2]}x{images_b.shape[1]}")

        images_b = _photometric_match_seam(images_a, images_b, overlap_frames)

        rate_a = int(audio_a["sample_rate"])
        clean_a = _fit_audio_to_frames(audio_a["waveform"], images_a.shape[0], canvas.FPS, rate_a)

        wave_b = audio_b["waveform"].to(audio_a["waveform"])
        if abs(float(gain_b) - 1.0) > 1e-4:
            wave_b = wave_b * float(gain_b)

        clean_b = _fit_audio_to_frames(wave_b, images_b.shape[0], canvas.FPS, rate_a)
        ov = min(int(overlap_frames), images_a.shape[0] - 1, images_b.shape[0] - 1)

        if ov > 0:
            blend_src = images_a[-ov:]
            blend_dst = images_b[:ov]
            alpha_v = torch.linspace(0.0, 1.0, ov + 2, device=images_a.device, dtype=images_a.dtype)[1:-1].view(-1, 1, 1, 1)
            blended_video = (1.0 - alpha_v) * blend_src + alpha_v * blend_dst
            images = torch.cat([images_a[:-ov], blended_video, images_b[ov:]], dim=0)

            ov_samples = int(round(ov / canvas.FPS * rate_a))
            fade_len = min(int(round(0.100 * rate_a)), ov_samples, clean_a.shape[-1] // 2)

            if fade_len > 1 and ov_samples >= fade_len:
                a_seam = clean_a[..., -fade_len:]
                b_seam = clean_b[..., ov_samples - fade_len : ov_samples]
                blended_seam = _equal_power_audio_blend(a_seam, b_seam, rate_a, fade_ms=100.0)
                audio_wave = torch.cat([clean_a[..., :-fade_len], blended_seam, clean_b[..., ov_samples:]], dim=-1)
            else:
                audio_wave = torch.cat([clean_a, clean_b[..., ov_samples:]], dim=-1)
        else:
            images = torch.cat([images_a, images_b.to(images_a)], dim=0)
            fade_len = min(int(round(0.040 * rate_a)), clean_a.shape[-1] // 2, clean_b.shape[-1] // 2)
            if fade_len > 1:
                blended_seam = _equal_power_audio_blend(clean_a[..., -fade_len:], clean_b[..., :fade_len], rate_a, fade_ms=40.0)
                audio_wave = torch.cat([clean_a[..., :-fade_len], blended_seam, clean_b[..., fade_len:]], dim=-1)
            else:
                audio_wave = torch.cat([clean_a, clean_b], dim=-1)

        final_wave = _fit_audio_to_frames(audio_wave, images.shape[0], canvas.FPS, rate_a)
        audio = {"waveform": final_wave, "sample_rate": rate_a}
        return io.NodeOutput(images, audio)


class MiniMaxH3SaveSegment(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3SaveSegment",
            display_name="MiniMax H3 Save Segment",
            category="MiniMax/internal",
            description="Atomically saves intermediate segment video and raw AV latent checkpoint.",
            is_dev_only=True,
            is_output_node=True,
            inputs=[
                io.Image.Input("images"),
                io.Audio.Input("audio"),
                io.Latent.Input("latent", optional=True),
                io.Float.Input("fps", default=float(canvas.FPS)),
                io.String.Input("filename_prefix", default="minimax/renders/H3"),
                io.Int.Input("segment_index", default=1),
                io.String.Input("parent_node_id", default=""),
                io.Int.Input("crf", default=settings.DEFAULT_CRF),
            ],
            outputs=[],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, images, audio, latent=None, fps=float(canvas.FPS),
                filename_prefix="minimax/renders/H3", segment_index=1,
                parent_node_id="", crf=settings.DEFAULT_CRF) -> io.NodeOutput:
        from fractions import Fraction
        from server import PromptServer

        rate = int(audio["sample_rate"])
        clean_wave = _fit_audio_to_frames(audio["waveform"], int(images.shape[0]), fps, rate)
        audio = {"waveform": clean_wave, "sample_rate": rate}

        height, width = int(images.shape[1]), int(images.shape[2])
        seg_prefix = f"{filename_prefix.rstrip('/')}_seg{int(segment_index)}"
        directory, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            seg_prefix, folder_paths.get_output_directory(), width, height
        )
        filename = f"{name}_{counter:05}_.mp4"
        full_path = os.path.join(directory, filename)

        video = InputImpl.VideoFromComponents(Types.VideoComponents(
            images=images, audio=audio, frame_rate=Fraction(round(float(fps)))
        ))
        video.save_to(full_path, format=Types.VideoContainer.MP4, codec=Types.VideoCodec.H264, crf=float(crf))

        if latent is not None and _st_save is not None:
            try:
                samples = latent["samples"]
                parts = list(samples.unbind()) if hasattr(samples, "unbind") else list(samples)
                v_tensor, a_tensor = parts[0], parts[1]
                ckpt_path = os.path.join(directory, f"{name}_{counter:05}_.safetensors")
                _st_save(
                    {"video": v_tensor.detach().cpu().contiguous(), "audio": a_tensor.detach().cpu().contiguous()},
                    ckpt_path,
                    metadata={"format": "mmc_joint_av_latent_v1", "segment_index": str(int(segment_index))},
                )
            except Exception as err:
                _LOG.warning(f"Could not save segment latent checkpoint: {err}")

        output_path = f"{subfolder}/{filename}" if subfolder else filename
        cached_result = output_path + " [output]"
        target_node = str(parent_node_id).strip() or cls.hidden.unique_id

        server = getattr(PromptServer, "instance", None)
        if server is not None:
            server.send_sync("mmc_segment_cached", {
                "node": target_node,
                "segment_index": int(segment_index),
                "cached_video": cached_result,
            })

        return io.NodeOutput(ui={
            "mmc_segment_cached": [{"index": int(segment_index), "cached_video": cached_result}],
        })


class MiniMaxH3Save(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3Save",
            display_name="MiniMax H3 Save",
            category="MiniMax/internal",
            description="Muxes a render's frames and sound into one file under output/ with sample-exact duration matching.",
            is_dev_only=True,
            is_output_node=True,
            inputs=[
                io.Image.Input("images"),
                io.Audio.Input("audio"),
                io.Float.Input("fps", default=float(canvas.FPS), min=1.0, max=120.0),
                io.String.Input("filename_prefix", default="minimax/H3"),
                io.Int.Input("crf", default=settings.DEFAULT_CRF, min=settings.MIN_CRF, max=settings.MAX_CRF),
            ],
            outputs=[],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, images, audio, fps, filename_prefix, crf=settings.DEFAULT_CRF) -> io.NodeOutput:
        from fractions import Fraction

        rate = int(audio["sample_rate"])
        clean_wave = _fit_audio_to_frames(audio["waveform"], int(images.shape[0]), float(fps), rate)
        audio = {"waveform": clean_wave, "sample_rate": rate}

        height, width = int(images.shape[1]), int(images.shape[2])
        directory, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_output_directory(), width, height
        )

        metadata = None
        if not cli_args.disable_metadata:
            collected = dict(cls.hidden.extra_pnginfo or {})
            if cls.hidden.prompt is not None:
                collected["prompt"] = cls.hidden.prompt
            metadata = collected or None

        video = InputImpl.VideoFromComponents(Types.VideoComponents(
            images=images, audio=audio, frame_rate=Fraction(round(float(fps)))
        ))
        filename = f"{name}_{counter:05}_.mp4"
        video.save_to(os.path.join(directory, filename),
                      format=Types.VideoContainer.MP4,
                      codec=Types.VideoCodec.H264,
                      metadata=metadata,
                      crf=float(crf))

        output_item = {"filename": filename, "subfolder": subfolder, "type": "output"}
        return io.NodeOutput(ui={"mmc_video": [output_item], "videos": [output_item], "gifs": [output_item]})


class MiniMaxH3StreamedAssembly(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3StreamedAssembly",
            display_name="MiniMax H3 Streamed Assembly",
            category="MiniMax/internal",
            description="RAM-safe sequential video decoding, float-space linear alpha seam blending, and FFmpeg streaming.",
            is_dev_only=True,
            is_output_node=True,
            inputs=[
                io.Vae.Input("vae"),
                io.Vae.Input("audio_vae"),
                io.Latent.Input("latents"),
                io.Int.Input("overlap_frames", default=39, min=0, max=512),
                io.String.Input("filename_prefix", default="minimax/renders/H3"),
                io.Int.Input("crf", default=settings.DEFAULT_CRF, min=settings.MIN_CRF, max=settings.MAX_CRF),
            ],
            outputs=[],
            hidden=[io.Hidden.unique_id, io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, vae, audio_vae, latents, overlap_frames=39,
                filename_prefix="minimax/renders/H3", crf=settings.DEFAULT_CRF) -> io.NodeOutput:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("ffmpeg not found on PATH")

        latent_list = latents if isinstance(latents, (list, tuple)) else [latents]
        if not latent_list:
            raise ValueError("No segment latents to assemble")

        first_video = latent_list[0]["samples"].unbind()[0]
        width = int(first_video.shape[4]) * 16
        height = int(first_video.shape[3]) * 16

        directory, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_output_directory(), width, height
        )
        out_path = os.path.join(directory, f"{name}_{counter:05}_.mp4")

        tempdir = tempfile.mkdtemp(prefix="mmc_stream_audio_")
        audio_raw = os.path.join(tempdir, "soundtrack.f32le")
        audio_sr = int(getattr(audio_vae, "audio_sample_rate_output", getattr(audio_vae, "audio_sample_rate", 44100)))

        try:
            full_waveform = None
            for i, l_dict in enumerate(latent_list):
                _, a_lat = l_dict["samples"].unbind()
                a_dec = audio_vae.decode(a_lat).movedim(-1, 1)
                std = torch.std(a_dec, dim=[1, 2], keepdim=True) * 5.0
                std[std < 1.0] = 1.0
                a_dec = (a_dec / std).detach().cpu()
                if a_dec.shape[1] == 1:
                    a_dec = a_dec.repeat(1, 2, 1)
                elif a_dec.shape[1] > 2:
                    a_dec = a_dec[:, :2]

                v_steps = int(l_dict["samples"].unbind()[0].shape[2])
                from .h3_timing import FRAME_PER_TOKEN
                seg_frames = sum(FRAME_PER_TOKEN[k % 5] for k in range(v_steps))
                ov = min(overlap_frames, seg_frames - 1) if i > 0 else 0

                if ov > 0:
                    cut_samples = int(round(ov / FPS * audio_sr))
                    fade_len = min(int(round(0.100 * audio_sr)), cut_samples, full_waveform.shape[-1] // 2) if full_waveform is not None else 0
                    if fade_len > 1:
                        a_seam = full_waveform[..., -fade_len:]
                        b_seam = a_dec[..., cut_samples - fade_len : cut_samples]
                        blended_seam = _equal_power_audio_blend(a_seam, b_seam, audio_sr, fade_ms=100.0)
                        a_dec = torch.cat([blended_seam, a_dec[..., cut_samples:]], dim=-1)
                        full_waveform = full_waveform[..., :-fade_len]
                    else:
                        a_dec = a_dec[..., cut_samples:]

                unique_frames = seg_frames - ov
                a_dec = _fit_audio_to_frames(a_dec, unique_frames, FPS, audio_sr)

                if full_waveform is None:
                    full_waveform = a_dec
                else:
                    full_waveform = torch.cat([full_waveform, a_dec], dim=-1)

                del a_lat, a_dec

            with open(audio_raw, "wb") as af:
                interleaved = full_waveform[0].transpose(0, 1).contiguous().numpy().astype("<f4", copy=False)
                af.write(interleaved.tobytes(order="C"))

            cmd = [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-f", "rawvideo", "-vcodec", "rawvideo",
                "-pix_fmt", "rgb24", "-s", f"{width}x{height}",
                "-r", "24", "-i", "-",
                "-f", "f32le", "-ar", str(audio_sr), "-ac", "2",
                "-i", audio_raw,
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(int(crf)),
                "-c:a", "aac", "-b:a", "320k",
                "-shortest", out_path,
            ]
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

            pending_tail = None
            try:
                for i, l_dict in enumerate(latent_list):
                    v_lat, _ = l_dict["samples"].unbind()
                    images = vae.decode(v_lat).detach().cpu().clamp(0.0, 1.0)
                    if images.ndim == 5 and images.shape[0] == 1:
                        images = images[0]
                    if images.shape[-1] in (3, 4):
                        images = images[..., :3]
                    elif images.shape[1] in (3, 4):
                        images = images.movedim(1, -1)[..., :3]

                    seg_total = int(images.shape[0])
                    ov = min(overlap_frames, seg_total - 1) if i > 0 else 0

                    if i == 0:
                        if len(latent_list) == 1 or overlap_frames <= 0:
                            _write_rgb24(proc, images)
                        else:
                            _write_rgb24(proc, images[:-overlap_frames])
                            pending_tail = images[-overlap_frames:].clone().contiguous()
                    else:
                        if ov > 0 and pending_tail is not None:
                            ov_actual = min(ov, int(pending_tail.shape[0]))
                            blend_src = pending_tail[-ov_actual:]
                            blend_dst = images[:ov_actual]
                            alpha = torch.linspace(0.0, 1.0, ov_actual + 2, dtype=blend_src.dtype)[1:-1].view(-1, 1, 1, 1)
                            blended = (1.0 - alpha) * blend_src + alpha * blend_dst
                            _write_rgb24(proc, blended)
                            del blended, alpha, blend_src, blend_dst

                        suffix = images[ov:]
                        if i < len(latent_list) - 1 and overlap_frames > 0:
                            _write_rgb24(proc, suffix[:-overlap_frames])
                            pending_tail = suffix[-overlap_frames:].clone().contiguous()
                        else:
                            _write_rgb24(proc, suffix)
                            pending_tail = None

                    del images, v_lat
                    gc.collect()

                if pending_tail is not None:
                    _write_rgb24(proc, pending_tail)
                    pending_tail = None

                proc.stdin.close()
                rc = proc.wait()
                if rc != 0:
                    err = proc.stderr.read().decode("utf-8", errors="replace")
                    raise RuntimeError(f"FFmpeg assembly failed ({rc}): {err}")
            finally:
                try:
                    proc.stderr.close()
                except Exception:
                    pass
        finally:
            try:
                os.remove(audio_raw)
                os.rmdir(tempdir)
            except OSError:
                pass
            gc.collect()

        output_item = {"filename": f"{name}_{counter:05}_.mp4", "subfolder": subfolder, "type": "output"}
        return io.NodeOutput(ui={"mmc_video": [output_item], "videos": [output_item]})


def _write_rgb24(proc, tensor_batch: torch.Tensor, chunk: int = 16):
    count = int(tensor_batch.shape[0])
    for start in range(0, count, max(1, chunk)):
        part = tensor_batch[start : start + chunk].detach().cpu().clamp(0.0, 1.0)
        arr = torch.round(part * 255.0).to(torch.uint8).numpy()
        proc.stdin.write(arr.tobytes(order="C"))
        del part, arr


class MiniMaxH3LoadSegment(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3LoadSegment",
            display_name="MiniMax H3 Load Segment",
            category="MiniMax/internal",
            description="Loads cached segment video and raw AV latent checkpoint to bypass DiT sampling.",
            is_dev_only=True,
            inputs=[
                io.String.Input("video_path"),
                io.Vae.Input("vae", optional=True),
            ],
            outputs=[
                io.Image.Output(display_name="images"),
                io.Audio.Output(display_name="audio"),
                io.Latent.Output(display_name="latent"),
            ],
        )

    @classmethod
    def execute(cls, video_path, vae=None) -> io.NodeOutput:
        frames, audio = media.load_video(video_path, want_audio=True)
        if audio is None:
            audio = {"waveform": torch.zeros((1, 2, frames.shape[0] * 1000), dtype=torch.float32), "sample_rate": 24000}

        latent_dict = None
        if _st_load is not None:
            try:
                resolved_mp4 = media.resolve(video_path)
                base_no_ext = os.path.splitext(resolved_mp4)[0]
                ckpt_path = f"{base_no_ext}.safetensors"
                if os.path.exists(ckpt_path):
                    tensors = _st_load(ckpt_path)
                    v_t = tensors["video"].unsqueeze(0) if tensors["video"].ndim == 4 else tensors["video"]
                    a_t = tensors["audio"].unsqueeze(0) if tensors["audio"].ndim == 3 else tensors["audio"]
                    latent_dict = {"samples": comfy.nested_tensor.NestedTensor((v_t, a_t))}
            except Exception as e:
                _LOG.warning(f"Could not load segment latent checkpoint: {e}")
                latent_dict = None

        if latent_dict is None and vae is not None and frames is not None and frames.shape[0] > 0:
            try:
                v_enc = vae.encode(frames)
                if v_enc.ndim == 4:
                    v_enc = v_enc.unsqueeze(0)
                a_len = int(round(frames.shape[0] / float(canvas.FPS) * 40.0))
                a_enc = torch.zeros((1, 32, 2, max(1, a_len)), device=v_enc.device, dtype=v_enc.dtype)
                latent_dict = {"samples": comfy.nested_tensor.NestedTensor((v_enc, a_enc))}
            except Exception:
                pass

        return io.NodeOutput(frames, audio, latent_dict)


class MiniMaxH3AudioTail(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3AudioTail",
            display_name="MiniMax H3 Audio Tail",
            category="MiniMax/internal",
            description="The last few seconds of a decoded soundtrack, for the next timeline segment.",
            is_dev_only=True,
            inputs=[
                io.Audio.Input("audio"),
                io.Float.Input("seconds", default=compiler.DEFAULT_AUDIO_TAIL_S, min=0.1, max=compiler.MAX_AUDIO_TAIL_S, step=0.1),
            ],
            outputs=[io.Audio.Output()],
        )

    @classmethod
    def execute(cls, audio, seconds) -> io.NodeOutput:
        waveform = audio["waveform"]
        rate = int(audio["sample_rate"])
        wanted = max(1, int(round(float(seconds) * rate)))
        if waveform.shape[-1] == 0:
            raise ValueError("no audio to continue from")
        return io.NodeOutput({"waveform": waveform[..., -wanted:], "sample_rate": rate})


class MiniMaxH3LastFrame(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3LastFrame",
            display_name="MiniMax H3 Last Frame",
            category="MiniMax/internal",
            description="The final frames of a decoded batch — what the next timeline segment continues from.",
            is_dev_only=True,
            inputs=[
                io.Image.Input("image"),
                io.Int.Input("count", default=1, min=1, max=64, optional=True),
            ],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, image, count=1) -> io.NodeOutput:
        count = max(1, int(count))
        if image.shape[0] < count:
            raise ValueError(f"Source has {image.shape[0]} frames and seam inherits {count}.")
        return io.NodeOutput(image[-count:])


class MiniMaxH3SeamTrim(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3SeamTrim",
            display_name="MiniMax H3 Seam Trim",
            category="MiniMax/internal",
            description="Drops duplicated overlap frames off the front of a decoded segment.",
            is_dev_only=True,
            inputs=[
                io.Image.Input("images"),
                io.Audio.Input("audio"),
                io.Int.Input("frames", default=0, min=0, max=64),
            ],
            outputs=[io.Image.Output(display_name="images"), io.Audio.Output(display_name="audio")],
        )

    @classmethod
    def execute(cls, images, audio, frames) -> io.NodeOutput:
        frames = int(frames)
        if frames <= 0:
            return io.NodeOutput(images, audio)
        if images.shape[0] <= frames:
            raise ValueError(f"Cannot trim {frames} inherited frames off {images.shape[0]}-frame segment.")

        rate = int(audio["sample_rate"])
        samples = int(round(frames / canvas.FPS * rate))
        trimmed_images = images[frames:]
        unique_samples = int(round(trimmed_images.shape[0] / canvas.FPS * rate))

        wave = _remove_dc_offset(audio["waveform"])
        trimmed_wave = wave[..., samples : samples + unique_samples]
        if trimmed_wave.shape[-1] < unique_samples:
            trimmed_wave = torch.nn.functional.pad(trimmed_wave, (0, unique_samples - trimmed_wave.shape[-1]))

        return io.NodeOutput(
            trimmed_images,
            {"waveform": trimmed_wave, "sample_rate": rate},
        )


NODES = [
    MiniMaxH3Timeline,
    MiniMaxH3TimelineSegment,
    MiniMaxH3TimelineJoin,
    MiniMaxH3StreamedAssembly,
    MiniMaxH3LastFrame,
    MiniMaxH3SeamTrim,
    MiniMaxH3AudioTail,
    MiniMaxH3Save,
    MiniMaxH3SaveSegment,
    MiniMaxH3LoadSegment,
]