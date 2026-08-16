"""MiniMax H3 temporal-grid, frame run, and AV clock timing math."""

FPS = 24.0
AUDIO_HZ = 40.0
AUDIO_LATENT_HZ = 40
FRAME_PER_TOKEN = (1, 4, 4, 4, 4)

# Valid seam feather runs on the H3 video-VAE grid
FEATHER_GRID = (1, 5, 22, 39, 56, 90)


def pixel_frames_to_latent_t(frames: int) -> int:
    """Map pixel frame count to latent temporal steps (5->2, 22->7, 39->12, ...)."""
    n = int(frames)
    if n < 5:
        return 2
    return 2 + 5 * ((n - 5) // 17)


def latent_t_to_pixel_frames(latent_t: int) -> int:
    """Calculate pixel frames covered by latent_t temporal steps."""
    return sum(FRAME_PER_TOKEN[k % 5] for k in range(int(latent_t)))


def largest_h3_video_run(frames: int) -> int:
    """Find the largest exact full-run video-VAE input <= frames: 5, 22, 39, 56, ..."""
    n = int(frames)
    if n < 5:
        return 0
    return 5 + ((n - 5) // 17) * 17


def is_h3_video_run(frames: int) -> bool:
    """True for native full H3 video-VAE runs (5, 22, 39, 56, ...)."""
    n = int(frames)
    return n >= 5 and (n - 5) % 17 == 0


def is_exact_av_boundary(frames: int) -> bool:
    """True when a 24-fps frame boundary lands exactly on H3's 40-Hz audio grid."""
    return (int(frames) * int(AUDIO_HZ)) % int(FPS) == 0


def video_runs_through(limit: int = 243):
    """Generate all valid H3 video-VAE runs up to limit."""
    n = 5
    out = []
    while n <= int(limit):
        out.append(n)
        n += 17
    return out


def preferred_av_runs_through(limit: int = 243):
    """Native H3 runs whose endpoint also lands exactly on the 40Hz audio clock."""
    return [n for n in video_runs_through(limit) if is_exact_av_boundary(n)]


def crossfade_plan(context_frames: int, requested_crossfade: int):
    """Return (frames_to_drop_before_blend, effective_overlap)."""
    n = max(0, int(context_frames))
    effective = min(n, max(0, int(requested_crossfade)))
    return n - effective, effective