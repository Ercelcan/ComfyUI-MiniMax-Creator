"""Self-contained MiniMax-H3 SPEED Sampler node with VRAM Temporal Slicing & Bidirectional Multi-Scale Flow Alignment.

[v2.1 Fix]:
  1. Strict I2V/FL2V keyframe detection: Only activates keyframe-anchoring if 'minimax_keyframes'
     contains actual keyframe items (len > 0). Reference-to-Video (Ref2VA) references ('minimax_refs')
     are no longer falsely flagged as I2V keyframes.
  2. Full SPEED Acceleration on Ref2VA: Progressive stages (0.5x -> 1.0x or 3-Stage) now run at full
     speed on reference workflows without falling back to full-resolution.
  3. Keyframe-aware progressive sampling for true I2V/FL2V: keyframe latents are rescaled per-stage,
     with safe automatic fallback only if genuine keyframe shape collisions occur.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, replace
from functools import lru_cache
from typing import Any

import torch
import comfy.model_management
import comfy.nested_tensor
import comfy.samplers
import comfy.utils

# ---------------------------------------------------------------------------
# 1. Memory-Efficient DCT Spectral Primitives (Temporal Slicing)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=64)
def _cached_basis(size: int, device_type: str, device_index: int | None) -> torch.Tensor:
    device = torch.device(device_type, device_index)
    sample = torch.arange(size, device=device, dtype=torch.float32) + 0.5
    frequency = torch.arange(size, device=device, dtype=torch.float32).unsqueeze(1)
    basis = torch.cos((math.pi / size) * frequency * sample)
    basis[0] *= math.sqrt(1.0 / size)
    if size > 1:
        basis[1:] *= math.sqrt(2.0 / size)
    return basis


def _basis(size: int, device: torch.Tensor) -> torch.Tensor:
    return _cached_basis(size, device.type, device.index)


def dct2(value: torch.Tensor) -> torch.Tensor:
    """Compute 2D DCT with temporal slicing for long video tensors (prevents OOM)."""
    if value.ndim == 5 and value.shape[2] > 8:
        out = torch.empty_like(value, dtype=torch.float32)
        for t in range(value.shape[2]):
            out[:, :, t] = dct2(value[:, :, t])
        return out

    work = value.float()
    height_basis = _basis(work.shape[-2], work.device)
    width_basis = _basis(work.shape[-1], work.device)
    transformed = torch.matmul(height_basis, work)
    return torch.matmul(transformed, width_basis.transpose(0, 1))


def idct2(coefficients: torch.Tensor) -> torch.Tensor:
    """Compute 2D Inverse DCT with temporal slicing."""
    if coefficients.ndim == 5 and coefficients.shape[2] > 8:
        out = torch.empty_like(coefficients, dtype=torch.float32)
        for t in range(coefficients.shape[2]):
            out[:, :, t] = idct2(coefficients[:, :, t])
        return out

    work = coefficients.float()
    height_basis = _basis(work.shape[-2], work.device)
    width_basis = _basis(work.shape[-1], work.device)
    restored = torch.matmul(height_basis.transpose(0, 1), work)
    return torch.matmul(restored, width_basis)


def lowpass_dct(value: torch.Tensor, target_hw: tuple[int, int]) -> torch.Tensor:
    target_h, target_w = int(target_hw[0]), int(target_hw[1])
    coeffs = dct2(value)
    filtered = coeffs[..., :target_h, :target_w]
    result = idct2(filtered).to(dtype=value.dtype)
    del coeffs, filtered
    return result


def spectral_expand_dct_coupled(value: torch.Tensor, full_resolution_noise: torch.Tensor, sigma: float) -> torch.Tensor:
    source_h, source_w = value.shape[-2:]
    target_noise = full_resolution_noise.to(device=value.device, dtype=value.dtype)
    expanded = dct2(target_noise).float() * float(sigma)
    expanded[..., :source_h, :source_w] = dct2(value).float()
    result = idct2(expanded).to(dtype=value.dtype)
    del expanded, target_noise
    return result


def spectral_expand_dct(value: torch.Tensor, target_hw: tuple[int, int], sigma: float, seed: int) -> torch.Tensor:
    target_h, target_w = int(target_hw[0]), int(target_hw[1])
    source_h, source_w = value.shape[-2:]
    source_coefficients = dct2(value).float()
    generator = torch.Generator(device=value.device).manual_seed(int(seed))
    expanded = torch.randn(value.shape[:-2] + (target_h, target_w), generator=generator, device=value.device, dtype=torch.float32)
    expanded.mul_(float(sigma))
    expanded[..., :source_h, :source_w] = source_coefficients
    result = idct2(expanded).to(dtype=value.dtype)
    del expanded, source_coefficients
    return result


# ---------------------------------------------------------------------------
# 2. Flow & Alignment Math
# ---------------------------------------------------------------------------

def aligned_speed_sigma(sigma: float, resolution_ratio: float) -> tuple[float, float]:
    q = float(sigma)
    ratio = float(resolution_ratio)
    kappa = ratio / (1.0 + (ratio - 1.0) * q)
    return kappa, q * kappa


def time_shift_sigma(sigma: Any, from_shift: float, to_shift: float) -> Any:
    base = sigma / (from_shift + sigma * (1.0 - from_shift))
    return to_shift * base / (1.0 + (to_shift - 1.0) * base)


def recover_internal_state(video_public: torch.Tensor, audio_public: torch.Tensor, sigma: float, audio_scale: float) -> tuple[torch.Tensor, torch.Tensor]:
    clean_weight = 1.0 - sigma
    return video_public * clean_weight, audio_public * audio_scale * clean_weight


def clock_reindex_audio_state(carried_audio: torch.Tensor, clean_carried_audio: torch.Tensor, old_video_sigma: float, new_video_sigma: float, old_audio_sigma: float, new_audio_sigma: float, audio_scale: float) -> torch.Tensor:
    current_native = carried_audio * old_audio_sigma / old_video_sigma
    clean_native = clean_carried_audio / audio_scale
    noise_native = (current_native - (1.0 - old_audio_sigma) * clean_native) / old_audio_sigma
    new_native = ((1.0 - new_audio_sigma) * clean_native + new_audio_sigma * noise_native)
    return new_native * new_video_sigma / new_audio_sigma


def reentry_noise(internal_state: torch.Tensor, start_sigma: float) -> torch.Tensor:
    return internal_state / max(start_sigma, 1e-12)


# ---------------------------------------------------------------------------
# 3. MiniMax H3 Runtime Execution & Keyframe Detection
# ---------------------------------------------------------------------------

def _unpack_tensor(samples: Any) -> tuple[torch.Tensor, torch.Tensor]:
    streams = list(samples.unbind())
    return streams[0], streams[1]


def _pack_tensor(video: torch.Tensor, audio: torch.Tensor) -> Any:
    return comfy.nested_tensor.NestedTensor([video, audio])


def _active_av_shifts(guider: Any) -> tuple[float, float, float]:
    patcher = getattr(guider, "model_patcher", None)
    model = getattr(patcher, "model", None)
    video_shift = getattr(model, "sigma_shift_video", 12.0)
    audio_shift = getattr(model, "sigma_shift_audio", 3.0)
    return float(video_shift), float(audio_shift), float(video_shift) / float(audio_shift)


def _iter_cond_dicts(guider: Any):
    """Yield every conditioning metadata dict reachable from the guider."""
    sources = []
    conds = getattr(guider, "conds", None)
    if isinstance(conds, dict):
        sources.extend(conds.values())

    patcher = getattr(guider, "model_patcher", None)
    p_opts = getattr(patcher, "model_options", None) if patcher is not None else None
    if isinstance(p_opts, dict):
        embedded = p_opts.get("conds")
        if isinstance(embedded, dict):
            sources.extend(embedded.values())

    for entry in sources:
        if isinstance(entry, (list, tuple)):
            for c in entry:
                if isinstance(c, (list, tuple)) and len(c) >= 2 and isinstance(c[1], dict):
                    yield c[1]
        elif isinstance(entry, dict):
            yield entry


def _get_minimax_keyframes(guider: Any) -> list:
    """Return the fl2v/i2v keyframe list attached to the conditioning ([] if none).

    Only returns non-empty lists from 'minimax_keyframes'. References in 'minimax_refs'
    are not keyframes and are never returned here.
    """
    for cd in _iter_cond_dicts(guider):
        kfs = cd.get("minimax_keyframes")
        if isinstance(kfs, (list, tuple)) and len(kfs) > 0:
            return list(kfs)
    return []


# ---------------------------------------------------------------------------
# 3b. Keyframe Rescaling for Progressive I2V/FL2V
# ---------------------------------------------------------------------------

_KF_PAIR_KEYS = (("latent_h", "latent_w"), ("h", "w"), ("height", "width"))


def _resize_latent(z: torch.Tensor, th: int, tw: int) -> torch.Tensor | None:
    if z.ndim != 5:
        return None
    h, w = int(z.shape[-2]), int(z.shape[-1])
    if (h, w) == (th, tw) or h < th or w < tw:
        return None
    return lowpass_dct(z, (th, tw))


def _rescale_value(v: Any, th: int, tw: int) -> tuple[Any, bool]:
    if isinstance(v, torch.Tensor):
        r = _resize_latent(v, th, tw)
        return (r, True) if r is not None else (v, False)
    if isinstance(v, dict):
        changed = False
        nd: dict = {}
        for k2, v2 in v.items():
            nv, c = _rescale_value(v2, th, tw)
            changed = changed or c
            nd[k2] = nv if c else v2
        for hk, wk in _KF_PAIR_KEYS:
            if hk in nd and wk in nd:
                try:
                    if int(nd[hk]) == int(nd[wk]):
                        continue
                except (TypeError, ValueError):
                    continue
        return (nd, True) if changed else (v, False)
    if isinstance(v, list):
        items, changed = [], False
        for item in v:
            ni, c = _rescale_value(item, th, tw)
            changed = changed or c
            items.append(ni if c else item)
        return (items, True) if changed else (v, False)
    if isinstance(v, tuple):
        items, changed = [], False
        for item in v:
            ni, c = _rescale_value(item, th, tw)
            changed = changed or c
            items.append(ni if c else item)
        return (tuple(items), True) if changed else (v, False)
    return v, False


def _rescale_keyframes(kfs: list, th: int, tw: int) -> list | None:
    out, changed = [], False
    for kf in kfs:
        nkf, c = _rescale_value(kf, th, tw)
        changed = changed or c
        out.append(nkf if c else kf)
    return out if changed else None


def _make_stage_keyframe_swapper(guider: Any, stage_hw_list: list, full_h: int, full_w: int) -> dict | None:
    conds = getattr(guider, "conds", None)
    if not isinstance(conds, dict):
        return None

    def _build_variant(th: int, tw: int) -> dict | None:
        new_conds: dict = {}
        for name in ("positive", "negative"):
            entry = conds.get(name)
            if not entry:
                continue
            entry_list = entry if isinstance(entry, (list, tuple)) else [entry]
            out_entries, hit = [], False
            for c in entry_list:
                if isinstance(c, (list, tuple)) and len(c) >= 2 and isinstance(c[1], dict):
                    cd = c[1]
                    kfs = cd.get("minimax_keyframes")
                    if isinstance(kfs, (list, tuple)) and kfs:
                        hit = True
                        ncd = dict(cd)
                        resized = _rescale_keyframes(list(kfs), th, tw)
                        ncd["minimax_keyframes"] = resized if resized is not None else kfs
                        rebuilt = [c[0], ncd] + (list(c[2:]) if isinstance(c, list) else [])
                        out_entries.append(rebuilt)
                    else:
                        out_entries.append(list(c) if isinstance(c, (list, tuple)) else c)
                else:
                    out_entries.append(c)
            if hit:
                new_conds[name] = out_entries
        return new_conds or None

    full_key = (int(full_h), int(full_w))
    variants: dict = {}
    for hw in stage_hw_list:
        key = (int(hw[0]), int(hw[1]))
        if key == full_key or key in variants:
            continue
        variants[key] = _build_variant(*key)

    if not any(variants.values()):
        return None

    saved: dict = {}

    def push(hw) -> None:
        key = (int(hw[0]), int(hw[1]))
        if key == full_key:
            return
        v = variants.get(key)
        if not v:
            return
        for n, e in v.items():
            if n not in saved:
                saved[n] = conds.get(n)
            conds[n] = e

    def pop() -> None:
        for n, e in list(saved.items()):
            conds[n] = e
        saved.clear()

    def cleanup() -> None:
        pop()
        variants.clear()

    return {"push": push, "pop": pop, "cleanup": cleanup}


@dataclass(frozen=True)
class SpeedConfig:
    scales: tuple[float, ...] = (0.5, 1.0)
    transition_steps: tuple[int, ...] = (5,)
    noise_policy: str = "direct_coarse"
    transition_seed_offset: int = 10_000
    full_latent_h: int = 45
    full_latent_w: int = 80


def run_progressive_stages(
    noise: Any,
    guider: Any,
    sigmas: torch.Tensor,
    latent: dict,
    config: SpeedConfig,
    *,
    sampler: Any,
    nested_type: Any,
    disable_pbar: bool = True,
    output_device: Any = None,
    swapper: dict | None = None
) -> tuple[dict, dict]:
    samples = latent.get("samples")
    full_video, full_audio = _unpack_tensor(samples)
    video_shift, audio_shift, audio_scale = _active_av_shifts(guider)

    scales = config.scales
    transition_steps = config.transition_steps
    n_stages = len(scales)

    full_h, full_w = full_video.shape[-2:]
    stage_hw = [(max(2, round(full_h * s)), max(2, round(full_w * s))) for s in scales]

    s0_h, s0_w = stage_hw[0]

    # Stage 0 Initialization
    if s0_h == full_h and s0_w == full_w:
        coarse_samples = _pack_tensor(full_video.clone(), torch.zeros_like(full_audio))
        cur_latent = latent.copy()
        cur_latent["samples"] = coarse_samples
        coarse_noise = noise.generate_noise(cur_latent) if hasattr(noise, "generate_noise") else cur_latent["samples"]
        full_noise_video = None
        if config.noise_policy == "coupled_full_grid":
            full_noise = noise.generate_noise(latent) if hasattr(noise, "generate_noise") else noise
            full_noise_v, _ = _unpack_tensor(full_noise)
            full_noise_video = full_noise_v.cpu()
            del full_noise, full_noise_v
    else:
        init_video = lowpass_dct(full_video, (s0_h, s0_w)) if torch.count_nonzero(full_video) > 0 else full_video.new_zeros(full_video.shape[:-2] + (s0_h, s0_w))
        coarse_samples = _pack_tensor(init_video, torch.zeros_like(full_audio))
        cur_latent = latent.copy()
        cur_latent["samples"] = coarse_samples

        if config.noise_policy == "coupled_full_grid":
            full_noise = noise.generate_noise(latent) if hasattr(noise, "generate_noise") else noise
            full_noise_v, full_noise_audio = _unpack_tensor(full_noise)
            full_noise_video = full_noise_v.cpu()
            coarse_noise = _pack_tensor(lowpass_dct(full_noise_v, (s0_h, s0_w)), full_noise_audio)
            del full_noise, full_noise_v
        else:
            coarse_noise = noise.generate_noise(cur_latent) if hasattr(noise, "generate_noise") else cur_latent["samples"]
            full_noise_video = None

    current_sigmas = sigmas
    stage_start_pub = coarse_noise
    stage_start_latent = cur_latent["samples"]
    last_public = None
    last_capture: dict[str, Any] = {}

    seed = getattr(noise, "seed", None)

    try:
        for stage_idx in range(n_stages - 1):
            boundary = min(int(transition_steps[stage_idx]), len(current_sigmas) - 2)
            stage_sigmas = current_sigmas[: boundary + 1]

            def callback(step: int, x0: Any, x: Any, total_steps: int) -> None:
                last_capture["x0"] = x0
                last_capture["x"] = x

            comfy.model_management.soft_empty_cache()

            if swapper is not None:
                swapper["push"](stage_hw[stage_idx])
            try:
                public = guider.sample(
                    stage_start_pub, stage_start_latent, sampler, stage_sigmas,
                    callback=callback, disable_pbar=disable_pbar, seed=seed
                )
            finally:
                if swapper is not None:
                    swapper["pop"]()

            last_public = public
            public_video, public_audio = _unpack_tensor(public)
            q = float(current_sigmas[boundary])

            internal_video, internal_audio = recover_internal_state(public_video, public_audio, q, audio_scale)
            ratio = scales[stage_idx + 1] / scales[stage_idx]
            kappa, new_q = aligned_speed_sigma(q, ratio)

            next_hw = stage_hw[stage_idx + 1]

            if ratio < 1.0:
                lowpass_video = lowpass_dct(internal_video, next_hw)
                transitioned_video = lowpass_video * kappa
                del lowpass_video
            else:
                if config.noise_policy == "coupled_full_grid" and full_noise_video is not None:
                    expanded_video = spectral_expand_dct_coupled(internal_video, full_noise_video, q)
                else:
                    seed_val = (int(seed) if seed is not None else 0) + int(config.transition_seed_offset) + stage_idx
                    expanded_video = spectral_expand_dct(internal_video, next_hw, q, seed_val)
                transitioned_video = expanded_video * kappa
                del expanded_video

            old_audio_sigma = time_shift_sigma(q, video_shift, audio_shift)
            new_audio_sigma = time_shift_sigma(new_q, video_shift, audio_shift)

            if "x0" in last_capture:
                _, clean_audio = _unpack_tensor(last_capture["x0"])
                transitioned_audio = clock_reindex_audio_state(internal_audio, clean_audio, q, new_q, old_audio_sigma, new_audio_sigma, audio_scale)
            else:
                transitioned_audio = internal_audio

            next_sigmas = torch.cat([current_sigmas.new_tensor([new_q]), current_sigmas[boundary + 1:]], dim=0)
            stage_start_pub = _pack_tensor(reentry_noise(transitioned_video, new_q), reentry_noise(transitioned_audio, new_q))
            stage_start_latent = _pack_tensor(torch.zeros_like(transitioned_video), torch.zeros_like(transitioned_audio))
            current_sigmas = next_sigmas

            del public, internal_video, internal_audio, transitioned_video
            comfy.model_management.soft_empty_cache()

        def final_callback(step: int, x0: Any, x: Any, total_steps: int) -> None:
            last_capture["x0"] = x0
            last_capture["x"] = x

        comfy.model_management.soft_empty_cache()

        final_public = guider.sample(
            stage_start_pub, stage_start_latent, sampler, current_sigmas,
            callback=final_callback, disable_pbar=disable_pbar, seed=seed
        )
        last_public = final_public
    finally:
        if swapper is not None:
            swapper["pop"]()

    out = latent.copy()
    out.pop("downscale_ratio_spacial", None)
    out.pop("downscale_ratio_temporal", None)
    out["samples"] = last_public

    denoised = out
    if "x0" in last_capture:
        x0 = last_capture["x0"]
        if getattr(x0, "is_nested", False):
            x0_streams = list(x0.unbind())
            x0_video = next((s for s in x0_streams if s.ndim == 5), None)
            if x0_video is not None:
                x0 = x0_video
        denoised = latent.copy()
        denoised["samples"] = guider.model_patcher.model.process_latent_out(x0.cpu() if hasattr(x0, "cpu") else x0)

    del stage_start_pub, stage_start_latent
    comfy.model_management.soft_empty_cache()

    return out, denoised


# ---------------------------------------------------------------------------
# 4. Adaptive Sampler Node Interface & Fuzzy Preset Matching
# ---------------------------------------------------------------------------

PRESET_MAPPING = {
    "Half -> Full (0.5x -> 1.0x) [Balanced / Recommended]": {
        "scales": (0.5, 1.0),
        "ratios": (0.25,),
    },
    "Three-Quarter -> Full (0.75x -> 1.0x) [Fast]": {
        "scales": (0.75, 1.0),
        "ratios": (0.50,),
    },
    "Quarter -> Half -> Full (3-Stage) [High Detail]": {
        "scales": (0.25, 0.5, 1.0),
        "ratios": (0.15, 0.25),
    },
    "Quarter -> 3/4 -> Full (Aggressive)": {
        "scales": (0.25, 0.75, 1.0),
        "ratios": (0.15, 0.40),
    },
    "Quarter -> Half -> 3/4 -> Full (4-Stage) [Slow / Quality]": {
        "scales": (0.25, 0.5, 0.75, 1.0),
        "ratios": (0.15, 0.25, 0.40),
    },
}

MODE_AUTO_I2V = "Auto (I2V: Progressive + Safe Fallback)"
MODE_FORCE_PROG = "Force Progressive (T2V / Reference)"
MODE_FULL_RES = "Full Resolution (I2V Keyframes)"

_SAMPLING_MODES = (MODE_AUTO_I2V, MODE_FORCE_PROG, MODE_FULL_RES)


def _normalize_sampling_mode(mode: str) -> str:
    clean = re.sub(r"[^a-z0-9]", "", str(mode).lower())
    if "force" in clean:
        return MODE_FORCE_PROG
    if "full" in clean:
        return MODE_FULL_RES
    return MODE_AUTO_I2V


def get_preset_info(name: str) -> dict:
    if name in PRESET_MAPPING:
        return PRESET_MAPPING[name]

    clean = re.sub(r"[^a-z0-9]", "", str(name).lower())

    for k, v in PRESET_MAPPING.items():
        if clean == re.sub(r"[^a-z0-9]", "", k.lower()):
            return v

    if "quarter" in clean and "half" in clean and "full" in clean:
        return PRESET_MAPPING["Quarter -> Half -> Full (3-Stage) [High Detail]"]
    if "quarter" in clean and "34" in clean:
        return PRESET_MAPPING["Quarter -> 3/4 -> Full (Aggressive)"]
    if "4stage" in clean or "four" in clean:
        return PRESET_MAPPING["Quarter -> Half -> 3/4 -> Full (4-Stage) [Slow / Quality]"]
    if "threequarter" in clean or "075" in clean or "34" in clean:
        return PRESET_MAPPING["Three-Quarter -> Full (0.75x -> 1.0x) [Fast]"]

    return PRESET_MAPPING["Half -> Full (0.5x -> 1.0x) [Balanced / Recommended]"]


def calculate_adaptive_steps(preset_name: str, total_steps: int, coarse_override: int = 0) -> tuple[tuple[float, ...], tuple[int, ...]]:
    preset_info = get_preset_info(preset_name)
    scales, ratios = preset_info["scales"], preset_info["ratios"]
    n_transitions = len(scales) - 1

    if total_steps <= 1:
        return (1.0,), ()

    if coarse_override > 0 and n_transitions == 1:
        step = max(1, min(total_steps - 1, int(coarse_override)))
        return scales, (step,)

    steps = []
    last_step = 0
    for i, ratio in enumerate(ratios):
        target = round(total_steps * ratio)
        min_allowed = last_step + 1
        max_allowed = total_steps - (n_transitions - i)
        step = max(min_allowed, min(max_allowed, target))
        steps.append(step)
        last_step = step

    return scales, tuple(steps)


class MiniMaxH3SPEEDSampler:
    """All-in-one SPEED progressive-resolution sampler for MiniMax-H3."""

    DESCRIPTION = (
        "SPEED progressive-resolution sampler for MiniMax-H3. Denoises initial layout "
        "at lower resolution or native anchor, then DCT-expands to full resolution for crisp details. "
        "Supports Turbo LoRAs (4, 6, 8 steps) and standard schedules (20+ steps). "
        "Fully accelerated across T2VA, Ref2VA (Reference videos), and keyframed I2VA/FL2VA."
    )
    RETURN_TYPES = ("LATENT", "LATENT")
    RETURN_NAMES = ("output", "denoised_output")
    FUNCTION = "sample"
    CATEGORY = "sampling/minimax_h3_speed"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "noise": ("NOISE",),
                "guider": ("GUIDER",),
                "sigmas": ("SIGMAS",),
                "latent_image": ("LATENT",),
                "preset": (list(PRESET_MAPPING.keys()), {
                    "default": "Half -> Full (0.5x -> 1.0x) [Balanced / Recommended]"
                }),
                "coarse_steps_override": ("INT", {
                    "default": 0, "min": 0, "max": 50, "step": 1,
                    "tooltip": "Manual coarse steps for Turbo LoRAs (e.g. 1 or 2). Set 0 for auto."
                }),
                "sampling_mode": (list(_SAMPLING_MODES), {
                    "default": MODE_AUTO_I2V,
                    "tooltip": "Auto: detects I2V keyframes, uses progressive with rescaled keyframe conditioning, falls back to full-res only on error. Force: always progressive. Full Res: single-stage pass."
                }),
                "noise_policy": (["direct_coarse", "coupled_full_grid"], {
                    "default": "direct_coarse",
                    "tooltip": "Use 'direct_coarse' for lowest VRAM usage (recommended for video references)."
                }),
                "seed_offset": ("INT", {"default": 10000, "min": 0, "max": 2**31 - 1}),
            },
        }

    @staticmethod
    def _is_recoverable_mismatch(err: Exception) -> bool:
        msg = str(err).lower()
        patterns = (
            "cannot be broadcast",
            "shape mismatch",
            "size mismatch",
            "must match the size",
            "shapes at dim",
            "invalid shape",
        )
        return any(p in msg for p in patterns)

    def sample(
        self,
        noise,
        guider,
        sigmas,
        latent_image,
        preset,
        coarse_steps_override=0,
        sampling_mode="Auto",
        noise_policy="direct_coarse",
        seed_offset=10000
    ):
        total_steps = len(sigmas) - 1
        if total_steps < 1:
            raise ValueError("Sigmas schedule must contain at least 1 step.")

        full_video, _ = _unpack_tensor(latent_image.get("samples"))
        full_h, full_w = int(full_video.shape[-2]), int(full_video.shape[-1])

        # Strict Keyframe Detection: Only true I2V/FL2V with minimax_keyframes
        keyframes = _get_minimax_keyframes(guider)
        has_pixel_anchor = len(keyframes) > 0

        mode = _normalize_sampling_mode(sampling_mode)

        if mode == MODE_FULL_RES:
            force_full = True
        else:
            force_full = False

        if force_full:
            scales = (1.0,)
            transition_steps = ()
            print("[SPEED Sampler] Mode 'Full Resolution': single-stage pass.")
        elif has_pixel_anchor and mode == MODE_AUTO_I2V:
            scales, transition_steps = calculate_adaptive_steps(
                preset_name=preset, total_steps=total_steps, coarse_override=coarse_steps_override
            )
            breakdown = []
            start = 0
            for i, s in enumerate(scales[:-1]):
                end = transition_steps[i]
                breakdown.append(f"{end - start} steps @ {int(s*100)}%")
                start = end
            breakdown.append(f"{total_steps - start} steps @ {int(scales[-1]*100)}%")
            print(f"[SPEED Sampler] Preset: '{preset}'")
            print(f"[SPEED Sampler] I2V keyframes detected ({len(keyframes)}). Progressive Plan (keyframe-rescaled): {' -> '.join(breakdown)}")
        elif has_pixel_anchor and mode == MODE_FORCE_PROG:
            scales, transition_steps = calculate_adaptive_steps(
                preset_name=preset, total_steps=total_steps, coarse_override=coarse_steps_override
            )
            print(f"[SPEED Sampler] Preset: '{preset}' (Force Progressive with {len(keyframes)} keyframes)")
        else:
            # T2V or Reference2Video (Ref2VA) -> Clean Progressive Execution
            scales, transition_steps = calculate_adaptive_steps(
                preset_name=preset, total_steps=total_steps, coarse_override=coarse_steps_override
            )
            breakdown = []
            start = 0
            for i, s in enumerate(scales[:-1]):
                end = transition_steps[i]
                breakdown.append(f"{end - start} steps @ {int(s*100)}%")
                start = end
            breakdown.append(f"{total_steps - start} steps @ {int(scales[-1]*100)}%")
            print(f"[SPEED Sampler] Preset: '{preset}'")
            print(f"[SPEED Sampler] Progressive Plan: {' -> '.join(breakdown)}")

        config = SpeedConfig(
            scales=scales,
            transition_steps=transition_steps,
            noise_policy=noise_policy,
            transition_seed_offset=int(seed_offset),
            full_latent_h=full_h,
            full_latent_w=full_w,
        )

        common_kwargs = dict(
            sampler=comfy.samplers.sampler_object("euler"),
            nested_type=comfy.nested_tensor.NestedTensor,
            disable_pbar=not comfy.utils.PROGRESS_BAR_ENABLED,
            output_device=None,
        )

        multi_stage = len(scales) > 1

        # Only build swapper when actual keyframes exist (I2V / FL2V)
        swapper = None
        if has_pixel_anchor and multi_stage:
            stage_hw_list = [(max(2, round(full_h * s)), max(2, round(full_w * s))) for s in scales]
            swapper = _make_stage_keyframe_swapper(guider, stage_hw_list, full_h, full_w)
            if swapper is None:
                print("[SPEED Sampler] WARNING: keyframes detected but no rescalable keyframe latents found "
                      "-> switching to Full-Resolution safety mode.")
                config = replace(config, scales=(1.0,), transition_steps=())
                multi_stage = False

        if not multi_stage:
            return run_progressive_stages(noise, guider, sigmas, latent_image, config, **common_kwargs)

        try:
            return run_progressive_stages(
                noise, guider, sigmas, latent_image, config,
                swapper=swapper, **common_kwargs
            )
        except Exception as err:
            if not self._is_recoverable_mismatch(err):
                raise
            print(f"[SPEED Sampler] Progressive attempt encountered shape mismatch ({err}) -> running full-resolution fallback.")
            comfy.model_management.soft_empty_cache()
            fallback_config = replace(config, scales=(1.0,), transition_steps=())
            return run_progressive_stages(noise, guider, sigmas, latent_image, fallback_config, **common_kwargs)
        finally:
            if swapper is not None:
                swapper["cleanup"]()


NODE_CLASS_MAPPINGS = {"MiniMaxH3SPEEDSampler": MiniMaxH3SPEEDSampler}
NODE_DISPLAY_NAME_MAPPINGS = {"MiniMaxH3SPEEDSampler": "MiniMax H3 SPEED — Progressive Sampler"}