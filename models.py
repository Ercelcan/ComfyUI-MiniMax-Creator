"""Model loaders, weights configuration, hardware device dispatch, and Tiled VAE decode helpers."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Optional

import folder_paths

from . import accel

PREVIEW_NODE = "ModelPreviewOverrideKJ"
PREVIEW_SOURCE = "https://github.com/kijai/ComfyUI-KJNodes"

MULTIGPU_SOURCE = "https://github.com/pollockjj/ComfyUI-MultiGPU"

MULTIGPU = {
    "UNETLoader": "UNETLoaderMultiGPU",
    "CLIPLoader": "CLIPLoaderMultiGPU",
    "VAELoader": "VAELoaderMultiGPU",
    "UnetLoaderGGUF": "UnetLoaderGGUFMultiGPU",
    "CLIPLoaderGGUF": "CLIPLoaderGGUFMultiGPU",
}

GGUF_SOURCE = "https://github.com/city96/ComfyUI-GGUF"

GGUF_LOADERS = {
    "UNETLoader": "UnetLoaderGGUF",
    "CLIPLoader": "CLIPLoaderGGUF",
}

GGUF_FOLDERS = {
    "diffusion_models": "unet_gguf",
    "text_encoders": "clip_gguf",
}

LATENT_UPSCALE_FOLDER = "latent_upscale_models"
if LATENT_UPSCALE_FOLDER not in folder_paths.folder_names_and_paths:
    folder_paths.add_model_folder_path(
        LATENT_UPSCALE_FOLDER,
        os.path.join(folder_paths.models_dir, LATENT_UPSCALE_FOLDER),
    )

DEVICE_FIELDS = ["fl2va", "ref2va", "clip", "vae", "audio_vae"]
DEFAULT_DEVICE = ""

ROUTES = ["auto", "fl2va", "ref2va"]
DEFAULT_ROUTE = "auto"

FOLDERS = {
    "fl2va": "diffusion_models",
    "ref2va": "diffusion_models",
    "clip": "text_encoders",
    "vae": "vae",
    "audio_vae": "vae",
    "preview": "vae_approx",
    "latent_upscaler": LATENT_UPSCALE_FOLDER,
}

DEFAULT_DTYPE = "default"
CLIP_TYPE = "minimax"
PREVIEW_FRAMES = 1024
PREVIEW_FPS = 24

LABEL = {
    "fl2va": "the FL2VA checkpoint",
    "ref2va": "the Ref2VA checkpoint",
    "clip": "the text encoder",
    "vae": "the video VAE",
    "audio_vae": "the audio VAE",
    "preview": "the preview decoder",
    "latent_upscaler": "the latent upscaler model",
}


@dataclass(frozen=True)
class Weights:
    fl2va: Optional[str] = None
    ref2va: Optional[str] = None
    clip: Optional[str] = None
    vae: Optional[str] = None
    audio_vae: Optional[str] = None
    preview: Optional[str] = None
    latent_upscaler: Optional[str] = None
    dtype: str = DEFAULT_DTYPE
    route: str = DEFAULT_ROUTE
    devices: dict = field(default_factory=dict)

    @classmethod
    def from_blob(cls, data: dict | None) -> Weights:
        block = (data or {}).get("models")
        if not isinstance(block, dict):
            block = {}
        picked = {name: _clean(block.get(name)) for name in FOLDERS}
        dtype = block.get("dtype")
        raw_devices = block.get("devices")
        devices = {}
        if isinstance(raw_devices, dict):
            for name in DEVICE_FIELDS:
                chosen = _clean(raw_devices.get(name))
                if chosen:
                    devices[name] = chosen
        route = block.get("route")
        return cls(
            **picked,
            dtype=dtype if isinstance(dtype, str) and dtype else DEFAULT_DTYPE,
            route=route if route in ROUTES else DEFAULT_ROUTE,
            devices=devices,
        )

    def routed(self, payload: dict) -> dict:
        if self.route == DEFAULT_ROUTE:
            return payload
        request = dict(payload.get("request") or {})
        request["checkpoint"] = self.route
        return {**payload, "request": request}

    def get(self, name: str) -> str | None:
        return getattr(self, name, None)

    def device(self, name: str) -> str | None:
        return self.devices.get(name) or None


def _clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def device_options() -> list[str]:
    import nodes

    node = nodes.NODE_CLASS_MAPPINGS.get(MULTIGPU["UNETLoader"])
    if node is None:
        return []
    declared = node.INPUT_TYPES().get("optional", {}).get("device")
    if not isinstance(declared, (tuple, list)) or not declared:
        return []
    return [str(option) for option in declared[0]]


def is_gguf(filename: str | None) -> bool:
    return bool(filename) and filename.lower().endswith(".gguf")


def loader_for(node_id: str, device: str | None, filename: str | None = None) -> tuple[str, dict]:
    import nodes

    if is_gguf(filename):
        gguf = GGUF_LOADERS.get(node_id)
        if gguf is None:
            raise ValueError(
                f"'{filename}' is a GGUF file, and nothing loads a GGUF "
                f"{node_id.replace('Loader', '') or 'file'} — not even "
                f"ComfyUI-GGUF. Pick a safetensors file instead."
            )
        if gguf not in nodes.NODE_CLASS_MAPPINGS:
            raise ValueError(
                f"'{filename}' is a GGUF checkpoint, which needs the '{gguf}' "
                f"node from ComfyUI-GGUF ({GGUF_SOURCE}). Install it and restart "
                f"ComfyUI, or pick a safetensors file in the node's 'weights' "
                f"control."
            )
        node_id = gguf
    if not device:
        return node_id, {}
    wrapper = MULTIGPU[node_id]
    if wrapper not in nodes.NODE_CLASS_MAPPINGS:
        raise ValueError(
            f"This is set to load on '{device}', which needs the '{wrapper}' node "
            f"from ComfyUI-MultiGPU ({MULTIGPU_SOURCE}). Install it and restart "
            f"ComfyUI, or set the device back to default in the node's 'weights' "
            f"control."
        )
    return wrapper, {"device": device}


def available(refresh: bool = False) -> dict:
    """Returns all available model files across registered directories.
    
    When refresh=True, forces a filesystem re-index so new files dropped into
    models folders show up immediately upon interface refresh ("R") without restarting ComfyUI.
    """
    def listing(folder: str) -> list[str]:
        try:
            if refresh:
                # Invalidate ComfyUI's internal filename list cache if present
                cache_dict = getattr(folder_paths, "filename_list_cache", None)
                if isinstance(cache_dict, dict):
                    cache_dict.pop(folder, None)
                    cache_dict.pop(GGUF_FOLDERS.get(folder, ""), None)
            names = folder_paths.get_filename_list(folder)
            return list(names) if names else []
        except Exception:
            return []

    listings = {}
    for folder in set(FOLDERS.values()):
        names = {*listing(folder), *listing(GGUF_FOLDERS.get(folder, ""))}
        listings[folder] = sorted(names)

    return {
        "files": {name: listings.get(folder, []) for name, folder in FOLDERS.items()},
        "folders": dict(FOLDERS),
        "by_folder": listings,
        "dtypes": ["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"],
        "preview_override": preview_available(),
        "preview_source": PREVIEW_SOURCE,
        "devices": device_options(),
        "device_fields": list(DEVICE_FIELDS),
        "multigpu_source": MULTIGPU_SOURCE,
    }


def check(weights: Weights, checkpoints: set[str], where: dict[str, str], audio: bool = True) -> None:
    needed = ["clip", "vae", *(["audio_vae"] if audio else []), *sorted(checkpoints)]
    for name in needed:
        if weights.get(name):
            continue
        blame = ""
        if name in checkpoints:
            blame = f"{where[name]} routes to it — "
        raise ValueError(
            f"{blame}{LABEL[name].capitalize()} has not been picked. "
            f"Open the node's 'weights' control and choose a file from "
            f"models/{FOLDERS[name]}."
        )


def emit_links(graph: Any, weights: Weights, checkpoints: set[str], audio: bool = True) -> Any:
    from .render import Links

    def loader(field_name: str, node_id: str, filename: str | None, **inputs: Any) -> Any:
        wrapper, extra = loader_for(node_id, weights.device(field_name), filename)
        if not is_gguf(filename) and node_id == "UNETLoader":
            inputs["weight_dtype"] = weights.dtype
        return graph.node(wrapper, **inputs, **extra).out(0)

    loaded_models = {}
    for name in sorted(checkpoints):
        loaded_models[name] = loader(
            name,
            "UNETLoader",
            weights.get(name),
            unet_name=weights.get(name),
        )

    return Links(
        clip=loader(
            "clip",
            "CLIPLoader",
            weights.clip,
            clip_name=weights.clip,
            type=CLIP_TYPE,
        ),
        vae=loader(
            "vae",
            "VAELoader",
            weights.vae,
            vae_name=weights.vae,
        ),
        audio_vae=loader(
            "audio_vae",
            "VAELoader",
            weights.audio_vae,
            vae_name=weights.audio_vae,
        ) if audio else None,
        model_fl2va=loaded_models.get("fl2va"),
        model_ref2va=loaded_models.get("ref2va"),
    )


def preview_available(weights: Weights | None = None) -> bool:
    import nodes
    return PREVIEW_NODE in nodes.NODE_CLASS_MAPPINGS


def graph_preview(graph: Any, model: Any, weights: Weights | None) -> Any:
    if not preview_available(weights):
        return model

    import nodes
    node = nodes.NODE_CLASS_MAPPINGS[PREVIEW_NODE]
    kwargs = accel.node_defaults(node)
    kwargs.update({
        "tiny_vae": weights.preview if (weights and weights.preview) else "none",
        "preview_frames": PREVIEW_FRAMES,
        "preview_fps": PREVIEW_FPS,
        "suppress_default_preview": True,
    })
    return graph.node(PREVIEW_NODE, model=model, **kwargs).out(0)


def decode_vae_node(graph: Any, samples: Any, vae: Any, tiled: bool = False, tile_size: int = 512, overlap: int = 64) -> Any:
    """Emits either standard VAEDecode or memory-efficient VAEDecodeTiled."""
    import nodes
    if tiled and "VAEDecodeTiled" in nodes.NODE_CLASS_MAPPINGS:
        return graph.node(
            "VAEDecodeTiled",
            samples=samples,
            vae=vae,
            tile_size=max(64, int(tile_size)),
            overlap=max(0, int(overlap)),
            temporal_size=64,
            temporal_overlap=8,
        ).out(0)
    return graph.node("VAEDecode", samples=samples, vae=vae).out(0)