"""What `MiniMaxH3Timeline.execute` actually wires up.

`compile_timeline` is covered by `test_compile.py` and needs nothing installed.
This one does: it runs the real node against the real ComfyUI, because the thing
worth checking here is the *graph*, and a stubbed GraphBuilder would only prove
the stub works. Nothing is sampled — `execute` returns a subgraph, so the whole
expansion can be inspected without a model or a single denoising step.

    COMFYUI_PATH=~/ComfyUI <comfy-venv>/bin/python3 tests/test_timeline_graph.py

Skips itself with a message if ComfyUI cannot be imported.
"""

import asyncio
import importlib
import json
import os
import sys

# The checkout this file lives in *is* the package under test, so the import
# name is read off the directory rather than guessed — `__init__.py` imports
# relatively, which means it has to come in as a package under whatever name
# the clone was given.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKAGE = os.path.basename(ROOT)

# A stock install is one tree and `--base-directory` defaults to it. Point
# COMFYUI_PATH at the ComfyUI that actually runs, and set COMFYUI_BASE as well
# if the base directory is somewhere else (a Desktop install: it usually is).
COMFY = os.environ.get("COMFYUI_PATH", os.path.expanduser("~/ComfyUI"))
BASE = os.environ.get("COMFYUI_BASE", COMFY)


def _boot():
    sys.path.insert(0, COMFY)
    sys.argv = ["main.py", "--base-directory", BASE]
    import nodes
    import server

    loop = asyncio.new_event_loop()
    server.PromptServer(loop)          # server_routes.py registers against .instance
    asyncio.set_event_loop(loop)
    loop.run_until_complete(nodes.init_extra_nodes(init_custom_nodes=False))

    sys.path.insert(0, os.path.dirname(ROOT))
    return importlib.import_module(PACKAGE), nodes


try:
    package, comfy_nodes = _boot()
except Exception as exc:  # noqa: BLE001
    print(f"skipped: ComfyUI not importable ({type(exc).__name__}: {exc})")
    sys.exit(0)

tl = importlib.import_module(f"{PACKAGE}.timeline")
outputs_mod = importlib.import_module(f"{PACKAGE}.outputs")

FAILURES = []


def check(label, got, want):
    if got != want:
        FAILURES.append(f"{label}: got {got!r}, want {want!r}")


def expect_error(label, fn, fragment):
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        if fragment not in str(exc):
            FAILURES.append(f"{label}: error {str(exc)!r} does not mention {fragment!r}")
    else:
        FAILURES.append(f"{label}: expected an error mentioning {fragment!r}, got none")


# The node has no sockets: the weights are named in the blob and the loaders are
# built inside the subgraph. Filenames rather than links, and never checked
# against the disk — they only ever become a loader's widget value.
MODELS = {
    "fl2va": "h3/fl2va.safetensors",
    "ref2va": "h3/ref2va.safetensors",
    "clip": "h3/text_encoder.safetensors",
    "vae": "h3/video_vae.safetensors",
    "audio_vae": "h3/audio_vae.safetensors",
}

NODE_ID = "12"

DATA = json.dumps({
    "version": 2,
    "prompt": "a red room",
    "aspect": "16:9",
    "short_edge": 768,
    "models": MODELS,
    "segments": [
        {"prompt": "wide", "duration_s": 5},
        {"prompt": "closer", "duration_s": 10, "continue": True},
        {"prompt": "cut away", "duration_s": 5,
         "assets": [{"handle": "img-1", "kind": "image", "role": "reference", "filename": "a.png"}]},
    ],
})


def build(data=DATA, **overrides):
    kwargs = dict(
        timeline_data=data,
        seed=100, steps=20, cfg=6.0, sampler_name="euler", scheduler="simple",
    )
    kwargs.update(overrides)
    # `unique_id` reaches `execute` as a hidden input, which only the executor
    # fills in. Stamped by hand so the save node gets the display id it would get
    # in a real run — that link is the whole reason the node can show its own
    # result, and a test that skipped it would not notice it break. Constructed
    # rather than `HiddenHolder.from_dict`, whose keys are `Hidden` enum members
    # and not the plain names.
    from comfy_api.latest import io as comfy_io

    previous = tl.MiniMaxH3Timeline.hidden
    tl.MiniMaxH3Timeline.hidden = comfy_io.HiddenHolder(
        unique_id=NODE_ID, prompt=None, extra_pnginfo=None, dynprompt=None,
        auth_token_comfy_org=None, api_key_comfy_org=None)
    try:
        return tl.MiniMaxH3Timeline.execute(**kwargs)
    finally:
        tl.MiniMaxH3Timeline.hidden = previous


def without(field, data=DATA):
    """`data` with one weights field never picked."""
    parsed = json.loads(data)
    parsed["models"] = {k: v for k, v in parsed["models"].items() if k != field}
    return json.dumps(parsed)


def blob(**fields):
    """A timeline blob with the weights already filled in.

    Every case here is about the graph rather than about the weights, and a
    literal that forgot them would fail in `models.check` before reaching the
    thing it was written to test.
    """
    return json.dumps({"version": 2, "models": MODELS, **fields})


out = build()
graph = out.expand
# No output sockets, so no exported links — as an empty tuple, not the `None`
# that `NodeOutput` gives for no values and that `execution.py` calls `len()` on.
check("expansion exports no links", out.result, ())
by_type = {}
for node_id, node in graph.items():
    by_type.setdefault(node["class_type"], []).append((node_id, node["inputs"]))

check("one segment node per segment", len(by_type["MiniMaxH3TimelineSegment"]), 3)
check("one sampler per segment", len(by_type["KSampler"]), 3)
check("one video decode per segment", len(by_type["VAEDecode"]), 3)
check("one audio decode per segment", len(by_type["VAEDecodeAudio"]), 3)
check("joins fold pairwise", len(by_type["MiniMaxH3TimelineJoin"]), 2)
# Only segment 2 continues, so only one frame is ever taken off a decode.
check("a last frame only where one is needed", len(by_type["MiniMaxH3LastFrame"]), 1)
check("no negative connected means one zero-out per segment",
      len(by_type["ConditioningZeroOut"]), 3)

def in_order(nodes, order):
    """The segment nodes sorted by which of `order`'s prompts they carry."""
    keyed = {json.loads(i["segment_data"])["request"]["prompt"]: (node_id, i) for node_id, i in nodes}
    return [keyed[prompt] for prompt in order]


segments = in_order(by_type["MiniMaxH3TimelineSegment"],
                    ["a red room\nwide", "a red room\ncloser", "a red room\ncut away"])
# The global prompt is folded into each payload rather than passed alongside it,
# so a segment node's inputs describe one whole generation and nothing else.
# `progress` is the one exception: the segment's own position, announced to the
# stage when the node runs — the index only, so appending a segment cannot
# touch an earlier payload's cache key.
check("each segment carries only its own payload",
      [sorted(json.loads(i["segment_data"])) for _, i in segments],
      [["canvas", "continue", "continue_audio", "progress", "request"]] * 3)
check("the progress stamp is the segment's index and nothing else",
      [json.loads(i["segment_data"])["progress"] for _, i in segments],
      [{"index": 1}, {"index": 2}, {"index": 3}])
# The loaders are built once for the whole chain, not once per segment: they are
# ordinary nodes keyed on their filenames, so every segment reads the same one.
check("every segment reads the same FL2VA loader",
      len({tuple(i["model_fl2va"]) for _, i in segments}), 1)
check("only the continuing segment takes a previous frame",
      ["prev_image" in i for _, i in segments], [False, True, False])

# The chain: segment 2's prev_image must trace back to segment 1's decode, not
# to segment 2's own or to the join. This is the edge the whole feature is.
last_frame_id, last_frame_inputs = by_type["MiniMaxH3LastFrame"][0]
check("the continuing segment reads that last frame",
      segments[1][1]["prev_image"], [last_frame_id, 0])
decode_id = last_frame_inputs["image"][0]
sampler_id = graph[decode_id]["inputs"]["samples"][0]
check("...which came from segment 1's sampler",
      graph[sampler_id]["inputs"]["model"][0], segments[0][0])

# Distinct seeds, so consecutive shots are not the same noise twice.
check("seeds advance with the segment",
      sorted(i["seed"] for _, i in by_type["KSampler"]), [100, 101, 102])

# ---- the loaders and the tail -----------------------------------------------
#
# This timeline runs two segments on FL2VA and one on Ref2VA, so both checkpoints
# are genuinely needed and both are built — but one loader each, not one per
# segment. The Creator's test pins the other half of the claim: a render that
# reaches for one checkpoint must not build the other.

check("one loader per checkpoint actually routed to",
      sorted(i["unet_name"] for _, i in by_type["UNETLoader"]),
      sorted([MODELS["fl2va"], MODELS["ref2va"]]))
check("one text encoder for the whole chain", len(by_type["CLIPLoader"]), 1)
check("one loader per VAE", len(by_type["VAELoader"]), 2)

# Nothing comes out of the node: it saves the joined clip itself, and the
# display-id stamp is what puts the result back on the node the user is looking
# at rather than on an expanded node nobody can see.
check("nothing comes out of the node", out.args, ())
save_id, save_inputs = by_type["MiniMaxH3Save"][0]
check("one save node", len(by_type["MiniMaxH3Save"]), 1)
check("it is reported against the node that built it",
      graph[save_id].get("override_display_id"), NODE_ID)
check("it saves the tail of the join fold",
      graph[save_inputs["images"][0]]["class_type"], "MiniMaxH3TimelineJoin")
check("...and takes its sound from the same node",
      save_inputs["audio"][0], save_inputs["images"][0])
check("it lands in the render folder — the same one a Creator render lands in",
      save_inputs["filename_prefix"], outputs_mod.VIDEO_PREFIX)
# One prefix for the whole timeline, because a timeline is one file: the
# segments are joined before the save node, so there is nothing per-segment to
# put anywhere else.
retargeted = build(json.dumps({**json.loads(DATA), "output_prefix": "film/reel-1"})).expand
check("a blob's own prefix is used instead",
      [n["inputs"]["filename_prefix"] for n in retargeted.values()
       if n["class_type"] == "MiniMaxH3Save"],
      ["film/reel-1"])

# Two continuations in a row. Worth its own case: with only one, the "previous
# segment's images" and "everything joined so far" are the same node, so a chain
# that reads from the join instead of from the previous segment still looks
# right. From the third segment on they diverge.
run = build(blob(segments=[
    {"prompt": "one", "duration_s": 5},
    {"prompt": "two", "duration_s": 5, "continue": True},
    {"prompt": "three", "duration_s": 5, "continue": True},
])).expand
chain = in_order(
    [(node_id, n["inputs"]) for node_id, n in run.items()
     if n["class_type"] == "MiniMaxH3TimelineSegment"],
    ["one", "two", "three"])
check("every segment after the first continues", [("prev_image" in i) for _, i in chain],
      [False, True, True])

def source_segment(graph, prev_image):
    """Walk last frame -> decode -> sampler -> segment, naming what it hit instead."""
    node = graph[prev_image[0]]
    for socket, expected in (("image", "VAEDecode"), ("samples", "KSampler"), ("model", None)):
        link = node["inputs"].get(socket)
        if link is None:
            return f"<{node['class_type']} has no {socket!r}>"
        node = graph[link[0]]
        if expected and node["class_type"] != expected:
            return f"<{expected} expected, found {node['class_type']}>"
    return link[0]


for index in (1, 2):
    check(f"segment {index + 1} continues from segment {index}, not from the join",
          source_segment(run, chain[index][1]["prev_image"]), chain[index - 1][0])

# The circular narrative: segment 2 is an unrelated hard cut, and segment 3
# names segment 1 as its source — so its frame and its sound tail must both
# trace to segment 1's decodes, not to segment 2's.
run = build(blob(segments=[
    {"prompt": "hallway", "duration_s": 5},
    {"prompt": "dream", "duration_s": 5},
    {"prompt": "hallway again", "duration_s": 5,
     "continue": True, "continue_audio": True, "continue_from": 1},
])).expand
chain = in_order(
    [(node_id, n["inputs"]) for node_id, n in run.items()
     if n["class_type"] == "MiniMaxH3TimelineSegment"],
    ["hallway", "dream", "hallway again"])
check("only the returning segment continues",
      [("prev_image" in i) for _, i in chain], [False, False, True])
check("segment 3 continues from segment 1, two cards back",
      source_segment(run, chain[2][1]["prev_image"]), chain[0][0])


def audio_source_segment(graph, prev_audio):
    """Walk audio tail -> audio decode -> sampler -> segment, naming what it hit."""
    tail = graph[prev_audio[0]]
    if tail["class_type"] != "MiniMaxH3AudioTail":
        return f"<MiniMaxH3AudioTail expected, found {tail['class_type']}>"
    decode = graph[tail["inputs"]["audio"][0]]
    if decode["class_type"] != "VAEDecodeAudio":
        return f"<VAEDecodeAudio expected, found {decode['class_type']}>"
    sampler = graph[decode["inputs"]["samples"][0]]
    return sampler["inputs"]["model"][0]


check("...and its sound tail comes off segment 1 as well",
      audio_source_segment(run, chain[2][1]["prev_audio"]), chain[0][0])
# The named source rides the payload — it is part of the segment's cache key,
# so repointing a seam re-runs that segment and only that segment.
check("the source is on the payload, and only where one was named",
      [json.loads(i["segment_data"]).get("continue_from") for _, i in chain],
      [None, None, 0])

# A source that no longer exists — a leftover from deleting or reordering —
# falls back to the default seam rather than refusing the timeline.
run = build(blob(segments=[
    {"prompt": "one", "duration_s": 5},
    {"prompt": "two", "duration_s": 5, "continue": True, "continue_from": 7},
])).expand
chain = in_order(
    [(node_id, n["inputs"]) for node_id, n in run.items()
     if n["class_type"] == "MiniMaxH3TimelineSegment"],
    ["one", "two"])
check("an out-of-range source falls back to the previous segment",
      source_segment(run, chain[1][1]["prev_image"]), chain[0][0])
check("...and is not written onto the payload",
      json.loads(chain[1][1]["segment_data"]).get("continue_from"), None)

# What makes editing a long timeline bearable: a segment node's inputs are its
# cache key, so editing the last shot must leave the earlier segments' inputs
# byte-identical. This is the assertion to keep — it is easy to lose by handing a
# segment one field too many, and the only symptom is that everything re-runs.
edited = json.loads(DATA)
edited["segments"][2]["prompt"] = "somewhere else entirely"
before = {i["segment_data"] for _, i in by_type["MiniMaxH3TimelineSegment"]}
after = {n["inputs"]["segment_data"] for n in build(json.dumps(edited)).expand.values()
         if n["class_type"] == "MiniMaxH3TimelineSegment"}
check("editing the last segment leaves the earlier payloads untouched",
      len(before & after), 2)

# And the loader inputs must stay links: a loaded model as a literal input value
# hashes as Unhashable, which would miss the cache on every queue.
loader_ids = {node_id for kind in ("UNETLoader", "CLIPLoader", "VAELoader")
              for node_id, _ in by_type[kind]}
for _, inputs in by_type["MiniMaxH3TimelineSegment"]:
    for socket in ("clip", "vae", "audio_vae", "model_fl2va", "model_ref2va"):
        value = inputs.get(socket)
        if value is None:
            continue
        if not (isinstance(value, list) and len(value) == 2 and value[0] in loader_ids):
            FAILURES.append(f"segment input {socket!r} is not a link to a loader: {value!r}")

# ---- one pass ---------------------------------------------------------------
#
# The same timeline, rendered in a single generation. What is worth checking at
# this level is the *shape* of the expansion: everything that exists to join two
# generations together has to be gone, because there is only one.

single = json.loads(DATA)
single["render"] = "single"
# The third segment's reference would make the merged request REF2VA while the
# others carry none — legal, but it is the frames/references split that is worth
# keeping the graph test off, so this one is plain text.
single["segments"] = [{"prompt": "wide", "duration_s": 5},
                      {"prompt": "the camera cuts in closer", "duration_s": 10},
                      {"prompt": "the shot cuts away", "duration_s": 5}]
one = build(json.dumps(single))
built = {}
for node_id, node in one.expand.items():
    built.setdefault(node["class_type"], []).append((node_id, node["inputs"]))

check("one pass expands to one segment node", len(built["MiniMaxH3TimelineSegment"]), 1)
check("...and one sampler", len(built["KSampler"]), 1)
check("...on the seed as given, not seed + k", built["KSampler"][0][1]["seed"], 100)
for gone in ("MiniMaxH3TimelineJoin", "MiniMaxH3LastFrame", "MiniMaxH3AudioTail"):
    check(f"no {gone} in a one-pass graph", gone in built, False)
# One generation, one checkpoint: none of these shots carries a reference, so
# the reference weights must not be loaded at all.
check("one pass loads one checkpoint",
      [i["unet_name"] for _, i in built["UNETLoader"]], [MODELS["fl2va"]])
one_save = built["MiniMaxH3Save"][0][1]
check("the save reads the decodes straight",
      (one.expand[one_save["images"][0]]["class_type"],
       one.expand[one_save["audio"][0]]["class_type"]),
      ("VAEDecode", "VAEDecodeAudio"))

payload = json.loads(built["MiniMaxH3TimelineSegment"][0][1]["segment_data"])
check("the whole timeline arrives as one request", sorted(payload),
      ["continue", "continue_audio", "request", "shots"])
check("...holding every shot", payload["shots"], 3)
check("...summed rather than snapped per shot", payload["request"]["duration_s"], 20)
check("the shots are one description with cut times in it",
      payload["request"]["prompt"],
      "[Shot 1] a red room. wide [Shot 2] At 00:05.000, the camera cuts in closer "
      "[Shot 3] At 00:15.000, the shot cuts away")
check("no seam survives into the payload",
      (payload["continue"], payload["continue_audio"]), (False, False))
# The loader inputs matter here for the same reason they do when chained.
one_loaders = {node_id for kind in ("UNETLoader", "CLIPLoader", "VAELoader")
               for node_id, _ in built[kind]}
for socket in ("clip", "model_fl2va"):
    value = built["MiniMaxH3TimelineSegment"][0][1].get(socket)
    if not (isinstance(value, list) and len(value) == 2 and value[0] in one_loaders):
        FAILURES.append(f"one-pass segment input {socket!r} is not a link to a loader: {value!r}")
# This pass is plain text: it encodes no keyframe and no sound, so neither VAE is
# wired into the encoder. Both are decode-time loaders here — the save above
# reads a VAEDecode and a VAEDecodeAudio — and wiring them into the segment would
# load them before the first sampling step for an encode that never touches them.
for socket in ("vae", "audio_vae"):
    check(f"a text-only pass leaves {socket!r} off the encoder",
          socket in built["MiniMaxH3TimelineSegment"][0][1], False)

# One segment is the degenerate case: nothing to join, nothing to continue from.
lone = build(blob(segments=[{"prompt": "x", "duration_s": 6}])).expand
kinds = [n["class_type"] for n in lone.values()]
check("a lone segment needs no join", kinds.count("MiniMaxH3TimelineJoin"), 0)
check("...and no last frame", kinds.count("MiniMaxH3LastFrame"), 0)

# The checkpoint each segment routes to is checked before anything is queued,
# because failing here costs nothing and failing mid-chain costs every pass
# that already ran. And it must name the segment that reached for it: "pick the
# Ref2VA checkpoint" is a much shorter search with "segment 3" in front of it.
try:
    build(without("ref2va"))
except ValueError as exc:
    if "segment 3" not in str(exc).lower():
        FAILURES.append(f"missing checkpoint: {str(exc)!r} does not name segment 3")
    if "models/diffusion_models" not in str(exc):
        FAILURES.append(f"missing checkpoint: {str(exc)!r} does not name the folder")
else:
    FAILURES.append("missing checkpoint: expected a ValueError, got none")

expect_error("a missing audio VAE is refused too",
             lambda: build(without("audio_vae")),
             "models/vae")

# ---- the route --------------------------------------------------------------
#
# DATA runs two segments on FL2VA and one on Ref2VA, which is exactly the case a
# route is for: one instruction collapses the clip onto one set of weights,
# instead of pinning three shots by hand and losing the pins the next time a
# reference is attached.

def routed(route, data=DATA):
    parsed = json.loads(data)
    parsed["models"]["route"] = route
    return json.dumps(parsed)


def grouped(graph):
    out = {}
    for node_id, node in graph.items():
        out.setdefault(node["class_type"], []).append((node_id, node["inputs"]))
    return out


forced = grouped(build(routed("ref2va")).expand)
check("a forced route collapses the clip onto one checkpoint",
      [i["unet_name"] for _, i in forced["UNETLoader"]], [MODELS["ref2va"]])
check("...which every segment reads",
      len({tuple(i["model_ref2va"]) for _, i in forced["MiniMaxH3TimelineSegment"]}), 1)
check("...and no segment is wired to the other one",
      any("model_fl2va" in i for _, i in forced["MiniMaxH3TimelineSegment"]), False)
check("...so the checkpoint it skips need not be picked at all",
      [i["unet_name"] for _, i in grouped(build(routed("ref2va", without("fl2va"))).expand)["UNETLoader"]],
      [MODELS["ref2va"]])

# The other direction still refuses, and still names the segment that made it
# impossible — a route is a pin said once, not a licence to ignore the encoding.
try:
    build(routed("fl2va"))
except ValueError as exc:
    if "segment 3" not in str(exc).lower():
        FAILURES.append(f"forced FL2VA: {str(exc)!r} does not name segment 3")
    if "cannot be run through FL2VA" not in str(exc):
        FAILURES.append(f"forced FL2VA: {str(exc)!r} does not say why")
else:
    FAILURES.append("forced FL2VA: expected a ValueError, got none")

# --- the sound seam ----------------------------------------------------------
#
# The audio tail is wired exactly like the last frame: taken off the previous
# segment's *decode*, and only where a seam actually asks for it.

check("no tail node where no seam carries sound", len(by_type.get("MiniMaxH3AudioTail", [])), 0)

SOUND = blob(audio_tail_s=2.0, segments=[
    {"prompt": "wide", "duration_s": 5},
    # Sound only: the picture cuts, the room tone does not.
    {"prompt": "closer", "duration_s": 5, "continue_audio": True},
    # Both, which is the combination core cannot express unaided.
    {"prompt": "closer still", "duration_s": 5, "continue": True, "continue_audio": True},
])
sound = build(SOUND).expand
sound_by_type = {}
for node_id, node in sound.items():
    sound_by_type.setdefault(node["class_type"], []).append((node_id, node["inputs"]))

tails = sound_by_type.get("MiniMaxH3AudioTail", [])
check("one tail node per sound seam", len(tails), 2)
check("the tail length comes from the timeline", sorted({i["seconds"] for _, i in tails}), [2.0])

# Each tail must hang off an audio *decode*, not off a latent or the join.
decodes = {node_id for node_id, _ in sound_by_type["VAEDecodeAudio"]}
check("every tail reads a decoded soundtrack",
      all(i["audio"][0] in decodes for _, i in tails), True)

# And each segment that asked for sound must actually receive one.
wired = [sorted(k for k in i if k.startswith("prev_"))
         for _, i in sound_by_type["MiniMaxH3TimelineSegment"]]
check("the seams get exactly the inputs they asked for",
      sorted(wired), [[], ["prev_audio"], ["prev_audio", "prev_image"]])

# --- the feathered seam ------------------------------------------------------
#
# A 22-frame feather: the seam inherits a run instead of a single frame, the
# audio tail is clamped to the overlap, and the re-generated head is trimmed
# off the decode before the join and before anything later inherits from it.

feathered = build(blob(audio_tail_s=2.0, segments=[
    {"prompt": "one", "duration_s": 5},
    {"prompt": "two", "duration_s": 5, "continue": True, "continue_audio": True,
     "feather": 22},
    {"prompt": "three", "duration_s": 5, "continue": True},
])).expand
fb = {}
for node_id, node in feathered.items():
    fb.setdefault(node["class_type"], []).append((node_id, node["inputs"]))

last_frames = {i.get("count", 1) for _, i in fb["MiniMaxH3LastFrame"]}
check("the feathered seam takes its run, the classic one its frame",
      sorted(last_frames), [1, 22])
check("the audio tail is clamped to the overlap",
      [i["seconds"] for _, i in fb["MiniMaxH3AudioTail"]], [22 / 24])

trims = fb.get("MiniMaxH3SeamTrim", [])
check("one trim, on the feathered segment only", len(trims), 1)
check("it trims exactly the inherited run", trims[0][1]["frames"], 22)

fchain = in_order(
    [(node_id, n["inputs"]) for node_id, n in feathered.items()
     if n["class_type"] == "MiniMaxH3TimelineSegment"],
    ["one", "two", "three"])
# The trim reads segment 2's own decodes...
trim_images = feathered[trims[0][1]["images"][0]]
trim_sampler = feathered[trim_images["inputs"]["samples"][0]]
check("the trim reads the feathered segment's decode",
      trim_sampler["inputs"]["model"][0], fchain[1][0])
# ...and both the join and segment 3's seam read the *trimmed* segment 2, so
# the source's tail neither plays twice nor leaks into the next inheritance.
joins = [i for _, i in fb["MiniMaxH3TimelineJoin"]]
trim_id = trims[0][0]
check("the join takes the trimmed segment",
      any(i["images_b"][0] == trim_id for i in joins), True)
seg3_last_frame = feathered[fchain[2][1]["prev_image"][0]]
check("the next seam inherits from the trimmed segment",
      seg3_last_frame["inputs"]["image"][0], trim_id)

# The encoder's guide arithmetic, against a stand-in VAE: one call over the
# run, one block per latent step, pinned at the offsets core's temporal grid
# dictates — and a refusal when the two stop agreeing.
import torch as _torch

encoder_mod = importlib.import_module(f"{PACKAGE}.encode")
payload_mod = importlib.import_module(f"{PACKAGE}.payload")


class _FakeVae:
    def __init__(self, steps):
        self.steps = steps

    def encode(self, frames):
        return _torch.zeros(1, 24, self.steps, 4, 4)


guides = encoder_mod._context_keyframes(_FakeVae(7), _torch.zeros(22, 64, 64, 3), 22)
check("22 frames become 7 per-step guide blocks", len(guides), 7)
check("every block passes the stock constructor a legal anchor",
      {g["resolved_frame_index"] for g in guides}, {0})
check("the real positions follow the (1,4,4,4,4) temporal grid",
      [g[payload_mod.FRAME_INDEX_KEY] for g in guides], [0, 1, 5, 9, 13, 17, 18])
try:
    encoder_mod._context_keyframes(_FakeVae(6), _torch.zeros(22, 64, 64, 3), 22)
    FAILURES.append("a coverage mismatch should refuse to render, got no error")
except ValueError:
    pass

# ---- accelerators -----------------------------------------------------------
#
# The packs themselves are optional and usually absent, so what is pinned here is
# the wiring: off adds nothing at all, and on puts the patch between the segment
# node and the sampler rather than anywhere else. `accel.py`'s own tests cover
# the arguments; these cover the edge that only exists in the built graph.

check("no accelerator nodes by default",
      [t for t in by_type if t in (tl.accel.BLOCK_CACHE_NODE, tl.accel.SPECTRUM_NODE)], [])

# Every KSampler must read straight off its own segment node when nothing is on.
segments_by_id = {node_id for node_id, _ in by_type["MiniMaxH3TimelineSegment"]}
check("samplers read the segment directly when off",
      all(i["model"][0] in segments_by_id for _, i in by_type["KSampler"]), True)

# The harness boots with `init_custom_nodes=False`, so neither pack is loaded
# here even when both are installed — which is what makes a stand-in the only way
# to exercise the on path, and what keeps this test passing on a machine that has
# neither.
class _FakePack:
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model": ("MODEL",),
                             "mode": (["H3 Safe — 0.08", "H3 Fast — 0.10"], {"default": "H3 Fast — 0.10"})}}


_restore = dict(comfy_nodes.NODE_CLASS_MAPPINGS)
comfy_nodes.NODE_CLASS_MAPPINGS[tl.accel.BLOCK_CACHE_NODE] = _FakePack
try:
    accel_graph = build(block_cache="fast").expand
    accel_by_type = {}
    for node_id, node in accel_graph.items():
        accel_by_type.setdefault(node["class_type"], []).append((node_id, node["inputs"]))

    # Its own graph, so its own node ids — the set from the run above does not
    # carry over and comparing against it is how this silently tests nothing.
    accel_segment_ids = {node_id for node_id, _ in accel_by_type["MiniMaxH3TimelineSegment"]}

    patches = accel_by_type.get(tl.accel.BLOCK_CACHE_NODE, [])
    check("one accelerator patch per segment", len(patches), 3)
    check("the patch is the pack's chosen preset",
          sorted({i["mode"] for _, i in patches}), ["H3 Fast — 0.10"])

    # The patch sits *between* the segment and the sampler: it reads a segment
    # node, and every sampler reads a patch. Getting this backwards would run the
    # accelerator on nothing and sample the unpatched model.
    patch_ids = {node_id for node_id, _ in patches}
    check("the patch reads a segment node",
          all(i["model"][0] in accel_segment_ids for _, i in patches), True)
    check("every sampler reads a patch",
          all(i["model"][0] in patch_ids for _, i in accel_by_type["KSampler"]), True)

    # The conditioning and latent still come from the segment, not the patch —
    # the accelerator is a MODEL patch and must not be in any other path.
    check("conditioning still comes from the segment",
          all(i["positive"][0] in accel_segment_ids for _, i in accel_by_type["KSampler"]), True)
    check("the latent still comes from the segment",
          all(i["latent_image"][0] in accel_segment_ids for _, i in accel_by_type["KSampler"]), True)
finally:
    comfy_nodes.NODE_CLASS_MAPPINGS.clear()
    comfy_nodes.NODE_CLASS_MAPPINGS.update(_restore)

# An accelerator asked for but not installed must fail at queue time, naming the
# pack — not silently render without it.
expect_error("a missing pack is refused up front",
             lambda: build(spectrum=True),
             "xmarre/ComfyUI-Spectrum-MiniMax-H3")

# ---- passes -----------------------------------------------------------------
#
# A run of merged segments is one generation, and the timeline is those runs
# chained. What is worth checking here is that the two halves of that sentence
# hold at once: the merged run expands to a single segment node with cuts in its
# description, and the seam to the next run still gets everything a seam gets.

mixed = build(blob(prompt="a red room", segments=[
    {"prompt": "wide", "duration_s": 5},
    {"prompt": "the camera cuts in closer", "duration_s": 5, "merge": True},
    {"prompt": "somewhere else entirely", "duration_s": 6, "continue": True},
])).expand
made = {}
for node_id, node in mixed.items():
    made.setdefault(node["class_type"], []).append((node_id, node["inputs"]))

check("two passes expand to two segment nodes", len(made["MiniMaxH3TimelineSegment"]), 2)
check("...and two samplers", len(made["KSampler"]), 2)
check("the seam between the passes survives", len(made["MiniMaxH3TimelineJoin"]), 1)
check("...and takes the first pass's last frame", len(made["MiniMaxH3LastFrame"]), 1)

first, second = (json.loads(i["segment_data"]) for _, i in made["MiniMaxH3TimelineSegment"])
check("the merged pass is one description with a cut in it",
      first["request"]["prompt"],
      "[Shot 1] a red room. wide [Shot 2] At 00:05.000, the camera cuts in closer")
check("...counted as two shots", first["shots"], 2)
check("...and generated as one 10 s clip", first["request"]["duration_s"], 10)
check("the unmerged segment is untouched",
      second["request"]["prompt"], "a red room\nsomewhere else entirely")
check("...and still continues from the pass in front of it", second["continue"], True)
check("both passes are held to one canvas",
      first["canvas"] == second["canvas"], True)

if FAILURES:
    print(f"{len(FAILURES)} failure(s):")
    for failure in FAILURES:
        print("  -", failure)
    sys.exit(1)
print("all timeline graph tests passed")
