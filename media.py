"""Loading assets by filename out of ComfyUI/input with automatic Master Song / Audio resolution."""

import numpy as np
import torch
from PIL import Image, ImageOps

import folder_paths
from comfy_api.latest import InputImpl
from comfy_extras.nodes_audio import load as _load_audio_file
from comfy_extras.nodes_minimax_h3 import align_frame_count

TARGET_FPS = 24


class MediaError(ValueError):
    """A referenced file is missing or cannot be read as its declared kind."""


def resolve(filename):
    """Filename from the picker -> absolute path, honouring ComfyUI annotations."""
    if not folder_paths.exists_annotated_filepath(filename):
        raise MediaError(f"{filename!r} is not in the input folder any more")
    return folder_paths.get_annotated_filepath(filename)


def image_size(filename):
    """(width, height) without decoding pixels — used for the adaptive canvas."""
    with Image.open(resolve(filename)) as img:
        img = ImageOps.exif_transpose(img)
        return img.size


def load_image(filename):
    """-> float tensor [1, H, W, 3] in 0..1, the ComfyUI IMAGE layout."""
    with Image.open(resolve(filename)) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        array = np.array(img, dtype=np.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


def _cut_audio(filename, audio, trim):
    """Cut an AUDIO dict {waveform [1, C, L], sample_rate} down to `trim` seconds."""
    if trim is None:
        return audio
    start, end = trim
    rate = int(audio["sample_rate"])
    length = audio["waveform"].shape[-1]
    first = min(int(round(start * rate)), length)
    last = min(int(round(end * rate)), length)
    if last - first < 1:
        raise MediaError(
            f"{filename!r}: the {start:.2f}–{end:.2f} s segment is past the end of the audio"
        )
    return {"waveform": audio["waveform"][..., first:last], "sample_rate": rate}


def load_audio(filename, trim=None):
    """-> the ComfyUI AUDIO dict {waveform [1, C, L], sample_rate}."""
    path = resolve(filename)
    try:
        waveform, sample_rate = _load_audio_file(path)
    except ValueError as exc:
        raise MediaError(f"{filename!r}: {exc}") from exc
    audio = {"waveform": waveform.unsqueeze(0), "sample_rate": int(sample_rate)}
    return _cut_audio(filename, audio, trim)


def _decode_window(trim, max_seconds):
    start = trim[0] if trim is not None else 0.0
    duration = (trim[1] - trim[0]) if trim is not None else 0.0
    if max_seconds is not None:
        cap = max_seconds + 2.0 / TARGET_FPS
        duration = min(duration, cap) if duration else cap
    return start, duration


def load_video(filename, want_audio=False, trim=None, max_seconds=None):
    start, duration = _decode_window(trim, max_seconds)
    components = InputImpl.VideoFromFile(
        resolve(filename), start_time=start, duration=duration).get_components()
    frames = components.images
    if frames is None or frames.shape[0] == 0:
        if trim is not None:
            raise MediaError(
                f"{filename!r}: the {trim[0]:.2f}–{trim[1]:.2f} s segment is past the end of the clip"
            )
        raise MediaError(f"{filename!r} has no video frames")
    frames = frames[..., :3]

    source_fps = float(components.frame_rate)
    if source_fps > 0 and abs(source_fps - TARGET_FPS) > 1e-3:
        count = max(1, round(frames.shape[0] / source_fps * TARGET_FPS))
        index = torch.arange(count, dtype=torch.float64) * (source_fps / TARGET_FPS)
        index = index.floor().clamp(0, frames.shape[0] - 1).long()
        frames = frames[index]

    audio = None
    if want_audio:
        if components.audio is None:
            raise MediaError(f"{filename!r} has no audio track to use as a reference")
        audio = components.audio

    return frames, audio


def load_all(compiled):
    limit = align_frame_count(max(5, compiled.frames)) / TARGET_FPS

    loaded = {}
    for asset in (compiled.first_frame, compiled.last_frame):
        if asset is not None:
            loaded[asset.handle] = {"image": load_image(asset.filename)}
    for asset in compiled.ref_images:
        loaded[asset.handle] = {"image": load_image(asset.filename)}
    for asset in compiled.ref_videos:
        frames, audio = load_video(
            asset.filename, want_audio=asset.track == "picture+sound",
            trim=asset.trim, max_seconds=limit)
        loaded[asset.handle] = {"frames": frames, "audio": audio}
    for asset in compiled.ref_audios:
        loaded[asset.handle] = {"audio": load_audio(asset.filename, trim=asset.trim)}

    # Automatic load for master soundtrack audio file
    master_file = getattr(compiled, "master_audio_file", None)
    if master_file:
        try:
            loaded["__master_audio__"] = {"audio": load_audio(master_file)}
        except Exception as exc:
            raise MediaError(f"Master audio track {master_file!r}: {exc}") from exc

    return loaded