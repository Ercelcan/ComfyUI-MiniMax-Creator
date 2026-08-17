"""The neural latent upscaler & refine pass engine for MiniMax H3.

Handles:
- Loading 2D and 3D neural latent upscaler weights from models/latent_upscale_models/
- Safe unbinding & repacking of ComfyUI NestedTensors (Video + Audio)
- High-fidelity 2nd-pass refinement with custom denoise (default: 0.25), steps, and Turbo LoRA overrides.
"""

from __future__ import annotations

import glob
import os
import re
import torch
import torch.nn as nn
import torch.nn.functional as F
from einops import rearrange

import folder_paths
import comfy.nested_tensor
import comfy.sample
import comfy.samplers
import comfy.utils
import latent_preview
from comfy_api.latest import io

# ==========================================
# Register Model Folder
# ==========================================
LATENT_UPSCALE_FOLDER = "latent_upscale_models"
if LATENT_UPSCALE_FOLDER not in folder_paths.folder_names_and_paths:
    folder_paths.add_model_folder_path(
        LATENT_UPSCALE_FOLDER,
        os.path.join(folder_paths.models_dir, LATENT_UPSCALE_FOLDER)
    )

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


def _make_norm_tensors(device, dtype):
    mean = torch.tensor(LATENTS_MEAN, dtype=dtype, device=device).view(1, -1, 1, 1, 1)
    std = torch.tensor(LATENTS_STD, dtype=dtype, device=device).view(1, -1, 1, 1, 1)
    return mean, std


def normalization(channels):
    return nn.GroupNorm(32, channels)


def zero_module(module):
    for p in module.parameters():
        p.detach().zero_()
    return module


# ==========================================
# Neural Latent Upscaler 3D Backbone
# ==========================================
class ResBlockEmb3D(nn.Module):
    def __init__(self, channels, emb_channels, dropout=0, out_channels=None):
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

    def forward(self, x, emb):
        h = self.in_layers(x)
        emb_out = self.emb_layers(emb).type(h.dtype)
        while len(emb_out.shape) < len(h.shape):
            emb_out = emb_out[..., None]
        scale, shift = torch.chunk(emb_out, 2, dim=1)
        h = self.out_norm(h) * (1 + scale) + shift
        h = self.out_layers(h)
        return self.skip(x) + h


class TemporalConv(nn.Module):
    def __init__(self, channels, kernel_size=5):
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

    def forward(self, x):
        identity = x
        h = self.norm(x)
        h = F.silu(h)
        h = self.dwconv(h)
        h = self.pwconv(h)
        return identity + h


class LatentResizer3D(nn.Module):
    def __init__(self, in_channels=24, in_blocks=12, out_blocks=12,
                 channels=512, dropout=0.1, temporal_every=2, temporal_kernel=5):
        super().__init__()
        self.conv_in = nn.Conv3d(in_channels, channels, 3, padding=1)
        embed_dim = 64
        self.embed = nn.Sequential(
            nn.Linear(1, embed_dim), nn.SiLU(), nn.Linear(embed_dim, embed_dim))

        self.in_blocks = nn.ModuleList()
        for b in range(in_blocks):
            self.in_blocks.append(ResBlockEmb3D(channels, embed_dim, dropout))
            if temporal_every > 0 and b % temporal_every == 0:
                self.in_blocks.append(TemporalConv(channels, temporal_kernel))

        self.out_blocks = nn.ModuleList()
        for b in range(out_blocks):
            self.out_blocks.append(ResBlockEmb3D(channels, embed_dim, dropout))
            if temporal_every > 0 and b % temporal_every == 0:
                self.out_blocks.append(TemporalConv(channels, temporal_kernel))

        self.norm_out = normalization(channels)
        self.conv_out = nn.Conv3d(channels, in_channels, 3, padding=1)

    def forward(self, x, scale=None, target_size=None):
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
# Latent Upscaler Model Loader & Cache
# ==========================================
MODEL_CACHE = {}


def list_latent_upscale_models():
    files = []
    try:
        model_dir = folder_paths.get_folder_paths(LATENT_UPSCALE_FOLDER)[0]
        for ext in ("*.safetensors", "*.pth"):
            files.extend(glob.glob(os.path.join(model_dir, ext)))
    except Exception:
        pass
    return sorted(os.path.basename(f) for f in files)


def _load_upscaler_sd(path):
    if path.endswith(".safetensors"):
        from safetensors.torch import load_file
        sd = load_file(path, device="cpu")
    else:
        sd = torch.load(path, map_location="cpu", weights_only=False)
    if isinstance(sd, dict) and "model" in sd:
        sd = sd["model"]
    if any(k.startswith("upscaler.") for k in sd):
        sd = {k[len("upscaler."):]: v for k, v in sd.items() if k.startswith("upscaler.")}
    return {k: v.to(torch.float16) if v.dtype == torch.float8_e4m3fn else v for k, v in sd.items()}


def load_upscaler_model(model_name: str, device: torch.device, precision: str = "fp16"):
    cache_key = f"{model_name}::{device}::{precision}"
    if cache_key in MODEL_CACHE:
        return MODEL_CACHE[cache_key]

    model_dir = folder_paths.get_folder_paths(LATENT_UPSCALE_FOLDER)[0]
    path = os.path.join(model_dir, model_name)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Latent upscaler model not found: {path}")

    sd = _load_upscaler_sd(path)

    cfg = {
        "in_channels": 24, "in_blocks": 12, "out_blocks": 12,
        "channels": 512, "dropout": 0.1, "temporal_every": 2, "temporal_kernel": 5,
    }

    if "conv_in.weight" in sd:
        cfg["in_channels"] = sd["conv_in.weight"].shape[1]
        cfg["channels"] = sd["conv_in.weight"].shape[0]

    in_ids = {int(m.group(1)) for k in sd if (m := re.match(r"in_blocks\.(\d+)\.in_layers\.", k))}
    out_ids = {int(m.group(1)) for k in sd if (m := re.match(r"out_blocks\.(\d+)\.in_layers\.", k))}
    if in_ids:
        cfg["in_blocks"] = len(in_ids)
    if out_ids:
        cfg["out_blocks"] = len(out_ids)

    model = LatentResizer3D(
        in_channels=cfg["in_channels"],
        in_blocks=cfg["in_blocks"],
        out_blocks=cfg["out_blocks"],
        channels=cfg["channels"],
        dropout=cfg["dropout"],
        temporal_every=cfg["temporal_every"],
        temporal_kernel=cfg["temporal_kernel"],
    )
    model.load_state_dict(sd, strict=False)

    dtype = {"fp32": torch.float32, "fp16": torch.float16, "bf16": torch.bfloat16}.get(precision, torch.float16)
    model = model.to(device=device, dtype=dtype).eval()
    MODEL_CACHE[cache_key] = model
    return model


def upscale_video_latent_tensor(video: torch.Tensor, width: int, height: int,
                                model_name: str = "", scale: float = 2.0,
                                device: str = "cuda", precision: str = "fp16") -> torch.Tensor:
    """Upscales video latent [B, C, T, H, W] using either neural upscaler or bicubic fallback."""
    if model_name and model_name.strip() and model_name != "bicubic":
        dev = torch.device(device if torch.cuda.is_available() else "cpu")
        model = load_upscaler_model(model_name, dev, precision)
        compute_dtype = {"fp32": torch.float32, "fp16": torch.float16, "bf16": torch.bfloat16}.get(precision, torch.float16)

        orig_dtype = video.dtype
        s = video.to(dev, compute_dtype)
        norm_mean, norm_std = _make_norm_tensors(dev, compute_dtype)
        s = (s - norm_mean) / norm_std

        with torch.no_grad():
            T = s.shape[2]
            target_size = (T, height // 16, width // 16)
            out = model(s, scale=scale, target_size=target_size)

        out = out * norm_std + norm_mean
        return out.cpu().to(orig_dtype)

    # Bicubic Fallback
    batch, channels, frames = video.shape[0], video.shape[1], video.shape[2]
    flat = video.movedim(2, 1).reshape(batch * frames, channels, *video.shape[3:])
    flat = comfy.utils.common_upscale(flat, width // 16, height // 16, "bicubic", "disabled")
    return flat.reshape(batch, frames, channels, *flat.shape[2:]).movedim(1, 2)


# ==========================================
# Refine Pass ComfyUI Node
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
            ],
            outputs=[io.Latent.Output()],
        )

    @classmethod
    def execute(cls, model, positive, negative, latent, width, height,
                seed, steps, cfg, sampler_name, scheduler, denoise,
                upscaler_model="", scale=2.0) -> io.NodeOutput:
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

        # 1. Upscale the video latent stream
        video = upscale_video_latent_tensor(
            video, width, height,
            model_name=upscaler_model,
            scale=scale,
            device="cuda" if torch.cuda.is_available() else "cpu",
            precision="fp16",
        )

        # 2. Setup schedule sigma for refine denoise (Default: 0.25)
        sigma0 = float(comfy.samplers.KSampler(
            model, steps=steps, device=model.load_device, sampler=sampler_name,
            scheduler=scheduler, denoise=denoise, model_options=model.model_options,
        ).sigmas[0])

        if not 0.0 < sigma0 < 1.0:
            raise ValueError(f"Refine denoise {denoise} invalid for schedule starting sigma {sigma0}.")

        # 3. Add noise only to video; preserve and scale audio to compensate for schedule lerp
        noise_video = torch.randn(
            video.size(), dtype=torch.float32, layout=video.layout,
            generator=torch.manual_seed(seed), device="cpu").to(video.dtype)

        if audio is not None:
            noise_audio = torch.zeros_like(audio, device="cpu")
            noise = comfy.nested_tensor.NestedTensor((noise_video, noise_audio))
            start = comfy.nested_tensor.NestedTensor((video, audio / (1.0 - sigma0)))
        else:
            noise = noise_video
            start = video

        # 4. Execute 2nd-pass refinement sampling on video
        refined = comfy.sample.sample(
            model, noise, steps, cfg, sampler_name, scheduler,
            positive, negative, start,
            denoise=denoise, seed=seed,
            callback=latent_preview.prepare_callback(model, steps),
            disable_pbar=not comfy.utils.PROGRESS_BAR_ENABLED,
        )

        # 5. Repack with the original pristine audio latent from Pass 1
        if audio is not None:
            refined_video = refined.unbind()[0] if hasattr(refined, "unbind") else (refined[0] if isinstance(refined, (list, tuple)) else refined)
            out_samples = comfy.nested_tensor.NestedTensor((refined_video, audio))
        else:
            out_samples = refined

        out = dict(latent)
        out["samples"] = out_samples
        return io.NodeOutput(out)


NODES = [MiniMaxH3RefinePass]