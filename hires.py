"""The neural latent upscaler, refine pass engine, and NVIDIA RTX VSR pixel upscaler for MiniMax H3.

Handles:
- Loading 2D and 3D neural latent upscaler weights from models/latent_upscale_models/
- Dynamic architecture detection (2D vs 3D, arbitrary temporal kernels, channel dimensions)
- Safe unbinding & repacking of ComfyUI NestedTensors (Video + Audio) with device synchronization
- High-fidelity 2nd-pass refinement with custom denoise, steps, and Turbo LoRA overrides
- Deep in-place VRAM cleaning, model eviction & CUDA cache flushing
- Standalone MinimaxH3LatentUpscaler3D node + MiniMaxH3RefinePass + RTX VSR
"""

from __future__ import annotations

import gc
import glob
import os
import re
from enum import Enum
from typing import Any, TypedDict
import torch
import torch.nn as nn
import torch.nn.functional as F
from einops import rearrange

import folder_paths
import comfy.model_management as mm
import comfy.nested_tensor
import comfy.sample
import comfy.samplers
import comfy.utils
import latent_preview
from comfy_api.latest import io

from . import rtx_vsr

# ==========================================
# Register Model Folder
# ==========================================
LATENT_UPSCALE_FOLDER = "latent_upscale_models"
if LATENT_UPSCALE_FOLDER not in folder_paths.folder_names_and_paths:
    folder_paths.add_model_folder_path(
        LATENT_UPSCALE_FOLDER,
        os.path.join(folder_paths.models_dir, LATENT_UPSCALE_FOLDER)
    )

VAE_DOWNSAMPLE = 16

# ==========================================
# MiniMax H3 24-Channel Latent Statistics
# ==========================================
LATENTS_MEAN = [
    0.858090341091156, -0.9606591463088989, 1.0661640167236328, -0.5090325474739075,
    -0.2727581858634949, -1.3675414323806763, -0.2553254961967468, -0.26907554268836975,
    -0.5376840829849243, -0.0464097298681736, 0.6657370328903198, 0.19690127670764923,
    -0.5460608005523682, -0.4035342037677765, -0.23683024942874908, 0.25928452610969543,
    -0.30133944749832153, 0.211341992020607, -1.1206848621368408, 0.3581933379173279,
    -0.04225143790245056, 0.2604829967021942, 0.22864092886447906, 0.7056031823158264
]
LATENTS_STD = [
    1.2223774194717407, 1.2767263650894165, 1.6831774711608887, 1.7549455165863037,
    1.5636216402053833, 2.194143533706665, 0.9653137922286987, 1.0569885969161987,
    0.841948926448822, 0.7729952931404114, 1.8955937623977661, 0.946841835975647,
    0.7996809482574463, 0.44988900423049927, 0.7197399735450745, 0.6936293244361877,
    2.961095094680786, 2.7694199085235596, 3.0496184825897217, 2.1088054180145264,
    3.276226282119751, 3.1627357006073, 2.2816812992095947, 2.6127843856811523
]


def _make_norm_tensors(device: torch.device, dtype: torch.dtype) -> tuple[torch.Tensor, torch.Tensor]:
    mean = torch.tensor(LATENTS_MEAN, dtype=dtype, device=device).view(1, -1, 1, 1, 1)
    std = torch.tensor(LATENTS_STD, dtype=dtype, device=device).view(1, -1, 1, 1, 1)
    return mean, std


def normalization(channels: int) -> nn.GroupNorm:
    return nn.GroupNorm(32, channels)


def zero_module(module: nn.Module) -> nn.Module:
    for p in module.parameters():
        p.detach().zero_()
    return module


def clean_gpu_vram() -> None:
    """Flushes GPU VRAM cache, evicts temporary upscaler models, and forces ComfyUI model management to reclaim memory."""
    for k, up_m in list(MODEL_CACHE.items()):
        try:
            up_m.to("cpu")
        except Exception:
            pass
    MODEL_CACHE.clear()
    gc.collect()
    if torch.cuda.is_available():
        try:
            dev = mm.get_torch_device()
            mm.free_memory(25 * (1024 ** 3), dev)
        except Exception:
            pass
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()
        try:
            mm.soft_empty_cache()
        except Exception:
            pass


# ==========================================
# 3D Network Components & Dynamic Backbone
# ==========================================
class AttnBlock3D(nn.Module):
    def __init__(self, in_channels: int):
        super().__init__()
        self.norm = normalization(in_channels)
        self.q = nn.Conv3d(in_channels, in_channels, 1)
        self.k = nn.Conv3d(in_channels, in_channels, 1)
        self.v = nn.Conv3d(in_channels, in_channels, 1)
        self.proj_out = nn.Conv3d(in_channels, in_channels, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.norm(x)
        q = rearrange(self.q(h), "b c t h w -> b 1 (t h w) c")
        k = rearrange(self.k(h), "b c t h w -> b 1 (t h w) c")
        v = rearrange(self.v(h), "b c t h w -> b 1 (t h w) c")
        h = F.scaled_dot_product_attention(q, k, v)
        h = rearrange(h, "b 1 (t h w) c -> b c t h w", t=x.shape[2], h=x.shape[3], w=x.shape[4])
        return x + self.proj_out(h)


class ResBlockEmb3D(nn.Module):
    def __init__(self, channels: int, emb_channels: int, dropout: float = 0, out_channels: int | None = None):
        super().__init__()
        self.out_channels = out_channels or channels
        self.in_layers = nn.Sequential(
            normalization(channels), nn.SiLU(),
            nn.Conv3d(channels, self.out_channels, 3, padding=1),
        )
        self.emb_layers = nn.Sequential(
            nn.SiLU(), nn.Linear(emb_channels, 2 * self.out_channels),
        )
        self.out_norm = normalization(self.out_channels)
        self.out_layers = nn.Sequential(
            nn.SiLU(), nn.Dropout(p=dropout),
            zero_module(nn.Conv3d(self.out_channels, self.out_channels, 3, padding=1)),
        )
        self.skip = (
            nn.Conv3d(channels, self.out_channels, 1)
            if self.out_channels != channels else nn.Identity()
        )

    def forward(self, x: torch.Tensor, emb: torch.Tensor) -> torch.Tensor:
        h = self.in_layers(x)
        emb_out = self.emb_layers(emb).type(h.dtype)
        while len(emb_out.shape) < len(h.shape):
            emb_out = emb_out[..., None]
        scale, shift = torch.chunk(emb_out, 2, dim=1)
        h = self.out_norm(h) * (1 + scale) + shift
        h = self.out_layers(h)
        return self.skip(x) + h


class TemporalConv(nn.Module):
    def __init__(self, channels: int, kernel_size: int = 5):
        super().__init__()
        padding = kernel_size // 2
        self.norm = normalization(channels)
        self.dwconv = nn.Conv3d(channels, channels,
                                kernel_size=(kernel_size, 1, 1),
                                padding=(padding, 0, 0),
                                groups=channels)
        self.pwconv = nn.Conv3d(channels, channels, kernel_size=1)
        nn.init.zeros_(self.pwconv.weight)
        nn.init.zeros_(self.pwconv.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        identity = x
        h = self.norm(x)
        h = F.silu(h)
        h = self.dwconv(h)
        h = self.pwconv(h)
        return identity + h


class LatentResizer3D(nn.Module):
    def __init__(self, in_channels: int = 24, in_blocks: int = 12, out_blocks: int = 12,
                 channels: int = 512, dropout: float = 0.1, attn: bool = False,
                 temporal_every: int = 2, temporal_kernel: int = 5):
        super().__init__()
        self.conv_in = nn.Conv3d(in_channels, channels, 3, padding=1)
        embed_dim = 64
        self.embed = nn.Sequential(
            nn.Linear(1, embed_dim), nn.SiLU(), nn.Linear(embed_dim, embed_dim))

        self.in_blocks = nn.ModuleList()
        for b in range(in_blocks):
            if (b == 1 or b == in_blocks - 1) and attn:
                self.in_blocks.append(AttnBlock3D(channels))
            self.in_blocks.append(ResBlockEmb3D(channels, embed_dim, dropout))
            if temporal_every > 0 and b % temporal_every == 0:
                self.in_blocks.append(TemporalConv(channels, temporal_kernel))

        self.out_blocks = nn.ModuleList()
        for b in range(out_blocks):
            if (b == 1 or b == out_blocks - 1) and attn:
                self.out_blocks.append(AttnBlock3D(channels))
            self.out_blocks.append(ResBlockEmb3D(channels, embed_dim, dropout))
            if temporal_every > 0 and b % temporal_every == 0:
                self.out_blocks.append(TemporalConv(channels, temporal_kernel))

        self.norm_out = normalization(channels)
        self.conv_out = nn.Conv3d(channels, in_channels, 3, padding=1)

    def forward(self, x: torch.Tensor, scale: float | None = None, target_size: tuple[int, int, int] | None = None) -> torch.Tensor:
        if target_size is not None:
            size = target_size
        elif scale is not None:
            size = tuple(int(round(s * scale)) for s in x.shape[-3:])
        else:
            return x

        if size == x.shape[-3:]:
            return x

        scale_emb = torch.tensor(
            [scale - 1 if scale is not None else 0.0],
            dtype=x.dtype, device=x.device).unsqueeze(0)
        emb = self.embed(scale_emb)

        x = self.conv_in(x)
        for b in self.in_blocks:
            if isinstance(b, ResBlockEmb3D):
                emb_t = emb.expand(x.shape[0], -1)
                x = b(x, emb_t)
            else:
                x = b(x)

        x = F.interpolate(x, size=size, mode="trilinear", align_corners=False)

        for b in self.out_blocks:
            if isinstance(b, ResBlockEmb3D):
                emb_t = emb.expand(x.shape[0], -1)
                x = b(x, emb_t)
            else:
                x = b(x)

        x = self.norm_out(x)
        x = F.silu(x)
        x = self.conv_out(x)
        return x


# ==========================================
# Dynamic Model Loader & Cache
# ==========================================
MODEL_CACHE: dict[str, LatentResizer3D] = {}


def list_latent_upscale_models() -> list[str]:
    files = []
    try:
        model_dir = folder_paths.get_folder_paths(LATENT_UPSCALE_FOLDER)[0]
        for ext in ("*.safetensors", "*.pth"):
            files.extend(glob.glob(os.path.join(model_dir, ext)))
    except Exception:
        pass
    return sorted(os.path.basename(f) for f in files)


def _load_raw_sd(path: str) -> dict:
    if path.endswith(".safetensors"):
        from safetensors.torch import load_file
        sd = load_file(path, device="cpu")
    else:
        sd = torch.load(path, map_location="cpu", weights_only=False)
    if isinstance(sd, dict) and "model" in sd:
        sd = sd["model"]
    return {k: v.to(torch.float16) if v.dtype == torch.float8_e4m3fn else v for k, v in sd.items()}


def _extract_upscaler_sd(sd: dict) -> dict:
    if any(k.startswith("upscaler.") for k in sd):
        return {k[len("upscaler."):]: v for k, v in sd.items() if k.startswith("upscaler.")}
    return sd


def _detect_arch(sd: dict) -> dict:
    cfg = {
        "in_channels": 24, "in_blocks": 12, "out_blocks": 12, "channels": 512,
        "dropout": 0.1, "attn": False, "temporal_every": 2, "temporal_kernel": 5,
    }
    conv_key = "conv_in.weight"
    if conv_key in sd:
        cfg["in_channels"] = sd[conv_key].shape[1]
        cfg["channels"] = sd[conv_key].shape[0]

    in_ids, out_ids = set(), set()
    temporal_in_indices, temporal_out_indices = set(), set()
    for k in sd.keys():
        m = re.match(r"in_blocks\.(\d+)\.in_layers\.", k)
        if m: in_ids.add(int(m.group(1)))
        m = re.match(r"out_blocks\.(\d+)\.in_layers\.", k)
        if m: out_ids.add(int(m.group(1)))
        m = re.match(r"in_blocks\.(\d+)\.dwconv\.weight", k)
        if m: temporal_in_indices.add(int(m.group(1)))
        m = re.match(r"out_blocks\.(\d+)\.dwconv\.weight", k)
        if m: temporal_out_indices.add(int(m.group(1)))

    if in_ids: cfg["in_blocks"] = len(in_ids)
    if out_ids: cfg["out_blocks"] = len(out_ids)

    if temporal_in_indices or temporal_out_indices:
        cfg["temporal_every"] = 2
        for k in sd.keys():
            if "dwconv.weight" in k and k.endswith("dwconv.weight"):
                cfg["temporal_kernel"] = sd[k].shape[2]
                break
    else:
        cfg["temporal_every"] = 0

    cfg["attn"] = False  # force off at inference for stability/speed
    return cfg


def load_upscaler_model(model_name: str, device: torch.device, precision: str = "fp16") -> LatentResizer3D:
    cache_key = f"{model_name}::{device}::{precision}"
    if cache_key in MODEL_CACHE:
        return MODEL_CACHE[cache_key]

    model_dir = folder_paths.get_folder_paths(LATENT_UPSCALE_FOLDER)[0]
    path = os.path.join(model_dir, model_name)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Latent upscaler model not found: {path}")

    raw_sd = _load_raw_sd(path)
    up_sd = _extract_upscaler_sd(raw_sd)
    cfg = _detect_arch(up_sd)

    model = LatentResizer3D(
        in_channels=cfg["in_channels"], in_blocks=cfg["in_blocks"], out_blocks=cfg["out_blocks"],
        channels=cfg["channels"], dropout=cfg["dropout"], attn=cfg["attn"],
        temporal_every=cfg["temporal_every"], temporal_kernel=cfg["temporal_kernel"],
    )
    model.load_state_dict(up_sd, strict=True)
    dtype = {"fp32": torch.float32, "fp16": torch.float16, "bf16": torch.bfloat16}.get(precision, torch.float16)
    model = model.to(device).eval().requires_grad_(False)
    if dtype != torch.float32:
        model = model.to(dtype)

    MODEL_CACHE[cache_key] = model
    return model


def upscale_video_latent_tensor(video: torch.Tensor, width: int, height: int,
                                model_name: str = "", scale: float = 2.0,
                                device: str = "cuda", precision: str = "fp16") -> torch.Tensor:
    """Upscales video latent [B, C, T, H, W] using neural upscaler or bicubic fallback with in-place VRAM math."""
    orig_device = video.device
    orig_dtype = video.dtype

    if model_name and model_name.strip() and model_name != "bicubic":
        dev = torch.device(device if torch.cuda.is_available() else "cpu")
        model = load_upscaler_model(model_name, dev, precision)
        compute_dtype = {"fp32": torch.float32, "fp16": torch.float16, "bf16": torch.bfloat16}.get(precision, torch.float16)

        norm_mean, norm_std = _make_norm_tensors(dev, compute_dtype)
        s = video.to(dev, compute_dtype, copy=True)

        with torch.inference_mode():
            T = s.shape[2]
            target_size = (T, height // 16, width // 16)
            s.sub_(norm_mean).div_(norm_std)
            out = model(s, scale=scale, target_size=target_size)
            del s
            out.mul_(norm_std).add_(norm_mean)
            res = out.to(device=orig_device, dtype=orig_dtype)

        del out, norm_mean, norm_std
        clean_gpu_vram()
        return res

    # Bicubic Fallback
    batch, channels, frames = video.shape[0], video.shape[1], video.shape[2]
    flat = video.movedim(2, 1).reshape(batch * frames, channels, *video.shape[3:])
    flat = comfy.utils.common_upscale(flat, width // 16, height // 16, "bicubic", "disabled")
    return flat.reshape(batch, frames, channels, *flat.shape[2:]).movedim(1, 2).to(device=orig_device, dtype=orig_dtype)


# ==========================================
# Standalone Latent Upscaler Node (Direct)
# ==========================================
class UpscaleMode(str, Enum):
    SCALE_BY = "scale by multiplier"
    TARGET_DIMENSIONS = "target dimensions"
    MEGAPIXELS = "megapixels"

class UpscaleConfig(TypedDict):
    mode: UpscaleMode
    scale: float
    width: int
    height: int
    megapixels: float

class MinimaxH3LatentUpscaler3D(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MinimaxH3LatentUpscaler3D",
            display_name="Minimax H3 Latent Upscaler (3D)",
            category="MiniMax",
            description="Pure 3D/2D neural latent upscaler for MiniMax H3 24-channel joint AV latents.",
            inputs=[
                io.AnyType.Input("latent"),
                io.Combo.Input("model_name", options=list_latent_upscale_models() or ["none"]),
                io.DynamicCombo.Input(
                    "mode",
                    options=[
                        io.DynamicCombo.Option(UpscaleMode.SCALE_BY, [
                            io.Float.Input("scale", default=2.0, min=1.0, max=4.0, step=0.05),
                        ]),
                        io.DynamicCombo.Option(UpscaleMode.TARGET_DIMENSIONS, [
                            io.Int.Input("width", default=1344, min=64, max=4096, step=16),
                            io.Int.Input("height", default=768, min=64, max=4096, step=16),
                        ]),
                        io.DynamicCombo.Option(UpscaleMode.MEGAPIXELS, [
                            io.Float.Input("megapixels", default=1.0, min=0.1, max=8.0, step=0.1),
                        ]),
                    ],
                ),
                io.Int.Input("align", default=32, min=1, max=512, step=1),
                io.Boolean.Input("keep_proportion", default=True),
                io.Combo.Input("device", options=["cuda", "cpu"], default="cuda"),
                io.Combo.Input("precision", options=["fp16", "bf16", "fp32"], default="fp16"),
            ],
            outputs=[io.AnyType.Output("latent", display_name="LATENT")],
        )

    @classmethod
    def execute(cls, latent: dict, model_name: str, mode: UpscaleConfig,
                align: int = 32, keep_proportion: bool = True,
                device: str = "cuda", precision: str = "fp16") -> io.NodeOutput:

        selected_mode = mode["mode"]
        samples = latent["samples"]

        is_nested = getattr(samples, "is_nested", False) or not isinstance(samples, torch.Tensor)
        if is_nested:
            tensors = list(samples.unbind()) if hasattr(samples, "unbind") else list(samples)
            video_tensor = tensors[0]
            audio_tensors = tensors[1:]
        else:
            video_tensor = samples
            audio_tensors = []

        if video_tensor.ndim == 4:
            video_tensor = video_tensor.unsqueeze(0)

        b, c, t, h_in, w_in = video_tensor.shape

        if selected_mode == UpscaleMode.SCALE_BY:
            scale_val = mode["scale"]
            w_pixel_target = w_in * VAE_DOWNSAMPLE * scale_val
            h_pixel_target = h_in * VAE_DOWNSAMPLE * scale_val
            effective_scale = scale_val
        elif selected_mode == UpscaleMode.TARGET_DIMENSIONS:
            w_pixel_target = float(mode["width"])
            h_pixel_target = float(mode["height"])
            effective_scale = (w_pixel_target / (w_in * VAE_DOWNSAMPLE) + h_pixel_target / (h_in * VAE_DOWNSAMPLE)) / 2.0
        else:
            mp = mode["megapixels"]
            target_pixels = mp * 1024 * 1024
            aspect_ratio = w_in / h_in
            h_pixel_target = (target_pixels / aspect_ratio) ** 0.5
            w_pixel_target = h_pixel_target * aspect_ratio
            effective_scale = (w_pixel_target / (w_in * VAE_DOWNSAMPLE) + h_pixel_target / (h_in * VAE_DOWNSAMPLE)) / 2.0

        alignment = max(1, align)
        if keep_proportion:
            w_pixel_aligned = round(w_pixel_target / alignment) * alignment
            h_pixel_aligned = w_pixel_aligned / (w_in / h_in)
        else:
            w_pixel_aligned = round(w_pixel_target / alignment) * alignment
            h_pixel_aligned = round(h_pixel_target / alignment) * alignment

        w_pixel_final = round(w_pixel_aligned / VAE_DOWNSAMPLE) * VAE_DOWNSAMPLE
        h_pixel_final = round(h_pixel_aligned / VAE_DOWNSAMPLE) * VAE_DOWNSAMPLE

        target_w = max(1, int(w_pixel_final))
        target_h = max(1, int(h_pixel_final))

        out_v = upscale_video_latent_tensor(
            video_tensor, target_w, target_h,
            model_name=model_name, scale=effective_scale,
            device=device, precision=precision,
        )

        if is_nested:
            out_samples = comfy.nested_tensor.NestedTensor([out_v] + audio_tensors)
        else:
            out_samples = out_v

        out_latent = dict(latent)
        out_latent["samples"] = out_samples
        return io.NodeOutput(out_latent)


# ==========================================
# Refine Pass ComfyUI Node (2-Pass Sampling)
# ==========================================
class MiniMaxH3RefinePass(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        import comfy.samplers

        return io.Schema(
            node_id="MiniMaxH3RefinePass",
            display_name="MiniMax H3 Refine Pass",
            category="MiniMax/internal",
            description="Second pass of a two-pass render: neural-upscales or interpolates the video latent "
                        "and re-samples it partway down the schedule, leaving the soundtrack pristine.",
            is_dev_only=True,
            inputs=[
                io.Model.Input("model"),
                io.Conditioning.Input("positive"),
                io.Conditioning.Input("negative"),
                io.Latent.Input("latent"),
                io.Int.Input("width", default=1344, min=32, max=8192, step=32),
                io.Int.Input("height", default=768, min=32, max=8192, step=32),
                io.Int.Input("seed", default=0, min=0, max=0xffffffffffffffff),
                io.Int.Input("steps", default=6, min=1, max=200),
                io.Float.Input("cfg", default=1.0, min=0.0, max=30.0),
                io.Combo.Input("sampler_name", options=comfy.samplers.KSampler.SAMPLERS, default="euler"),
                io.Combo.Input("scheduler", options=comfy.samplers.KSampler.SCHEDULERS, default="simple"),
                io.Float.Input("denoise", default=0.25, min=0.01, max=0.99, step=0.01),
                io.String.Input("upscaler_model", default=""),
                io.Float.Input("scale", default=2.0, min=1.0, max=4.0, step=0.1),
                io.Boolean.Input("clean_vram", default=True),
            ],
            outputs=[io.Latent.Output()],
        )

    @classmethod
    def execute(cls, model: Any, positive: Any, negative: Any, latent: dict, width: int, height: int,
                seed: int, steps: int, cfg: float, sampler_name: str, scheduler: str, denoise: float,
                upscaler_model: str = "", scale: float = 2.0, clean_vram: bool = True) -> io.NodeOutput:

        if clean_vram:
            clean_gpu_vram()

        samples = latent["samples"]
        is_nested = hasattr(samples, "unbind")
        audio = None

        if is_nested:
            parts = list(samples.unbind())
            video = parts[0]
            if len(parts) > 1:
                audio = parts[1]
        elif isinstance(samples, (list, tuple)):
            is_nested = True
            video = samples[0]
            if len(samples) > 1:
                audio = samples[1]
        else:
            video = samples

        if video.ndim == 4:
            video = video.unsqueeze(0)

        target_device = "cpu"
        video = video.to(target_device)
        if audio is not None:
            audio = audio.to(target_device)

        video = upscale_video_latent_tensor(
            video, width, height,
            model_name=upscaler_model,
            scale=scale,
            device="cuda" if torch.cuda.is_available() else "cpu",
            precision="fp16",
        ).to(target_device)

        if clean_vram:
            clean_gpu_vram()

        sigma0 = float(comfy.samplers.KSampler(
            model, steps=steps, device=model.load_device, sampler=sampler_name,
            scheduler=scheduler, denoise=denoise, model_options=model.model_options,
        ).sigmas[0])

        if not 0.0 < sigma0 < 1.0:
            raise ValueError(f"Refine denoise {denoise} invalid for schedule starting sigma {sigma0}.")

        noise_video = torch.randn(
            video.size(), dtype=torch.float32, layout=video.layout,
            generator=torch.manual_seed(seed), device=target_device).to(video.dtype)

        if audio is not None:
            audio = audio.to(target_device)
            noise_audio = torch.zeros_like(audio, device=target_device)
            noise = comfy.nested_tensor.NestedTensor((noise_video, noise_audio))
            start = comfy.nested_tensor.NestedTensor((video, (audio / (1.0 - sigma0)).to(audio.dtype)))
        else:
            noise = noise_video
            start = video

        if clean_vram:
            clean_gpu_vram()

        refined = comfy.sample.sample(
            model, noise, steps, cfg, sampler_name, scheduler,
            positive, negative, start,
            denoise=denoise, seed=seed,
            callback=latent_preview.prepare_callback(model, steps),
            disable_pbar=not comfy.utils.PROGRESS_BAR_ENABLED,
        )

        if audio is not None:
            refined_video = refined.unbind()[0] if hasattr(refined, "unbind") else (refined[0] if isinstance(refined, (list, tuple)) else refined)
            refined_video = refined_video.to(target_device)
            audio = audio.to(target_device)
            out_samples = comfy.nested_tensor.NestedTensor((refined_video, audio))
        else:
            out_samples = refined

        out = dict(latent)
        out["samples"] = out_samples

        if clean_vram:
            clean_gpu_vram()

        return io.NodeOutput(out)


# ==========================================
# NVIDIA RTX Video Super Resolution Node
# ==========================================
class MiniMaxH3RTXUpscale(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3RTXUpscale",
            display_name="MiniMax H3 RTX VSR Upscale",
            category="MiniMax",
            description=(
                "Hardware-accelerated NVIDIA RTX Video Super Resolution (VSR) "
                "AI upscaler for decoded video frames. Supports up to 16K with hybrid bicubic fallback."
            ),
            inputs=[
                io.Image.Input("images"),
                io.Float.Input("scale", default=2.0, min=1.0, max=4.0, step=0.05),
                io.Combo.Input("quality", options=["ULTRA", "HIGH", "MEDIUM", "LOW"], default="ULTRA"),
                io.Boolean.Input("enabled", default=True),
            ],
            outputs=[
                io.Image.Output("images", display_name="images"),
                io.Int.Output("output_width", display_name="width"),
                io.Int.Output("output_height", display_name="height"),
            ],
        )

    @classmethod
    def execute(
        cls,
        images: torch.Tensor,
        scale: float = 2.0,
        quality: str = "ULTRA",
        enabled: bool = True,
    ) -> io.NodeOutput:
        if not enabled or scale <= 1.001:
            return io.NodeOutput(images, int(images.shape[2]), int(images.shape[1]))

        upscaled = rtx_vsr.run_rtx_vsr_upscale(
            images=images,
            scale=scale,
            quality=quality,
        )

        return io.NodeOutput(upscaled, int(upscaled.shape[2]), int(upscaled.shape[1]))


NODES = [MinimaxH3LatentUpscaler3D, MiniMaxH3RefinePass, MiniMaxH3RTXUpscale]