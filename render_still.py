"""One still from the video model, as a graph. The PreStage's H3 branch with Tiled VAE decode support."""

from __future__ import annotations

import json
from typing import Any

from . import models, outputs, render, settings

SEGMENT_NODE = "MiniMaxH3TimelineSegment"
STILL_NODE = "MiniMaxH3StillLatent"
SAVE_NODE = "MiniMaxH3SaveImage"

FILENAME_PREFIX = outputs.IMAGE_PREFIX


def weights_from_blob(data: dict | None) -> models.Weights:
    return models.Weights.from_blob(data)


def emit(plan: any, weights: models.Weights, sampling: render.Sampling, unique_id: any, filename_prefix: str = FILENAME_PREFIX) -> tuple[Any, tuple]:
    from comfy_execution.graph_utils import GraphBuilder

    labels = ["This still"]
    payloads = [weights.routed(plan.payload)]
    compiled = render.compile_all(payloads, labels)
    where = render.routed(compiled, labels)
    audio = any(one.ref_audios or any(v.track == "picture+sound" for v in one.ref_videos)
                for one in compiled)
    models.check(weights, set(where), where, audio=audio)

    graph = GraphBuilder()
    links = models.emit_links(graph, weights, set(where), audio=audio)

    inputs = {
        "clip": links.clip,
        "segment_data": json.dumps(payloads[0], sort_keys=True),
    }
    if compiled[0].encodes_video():
        inputs["vae"] = links.vae
    if links.audio_vae is not None and compiled[0].encodes_audio():
        inputs["audio_vae"] = links.audio_vae
    if links.model_fl2va is not None:
        inputs["model_fl2va"] = links.model_fl2va
    if links.model_ref2va is not None:
        inputs["model_ref2va"] = links.model_ref2va
    segment = graph.node(SEGMENT_NODE, **inputs)

    against = graph.node("ConditioningZeroOut", conditioning=segment.out(1)).out(0)
    model = models.graph_preview(graph, segment.out(0), weights)

    sampled = graph.node(
        "KSampler", model=model, positive=segment.out(1), negative=against,
        latent_image=segment.out(2), seed=sampling.seed, steps=sampling.steps,
        cfg=sampling.cfg, sampler_name=sampling.sampler_name,
        scheduler=sampling.scheduler, denoise=1.0,
    )

    still = graph.node(STILL_NODE, samples=sampled.out(0), index=plan.index).out(0)

    use_tiled = settings.tiled_vae() or (compiled[0].height > 768 or compiled[0].width > 1344)
    tile_size = settings.vae_tile_size()

    image = models.decode_vae_node(graph, samples=still, vae=links.vae, tiled=use_tiled, tile_size=tile_size)
    save = graph.node(SAVE_NODE, images=image, filename_prefix=filename_prefix)
    save.set_override_display_id(unique_id)

    return graph, (image,)