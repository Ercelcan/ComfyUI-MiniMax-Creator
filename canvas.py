"""Canvas, duration, aspect, and exact AV temporal math for MiniMax H3."""

import math

CANVAS_MULTIPLE = 32
FPS = 24.0
AUDIO_HZ = 40.0

NATIVE_SHORT_EDGE = 768
NATIVE_MAX_PIXELS = 768 * 1344

# Updated to 352 to support down to 0.2 MP base generation (e.g. 608x352 / 864x480)
MIN_SHORT_EDGE = 352
MAX_SHORT_EDGE = 2048

MIN_RATIO = 9 / 16
MAX_RATIO = 21 / 9

ASPECT_PRESETS = {
    "21:9": 21 / 9,
    "16:9": 16 / 9,
    "4:3": 4 / 3,
    "1:1": 1.0,
    "3:4": 3 / 4,
    "9:16": 9 / 16,
}

TRAINED_MIN_FRAMES = 124
TRAINED_MAX_FRAMES = 362

MIN_SECONDS = 1
MAX_SECONDS = 60


def legal_frame_counts():
    """All valid H3 17n+5 frame counts across the duration envelope."""
    return list(range(5, int(MAX_SECONDS * FPS) + 17, 17))


def is_trained_length(frames):
    return TRAINED_MIN_FRAMES <= int(frames) <= TRAINED_MAX_FRAMES


def frames_for_seconds(seconds):
    """Whole UI seconds -> nearest legal 17n+5 frame count."""
    target = round(float(seconds) * FPS)
    return min(legal_frame_counts(), key=lambda n: (abs(n - target), n))


def seconds_for_frames(frames):
    """The real frame-exact duration for prompt timelines."""
    return float(frames) / FPS


def clamp_ratio(ratio):
    r = float(ratio)
    if r < MIN_RATIO:
        return MIN_RATIO, True
    if r > MAX_RATIO:
        return MAX_RATIO, True
    return r, False


def _snap(value):
    return max(CANVAS_MULTIPLE, int(value / CANVAS_MULTIPLE + 0.5) * CANVAS_MULTIPLE)


def resolve_canvas(ratio, short_edge):
    """(aspect ratio, short edge) -> (width, height) on 32-pixel boundary."""
    r, _ = clamp_ratio(float(ratio))
    edge = max(MIN_SHORT_EDGE, min(MAX_SHORT_EDGE, int(short_edge)))
    max_pixels = NATIVE_MAX_PIXELS * (edge / NATIVE_SHORT_EDGE) ** 2

    if r >= 1.0:
        width, height = edge * r, float(edge)
    else:
        width, height = float(edge), edge / r

    if width * height > max_pixels:
        scale = math.sqrt(max_pixels / (width * height))
        width, height = width * scale, height * scale

    width, height = _snap(width), _snap(height)

    while width * height > max_pixels and max(width, height) > CANVAS_MULTIPLE:
        if width >= height:
            width -= CANVAS_MULTIPLE
        else:
            height -= CANVAS_MULTIPLE

    return width, height


def canvas_from_image(image_width, image_height, short_edge):
    ratio, clamped = clamp_ratio(image_width / image_height)
    width, height = resolve_canvas(ratio, short_edge)
    return width, height, ratio, clamped


def describe_ratio(ratio):
    return min(ASPECT_PRESETS.items(), key=lambda kv: abs(kv[1] - ratio))[0]