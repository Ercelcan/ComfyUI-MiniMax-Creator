"""Conditioning + AV latent for a compiled request.

This is a re-dispatch of core's `MiniMaxH3ImageToVideo` / `MiniMaxH3ReferenceToVideo`
against `Compiled` instead of against node sockets. The sizing and payload
helpers are imported from core rather than copied, so upstream fixes to the
canvas math or the reference presentation reach us without a re-port.

The reference path does not decide its own ordering. It executes
`compiled.plan`, the same walk `compile.py` numbered `<Picture N>` / `<Video N>`
/ `<Audio N>` from, one step at a time. That is deliberate: a mis-binding
between the labels in the prompt and the tensors in the payload produces a
subtly wrong video rather than an exception, so the two sides are built from one
list instead of two loops that have to be kept in agreement by hand.
"""

import math

import node_helpers
from comfy.ldm.minimax.model import FRAME_PER_TOKEN
from .payload import AUDIO_END_KEY, FRAME_INDEX_KEY
from comfy_extras.nodes_minimax_h3 import (
    CANVAS_MULTIPLE,
    FPS,
    REF_IMAGE_SHORT_EDGE,
    MiniMaxH3ReferenceToVideo,
    _empty_av_latent,
    _resize,
    adapt_canvas,
)

_encode_ref_audio = MiniMaxH3ReferenceToVideo._encode_ref_audio

# Where a timeline segment's inherited start frame arrives in `loaded`. It is the
# previous segment's decoded last frame, so unlike every other entry it has no
# Asset and no filename — a reserved key rather than a handle, because handles
# are the user's namespace and this frame is not something they attached.
PREV_FRAME = "__prev__"

# Where a timeline segment's inherited audio tail arrives. Same reasoning as
# PREV_FRAME: it is the previous segment's *generated* sound, so there is no file
# and no handle behind it.
PREV_AUDIO = "__prev_audio__"


def _frames_covered(steps):
    """Pixel frames the first `steps` latent steps of a video encode cover."""
    return sum(FRAME_PER_TOKEN[k % 5] for k in range(steps))


def _context_keyframes(vae, tail, feather):
    """The inherited run as pinned guides on this segment's own timeline.

    One video-VAE call over the whole tail — the motion lives inside the
    temporal compression — then one guide block per latent step, each pinned
    at the pixel offset that step's content starts at. The stock layout
    constructor accepts only frame 0, so every block passes it that and
    carries its real position for `payload.py` to write in.

    The coverage check is the seam's integrity check: `compile` only allows
    feathers on the VAE's own grid, so steps that cover a different span mean
    the VAE's downscale changed underneath us — the pinned run would end short
    of the source's last frame and the join would jump by the difference.
    """
    encoded = vae.encode(tail)
    if getattr(encoded, "ndim", 0) != 5:
        # The batch axis is time to the H3 video VAE; anything that came back
        # flat is some other VAE, and slicing it by "step" would pin noise.
        raise ValueError(
            f"encoding the inherited run returned shape "
            f"{tuple(getattr(encoded, 'shape', ()))}, expected [B, C, T, H, W] "
            f"— is the H3 video VAE wired to 'vae'?"
        )
    steps = int(encoded.shape[2])
    covered = _frames_covered(steps)
    if covered != feather:
        raise ValueError(
            f"{feather} inherited frames encoded to {steps} latent steps "
            f"covering {covered} frames — the video VAE's temporal grid no "
            f"longer matches the seam's. Refusing to render a shifted join."
        )
    return [{
        "resolved_frame_index": 0,
        FRAME_INDEX_KEY: _frames_covered(k),
        "latent": encoded[:, :, k:k + 1],
    } for k in range(steps)]


def _seam_audio(audio_vae, compiled, loaded):
    """The inherited tail as an audio reference block.

    On the classic seam it sits where core puts reference audio — the span
    before the clip, which the model imitates. A feathered seam pins it
    end-aligned with the inherited frames on this segment's own timeline
    instead, so the model reads it as this clip's sound so far and continues
    it phase-locked; `compile` clamped the tail to the overlap so the two
    cover the same instants.
    """
    audio_latent, ref_audio_t = _encode_ref_audio(audio_vae, loaded[PREV_AUDIO]["audio"])
    seam = {"kind": "audio", "ref_audio_t": ref_audio_t, "audio_latent": audio_latent}
    if compiled.feather > 1:
        seam[AUDIO_END_KEY] = compiled.feather
    return seam


def encode(clip, vae, audio_vae, compiled, loaded):
    """-> (conditioning, latent). `loaded` maps asset handle -> decoded media."""
    if compiled.mode == "REF2VA":
        return _encode_references(clip, vae, audio_vae, compiled, loaded)
    return _encode_frames(clip, vae, audio_vae, compiled, loaded)


def _encode_frames(clip, vae, audio_vae, compiled, loaded):
    """T2VA / I2VA / L2VA / FL2VA, optionally continuing the previous sound.

    The sound continuation is the one thing here core has no node for: the
    previous segment's audio tail rides in as a `ref_audio` block, which the
    FL2VA weights read even though their documented inputs are text and frames.
    See `payload.py` for the one core line that has to be worked around to send
    it alongside a keyframe.

    Every keyframe here carries its real pixel index under `FRAME_INDEX_KEY`,
    including the ones stock would place correctly. A sound seam is a
    `ref_audio` block, and a reference block advances the cursor the target
    clip then starts at — so the moment sound crosses a seam, stock's "frame 0"
    lands `ref_audio_t` time units *before* the clip's opening rather than on
    it, and the model reads the inherited frame as something from a second ago
    instead of as this clip's first frame. Keyed rows are repositioned onto the
    target's own origin by `payload.py`; with no references in the layout the
    rewrite reproduces stock's arithmetic exactly, so nothing that was already
    right moves. `_encode_references` has keyed its seam for the same reason
    since references existed — this is the same repair on the FL2VA road.
    """
    latent, frame_count = _empty_av_latent(compiled.width, compiled.height, compiled.frames)

    images = []
    keyframes = []

    if compiled.continues:
        # The source segment's tail. It was generated on this same canvas
        # — the timeline pins one geometry across every segment — so the resize
        # is a no-op that exists only so a hand-built request cannot skip it.
        tail = _resize(loaded[PREV_FRAME]["image"], compiled.width, compiled.height, "center")
        # What Qwen sees is the last frame either way: the feather's extra
        # frames are motion context for the DiT, not something the prompt
        # names, so the presentation — and with it the prompt cache — does not
        # change with the seam's width.
        images.append(tail[-1:])
        if compiled.feather > 1:
            keyframes.extend(_context_keyframes(vae, tail[-compiled.feather:], compiled.feather))
        else:
            keyframes.append({"resolved_frame_index": 0, FRAME_INDEX_KEY: 0,
                              "image": tail[-1:]})
    elif compiled.first_frame is not None:
        # Geometry anchor: plain stretch, because the canvas was derived from
        # this image's own aspect ratio and already matches it.
        image = _resize(loaded[compiled.first_frame.handle]["image"], compiled.width, compiled.height, "disabled")
        images.append(image)
        keyframes.append({"resolved_frame_index": 0, FRAME_INDEX_KEY: 0, "image": image})

    if compiled.last_frame is not None:
        # Follower: cover-crop onto whatever canvas the first frame established.
        # Follower whenever something already set the canvas — a first frame, or
        # in a timeline the frame inherited from the previous segment.
        crop = "center" if (compiled.first_frame is not None or compiled.continues) else "disabled"
        image = _resize(loaded[compiled.last_frame.handle]["image"], compiled.width, compiled.height, crop)
        images.append(image)
        keyframes.append({"resolved_frame_index": frame_count - 1,
                          FRAME_INDEX_KEY: frame_count - 1, "image": image})

    if compiled.continues_audio and compiled.feather == 1:
        # The tokenizer's `images=` branch is an `else` on `minimax_ref_items`:
        # pass both and the keyframes vanish from the presentation. So when there
        # is an audio reference to send, the keyframes are presented as reference
        # items instead. The two branches emit the same "<Picture N>: " + vision
        # tokens, so this is the same presentation by a different road — and the
        # keyframe *latents* still go in through `minimax_keyframes`, which is
        # what makes them pinned frames rather than loose references.
        #
        # Only on the classic seam: a feathered tail is pinned on this
        # segment's own timeline rather than sent as a reference, so it takes
        # no <Audio 1> and the prompt carries no seam line naming one.
        items = [{"type": "image", "data": image} for image in images]
        items.append({"type": "audio"})
        tokens = clip.tokenize(compiled.prompt, minimax_ref_items=items)
    else:
        tokens = clip.tokenize(compiled.prompt, images=images)
    cond = clip.encode_from_tokens_scheduled(tokens)

    if keyframes:
        for keyframe in keyframes:
            # A feathered seam's context blocks arrive already encoded — one
            # VAE call over the run, not one per frame.
            if "image" in keyframe:
                keyframe["latent"] = vae.encode(keyframe.pop("image"))
        cond = node_helpers.conditioning_set_values(cond, {
            "minimax_keyframes": keyframes,
            "minimax_frame_count": frame_count,
        })

    if compiled.continues_audio:
        cond = node_helpers.conditioning_set_values(
            cond, {"minimax_refs": [_seam_audio(audio_vae, compiled, loaded)]})
    return cond, latent


def _snap(value):
    return max(CANVAS_MULTIPLE, round(value / CANVAS_MULTIPLE) * CANVAS_MULTIPLE)


def video_canvas(source_w, source_h, gen_w, gen_h, ref_size):
    """What a reference video is encoded at. -> (width, height).

    'max' is core's own reference canvas: a 768 short edge under a 768*1344 area
    cap, or the clip's native size when that is already smaller. It is the
    ceiling — unlike a reference image, whose 'max' reaches for 2048, a video
    never gets more than this, so the setting only ever buys speed.

    'match' takes the generation's pixel area instead, scaled down from whatever
    'max' would have used and keeping the clip's own aspect. Down-only and
    measured against the 'max' canvas rather than the source, which is what makes
    it impossible for 'match' to come out the more expensive of the two.

    Worth the knob because of how a video block is shaped: it is `latent_t`
    copies of this grid, not one, so at full length a single reference clip is
    about as long as the target video itself and every row of it rides through
    every sampling step.
    """
    width, height = adapt_canvas(source_w, source_h)
    if source_w * source_h < width * height:
        width, height = _snap(source_w), _snap(source_h)
    if ref_size == "match":
        scale = min(1.0, math.sqrt((gen_w * gen_h) / (width * height)))
        width, height = _snap(width * scale), _snap(height * scale)
    return width, height


def _encode_references(clip, vae, audio_vae, compiled, loaded):
    """REF2VA."""
    latent, frame_count = _empty_av_latent(compiled.width, compiled.height, compiled.frames)

    items = []   # tokenizer presentation, in request order
    blocks = []  # DiT payload, same order
    pending_soundtrack = None  # set by a 'soundtrack' step, consumed by the 'video' step after it

    for step in compiled.plan:
        asset = step["asset"]
        entry = loaded[asset.handle]

        if step["op"] == "image":
            image = entry["image"]
            height, width = image.shape[1], image.shape[2]
            if asset.ref_size == "match":
                # Down-only, to the generation's pixel area.
                scale = min(1.0, math.sqrt((compiled.width * compiled.height) / (width * height)))
            else:
                # 'max': the reference pipeline's own 2048 short edge. Best identity
                # retention, and several times slower — reference tokens ride through
                # every sampling step.
                scale = min(1.0, REF_IMAGE_SHORT_EDGE / min(width, height))
            target_w, target_h = _snap(width * scale), _snap(height * scale)
            resized = _resize(image, target_w, target_h, "disabled")
            items.append({"type": "image", "data": resized})
            blocks.append({
                "kind": "image",
                "latent_h": target_h // 16,
                "latent_w": target_w // 16,
                "latent": vae.encode(resized),
            })

        elif step["op"] == "soundtrack":
            pending_soundtrack = _encode_ref_audio(audio_vae, entry["audio"])
            items.append({"type": "audio"})

        elif step["op"] == "video":
            frames = entry["frames"]
            source_h, source_w = frames.shape[1], frames.shape[2]
            canvas_w, canvas_h = video_canvas(
                source_w, source_h, compiled.width, compiled.height, asset.ref_size)
            frames = _resize(frames, canvas_w, canvas_h, "disabled")

            if frames.shape[0] > frame_count:
                frames = frames[:frame_count]
            count = frames.shape[0]
            if count < 5:
                raise ValueError(
                    f"@{asset.handle}: reference videos need at least 5 frames "
                    f"(~0.2 s at 24 fps), got {count}"
                )
            while count % 17 != 5:
                count -= 1
            frames = frames[:count]

            audio_latent, ref_audio_t = pending_soundtrack or (None, 0)
            pending_soundtrack = None

            # Qwen sees the clip at 2 fps with timestamps, not every frame.
            sampled = list(range(0, frames.shape[0], FPS // 2))
            items.append({
                "type": "video",
                "data": frames[sampled],
                "timestamps": [i / 2.0 for i in range(len(sampled))],
            })
            encoded = vae.encode(frames)
            blocks.append({
                "kind": "video_audio" if ref_audio_t else "video",
                "latent_t": encoded.shape[2],
                "latent_h": canvas_h // 16,
                "latent_w": canvas_w // 16,
                "ref_audio_t": ref_audio_t,
                "latent": encoded,
                "audio_latent": audio_latent,
            })

        elif step["op"] == "audio":
            audio_latent, ref_audio_t = _encode_ref_audio(audio_vae, entry["audio"])
            items.append({"type": "audio"})
            blocks.append({"kind": "audio", "ref_audio_t": ref_audio_t, "audio_latent": audio_latent})

        else:
            raise ValueError(f"unknown reference plan step {step['op']!r}")

    if compiled.continues_audio:
        # After the user's blocks, so their <Audio N> numbering is untouched.
        # No presentation item and no label: the tail is not a reference the
        # prompt cites, it is the seam's own sound riding in conditioning.
        blocks.append(_seam_audio(audio_vae, compiled, loaded))

    tokens = clip.tokenize(compiled.prompt, minimax_ref_items=items)
    cond = clip.encode_from_tokens_scheduled(tokens)
    if blocks:
        cond = node_helpers.conditioning_set_values(cond, {"minimax_refs": blocks})

    if compiled.continues:
        # The seam alongside references — the combination core's node surface
        # stops short of. The inherited frames ride as pinned guides with
        # their real positions under FRAME_INDEX_KEY: with references in the
        # layout the target clip no longer starts where stock computes keyframe
        # anchors, so even the classic single-frame seam is keyed and
        # repositioned by `payload.py`, which also rebuilds the latent list the
        # reference branch of core's `extra_conds` overwrites.
        tail = _resize(loaded[PREV_FRAME]["image"], compiled.width, compiled.height, "center")
        if compiled.feather > 1:
            keyframes = _context_keyframes(vae, tail[-compiled.feather:], compiled.feather)
        else:
            keyframes = [{"resolved_frame_index": 0, FRAME_INDEX_KEY: 0,
                          "latent": vae.encode(tail[-1:])}]
        cond = node_helpers.conditioning_set_values(cond, {
            "minimax_keyframes": keyframes,
            "minimax_frame_count": frame_count,
        })
    return cond, latent
