"""Complete Graph Builder for MiniMax H3: Linear Overlap Seam Blending & Latent Chaining."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional

from comfy_api.latest import io
from comfy_execution.graph_utils import GraphBuilder

from . import accel, canvas, compile as compiler, media, models, outputs, settings

SEGMENT_NODE = "MiniMaxH3TimelineSegment"
REFINE_NODE = "MiniMaxH3RefinePass"
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

    def model_for(self, checkpoint: str):
        return {"fl2va": self.model_fl2va, "ref2va": self.model_ref2va}[checkpoint]


def compile_all(payloads, labels):
    out = []
    for index, payload in enumerate(payloads):
        where = labels[index] if index < len(labels) else f"Segment {index + 1}"
        try:
            out.append(compiler.compile_segment(payload, media.image_size))
        except compiler.CompileError as exc:
            raise ValueError(f"{where}: {exc}") from exc
    return out


def routed(compiled, labels):
    where = {}
    for index, one in enumerate(compiled):
        label = labels[index] if index < len(labels) else f"Segment {index + 1}"
        where.setdefault(one.checkpoint, label)
    return where


def emit(payloads, labels, weights, sampling, acceleration, unique_id,
         filename_prefix=FILENAME_PREFIX):
    accel.plan(acceleration)
    payloads = [weights.routed(p) for p in payloads]
    if len(payloads) > 1:
        payloads = [{**p, "progress": {"index": i + 1}} for i, p in enumerate(payloads)]

    compiled = compile_all(payloads, labels)
    where = routed(compiled, labels)
    models.check(weights, set(where), where)

    graph = GraphBuilder()
    links = models.emit_links(graph, weights, set(where))

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
            if one.continues:
                if prev_latent_link is not None:
                    inputs["prev_latent"] = prev_latent_link
                if source[0] is not None:
                    inputs["prev_image"] = graph.node(
                        LAST_FRAME_NODE, image=source[0],
                        **({"count": max(1, one.feather)} if one.feather > 1 else {})
                    ).out(0)
                    inputs["source_frames"] = source[0]
                    if source[1] is not None:
                        inputs["source_audio"] = source[1]

            if one.continues_audio and source[1] is not None:
                inputs["prev_audio"] = graph.node(
                    AUDIO_TAIL_NODE, audio=source[1], seconds=one.audio_tail_s
                ).out(0)

            if index > 0 and decoded_segments:
                inputs["prev_step"] = decoded_segments[index - 1][0]

            segment = graph.node(SEGMENT_NODE, **inputs)
            against = graph.node("ConditioningZeroOut", conditioning=segment.out(1)).out(0)

            model = accel.graph_apply(graph, segment.out(0), acceleration)
            model = models.graph_preview(graph, model, weights)

            sampled = graph.node(
                "KSampler",
                model=model, positive=segment.out(1), negative=against,
                latent_image=segment.out(2),
                seed=sampling.seed + index, steps=sampling.steps, cfg=sampling.cfg,
                sampler_name=sampling.sampler_name, scheduler=sampling.scheduler,
                denoise=1.0,
            )
            current_latent = sampled.out(0)
            last_latent = current_latent

            # Two-Pass Refinement
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
                refine_model = models.graph_preview(graph, refine_model, weights)
                sampled = graph.node(
                    REFINE_NODE,
                    model=refine_model, positive=second.out(1), negative=refine_against,
                    latent=current_latent,
                    width=one.refine.width, height=one.refine.height,
                    seed=sampling.seed + index, steps=sampling.steps, cfg=sampling.cfg,
                    sampler_name=sampling.sampler_name, scheduler=sampling.scheduler,
                    denoise=one.refine.denoise,
                )
                current_latent = sampled.out(0)
                last_latent = current_latent

            sampled_latents.append(current_latent)

            images = graph.node("VAEDecode", samples=current_latent, vae=links.vae).out(0)
            audio = graph.node("VAEDecodeAudio", samples=current_latent, vae=links.audio_vae).out(0)

            if len(compiled) > 1:
                saved_seg = graph.node(
                    SAVE_SEGMENT_NODE,
                    images=images,
                    audio=audio,
                    latent=current_latent,
                    fps=float(canvas.FPS),
                    filename_prefix=filename_prefix,
                    segment_index=index + 1,
                    parent_node_id=str(unique_id),
                    crf=settings.video_crf(),
                )
                saved_seg.set_override_display_id(unique_id)

            decoded_segments.append((images, audio))

        # Join with linear overlap blending across the feather context
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


def emit_tail(graph, images, audio, unique_id, filename_prefix=FILENAME_PREFIX):
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
    def result(self):
        return ()


def expanded(graph, outputs=()):
    if not outputs:
        return _NoExportedLinks(expand=graph.finalize())
    return io.NodeOutput(*outputs, expand=graph.finalize())