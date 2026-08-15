import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
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
import * as Turbo from "./turbo.js";
import * as S from "./state.js";
import { setupDragAndDrop } from "./media_drop.js";
import { drawTimelineWaveform, peaks, draw } from "./waveform.js";
import {
  FPS, framesForSeconds, secondsForFrames, resolveCanvas, ASPECT_PRESETS, describeRatio, isTrainedLength,
} from "./canvas.js";

const blendSeconds = (frames) => (frames / FPS).toFixed(1);

export function openTimeline(options) {
  return new Promise((resolve) => new Timeline(options, resolve).mount());
}

const cardWidth = (seconds) => 154 + Math.round(Math.sqrt(seconds) * 28);

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

    this.audioHost = el("div", { class: "mmc-tl-audio-grid" }, [
      el("label", { class: "mmc-tl-field-card" }, [
        el("span", { class: "mmc-tl-field-tag", text: t("OVERALL_SOUNDSCAPE") }),
        this.soundscapeBox,
      ]),
      el("label", { class: "mmc-tl-field-card" }, [
        el("span", { class: "mmc-tl-field-tag", text: t("NON_DIEGETIC_MUSIC") }),
        this.musicBox,
      ]),
    ]);

    this.poolHost = el("div", { class: "mmc-tl-pool-card" });
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
        el("span", { class: "mmc-tab", "aria-selected": "true", text: t("Timeline Editor") }),
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
        el("span", { class: "mmc-tl-field-tag", text: t("PIECE REFERENCES (GLOBAL)") }),
        el("span", {
          class: "mmc-tl-pool-hint",
          text: t("Attach once. Cite @handle in global prompt or segment prompts."),
        }),
        el("button", {
          class: "mmc-ghost mmc-tl-pool-add",
          title: t("Attach a reference to the whole piece — a character sheet, location, or voice."),
          onclick: () => this.addPoolAssets(),
        }, [el("span", { text: "+ Add Reference" })]),
      ]),
      ...(assets.length ? [el("div", { class: "mmc-assets", style: { marginTop: "6px" } }, assets.map((a) => this.poolChip(a)))] : []),
    );
  }

  poolChip(asset) {
    const everywhere = S.poolCitedGlobally(this.timeline, asset);
    const cited = S.poolCitations(this.timeline, asset);
    const where = everywhere
      ? t("everywhere (global)")
      : cited.length
        ? t(cited.length === 1 ? "in shot {list}" : "in shots {list}", { list: cited.join(", ") })
        : t("uncited");
    const thumb = asset.kind === "image"
      ? el("img", { class: "mmc-asset-thumb", src: viewUrl(asset.filename, { preview: true }), alt: "" })
      : el("span", { class: "mmc-asset-thumb", text: asset.kind === "video" ? "▶" : "♪" });
    return el("div", {
      class: `mmc-asset${everywhere || cited.length ? "" : " idle"}`,
      title: everywhere || cited.length
        ? t("{file} — {where}", { file: asset.filename, where })
        : t("{file} — no segment cites @{handle} yet.", { file: asset.filename, handle: asset.handle }),
    }, [
      thumb,
      el("button", {
        class: `mmc-asset-handle mmc-tl-pool-cite mmc-tag-${S.tagIndex(asset.handle)}`,
        text: `@${asset.handle}`,
        title: t("Write @{handle} into global prompt", { handle: asset.handle }),
        onclick: () => this.citeInGlobal(asset),
      }),
      el("span", { class: "mmc-tl-pool-where", text: where }),
      ...(asset.kind === "image" ? [el("button", {
        class: "mmc-ghost",
        style: { fontSize: "11px" },
        title: t("What of this picture is referenced"),
        text: t(S.takes(asset)),
        onclick: (event) => this.pickPoolTakes(event.currentTarget, asset),
      })] : []),
      el("button", {
        class: "mmc-asset-x", text: "✕",
        title: t("Remove @{handle}", { handle: asset.handle }),
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
      title: t("@{handle} reference type", { handle: asset.handle }),
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
    const option = (mode, label, title) => el("button", {
      class: `mmc-tl-render-opt${(mode === "single") === single ? " on" : ""}`,
      text: t(label),
      title,
      onclick: () => {
        if (this.timeline.render === mode) return;
        this.timeline.render = mode;
        this.commit();
      },
    });
    return el("div", { class: "mmc-tl-render" }, [
      option("chained", "Chained",
        t("One generation per segment, joined end to end. Supports selective locking and re-rolling.")),
      option("single", "One pass",
        t("One generation. The segments become the shots of a single description, cut times and all.")),
    ]);
  }

  renderBar() {
    const single = S.isSingle(this.timeline);
    const { width, height, ratio } = this.geometry();
    const seconds = S.timelineSeconds(this.timeline);
    const frames = S.timelineFrames(this.timeline);
    const count = this.timeline.segments.length;
    const active = S.activeGlobalLoras(this.timeline).length;
    const idle = (this.timeline.loras?.length ?? 0) - active;
    const problem = single ? S.singleProblem(this.timeline) : null;
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
            + "{width} × {height} by a second pass.",
              { edge: S.sampleEdge(this.timeline), width, height })
          : t("Short edge. Lower is faster; 768 is native."),
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
        title: t("Global LoRAs patched onto every segment."),
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
        title: t("How much of the previous segment's sound a continuing seam inherits."),
        format: (n) => t("{n}s tail", { n: n.toFixed(1) }),
        onChange: (next) => { this.timeline.audio_tail_s = next; this.commit(); },
      })] : []),
      ...(single ? [el("span", {
        class: "mmc-pill mmc-pill-static",
        title: t("Merged mode for one-pass timeline."),
      }, [el("span", { text: S.singleMode(this.timeline) })])] : []),
      refineButton({
        run: () => this.refineAll(),
        label: refined ? t("Refine again") : t("Refine all"),
        className: "mmc-pill mmc-tl-refine",
        title: t("Rewrite all shots into Context-IR descriptions."),
      }),
      ...(refined ? [el("button", {
        class: "mmc-pill mmc-tl-unrefine",
        title: t("Revert all rewrites."),
        onclick: () => this.revertAll(),
      }, [el("span", { text: t("Revert all") })])] : []),
      el("div", { class: "mmc-tl-total" }, [
        el("b", { text: `${seconds.toFixed(1)} s` }),
        el("span", { text: single
          ? t(count === 1 ? "{count} shot · {frames} frames" : "{count} shots · {frames} frames",
              { count, frames })
          : t(count === 1 ? "{count} segment" : "{count} segments", { count }) }),
      ]),
      ...(problem ? [el("div", { class: "mmc-tl-problem" }, [
        el("span", { class: "mmc-note-key", text: t("one pass") }),
        el("span", { text: problem }),
      ])] : []),
      ...(this.refineError ? [el("div", { class: "mmc-warn", text: this.refineError })] : []),
    );
  }

  renderStrip() {
    const parts = [];
    const single = S.isSingle(this.timeline);
    this.timeline.segments.forEach((segment, index) => {
      if (index > 0) parts.push(single ? this.renderCut(index) : this.renderJoin(index));
      parts.push(this.renderCard(segment, index));
    });
    const what = single ? "Shot" : "Segment";
    parts.push(el("button", {
      class: "mmc-tl-add",
      title: this.timeline.segments.length >= S.MAX_SEGMENTS
        ? t("A timeline holds at most {max}.", { max: S.MAX_SEGMENTS })
        : t("Add a {what} to the end", { what: t(what.toLowerCase()) }),
      disabled: this.timeline.segments.length >= S.MAX_SEGMENTS || undefined,
      onclick: () => this.add(),
    }, [el("span", { style: { fontSize: "22px" }, text: "+" }), el("span", { text: t(what) })]));
    this.stripHost.replaceChildren(...parts);
  }

  renderCut(index) {
    const { at } = S.cutTimes(this.timeline);
    return el("div", { class: "mmc-tl-seam" }, [
      el("div", {
        class: "mmc-tl-cut",
        title: t("Shot {n} cuts in at {time}.",
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
             + "Click to inherit from a different earlier segment.",
             { from, what: t(on && sound ? "frame and sound" : on ? "frame" : "sound") }),
        onclick: (event) => this.pickContinueFrom(event.currentTarget, segment, index),
      }, [el("span", { text: t("from #{from}", { from }) })])] : []),
      ...(on ? [el("button", {
        class: `mmc-tl-join mmc-tl-join-from${S.feather(segment) > 1 ? " on" : ""}`,
        title: (S.feather(segment) > 1
          ? t("The last {s} s of segment {from}'s motion carries across this cut.",
              { s: blendSeconds(S.feather(segment)), from })
          : t("Click to blend a moment of motion across.")),
        onclick: (event) => this.pickFeather(event.currentTarget, segment, index),
      }, [el("span", {
        text: S.feather(segment) > 1
          ? t("blend {s} s", { s: blendSeconds(S.feather(segment)) }) : t("no blend"),
      })])] : []),
    ]);
  }

  reRollSegment(targetIndex) {
    this.timeline.segments.forEach((seg, idx) => {
      if (idx === targetIndex) {
        seg.locked = false;
      } else if (seg.cached_video) {
        seg.locked = true;
      }
    });
    this.commit();
    try {
      app.queuePrompt(0);
    } catch {}
  }

  renderFilmstrip(segment) {
    const firstFrame = S.frameAsset(segment, "first_frame");
    const lastFrame = S.frameAsset(segment, "last_frame");
    const cached = segment.cached_video;

    const filmstrip = el("div", { class: "mmc-tl-filmstrip" });

    if (cached) {
      const vid = el("video", {
        class: "mmc-tl-filmstrip-media",
        muted: true, playsinline: true, preload: "metadata",
        src: `${viewUrl(cached)}#t=0.1`,
      });
      filmstrip.appendChild(vid);
    } else {
      filmstrip.appendChild(el("button", {
        class: `mmc-tl-filmstrip-slot${firstFrame ? " has-asset" : ""}`,
        title: firstFrame ? `@${firstFrame.handle} (${t("Start frame")})` : t("Add start frame"),
        onclick: () => this.pickFrameForSegment(segment, "first_frame"),
      }, firstFrame ? [
        el("img", { src: viewUrl(firstFrame.filename, { preview: true }), alt: "" }),
        el("span", { class: "mmc-tl-slot-tag", text: "START" }),
      ] : [
        icon("frameIn", 14),
        el("span", { text: t("Start") }),
      ]));

      filmstrip.appendChild(el("button", {
        class: `mmc-tl-filmstrip-slot${lastFrame ? " has-asset" : ""}`,
        title: lastFrame ? `@${lastFrame.handle} (${t("End frame")})` : t("Add end frame"),
        onclick: () => this.pickFrameForSegment(segment, "last_frame"),
      }, lastFrame ? [
        el("img", { src: viewUrl(lastFrame.filename, { preview: true }), alt: "" }),
        el("span", { class: "mmc-tl-slot-tag", text: "END" }),
      ] : [
        icon("frameOut", 14),
        el("span", { text: t("End") }),
      ]));
    }
    return filmstrip;
  }

  async pickFrameForSegment(segment, role) {
    const chosen = await openPicker({
      kinds: ["image", "renders"], kind: "image", single: true,
      capacity: () => ({ used: 0, max: 1, filesLeft: 1 }),
    });
    if (!chosen) return;
    const asset = chosen[0];
    const existing = S.frameAsset(segment, role);
    if (existing) segment.assets = (segment.assets || []).filter((a) => a.handle !== existing.handle);
    segment.assets = segment.assets || [];
    segment.assets.push({
      handle: S.nextHandle(segment, "image"),
      kind: "image",
      role,
      filename: asset.path,
    });
    this.commit();
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
    const isLocked = S.isLocked(segment);
    const hasCache = Boolean(segment.cached_video);

    const meta = [];
    if (refs) meta.push(t(refs === 1 ? "{count} ref" : "{count} refs", { count: refs }));
    if (loras) meta.push(t(loras === 1 ? "{count} LoRA" : "{count} LoRAs", { count: loras }));
    if (rewrite) meta.push(using ? t("refined") : t("refined (off)"));

    const lockBtn = !single && hasCache ? el("button", {
      class: `mmc-ghost mmc-tl-icon-btn${isLocked ? " locked" : ""}`,
      text: isLocked ? "🔒" : "🔓",
      title: isLocked ? t("Locked (using cached render)") : t("Click to lock cache"),
      onclick: (e) => {
        e.stopPropagation();
        segment.locked = !segment.locked;
        this.commit();
      },
    }) : null;

    const rerollBtn = !single ? el("button", {
      class: "mmc-ghost mmc-tl-icon-btn",
      text: "🎲",
      title: t("Re-roll this shot only"),
      onclick: (e) => {
        e.stopPropagation();
        this.reRollSegment(index);
      },
    }) : null;

    let statusBadge = null;
    if (!single) {
      if (isLocked) {
        statusBadge = el("span", { class: "mmc-tl-card-badge locked", text: t("LOCKED") });
      } else if (hasCache) {
        statusBadge = el("span", { class: "mmc-tl-card-badge ready", text: t("CACHED") });
      }
    }

    const waveCanvas = el("canvas", { class: "mmc-tl-card-wave" });
    const audioAsset = (segment.assets || []).find((a) => a.kind === "audio" || (a.kind === "video" && a.track !== "picture"));
    const waveSource = segment.cached_video || audioAsset?.filename;
    if (waveSource) {
      peaks(waveSource).then((data) => {
        if (data?.length && waveCanvas.isConnected) {
          draw(waveCanvas, data, "rgba(240,166,60,0.38)");
        }
      });
    }

    const filmstrip = this.renderFilmstrip(segment);

    return el("div", {
      class: `mmc-tl-card${isGenerating ? " generating" : ""}${isLocked ? " locked" : ""}`,
      style: { width: `${cardWidth(seconds)}px` },
      ondblclick: () => this.edit(index),
    }, [
      el("div", { class: "mmc-tl-card-head" }, [
        el("span", { class: "mmc-tl-index", text: String(index + 1) }),
        el("span", {
          class: `mmc-tl-dur${single || isTrainedLength(frames) ? "" : " off-distribution"}`,
          text: `${segment.duration_s} s`,
        }),
        statusBadge,
        lockBtn,
        ...(single ? [] : [el("span", { class: "mmc-tl-mode", text: S.mode(segment) })]),
      ]),
      filmstrip,
      el("div", {
        class: `mmc-tl-card-prompt${prompt ? "" : " empty"}${using && typed ? " superseded" : ""}`,
        text: prompt || t("Describe this shot..."),
      }),
      waveCanvas,
      ...(meta.length ? [el("div", { class: "mmc-tl-card-meta", text: meta.join(" · ") })] : []),
      el("div", { class: "mmc-tl-card-foot" }, [
        el("button", { class: "mmc-tl-edit", text: t("Edit"), onclick: () => this.edit(index) }),
        rerollBtn,
        el("button", {
          class: "mmc-ghost mmc-tl-icon-btn", text: "◀", title: t("Move left"),
          disabled: index === 0 || undefined,
          onclick: () => this.move(index, -1),
        }),
        el("button", {
          class: "mmc-ghost mmc-tl-icon-btn", text: "▶", title: t("Move right"),
          disabled: index === this.timeline.segments.length - 1 || undefined,
          onclick: () => this.move(index, 1),
        }),
        el("button", {
          class: "mmc-ghost mmc-tl-icon-btn", text: "⧉", title: t("Duplicate shot"),
          disabled: this.timeline.segments.length >= S.MAX_SEGMENTS || undefined,
          onclick: () => this.duplicate(index),
        }),
        el("button", {
          class: "mmc-asset-x", text: "✕", title: t("Remove shot"),
          disabled: this.timeline.segments.length <= 1 || undefined,
          onclick: () => this.remove(index),
        }),
      ]),
    ]);
  }

  add() {
    if (this.timeline.segments.length >= S.MAX_SEGMENTS) return;
    this.timeline.segments.push(S.emptySegment());
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

    const single = S.isSingle(this.timeline);
    const modal = el("div", { class: "mmc-modal mmc-tl-editor" }, [
      el("div", { class: "mmc-modal-head" }, [
        el("span", { class: "mmc-tab", "aria-selected": "true",
                     text: t(single ? "Shot {n}" : "Segment {n}", { n: index + 1 }) }),
        el("span", { class: "mmc-tl-editor-sub",
                     text: t("of {count}", { count: this.timeline.segments.length }) }),
        el("button", { class: "mmc-close", text: "✕", title: t("Back to timeline"), onclick: () => done() }),
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
    const events = ["mmc_segment", "mmc_segment_cached", "execution_start", "executed", "execution_error"];
    for (const name of events) api.addEventListener(name, this.onApiEvent);

    loadCatalog(() => this.adoptWeights());
    this.render();
  }

  destroy() {
    const events = ["mmc_segment", "mmc_segment_cached", "execution_start", "executed", "execution_error"];
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
    } else if (type === "mmc_segment_cached") {
      if (this.ours(detail.node)) {
        const segIdx = (detail.segment_index ?? 1) - 1;
        const segment = (this.timeline.segments || [])[segIdx];
        if (segment) {
          segment.cached_video = detail.cached_video;
          this.commit();
        }
      }
    } else if (type === "execution_start") {
      this.activeSegment = null;
      this.render();
    } else if (type === "executed") {
      if (String(detail.display_node) === String(this.getId() ?? "")) {
        this.activeSegment = null;
        const allCached = detail.output?.mmc_segment_cached || [];
        for (const item of allCached) {
          const idx = (item.index ?? 1) - 1;
          const seg = (this.timeline.segments || [])[idx];
          if (seg && item.cached_video) {
            seg.cached_video = item.cached_video;
          }
        }
        this.commit();
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
    const segments = this.timeline.segments || [];
    const single = S.isSingle(this.timeline);
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

    const words = prompt ? prompt.split(/\s+/).filter(Boolean).length : 0;
    const chars = prompt.length;

    const laneWaveCanvas = el("canvas", { class: "mmc-tl-lane-wave" });
    drawTimelineWaveform(laneWaveCanvas, segments);

    const ticks = segments.map((segment, index) => {
      const continues = !single && S.continues(segment);
      const isGenerating = (index + 1) === this.activeSegment;
      const isLocked = S.isLocked(segment);
      const { at } = S.cutTimes(this.timeline);

      // Find thumbnail source
      const firstFrame = S.frameAsset(segment, "first_frame");
      const lastFrame = S.frameAsset(segment, "last_frame");
      const refImg = S.refImages(segment)[0];
      const thumbPath = segment.cached_video || firstFrame?.filename || lastFrame?.filename || refImg?.filename;

      const thumbEl = thumbPath
        ? (segment.cached_video
            ? el("video", {
                class: "mmc-tl-tick-thumb", muted: true, playsinline: true, preload: "metadata",
                src: `${viewUrl(segment.cached_video)}#t=0.1`,
              })
            : el("img", { class: "mmc-tl-tick-thumb", src: viewUrl(thumbPath, { preview: true }), alt: "" }))
        : null;

      return el("div", {
        class: `mmc-tl-tick${continues ? " on" : ""}${isGenerating ? " generating" : ""}${isLocked ? " locked" : ""}${thumbEl ? " has-thumb" : ""}`,
        style: { flexGrow: String(Math.max(1, segment.duration_s || 6)) },
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
        thumbEl,
        el("div", { class: "mmc-tl-tick-overlay" }, [
          el("div", { class: "mmc-tl-tick-top" }, [
            el("span", { class: "mmc-tl-tick-n", text: String(index + 1) }),
            ...(isLocked ? [el("span", { class: "mmc-tl-tick-lock", text: "🔒" })] : []),
            ...(continues ? [icon("link", 11)] : []),
          ]),
          el("span", { class: "mmc-tl-tick-s", text: `${segment.duration_s}s` }),
        ]),
      ]);
    });

    return el("div", { class: "mmc-panel mmc-tl-summary" }, [
      el("div", { class: "mmc-tl-summary-header" }, [
        el("span", { class: "mmc-tl-summary-label", text: t("Global Prompt") }),
        el("span", { style: { flex: "1" } }),
        el("span", { class: "mmc-prompt-wordcount", text: words ? `${words} words · ${chars} chars` : "" }),
      ]),
      el("div", {
        class: `mmc-tl-summary-prompt${prompt ? "" : " empty"}`,
        text: prompt || (single
          ? t("No global prompt yet — the standing description that opens Shot 1.")
          : t("No global prompt yet — the standing description every segment inherits.")),
        onclick: () => this.open(),
      }),
      el("div", { class: "mmc-tl-lane-wrapper" }, [
        laneWaveCanvas,
        el("div", { class: "mmc-tl-lane", onclick: () => this.open() }, ticks),
      ]),
      el("div", { class: "mmc-pills" }, [
        el("span", {
          class: "mmc-pill mmc-pill-static",
          title: single
            ? t("One generation: the segments are the shots of a single description, cut times and all.")
            : t("One generation per segment, joined end to end."),
        }, [
          icon("timeline", 16),
          el("span", { text: single ? t("one pass") : t("chained") }),
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
          title: t("References attached to the piece itself."),
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
          title: t("Open the timeline editor"),
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
        ? t("The pre-stage node generates stills for this timeline. Click to remove it.")
        : t("Add a pre-stage image node at this node's left edge."),
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