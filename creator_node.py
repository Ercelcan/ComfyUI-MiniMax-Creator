"""The MiniMax H3 Creator node with VRAM Protection and SPEED Progressive Sampler."""

from __future__ import annotations

import json
from comfy_api.latest import ComfyExtension, io

from . import (
    accel,
    canvas,
    director_node,
    hires,
    lora,
    media,
    models,
    outputs,
    prestage,
    render,
    settings,
    timeline,
    vram_patch,
    minimax_h3_speed_sampler,
)

DEFAULT_DATA = json.dumps({
    "version": 1,
    "prompt": "",
    "assets": [],
    "loras": [],
    "duration_s": 6,
    "aspect": "16:9",
    "short_edge": canvas.NATIVE_SHORT_EDGE,
    "checkpoint": "auto",
    "output_prefix": outputs.VIDEO_PREFIX,
    "models": {},
}, indent=2)


class MiniMaxH3Creator(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        import comfy.samplers

        return io.Schema(
            node_id="MiniMaxH3Creator",
            display_name="MiniMax H3 Creator",
            category="MiniMax",
            description=(
                "Describe a video and reference attached media with @. Routes to the "
                "FL2VA or Ref2VA checkpoint depending on what you attach, samples it, "
                "and returns the finished frames and sound."
            ),
            enable_expand=True,
            is_output_node=True,
            inputs=[
                io.String.Input("creator_data", multiline=True, default=DEFAULT_DATA),
                io.Int.Input("seed", default=0, min=0, max=0xffffffffffffffff, control_after_generate=True),
                io.Int.Input("steps", default=20, min=1, max=10000),
                io.Float.Input("cfg", default=1.0, min=0.0, max=100.0, step=0.1, round=0.01),
                io.Combo.Input("sampler_name", options=comfy.samplers.KSampler.SAMPLERS,
                               default="res_multistep"),
                io.Combo.Input("scheduler", options=comfy.samplers.KSampler.SCHEDULERS,
                               default="simple",
                               tooltip="The templates use 'simple'; for reference-heavy prompts they suggest 'beta' or 'normal' instead."),
                io.Combo.Input("speed_preset", options=accel.SPEED_PRESETS, default="off", optional=True,
                               tooltip="SPEED progressive-resolution sampler: denoises initial layout at lower resolution for +40% speedup. Auto-bypasses on I2V keyframes."),
                io.Combo.Input("block_cache", options=accel.BLOCK_CACHE_MODES, default="off", optional=True,
                               tooltip="FirstBlockCache: skip the rest of the DiT on steps where the first block barely moved. 'fast' is recommended. Needs ComfyUI-MiniMaxH3-FirstBlockCache."),
                io.Boolean.Input("spectrum", default=False, optional=True,
                                 tooltip="Spectrum: forecast features across steps instead of evaluating every one. Needs ComfyUI-Spectrum-MiniMax-H3."),
                io.Float.Input("spectrum_blend", default=0.5, min=0.0, max=1.0, step=0.01, optional=True,
                               tooltip="Spectrum's video spectral share. Higher is faster and further from a native render."),
                io.Boolean.Input("low_vram_attn", default=False, optional=True,
                                 tooltip="MiniMax Low VRAM Attention: chunks multi-head attention to prevent VRAM spikes during high-res generation."),
                io.Int.Input("head_chunks", default=4, min=1, max=16, step=1, optional=True,
                             tooltip="Number of attention head chunks (4 is recommended for 12GB/16GB VRAM GPUs)."),
                io.Boolean.Input("chunk_ffn", default=False, optional=True,
                                 tooltip="MiniMax Chunk FeedForward: chunks FFN (SwiGLU/MLP) layer evaluations along sequence length to stop peak memory crashes."),
                io.Int.Input("ffn_chunks", default=2, min=1, max=8, step=1, optional=True,
                             tooltip="Number of sequential chunks for FFN layers."),
                io.Int.Input("ffn_seq_threshold", default=4096, min=256, max=65536, step=256, optional=True,
                             tooltip="Sequence token threshold above which FFN chunking activates."),
            ],
            outputs=[
                io.Image.Output("images", display_name="images"),
                io.Audio.Output("audio", display_name="audio"),
                io.Model.Output("model_fl2va", display_name="model_fl2va"),
                io.Model.Output("model_ref2va", display_name="model_ref2va"),
                io.Vae.Output("vae", display_name="vae"),
                io.Clip.Output("clip", display_name="clip"),
                io.Latent.Output("latent", display_name="latent"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def fingerprint_inputs(cls, creator_data: str, **kwargs) -> tuple:
        import os

        stamps = []
        try:
            data = json.loads(creator_data)
            for asset in data.get("assets", []):
                try:
                    stamps.append(os.path.getmtime(media.resolve(asset.get("filename", ""))))
                except Exception:
                    stamps.append(None)
            for entry in data.get("loras", []):
                try:
                    stamps.append(os.path.getmtime(lora.resolve(entry.get("name", ""))))
                except Exception:
                    stamps.append(None)
        except Exception:
            pass
        return (creator_data, tuple(stamps))

    @classmethod
    def execute(cls, creator_data: str, seed: int, steps: int, cfg: float, sampler_name: str, scheduler: str,
                speed_preset: str = "off", block_cache: str = "off", spectrum: bool = False, spectrum_blend: float = 0.5,
                low_vram_attn: bool = False, head_chunks: int = 4,
                chunk_ffn: bool = False, ffn_chunks: int = 2, ffn_seq_threshold: int = 4096) -> io.NodeOutput:
        try:
            data = json.loads(creator_data)
        except json.JSONDecodeError as exc:
            raise ValueError(f"creator_data is not valid JSON: {exc}") from exc

        payload = {"request": data, "continue": False, "continue_audio": False}
        if data.get("prompt_override"):
            payload["prompt_override"] = data["prompt_override"]

        try:
            blend_val = float(spectrum_blend) if spectrum_blend not in (None, "") else 0.5
        except (ValueError, TypeError):
            blend_val = 0.5

        acceleration = accel.Settings(
            block_cache=str(block_cache or "off"),
            spectrum=bool(spectrum),
            spectrum_blend=blend_val,
            speed_preset=str(speed_preset or "off"),
            low_vram_attn=bool(low_vram_attn),
            head_chunks=int(head_chunks or 4),
            chunk_ffn=bool(chunk_ffn),
            ffn_chunks=int(ffn_chunks or 2),
            ffn_seq_threshold=int(ffn_seq_threshold or 4096),
        )

        graph, result_links = render.emit(
            [payload], ["This generation"],
            models.Weights.from_blob(data),
            render.Sampling(seed=seed, steps=steps, cfg=cfg,
                            sampler_name=sampler_name, scheduler=scheduler),
            acceleration,
            cls.hidden.unique_id,
            filename_prefix=outputs.video(data, settings.video_prefix()))
        return render.expanded(graph, result_links)


class MiniMaxCreatorExtension(ComfyExtension):
    async def get_node_list(self):
        return [
            MiniMaxH3Creator,
            *timeline.NODES,
            *prestage.NODES,
            *hires.NODES,
            *director_node.NODES,
            *vram_patch.NODES,
            minimax_h3_speed_sampler.MiniMaxH3SPEEDSampler,
        ]


async def comfy_entrypoint() -> MiniMaxCreatorExtension:
    return MiniMaxCreatorExtension()