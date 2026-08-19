"""One image generation, as a graph. The PreStage's half of `render.py` with full LoRA patching, Tiled VAE decode, and live preview support."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import models, outputs, settings
from .compile import CompileError
from .compile_image import IDEOGRAM_CFG_LATE
from .models import is_gguf, loader_for

SAVE_NODE = "MiniMaxH3SaveImage"
FILENAME_PREFIX = outputs.IMAGE_PREFIX

FOLDERS = {
    "model": "diffusion_models",
    "turbo_model": "diffusion_models",
    "uncond_model": "diffusion_models",
    "clip": "text_encoders",
    "vae": "vae",
}

ARCH_FIELDS = {
    "krea2": ("model", "turbo_model", "clip", "vae"),
    "ideogram4": ("model", "uncond_model", "clip", "vae"),
}

CLIP_TYPE = {"krea2": "krea2", "ideogram4": "ideogram4"}

LABEL = {
    "model": "the checkpoint",
    "turbo_model": "the Turbo checkpoint",
    "uncond_model": "the unconditional checkpoint",
    "clip": "the text encoder",
    "vae": "the VAE",
}

KREA_REF_SHIFT = {"max_shift": 1.15, "base_shift": 0.5}
KREA_REF_METHOD = "index_timestep_zero"


@dataclass(frozen=True)
class ImageWeights:
    arch: str
    files: dict = field(default_factory=dict)
    dtype: str = "default"

    @classmethod
    def from_blob(cls, data: dict | None) -> ImageWeights:
        arch = (data or {}).get("arch", "krea2")
        block = (data or {}).get("models")
        if not isinstance(block, dict):
            block = {}
        side = block.get(arch)
        if not isinstance(side, dict):
            side = {}
        files = {}
        for name in ARCH_FIELDS.get(arch, ()):
            value = side.get(name)
            if isinstance(value, str) and value.strip():
                files[name] = value.strip()
        dtype = block.get("dtype")
        return cls(
            arch=arch,
            files=files,
            dtype=dtype if isinstance(dtype, str) and dtype else "default",
        )

    def get(self, name: str) -> str | None:
        return self.files.get(name)


def check(weights: ImageWeights, payload: any) -> None:
    for name in ("clip", "vae", payload.checkpoint_field):
        if weights.get(name):
            continue
        label = LABEL[name][0].upper() + LABEL[name][1:]
        raise ValueError(
            f"{label} has not been picked. Open the "
            f"pre-stage node's 'weights' control and choose a file from "
            f"models/{FOLDERS[name]}."
        )


def _require_arch(arch: str) -> None:
    import nodes

    if arch == "ideogram4" and "Ideogram4Scheduler" not in nodes.NODE_CLASS_MAPPINGS:
        raise ValueError(
            "This ComfyUI does not know Ideogram 4 yet (no Ideogram4Scheduler "
            "node). Update ComfyUI and restart."
        )
    if arch == "krea2":
        declared = nodes.NODE_CLASS_MAPPINGS["CLIPLoader"].INPUT_TYPES()
        types = declared.get("required", {}).get("type", [[]])[0]
        if "krea2" not in types:
            raise ValueError(
                "This ComfyUI does not know Krea 2 yet (CLIPLoader has no "
                "'krea2' type). Update ComfyUI and restart."
            )


def _unet(graph: Any, weights: ImageWeights, name: str) -> Any:
    filename = weights.get(name)
    node_id, _ = loader_for("UNETLoader", None, filename)
    dtype = {} if is_gguf(filename) else {"weight_dtype": weights.dtype}
    return graph.node(node_id, unet_name=filename, **dtype).out(0)


def emit(payload: any, weights: ImageWeights, sampling: any, unique_id: any, filename_prefix: str = FILENAME_PREFIX) -> tuple[Any, tuple]:
    from comfy_execution.graph_utils import GraphBuilder

    if payload.arch != weights.arch:
        raise CompileError("the payload and the weights disagree about the architecture")
    _require_arch(payload.arch)
    check(weights, payload)

    graph = GraphBuilder()

    clip = graph.node(loader_for("CLIPLoader", None, weights.get("clip"))[0],
                      clip_name=weights.get("clip"),
                      type=CLIP_TYPE[payload.arch]).out(0)
    vae = graph.node("VAELoader", vae_name=weights.get("vae")).out(0)
    model = _unet(graph, weights, payload.checkpoint_field)

    # Patch both Model and CLIP with LoRAs for full text-encoder and UNet styling support
    for entry in payload.loras:
        lora_node = graph.node(
            "LoraLoader",
            model=model,
            clip=clip,
            lora_name=entry["name"],
            strength_model=float(entry.get("strength", 1.0)),
            strength_clip=float(entry.get("strength", 1.0)),
        )
        model = lora_node.out(0)
        clip = lora_node.out(1)

    model = models.graph_preview(graph, model, None)

    use_tiled = settings.tiled_vae() or (payload.width > 1024 or payload.height > 1024)
    tile_size = settings.vae_tile_size()

    if payload.arch == "krea2":
        image = _emit_krea2(graph, payload, sampling, clip, vae, model, unique_id, filename_prefix, tiled=use_tiled, tile_size=tile_size)
    else:
        image = _emit_ideogram4(graph, payload, sampling, weights, clip, vae, model, unique_id,
                                filename_prefix, tiled=use_tiled, tile_size=tile_size)
    return graph, (image,)


def _latent(graph: Any, payload: any, vae: Any, empty_node: str) -> tuple[Any, float]:
    if payload.init is None:
        empty = graph.node(empty_node, width=payload.width, height=payload.height,
                           batch_size=1)
        return empty.out(0), 1.0
    image = graph.node("LoadImage", image=payload.init["filename"]).out(0)
    scaled = graph.node("ImageScale", image=image, upscale_method="lanczos",
                        width=payload.width, height=payload.height,
                        crop="center").out(0)
    encoded = graph.node("VAEEncode", pixels=scaled, vae=vae).out(0)
    return encoded, payload.init["denoise"]


def _emit_krea2(graph: Any, payload: any, sampling: any, clip: Any, vae: Any, model: Any, unique_id: any, filename_prefix: str, tiled: bool = False, tile_size: int = 512) -> Any:
    if payload.refs:
        images = {f"image{i + 1}": graph.node("LoadImage", image=name).out(0)
                  for i, name in enumerate(payload.refs)}
        positive = graph.node("TextEncodeQwenImageEditPlus", clip=clip,
                              prompt=payload.prompt, vae=vae, **images).out(0)
        positive = graph.node("FluxKontextMultiReferenceLatentMethod",
                              conditioning=positive,
                              reference_latents_method=KREA_REF_METHOD).out(0)
        model = graph.node("ModelSamplingFlux", model=model,
                           width=payload.width, height=payload.height,
                           **KREA_REF_SHIFT).out(0)
    else:
        positive = graph.node("CLIPTextEncode", clip=clip, text=payload.prompt).out(0)

    negative = graph.node("ConditioningZeroOut", conditioning=positive).out(0)

    latent, denoise = _latent(graph, payload, vae, "EmptySD3LatentImage")
    sampled = graph.node(
        "KSampler", model=model, positive=positive, negative=negative,
        latent_image=latent, seed=sampling.seed, steps=sampling.steps,
        cfg=sampling.cfg, sampler_name=sampling.sampler_name,
        scheduler=sampling.scheduler, denoise=denoise,
    )
    return _emit_tail(graph, sampled.out(0), vae, unique_id, filename_prefix, tiled=tiled, tile_size=tile_size)


def _emit_ideogram4(graph: Any, payload: any, sampling: any, weights: ImageWeights, clip: Any, vae: Any, model: Any, unique_id: any,
                    filename_prefix: str, tiled: bool = False, tile_size: int = 512) -> Any:
    positive = graph.node("CLIPTextEncode", clip=clip, text=payload.prompt).out(0)
    negative = graph.node("ConditioningZeroOut", conditioning=positive).out(0)

    model = graph.node("CFGOverride", model=model, **IDEOGRAM_CFG_LATE).out(0)

    guider_inputs = {"model": model, "positive": positive, "negative": negative,
                     "cfg": sampling.cfg}
    if weights.get("uncond_model"):
        guider_inputs["model_negative"] = _unet(graph, weights, "uncond_model")
    guider = graph.node("DualModelGuider", **guider_inputs).out(0)

    sigmas = graph.node("Ideogram4Scheduler", steps=sampling.steps,
                        width=payload.width, height=payload.height,
                        mu=payload.mu, std=payload.std).out(0)
    latent, denoise = _latent(graph, payload, vae, "EmptyFlux2LatentImage")
    if denoise < 1.0:
        sigmas = graph.node("SplitSigmasDenoise", sigmas=sigmas,
                            denoise=denoise).out(1)

    sampled = graph.node(
        "SamplerCustomAdvanced",
        noise=graph.node("RandomNoise", noise_seed=sampling.seed).out(0),
        guider=guider,
        sampler=graph.node("KSamplerSelect", sampler_name=sampling.sampler_name).out(0),
        sigmas=sigmas, latent_image=latent,
    )
    return _emit_tail(graph, sampled.out(0), vae, unique_id, filename_prefix, tiled=tiled, tile_size=tile_size)


def _emit_tail(graph: Any, samples: Any, vae: Any, unique_id: any, filename_prefix: str, tiled: bool = False, tile_size: int = 512) -> Any:
    image = models.decode_vae_node(graph, samples=samples, vae=vae, tiled=tiled, tile_size=tile_size)
    save = graph.node(SAVE_NODE, images=image, filename_prefix=filename_prefix)
    save.set_override_display_id(unique_id)
    return image