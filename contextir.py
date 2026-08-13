"""The Context-IR skeleton H3-Base is actually prompted with.

H3 is a two-stage system. The hosted half — H3-Context-IR — rewrites whatever
the user typed into a labelled, sectioned intermediate representation, and the
open weights were trained only on its output. MiniMax do not open-source that
rewriter but they do publish what it emits (`skills/h3-prompt-writing`, mirrored
verbatim in the sibling `MiniMax-H3-LLM/research/sources/`), and the shape is
fixed:

    <mode instruction line>

    integrated_multimodal_description: [Shot 1] ...

    overall_soundscape: ...

    non_diegetic_music: ...

A bare sentence has none of that, so it lands off the distribution the DiT was
trained on. This module puts the skeleton back. It cannot invent the prose — a
real rewrite is phase 5's job and needs an LLM — but the field names, the
ordering and the mode instruction are mechanical, and emitting them costs
nothing and is what the model expects to read first.

**Everything here only adds what is missing.** A prompt that already carries its
own `integrated_multimodal_description:` — hand-written, or produced by a
refiner, or the six-section Ref2VA form — is passed through untouched. That is
the one rule worth holding onto: this is a floor, not a filter, so nothing a
user writes can be silently rewritten out from under them.
"""

import re

# The three base-mode fields, in the order the guide emits them.
BODY_FIELD = "integrated_multimodal_description"
SOUNDSCAPE_FIELD = "overall_soundscape"
MUSIC_FIELD = "non_diegetic_music"

# Ref2VA is a different, six-section form. Its body field is `detailed_description`
# and it carries four more sections we cannot synthesise from one line of prose —
# so a reference prompt is never wrapped, only checked for the two audio fields it
# shares with the base form.
REF_BODY_FIELD = "detailed_description"

BODY_FIELDS = (BODY_FIELD, REF_BODY_FIELD)

# The four sections the reference form has that the base form does not, in the
# order the guide emits them — the last of them being the body itself. Nothing
# synthesises these from a sentence; they arrive whole from the refiner or not
# at all, which is why `compose` only builds this form when it is handed them.
REF_SECTIONS = ("subject_definitions", "summary", "retention_analysis")

# The modes whose body belongs in `integrated_multimodal_description`.
BASE_MODES = ("T2VA", "I2VA", "L2VA", "FL2VA")

# `[Shot 1]`, `[Shot 12]` — the marker the description is segmented by.
SHOT_RE = re.compile(r"\[Shot\s+\d+\]")

# What a timeline says about a sound seam. The inherited tail is presented to the
# tokenizer as `<Audio 1>`, and a label the prompt never defines is a label
# pointing at nothing — so this is the base-mode equivalent of the reference
# form's `subject_definitions`, written in the same voice.
AUDIO_SEAM_LINE = (
    "<Audio 1> is the end of the preceding shot's soundtrack. The target video's "
    "sound continues from it without a break, keeping the same ambience, key and "
    "tempo across the cut."
)


def count_shots(body):
    """How many shots a description holds — what `instruction`'s `Shot N` is."""
    return len(SHOT_RE.findall(body or ""))


def has_field(text, name):
    """Whether `text` already carries a `name:` section, at the start of a line."""
    return re.search(rf"^[ \t]*{re.escape(name)}[ \t]*:", text or "", re.MULTILINE) is not None


def _has_instruction(text):
    """Whether `text` already opens with a keyframe-alignment instruction.

    Matched on the two documented openings rather than on a field name, because
    the instruction is a bare sentence with no `name:` marker to look for.
    """
    head = (text or "").lstrip()
    return head.startswith("For the target video,") or head.startswith("How the reference pictures align")


def shot_time(seconds):
    """`3.5` -> `"00:03.500"`, the cut-time format the guide writes.

    Section 4.2: every shot after the first opens with a strictly increasing cut
    time. This is the only place that format is spelled, so a change here moves
    every cut in a one-pass render.
    """
    total_ms = int(round(float(seconds) * 1000))
    minutes, rest = divmod(total_ms, 60_000)
    secs, ms = divmod(rest, 1000)
    return f"{minutes:02d}:{secs:02d}.{ms:03d}"


# `At 00:03.500,` at the head of a shot — already written by hand, so not added.
CUT_TIME_RE = re.compile(r"^\s*At\s+\d{1,3}:\d{2}\.\d{3}\s*,")


def shot_body(shots):
    """`[(at_seconds, text), ...]` -> one `[Shot n]`-marked description.

    The guide's section 4.2 in one function: shot 1 carries no timestamp, every
    later shot opens with its cut time, and the prose after the comma is the
    user's own — including which of `the camera cuts to` / `the shot transitions
    to` they wanted. Inventing a transition verb here would be writing a line of
    their description for them, and the guide lists five to choose between.

    A card that already carries its own markers is passed through verbatim and
    counts for as many shots as it numbers, so writing two shots into one card
    does not knock the rest of the timeline out of step. Its numbers are checked
    against the position it actually occupies and refused if they disagree —
    refusing is not rewriting, and the alternative is a description with two
    `[Shot 2]`s in it that nothing would have complained about.
    """
    out = []
    number = 1
    for position, (at, text) in enumerate(shots, start=1):
        text = (text or "").strip()
        if not text:
            raise ValueError(
                f"shot {position} has no prompt — the shots of one pass are a "
                f"single description with cuts in it, so an empty one would leave "
                f"a cut with nothing on the far side of it"
            )

        own = [re.sub(r"\s+", " ", m) for m in SHOT_RE.findall(text)]
        if own:
            want = [f"[Shot {n}]" for n in range(number, number + len(own))]
            if own != want:
                raise ValueError(
                    f"shot {position} numbers its own shots {' '.join(own)}, but in this "
                    f"timeline it is {' '.join(want)} — renumber it, or drop the markers "
                    f"and let the timeline number the shots"
                )
            out.append(text)
            number += len(own)
            continue

        head = f"[Shot {number}]"
        if number > 1 and not CUT_TIME_RE.match(text):
            head += f" At {shot_time(at)},"
        out.append(f"{head} {text}")
        number += 1
    return " ".join(out)


def instruction(mode, seconds, shots=1):
    """The first line of the prompt for a keyframe mode, or None.

    Quoted from the official guide rather than paraphrased — including FL2VA's
    unbracketed `Picture 1`, which differs from the other two lines and is not a
    typo on this end. `S.SS` is the effective duration to exactly two decimals,
    so it must be the real frame-count-derived duration and never the pill's
    whole number.

    `shots` is how many shots the description holds. The end frame is reached by
    the *last* one — the guide writes `(from Shot N)` — which only differs from
    `Shot 1` in a one-pass render of several shots. The start frame is always
    Shot 1's, whatever follows it.

    T2VA has no instruction (there is no picture to align), and REF2VA states its
    alignment inside `retention_analysis` instead.
    """
    end = f"{float(seconds):.2f}"
    last = max(1, int(shots))
    if mode == "I2VA":
        return ("For the target video, at 0.00 seconds into the target video, "
                "<Picture 1> (from [Shot 1]) is fully referenced.")
    if mode == "FL2VA":
        return ("How the reference pictures align with the target video — Picture 1 "
                "(from Shot 1) aligns with the 0.00-second mark of the target video; "
                f"Picture 2 (from Shot {last}) aligns with the {end}-second mark of the target video.")
    if mode == "L2VA":
        return ("How the reference pictures align with the target video — <Picture 1> "
                f"(from [Shot {last}]) aligns with the {end}-second mark of the target video.")
    return None


def compose(mode, body, soundscape="", music="", seconds=0.0, preamble="", shots=1,
            sections=None):
    """The user's prose -> the sectioned prompt the DiT was trained to read.

    `body` is what the user wrote, with `@handles` already substituted and any
    LoRA trigger words already in front of it — triggers belong inside the
    description, not above the instruction line, because the instruction has to
    be the prompt's first line.

    A blank `soundscape` or `music` emits nothing at all. `N/A` is the guide's
    value for "there is deliberately none of this", which is a real thing to say
    and a very different one from leaving the box empty, so it stays something
    the user types rather than something inferred from an empty string.

    `sections` is `REF_SECTIONS -> prose`, and only the refiner ever supplies it.
    Handed them, this builds the reference form's full six sections; handed
    nothing, a REF2VA body passes through exactly as it always has. The
    distinction matters: those three sections cannot be derived from a sentence,
    so wrapping a hand-written reference prompt in `detailed_description:` would
    claim a form the rest of which is missing.
    """
    body = (body or "").strip()
    soundscape = (soundscape or "").strip()
    music = (music or "").strip()

    out = []

    line = instruction(mode, seconds, shots)
    if line and not _has_instruction(body):
        out.append(line)

    # After the instruction, which has to be the first line, and before the
    # description — the same slot the reference form gives `subject_definitions`.
    preamble = (preamble or "").strip()
    if preamble:
        out.append(preamble)

    # The three sections that stand in front of the description in the reference
    # form. Each is skipped where the body already carries one, so a refined
    # prompt the user has since hand-edited into full form is not given a second
    # copy of a section it already has.
    reference_form = mode == "REF2VA" and bool(sections)
    if reference_form:
        for name in REF_SECTIONS:
            value = str(sections.get(name) or "").strip()
            if value and not has_field(body, name):
                out.append(f"{name}: {value}")

    if body:
        # Only wrapped when the body is plain prose. Anything already sectioned —
        # either form — is its own rewrite already.
        field = (BODY_FIELD if mode in BASE_MODES else
                 REF_BODY_FIELD if reference_form else None)
        if field and not any(has_field(body, f) for f in BODY_FIELDS):
            # The description is written shot by shot and every example opens on
            # a marker. A segment is one shot, so `[Shot 1]` is the whole of it —
            # unless the body already numbers its own, which is someone writing
            # several shots into one generation and knowing that they are.
            if not SHOT_RE.search(body):
                body = f"[Shot 1] {body}"
            body = f"{field}: {body}"
        out.append(body)

    if soundscape and not has_field(body, SOUNDSCAPE_FIELD):
        out.append(f"{SOUNDSCAPE_FIELD}: {soundscape}")
    if music and not has_field(body, MUSIC_FIELD):
        out.append(f"{MUSIC_FIELD}: {music}")

    return "\n\n".join(out)
