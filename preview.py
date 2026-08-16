"""Frame and waveform previews, decoded server-side with duration metadata."""

import asyncio
import hashlib
import json
import os

from PIL import Image

import folder_paths

# Thumbnail dimension constraints
THUMB_LONG_EDGE = 320
THUMB_QUALITY = 78

# Peak resolution for timeline waveform display
PEAK_BUCKETS = 1400
PEAK_RATE = 8000

MAX_PARALLEL_DECODES = 3

_FAILED = set()
_gate = None
_gate_loop = None


def _semaphore():
    """One semaphore per active event loop to avoid cross-loop deadlocks."""
    global _gate, _gate_loop
    loop = asyncio.get_running_loop()
    if _gate is None or _gate_loop is not loop:
        _gate = asyncio.Semaphore(MAX_PARALLEL_DECODES)
        _gate_loop = loop
    return _gate


def _cache_dir():
    directory = os.path.join(folder_paths.get_user_directory(), "minimax_creator", "previews")
    os.makedirs(directory, exist_ok=True)
    return directory


def _cache_path(path, kind, suffix):
    """Generates an mtime/size-keyed deterministic cache file path."""
    stat = os.stat(path)
    key = hashlib.sha1(
        f"{path}|{stat.st_mtime_ns}|{stat.st_size}|{kind}".encode("utf-8", "surrogateescape")
    ).hexdigest()
    return os.path.join(_cache_dir(), f"{key}.{suffix}")


def _write_atomically(target, write):
    """Thread-safe atomic file writer using PID-tagged temporary files."""
    temporary = f"{target}.{os.getpid()}.part"
    try:
        write(temporary)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            try:
                os.remove(temporary)
            except OSError:
                pass


async def _produce(path, kind, suffix, render):
    """Executes blocking PyAV media decodes on an async executor thread."""
    try:
        target = _cache_path(path, kind, suffix)
    except OSError:
        return None
    if os.path.exists(target):
        return target
    if target in _FAILED:
        return None

    async with _semaphore():
        if os.path.exists(target):
            return target
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(None, _write_atomically, target, lambda tmp: render(path, tmp))
        except Exception:
            _FAILED.add(target)
            return None
    return target


# ---- video frame extraction -------------------------------------------------


def _seek_past_the_leader(container, stream):
    """Seeks to ~10% into the stream (max 1.0s) to bypass initial black frames."""
    import av

    if not container.duration:
        return
    seconds = min(1.0, float(container.duration / av.time_base) * 0.1)
    if seconds <= 0:
        return
    try:
        container.seek(int(seconds / stream.time_base), stream=stream)
    except Exception:
        pass


def _render_thumb(path, out):
    import av

    with av.open(path) as container:
        if not container.streams.video:
            raise ValueError("no video stream found in container")
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        _seek_past_the_leader(container, stream)
        frame = next(container.decode(stream), None)
        if frame is None:
            container.seek(0)
            frame = next(container.decode(stream), None)
        if frame is None:
            raise ValueError("no decodable video frame")
        image = frame.to_image()

    image.thumbnail((THUMB_LONG_EDGE, THUMB_LONG_EDGE), Image.LANCZOS)
    image.convert("RGB").save(out, "JPEG", quality=THUMB_QUALITY, optimize=True)


async def thumbnail(path):
    """Returns local path to a cached JPEG frame, or None if undecodable."""
    return await _produce(path, "thumb", "jpg", _render_thumb)


# ---- waveform extraction with duration & channel metadata -------------------


def _render_peaks(path, out):
    import av
    import numpy as np

    windows = []
    duration = 0.0
    channels = 0
    sample_rate = 0

    with av.open(path) as container:
        if container.duration:
            duration = float(container.duration / av.time_base)

        if not container.streams.audio:
            with open(out, "w", encoding="utf-8") as handle:
                json.dump({
                    "peaks": None,
                    "duration": duration,
                    "channels": 0,
                    "sample_rate": 0,
                }, handle)
            return

        stream = container.streams.audio[0]
        stream.thread_type = "AUTO"
        channels = stream.channels or 2
        sample_rate = stream.rate or 44100

        resampler = av.AudioResampler(format="flt", layout="mono", rate=PEAK_RATE)
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                samples = resampled.to_ndarray()
                if samples.size:
                    windows.append(float(np.abs(samples).max()))

    peaks = None
    if windows:
        source = np.asarray(windows, dtype=np.float32)
        count = min(PEAK_BUCKETS, source.size)
        edges = np.linspace(0, source.size, count + 1).astype(int)
        bucketed = np.array([source[a:b].max() if b > a else 0.0 for a, b in zip(edges, edges[1:])])
        loudest = float(bucketed.max())
        if loudest > 0:
            peaks = [round(float(value) / loudest * 0.94, 3) for value in bucketed]

    with open(out, "w", encoding="utf-8") as handle:
        json.dump({
            "peaks": peaks,
            "duration": duration,
            "channels": channels,
            "sample_rate": sample_rate,
        }, handle)


async def waveform(path):
    """Returns waveform peak array and exact duration/sample metadata."""
    cached = await _produce(path, "peaks_v2", "json", _render_peaks)
    if cached is None:
        return None
    try:
        with open(cached, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None