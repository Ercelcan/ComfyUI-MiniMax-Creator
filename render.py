"""Complete Graph Builder for MiniMax H3: Linear Overlap Seam Blending, Latent Chaining, Tiled VAE Decoding, 2-Pass Refine Upscaling, SPEED Progressive Sampling, and NVIDIA RTX VSR."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional

from comfy_api.latest import io
from comfy_execution.graph_utils import GraphBuilder

from . import accel, canvas, compile as compiler, lora, media, models, outputs, settings

SEGMENT_NODE = "MiniMaxH3TimelineSegment"
REFINE_NODE = "MiniMaxH3RefinePass"
RTX_NODE = "MiniMaxH3RTXUpscale"
LAST_FRAME_NODE = "MiniMaxH3LastFrame"
AUDIO_TAIL_NODE = "MiniMaxH3AudioTail"
TRIM_NODE = "MiniMaxH3SeamTrim"
JOIN_NODE = "MiniMaxH3TimelineJoin"
STREAMED_ASSEMBLY_NODE = "MiniMaxH3StreamedAssembly"
SAVE_NODE = "MiniMaxH3Save"
SAVE_SEGMENT_NODE = "MiniMaxH3SaveSegment"
LOAD_SEGMENT_NODE = "MiniMaxH3LoadSegment"

FILENAME_PREFIX = outputs.VIDEO_PREFIX


@dataclass(frozen=True)
class Sampling:
    seed: int = 0
    steps: int = 20
    cfg: float = 1.0
    sampler_name: str = "res_multistep"
    scheduler: str = "simple"


@dataclass(frozen=True)
class Links:
    clip: Any
    vae: Any
    audio_vae: Any
    model_fl2va: Optional[Any] = None
    model_ref2va: Optional[Any] = None

    def model_for(self, checkpoint: str) -> Any:
        return {"fl2va": self.model_fl2va, "ref2va": self.model_ref2va}[checkpoint]


def compile_all(payloads: list[dict], labels: list[str]) -> list[any]:
    out = []
    for index, payload in enumerate(payloads):
        where = labels[index] if index < len(labels) else f"Segment {index + 1}"
        try:
            out.append(compiler.compile_segment(payload, media.image_size))
        except compiler.CompileError as exc:
            raise ValueError(f"{where}: {exc}") from exc
    return out


def routed(compiled: list[any], labels: list[str]) -> dict[str, str]:
    where = {}
    for index, one in enumerate(compiled):
        label = labels[index] if index < len(labels) else f"Segment {index + 1}"
        where.setdefault(one.checkpoint, label)
    return where


def emit(payloads: list[dict], labels: list[str], weights: models.Weights, sampling: Sampling, acceleration: accel.Settings, unique_id: any,
         filename_prefix: str = FILENAME_PREFIX) -> tuple[GraphBuilder, tuple]:
    # Evict any active LLMs from GPU VRAM before sampling H3
    try:
        from . import refine_api
        refine_api.unload_all_active_refiners()
    except Exception:
        pass

    accel.plan(acceleration)
    payloads = [weights.routed(p) for p in payloads]
    if len(payloads) > 1:
        payloads = [{**p, "progress": {"index": i + 1, "segment_index": i}} for i, p in enumerate(payloads)]

    compiled = compile_all(payloads, labels)
    where = routed(compiled, labels)
    models.check(weights, set(where), where)
    graph = GraphBuilder()
    links = models.emit_links(graph, weights, set(where))

    use_tiled_vae = settings.tiled_vae() or bool(payloads[0].get("request", {}).get("tiled_vae"))
    vae_tile_size = settings.vae_tile_size()

    sampled_latents = []
    decoded_segments = []
    joined = None
    last_latent = None

    for index, one in enumerate(compiled):
        source_idx = payloads[index].get("continue_from", index - 1) if index > 0 else 0
        source = (
            decoded_segments[source_idx]
            if (index > 0 and 0 <= source_idx < len(decoded_segments))
            else (None, None)
        )
        prev_latent_link = (
            sampled_latents[source_idx]
            if (index > 0 and 0 <= source_idx < len(sampled_latents) and sampled_latents[source_idx] is not None)
            else None
        )

        if one.locked and one.cached_video:
            loaded = graph.node(LOAD_SEGMENT_NODE, video_path=one.cached_video)
            images, audio, cached_lat = loaded.out(0), loaded.out(1), loaded.out(2)
            decoded_segments.append((images, audio))
            sampled_latents.append(cached_lat)
        else:
            inputs = {
                "clip": links.clip,
                "segment_data": json.dumps(payloads[index], sort_keys=True),
            }
            if one.encodes_video():
                inputs["vae"] = links.vae
            if one.encodes_audio():
                inputs["audio_vae"] = links.audio_vae
            if links.model_fl2va is not None:
                inputs["model_fl2va"] = links.model_fl2va
            if links.model_ref2va is not None:
                inputs["model_ref2va"] = links.model_ref2va

            # Continuity: Latent & Frame context from previous shot
            prev_audio_needed = bool(
                one.continues_audio
                and source[1] is not None
                and not (one.continuity_mode == "av_mask" and prev_latent_link is not None)
            )
            if one.continues:
                if prev_latent_link is not None:
                    inputs["prev_latent"] = prev_latent_link
                if one.continuity_mode == "av_mask":
                    # AV-masked continuation carries picture AND audio through the
                    # joint prev_latent + denoise mask alone, so the prior clip is
                    # not decoded into keyframes — skip frame/audio inputs entirely
                    # to keep the sampler uncontended and decode only at save/join.
                    pass
                elif source[0] is not None:
                    inputs["prev_image"] = graph.node(
                        LAST_FRAME_NODE, image=source[0],
                        **({"count": max(1, one.feather)} if one.feather > 1 else {})
                    ).out(0)
                    inputs["source_frames"] = source[0]
                    if source[1] is not None:
                        inputs["source_audio"] = source[1]

            if one.continues_audio and prev_audio_needed:
                inputs["prev_audio"] = graph.node(
                    AUDIO_TAIL_NODE, audio=source[1], seconds=one.audio_tail_s
                ).out(0)

            segment = graph.node(SEGMENT_NODE, **inputs)
            against = graph.node("ConditioningZeroOut", conditioning=segment.out(1)).out(0)

            # Apply FirstBlockCache, Spectrum, Low VRAM Attention, and Chunk FeedForward
            model = accel.graph_apply(graph, segment.out(0), acceleration)
            model = models.graph_preview(graph, model, weights)

            # ==================================================================
            # PASS 1: Base Generation (SPEED Sampler or KSampler)
            # ==================================================================
            if acceleration.is_speed_enabled:
                sigmas_node = graph.node(
                    "BasicScheduler",
                    scheduler=sampling.scheduler,
                    steps=sampling.steps,
                    denoise=1.0,
                    model=model,
                ).out(0)

                guider_node = graph.node(
                    "BasicGuider",
                    model=model,
                    conditioning=segment.out(1),
                ).out(0)

                noise_node = graph.node(
                    "RandomNoise",
                    noise_seed=sampling.seed + index,
                ).out(0)

                speed_sampled = graph.node(
                    accel.SPEED_SAMPLER_NODE,
                    noise=noise_node,
                    guider=guider_node,
                    sigmas=sigmas_node,
                    latent_image=segment.out(2),
                    preset=acceleration.speed_preset,
                    coarse_steps_override=acceleration.speed_coarse_steps,
                    sampling_mode="Auto",
                    noise_policy=acceleration.speed_noise_policy,
                    seed_offset=10000,
                )
                base_latent = speed_sampled.out(0)
            else:
                sampled = graph.node(
                    "KSampler",
                    model=model, positive=segment.out(1), negative=against,
                    latent_image=segment.out(2),
                    seed=sampling.seed + index, steps=sampling.steps, cfg=sampling.cfg,
                    sampler_name=sampling.sampler_name, scheduler=sampling.scheduler,
                    denoise=1.0,
                )
                base_latent = sampled.out(0)

            current_video_latent = base_latent
            last_latent = base_latent

            # ==================================================================
            # PASS 2: Latent Upscaling & Refine Pass
            # ==================================================================
            if one.refine:
                spec = {
                    "width": one.refine.width, "height": one.refine.height,
                    "ratio": one.ratio, "label": one.ratio_label,
                    "from_image": one.ratio_from_image, "clamped": one.ratio_clamped,
                }
                refine_inputs = dict(inputs)
                refine_inputs["segment_data"] = json.dumps({**payloads[index], "canvas": spec}, sort_keys=True)
                second = graph.node(SEGMENT_NODE, **refine_inputs)
                refine_against = graph.node("ConditioningZeroOut", conditioning=second.out(1)).out(0)
                refine_model = accel.graph_apply(graph, second.out(0), acceleration)

                refine_sampler = sampling.sampler_name
                refine_scheduler = sampling.scheduler
                refine_steps = one.refine.steps

                turbo_cfg = payloads[index].get("request", {}).get("turbo", {})
                if one.refine.turbo_only and not turbo_cfg.get("on"):
                    turbo_lora_name = turbo_cfg.get("lora") or turbo_cfg.get("ref_lora")
                    if turbo_lora_name:
                        refine_model = graph.node(
                            "LoraLoaderModelOnly",
                            model=refine_model,
                            lora_name=turbo_lora_name,
                            strength_model=0.85,
                        ).out(0)
                        refine_sampler = "euler"
                        refine_scheduler = "simple"
                        refine_steps = max(1, refine_steps)

                refine_model = models.graph_preview(graph, refine_model, weights)

                sampled_refine = graph.node(
                    REFINE_NODE,
                    model=refine_model, positive=second.out(1), negative=refine_against,
                    latent=base_latent,
                    width=one.refine.width, height=one.refine.height,
                    seed=sampling.seed + index,
                    steps=refine_steps,
                    cfg=sampling.cfg,
                    sampler_name=refine_sampler,
                    scheduler=refine_scheduler,
                    denoise=one.refine.denoise,
                    upscaler_model=one.refine.upscaler_model,
                    scale=one.refine.scale,
                    clean_vram=one.refine.clean_vram,
                )
                current_video_latent = sampled_refine.out(0)
                last_latent = current_video_latent

            sampled_latents.append(current_video_latent)

            # Video decodes from Pass 2 (upscaled & refined) or Pass 1
            images = models.decode_vae_node(
                graph,
                samples=current_video_latent,
                vae=links.vae,
                tiled=use_tiled_vae or (one.height > 768 or one.width > 1344),
                tile_size=vae_tile_size,
            )

            # ==================================================================
            # PASS 3: NVIDIA RTX Video Super Resolution (Pixel Level)
            # ==================================================================
            if getattr(one, "rtx_upscale", False):
                rtx_run = graph.node(
                    RTX_NODE,
                    images=images,
                    scale=float(getattr(one, "rtx_scale", 2.0)),
                    quality=str(getattr(one, "rtx_quality", "ULTRA")),
                    enabled=True,
                )
                images = rtx_run.out(0)

            # Audio decodes directly from Pass 1 (full base generation) or studio track
            if one.master_audio_track:
                audio = segment.out(3)
            else:
                audio = graph.node("VAEDecodeAudio", samples=base_latent, vae=links.audio_vae).out(0)

            # Optional: Save the non-upscaled Pass 1 base video alongside the final upscaled video
            if one.refine and one.refine.save_pass1:
                pass1_images = models.decode_vae_node(
                    graph,
                    samples=base_latent,
                    vae=links.vae,
                    tiled=use_tiled_vae,
                    tile_size=vae_tile_size,
                )
                pass1_prefix = f"{filename_prefix.rstrip('/')}_base"
                graph.node(
                    SAVE_NODE,
                    images=pass1_images,
                    audio=audio,
                    fps=float(canvas.FPS),
                    filename_prefix=pass1_prefix,
                    crf=settings.video_crf(),
                )

            if len(compiled) > 1:
                saved_seg = graph.node(
                    SAVE_SEGMENT_NODE,
                    images=images,
                    audio=audio,
                    latent=current_video_latent,
                    fps=float(canvas.FPS),
                    filename_prefix=filename_prefix,
                    segment_index=index + 1,
                    parent_node_id=str(unique_id),
                    crf=settings.video_crf(),
                )
                saved_seg.set_override_display_id(unique_id)

            decoded_segments.append((images, audio))

        if joined is None:
            joined = (images, audio)
        else:
            overlap = one.feather if (one.continues and one.feather > 0) else 0
            gain_val = float(getattr(one, "gain", 1.0))
            pair = graph.node(
                JOIN_NODE,
                images_a=joined[0], audio_a=joined[1],
                images_b=images, audio_b=audio,
                overlap_frames=overlap,
                gain_b=gain_val,
            )
            joined = (pair.out(0), pair.out(1))

    emit_tail(graph, joined[0], joined[1], unique_id, filename_prefix)

    result_links = (
        joined[0],
        joined[1],
        links.model_fl2va,
        links.model_ref2va,
        links.vae,
        links.clip,
        last_latent,
    )
    return graph, result_links


def emit_tail(graph: GraphBuilder, images: Any, audio: Any, unique_id: Any, filename_prefix: str = FILENAME_PREFIX) -> Any:
    save = graph.node(
        SAVE_NODE,
        images=images,
        audio=audio,
        fps=float(canvas.FPS),
        filename_prefix=filename_prefix,
        crf=settings.video_crf(),
    )
    save.set_override_display_id(unique_id)
    return save


class _NoExportedLinks(io.NodeOutput):
    @property
    def result(self) -> tuple:
        return ()


def expanded(graph: GraphBuilder, outputs: tuple = ()) -> io.NodeOutput:
    if not outputs:
        return _NoExportedLinks(expand=graph.finalize())
    return io.NodeOutput(*outputs, expand=graph.finalize())