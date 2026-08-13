import { api } from "../../../scripts/api.js";
import { viewUrl } from "./api.js";
import { el, icon, mountOverlay } from "./dom.js";
import { CreatorEditor } from "./editor.js";
import { t } from "./i18n.js";
import { openLoras } from "./loras.js";
import { openPicker } from "./picker.js";
import { openAspectPopover, openResolutionPopover, openChoicePopover, stepperPill, aspectGlyph, PILL_GLYPH } from "./pills.js";
import { PromptBox } from "./prompt.js";
import { refine, refineButton, chosenModel as refineModel } from "./refine.js";
import { samplingBar } from "./sampling.js";
import { Stage } from "./stage.js";
import { weightsPill, loadCatalog, catalogFiles } from "./models.js";
import * as S from "./state.js";
import * as Turbo from "./turbo.js";
import { setupDragAndDrop } from "./media_drop.js";
import {
  FPS, framesForSeconds, secondsForFrames, resolveCanvas, ASPECT_PRESETS, describeRatio, isTrainedLength,
} from "./canvas.js";

const blendSeconds = (frames) => (frames / FPS).toFixed(1);

export function openTimeline(options) {
  return new Promise((resolve) => new Timeline(options, resolve).mount());
}

const cardWidth = (seconds) => 132 + Math.round(Math.sqrt(seconds) * 26);

const TRANSITION_PRESETS = [
  {
    name: "Match Cut (Motion Blend 1.0s)",
    hint: "Inherit last frame, blend 1.0s of motion, carry audio over.",
    apply: (segment) => {
      segment.continue = true;
      segment.feather = 22;
      segment.continue_audio = true;
    },
  },
  {
    name: "Long Cross-Blend (1.6s)",
    hint: "Inherit last frame, long 1.6s motion blend, carry audio over.",
    apply: (segment) => {
      segment.continue = true;
      segment.feather = 39;
      segment.continue_audio = true;
    },
  },
  {
    name: "Hard Cut + Sound Carryover",
    hint: "Hard visual cut, but carry soundtrack across the seam.",
    apply: (segment) => {
      segment.continue = false;
      segment.continue_audio = true;
      delete segment.feather;
    },
  },
  {
    name: "Hard Reset (Scene Cut)",
    hint: "Hard cut for both picture and sound.",
    apply: (segment) => {
      segment.continue = false;
      segment.continue_audio = false;
      delete segment.feather;
    },
  },
];

class Timeline {
  constructor({ timeline, onCommit }, resolve) {
    this.timeline = timeline;
    this.onCommit = onCommit;
    this.resolve = resolve;
  }

  commit() {
    S.syncTimeline(this.timeline);
    this.onCommit?.();
    this.render();
  }

  textBox(key, { className = "mmc-tl-prompt", placeholder, rows }) {
    const box = el("textarea", {
      class: className,
      placeholder,
      ...(rows ? { rows: String(rows) } : {}),
      oninput: (event) => {
        this.timeline[key] = event.target.value;
        this.onCommit?.();
        this.renderBar();
        this.renderPool();
      },
    });
    box.value = this.timeline[key] ?? "";
    for (const name of ["pointerdown", "keydown", "keyup", "paste", "copy", "cut"]) {
      box.addEventListener(name, (event) => event.stopPropagation());
    }
    return box;
  }

  attachPoolFromMention(row) {
    const entry = {
      handle: S.nextPoolHandle(this.timeline),
      kind: row.kind,
      role: "reference",
      filename: row.path,
      ref_size: "max",
    };
    if (row.kind === "video") entry.track = row.track ?? S.DEFAULT_TRACK;
    if (row.trim) entry.trim = row.trim;
    this.timeline.assets = this.timeline.assets ?? [];
    this.timeline.assets.push(entry);
    this.commit();
    return entry.handle;
  }

  mount() {
    this.prompt = new PromptBox({
      getState: () => ({
        prompt: this.timeline.prompt ?? "",
        assets: this.timeline.assets ?? [],
      }),
      onInput: (text) => {
        this.timeline.prompt = text;
        this.onCommit?.();
        this.renderBar();
        this.renderPool();
      },
      onAttach: (row) => this.attachPoolFromMention(row),
      attachBlocked: () => null,
      getPool: () => this.timeline.assets ?? [],
    });
    this.prompt.setValue(this.timeline.prompt ?? "");

    this.soundscapeBox = this.textBox("soundscape", {
      className: "mmc-tl-prompt mmc-tl-small", rows: 3,
      placeholder: t("Ambience, action sounds, breathing — everything heard in the room. "
                   + "Empty leaves it to the model; write N/A for silence."),
    });
    this.musicBox = this.textBox("music", {
      className: "mmc-tl-prompt mmc-tl-small", rows: 3,
      placeholder: t("The score only the audience hears: instruments, tempo, how it moves. "
                   + "Empty leaves it to the model; write N/A for none."),
    });

    this.audioHost = el("div", { class: "mmc-tl-audio" }, [
      el("label", { class: "mmc-tl-field" }, [
        el("span", { class: "mmc-tl-field-name", text: t("overall_soundscape") }),
        this.soundscapeBox,
      ]),
      el("label", { class: "mmc-tl-field" }, [
        el("span", { class: "mmc-tl-field-name", text: t("non_diegetic_music") }),
        this.musicBox,
      ]),
    ]);

    this.poolHost = el("div", { class: "mmc-tl-pool" });
    this.barHost = el("div", { class: "mmc-tl-bar" });
    this.stripHost = el("div", { class: "mmc-tl-strip" });

    this.promptScroll = el("div", { class: "mmc-prompt-scroll" }, [
      this.prompt.chipsBar,
      this.prompt.root,
      this.audioHost,
      this.poolHost,
    ]);

    this.modal = el("div", { class: "mmc-modal mmc-tl-modal" }, [
      el("div", { class: "mmc-modal-head" }, [
        el("span", { class: "mmc-tab", "aria-selected": "true", text: t("Timeline") }),
        el("button", { class: "mmc-close", text: "✕", title: t("Close"), onclick: () => this.close() }),
      ]),
      el("div", { class: "mmc-tl-body" }, [
        this.promptScroll,
        this.barHost,
        this.stripHost,
      ]),
    ]);

    this.overlay = el("div", {
      class: "mmc-overlay",
      onpointerdown: (event) => { if (event.target === this.overlay) this.close(); },
    }, [this.modal]);

    this.unmount = mountOverlay(this.overlay, () => this.close());
    this.render();
  }

  close() {
    this.unmount();
    this.resolve();
  }

  render() {
    this.prompt.setValue(this.timeline.prompt ?? "");
    this.renderPool();
    this.renderBar();
    this.renderStrip();
  }

  renderPool() {
    const assets = this.timeline.assets ?? [];
    this.poolHost.replaceChildren(
      el("div", { class: "mmc-tl-pool-head" }, [
        el("span", { class: "mmc-tl-field-name", text: t("Piece references") }),
        el("span", {
          class: "mmc-tl-pool-hint",
          text: t("Attached once. Cite the @handle in the global prompt to use it in every "
                + "segment, or in a segment's own prompt to use it just there."),
        }),
        el("button", {
          class: "mmc-ghost mmc-tl-pool-add",
          title: t("Attach a reference to the whole piece — a character sheet, a location, "
               + "a voice. Cite it with its @handle in every segment where it appears."),
          onclick: () => this.addPoolAssets(),
        }, [el("span", { text: "+" }), el("span", { text: t("Add") })]),
      ]),
      ...(assets.length ? [el("div", { class: "mmc-assets" }, assets.map((a) => this.poolChip(a)))] : []),
    );
  }

  poolChip(asset) {
    const everywhere = S.poolCitedGlobally(this.timeline, asset);
    const cited = S.poolCitations(this.timeline, asset);
    const where = everywhere
      ? t("everywhere — cited in the global prompt")
      : cited.length
        ? t(cited.length === 1 ? "in segment {list}" : "in segments {list}", { list: cited.join(", ") })
        : t("cited nowhere yet");
    const thumb = asset.kind === "image"
      ? el("img", { class: "mmc-asset-thumb", src: viewUrl(asset.filename, { preview: true }), alt: "" })
      : el("span", { class: "mmc-asset-thumb", text: asset.kind === "video" ? "▶" : "♪" });
    return el("div", {
      class: `mmc-asset${everywhere || cited.length ? "" : " idle"}`,
      title: everywhere || cited.length
        ? t("{file} — {where}", { file: asset.filename, where })
        : t("{file} — no segment cites @{handle} yet, so it rides into none of them.",
            { file: asset.filename, handle: asset.handle }),
    }, [
      thumb,
      el("button", {
        class: `mmc-asset-handle mmc-tl-pool-cite mmc-tag-${S.tagIndex(asset.handle)}`,
        text: `@${asset.handle}`,
        title: t("Write @{handle} into the global prompt, so it applies to every segment.",
                 { handle: asset.handle }),
        onclick: () => this.citeInGlobal(asset),
      }),
      el("span", { class: "mmc-tl-pool-where", text: where }),
      ...(asset.kind === "image" ? [el("button", {
        class: "mmc-ghost",
        style: { fontSize: "11px" },
        title: t("What of this picture is the reference — narrowing it keeps the picture's "
             + "background and palette out of the video."),
        text: t(S.takes(asset)),
        onclick: (event) => this.pickPoolTakes(event.currentTarget, asset),
      })] : []),
      el("button", {
        class: "mmc-asset-x", text: "✕",
        title: cited.length
          ? t("Remove @{handle} — segments {list} still cite it and will refuse to queue "
            + "until the mentions are edited out.", { handle: asset.handle, list: cited.join(", ") })
          : t("Remove @{handle}", { handle: asset.handle }),
        onclick: () => {
          this.timeline.assets = (this.timeline.assets ?? []).filter((a) => a !== asset);
          this.commit();
        },
      }),
    ]);
  }

  citeInGlobal(asset) {
    if (S.poolCitedGlobally(this.timeline, asset)) return;
    const current = this.timeline.prompt ?? "";
    const joiner = current && !/\s$/.test(current) ? " " : "";
    this.timeline.prompt = `${current}${joiner}@${asset.handle} `;
    this.prompt.setValue(this.timeline.prompt);
    this.commit();
  }

  pickPoolTakes(anchor, asset) {
    const label = (key) => t(key);
    openChoicePopover(anchor, {
      title: t("@{handle} is a reference to", { handle: asset.handle }),
      options: S.TAKES.map(label),
      value: label(S.takes(asset)),
      onPick: (choice) => {
        const key = S.TAKES.find((k) => label(k) === choice) ?? "full";
        if (key === "full") delete asset.takes;
        else asset.takes = key;
        this.commit();
      },
    });
  }

  async addPoolAssets() {
    const chosen = await openPicker({
      kinds: ["image", "video", "audio", "renders"],
      kind: "image",
      capacity: () => ({ used: 0, max: S.MAX_REF_FILES, filesLeft: S.MAX_REF_FILES }),
    });
    if (!chosen) return;
    for (const picked of chosen) {
      const entry = {
        handle: S.nextPoolHandle(this.timeline),
        kind: picked.kind,
        role: "reference",
        filename: picked.path,
        ref_size: "max",
      };
      if (picked.kind === "video") entry.track = picked.track ?? S.DEFAULT_TRACK;
      if (picked.trim) entry.trim = picked.trim;
      this.timeline.assets.push(entry);
    }
    this.commit();
  }

  geometry() {
    const ratio = ASPECT_PRESETS.find(([label]) => label === this.timeline.aspect)?.[1] ?? 16 / 9;
    const [width, height] = resolveCanvas(ratio, this.timeline.short_edge);
    return { width, height, ratio };
  }

  renderMode() {
    const single = S.isSingle(this.timeline);
    const passes = S.passes(this.timeline);
    const mixed = !single && passes.length < this.timeline.segments.length;
    const option = (merge, label, title) => el("button", {
      class: `mmc-tl-render-opt${!mixed && merge === single ? " on" : ""}`,
      text: t(label),
      title,
      onclick: () => { if (mixed || merge !== single) this.mergeAll(merge); },
    });
    return el("div", { class: "mmc-tl-render" }, [
      option(false, "Chained",
        t("One generation per segment, joined end to end. No limit on the finished length, "
        + "and a segment can start from the previous one's last frame — but every join is a real seam.")),
      ...(mixed ? [el("span", {
        class: "mmc-tl-render-opt mmc-tl-render-mixed",
        text: t("Mixed"),
        title: t("Some of this strip's segments are merged into passes and some are "
             + "generated alone — {passes} generations for {count} segments. Merge or "
             + "split a seam to change it, or use the two ends of this control to make "
             + "the whole strip one or the other.",
             { passes: passes.length, count: this.timeline.segments.length }),
      })] : []),
      option(true, "One pass",
        t("One generation. The segments become the shots of a single description, cut times and all, "
        + "so nothing is decoded and re-encoded mid-clip and there is no seam to cross. "
        + "Everything a single pass can only have one of — mode, checkpoint, LoRAs, seed — "
        + "becomes the timeline's.")),
    ]);
  }

  renderBar() {
    const single = S.isSingle(this.timeline);
    const { width, height, ratio } = this.geometry();
    const seconds = S.timelineSeconds(this.timeline);
    const frames = S.timelineFrames(this.timeline);
    const count = this.timeline.segments.length;
    // What the queue costs and what a seam sits between: the generations, not
    // the cards. They are the same number until a pass holds more than one.
    const passes = S.passes(this.timeline);
    const active = S.activeGlobalLoras(this.timeline).length;
    const idle = (this.timeline.loras?.length ?? 0) - active;
    const refined = this.timeline.segments.some((segment) => segment.refined?.body);

    this.barHost.replaceChildren(
      this.renderMode(),
      el("button", {
        class: "mmc-pill",
        title: t("Aspect ratio, shared by every segment — they are joined end to end and have to match."),
        onclick: (event) => openAspectPopover(event.currentTarget, this.timeline, () => this.commit()),
      }, [aspectGlyph(ratio, PILL_GLYPH),
          el("span", { text: this.timeline.aspect }),
          el("span", { class: "mmc-pill-sub", text: describeRatio(ratio) })]),
      el("button", {
        class: "mmc-pill",
        title: S.twoPass(this.timeline)
          ? t("Sampled at a {edge} px short edge, refined up to "
            + "{width} × {height} by a second pass — every segment alike.",
              { edge: S.sampleEdge(this.timeline), width, height })
          : t("Short edge. Lower is faster; 768 is what the open weights were trained at."),
        onclick: (event) => openResolutionPopover(
          event.currentTarget, this.timeline, () => this.geometry(), () => this.commit()),
      }, [
        icon("res", 16),
        el("span", { text: `${this.timeline.short_edge}p` }),
        el("span", { class: "mmc-pill-sub", text: S.twoPass(this.timeline)
          ? `${S.sampleEdge(this.timeline)} → ${width} × ${height}`
          : `${width} × ${height}` }),
      ]),
      el("button", {
        class: `mmc-pill${active ? " on" : ""}`,
        title: t("LoRAs patched onto every segment, in front of whatever that segment adds. "
             + "Where a turbo LoRA belongs."),
        onclick: () => this.openLoras(),
      }, [
        icon("effect", 16),
        el("span", { text: active
          ? t(active === 1 ? "{count} LoRA" : "{count} LoRAs", { count: active })
          : t("LoRAs") }),
        ...(idle ? [el("span", { class: "mmc-pill-sub", text: t("{idle} idle", { idle }) })] : []),
      ]),
      ...(!single && this.timeline.segments.some(S.continuesAudio) ? [stepperPill({
        value: Number(this.timeline.audio_tail_s), min: 0.1, max: S.MAX_AUDIO_TAIL_S,
        step: 0.1, width: "52px", iconName: "audio",
        title: t("How much of the previous segment's sound an unblended seam inherits. "
             + "Longer costs sampling time. A blended seam takes its tail from its blend "
             + "instead, so its sound and its picture cross on the same instants."),
        format: (n) => t("{n}s tail", { n: n.toFixed(1) }),
        onChange: (next) => { this.timeline.audio_tail_s = next; this.commit(); },
      })] : []),
      ...(single ? [el("span", {
        class: "mmc-pill mmc-pill-static",
        title: t("What the merged request compiles to — every shot's references and "
             + "keyframes are one pool, so this is asked of the whole timeline at once."),
      }, [el("span", { text: S.singleMode(this.timeline) })])] : []),
      refineButton({
        run: () => this.refineAll(),
        label: refined ? t("Refine again") : t("Refine all"),
        className: "mmc-pill mmc-tl-refine",
        title: t("Rewrite {what} into the expanded "
             + "description H3 was trained to read, in one pass so the later shots keep what the "
             + "first establishes. The global prompt is rewritten too, in its own box, and still "
             + "stands in front of every shot. Everything you wrote is kept and expanded. A "
             + "rewrite is queued in place of the card's own prompt, not alongside it.",
             { what: count === 1 ? t("the shot") : t("all {count} shots", { count }) }),
      }),
      ...(refined ? [el("button", {
        class: "mmc-pill mmc-tl-unrefine",
        title: t("Throw every rewrite away and go back to the prompts you typed. The global "
             + "prompt, soundscape and score the refiner wrote go with them."),
        onclick: () => this.revertAll(),
      }, [el("span", { text: t("Revert all") })])] : []),
      el("div", { class: "mmc-tl-total" }, [
        el("b", { text: `${seconds.toFixed(1)} s` }),
        el("span", { text: single
          ? t(count === 1 ? "{count} shot · {frames} frames" : "{count} shots · {frames} frames",
              { count, frames })
          : t(count === 1 ? "{count} segment" : "{count} segments", { count }) }),
      ]),
      el("div", {
        class: "mmc-note",
        title: single
          ? t("The whole timeline is generated at once, so the shots cost no more than one clip of the same length.")
          : passes.length === count
            ? t("Each segment is generated separately and they run one after another.")
            : t("One generation per pass, run one after another. A pass holding several "
              + "shots costs no more than one clip of the same length."),
      }, [
        el("span", { class: "mmc-note-key", text: t("cost") }),
        el("span", { text: t(passes.length === 1 ? "{count} generation per queue"
          : "{count} generations per queue", { count: passes.length }) }),
      ]),
      ...(problem ? [el("div", { class: "mmc-tl-problem" }, [
        el("span", { class: "mmc-note-key", text: t("one pass") }),
        el("span", { text: problem }),
      ])] : []),
      ...(this.refineError ? [el("div", { class: "mmc-warn", text: this.refineError })] : []),
    );
  }

  /**
   * The strip: one enclosure per pass, seams between them.
   *
   * A pass is what one queue generates, so it is what the strip is built out of
   * — usually one card, which is what the whole strip used to be. Every card
   * sits in an enclosure whether or not it shares one, so the cards line up
   * whatever the run lengths are; the enclosure only draws itself when it holds
   * more than one, and the head rails only take up room once the strip has a
   * pass in it at all.
   */
  renderStrip() {
    const parts = [];
    const passes = S.passes(this.timeline);
    passes.forEach((pass, position) => {
      if (position > 0) parts.push(this.renderJoin(pass.start));
      parts.push(this.renderPass(pass));
    });
    const what = S.isSingle(this.timeline) ? "Shot" : "Segment";
    parts.push(el("button", {
      class: "mmc-tl-add",
      title: this.timeline.segments.length >= S.MAX_SEGMENTS
        ? t("A timeline holds at most {max}.", { max: S.MAX_SEGMENTS })
        : t("Add a {what} to the end", { what: t(what.toLowerCase()) }),
      disabled: this.timeline.segments.length >= S.MAX_SEGMENTS || undefined,
      onclick: () => this.add(),
    }, [el("span", { text: "+" }), el("span", { text: t(what) })]));
    this.stripHost.classList.toggle(
      "has-pass", passes.some((pass) => pass.segments.length > 1));
    this.stripHost.replaceChildren(...parts);
  }

  renderCut(index) {
    const { at } = S.cutTimes(this.timeline);
    return el("div", { class: "mmc-tl-seam" }, [
      el("div", {
        class: "mmc-tl-cut",
        title: t("Shot {n} cuts in {time} into the clip. "
             + 'Write its prompt as the cut — "the camera cuts to…", "the shot transitions to…" — '
             + "and the timestamp is added for you.",
             { n: index + 1, time: S.shotTime(at[index]) }),
      }, [el("span", { text: "✂" }), el("span", { text: S.shotTime(at[index]) })]),
    ]);
  }

  pickTransitionPreset(anchor, segment, index) {
    const label = (preset) => t(preset.name);
    openChoicePopover(anchor, {
      title: t("Transition Preset — Shot {n}", { n: index + 1 }),
      options: TRANSITION_PRESETS.map(label),
      value: "",
      onPick: (choice) => {
        const found = TRANSITION_PRESETS.find((p) => label(p) === choice);
        if (found) {
          found.apply(segment);
          this.commit();
        }
      },
    });
  }

  renderJoin(index) {
    const segment = this.timeline.segments[index];
    const on = S.continues(segment);
    const blocked = on ? null : S.blockedReason(segment, "continue");

    const sound = S.continuesAudio(segment);
    const soundBlocked = sound ? null : S.blockedReason(segment, "continue_audio");

    const from = S.continueSource(segment, index);

    return el("div", { class: "mmc-tl-seam" }, [
      el("button", {
        class: "mmc-tl-join mmc-tl-join-preset",
        title: t("Apply a transition preset (Match Cut, Cross-Blend, Hard Cut, etc.)"),
        onclick: (event) => this.pickTransitionPreset(event.currentTarget, segment, index),
      }, [icon("magic", 13), el("span", { text: t("preset") })]),
      el("button", {
        class: `mmc-tl-join${on ? " on" : ""}`,
        disabled: blocked ? true : undefined,
        title: blocked || (on
          ? t("Segment {n} starts on segment {from}'s last frame. Click for a hard cut.",
              { n: index + 1, from })
          : t("Hard cut into segment {n}. Click to start it on segment {prev}'s last frame.",
              { n: index + 1, prev: index })),
        onclick: blocked ? undefined : () => { segment.continue = !on; this.commit(); },
      }, [el("span", { text: on ? "↝" : "✂" }), el("span", { text: on ? t("continues") : t("cut") })]),
      el("button", {
        class: `mmc-tl-join mmc-tl-join-sound${sound ? " on" : ""}`,
        disabled: soundBlocked ? true : undefined,
        title: soundBlocked || (sound
          ? t("Segment {n}'s sound carries on from segment {from}'s. "
            + "Click to let it start its own.", { n: index + 1, from })
          : t("Segment {n} generates its own sound from scratch. "
            + "Click to carry the last {tail}s of segment {from}'s into it.",
              { n: index + 1, tail: this.timeline.audio_tail_s, from })),
        onclick: soundBlocked ? undefined : () => { segment.continue_audio = !sound; this.commit(); },
      }, [icon("audio", 13), el("span", { text: sound ? t("sound") : t("silent seam") })]),
      ...((on || sound) && index >= 2 ? [el("button", {
        class: `mmc-tl-join mmc-tl-join-from${from !== index ? " on" : ""}`,
        title: t("What continues across this seam is segment {from}'s last {what}. "
             + "Click to inherit from a different earlier segment — a story returning to "
             + "segment 1 after an unrelated shot continues from segment 1.",
             { from, what: t(on && sound ? "frame and sound" : on ? "frame" : "sound") }),
        onclick: (event) => this.pickContinueFrom(event.currentTarget, segment, index),
      }, [el("span", { text: t("from #{from}", { from }) })])] : []),
      ...(on ? [el("button", {
        class: `mmc-tl-join mmc-tl-join-from${S.feather(segment) > 1 ? " on" : ""}`,
        title: (S.feather(segment) > 1
          ? t("The last {s} s of segment {from}'s motion "
            + "carries across this cut, so the movement flows through instead of restarting "
            + "from a still. That blended moment is redone at the start of segment {n} "
            + "and removed from the final video, so it plays about "
            + "{s} s shorter than its set length.",
              { s: blendSeconds(S.feather(segment)), from, n: index + 1 })
          : t("This cut picks up from segment {from}'s last frame. Click to blend a moment "
            + "of its motion across instead — a smoother handoff, in exchange for segment "
            + "{n} playing slightly shorter.", { from, n: index + 1 }))
          // The sound rides the same inherited instants as the frames, so the
          // blend sets the tail rather than the piece's setting. Said here
          // because this chip is where the number that wins is on screen.
          + (blendSetsTail(segment)
            ? " " + t("Its sound carries the same {s} s, so the soundtrack and the "
                    + "picture cross the seam on the same instants.",
                      { s: blendSeconds(S.feather(segment)) })
            : ""),
        onclick: (event) => this.pickFeather(event.currentTarget, segment, index),
      }, [el("span", {
        text: S.feather(segment) > 1
          ? t("blend {s} s", { s: blendSeconds(S.feather(segment)) }) : t("no blend"),
      })])] : []),
      // The third answer to what happens here, and the only structural one: no
      // seam at all, because the two sides are one generation. Kept apart from
      // the two switches above rather than folded in as a third state of the
      // picture one — those say how this seam behaves, this one says whether
      // there is a seam to behave.
      el("button", {
        class: "mmc-tl-join mmc-tl-join-merge",
        title: t("Generate segment {n} in the same pass as the one before it: one "
             + "generation, with this cut written into its description for the model to "
             + "draw. Nothing is decoded and re-encoded here, so there is no seam to "
             + "cross — in exchange the two shots share one mode, one checkpoint, one "
             + "LoRA stack and one seed. Everything you set here is kept, and comes "
             + "back if you split the pass again.", { n: index + 1 }),
        onclick: () => this.mergeAt(index),
      }, [el("span", { text: "▤" }), el("span", { text: t("one pass") })]),
    ]);
  }

  pickFeather(anchor, segment, index) {
    const max = S.maxFeather(segment);
    const label = (f) => (f === 1 ? t("None — start from the last frame")
      : t("{name} · {s} s of motion",
          { name: t({ 5: "Short", 22: "Medium", 39: "Long" }[f] ?? "Blend"), s: blendSeconds(f) }));
    openChoicePopover(anchor, {
      title: t("Blend into segment {n}", { n: index + 1 }),
      options: S.FEATHER_GRID.filter((f) => f <= max).map(label),
      value: label(Math.min(S.feather(segment), max)),
      onPick: (choice) => {
        const width = S.FEATHER_GRID.find((f) => label(f) === choice) ?? 1;
        if (width > 1) segment.feather = width;
        else delete segment.feather;
        this.commit();
      },
    });
  }

  pickContinueFrom(anchor, segment, index) {
    const earlier = this.earlierPasses(index);
    const options = earlier.map((pass, position) => {
      const previous = position === earlier.length - 1;
      if (pass.segments.length > 1) {
        return previous
          ? t("segments {first}-{last}, one pass — previous",
              { first: pass.start + 1, last: pass.end })
          : t("segments {first}-{last}, one pass", { first: pass.start + 1, last: pass.end });
      }
      return previous ? t("segment {n} — previous", { n: pass.end }) : t("segment {n}", { n: pass.end });
    });
    // Whatever is stored resolves to the pass that holds it, which is the frame
    // compile.py will actually reach for.
    const source = S.continueSource(segment, index);
    const current = earlier.findIndex((pass) => source > pass.start && source <= pass.end);

    openChoicePopover(anchor, {
      title: t("Segment {n} continues from", { n: index + 1 }),
      options,
      value: options[current >= 0 ? current : earlier.length - 1],
      onPick: (choice) => {
        const n = Number(/\d+/.exec(choice)[0]);
        if (n === index) delete segment.continue_from;
        else segment.continue_from = n;
        this.commit();
      },
    });
  }

  renderCard(segment, index) {
    const single = S.isSingle(this.timeline);
    const frames = framesForSeconds(segment.duration_s);
    const seconds = single ? Number(segment.duration_s) || 0 : secondsForFrames(frames);
    const refs = S.references(segment).length + S.citedPool(segment).length;
    const loras = S.activeLoras(segment).length;
    const typed = (segment.prompt || "").trim();
    const rewrite = segment.refined?.body?.trim();
    const using = rewrite && segment.refined.enabled !== false;
    const prompt = typed || rewrite || "";
    const isGenerating = (index + 1) === this.activeSegment;

    const meta = [];
    if (refs) meta.push(t(refs === 1 ? "{count} ref" : "{count} refs", { count: refs }));
    if (loras) meta.push(t(loras === 1 ? "{count} LoRA" : "{count} LoRAs", { count: loras }));
    if (rewrite) meta.push(using ? t("refined") : t("refined (off)"));

    return el("div", {
      class: `mmc-tl-card${isGenerating ? " generating" : ""}`,
      style: { width: `${cardWidth(seconds)}px` },
      ondblclick: () => this.edit(index),
    }, [
      el("div", { class: "mmc-tl-card-head" }, [
        el("span", { class: "mmc-tl-index", text: String(index + 1) }),
        el("span", {
          class: `mmc-tl-dur${shared || isTrainedLength(frames) ? "" : " off-distribution"}`,
          text: `${segment.duration_s} s`,
          title: shared
            ? t("{s} s of this pass — the frame count is the pass's.", { s: segment.duration_s })
            : isTrainedLength(frames)
              ? t("{frames} frames at 24 fps", { frames })
              : t("{frames} frames — outside the ~5–15 s the weights were trained on.", { frames }),
        }),
        ...(single ? [] : [el("span", { class: "mmc-tl-mode", text: S.mode(segment) })]),
      ]),
      el("div", {
        class: `mmc-tl-card-prompt${prompt ? "" : " empty"}${using && typed ? " superseded" : ""}`,
        text: prompt || t("No prompt yet"),
        title: using && typed ? t("Not queued — this card's rewrite is. Open it to read or revert.") : "",
      }),
      ...(meta.length ? [el("div", { class: "mmc-tl-card-meta", text: meta.join(" · ") })] : []),
      el("div", { class: "mmc-tl-card-foot" }, [
        el("button", { class: "mmc-tl-edit", text: t("Edit"), onclick: () => this.edit(index) }),
        el("button", {
          class: "mmc-ghost", text: "◀", title: t("Move earlier"),
          disabled: index === 0 || undefined,
          onclick: () => this.move(index, -1),
        }),
        el("button", {
          class: "mmc-ghost", text: "▶", title: t("Move later"),
          disabled: index === this.timeline.segments.length - 1 || undefined,
          onclick: () => this.move(index, 1),
        }),
        el("button", {
          class: "mmc-ghost", text: "⧉", title: t("Duplicate"),
          disabled: this.timeline.segments.length >= S.MAX_SEGMENTS || undefined,
          onclick: () => this.duplicate(index),
        }),
        el("button", {
          class: "mmc-asset-x", text: "✕", title: t("Remove this segment"),
          disabled: this.timeline.segments.length <= 1 || undefined,
          onclick: () => this.remove(index),
        }),
      ]),
    ]);
  }

  add() {
    if (this.timeline.segments.length >= S.MAX_SEGMENTS) return;
    this.timeline.segments.push(S.continuingSegment());
    this.commit();
  }

  duplicate(index) {
    if (this.timeline.segments.length >= S.MAX_SEGMENTS) return;
    this.timeline.segments.splice(index + 1, 0, S.cloneSegment(this.timeline.segments[index]));
    S.remapContinueFrom(this.timeline, (n) => (n > index + 1 ? n + 1 : n));
    this.commit();
  }

  remove(index) {
    if (this.timeline.segments.length <= 1) return;
    this.timeline.segments.splice(index, 1);
    S.remapContinueFrom(this.timeline,
      (n) => (n === index + 1 ? null : n > index + 1 ? n - 1 : n));
    this.commit();
  }

  move(index, delta) {
    const target = index + delta;
    const segments = this.timeline.segments;
    if (target < 0 || target >= segments.length) return;
    [segments[index], segments[target]] = [segments[target], segments[index]];
    S.remapContinueFrom(this.timeline,
      (n) => (n === index + 1 ? target + 1 : n === target + 1 ? index + 1 : n));
    this.commit();
  }

  async openLoras() {
    await openLoras({
      state: this.timeline,
      targets: S.timelineCheckpoints(this.timeline),
      onChange: () => this.commit(),
    });
    this.render();
  }

  takePiece(result) {
    const replaced = this.timeline.refined?.replaced
      ?? { soundscape: this.timeline.soundscape ?? "", music: this.timeline.music ?? "" };

    if (result.piece) {
      if (replaced.prompt === undefined) replaced.prompt = this.timeline.prompt ?? "";
      this.timeline.prompt = result.piece;
      this.prompt.setValue(result.piece);
    }
    if (result.soundscape) this.timeline.soundscape = result.soundscape;
    if (result.music) this.timeline.music = result.music;
    this.timeline.refined = {
      ...(this.timeline.refined || {}),
      replaced,
      ...(result.sections && S.isSingle(this.timeline) ? { sections: result.sections } : {}),
    };
    this.soundscapeBox.value = this.timeline.soundscape ?? "";
    this.musicBox.value = this.timeline.music ?? "";
    this.onCommit?.();
  }

  revertAll() {
    for (const segment of this.timeline.segments) segment.refined = null;
    this.dropTimelineRewrite();
    this.commit();
  }

  dropTimelineRewrite() {
    if (this.timeline.segments.some((segment) => segment.refined?.body)) return;
    const replaced = this.timeline.refined?.replaced;
    if (replaced) {
      this.timeline.soundscape = replaced.soundscape ?? "";
      this.timeline.music = replaced.music ?? "";
      if (replaced.prompt !== undefined) {
        this.timeline.prompt = replaced.prompt;
        this.prompt.setValue(replaced.prompt);
      }
      if (this.soundscapeBox) this.soundscapeBox.value = this.timeline.soundscape;
      if (this.musicBox) this.musicBox.value = this.timeline.music;
    }
    this.timeline.refined = null;
  }

  async refineAll() {
    this.refineError = null;
    try {
      const result = await refine({
        kind: "timeline",
        data: JSON.parse(S.serializeTimeline(this.timeline)),
      });
      for (const shot of result.shots ?? []) {
        const segment = this.timeline.segments[shot.index];
        if (!segment || !shot.body) continue;
        segment.refined = {
          body: shot.body,
          ...(result.scope ? { scope: result.scope } : {}),
          ...(shot.sections ? { sections: shot.sections } : {}),
          ...(result.template ? { template: result.template, forced: !!result.forced } : {}),
          source: segment.prompt ?? "",
          model: refineModel(),
          enabled: true,
        };
      }
      this.takePiece(result);
      this.refineError = (result.problems ?? []).join(" · ") || null;
    } catch (error) {
      this.refineError = String(error.message || error);
    }
    this.commit();
  }

  edit(index) {
    const segment = this.timeline.segments[index];
    const editor = new CreatorEditor({
      state: segment,
      onCommit: () => { this.onCommit?.(); this.renderStrip(); },
      canvasPills: false,
      routeOf: () => this.timeline.models?.route ?? "auto",
      continuePill: index > 0 && !S.isSingle(this.timeline),
      refineTarget: () => ({
        kind: "segment",
        index,
        data: JSON.parse(S.serializeTimeline(this.timeline)),
      }),
      onRefined: (result) => this.takePiece(result),
      onReverted: () => { this.dropTimelineRewrite(); this.onCommit?.(); },
    });

    // A card sharing a pass is a shot of it; a card generated alone is a
    // segment. The two words mean different things in this node and the header
    // is where the user finds out which one they are editing.
    const shared = S.passOf(this.timeline, index).segments.length > 1;
    const modal = el("div", { class: "mmc-modal mmc-tl-editor" }, [
      el("div", { class: "mmc-modal-head" }, [
        el("span", { class: "mmc-tab", "aria-selected": "true",
                     text: t(shared ? "Shot {n}" : "Segment {n}", { n: index + 1 }) }),
        el("span", { class: "mmc-tl-editor-sub",
                     text: t("of {count}", { count: this.timeline.segments.length }) }),
        el("button", { class: "mmc-close", text: "✕", title: t("Back to the timeline"), onclick: () => done() }),
      ]),
      el("div", { class: "mmc-tl-editor-body" }, [editor.root]),
    ]);

    const overlay = el("div", {
      class: "mmc-overlay",
      onpointerdown: (event) => { if (event.target === overlay) done(); },
    }, [modal]);

    const unmount = mountOverlay(overlay, () => done());
    const done = () => { unmount(); this.render(); };
  }
}

export class TimelineBody {
  constructor({ read, write, widgets = {}, onWidgetChange, nodeId, preStage = null }) {
    this.read = read;
    this.write = write;
    this.widgets = widgets;
    this.onWidgetChange = onWidgetChange;
    this.nodeId = nodeId;
    this.preStage = preStage;
    this.activeSegment = null;
    this.timeline = S.parseTimeline(read());

    this.root = el("div", { class: "mmc-root" });
    setupDragAndDrop(this.root, this);
    this.stage = new Stage({
      nodeId,
      segmentLabel: (index) => t("Segment {n} of {count}",
        { n: index, count: this.timeline.segments.length }),
      onGallery: () => openPicker({
        kinds: ["renders"],
        kind: "renders",
        viewOnly: true,
        capacity: () => ({ used: 0, max: 0, filesLeft: 0 }),
      }),
    });

    this.onApiEvent = (event) => this.handleApiEvent(event.type, event.detail);
    const events = ["mmc_segment", "execution_start", "executed", "execution_error"];
    for (const name of events) api.addEventListener(name, this.onApiEvent);

    loadCatalog(() => this.adoptWeights());
    this.render();
  }

  destroy() {
    const events = ["mmc_segment", "execution_start", "executed", "execution_error"];
    for (const name of events) api.removeEventListener(name, this.onApiEvent);
    this.stage?.destroy();
  }

  getId() {
    if (typeof this.nodeId === "function") {
      try { return this.nodeId(); } catch { return null; }
    }
    return this.nodeId;
  }

  ours(id) {
    if (id === null || id === undefined) return false;
    const mine = String(this.getId() ?? "");
    const other = String(id);
    return other === mine || (mine && other.startsWith(`${mine}.`));
  }

  handleApiEvent(type, detail) {
    if (!detail) return;
    if (type === "mmc_segment") {
      if (this.ours(detail.node)) {
        this.activeSegment = detail.index ?? null;
        this.render();
      }
    } else if (type === "execution_start") {
      this.activeSegment = null;
      this.render();
    } else if (type === "executed") {
      if (String(detail.display_node) === String(this.getId() ?? "")) {
        this.activeSegment = null;
        this.render();
      }
    } else if (type === "execution_error") {
      if (this.ours(detail.node_id)) {
        this.activeSegment = null;
        this.render();
      }
    }
  }

  adoptWeights() {
    if (S.guessModels(this.timeline.models, catalogFiles())) this.commit();
    else this.render();
  }

  reload() {
    this.timeline = S.parseTimeline(this.read());
    this.render();
  }

  commit() {
    S.syncTimeline(this.timeline);
    Turbo.sync(this.timeline, this.widgetIO());
    this.write(S.serializeTimeline(this.timeline));
    this.render();
  }

  open() {
    openTimeline({ timeline: this.timeline, onCommit: () => this.commit() });
  }

  value(name, fallback) {
    const widget = this.widgets[name];
    return widget ? widget.value : fallback;
  }

  widgetIO() {
    return {
      value: (name, fallback) => this.value(name, fallback),
      set: (name, value) => {
        const widget = this.widgets[name];
        if (!widget) return;
        widget.value = value;
        widget.callback?.(value);
        this.onWidgetChange?.();
      },
    };
  }

  set(name, value) {
    const widget = this.widgets[name];
    if (!widget) return;
    widget.value = value;
    widget.callback?.(value);
    this.onWidgetChange?.();
    this.render();
  }

  render() {
    this.root.replaceChildren(this.renderPanel(), this.renderSampling());
  }

  renderPanel() {
    const segments = this.timeline.segments;
    const single = S.isSingle(this.timeline);
    const passes = S.passes(this.timeline);
    const seconds = S.timelineSeconds(this.timeline);
    const [width, height] = resolveCanvas(
      ASPECT_PRESETS.find(([label]) => label === this.timeline.aspect)?.[1] ?? 16 / 9,
      this.timeline.short_edge);
    const prompt = (this.timeline.prompt || "").trim();
    const globalLoras = S.activeGlobalLoras(this.timeline).length;
    const audio = [
      ...(this.timeline.soundscape?.trim() ? [t("soundscape")] : []),
      ...(this.timeline.music?.trim() ? [t("music")] : []),
    ];

    return el("div", { class: "mmc-panel mmc-tl-summary" }, [
      el("div", {
        class: `mmc-tl-summary-prompt${prompt ? "" : " empty"}`,
        text: prompt || (single
          ? t("No global prompt yet — the standing description that opens Shot 1.")
          : t("No global prompt yet — the standing description every segment inherits.")),
        onclick: () => this.open(),
      }),
      el("div", { class: "mmc-tl-lane", onclick: () => this.open() }, segments.map((segment, index) => {
        const continues = !single && S.continues(segment);
        const isGenerating = (index + 1) === this.activeSegment;
        const { at } = S.cutTimes(this.timeline);
        return el("div", {
          class: `mmc-tl-tick${continues ? " on" : ""}${isGenerating ? " generating" : ""}`,
          style: { flexGrow: String(Math.max(1, segment.duration_s)) },
          title: single
            ? (index
                ? t("Shot {n} · {s} s · cuts in at {time}",
                    { n: index + 1, s: segment.duration_s, time: S.shotTime(at[index]) })
                : t("Shot {n} · {s} s · opens the clip", { n: index + 1, s: segment.duration_s }))
            : (continues
                ? t("Segment {n} · {s} s · {mode} · continues from segment {from}",
                    { n: index + 1, s: segment.duration_s, mode: S.mode(segment),
                      from: S.continueSource(segment, index) })
                : t("Segment {n} · {s} s · {mode} · hard cut",
                    { n: index + 1, s: segment.duration_s, mode: S.mode(segment) })),
        }, [
          ...(continues ? [icon("link", 13)] : []),
          el("span", { class: "mmc-tl-tick-n", text: String(index + 1) }),
          el("span", { class: "mmc-tl-tick-s", text: `${segment.duration_s}s` }),
        ]);
      })),
      el("div", { class: "mmc-pills" }, [
        el("span", {
          class: "mmc-pill mmc-pill-static",
          title: single
            ? t("One generation: the segments are the shots of a single description, cut times and all.")
            : passes.length === segments.length
              ? t("One generation per segment, joined end to end.")
              : t("One generation per pass, joined end to end. A pass holding several "
                + "shots generates them at once, with the cuts written into its description."),
        }, [
          icon("timeline", 16),
          el("span", { text: single ? t("one pass")
            : passes.length === segments.length ? t("chained")
              : t("{count} passes", { count: passes.length }) }),
          el("span", {
            class: "mmc-pill-sub",
            text: single
              ? t(segments.length === 1 ? "{count} shot" : "{count} shots", { count: segments.length })
              : t(segments.length === 1 ? "{count} segment" : "{count} segments", { count: segments.length }),
          }),
        ]),
        el("span", { class: "mmc-pill mmc-pill-static", title: t("The finished clip's length at 24 fps") }, [
          icon("clock", 16),
          el("span", { text: `${seconds.toFixed(1)} s` }),
        ]),
        el("span", {
          class: "mmc-pill mmc-pill-static",
          title: single
            ? t("The canvas the one generation runs at.")
            : t("Shared by every segment — they are joined end to end and have to match."),
        }, [
          el("span", { text: this.timeline.aspect }),
          el("span", { class: "mmc-pill-sub", text: `${width} × ${height}` }),
        ]),
        ...(globalLoras ? [el("span", {
          class: "mmc-pill mmc-pill-static",
          title: single
            ? t("Patched onto the one generation, in front of whatever the shots add.")
            : t("Patched onto every segment, in front of whatever that segment adds."),
        }, [
          icon("effect", 16),
          el("span", { text: t(globalLoras === 1 ? "{count} LoRA" : "{count} LoRAs", { count: globalLoras }) }),
        ])] : []),
        ...(this.timeline.assets?.length ? [el("span", {
          class: "mmc-pill mmc-pill-static",
          title: t("References attached to the piece itself, cited by @handle from "
               + "the segments where they appear."),
        }, [
          icon("image", 16),
          el("span", { text: t(this.timeline.assets.length === 1
            ? "{count} piece ref" : "{count} piece refs",
            { count: this.timeline.assets.length }) }),
        ])] : []),
        ...(audio.length ? [el("span", {
          class: "mmc-pill mmc-pill-static",
          title: t("The Context-IR audio fields this timeline sets for every segment."),
        }, [icon("audio", 16), el("span", { text: audio.join(" · ") })])] : []),
        el("button", {
          class: `mmc-pill${this.stage?.showing() ? " on" : ""}`,
          title: t("Toggle satellite preview box"),
          onclick: () => {
            this.stage?.toggleOpen();
            this.render();
          },
        }, [icon("play", 16), el("span", { text: t("Preview") })]),
        el("button", {
          class: "mmc-tl-open",
          title: t("Open the timeline: the global prompt, the segments, and what happens between them"),
          onclick: () => this.open(),
        }, [icon("sliders", 16), el("span", { text: t("Edit timeline") })]),
        ...(this.preStage ? [this.renderPreStagePill()] : []),
      ]),
    ]);
  }

  renderPreStagePill() {
    const on = this.preStage.active();
    return el("button", {
      class: `mmc-pill mmc-prestage-toggle${on ? " on" : ""}`,
      title: on
        ? t("The pre-stage node on the left generates stills for this timeline — the opening frame, the closing frame, references. Click to remove it.")
        : t("Add a pre-stage: an image node (Krea 2 / Ideogram 4) at this node's left edge whose stills land on the timeline's shots with one click."),
      onclick: () => { this.preStage.toggle(); this.render(); },
    }, [icon("image", 16), el("span", { text: t("pre-stage") })]);
  }

  attachFromPreStage({ role, filename }) {
    const shots = this.timeline.segments;
    const index = role === "last_frame" ? shots.length - 1 : 0;
    const segment = shots[index];
    const where = t("segment {n}", { n: index + 1 });
    if (role === "reference") {
      const blocked = S.blockedReason(segment, "reference");
      if (blocked) return t("{where}: {blocked}", { where, blocked });
      const { used, max, filesLeft } = S.capacity(segment, "image");
      if (used >= max || filesLeft <= 0) {
        return t("{where}: no image slots left ({used}/{max} used).", { where, used, max });
      }
      segment.assets.push({
        handle: S.nextHandle(segment, "image"),
        kind: "image", role: "reference", filename, ref_size: "max",
      });
      this.commit();
      return null;
    }
    const blocked = S.blockedReason(segment, role);
    if (blocked) return t("{where}: {blocked}", { where, blocked });
    const existing = S.frameAsset(segment, role);
    if (existing) segment.assets = segment.assets.filter((a) => a.handle !== existing.handle);
    segment.assets.push({
      handle: S.nextHandle(segment, "image"),
      kind: "image", role, filename,
    });
    this.commit();
    return null;
  }

  renderSampling() {
    return samplingBar({
      widgets: this.widgets,
      value: (name, fallback) => this.value(name, fallback),
      set: (name, value) => this.set(name, value),
      perSegment: !S.isSingle(this.timeline),
      turbo: Turbo.turboPills({
        container: this.timeline,
        ...this.widgetIO(),
        onCommit: () => this.commit(),
      }),
      trailing: [weightsPill({
        models: this.timeline.models,
        checkpoints: S.timelineCheckpoints(this.timeline),
        onChange: () => this.commit(),
        turbo: { container: this.timeline, widgetIO: this.widgetIO() },
      })],
    });
  }
}