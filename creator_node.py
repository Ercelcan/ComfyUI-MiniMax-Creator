"""The MiniMax H3 Creator node."""

import json

from comfy_api.latest import ComfyExtension, io

from . import (accel, canvas, director_node, hires, lora, media, models, outputs, prestage,
               render, settings, timeline)

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
                io.Combo.Input("block_cache", options=accel.BLOCK_CACHE_MODES, default="off",
                    tooltip="FirstBlockCache: skip the rest of the DiT on steps where the first block barely moved. 'fast' is the pack's recommended preset. Needs ComfyUI-MiniMaxH3-FirstBlockCache."),
                io.Boolean.Input("spectrum", default=False,
                    tooltip="Spectrum: forecast features across steps instead of evaluating every one. Needs ComfyUI-Spectrum-MiniMax-H3. Combines with block_cache; cannot be combined with EasyCache."),
                io.Float.Input("spectrum_blend", default=0.5, min=0.0, max=1.0, step=0.01,
                    tooltip="Spectrum's video spectral share. Higher is faster and further from a native render. Ignored unless 'spectrum' is on."),
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
    def fingerprint_inputs(cls, creator_data, **kwargs):
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
    def execute(cls, creator_data, seed, steps, cfg, sampler_name, scheduler,
                block_cache="off", spectrum=False, spectrum_blend=0.5) -> io.NodeOutput:
        try:
            data = json.loads(creator_data)
        except json.JSONDecodeError as exc:
            raise ValueError(f"creator_data is not valid JSON: {exc}") from exc

        payload = {"request": data, "continue": False, "continue_audio": False}
        if data.get("prompt_override"):
            payload["prompt_override"] = data["prompt_override"]

        graph, result_links = render.emit(
            [payload], ["This generation"],
            models.Weights.from_blob(data),
            render.Sampling(seed=seed, steps=steps, cfg=cfg,
                            sampler_name=sampler_name, scheduler=scheduler),
            accel.Settings(block_cache=block_cache, spectrum=spectrum,
                           spectrum_blend=spectrum_blend),
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
        ]


async def comfy_entrypoint() -> MiniMaxCreatorExtension:
    return MiniMaxCreatorExtension()