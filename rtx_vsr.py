"""NVIDIA RTX Video Super Resolution (VSR) core engine with 16K safety, channel integrity checks, and dependency error handling."""

from __future__ import annotations

import gc
import logging
from dataclasses import dataclass
from math import floor

import torch
import torch.nn.functional as functional

_LOG = logging.getLogger("minimax_creator.rtx_vsr")

try:
    import nvvfx
except ImportError:
    nvvfx = None

ALIGNMENT = 8
MAX_OUTPUT_EDGE = 16384
VERIFIED_VSR_MAX_EDGE = 15360

INSTALL_COMMAND = (
    r".\python.exe -m pip install -U --no-build-isolation nvidia-vfx --index-url https://pypi.nvidia.com"
)


@dataclass(frozen=True)
class DimensionPlan:
    output_width: int
    output_height: int
    vsr_width: int
    vsr_height: int

    @property
    def uses_hybrid_fallback(self) -> bool:
        return (self.output_width, self.output_height) != (self.vsr_width, self.vsr_height)


def _align_nearest(value: int) -> int:
    return max(ALIGNMENT, round(value / ALIGNMENT) * ALIGNMENT)


def _align_down(value: float) -> int:
    return max(ALIGNMENT, floor(value / ALIGNMENT) * ALIGNMENT)


def plan_dimensions(
    input_width: int,
    input_height: int,
    requested_width: int,
    requested_height: int,
) -> DimensionPlan:
    """Plan exact output dimensions aligned to NVIDIA 8px grid."""
    if min(input_width, input_height, requested_width, requested_height) <= 0:
        raise ValueError("Input and output dimensions must be positive integers.")

    output_width = _align_nearest(requested_width)
    output_height = _align_nearest(requested_height)

    if max(output_width, output_height) > MAX_OUTPUT_EDGE:
        raise ValueError(
            f"RTX VSR supports a maximum output edge of {MAX_OUTPUT_EDGE}px. "
            f"Requested {output_width}x{output_height}."
        )

    if output_width < input_width or output_height < input_height:
        raise ValueError(
            f"RTX Video Super Resolution only supports upscaling. "
            f"Input is {input_width}x{input_height}, requested output is {output_width}x{output_height}."
        )

    if max(output_width, output_height) <= VERIFIED_VSR_MAX_EDGE:
        return DimensionPlan(output_width, output_height, output_width, output_height)

    reduction = VERIFIED_VSR_MAX_EDGE / max(output_width, output_height)
    vsr_width = _align_down(output_width * reduction)
    vsr_height = _align_down(output_height * reduction)

    return DimensionPlan(output_width, output_height, vsr_width, vsr_height)


def assert_channel_integrity(input_frame: torch.Tensor, output_frame: torch.Tensor) -> None:
    """Detect single-channel collapse or NaN artifacts."""
    if not torch.isfinite(output_frame).all():
        raise RuntimeError("NVIDIA RTX VSR returned NaN or infinite pixel values.")

    input_sample = input_frame[:, ::max(1, input_frame.shape[1] // 256), ::max(1, input_frame.shape[2] // 256)]
    output_sample = output_frame[:, ::max(1, output_frame.shape[1] // 256), ::max(1, output_frame.shape[2] // 256)]

    source_means = input_sample.float().mean(dim=(1, 2))
    output_means = output_sample.float().mean(dim=(1, 2))

    for channel, name in enumerate(("red", "green", "blue")):
        source_has_signal = source_means[channel] > 0.02
        output_collapsed = output_means[channel] < 0.003
        other_output_has_signal = (
            torch.cat((output_means[:channel], output_means[channel + 1 :])).max() > 0.02
        )
        if bool(source_has_signal and output_collapsed and other_output_has_signal):
            raise RuntimeError(
                f"NVIDIA RTX VSR channel corruption: the {name} channel collapsed from "
                f"mean {source_means[channel].item():.4f} to {output_means[channel].item():.4f}."
            )


def check_nvvfx_installed() -> None:
    """Raises a clean, descriptive error if nvidia-vfx is missing."""
    if nvvfx is None:
        raise RuntimeError(
            "\n" + "=" * 80 + "\n"
            "[MiniMax Creator] NVIDIA RTX Video Super Resolution is not installed.\n"
            "To use RTX AI Upscaling, please install 'nvidia-vfx' in your ComfyUI python environment:\n\n"
            f"    {INSTALL_COMMAND}\n"
            "=" * 80 + "\n"
        )

    if not torch.cuda.is_available():
        raise RuntimeError("[MiniMax Creator] NVIDIA RTX VSR requires an active CUDA GPU device.")


def run_rtx_vsr_upscale(
    images: torch.Tensor,
    scale: float = 2.0,
    target_width: int = 0,
    target_height: int = 0,
    quality: str = "ULTRA",
) -> torch.Tensor:
    """
    Upscale a batch of decoded frames [B, H, W, C] using NVIDIA RTX VSR.
    Returns [B, out_H, out_W, 3] on CPU.
    """
    check_nvvfx_installed()

    if images.ndim != 4:
        raise ValueError(f"Expected IMAGE tensor of shape [B, H, W, C], got {tuple(images.shape)}")

    b, h, w, c = images.shape
    if c != 3:
        raise ValueError(f"RTX VSR requires exactly 3 RGB channels (got {c}).")

    if target_width > 0 and target_height > 0:
        req_w, req_h = target_width, target_height
    else:
        req_w, req_h = int(round(w * scale)), int(round(h * scale))

    plan = plan_dimensions(w, h, req_w, req_h)

    quality_map = {
        "LOW": nvvfx.effects.QualityLevel.LOW,
        "MEDIUM": nvvfx.effects.QualityLevel.MEDIUM,
        "HIGH": nvvfx.effects.QualityLevel.HIGH,
        "ULTRA": nvvfx.effects.QualityLevel.ULTRA,
    }
    selected_quality = quality_map.get(quality.upper(), nvvfx.effects.QualityLevel.ULTRA)

    out_tensor = torch.empty(
        (b, plan.output_height, plan.output_width, 3),
        device="cpu",
        dtype=images.dtype,
    )

    try:
        with nvvfx.VideoSuperRes(selected_quality) as vsr:
            vsr.output_width = plan.vsr_width
            vsr.output_height = plan.vsr_height
            vsr.load()

            for i in range(b):
                frame = images[i, ..., :3].movedim(-1, 0).to(device="cuda", dtype=torch.float32).contiguous()
                result = vsr.run(frame)
                vsr_frame = torch.from_dlpack(result.image).clone()
                del result

                assert_channel_integrity(frame, vsr_frame)

                if plan.uses_hybrid_fallback:
                    vsr_frame = functional.interpolate(
                        vsr_frame.unsqueeze(0),
                        size=(plan.output_height, plan.output_width),
                        mode="bicubic",
                        align_corners=False,
                        antialias=True,
                    ).squeeze(0)

                final_frame = vsr_frame.clamp_(0.0, 1.0).movedim(0, -1)
                out_tensor[i].copy_(final_frame.to(device="cpu", dtype=images.dtype))
                del frame, vsr_frame, final_frame

    finally:
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    return out_tensor