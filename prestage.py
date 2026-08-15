"""The MiniMax H3 PreStage node: stills for the pipeline, made on the left."""

import json

from comfy_api.latest import io

from . import (canvas, compile_image, compile_still, media, outputs, render,
               render_image, render_still, settings)

DEFAULT_DATA = json.dumps({
    "version": 1,
    "arch": compile_image.DEFAULT_ARCH,
    "prompt": "",
    "aspect": compile_image.DEFAULT_ASPECT,
    "short_edge": compile_image.DEFAULT_SHORT_EDGE,
    "init": None,
    "refs": [],
    "loras": [],
    "turbo": {"on": False, "quality": compile_image.DEFAULT_TURBO_QUALITY, "saved": None},
    "quality": compile_image.DEFAULT_IDEOGRAM_QUALITY,
    "output_prefix": outputs.IMAGE_PREFIX,
    "minimax": {
        "frames": compile_still.DEFAULT_FRAMES,
        "latent_index": compile_still.DEFAULT_LATENT_INDEX,
        "request": {"prompt": "", "assets": [], "loras": [],
                    "aspect": "16:9", "short_edge": canvas.NATIVE_SHORT_EDGE,
                    "output_prefix": outputs.IMAGE_PREFIX, "models": {}},
    },
    "models": {"krea2": {}, "ideogram4": {}, "minimax": {}},
    "peer": None,
}, indent=2)


class MiniMaxH3PreStage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        import comfy.samplers

        return io.Schema(
            node_id="MiniMaxH3PreStage",
            display_name="MiniMax H3 PreStage",
            category="MiniMax",
            description=(
                "Generate a still with Krea 2, Ideogram 4.0 or MiniMax H3 for "
                "the video pipeline — a start or end frame, a reference, a style "
                "sheet. Spawned from the pre-stage pill on a Creator or Timeline."
            ),
            enable_expand=True,
            is_output_node=True,
            inputs=[
                io.String.Input("prestage_data", multiline=True, default=DEFAULT_DATA),
                io.Int.Input("seed", default=0, min=0, max=0xffffffffffffffff, control_after_generate=True),
                io.Int.Input("steps", default=compile_image.KREA_RAW["steps"], min=1, max=10000),
                io.Float.Input("cfg", default=compile_image.KREA_RAW["cfg"], min=0.0, max=100.0, step=0.1, round=0.01),
                io.Combo.Input("sampler_name", options=comfy.samplers.KSampler.SAMPLERS,
                               default=compile_image.KREA_RAW["sampler_name"]),
                io.Combo.Input("scheduler", options=comfy.samplers.KSampler.SCHEDULERS,
                               default=compile_image.KREA_RAW["scheduler"],
                               tooltip="Krea 2 samples on this schedule. Ideogram 4 owns its own resolution-shifted schedule and ignores it."),
            ],
            outputs=[
                io.Image.Output("image", display_name="image"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def fingerprint_inputs(cls, prestage_data, **kwargs):
        import os

        from . import lora

        stamps = []
        try:
            data = json.loads(prestage_data)
            names = [ref.get("filename") if isinstance(ref, dict) else ref
                     for ref in data.get("refs") or []]
            init = data.get("init")
            if isinstance(init, dict):
                names.append(init.get("filename"))
            still = (data.get("minimax") or {}).get("request") or {}
            names.extend(asset.get("filename") for asset in still.get("assets") or [])
            entries = list(data.get("loras") or []) + list(still.get("loras") or [])
            for name in names:
                try:
                    stamps.append(os.path.getmtime(media.resolve(name or "")))
                except Exception:
                    stamps.append(None)
            for entry in entries:
                try:
                    stamps.append(os.path.getmtime(lora.resolve(entry.get("name", ""))))
                except Exception:
                    stamps.append(None)
        except Exception:
            pass
        return (prestage_data, tuple(stamps))

    @classmethod
    def execute(cls, prestage_data, seed, steps, cfg, sampler_name, scheduler) -> io.NodeOutput:
        try:
            data = json.loads(prestage_data)
        except json.JSONDecodeError as exc:
            raise ValueError(f"prestage_data is not valid JSON: {exc}") from exc

        if data.get("arch") == compile_still.ARCH:
            try:
                plan = compile_still.compile_still(data)
            except compile_image.CompileError as exc:
                raise ValueError(str(exc)) from exc
            request = plan.request
            graph, results = render_still.emit(
                plan,
                render_still.weights_from_blob(request),
                render.Sampling(seed=seed, steps=steps, cfg=cfg,
                                sampler_name=sampler_name, scheduler=scheduler),
                cls.hidden.unique_id,
                filename_prefix=outputs.image(request, settings.image_prefix()))
            return render.expanded(graph, results)

        try:
            payload = compile_image.compile_prestage(data, media.image_size)
        except compile_image.CompileError as exc:
            raise ValueError(str(exc)) from exc

        graph, results = render_image.emit(
            payload,
            render_image.ImageWeights.from_blob(data),
            render.Sampling(seed=seed, steps=steps, cfg=cfg,
                            sampler_name=sampler_name, scheduler=scheduler),
            cls.hidden.unique_id,
            filename_prefix=outputs.image(data, settings.image_prefix()))
        return render.expanded(graph, results)


class MiniMaxH3SaveImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3SaveImage",
            display_name="MiniMax H3 Save Image",
            category="MiniMax/internal",
            description="Writes a pre-stage render under output/ and reports it to the stage card.",
            is_dev_only=True,
            is_output_node=True,
            inputs=[
                io.Image.Input("images"),
                io.String.Input("filename_prefix", default=render_image.FILENAME_PREFIX),
            ],
            outputs=[],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, images, filename_prefix) -> io.NodeOutput:
        import os

        import numpy as np
        from PIL import Image
        from PIL.PngImagePlugin import PngInfo

        import folder_paths
        from comfy.cli_args import args

        height, width = int(images.shape[1]), int(images.shape[2])
        directory, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_output_directory(), width, height)

        metadata = None
        if not args.disable_metadata:
            metadata = PngInfo()
            if cls.hidden.prompt is not None:
                metadata.add_text("prompt", json.dumps(cls.hidden.prompt))
            for key, value in (cls.hidden.extra_pnginfo or {}).items():
                metadata.add_text(key, json.dumps(value))

        results = []
        for image in images:
            array = (image.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
            filename = f"{name}_{counter:05}_.png"
            Image.fromarray(array).save(os.path.join(directory, filename),
                                        pnginfo=metadata, compress_level=4)
            results.append({"filename": filename, "subfolder": subfolder, "type": "output"})
            counter += 1

        return io.NodeOutput(ui={
            "mmc_image": results,
            "images": results,
        })


class MiniMaxH3StillLatent(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3StillLatent",
            display_name="MiniMax H3 Still Latent",
            category="MiniMax/internal",
            description="Takes one temporal frame of a sampled H3 latent as a single-image latent.",
            is_dev_only=True,
            inputs=[
                io.Latent.Input("samples"),
                io.Int.Input("index", default=0, min=-4096, max=4096,
                             tooltip="Which latent frame becomes the picture. 0 is the causal first frame — the slice the image VAE was trained on. Negative counts from the end."),
            ],
            outputs=[io.Latent.Output()],
        )

    @classmethod
    def execute(cls, samples, index) -> io.NodeOutput:
        latent = samples["samples"]
        video = latent.unbind()[0] if getattr(latent, "is_nested", False) else latent
        if video.ndim != 5:
            raise ValueError(
                f"This is not a video latent — it has {video.ndim} dimensions, and "
                f"an H3 latent has five [B, 24, T, H/16, W/16]."
            )

        total = video.shape[2]
        resolved = index if index >= 0 else total + index
        if not 0 <= resolved < total:
            raise ValueError(
                f"Latent frame {index} does not exist: this clip packs into "
                f"{total} latent frames (0..{total - 1})."
            )
        return io.NodeOutput({"samples": video[:, :, resolved:resolved + 1].contiguous()})


NODES = [MiniMaxH3PreStage, MiniMaxH3SaveImage, MiniMaxH3StillLatent]