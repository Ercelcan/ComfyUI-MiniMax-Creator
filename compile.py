"""`creator_data` (the UI's JSON blob) -> a validated, ordered generation request.

This is the load-bearing module. The @chip a user types in the prompt box is
not decoration: it is how they bind a slot to a role, and H3 only understands
that binding through its own ordinal labels, <Picture N> / <Video N> / <Audio N>.
"""

import re
from dataclasses import dataclass, field, replace

from . import canvas, contextir

MODES = ("T2VA", "I2VA", "L2VA", "FL2VA", "REF2VA")

MAX_REF_IMAGES = 9
MAX_REF_VIDEOS = 3
MAX_REF_AUDIOS = 3
MAX_REF_FILES = 12

MAX_SEGMENTS = 24

DEFAULT_AUDIO_TAIL_S = 1.0
MAX_AUDIO_TAIL_S = 4.0

FEATHER_GRID = (1, 5, 22, 39)

HANDLE_RE = re.compile(r"@([A-Za-z]+-\d+)")

UPSCALE_MODES = ("two_pass", "direct")

DEFAULT_REFINE_DENOISE = 0.5
MIN_REFINE_DENOISE = 0.1
MAX_REFINE_DENOISE = 0.9

CHECKPOINTS = ("fl2va", "ref2va")

TRACKS = ("picture", "picture+sound", "sound")

DEFAULT_REF_SIZE = {"image": "match", "video": "max"}

TAKES = ("full", "person", "object", "scene", "style")


class CompileError(ValueError):
    """A `creator_data` blob that cannot become a valid H3 request."""


@dataclass
class Asset:
    handle: str
    kind: str
    role: str
    filename: str
    track: str | None = None
    ref_size: str = "match"
    trim: tuple[float, float] | None = None
    takes: str = "full"


@dataclass
class CanvasSpec:
    width: int
    height: int
    ratio: float
    label: str
    from_image: bool
    clamped: bool


@dataclass(frozen=True)
class Refine:
    width: int
    height: int
    denoise: float


@dataclass
class Compiled:
    mode: str
    checkpoint: str
    prompt: str
    body: str
    frames: int
    seconds: float
    width: int
    height: int
    ratio: float
    ratio_label: str
    ratio_from_image: bool
    ratio_clamped: bool
    soundscape: str = ""
    music: str = ""
    first_frame: Asset | None = None
    last_frame: Asset | None = None
    ref_images: list[Asset] = field(default_factory=list)
    ref_videos: list[Asset] = field(default_factory=list)
    ref_audios: list[Asset] = field(default_factory=list)
    labels: dict[str, str] = field(default_factory=dict)
    plan: list[dict] = field(default_factory=list)
    triggers: list[str] = field(default_factory=list)
    checkpoint_pinned: bool = False
    continues: bool = False
    feather: int = 1
    continues_audio: bool = False
    audio_tail_s: float = 0.0
    refine: Refine | None = None
    # Selective segment re-rendering & locking
    locked: bool = False
    cached_video: str | None = None

    def encodes_video(self):
        return bool(self.continues or self.first_frame or self.last_frame
                    or self.ref_images or self.ref_videos)

    def encodes_audio(self):
        return bool(self.continues_audio or self.ref_audios
                    or any(v.track == "picture+sound" for v in self.ref_videos))


def lora_modes(entry):
    claimed = tuple(m for m in (entry.get("modes") or ()) if m in CHECKPOINTS)
    return claimed or CHECKPOINTS


def active_loras(entries, checkpoint):
    active = []
    for entry in entries or []:
        if not entry.get("name") or entry.get("enabled") is False:
            continue
        if checkpoint not in lora_modes(entry):
            continue
        try:
            if float(entry.get("strength", 1.0)) == 0.0:
                continue
        except (TypeError, ValueError):
            raise CompileError(f"LoRA {entry['name']}: strength must be a number")
        active.append(entry)
    return active


def collect_triggers(entries):
    triggers = []
    seen = set()
    for entry in entries:
        for word in entry.get("triggers") or ():
            word = str(word).strip()
            if not word or word.lower() in seen:
                continue
            seen.add(word.lower())
            triggers.append(word)
    return triggers


def _parse_trim(handle, kind, raw):
    if raw is None:
        return None
    if kind not in ("video", "audio"):
        raise CompileError(f"@{handle}: only video and audio can be trimmed")
    try:
        start = float(raw["start"])
        end = float(raw["end"])
    except (TypeError, KeyError, ValueError) as exc:
        raise CompileError(f"@{handle}: trim needs numeric 'start' and 'end' seconds") from exc
    if start < 0 or end <= start:
        raise CompileError(f"@{handle}: trim must satisfy 0 <= start < end (got {start} .. {end})")
    return (start, end)


def _parse_assets(raw):
    assets = []
    seen = set()
    for index, item in enumerate(raw or []):
        handle = str(item.get("handle") or "").strip()
        if not handle:
            raise CompileError(f"asset #{index + 1} has no handle")
        if handle in seen:
            raise CompileError(f"duplicate asset handle @{handle}")
        seen.add(handle)

        kind = item.get("kind")
        if kind not in ("image", "video", "audio"):
            raise CompileError(f"@{handle}: unknown kind {kind!r}")

        role = item.get("role", "reference")
        if role not in ("reference", "first_frame", "last_frame"):
            raise CompileError(f"@{handle}: unknown role {role!r}")
        if role != "reference" and kind != "image":
            raise CompileError(f"@{handle}: only images can be a {role}")

        filename = str(item.get("filename") or "").strip()
        if not filename:
            raise CompileError(f"@{handle}: no filename")

        ref_size = item.get("ref_size") or DEFAULT_REF_SIZE.get(kind, "match")
        if ref_size not in ("match", "max"):
            raise CompileError(f"@{handle}: ref_size must be 'match' or 'max'")

        takes = item.get("takes") or "full"
        if takes not in TAKES:
            raise CompileError(
                f"@{handle}: takes must be one of {', '.join(TAKES)} (got {takes!r})")
        if takes != "full" and (kind != "image" or role != "reference"):
            raise CompileError(
                f"@{handle}: 'takes' narrows a reference image; a {role.replace('_', ' ')} "
                f"{kind} is always used whole"
            )

        assets.append(Asset(
            handle=handle,
            kind=kind,
            role=role,
            filename=filename,
            track=_parse_track(handle, kind, item),
            ref_size=ref_size,
            trim=_parse_trim(handle, kind, item.get("trim")),
            takes=takes,
        ))
    return assets


def _parse_track(handle, kind, item):
    if kind != "video":
        if item.get("track"):
            raise CompileError(f"@{handle}: only video has a track selection")
        return None
    track = item.get("track") or ("picture+sound" if item.get("with_audio") else "picture")
    if track not in TRACKS:
        raise CompileError(f"@{handle}: unknown track {track!r}")
    return track


def _derive_mode(first_frame, last_frame, ref_images, ref_videos, ref_audios, continues=False):
    has_refs = bool(ref_images or ref_videos or ref_audios)
    has_frames = first_frame is not None or last_frame is not None

    if continues and first_frame is not None:
        raise CompileError(
            "this segment continues from an earlier one, so its start frame is "
            "already the source segment's last frame — remove the start frame "
            "or turn continuation off"
        )

    if has_refs and has_frames:
        raise CompileError(
            "Start/end frames and references need different checkpoints "
            "(FL2VA vs Ref2VA) and cannot be combined in one generation. "
            "Remove the frames or remove the references."
        )

    if has_refs:
        if len(ref_images) > MAX_REF_IMAGES:
            raise CompileError(f"at most {MAX_REF_IMAGES} reference images ({len(ref_images)} given)")
        if len(ref_videos) > MAX_REF_VIDEOS:
            raise CompileError(f"at most {MAX_REF_VIDEOS} reference videos ({len(ref_videos)} given)")
        total_audio = len(ref_audios) + sum(1 for v in ref_videos if v.track == "picture+sound")
        if total_audio > MAX_REF_AUDIOS:
            raise CompileError(
                f"at most {MAX_REF_AUDIOS} reference audio clips, counting video "
                f"soundtracks ({total_audio} given)"
            )
        total = len(ref_images) + len(ref_videos) + total_audio
        if total > MAX_REF_FILES:
            raise CompileError(f"at most {MAX_REF_FILES} reference files total ({total} given)")
        if not ref_images and not ref_videos:
            raise CompileError("reference audio needs at least one reference image or video alongside it")
        return "REF2VA"

    if continues:
        return "FL2VA" if last_frame is not None else "I2VA"
    if first_frame is not None and last_frame is not None:
        return "FL2VA"
    if first_frame is not None:
        return "I2VA"
    if last_frame is not None:
        return "L2VA"
    return "T2VA"


def _resolve_checkpoint(mode, raw):
    choice = raw or "auto"
    if choice not in ("auto",) + CHECKPOINTS:
        raise CompileError(f"unknown checkpoint {choice!r}")
    derived = "ref2va" if mode == "REF2VA" else "fl2va"
    if choice == "auto":
        return derived, False
    if mode == "REF2VA" and choice == "fl2va":
        raise CompileError(
            "references are encoded for the Ref2VA checkpoint and cannot be run "
            "through FL2VA — set the route back to auto or Ref2VA, or remove the "
            "references"
        )
    return choice, choice != derived


def plan_references(ref_images, ref_videos, ref_audios):
    plan = []
    picture = video = audio = 0

    for asset in ref_images:
        picture += 1
        plan.append({"op": "image", "asset": asset, "label": f"<Picture {picture}>"})
    for asset in ref_videos:
        if asset.track == "picture+sound":
            audio += 1
            plan.append({"op": "soundtrack", "asset": asset, "label": f"<Audio {audio}>"})
        video += 1
        plan.append({"op": "video", "asset": asset, "label": f"<Video {video}>"})
    for asset in ref_audios:
        audio += 1
        plan.append({"op": "audio", "asset": asset, "label": f"<Audio {audio}>"})
    return plan


def _labels_from_plan(plan):
    labels = {}
    for step in plan:
        key = step["asset"].handle
        if step["op"] == "soundtrack":
            key += ":audio"
        labels[key] = step["label"]
    return labels


def _keyframe_labels(first_frame, last_frame, continues=False):
    labels = {}
    ordinal = 0
    if continues:
        ordinal += 1
    elif first_frame is not None:
        ordinal += 1
        labels[first_frame.handle] = f"<Picture {ordinal}>"
    if last_frame is not None:
        ordinal += 1
        labels[last_frame.handle] = f"<Picture {ordinal}>"
    return labels


def _substitute(prompt, labels, assets, where="prompt"):
    known = {a.handle for a in assets}
    dangling = sorted({h for h in HANDLE_RE.findall(prompt) if h not in known})
    if dangling:
        raise CompileError(
            f"{where} references " + ", ".join("@" + h for h in dangling)
            + " but no such asset is attached"
        )
    return HANDLE_RE.sub(lambda m: labels.get(m.group(1), m.group(0)), prompt)


def refined_body(data):
    refined = data.get("refined")
    if not isinstance(refined, dict) or refined.get("enabled") is False:
        return None
    body = str(refined.get("body") or "").strip()
    return body or None


def refined_scope(data):
    refined = data.get("refined")
    if not isinstance(refined, dict) or refined.get("enabled") is False:
        return None
    if not str(refined.get("body") or "").strip():
        return None
    return "shot" if refined.get("scope") == "shot" else None


def refined_sections(data):
    refined = data.get("refined")
    if not isinstance(refined, dict) or refined.get("enabled") is False:
        return None
    sections = refined.get("sections")
    if not isinstance(sections, dict):
        return None
    kept = {name: str(sections.get(name) or "").strip() for name in contextir.REF_SECTIONS}
    return kept if any(kept.values()) else None


def audio_tail_seconds(raw):
    if raw is None:
        return DEFAULT_AUDIO_TAIL_S
    try:
        seconds = float(raw)
    except (TypeError, ValueError):
        raise CompileError(f"audio_tail_s must be a number (got {raw!r})")
    if seconds <= 0:
        raise CompileError("audio_tail_s must be greater than 0")
    return min(seconds, MAX_AUDIO_TAIL_S)


def refine_denoise(raw):
    if raw is None:
        return DEFAULT_REFINE_DENOISE
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise CompileError(f"refine_denoise must be a number (got {raw!r})")
    return min(MAX_REFINE_DENOISE, max(MIN_REFINE_DENOISE, value))


def first_pass_edge(raw, short_edge):
    ceiling = min(int(short_edge), canvas.NATIVE_SHORT_EDGE)
    if raw is None:
        return ceiling
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise CompileError(f"sample_edge must be a number (got {raw!r})")
    return max(canvas.MIN_SHORT_EDGE, min(ceiling, value))


def compile_request(data, image_size_lookup=None, continues=False, canvas_spec=None,
                    continues_audio=False, shots=1, feather=1, locked=False, cached_video=None):
    if not isinstance(data, dict):
        raise CompileError("creator_data must be a JSON object")

    assets = _parse_assets(data.get("assets"))

    frame_assets = [a for a in assets if a.role in ("first_frame", "last_frame")]
    for role in ("first_frame", "last_frame"):
        if sum(1 for a in frame_assets if a.role == role) > 1:
            raise CompileError(f"only one {role} is allowed")
    first_frame = next((a for a in frame_assets if a.role == "first_frame"), None)
    last_frame = next((a for a in frame_assets if a.role == "last_frame"), None)

    refs = [a for a in assets if a.role == "reference"]
    ref_images = [a for a in refs if a.kind == "image"]
    ref_videos = [a for a in refs if a.kind == "video" and a.track != "sound"]
    ref_audios = [a for a in refs if a.kind == "audio" or (a.kind == "video" and a.track == "sound")]

    mode = _derive_mode(first_frame, last_frame, ref_images, ref_videos, ref_audios, continues)

    feather = int(feather or 1)
    if feather not in FEATHER_GRID:
        raise CompileError(
            f"a seam can inherit {', '.join(map(str, FEATHER_GRID))} frames — "
            f"the runs the video VAE's temporal grid can encode — not {feather}"
        )
    if feather > 1 and not continues:
        raise CompileError(
            "feathering is a property of a continuing seam — this segment does "
            "not continue from an earlier one"
        )
    audio_tail_s = audio_tail_seconds(data.get("audio_tail_s")) if continues_audio else 0.0
    if feather > 1 and continues_audio:
        audio_tail_s = min(audio_tail_s, feather / canvas.FPS)

    checkpoint, pinned = _resolve_checkpoint(mode, data.get("checkpoint"))
    if mode == "REF2VA":
        plan = plan_references(ref_images, ref_videos, ref_audios)
        labels = _labels_from_plan(plan)
    else:
        plan = []
        labels = _keyframe_labels(first_frame, last_frame, continues)

    body = _substitute(refined_body(data) or str(data.get("prompt") or ""), labels, assets)

    triggers = collect_triggers(active_loras(data.get("loras"), checkpoint))
    if triggers:
        prefix = ", ".join(triggers)
        body = f"{prefix}, {body}" if body.strip() else prefix

    seconds_shown = data.get("duration_s", 6)
    frames = canvas.frames_for_seconds(seconds_shown)
    short_edge = data.get("short_edge", canvas.NATIVE_SHORT_EDGE)

    if frames < 2 * feather:
        raise CompileError(
            f"a {feather}-frame feather needs a segment of at least "
            f"{2 * feather} frames (~{2 * feather / canvas.FPS:.1f} s) — the "
            f"inherited run is trimmed off after decode, and this segment has "
            f"only {frames}"
        )

    mode_raw = str(data.get("upscale") or UPSCALE_MODES[0])
    if mode_raw not in UPSCALE_MODES:
        raise CompileError(f"unknown upscale mode {mode_raw!r}")
    first_edge = first_pass_edge(data.get("sample_edge"), short_edge)
    two_pass = first_edge < short_edge and mode_raw == "two_pass"
    sample_edge = first_edge if two_pass else short_edge

    soundscape = _substitute(str(data.get("soundscape") or ""), labels, assets,
                             where="overall_soundscape")
    music = _substitute(str(data.get("music") or ""), labels, assets,
                        where="non_diegetic_music")
    sections = refined_sections(data)
    if sections:
        sections = {name: _substitute(text, labels, assets, where=name)
                    for name, text in sections.items()}
    prompt = contextir.compose(
        mode, body, soundscape, music, canvas.seconds_for_frames(frames),
        preamble=contextir.AUDIO_SEAM_LINE
                 if continues_audio and mode != "REF2VA" and feather == 1 else "",
        shots=max(int(shots or 1), contextir.count_shots(body)),
        sections=sections)

    anchor = first_frame or last_frame
    if canvas_spec is not None:
        width, height = canvas_spec.width, canvas_spec.height
        ratio, clamped, ratio_from_image = canvas_spec.ratio, canvas_spec.clamped, canvas_spec.from_image
    elif anchor is not None and image_size_lookup is not None:
        source_w, source_h = image_size_lookup(anchor.filename)
        width, height, ratio, clamped = canvas.canvas_from_image(source_w, source_h, sample_edge)
        ratio_from_image = True
    else:
        label = data.get("aspect", "16:9")
        if label not in canvas.ASPECT_PRESETS:
            raise CompileError(f"unknown aspect ratio {label!r}")
        ratio = canvas.ASPECT_PRESETS[label]
        width, height = canvas.resolve_canvas(ratio, sample_edge)
        clamped = False
        ratio_from_image = False

    refine = None
    if two_pass:
        target = canvas.resolve_canvas(ratio, short_edge)
        if target != (width, height):
            refine = Refine(*target, denoise=refine_denoise(data.get("refine_denoise")))

    return Compiled(
        mode=mode,
        checkpoint=checkpoint,
        checkpoint_pinned=pinned,
        prompt=prompt,
        body=body,
        soundscape=soundscape,
        music=music,
        frames=frames,
        seconds=canvas.seconds_for_frames(frames),
        width=width,
        height=height,
        ratio=ratio,
        ratio_label=canvas.describe_ratio(ratio),
        ratio_from_image=ratio_from_image,
        ratio_clamped=clamped,
        first_frame=first_frame,
        last_frame=last_frame,
        ref_images=ref_images,
        ref_videos=ref_videos,
        ref_audios=ref_audios,
        labels=labels,
        plan=plan,
        triggers=triggers,
        continues=continues,
        continues_audio=continues_audio,
        audio_tail_s=audio_tail_s,
        feather=feather,
        refine=refine,
        locked=bool(locked),
        cached_video=cached_video,
    )


# ---- timeline ---------------------------------------------------------------

RENDER_MODES = ("chained", "single")

_HANDLE_PREFIX = {"image": "img", "video": "vid", "audio": "aud"}


def render_mode(data):
    mode = data.get("render") or "chained"
    if mode not in RENDER_MODES:
        raise CompileError(f"unknown render mode {mode!r}")
    return mode


def _join_prompt(global_prompt, segment_prompt):
    parts = [p for p in (str(global_prompt or "").strip(), str(segment_prompt or "").strip()) if p]
    return "\n".join(parts)


def merge_loras(global_entries, segment_entries):
    segment_entries = list(segment_entries or [])
    named = {e.get("name") for e in segment_entries if isinstance(e, dict)}
    kept = [e for e in (global_entries or [])
            if isinstance(e, dict) and e.get("name") not in named]
    return kept + segment_entries


def timeline_pool(data):
    raw = data.get("assets")
    if not raw:
        return []
    pool = _parse_assets(raw)
    for asset in pool:
        if asset.role != "reference":
            raise CompileError(
                f"@{asset.handle}: a timeline-level asset is a reference any "
                f"segment can cite — a {asset.role.replace('_', ' ')} belongs "
                f"to one segment, so attach it there"
            )
    return pool


def cited_pool(pool, request, extra_texts=()):
    if not pool:
        return []
    texts = [str(request.get("prompt") or ""),
             str(request.get("soundscape") or ""),
             str(request.get("music") or "")]
    texts.extend(str(text or "") for text in extra_texts)
    refined = request.get("refined")
    if isinstance(refined, dict) and refined.get("enabled") is not False:
        texts.append(str(refined.get("body") or ""))
        sections = refined.get("sections")
        if isinstance(sections, dict):
            texts.extend(str(text or "") for text in sections.values())
    found = set()
    for text in texts:
        found.update(HANDLE_RE.findall(text))
    return [asset for asset in pool if asset.handle in found]


def _inject_pool(pool, request, extra_texts=()):
    cited = cited_pool(pool, request, extra_texts)
    if not cited:
        return request.get("assets")
    own = list(request.get("assets") or [])
    named = {item.get("handle") for item in own if isinstance(item, dict)}
    inject = [_asset_dict(asset) for asset in cited if asset.handle not in named]
    return inject + own if inject else own


def timeline_segments(data):
    if not isinstance(data, dict):
        raise CompileError("timeline_data must be a JSON object")

    segments = data.get("segments")
    if not isinstance(segments, list) or not segments:
        raise CompileError("a timeline needs at least one segment")
    if len(segments) > MAX_SEGMENTS:
        raise CompileError(f"at most {MAX_SEGMENTS} segments ({len(segments)} given)")
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            raise CompileError(f"segment {index + 1} is not a JSON object")
    return segments


def _continue_source(raw, index):
    try:
        number = int(raw)
    except (TypeError, ValueError):
        return None
    return number - 1 if 1 <= number < index else None


def timeline_payloads(data, image_size_lookup=None):
    segments = timeline_segments(data)
    global_prompt = str(data.get("prompt") or "").strip()
    pool = timeline_pool(data)
    global_cited = {asset.handle for asset in pool} & set(HANDLE_RE.findall(global_prompt))
    payloads = []

    for index, segment in enumerate(segments):
        request = dict(segment)
        request.pop("continue", None)
        request.pop("continue_audio", None)
        request.pop("continue_from", None)
        request.pop("feather", None)
        
        locked = bool(segment.get("locked"))
        cached_video = segment.get("cached_video") or None

        # Always join global prompt in front of every segment's prompt and refined body
        request["prompt"] = _join_prompt(global_prompt, segment.get("prompt"))
        refined = request.get("refined")
        if isinstance(refined, dict) and refined.get("enabled") is not False:
            body_text = refined.get("body")
            if body_text and str(body_text).strip() and global_prompt:
                request["refined"] = {
                    **refined,
                    "body": _join_prompt(global_prompt, body_text),
                }

        request["aspect"] = data.get("aspect", "16:9")
        request["short_edge"] = data.get("short_edge", canvas.NATIVE_SHORT_EDGE)
        for key in ("upscale", "sample_edge", "refine_denoise"):
            request.pop(key, None)
            if key in data:
                request[key] = data[key]
        request["loras"] = merge_loras(data.get("loras"), segment.get("loras"))
        for key in ("soundscape", "music"):
            request[key] = str(segment.get(key) or data.get(key) or "")
        request["audio_tail_s"] = data.get("audio_tail_s", DEFAULT_AUDIO_TAIL_S)
        
        merged_assets = _inject_pool(pool, request)
        if merged_assets is not request.get("assets"):
            request["assets"] = merged_assets
            if global_cited:
                frame = next((a for a in (segment.get("assets") or [])
                              if isinstance(a, dict)
                              and a.get("role") in ("first_frame", "last_frame")), None)
                if frame is not None:
                    raise CompileError(
                        f"segment {index + 1} has a {frame['role'].replace('_', ' ')}, and "
                        f"the global prompt cites "
                        + ", ".join("@" + h for h in sorted(global_cited))
                        + " — a reference cited there rides into every segment, and "
                        "references cannot share a generation with start/end frames "
                        "(FL2VA vs Ref2VA). Cite it only in the segments where it "
                        "appears, or remove the frame."
                    )
        payloads.append({
            "request": request,
            "continue": index > 0 and bool(segment.get("continue")),
            "continue_audio": index > 0 and bool(segment.get("continue_audio")),
            "locked": locked,
            "cached_video": cached_video,
        })
        if payloads[-1]["continue"] or payloads[-1]["continue_audio"]:
            source = _continue_source(segment.get("continue_from"), index)
            if source is not None:
                payloads[-1]["continue_from"] = source
        if payloads[-1]["continue"]:
            try:
                feather = int(segment.get("feather") or 1)
            except (TypeError, ValueError) as exc:
                raise CompileError(f"segment {index + 1}: feather must be a number of frames") from exc
            if feather > 1:
                payloads[-1]["feather"] = feather

    try:
        first = compile_request(payloads[0]["request"], image_size_lookup)
    except CompileError as exc:
        raise CompileError(f"segment 1: {exc}") from exc
    spec = {
        "width": first.width, "height": first.height, "ratio": first.ratio,
        "label": first.ratio_label, "from_image": first.ratio_from_image,
        "clamped": first.ratio_clamped,
    }
    for payload in payloads:
        payload["canvas"] = dict(spec)
    return payloads


# ---- one pass ---------------------------------------------------------------


def _asset_dict(asset):
    out = {"handle": asset.handle, "kind": asset.kind, "role": asset.role,
           "filename": asset.filename}
    if asset.track:
        out["track"] = asset.track
    if asset.ref_size != "match":
        out["ref_size"] = asset.ref_size
    if asset.trim:
        out["trim"] = {"start": asset.trim[0], "end": asset.trim[1]}
    if asset.takes != "full":
        out["takes"] = asset.takes
    return out


def _agree(values, what, blank=""):
    distinct = [v for v in dict.fromkeys(values) if v and v != blank]
    if len(distinct) > 1:
        raise CompileError(
            f"the shots disagree about {what} ({', '.join(map(str, distinct))}) — "
            f"one pass has only one, so it has to be the same across the timeline"
        )
    return distinct[0] if distinct else blank


def single_payload(data):
    segments = timeline_segments(data)
    last_index = len(segments)
    global_prompt = str(data.get("prompt") or "").strip()
    pool = timeline_pool(data)
    pool_handles = {asset.handle for asset in pool}
    global_texts = (global_prompt,
                    str(data.get("soundscape") or ""),
                    str(data.get("music") or ""))

    assets = []
    position_of = {}
    counters = {}
    shots = []
    at = 0.0
    stack = data.get("loras")
    with_refs, with_frames = [], []

    for number, segment in enumerate(segments, start=1):
        try:
            parsed = _parse_assets(_inject_pool(
                pool, segment, extra_texts=global_texts if number == 1 else ()))
        except CompileError as exc:
            raise CompileError(f"shot {number}: {exc}") from exc

        rename = {}
        for asset in parsed:
            if asset.role == "first_frame" and number != 1:
                raise CompileError(
                    f"shot {number} has a start frame, but one pass opens on shot 1 — "
                    f"a start frame is the video's first frame, so it can only be shot 1's"
                )
            if asset.role == "last_frame" and number != last_index:
                raise CompileError(
                    f"shot {number} has an end frame, but one pass ends on shot "
                    f"{last_index} — an end frame is the video's final frame, so it can "
                    f"only be the last shot's"
                )
            if asset.role == "reference":
                with_refs.append(number)
            else:
                with_frames.append(number)

            pooled = asset.handle in pool_handles
            key = (asset.handle if pooled else None,
                   asset.kind, asset.role, asset.filename, asset.track,
                   asset.ref_size, asset.trim, asset.takes)
            position = position_of.get(key)
            if position is None:
                position = position_of[key] = len(assets)
                if pooled:
                    assets.append(asset)
                else:
                    counters[asset.kind] = counters.get(asset.kind, 0) + 1
                    assets.append(replace(
                        asset, handle=f"{_HANDLE_PREFIX[asset.kind]}-{counters[asset.kind]}"))
            rename[asset.handle] = assets[position].handle

        written = refined_body(segment)

        text = HANDLE_RE.sub(
            lambda m: "@" + rename.get(m.group(1), m.group(1)),
            written or str(segment.get("prompt") or ""),
        ).strip()
        if number == 1 and global_prompt:
            joiner = "" if global_prompt[-1] in ".!?,;:—" else "."
            text = f"{global_prompt}{joiner} {text}".strip()
        shots.append((at, text))
        at += float(segment.get("duration_s", 6) or 0)

        stack = merge_loras(stack, segment.get("loras"))

    if with_refs and with_frames:
        raise CompileError(
            f"shot {with_frames[0]} has a start/end frame and shot {with_refs[0]} has "
            f"references. Those are two different checkpoints (FL2VA vs Ref2VA) and one "
            f"pass runs on one of them, so a one-pass timeline cannot hold both."
        )

    try:
        body = contextir.shot_body(shots)
    except ValueError as exc:
        raise CompileError(str(exc)) from exc

    request = {
        "prompt": body,
        "assets": [_asset_dict(a) for a in assets],
        "loras": stack,
        "duration_s": at,
        "aspect": data.get("aspect", "16:9"),
        "short_edge": data.get("short_edge", canvas.NATIVE_SHORT_EDGE),
        **{key: data[key] for key in ("upscale", "sample_edge", "refine_denoise") if key in data},
    }
    for key in ("soundscape", "music"):
        request[key] = _agree(
            [str(data.get(key) or "")] + [str(s.get(key) or "") for s in segments], key)
    sections = refined_sections(data)
    if sections:
        request["refined"] = {"sections": sections}
    pin = _agree([s.get("checkpoint") for s in segments], "the checkpoint", blank="auto")
    if pin != "auto":
        request["checkpoint"] = pin

    return {"request": request, "shots": contextir.count_shots(body),
            "continue": False, "continue_audio": False}


def compile_segment(payload, image_size_lookup=None):
    spec = payload.get("canvas")
    return compile_request(
        payload["request"], image_size_lookup,
        continues=bool(payload.get("continue")),
        continues_audio=bool(payload.get("continue_audio")),
        shots=int(payload.get("shots", 1)),
        feather=int(payload.get("feather", 1)),
        locked=bool(payload.get("locked")),
        cached_video=payload.get("cached_video"),
        canvas_spec=CanvasSpec(**spec) if spec else None)


def compile_single(data, image_size_lookup=None):
    return compile_segment(single_payload(data), image_size_lookup)


def compile_timeline(data, image_size_lookup=None):
    compiled = []
    for index, payload in enumerate(timeline_payloads(data, image_size_lookup)):
        try:
            compiled.append(compile_segment(payload, image_size_lookup))
        except CompileError as exc:
            raise CompileError(f"segment {index + 1}: {exc}") from exc
    return compiled