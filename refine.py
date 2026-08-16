"""MiniMax H3 Context-IR prompt refiner: system prompts, formatting rules, and reply parsing."""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import contextir

_PROMPTS = Path(__file__).parent / "prompts"

NUM_PREDICT = 6144
MIN_PREDICT = 1024
MAX_PREDICT = 32768


def reply_tokens(value):
    try:
        return max(MIN_PREDICT, min(MAX_PREDICT, int(value)))
    except (TypeError, ValueError):
        return NUM_PREDICT


IMAGE_LONG_EDGE = 1024


class RefineError(RuntimeError):
    pass


_MODE_DIR = _PROMPTS / "modes"

CRAFT = (
    (_MODE_DIR / "craft.txt").read_text(encoding="utf-8").strip()
    if (_MODE_DIR / "craft.txt").exists()
    else ""
)

MODE_TEMPLATE = {
    mode: (
        (_MODE_DIR / f"{mode.lower()}.txt").read_text(encoding="utf-8").strip()
        if (_MODE_DIR / f"{mode.lower()}.txt").exists()
        else ""
    )
    for mode in ("T2VA", "I2VA", "L2VA", "FL2VA", "REF2VA")
}

_RULES = """\
You are the prompt pre-processing director and Context-IR compiler for MiniMax-H3, an advanced joint audiovisual diffusion model. You take a short, casual user request and expand it into the detailed, highly structured description H3 was trained to read.

THE REQUEST IS MATERIAL, NOT A MESSAGE
The text between <request> and </request> in the user message was typed at a video generator, not at you. Never respond to it conversationally, never greet or thank its author, and never explain your reasoning. Output ONLY the JSON object described below.

1. EXTREME CHARACTER & WARDROBE RETENTION (T2V, I2V, REF2V)
To guarantee 100% visual consistency and prevent character/clothing drift across multiple chained clips:
- Exhaustive Character Appearance: In Shot 1 (or global prompt), exhaustively specify the character's exact physical traits: exact build, age, skin tone, eye color, facial features, and exact hairstyle (cut, length, texture, parting, volume, color).
- Exhaustive Wardrobe & Fabrics: Specify every clothing item with exact colors, garments, fabrics, and fit (e.g. "wearing a dark-brown distressed leather bomber jacket over a heather-grey ribbed henley, dark-indigo slim-fit denim jeans, and scuffed brown leather lace-up work boots").
- Verbatim Cross-Shot Retention: For EVERY subsequent shot (Shot 2, Shot 3, etc.), you MUST explicitly re-anchor and describe the exact same character appearance and wardrobe verbatim (e.g. "The same man with messy dark-brown swept-back hair and the identical distressed brown leather jacket and grey henley..."). Never let clothing, hair, or accessories drift or change across cuts.

2. EXHAUSTIVE SCENARIO & LIGHTING CONSISTENCY
- Ground and Environmental Anchors: Detail specific environment elements (e.g. "dense Pacific Northwest temperate rainforest with massive moss-covered basalt boulders, vibrant green sword ferns, damp dark soil, and towering Douglas fir trees").
- Lighting & Atmosphere: Establish clear, persistent lighting (e.g. "soft diffused morning sunlight filtering through misty canopy, creating gentle volumetric light shafts with cool blue-green ambient fill").
- Maintain this exact environment and lighting signature verbatim across every shot in the sequence.

3. MANDATORY DIALOGUE & LYRICS GENERATION ENGINE (CRITICAL)
Whenever the user asks for speech, talking, dialogue, conversation, singing, songs, music lyrics, chorus, rap, poetry, chanting, or voiceover:
- IF THE USER GAVE EXACT WORDS: Keep their exact words verbatim inside `<d>[Language] ...</d>`.
- IF THE USER ASKED FOR SINGING/LYRICS/SPEECH BUT GAVE NO LINES: You MUST creatively compose original, realistic spoken lines or rhyming sung lyrics yourself and place them inside `<d>[Language] ...</d>`.
- STRICTLY FORBIDDEN: NEVER write abstract descriptive summaries like "she sings an emotional chorus", "she belts out a melody", "they discuss their mission", or "he speaks with grief".
- REQUIRED SINGING FORMAT: You MUST write the actual sung lyric verses:
  * WRONG: "She sings an emotional pop chorus into the ocean."
  * CORRECT: "The young woman with an airy, melancholic vocal timbre (S1) belts out the emotional chorus: <d>[English] In the shadow of the tide, where the ocean meets the shore, I am searching for a sign of what we were before.</d>"
- REQUIRED DIALOGUE FORMAT:
  * WRONG: "The detective questions the suspect."
  * CORRECT: "The detective with a low, raspy voice (S1) asks firmly: <d>[English] Where were you on the night the alarm went off?</d>"
- Dialogue/Lyric Pacing: 2.0 to 3.5 words per second of that shot duration so vocals finish before the cut.
- Speaker IDs: Assign stable IDs `(S1)`, `(S2)`, `(S1,S2)` to characters when they first vocalize, and maintain the identical speaker IDs across all shots.

4. SEAM CONTINUITY & TRANSITIONS (FOR MULTI-SHOT TIMELINES)
For each shot after Shot 1, evaluate motion momentum and continuity:
- Continuous running, action, camera movement, or momentum: `"transition": "cross_blend_39f"` (39 frames lossless latent mask) or `"transition": "motion_blend_22f"` (22 frames fast latent mask).
- Smooth character/camera match: `"transition": "match_cut_1f"`.
- Dialogue or background score carrying over a cut: `"transition": "cut_with_sound"`.
- Total scene, viewpoint, or time jump: `"transition": "hard_cut"`.

5. SOUNDSCAPE & MUSIC SPECIFICATION
- For each shot, write `soundscape` describing physical action sounds, ambient room tone, footsteps, water, wind, impacts, and clothing rustle.
- Write `music` describing instrumentation, tempo, key, rhythm, and dynamic swells when appropriate. Dialogue and singing live strictly inside `<d>` tags in the shot bodies.

FIDELITY TO THE REQUEST
The request is the specification. Your job is to say the same thing in far more detail, in the vocabulary this model reads.
Carry every concrete thing the request names into your output and expand it there: the subject, the action, the place, the time of day, the weather, the mood, and above all the look — a named show, film, artist, studio, franchise or game; an art medium such as watercolour, claymation, pixel art, stop-motion, cel animation; an era or format such as 80s VHS, Super 8, vintage film; a camera, lens, film stock or frame size; a colour palette; an adjective like gritty, noir, pastel, sun-bleached.

Expanding a style means naming it explicitly in the first shot and then describing the visual signature it actually has, from your own knowledge of it: the medium, the line or grain quality, character design and proportions, the palette, how light and shadow behave, how backgrounds are drawn, how motion feels, how shots are framed. The video model may not recognise the name, so the description has to carry the look on its own. Once established, keep every later shot in that same visual language.

The same applies to a camera direction. "Shot on a small-frame camera" stays in the prose as written and gains what that format looks like: the grain structure, the depth of field, how the lens renders highlights and edges, the contrast and colour it produces. A request that names equipment is asking for the image that equipment makes.

Where the request is silent, choose what suits what it did say and keep it consistent. A request that names no style gets the plainest one that fits, usually live-action and cinematic, described plainly.
Where the request and these instructions pull apart, the request decides what the video contains and the instructions decide how it is written down. Keep the request's subject matter intact and unedited, and write it in this form.

REFERENCES
Attached media is named by handles such as @img-1, @vid-2, @aud-1, @ref-1. Write handles in your prose wherever you mean that asset — the labels are substituted in afterwards. Use only handles from that list.
"""

_CUTS_RULE = """\
SHOTS AND CUTS
How this video is divided into shots is yours to decide. The request states how many seconds it runs ({seconds:.1f}s); write between 1 and {limit} shots that fill exactly that time, and give each one the second its cut lands on as `at_seconds`, counted from the start of the video. The first shot's `at_seconds` is 0 and each later one is strictly larger than the one before it.

Let the request decide, and count what it actually asks for. One sustained action, one held moment, one unbroken movement is one continuous shot. A request that names more than one place, viewpoint, subject or moment in time is that many shots, and writing it as a single body drops the moves it asked for. Give each shot enough seconds to be read as a shot, {floor:.0f}s at the very least. Write each body for the length you gave it: an action, and any speech/singing in it, has to finish inside its own shot.
"""

_LANGUAGE_RULE = """\
LANGUAGE
Write all descriptive prose, dialogue lines, and lyrics in {language}, translating the request where needed. Keep structural syntax and markers in English exactly as these instructions specify: reference labels, speaker IDs (S1), `<d>[{language}] ...</d>`, `<scenetrans>`, `<cutoff>`, the `retention_analysis` markers, and the camera-motion vocabulary. Inside a `<d>` tag the language tag is `[{language}]`.
"""

MODE_NOTES = {
    "T2VA": "No reference frames are attached. Describe the video, characters, clothing, and environment from nothing in exhaustive detail.",
    "I2VA": "The attached start frame is the video's first frame. Open Shot 1 on exactly that image — its subjects, clothing, colours, objects and layout — and develop forward from it.",
    "L2VA": "The attached end frame is the video's final frame. Open on a state that could plausibly lead there and arrive at exactly that image at the end.",
    "FL2VA": "The attached start and end frames are the video's first and last frames. Describe the continuous path from one to the other, keeping both exactly as they are; the last shot is the one that arrives at the end frame.",
    "REF2VA": "Reference assets are attached. Produce the full six-section full-reference rewrite: subject_definitions, summary, retention_analysis, the per-shot bodies, soundscape and music, with every reference handle used consistently across all of them.",
}

CONTINUES_NOTE = (
    "This shot continues straight out of the previous shot in the finished clip: "
    "its first frame is the previous one's last frame. Open in that same place, "
    "with the identical subjects, wardrobe, hair, light and framing, and move on from there."
)


def choose_template(choice, mode):
    choice = str(choice or "auto").strip().upper()
    if choice in ("", "AUTO"):
        return mode, False
    if choice not in MODE_TEMPLATE:
        raise RefineError(f"unknown refine template {choice!r}")
    if mode == "REF2VA" and choice != "REF2VA":
        raise RefineError(
            "this request has @ references, and only the REF2VA template writes "
            "the six-section form that defines them — set the template back to "
            "auto, or remove the references"
        )
    if choice == "REF2VA" and mode != "REF2VA":
        raise RefineError(
            "the REF2VA template writes subject definitions and retention "
            "analysis for @ references, and this request has none — attach "
            "references, or set the template back to auto"
        )
    return choice, choice != mode


_REF_SECTIONS = ("subject_definitions", "summary", "retention_analysis")

SEEN_FIELD = "what_i_see"
PIECE_FIELD = "global_prompt"

MIN_SHOT_S = 2.0
MAX_SHOTS = 6


def shot_limit(seconds):
    return max(1, min(MAX_SHOTS, int(float(seconds or 0) // MIN_SHOT_S)))


def plan_cuts(bodies, cuts, seconds):
    seconds = float(seconds or 0)
    out = []
    for index, body in enumerate(bodies):
        if not out:
            out.append([0.0, body])
            continue
        floor = out[-1][0] + MIN_SHOT_S
        ceiling = seconds - MIN_SHOT_S
        if floor > ceiling:
            out[-1][1] = f"{out[-1][1]} {body}".strip()
            continue
        try:
            at = float(cuts[index])
        except (TypeError, ValueError, IndexError):
            at = floor
        out.append([max(floor, min(at, ceiling)), body])
    return [(at, body) for at, body in out]


def join_shots(bodies, cuts, seconds):
    clean, times = [], []
    for index, body in enumerate(bodies):
        body = contextir.SHOT_RE.sub("", body)
        body = contextir.CUT_TIME_RE.sub("", body)
        body = re.sub(r"^[\s,]+", "", body).strip()
        if body:
            clean.append(body)
            times.append(cuts[index] if index < len(cuts) else None)
    if not clean:
        raise RefineError("the model returned shot markers with no prose in them")
    return contextir.shot_body(plan_cuts(clean, times, seconds))


CONTINUOUS_KEYWORDS = re.compile(
    r"\b(continues|steps into|walks forward|turns around|keeps moving|reaches for|looks up|still|meanwhile|next moment|running|chasing|speeding|sprinting)\b",
    re.IGNORECASE,
)


def infer_seam_continuity(prev_body, current_body, raw_item=None):
    """Determine transition parameters from LLM choice or text continuity."""
    if isinstance(raw_item, dict):
        trans = str(raw_item.get("transition") or raw_item.get("seam") or "").lower()
        if "39" in trans or "long" in trans or "cross" in trans:
            return {"continue": True, "feather": 39, "continuity_mode": "latent_mask", "continue_audio": True, "type": "blend_39"}
        if "22" in trans or "motion" in trans or "fast" in trans:
            return {"continue": True, "feather": 22, "continuity_mode": "latent_mask", "continue_audio": True, "type": "blend_22"}
        if "match" in trans or "1f" in trans or "continue" in trans:
            return {"continue": True, "feather": 1, "continuity_mode": "latent_mask", "continue_audio": True, "type": "match"}
        if "sound" in trans or "audio" in trans:
            return {"continue": False, "feather": 1, "continuity_mode": "keyframe_still", "continue_audio": True, "type": "sound"}
        if "hard" in trans or "cut" in trans or "reset" in trans:
            return {"continue": False, "feather": 1, "continuity_mode": "keyframe_still", "continue_audio": False, "type": "hard"}

    is_continuous = bool(CONTINUOUS_KEYWORDS.search(current_body or ""))
    has_dialogue_carryover = "<scenetrans>" in (prev_body or "") or "<scenetrans>" in (current_body or "")

    if is_continuous:
        return {"continue": True, "feather": 39, "continuity_mode": "latent_mask", "continue_audio": True, "type": "blend_39"}
    if has_dialogue_carryover:
        return {"continue": False, "feather": 1, "continuity_mode": "keyframe_still", "continue_audio": True, "type": "sound"}
    return {"continue": False, "feather": 1, "continuity_mode": "keyframe_still", "continue_audio": False, "type": "hard"}


def reply_shape(mode, shots, cuts=0, images=0, piece=False, ref_shots=(), ai_seam_mode="auto"):
    timed = int(cuts) >= 2
    ref_shots = set(ref_shots or ())
    lines = ["Return exactly this JSON object, and nothing before or after it:", "{"]
    if int(images) > 0:
        lines.append('  "%s": "...",' % SEEN_FIELD)
    if piece:
        lines.append('  "%s": "...",' % PIECE_FIELD)
    if mode == "REF2VA" and not ref_shots:
        lines += ['  "%s": "...",' % name for name in _REF_SECTIONS]
    if timed:
        lines.append('  "shots": [{"at_seconds": 0, "body": "...", "soundscape": "...", "music": "..."}],')
    else:
        shot_entries = []
        for index in range(shots):
            has_refs = index in ref_shots
            if has_refs:
                sec_keys = ", ".join('"%s": "..."' % name for name in _REF_SECTIONS)
                if index > 0:
                    shot_entries.append('{%s, "body": "...", "soundscape": "...", "music": "...", "transition": "cross_blend_39f | motion_blend_22f | match_cut_1f | cut_with_sound | hard_cut"}' % sec_keys)
                else:
                    shot_entries.append('{%s, "body": "...", "soundscape": "...", "music": "..."}' % sec_keys)
            else:
                if index > 0:
                    shot_entries.append('{"body": "...", "soundscape": "...", "music": "...", "transition": "cross_blend_39f | motion_blend_22f | match_cut_1f | cut_with_sound | hard_cut"}')
                else:
                    shot_entries.append('{"body": "...", "soundscape": "...", "music": "..."}')
        lines.append('  "shots": [%s],' % ", ".join(shot_entries))
    lines.append('  "overall_soundscape": "...",')
    lines.append('  "non_diegetic_music": "..."')
    lines.append("}")
    if piece:
        lines.append(
            "Write `%s` right after any `%s`: the piece's standing description, rewritten — see THE PIECE in the user message."
            % (PIECE_FIELD, SEEN_FIELD)
            if int(images) > 0
            else "Write `%s` first: the piece's standing description, rewritten — see THE PIECE in the user message." % PIECE_FIELD
        )
    if ref_shots:
        which = ", ".join(str(index + 1) for index in sorted(ref_shots))
        lines.append(
            ("Shot entry %s carries its own" if len(ref_shots) == 1 else "Shot entries %s each carry their own") % which
            + " subject_definitions, summary and retention_analysis, describing only the references attached to that shot. Entries without references have only a body."
        )
    if timed:
        lines.append(
            "Every `...` is one string of prose. `shots` holds 1 to %d entries in play order — one per shot, as many as this video wants — each with the second its cut lands on. If singing or speech is requested, write the lines inside <d>[English] ...</d>. Escape any quote inside the prose, and write no comments, no markdown fence and no explanation."
            % int(cuts)
        )
    else:
        lines.append(
            "Every `...` is one string of prose. `shots` holds exactly %d entr%s, in play order. For each shot, write its individual `soundscape`, `music`, and choose `transition` for shots after Shot 1. If singing or dialogue is asked for, you MUST compose and write the actual lines/lyrics inside `<d>[English] ...</d>`. Escape any quote inside the prose, and write no comments, no markdown fence and no explanation."
            % (shots, "y" if shots == 1 else "ies")
        )
    if int(images) > 0:
        lines.append(
            "Write `%s` first, before anything else: one sentence per attached picture, in the order they are attached, naming its handle and saying what is actually in that picture — the subjects and what they look like, their clothing, the objects, the setting, the colours, the light, the framing. Describe what you can see there, not what the request leads you to expect. Then write the rest of the object from it."
            % SEEN_FIELD
        )
    return "\n".join(lines)


def system_prompt(mode, language="English", shape=None, cuts=0, seconds=6.0):
    parts = [_RULES]
    if int(cuts) >= 2:
        parts.append(_CUTS_RULE.format(limit=int(cuts), floor=MIN_SHOT_S, seconds=float(seconds)))
    if language and language != "English":
        parts.append(_LANGUAGE_RULE.format(language=language))
    parts.append(f"MODE\nThis request is {mode}. {MODE_NOTES.get(mode, '')}")
    if CRAFT:
        parts.append(CRAFT)
    if MODE_TEMPLATE.get(mode):
        parts.append(MODE_TEMPLATE[mode])
    if shape:
        parts.append("OUTPUT FORMAT SPECIFICATION\n" + shape)
    return "\n\n".join(parts)


def describe_slots(slots):
    lines = []
    for slot in slots:
        label = f" (becomes {slot['label']})" if slot.get("label") else ""
        where = f" [image {slot['image']}]" if slot.get("image") else ""
        extra = f" — {slot['note']}" if slot.get("note") else ""
        lines.append(f"@{slot['handle']}{label}{where}: {slot['what']}{extra}")
    return lines


def user_message(shots, seconds=None, images=0, mode=None, piece=None, pool=None):
    many = len(shots) > 1
    lines = []

    # Detect if singing, lyrics, speech or dialogue are asked for anywhere in the requests
    all_req_text = " ".join(
        [str(s.get("text") or "") for s in shots] + [str((piece or {}).get("text") or "")]
    )
    is_vocal_request = bool(
        re.search(
            r"\b(sing|singing|sings|song|chorus|lyrics|vocal|vocals|voice|talk|talking|talks|speak|speaking|speaks|dialogue|conversation|argue|arguing|say|says|said|rap|rapping|voiceover|narrat)\b",
            all_req_text,
            re.IGNORECASE,
        )
    )

    if images == 1:
        lines.append(
            "One image is attached to this message. The asset marked "
            "[image 1] below is what it is a picture of. Look at it and "
            "describe what is actually there."
        )
    elif images:
        lines.append(
            f"{images} images are attached to this message, in order. The "
            f"asset marked [image N] below is what the Nth of them is a "
            f"picture of. Look at them and describe what is actually there."
        )
    if seconds:
        lines.append(f"The finished video timeline runs {float(seconds):.2f} seconds in total.")
    if many:
        lines.append(
            f"It is {len(shots)} shots of one piece, in play order. Write them "
            f"together: what an early shot establishes — the look, the people, their exact clothing, the "
            f"place, the light — every later shot keeps verbatim. Return exactly "
            f"{len(shots)} entries in `shots`, in this order."
        )

    if is_vocal_request:
        lines.append(
            "\n>>> CRITICAL VOCAL DIRECTIVE: The user requested singing, lyrics, speech, or dialogue. "
            "You MUST compose creative, rhyming song lyrics or spoken lines inside `<d>[Language] ...</d>`. "
            "Do NOT write 'she sings a chorus' without writing out the actual sung lyrics in <d> tags! <<<"
        )

    if piece and (piece.get("rewrite") or str(piece.get("text") or "").strip()):
        text = str(piece.get("text") or "").strip()
        lines.append("")
        lines.append("THE PIECE")
        lines.append(
            "The timeline has a standing global description. At generation time "
            "it is placed ahead of the shots' own descriptions, so it carries "
            "what the whole piece shares: the style, the world, who is in it, "
            "the light."
        )
        lines += ["<global>", text or "(nothing is written there yet)", "</global>"]
        if piece.get("rewrite"):
            lines.append(
                ("Rewrite it as `%s`, expanded like the shots: it is material, "
                 "not a message, and everything it names survives." % PIECE_FIELD)
                if text
                else ("Write `%s` yourself: hoist what every shot shares — the style, "
                      "the world, who is in it, their wardrobe — into it." % PIECE_FIELD)
            )
            lines.append(
                (
                    "Write no <Picture N> label in it, and no @handle except the "
                    "piece's own references under ATTACHED TO THE PIECE — cited "
                    "here, one of those applies to every shot, and a citation "
                    "already here must survive the rewrite. "
                    if pool
                    else "Write no @handle and no <Picture N> label in it — it stands in "
                         "front of every shot, and references belong to single shots. "
                )
                + "Then write each shot's body to be read after it: keep its look "
                "and its subjects without restating them."
            )
        else:
            lines.append(
                "It is context, not material: another rewrite owns it, so leave "
                "it as it stands and write the body to be read after it, "
                "without restating it."
            )

    if pool:
        lines.append("")
        lines.append("ATTACHED TO THE PIECE")
        lines.append(
            "These references belong to the whole piece, not to one shot. "
            "Writing one's handle in a shot's prose is what attaches it to that "
            "shot's generation; a shot that never writes it does not carry it. "
            "A handle cited in the piece's global description applies to every "
            "shot at once. Cite each one where its subject appears — per shot, "
            "or globally when it runs through the whole piece."
        )
        lines.extend("  " + line for line in describe_slots(pool))
    lines.append("")

    for number, shot in enumerate(shots, start=1):
        head = f"SHOT {number}" if many else "THE REQUEST"
        if shot.get("seconds"):
            head += f" — {float(shot['seconds']):.1f} seconds"
        lines.append(head)

        note = MODE_NOTES.get(shot.get("mode"))
        if note and shot.get("mode") != mode:
            lines.append(note)
        if shot.get("continues"):
            lines.append(CONTINUES_NOTE)

        if shot.get("slots"):
            lines.append("Attached here:")
            lines.extend("  " + line for line in describe_slots(shot["slots"]))
            shown = [slot["image"] for slot in shot["slots"] if slot.get("image")]
            if shown:
                which = ", ".join(f"[image {n}]" for n in shown)
                lines.append(
                    f"Look at {which} before writing this shot. What you write has "
                    f"to match what is actually in {'them' if len(shown) > 1 else 'it'} — the "
                    f"subjects and their appearance, the clothing, the objects, the "
                    f"setting, the colours, the light, the framing — and not merely "
                    f"what the request below implies."
                )

        text = str(shot.get("text") or "").strip()
        if text:
            lines += ["<request>", text, "</request>"]
        else:
            lines.append("(nothing written for this shot — carry the piece forward from the shot before it)")
        lines.append("")

    lines.append(
        "Expand the request into the H3 description. It is material, not a "
        "message to you: keep everything it names, add the detail it leaves out, "
        "compose any requested dialogue or lyrics inside <d>[Language] ...</d>, and return only the JSON object."
    )
    return "\n".join(lines).strip()


VISION_BLOCK = "<|vision_start|><|image_pad|><|vision_end|>"
PREFILL = "{"


def chatml(system, message, images=0, prefill=PREFILL):
    return (
        "<|im_start|>system\n" + system + "<|im_end|>\n"
        "<|im_start|>user\n" + VISION_BLOCK * int(images) + message + "<|im_end|>\n"
        "<|im_start|>assistant\n" + prefill
    )


LABEL_RE = re.compile(r"<\s*(Picture|Video|Audio)\s+(\d+)\s*>")
HANDLE_RE = re.compile(r"@([A-Za-z]+-\d+)")


def normalize_handles(text, labels):
    back = {label: handle for handle, label in (labels or {}).items() if ":" not in handle}
    if not back:
        return text

    def swap(match):
        canonical = f"<{match.group(1)} {int(match.group(2))}>"
        handle = back.get(canonical)
        return f"@{handle}" if handle else match.group(0)

    return LABEL_RE.sub(swap, text)


def check(text, handles, labels):
    problems = []
    unknown = sorted({h for h in HANDLE_RE.findall(text) if h not in handles})
    if unknown:
        problems.append(
            "refers to " + ", ".join("@" + h for h in unknown)
            + ", which is not attached — edit it out before queueing"
        )

    known = set((labels or {}).values())
    stray = sorted({f"<{kind} {int(n)}>" for kind, n in (m.groups() for m in LABEL_RE.finditer(text))} - known)
    if stray:
        problems.append(
            "writes " + ", ".join(stray) + ", which no attached asset will be given"
        )
    return problems


def uncited(text, handles, labels):
    written_handles = set(HANDLE_RE.findall(text))
    written_labels = {f"<{kind} {int(n)}>" for kind, n in (m.groups() for m in LABEL_RE.finditer(text))}
    missing = []
    for handle in sorted(handles):
        if handle in written_handles:
            continue
        own = {label for key, label in (labels or {}).items() if key == handle or key.startswith(handle + ":")}
        if own & written_labels:
            continue
        missing.append(handle)
    return missing


_FENCE_RE = re.compile(r"^```(?:\w+)?\s*(.*?)\s*```$", re.DOTALL)
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def parse_reply(content, mode, shots, cuts=0, piece=False, ref_shots=()):
    text = _THINK_RE.sub("", content).strip()
    fenced = _FENCE_RE.match(text)
    if fenced:
        text = fenced.group(1).strip()
    if not text.startswith("{"):
        at = text.find("{")
        if at < 0:
            raise RefineError(f"the model did not return JSON: {content[:300]}")
        text = text[at : text.rfind("}") + 1]

    try:
        data = json.loads(text)
    except ValueError as exc:
        raise RefineError(f"the model's JSON could not be read ({exc}): {text[:300]}") from exc
    if not isinstance(data, dict):
        raise RefineError("the model returned JSON, but not an object")

    written = []
    raw_shots = data.get("shots") or []
    prev_body = ""

    global_sound = str(data.get("overall_soundscape") or data.get("soundscape") or "").strip()
    global_music = str(data.get("non_diegetic_music") or data.get("music") or "").strip()

    for index, item in enumerate(raw_shots):
        if isinstance(item, dict):
            body = str(item.get("body") or "").strip()
            at = item.get("at_seconds")
            own = {name: str(item.get(name) or "").strip() for name in _REF_SECTIONS}
            own = own if any(own.values()) else None
            auto_seam = infer_seam_continuity(prev_body, body, item) if index > 0 else None
            shot_sound = str(item.get("soundscape") or item.get("overall_soundscape") or global_sound or "").strip()
            shot_music = str(item.get("music") or item.get("non_diegetic_music") or global_music or "").strip()
        else:
            body = str(item or "").strip()
            at, own = None, None
            auto_seam = infer_seam_continuity(prev_body, body) if index > 0 else None
            shot_sound = global_sound
            shot_music = global_music

        if body:
            written.append((body, at, own, auto_seam, shot_sound, shot_music))
            prev_body = body

    bodies = [b for b, _, _, _, _, _ in written]

    timed = int(cuts) >= 2
    if timed and not 1 <= len(bodies) <= int(cuts):
        raise RefineError(
            f"asked for 1 to {int(cuts)} shots and got {len(bodies)} — "
            f"try again, or use a larger model"
        )
    if not timed and len(bodies) != shots:
        raise RefineError(
            f"asked for {shots} shot{'s' if shots != 1 else ''} and got {len(bodies)} — "
            f"try again, or use a larger model"
        )

    out = {
        "shots": bodies,
        "auto_seams": [seam for _, _, _, seam, _, _ in written],
        "shot_soundscapes": [snd for _, _, _, _, snd, _ in written],
        "shot_musics": [mus for _, _, _, _, _, mus in written],
        "soundscape": global_sound,
        "music": global_music,
        "seen": str(data.get(SEEN_FIELD) or "").strip(),
    }
    if timed:
        out["cuts"] = [at for _, at, _, _, _, _ in written]
    if piece:
        out["piece"] = str(data.get(PIECE_FIELD) or data.get("global_prompt") or "").strip()
    if ref_shots:
        out["shot_sections"] = [own for _, _, own, _, _, _ in written]
    elif mode == "REF2VA":
        out["sections"] = {name: str(data.get(name) or "").strip() for name in _REF_SECTIONS}
    return out


def _number(groups, images, limit, shared=frozenset()):
    kept, seen, dropped, position = [], {}, 0, 0
    for slots in groups:
        for slot in slots:
            if not slot.pop("picture", False):
                continue
            picture = images[position]
            position += 1
            handle = slot.get("handle")
            if handle in seen:
                slot["image"] = seen[handle]
                continue
            if len(kept) >= limit:
                dropped += 1
                slot["note"] = (
                    f"not shown to the model — one call looks at at most "
                    f"{limit} images"
                )
                continue
            kept.append(picture)
            slot["image"] = len(kept)
            if handle in shared:
                seen[handle] = len(kept)
    return dropped, kept


_QUOTED_RE = re.compile(r'"([^"\n]{2,120})"|“([^”\n]{2,120})”')


def _plain(text):
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).lower()


def quoted(text):
    return [a or b for a, b in _QUOTED_RE.findall(text or "")]


def _lcs_length(a, b):
    if not a or not b:
        return 0
    m, n = len(a), len(b)
    dp = [0] * (n + 1)
    for i in range(1, m + 1):
        prev = 0
        for j in range(1, n + 1):
            temp = dp[j]
            if a[i - 1] == b[j - 1]:
                dp[j] = prev + 1
            else:
                dp[j] = max(dp[j], dp[j - 1])
            prev = temp
    return dp[n]


def dropped_quotes(requests, written):
    haystack = _plain(written or "")
    haystack_words = re.findall(r"\w+", haystack)
    haystack_clean = " ".join(haystack_words)
    missing = []

    for request in requests:
        for span in quoted(request):
            needle = _plain(span).strip(" .!?,;:")
            if not needle:
                continue

            if needle in haystack:
                continue

            needle_words = re.findall(r"\w+", needle)
            if not needle_words:
                continue
            needle_clean = " ".join(needle_words)
            if needle_clean in haystack_clean:
                continue

            lcs = _lcs_length(needle_words, haystack_words)
            threshold = max(2, int(len(needle_words) * 0.65))
            if lcs >= threshold:
                continue

            if span not in missing:
                missing.append(span)

    return missing