import asyncio
import os

from aiohttp import web

from server import PromptServer

from . import compile as compiler, media, preview, refine, refine_api, refine_local, refine_skill

MAX_IMAGES = 16

_WHAT = {
    "first_frame": "the target video's first frame",
    "last_frame": "the target video's final frame",
}

_TAKES_WHAT = {
    "person": "a person reference",
    "object": "an object reference",
    "scene": "a scene reference",
    "style": "a style reference",
}
_TAKES_NOTE = {
    "person": "only the person is the reference — face, hair, skin, build and "
              "what they wear. The picture's background, palette, lighting, "
              "pose and action are not part of it: define the subject as the "
              "person alone and retain nothing else from this picture",
    "object": "only the object itself is the reference. The picture's "
              "surroundings, lighting and arrangement are not part of it: "
              "define the subject as the object alone and retain nothing else "
              "from this picture",
    "scene": "only the place is the reference — the environment, its surfaces "
             "and its light. Any people or passing objects in the picture, and "
             "its framing, are not part of it",
    "style": "only the look is the reference — medium, palette, light and "
             "rendering. The picture's subjects, layout and content are not "
             "part of it",
}


def _slot(asset, label, show_label):
    what = _WHAT.get(asset.role)
    if what is None:
        what = {
            "image": _TAKES_WHAT.get(asset.takes, "a reference image"),
            "video": {"picture": "a reference video, picture only",
                      "picture+sound": "a reference video, picture and soundtrack",
                      "sound": "a reference video used for its soundtrack alone"}.get(
                          asset.track, "a reference video"),
            "audio": "a reference audio clip",
        }[asset.kind]
    row = {"handle": asset.handle, "what": f"{what} ({os.path.basename(asset.filename)})"}
    if asset.kind == "image" and asset.role == "reference" and asset.takes in _TAKES_NOTE:
        row["note"] = _TAKES_NOTE[asset.takes]
    if show_label and label:
        row["label"] = label
    if asset.kind == "audio" or (asset.kind == "video" and asset.track == "sound"):
        row["note"] = "you cannot hear it; take what it holds from the request"
    return row


def _still(path):
    import io
    from PIL import Image

    try:
        cached = preview._cache_path(path, "thumb", "jpg")
        if os.path.exists(cached):
            return Image.open(cached)
    except OSError:
        pass
    buffer = io.BytesIO()
    preview._render_thumb(path, buffer)
    buffer.seek(0)
    return Image.open(buffer)


def _picture(asset):
    from PIL import Image

    try:
        path = media.resolve(asset.filename)
        if asset.kind == "image":
            return Image.open(path)
        if asset.kind == "video" and asset.track != "sound":
            return _still(path)
    except Exception:
        pass
    return None


def _sighted(slot, asset, picture):
    if picture is not None:
        slot["picture"] = True
    elif asset.kind != "audio" and asset.track != "sound":
        slot["note"] = "the file could not be read, so no picture of it is attached"
    return slot


def _look(compiled, show_labels):
    slots, images = [], []
    ordered = [a for a in (compiled.first_frame, compiled.last_frame) if a is not None]
    ordered += compiled.ref_images + compiled.ref_videos + compiled.ref_audios

    for asset in ordered:
        slot = _slot(asset, compiled.labels.get(asset.handle), show_labels)
        picture = _picture(asset)
        if picture is not None:
            images.append(picture)
        slots.append(_sighted(slot, asset, picture))
    return slots, images


def _look_pool(pool):
    slots, images = [], []
    for asset in pool:
        slot = _slot(asset, None, False)
        picture = _picture(asset)
        if picture is not None:
            images.append(picture)
        slots.append(_sighted(slot, asset, picture))
    return slots, images


def _shot(compiled, text, seconds, continues, show_labels):
    slots, images = _look(compiled, show_labels)
    assets = [a for a in [compiled.first_frame, compiled.last_frame] if a is not None]
    assets += compiled.ref_images + compiled.ref_videos + compiled.ref_audios
    return {
        "mode": compiled.mode,
        "seconds": seconds,
        "text": text,
        "continues": continues,
        "slots": slots,
        "labels": dict(compiled.labels),
        "handles": {a.handle for a in assets},
        "refs": {a.handle for a in
                 compiled.ref_images + compiled.ref_videos + compiled.ref_audios},
    }, images


def _plan(body):
    kind = body.get("kind")
    data = body.get("data")
    if not isinstance(data, dict):
        raise compiler.CompileError("no state was sent")
    if kind not in ("creator", "segment", "timeline"):
        raise compiler.CompileError(f"unknown refine target {kind!r}")

    if kind == "creator":
        compiled = compiler.compile_request(data, media.image_size)
        shot, images = _shot(compiled, str(data.get("prompt") or ""),
                             compiled.seconds, False, True)
        return compiled.mode, [shot], images, None, False, None

    single = compiler.render_mode(data) == "single"
    segments = compiler.timeline_segments(data)
    payloads = compiler.timeline_payloads(data, media.image_size)

    pool_assets = compiler.timeline_pool(data)
    pool = None
    if pool_assets:
        slots, pictures = _look_pool(pool_assets)
        pool = {"slots": slots, "images": pictures,
                "handles": {a.handle for a in pool_assets}}

    wanted = list(range(len(segments)))
    if kind == "segment":
        index = int(body.get("index", 0))
        if not 0 <= index < len(segments):
            raise compiler.CompileError(f"there is no segment {index + 1}")
        wanted = [index]

    shots, images = [], []
    lone = len(wanted) == 1
    for index in wanted:
        payload = payloads[index]
        compiled = compiler.compile_segment(payload, media.image_size)
        shot, pictures = _shot(
            compiled,
            str(segments[index].get("prompt") or ""),
            float(segments[index].get("duration_s") or 0) if single else compiled.seconds,
            bool(payload.get("continue")),
            lone,
        )
        shot["index"] = index
        if pool:
            shot["handles"] |= pool["handles"]
        shots.append(shot)
        images.extend(pictures)

    piece = str(data.get("prompt") or "")
    return _representative(data, shots, single), shots, images, piece, single, pool


def _representative(data, shots, single):
    if single:
        return compiler.compile_single(data, media.image_size).mode

    modes = [shot["mode"] for shot in shots]
    if "REF2VA" in modes:
        return "REF2VA"
    return modes[0] if modes else "T2VA"


def _shared(shots):
    handles, refs, labels, conflicted = set(), set(), {}, set()
    for shot in shots:
        handles |= shot["handles"]
        refs |= shot.get("refs", set())
        for key, label in shot["labels"].items():
            if labels.setdefault(key, label) != label:
                conflicted.add(key)
    for key in conflicted:
        del labels[key]
    owners = {}
    for key, label in labels.items():
        owners.setdefault(label, []).append(key)
    for keys in owners.values():
        if len(keys) > 1:
            for key in keys:
                del labels[key]
    return handles, refs, labels


def _run_skill(body, name, mode, shots, pictures, seconds, dropped, piece_text=None):
    if len(shots) != 1:
        raise compiler.CompileError(
            "a skill writes one whole prompt at a time — refine cards one by one, "
            "or switch the refiner back to its built-in prompts"
        )
    shot = shots[0]
    if (piece_text or "").strip():
        shot = {**shot, "text": compiler._join_prompt(piece_text, shot.get("text"))}

    skill = refine_skill.load(name)
    provider = body.get("provider", "comfy")
    url = body.get("url", "")
    model = body.get("model") or ""

    if provider == "ollama":
        content = refine_api.chat_ollama(
            url=url or "http://localhost:11434",
            model=model,
            system=refine_skill.system_prompt(skill),
            message=refine_skill.user_message(shot, seconds=seconds, images=len(pictures),
                                              mode=mode, language=body.get("language")),
            images=pictures,
            temperature=body.get("temperature", 0.7),
            seed=body.get("seed", -1),
            max_tokens=body.get("max_tokens"),
        )
    elif provider == "openai":
        content = refine_api.chat_openai(
            url=url or "http://localhost:1234/v1",
            model=model,
            system=refine_skill.system_prompt(skill),
            message=refine_skill.user_message(shot, seconds=seconds, images=len(pictures),
                                              mode=mode, language=body.get("language")),
            images=pictures,
            temperature=body.get("temperature", 0.7),
            seed=body.get("seed", -1),
            max_tokens=body.get("max_tokens"),
        )
    else:
        content = refine_local.chat(
            model,
            refine_skill.system_prompt(skill),
            refine_skill.user_message(shot, seconds=seconds, images=len(pictures),
                                      mode=mode, language=body.get("language")),
            [refine_local.to_tensor(p) for p in pictures],
            temperature=body.get("temperature", 0.7),
            seed=body.get("seed", -1),
            max_tokens=body.get("max_tokens"),
            prefill="",
        )
    written = refine.normalize_handles(refine_skill.parse_reply(content), shot["labels"])

    problems = []
    if dropped:
        problems.append(
            f"{dropped} attached file{'s were' if dropped != 1 else ' was'} not shown to "
            f"the model — one call looks at at most {MAX_IMAGES}"
        )
    problems += ["The rewrite " + p for p in refine.check(written, shot["handles"], shot["labels"])]
    for handle in refine.uncited(written, shot["refs"], shot["labels"]):
        problems.append(
            f"the rewrite never mentions @{handle} — the file is still attached, "
            f"but nothing in the prompt will point at it. Refine again, or write "
            f"it in yourself."
        )

    return {
        "mode": mode,
        "skill": skill["name"],
        "shots": [{"index": shot.get("index"), "body": written}],
        "soundscape": "",
        "music": "",
        "sections": None,
        "seen": "",
        "problems": problems,
    }


def _run(body):
    kind = body.get("kind")
    derived, shots, pictures, piece_text, single, pool = _plan(body)

    seconds = sum(float(s.get("seconds") or 0) for s in shots)

    skill = str(body.get("skill") or "").strip()
    if skill:
        dropped, pictures = refine._number([shot["slots"] for shot in shots],
                                           pictures, MAX_IMAGES)
        return _run_skill(body, skill, derived, shots, pictures, seconds, dropped,
                          piece_text)

    dropped, pictures = refine._number(
        ([pool["slots"]] if pool else []) + [shot["slots"] for shot in shots],
        (pool["images"] if pool else []) + pictures,
        MAX_IMAGES,
        shared=pool["handles"] if pool else frozenset())

    mode, forced = refine.choose_template(body.get("template"), derived)
    if forced:
        for shot in shots:
            shot["mode"] = mode

    cuts = refine.shot_limit(seconds) if kind == "creator" else 0

    ask_piece = kind == "timeline"
    piece = None
    if ask_piece:
        piece = {"text": piece_text, "rewrite": True}
    elif kind == "segment" and (piece_text or "").strip():
        piece = {"text": piece_text, "rewrite": False}

    ref_shots = ()
    if kind == "timeline" and not single and mode == "REF2VA":
        ref_shots = tuple(n for n, s in enumerate(shots) if s["mode"] == "REF2VA")

    shape = refine.reply_shape(mode, len(shots), cuts=cuts, images=len(pictures),
                               piece=ask_piece, ref_shots=ref_shots)
    system = refine.system_prompt(mode, body.get("language") or "English",
                                  shape=shape, cuts=cuts)
    message = refine.user_message(
        shots,
        seconds=seconds,
        images=len(pictures),
        mode=mode,
        piece=piece,
        pool=pool["slots"] if pool else None,
    )

    provider = body.get("provider", "comfy")
    url = body.get("url", "")
    model = body.get("model") or ""

    if provider == "ollama":
        content = refine_api.chat_ollama(
            url=url or "http://localhost:11434",
            model=model,
            system=system,
            message=message,
            images=pictures,
            temperature=body.get("temperature", 0.3),
            seed=body.get("seed", -1),
            max_tokens=body.get("max_tokens"),
        )
    elif provider == "openai":
        content = refine_api.chat_openai(
            url=url or "http://localhost:1234/v1",
            model=model,
            system=system,
            message=message,
            images=pictures,
            temperature=body.get("temperature", 0.3),
            seed=body.get("seed", -1),
            max_tokens=body.get("max_tokens"),
        )
    else:
        content = refine_local.chat(
            model,
            system,
            message,
            [refine_local.to_tensor(p) for p in pictures],
            temperature=body.get("temperature", 0.3),
            seed=body.get("seed", -1),
            max_tokens=body.get("max_tokens"),
        )

    parsed = refine.parse_reply(content, mode, len(shots), cuts=cuts,
                                piece=ask_piece, ref_shots=ref_shots)

    if "cuts" in parsed:
        parsed["shots"] = [refine.join_shots(parsed["shots"], parsed["cuts"], seconds)]

    problems = []
    if dropped:
        problems.append(
            f"{dropped} attached file{'s were' if dropped != 1 else ' was'} not shown to "
            f"the model — one call looks at at most {MAX_IMAGES}"
        )
    if pictures and not parsed.get("seen"):
        problems.append(
            "the model did not say what it saw in the attached images, so it may "
            "have written past them — check the rewrite against your frames"
        )

    shot_sections = parsed.get("shot_sections") or [None] * len(shots)
    out = []
    for position, (shot, written) in enumerate(zip(shots, parsed["shots"])):
        written = refine.normalize_handles(written, shot["labels"])
        where = f"Shot {shot['index'] + 1} " if "index" in shot else "The rewrite "
        for problem in refine.check(written, shot["handles"], shot["labels"]):
            problems.append(where + problem)
        entry = {"index": shot.get("index"), "body": written}

        if position in ref_shots:
            own = shot_sections[position] if position < len(shot_sections) else None
            if own:
                own = {name: refine.normalize_handles(text, shot["labels"])
                       for name, text in own.items()}
                for name, text in own.items():
                    for problem in refine.check(text, shot["handles"], shot["labels"]):
                        problems.append(f"{where.rstrip()}'s {name} {problem}")
                entry["sections"] = own
            else:
                problems.append(
                    where + "has @ references and the rewrite wrote no reference "
                    "analysis for it — refine again, or refine that card alone"
                )
            here = "\n".join([written] + list((own or {}).values()))
            for handle in refine.uncited(here, shot["refs"], shot["labels"]):
                problems.append(
                    f"{where.rstrip()} never mentions @{handle} — the file is still "
                    f"attached, but nothing in that card's prompt will point at "
                    f"it. Refine again, or write it in yourself."
                )
        out.append(entry)

    handles, refs, labels = _shared(shots)

    def normalized(text, field):
        text = refine.normalize_handles(text, labels)
        for problem in refine.check(text, handles, labels):
            problems.append(f"The {field} {problem}")
        return text

    parsed["soundscape"] = normalized(parsed["soundscape"], "overall_soundscape")
    parsed["music"] = normalized(parsed["music"], "non_diegetic_music")
    sections = parsed.get("sections")
    if sections:
        sections = {name: normalized(text, name) for name, text in sections.items()}
        parsed["sections"] = sections

    piece_out = None
    if ask_piece:
        piece_out = parsed.get("piece") or ""
        if not piece_out.strip():
            problems.append(
                "the model did not rewrite the global prompt — the one you typed "
                "stays in front of every segment as it is"
            )
        else:
            shared_pool = pool["handles"] if pool else set()
            pointed = ["@" + h for h in sorted(set(refine.HANDLE_RE.findall(piece_out))
                                               - shared_pool)]
            pointed += sorted({f"<{kind_} {int(n)}>" for kind_, n in
                               (m.groups() for m in refine.LABEL_RE.finditer(piece_out))})
            if pointed:
                problems.append(
                    "the rewritten global prompt mentions " + ", ".join(pointed)
                    + " — it stands in front of every segment, and only a piece "
                    "reference's @handle means the same thing in all of them. "
                    "Edit it out before queueing."
                )

    everything = "\n".join([entry["body"] for entry in out]
                           + [text for entry in out
                              for text in (entry.get("sections") or {}).values()]
                           + list((sections or {}).values())
                           + [parsed["soundscape"], parsed["music"], piece_out or ""])
    if not ref_shots:
        for handle in refine.uncited(everything, refs, labels):
            problems.append(
                f"the rewrite never mentions @{handle} — the file is still attached, "
                f"but nothing in the prompt will point at it. Refine again, or write "
                f"it in yourself."
            )

    for span in refine.dropped_quotes(
            [s.get("text") or "" for s in shots] + [piece_text or ""], everything):
        problems.append(
            f'the request quotes "{span}" and the rewrite never writes it — '
            f'those exact words will not reach the video model. Refine again, '
            f'or edit them in.'
        )

    return {
        "mode": mode,
        "template": mode,
        "derived": derived,
        "forced": forced,
        "shots": out,
        "soundscape": parsed["soundscape"],
        "music": parsed["music"],
        "sections": parsed.get("sections"),
        "piece": piece_out,
        "scope": "shot" if kind in ("segment", "timeline") else None,
        "seen": parsed.get("seen") or "",
        "problems": problems,
    }


@PromptServer.instance.routes.get("/minimax_creator/refine/models")
async def refine_models(request):
    provider = request.query.get("provider", "comfy")
    url = request.query.get("url", "")
    loop = asyncio.get_running_loop()
    try:
        if provider == "ollama":
            models_list = await loop.run_in_executor(None, refine_api.fetch_models_ollama, url or "http://localhost:11434")
            return web.json_response({"models": models_list})
        elif provider == "openai":
            models_list = await loop.run_in_executor(None, refine_api.fetch_models_openai, url or "http://localhost:1234/v1")
            return web.json_response({"models": models_list})
        else:
            names = await loop.run_in_executor(None, refine_local.list_models)
            return web.json_response({"models": names})
    except Exception as exc:
        return web.json_response({"models": [], "error": str(exc)})


@PromptServer.instance.routes.get("/minimax_creator/refine/skills")
async def refine_skills(request):
    return web.json_response({"skills": refine_skill.list_skills()})


@PromptServer.instance.routes.post("/minimax_creator/refine")
async def refine_prompt(request):
    try:
        body = await request.json()
    except ValueError:
        return web.json_response({"error": "the request body was not JSON"}, status=400)

    if not (body.get("model") or "").strip():
        return web.json_response({"error":
            "No text encoder or LLM model chosen. Select a model in the refiner settings."
        }, status=400)

    loop = asyncio.get_running_loop()
    try:
        return web.json_response(await loop.run_in_executor(None, _run, body))
    except (refine.RefineError, compiler.CompileError, media.MediaError) as exc:
        return web.json_response({"error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"error": f"{type(exc).__name__}: {exc}"}, status=500)