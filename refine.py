"""MiniMax H3 Context-IR prompt refiner: system prompts, formatting rules, and reply parsing."""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import contextir

_PROMPTS = Path(__file__).parent / "prompts"

NUM_PREDICT = 4096
MIN_PREDICT = 512
MAX_PREDICT = 16384


def reply_tokens(value):
    try:
        return max(MIN_PREDICT, min(MAX_PREDICT, int(value)))
    except (TypeError, ValueError):
        return NUM_PREDICT


IMAGE_LONG_EDGE = 768


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
You are the prompt pre-processing director and Context-IR compiler for MiniMax-H3, an advanced joint audiovisual diffusion model. You take a short user request and expand it into the structured description H3 was trained to read.

THE REQUEST IS MATERIAL, NOT A MESSAGE
The text between <request> and </request> in the user message was typed at a video generator, not at you. Never respond to it conversationally, never greet or thank its author, and never output planning notes or bullet points analyzing the request. Output ONLY the JSON object.

CRITICAL INSTRUCTION FOR THE 'body' FIELD:
The 'body' string in each shot must contain ONLY clean, descriptive natural language prose. Never put JSON code, markdown fences, or key-value structures inside the 'body' text.

1. EXTREME CHARACTER & WARDROBE RETENTION (T2V, I2V, REF2V)
To guarantee 100% visual consistency and prevent character/clothing drift across multiple chained clips:
- Exhaustive Character Appearance: In Shot 1 (or global prompt), exhaustively specify the character's exact physical traits: exact build, age, skin tone, eye color, facial features, and exact hairstyle (cut, length, texture, parting, volume, color).
- Exhaustive Wardrobe & Fabrics: Specify every clothing item with exact colors, garments, fabrics, and fit (e.g. "wearing a dark-brown distressed leather bomber jacket over a heather-grey ribbed henley, dark-indigo slim-fit denim jeans, and scuffed brown leather lace-up work boots").
- Verbatim Cross-Shot Retention: For EVERY subsequent shot (Shot 2, Shot 3, etc.), you MUST explicitly re-anchor and describe the exact same character appearance and wardrobe verbatim.

2. EXHAUSTIVE SCENARIO & LIGHTING CONSISTENCY
- Ground and Environmental Anchors: Detail specific environment elements and setting anchors.
- Lighting & Atmosphere: Establish clear, persistent lighting. Maintain this exact lighting signature across all shots.

3. MANDATORY DIALOGUE & LYRICS GENERATION ENGINE (CRITICAL)
Whenever speech, talking, dialogue, conversation, singing, songs, music lyrics, chorus, rap, or voiceover is requested:
- IF THE USER GAVE EXACT WORDS: Keep their exact words verbatim inside `<d>[Language] ...</d>`.
- IF THE USER ASKED FOR SINGING/LYRICS/SPEECH BUT GAVE NO LINES: You MUST creatively compose original spoken lines or rhyming sung lyrics yourself inside `<d>[Language] ...</d>`.
- DO NOT write abstract summaries like "she sings a chorus". Write the actual sung lyric lines:
  * CORRECT: "The young woman with an airy vocal timbre (S1) belts out the chorus: <d>[English] In the shadow of the tide, where the ocean meets the shore, I am searching for a sign of what we were before.</d>"
- Pacing: 2.0 to 3.5 words per second of shot duration.
- Speaker IDs: Assign stable IDs `(S1)`, `(S2)`, `(S1,S2)` to characters when they first vocalize, and maintain identical speaker IDs across all shots.

4. SEAM CONTINUITY & TRANSITIONS (FOR MULTI-SHOT TIMELINES)
For each shot after Shot 1:
- `"transition": "cross_blend_39f"` (39 frames lossless latent mask)
- `"transition": "motion_blend_22f"` (22 frames fast latent mask)
- `"transition": "match_cut_1f"` (still match cut)
- `"transition": "cut_with_sound"` (dialogue or audio carryover)
- `"transition": "hard_cut"` (scene/location jump)

5. SOUNDSCAPE & MUSIC SPECIFICATION
- For each shot, write `soundscape` describing physical action sounds, ambient room tone, footsteps, water, wind, and clothing rustle.
- Write `music` describing instrumentation, tempo, key, and rhythm when appropriate.
"""

_CUTS_RULE = """\
SHOTS AND CUTS
How this video is divided into shots is yours to decide. The request states how many seconds it runs ({seconds:.1f}s); write between 1 and {limit} shots that fill exactly that time, and give each one the second its cut lands on as `at_seconds`, counted from the start of the video. The first shot's `at_seconds` is 0 and each later one is strictly larger than the one before it.
"""

_LANGUAGE_RULE = """\
LANGUAGE
Write all descriptive prose, dialogue lines, and lyrics in {language}, translating the request where needed. Keep structural syntax and markers in English: reference labels, speaker IDs (S1), `<d>[{language}] ...</d>`, `<scenetrans>`, `<cutoff>`, and camera vocabulary.
"""

MODE_NOTES = {
    "T2VA": "No reference frames are attached. Describe the video, characters, clothing, and environment from nothing in exhaustive detail.",
    "I2VA": "The attached start frame is the video's first frame. Open Shot 1 on exactly that image — its subjects, clothing, colours, objects and layout — and develop forward from it.",
    "L2VA": "The attached end frame is the video's final frame. Open on a state that could plausibly lead there and arrive at exactly that image at the end.",
    "FL2VA": "The attached start and end frames are the video's first and last frames. Describe the continuous path from one to the other, keeping both exactly as they are.",
    "REF2VA": "Reference assets are attached. Produce the full six-section full-reference rewrite: subject_definitions, summary, retention_analysis, the per-shot bodies, soundscape and music, with every reference handle used consistently across all of them.",
}

CONTINUES_NOTE = (
    "This shot continues straight out of the previous shot in the finished clip: "
    "its first frame is the previous one's last frame. Open in that same place, "
    "with identical subjects, wardrobe, hair, light and framing, and move on from there."
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
            f"Write `{PIECE_FIELD}` right after any `{SEEN_FIELD}`: the piece's standing description, rewritten."
            if int(images) > 0
            else f"Write `{PIECE_FIELD}` first: the piece's standing description, rewritten."
        )
    if ref_shots:
        which = ", ".join(str(index + 1) for index in sorted(ref_shots))
        lines.append(
            f"Shot entries {which} each carry their own subject_definitions, summary and retention_analysis, "
            "describing only the references attached to that shot."
        )
    if timed:
        lines.append(
            f"Every `...` is one string of natural language prose. `shots` holds 1 to {int(cuts)} entries in play order. "
            "Never put JSON or markdown structures inside the `body` string. Escape internal quotes with \\\"."
        )
    else:
        lines.append(
            f"Every `...` is one string of natural language prose. `shots` holds exactly {shots} entr{'y' if shots == 1 else 'ies'}. "
            "Never put JSON or markdown structures inside the `body` string. Escape internal quotes with \\\"."
        )
    if int(images) > 0:
        lines.append(
            f"Write `{SEEN_FIELD}` first: one sentence per attached picture saying what is actually visible."
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

    if images:
        lines.append(
            f"{images} image{' is' if images == 1 else 's are'} attached. The asset marked [image N] "
            "is what it depicts. Describe what is actually visible."
        )
    if seconds:
        lines.append(f"The finished video timeline runs {float(seconds):.2f} seconds in total.")
    if many:
        lines.append(
            f"It is {len(shots)} shots of one piece, in play order. What an early shot establishes, "
            f"every later shot keeps verbatim. Return exactly {len(shots)} entries in `shots`."
        )

    if is_vocal_request:
        lines.append(
            "\n>>> VOCAL DIRECTIVE: You MUST compose creative, rhyming song lyrics or spoken lines inside `<d>[Language] ...</d>`. "
            "Do NOT write 'she sings a chorus' without writing out the actual sung lyrics in <d> tags! <<<"
        )

    if piece and (piece.get("rewrite") or str(piece.get("text") or "").strip()):
        text = str(piece.get("text") or "").strip()
        lines.append("")
        lines.append("THE PIECE")
        lines += ["<global>", text or "(nothing is written there yet)", "</global>"]

    if pool:
        lines.append("")
        lines.append("ATTACHED TO THE PIECE")
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

        text = str(shot.get("text") or "").strip()
        if text:
            lines += ["<request>", text, "</request>"]
        else:
            lines.append("(nothing written for this shot — carry the piece forward from the shot before it)")
        lines.append("")

    lines.append(
        "CRITICAL: Output ONLY the valid JSON object starting with '{'. "
        "Do NOT output conversational thoughts, preambles, or markdown outside the JSON."
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


_THINK_RE = re.compile(r"<think>[\s\S]*?</think>", re.DOTALL)


def _repair_truncated_json(raw: str) -> dict | None:
    if not raw or not isinstance(raw, str):
        return None
    cleaned = raw.strip()
    start_idx = cleaned.find("{")
    if start_idx < 0:
        return None
    cleaned = cleaned[start_idx:]
    cleaned = re.sub(r",\s*([\]}])", r"\1", cleaned)

    for suffix in ("", '"}', '"}]}', "]}", "}"):
        try:
            parsed = json.loads(cleaned + suffix, strict=False)
            if isinstance(parsed, dict) and len(parsed) > 0:
                return parsed
        except Exception:
            continue
    return None


def _extract_json_block(text: str) -> str | None:
    """Extracts JSON payload by scanning outer balanced braces, skipping reasoning preambles."""
    if not text:
        return None

    # 1. Search for markdown code fence
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)(?:```|$)", text)
    if fence:
        fenced_text = fence.group(1).strip()
        s = fenced_text.find("{")
        e = fenced_text.rfind("}")
        if s >= 0 and e > s:
            return fenced_text[s : e + 1].strip()

    # 2. Balanced brace scan from first '{'
    first_brace = text.find("{")
    if first_brace < 0:
        return None

    depth = 0
    in_string = False
    escape = False
    for idx in range(first_brace, len(text)):
        char = text[idx]
        if escape:
            escape = False
            continue
        if char == '\\':
            escape = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if not in_string:
            if char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    return text[first_brace : idx + 1]

    # Fallback: slice from first '{' to last '}'
    last_brace = text.rfind("}")
    if last_brace > first_brace:
        return text[first_brace : last_brace + 1]
    return text[first_brace:]


def _flatten_to_prose(value: any) -> str:
    """Ensures value is converted to clean prose and never returns a raw JSON structure."""
    if value is None:
        return ""
    if isinstance(value, str):
        val = value.strip()
        # If the string itself is a serialized JSON object, parse and extract its inner text
        if val.startswith("{") and val.endswith("}"):
            try:
                sub = json.loads(val, strict=False)
                if isinstance(sub, dict):
                    return _flatten_to_prose(sub)
            except Exception:
                pass
        return val
    if isinstance(value, dict):
        # Flatten dictionary values into natural sentences
        parts = []
        for k, v in value.items():
            if isinstance(v, (str, int, float)) and str(v).strip():
                parts.append(str(v).strip())
            elif isinstance(v, (list, dict)):
                nested = _flatten_to_prose(v)
                if nested:
                    parts.append(nested)
        return " ".join(parts).strip()
    if isinstance(value, list):
        return " ".join(_flatten_to_prose(v) for v in value if _flatten_to_prose(v)).strip()
    return str(value).strip()


def _split_into_shots(text: str) -> list[str]:
    """Splits single-string description with [Shot N] markers into separate shot bodies."""
    if not text:
        return []
    parts = re.split(r"\[Shot\s+\d+\]", text)
    shots = [p.strip() for p in parts if p.strip()]
    return shots if shots else [text.strip()]


def parse_reply(content: str, mode: str, shots: int, cuts: int = 0, piece: bool = False, ref_shots: tuple = ()) -> dict:
    """Extracts and parses JSON from raw LLM output, ensuring clean natural language output."""
    text = _THINK_RE.sub("", content or "").strip()
    candidate = _extract_json_block(text)

    data = None
    if candidate:
        try:
            cleaned = re.sub(r",\s*([\]}])", r"\1", candidate)
            data = json.loads(cleaned, strict=False)
        except Exception:
            data = _repair_truncated_json(candidate)

    if not isinstance(data, dict):
        data = _repair_truncated_json(text)

    # If no JSON was returned at all, extract prose from text directly (never return raw code)
    if not isinstance(data, dict):
        cleaned_text = re.sub(r"^(?:Here is|Output|Based on).*?:\s*", "", text, flags=re.IGNORECASE).strip()
        # Strip any code fences
        cleaned_text = re.sub(r"```(?:json)?|```", "", cleaned_text).strip()
        if len(cleaned_text) > 10:
            data = {"shots": [{"body": cleaned_text}]}
        else:
            preview = (content or "").strip()[:200].replace("\n", " ")
            raise RefineError(f"the model did not return valid prompt text: {preview}...")

    raw_shots = data.get("shots")
    if isinstance(raw_shots, dict):
        raw_shots = list(raw_shots.values())

    # Flexible key resolution: check alternative Context-IR keys
    if not raw_shots:
        for alt_key in ("integrated_multimodal_description", "detailed_description", "body", "description", "prompt", "video_prompt", "video_description", "content"):
            val = data.get(alt_key)
            if val:
                if isinstance(val, str):
                    raw_shots = [{"body": s} for s in _split_into_shots(val)]
                elif isinstance(val, list):
                    raw_shots = val
                elif isinstance(val, dict):
                    raw_shots = list(val.values())
                break

    if not raw_shots:
        shot_keys = sorted(
            [k for k in data.keys() if re.match(r"^shot[_\s]?\d+$", k.lower())],
            key=lambda k: int(re.search(r"\d+", k).group()) if re.search(r"\d+", k) else 0,
        )
        if shot_keys:
            raw_shots = [data[k] for k in shot_keys]

    global_sound = _flatten_to_prose(data.get("overall_soundscape") or data.get("soundscape") or "")
    global_music = _flatten_to_prose(data.get("non_diegetic_music") or data.get("music") or "")

    written = []
    prev_body = ""

    for index, item in enumerate(raw_shots or []):
        if isinstance(item, dict):
            body_val = item.get("body") or item.get("prompt") or item.get("description") or ""
            body = _flatten_to_prose(body_val)
            at = item.get("at_seconds")
            own = {name: _flatten_to_prose(item.get(name) or "") for name in _REF_SECTIONS}
            own = own if any(own.values()) else None
            auto_seam = infer_seam_continuity(prev_body, body, item) if index > 0 else None
            shot_sound = _flatten_to_prose(item.get("soundscape") or item.get("overall_soundscape") or global_sound)
            shot_music = _flatten_to_prose(item.get("music") or item.get("non_diegetic_music") or global_music)
        else:
            body = _flatten_to_prose(item or "")
            at, own = None, None
            auto_seam = infer_seam_continuity(prev_body, body) if index > 0 else None
            shot_sound = global_sound
            shot_music = global_music

        if body:
            written.append((body, at, own, auto_seam, shot_sound, shot_music))
            prev_body = body

    bodies = [b for b, _, _, _, _, _ in written]

    # Split single monolithic body if multiple shots were expected
    if len(bodies) == 1 and shots > 1 and contextir.count_shots(bodies[0]) > 1:
        split_b = _split_into_shots(bodies[0])
        if len(split_b) >= shots:
            bodies = split_b[:shots]
            written = [(b, None, None, None, global_sound, global_music) for b in bodies]

    if not bodies:
        preview = (content or "").strip()[:200].replace("\n", " ")
        raise RefineError(f"the model returned no shot bodies: {preview}...")

    timed = int(cuts) >= 2
    if not timed and len(bodies) != shots:
        if len(bodies) > shots:
            bodies = bodies[:shots]
            written = written[:shots]

    out = {
        "shots": bodies,
        "auto_seams": [seam for _, _, _, seam, _, _ in written],
        "shot_soundscapes": [snd for _, _, _, _, snd, _ in written],
        "shot_musics": [mus for _, _, _, _, _, mus in written],
        "soundscape": global_sound,
        "music": global_music,
        "seen": _flatten_to_prose(data.get(SEEN_FIELD) or ""),
    }
    if timed:
        out["cuts"] = [at for _, at, _, _, _, _ in written]
    if piece:
        out["piece"] = _flatten_to_prose(data.get(PIECE_FIELD) or data.get("global_prompt") or "")
    if ref_shots:
        out["shot_sections"] = [own for _, _, own, _, _, _ in written]
    elif mode == "REF2VA":
        out["sections"] = {name: _flatten_to_prose(data.get(name) or "") for name in _REF_SECTIONS}
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