"""A clip made of several shots, in one of two ways.

Chained: one generation per segment, concatenated, with segment N able to start
from segment N-1's decoded last frame. Supports selective locking and regeneration.

One pass: the segments are compiled into a single multi-shot description and
generated in one go.
"""

import json

import torch
from comfy_api.latest import io

from . import (accel, canvas, compile as compiler, encode as encoder, lora,
               media, models, outputs, payload as payload_repair, render, settings)

DEFAULT_DATA = json.dumps({
    "version": 2,
    "render": "chained",
    "prompt": "",
    "soundscape": "",
    "music": "",
    "aspect": "16:9",
    "short_edge": 768,
    "loras": [],
    "assets": [],
    "output_prefix": outputs.VIDEO_PREFIX,
    "models": {},
    "segments": [
        {"prompt": "", "assets": [], "loras": [], "duration_s": 6, "checkpoint": "auto"},
    ],
}, indent=2)


def _parse(timeline_data):
    try:
        return json.loads(timeline_data)
    except json.JSONDecodeError as exc:
        raise ValueError(f"timeline_data is not valid JSON: {exc}") from exc


def _announce(unique_id, progress):
    from server import PromptServer

    server = getattr(PromptServer, "instance", None)
    if server is not None:
        server.send_sync("mmc_segment", {"node": unique_id, **progress})


def _stamps(data):
    import os

    out = []

    def stamp(path_of, item, key):
        try:
            out.append(os.path.getmtime(path_of(item.get(key, ""))))
        except Exception:
            out.append(None)

    for entry in data.get("loras", []) or []:
        stamp(lora.resolve, entry, "name")
    for asset in data.get("assets", []) or []:
        stamp(media.resolve, asset, "filename")
    for segment in data.get("segments", []):
        if not isinstance(segment, dict):
            continue
        for asset in segment.get("assets", []) or []:
            stamp(media.resolve, asset, "filename")
        for entry in segment.get("loras", []) or []:
            stamp(lora.resolve, entry, "name")
    return tuple(out)


class MiniMaxH3Timeline(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        import comfy.samplers

        return io.Schema(
            node_id="MiniMaxH3Timeline",
            display_name="MiniMax H3 Timeline",
            category="MiniMax",
            description=(
                "Build a clip out of several shots. Chained: each segment is a full "
                "generation with its own prompt, references and LoRAs, and can start "
                "from the previous one's last frame. One pass: the same segments become "
                "the shots of a single generation, cut times and all."
            ),
            enable_expand=True,
            is_output_node=True,
            inputs=[
                io.String.Input("timeline_data", multiline=True, default=DEFAULT_DATA),
                io.Int.Input("seed", default=0, min=0, max=0xffffffffffffffff, control_after_generate=True,
                    tooltip="Chained: segment k runs on seed + k, so consecutive shots are not the same noise with different prompts. One pass: there is one generation, so it is just the seed."),
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
    def fingerprint_inputs(cls, timeline_data, **kwargs):
        try:
            return (timeline_data, _stamps(json.loads(timeline_data)))
        except Exception:
            return (timeline_data, ())

    @classmethod
    def execute(cls, timeline_data, seed, steps, cfg, sampler_name, scheduler,
                block_cache="off", spectrum=False, spectrum_blend=0.5) -> io.NodeOutput:
        data = _parse(timeline_data)

        single = compiler.render_mode(data) == "single"
        payloads = ([compiler.single_payload(data)]
                    if single else
                    compiler.timeline_payloads(data, image_size_lookup=media.image_size))
        labels = (["This one-pass render"] if single else
                  [f"Segment {i + 1}" for i in range(len(payloads))])

        graph, result_links = render.emit(
            payloads, labels,
            models.Weights.from_blob(data),
            render.Sampling(seed=seed, steps=steps, cfg=cfg,
                            sampler_name=sampler_name, scheduler=scheduler),
            accel.Settings(block_cache=block_cache, spectrum=spectrum,
                           spectrum_blend=spectrum_blend),
            cls.hidden.unique_id,
            filename_prefix=outputs.video(data, settings.video_prefix()))
        return render.expanded(graph, result_links)


class MiniMaxH3TimelineSegment(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3TimelineSegment",
            display_name="MiniMaxH3 Timeline Segment",
            category="MiniMax/internal",
            description="One segment of a MiniMax H3 timeline. Written into the graph by the Timeline node.",
            is_dev_only=True,
            inputs=[
                io.Clip.Input("clip"),
                io.Vae.Input("vae", optional=True),
                io.Vae.Input("audio_vae", optional=True),
                io.String.Input("segment_data", multiline=True),
                io.Model.Input("model_fl2va", optional=True),
                io.Model.Input("model_ref2va", optional=True),
                io.Image.Input("prev_image", optional=True,
                    tooltip="An earlier segment's last frame, when this segment continues from it."),
                io.Audio.Input("prev_audio", optional=True,
                    tooltip="The tail of an earlier segment's soundtrack, when this segment's sound continues from it."),
                io.Image.Input("prev_step", optional=True,
                    tooltip="Guarantees strict sequential execution order (1 -> 2 -> 3) in ComfyUI graph."),
            ],
            outputs=[
                io.Model.Output(display_name="model"),
                io.Conditioning.Output(display_name="positive"),
                io.Latent.Output(),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def fingerprint_inputs(cls, segment_data, **kwargs):
        try:
            payload = json.loads(segment_data)
            return (segment_data, _stamps({"segments": [payload.get("request", {})]}))
        except Exception:
            return (segment_data, ())

    @classmethod
    def execute(cls, clip, segment_data, vae=None, audio_vae=None,
                model_fl2va=None, model_ref2va=None,
                prev_image=None, prev_audio=None, prev_step=None) -> io.NodeOutput:
        payload = _parse(segment_data)

        progress = payload.get("progress")
        if progress:
            _announce(cls.hidden.unique_id, progress)

        compiled = compiler.compile_segment(payload, image_size_lookup=media.image_size)

        if vae is None and compiled.encodes_video():
            raise ValueError(
                "This generation encodes a keyframe or a visual reference, so it "
                "needs the video VAE on 'vae'."
            )
        if audio_vae is None and compiled.encodes_audio():
            raise ValueError(
                "This generation carries sound — reference audio, or a seam "
                "continuing the previous segment's — so it needs the audio VAE "
                "on 'audio_vae'."
            )

        override = payload.get("prompt_override")
        if override:
            compiled.prompt = override

        model = {"fl2va": model_fl2va, "ref2va": model_ref2va}[compiled.checkpoint]
        if model is None:
            raise ValueError(
                f"This segment is {compiled.mode}, which needs the "
                f"{compiled.checkpoint.upper()} checkpoint — connect it to "
                f"'model_{compiled.checkpoint}'."
            )
        model = lora.apply(model, payload["request"].get("loras"), compiled.checkpoint)

        loaded = media.load_all(compiled)
        if compiled.continues:
            if prev_image is None:
                raise ValueError(
                    "This segment continues from an earlier one but no frame "
                    "reached it — the Timeline node should have wired one."
                )
            if prev_image.shape[0] < compiled.feather:
                raise ValueError(
                    f"this seam inherits {compiled.feather} frames but only "
                    f"{prev_image.shape[0]} reached it — shorten the feather "
                    f"or lengthen the source segment"
                )
            loaded[encoder.PREV_FRAME] = {"image": prev_image[-compiled.feather:]}
        if compiled.continues_audio:
            if prev_audio is None:
                raise ValueError(
                    "This segment's sound continues from an earlier one but no "
                    "audio reached it — the Timeline node should have wired some."
                )
            loaded[encoder.PREV_AUDIO] = {"audio": prev_audio}
        if compiled.continues or compiled.continues_audio:
            model = payload_repair.repair(model)

        cond, latent = encoder.encode(clip, vae, audio_vae, compiled, loaded)
        return io.NodeOutput(model, cond, latent)


class MiniMaxH3AudioTail(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3AudioTail",
            display_name="MiniMax H3 Audio Tail",
            category="MiniMax/internal",
            description="The last few seconds of a decoded soundtrack, for the next timeline segment.",
            is_dev_only=True,
            inputs=[
                io.Audio.Input("audio"),
                io.Float.Input("seconds", default=compiler.DEFAULT_AUDIO_TAIL_S,
                               min=0.1, max=compiler.MAX_AUDIO_TAIL_S, step=0.1),
            ],
            outputs=[io.Audio.Output()],
        )

    @classmethod
    def execute(cls, audio, seconds) -> io.NodeOutput:
        waveform = audio["waveform"]
        rate = int(audio["sample_rate"])
        wanted = max(1, int(round(float(seconds) * rate)))
        if waveform.shape[-1] == 0:
            raise ValueError("no audio to continue from")
        return io.NodeOutput({"waveform": waveform[..., -wanted:], "sample_rate": rate})


class MiniMaxH3LastFrame(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3LastFrame",
            display_name="MiniMax H3 Last Frame",
            category="MiniMax/internal",
            description="The final frames of a decoded batch — what the next timeline segment continues from.",
            is_dev_only=True,
            inputs=[
                io.Image.Input("image"),
                io.Int.Input("count", default=1, min=1, max=64, optional=True),
            ],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, image, count=1) -> io.NodeOutput:
        count = max(1, int(count))
        if image.shape[0] < count:
            raise ValueError(
                f"the source segment has {image.shape[0]} frames and this seam "
                f"inherits {count} — shorten the feather or lengthen the source"
                if image.shape[0] else "no frames to continue from"
            )
        return io.NodeOutput(image[-count:])


class MiniMaxH3SeamTrim(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3SeamTrim",
            display_name="MiniMax H3 Seam Trim",
            category="MiniMax/internal",
            description="Drops a feathered seam's re-generated overlap from the front of a decoded segment.",
            is_dev_only=True,
            inputs=[
                io.Image.Input("images"),
                io.Audio.Input("audio"),
                io.Int.Input("frames", default=0, min=0, max=64),
            ],
            outputs=[io.Image.Output(display_name="images"), io.Audio.Output(display_name="audio")],
        )

    @classmethod
    def execute(cls, images, audio, frames) -> io.NodeOutput:
        frames = int(frames)
        if frames <= 0:
            return io.NodeOutput(images, audio)
        if images.shape[0] <= frames:
            raise ValueError(
                f"cannot trim {frames} inherited frames off a "
                f"{images.shape[0]}-frame segment"
            )
        rate = int(audio["sample_rate"])
        samples = int(round(frames / canvas.FPS * rate))
        return io.NodeOutput(
            images[frames:],
            {"waveform": audio["waveform"][..., samples:], "sample_rate": rate},
        )


class MiniMaxH3TimelineJoin(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3TimelineJoin",
            display_name="MiniMax H3 Timeline Join",
            category="MiniMax/internal",
            description="Concatenates two timeline segments' frames and audio.",
            is_dev_only=True,
            inputs=[
                io.Image.Input("images_a"),
                io.Audio.Input("audio_a"),
                io.Image.Input("images_b"),
                io.Audio.Input("audio_b"),
            ],
            outputs=[io.Image.Output(display_name="images"), io.Audio.Output(display_name="audio")],
        )

    @classmethod
    def execute(cls, images_a, audio_a, images_b, audio_b) -> io.NodeOutput:
        if images_a.shape[1:] != images_b.shape[1:]:
            raise ValueError(
                f"segments are different sizes and cannot be joined: "
                f"{images_a.shape[2]}x{images_a.shape[1]} vs {images_b.shape[2]}x{images_b.shape[1]}"
            )
        images = torch.cat([images_a, images_b.to(images_a)], dim=0)

        rate_a, rate_b = int(audio_a["sample_rate"]), int(audio_b["sample_rate"])
        if rate_a != rate_b:
            raise ValueError(f"segments have different sample rates ({rate_a} vs {rate_b})")
        wave_a, wave_b = audio_a["waveform"], audio_b["waveform"].to(audio_a["waveform"])
        if wave_a.shape[:-1] != wave_b.shape[:-1]:
            raise ValueError(
                f"segments have different audio shapes ({tuple(wave_a.shape)} vs {tuple(wave_b.shape)})")
        audio = {"waveform": torch.cat([wave_a, wave_b], dim=-1), "sample_rate": rate_a}
        return io.NodeOutput(images, audio)


class MiniMaxH3Save(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3Save",
            display_name="MiniMax H3 Save",
            category="MiniMax/internal",
            description="Muxes a render's frames and sound into one file under output/.",
            is_dev_only=True,
            is_output_node=True,
            inputs=[
                io.Image.Input("images"),
                io.Audio.Input("audio"),
                io.Float.Input("fps", default=float(canvas.FPS), min=1.0, max=120.0),
                io.String.Input("filename_prefix", default="minimax/H3"),
                io.Int.Input("crf", default=settings.DEFAULT_CRF,
                             min=settings.MIN_CRF, max=settings.MAX_CRF),
            ],
            outputs=[],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, images, audio, fps, filename_prefix,
                crf=settings.DEFAULT_CRF) -> io.NodeOutput:
        import inspect
        import os
        from fractions import Fraction

        import folder_paths
        from comfy.cli_args import args
        from comfy_api.latest import InputImpl, Types

        height, width = int(images.shape[1]), int(images.shape[2])
        directory, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_output_directory(), width, height)

        metadata = None
        if not args.disable_metadata:
            collected = dict(cls.hidden.extra_pnginfo or {})
            if cls.hidden.prompt is not None:
                collected["prompt"] = cls.hidden.prompt
            metadata = collected or None

        video = InputImpl.VideoFromComponents(Types.VideoComponents(
            images=images, audio=audio, frame_rate=Fraction(round(float(fps)))))
        filename = f"{name}_{counter:05}_.mp4"
        quality = {"crf": float(crf)}
        if "crf" not in inspect.signature(video.save_to).parameters:
            if int(crf) != settings.DEFAULT_CRF:
                raise RuntimeError(
                    f"Output quality (crf {int(crf)}) needs ComfyUI 0.29 or newer — "
                    f"this one can only write libx264's default of {settings.DEFAULT_CRF}. "
                    "Update ComfyUI, or set the quality back to Standard.")
            quality = {}
        video.save_to(os.path.join(directory, filename),
                      format=Types.VideoContainer.MP4,
                      codec=Types.VideoCodec.H264,
                      metadata=metadata,
                      **quality)

        output_item = {"filename": filename, "subfolder": subfolder, "type": "output"}
        return io.NodeOutput(ui={
            "mmc_video": [output_item],
            "videos": [output_item],
            "gifs": [output_item],
        })


class MiniMaxH3SaveSegment(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3SaveSegment",
            display_name="MiniMax H3 Save Segment",
            category="MiniMax/internal",
            description="Auto-saves an intermediate timeline segment for selective re-rendering.",
            is_dev_only=True,
            is_output_node=True,
            inputs=[
                io.Image.Input("images"),
                io.Audio.Input("audio"),
                io.Float.Input("fps", default=float(canvas.FPS)),
                io.String.Input("filename_prefix", default="minimax/renders/H3"),
                io.Int.Input("segment_index", default=1),
                io.String.Input("parent_node_id", default=""),
                io.Int.Input("crf", default=settings.DEFAULT_CRF),
            ],
            outputs=[],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, images, audio, fps, filename_prefix, segment_index, parent_node_id="",
                crf=settings.DEFAULT_CRF) -> io.NodeOutput:
        import inspect
        import os
        from fractions import Fraction
        import folder_paths
        from comfy_api.latest import InputImpl, Types
        from server import PromptServer

        height, width = int(images.shape[1]), int(images.shape[2])
        seg_prefix = f"{filename_prefix.rstrip('/')}_seg{int(segment_index)}"
        directory, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            seg_prefix, folder_paths.get_output_directory(), width, height)

        video = InputImpl.VideoFromComponents(Types.VideoComponents(
            images=images, audio=audio, frame_rate=Fraction(round(float(fps)))))
        filename = f"{name}_{counter:05}_.mp4"
        full_path = os.path.join(directory, filename)
        
        quality = {"crf": float(crf)}
        if "crf" not in inspect.signature(video.save_to).parameters:
            quality = {}
            
        video.save_to(full_path,
                      format=Types.VideoContainer.MP4,
                      codec=Types.VideoCodec.H264,
                      **quality)

        output_path = f"{subfolder}/{filename}" if subfolder else filename
        cached_result = output_path + " [output]"
        
        target_node = str(parent_node_id).strip() if str(parent_node_id).strip() else cls.hidden.unique_id

        server = getattr(PromptServer, "instance", None)
        if server is not None:
            server.send_sync("mmc_segment_cached", {
                "node": target_node,
                "segment_index": int(segment_index),
                "cached_video": cached_result,
            })

        return io.NodeOutput(ui={
            "mmc_segment_cached": [{
                "index": int(segment_index),
                "cached_video": cached_result,
            }],
        })


class MiniMaxH3LoadSegment(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3LoadSegment",
            display_name="MiniMax H3 Load Segment",
            category="MiniMax/internal",
            description="Loads a cached timeline segment to bypass DiT sampling.",
            is_dev_only=True,
            inputs=[
                io.String.Input("video_path"),
            ],
            outputs=[
                io.Image.Output(display_name="images"),
                io.Audio.Output(display_name="audio"),
            ],
        )

    @classmethod
    def execute(cls, video_path) -> io.NodeOutput:
        frames, audio = media.load_video(video_path, want_audio=True)
        if audio is None:
            audio = {"waveform": torch.zeros((1, 2, frames.shape[0] * 1000), dtype=torch.float32), "sample_rate": 24000}
        return io.NodeOutput(frames, audio)


NODES = [MiniMaxH3Timeline, MiniMaxH3TimelineSegment, MiniMaxH3LastFrame,
         MiniMaxH3SeamTrim, MiniMaxH3AudioTail, MiniMaxH3TimelineJoin,
         MiniMaxH3Save, MiniMaxH3SaveSegment, MiniMaxH3LoadSegment]