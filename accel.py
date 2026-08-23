"""Optional sampling accelerators and VRAM protection modifiers for MiniMax H3."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

BLOCK_CACHE_NODE = "ApplyMiniMaxH3FirstBlockCache"
SPECTRUM_NODE = "SpectrumApplyMiniMaxH3"
LOW_VRAM_ATTN_NODE = "MiniMaxLowVRAMAttention"
CHUNK_FFN_NODE = "MiniMaxChunkFeedForward"
SPEED_SAMPLER_NODE = "MiniMaxH3SPEEDSampler"

SOURCES = {
    BLOCK_CACHE_NODE: "https://github.com/duckyshell/ComfyUI-MiniMaxH3-FirstBlockCache",
    SPECTRUM_NODE: "https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3",
    LOW_VRAM_ATTN_NODE: "https://github.com/kijai/ComfyUI-KJNodes",
    CHUNK_FFN_NODE: "https://github.com/kijai/ComfyUI-KJNodes",
    SPEED_SAMPLER_NODE: "https://github.com/StanLukuvka/ComfyUI-MiniMax-H3-SPEED",
}

BLOCK_CACHE_MODES = ["off", "safe", "fast", "aggressive"]

SPEED_PRESETS = [
    "off",
    "Half -> Full (0.5x -> 1.0x) [Balanced / Recommended]",
    "Three-Quarter -> Full (0.75x -> 1.0x) [Fast]",
    "Quarter -> Half -> Full (3-Stage) [High Detail]",
]


@dataclass(frozen=True)
class Settings:
    """User preferences for sampling acceleration and VRAM protection."""

    block_cache: str = "off"
    spectrum: bool = False
    spectrum_blend: float = 0.5
    low_vram_attn: bool = False
    head_chunks: int = 4
    chunk_ffn: bool = False
    ffn_chunks: int = 2
    ffn_seq_threshold: int = 4096
    speed_preset: str = "off"
    speed_coarse_steps: int = 0
    speed_noise_policy: str = "direct_coarse"

    @property
    def any(self) -> bool:
        return (
            self.block_cache != "off"
            or self.spectrum
            or self.low_vram_attn
            or self.chunk_ffn
            or self.is_speed_enabled
        )

    @property
    def is_speed_enabled(self) -> bool:
        return self.speed_preset != "off"


def _node_class(node_id: str) -> Any:
    import nodes
    return nodes.NODE_CLASS_MAPPINGS.get(node_id)


def _require(node_id: str) -> Any:
    node = _node_class(node_id)
    if node is None:
        raise ValueError(
            f"This requires the '{node_id}' node. "
            f"Get it from {SOURCES.get(node_id, 'ComfyUI Manager')}, restart ComfyUI, or disable the accelerator."
        )
    return node


def node_defaults(node: Any, skip: tuple[str, ...] = ("model",)) -> dict[str, Any]:
    spec = node.INPUT_TYPES().get("required", {})
    out = {}
    for name, declared in spec.items():
        if name in skip:
            continue
        if isinstance(declared, (tuple, list)) and len(declared) > 1 and isinstance(declared[1], dict):
            if "default" in declared[1]:
                out[name] = declared[1]["default"]
    return out


def _block_cache_kwargs(node: Any, mode: str) -> dict[str, Any]:
    kwargs = node_defaults(node)
    options = node.INPUT_TYPES()["required"]["mode"][0]
    wanted = f"h3 {mode}"
    match = next((o for o in options if str(o).lower().startswith(wanted)), None)
    if match is None:
        raise ValueError(
            f"'{node.__name__}' has no '{mode}' preset — offers {list(options)}."
        )
    kwargs["mode"] = match
    return kwargs


def _spectrum_kwargs(node: Any, blend: float) -> dict[str, Any]:
    kwargs = node_defaults(node)
    kwargs["enabled"] = True
    kwargs["blend_weight"] = float(blend)
    return kwargs


def plan(settings: Settings) -> list[tuple[str, dict[str, Any]]]:
    steps = []
    if settings.block_cache != "off":
        node = _require(BLOCK_CACHE_NODE)
        steps.append((BLOCK_CACHE_NODE, _block_cache_kwargs(node, settings.block_cache)))
    if settings.spectrum:
        node = _require(SPECTRUM_NODE)
        steps.append((SPECTRUM_NODE, _spectrum_kwargs(node, settings.spectrum_blend)))
    if settings.low_vram_attn:
        node = _require(LOW_VRAM_ATTN_NODE)
        kwargs = node_defaults(node)
        kwargs["head_chunks"] = int(settings.head_chunks)
        steps.append((LOW_VRAM_ATTN_NODE, kwargs))
    if settings.chunk_ffn:
        node = _require(CHUNK_FFN_NODE)
        kwargs = node_defaults(node)
        kwargs["chunks"] = int(settings.ffn_chunks)
        kwargs["seq_threshold"] = int(settings.ffn_seq_threshold)
        steps.append((CHUNK_FFN_NODE, kwargs))
    return steps


def graph_apply(graph: Any, model: Any, settings: Settings) -> Any:
    for node_id, kwargs in plan(settings):
        model = graph.node(node_id, model=model, **kwargs).out(0)
    return model


def direct_apply(model: Any, settings: Settings) -> Any:
    for node_id, kwargs in plan(settings):
        node = _require(node_id)
        model = getattr(node(), node.FUNCTION)(model=model, **kwargs)[0]
    return model