import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { viewUrl, listAssets } from "./api.js";
import { el, svg, ICONS, icon, mountOverlay, formatTimecode, formatTime } from "./dom.js";
import { CreatorEditor } from "./editor.js";
import { t } from "./i18n.js";
import { openLoras } from "./loras.js";
import { openPicker } from "./picker.js";
import { openSettings } from "./settings.js";
import { openTrim, trimLabel } from "./trim.js";
import { openAspectPopover, openResolutionPopover, openChoicePopover, stepperPill, aspectGlyph, PILL_GLYPH } from "./pills.js";
import { PromptBox } from "./prompt.js";
import { refine, refineButton, chosenModel as refineModel } from "./refine.js";
import { samplingBar } from "./sampling.js";
import { Stage } from "./stage.js";
import { weightsPill, loadCatalog, catalogFiles } from "./models.js";
import * as Turbo from "./turbo.js";
import * as S from "./state.js";
import { setupDragAndDrop } from "./media_drop.js";
import { drawTimelineWaveform } from "./waveform.js";
import {
  FPS, framesForSeconds, secondsForFrames, resolveCanvas, ASPECT_PRESETS, describeRatio, isTrainedLength,
} from "./canvas.js";

const TRANSITION_PRESETS = [
  {
    id: "match_1s",
    name: "Match Cut (1.0s Blend)",
    apply: (seg) => { seg.continue = true; seg.feather = 22; seg.continue_audio = true; },
  },
  {
    id: "blend_1.6s",
    name: "Long Cross-Blend (1.6s)",
    apply: (seg) => { seg.continue = true; seg.feather = 39; seg.continue_audio = true; },
  },
  {
    id: "hard_audio",
    name: "Hard Cut + Sound Carryover",
    apply: (seg) => { seg.continue = false; seg.continue_audio = true; delete seg.feather; },
  },
  {
    id: "hard_scene",
    name: "Hard Scene Cut (Reset)",
    apply: (seg) => { seg.continue = false; seg.continue_audio = false; delete seg.feather; },
  },
];

export class TimelineBody {
  constructor({ read, write, widgets = {}, onWidgetChange, nodeId, preStage = null }) {
    this.read = read;
    this.write = write;
    this.widgets = widgets;
    this.onWidgetChange = onWidgetChange;
    this.nodeId = nodeId;
    this.preStage = preStage;

    this.currentTime = 0;
    this.isPlaying = false;
    this.playbackRaf = null;
    this.lastTime = 0;
    this.markIn = null;
    this.markOut = null;
    this.zoomScale = 1.0;
    this.activeSegment = null;
    this.isMuted = false;
    this.aiSeamMode = "auto";

    // Dual-Deck A/B Controller state
    this.activeDeckName = "A";
    this.deckA = null;
    this.deckB = null;
    this.currentShotIndex = -1;

    this.timeline = S.parseTimeline(read());

    this.promptBox = new PromptBox({
      getState: () => ({
        prompt: this.timeline.prompt || "",
        assets: this.timeline.assets || [],
      }),
      onInput: (text) => {
        this.timeline.prompt = text;
        this.write(S.serializeTimeline(this.timeline));
      },
      onAttach: (row) => this.attachPoolFromMention(row),
      attachBlocked: () => null,
      getPool: () => this.timeline.assets || [],
    });

    this.promptBox.setValue(this.timeline.prompt || "");

    this.stage = new Stage({
      nodeId,
      segmentLabel: (index) => t("Segment {n} of {count}", { n: index, count: this.timeline.segments.length }),
      onGallery: () => this.openGallery(),
    });

    this.root = el("div", { class: "mmc-root mmc-nle-studio" });
    setupDragAndDrop(this.root, this);

    this.onApiEvent = (event) => this.handleApiEvent(event.type, event.detail);
    const events = ["mmc_segment", "mmc_segment_cached", "execution_start", "executed", "execution_error"];
    for (const name of events) api.addEventListener(name, this.onApiEvent);

    loadCatalog(() => this.adoptWeights());
    this.restoreLocalCache();
    this.render();
  }

  destroy() {
    this.pause();
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

  saveLocalCache() {
    const id = this.getId();
    if (!id) return;
    const cacheMap = {};
    for (let i = 0; i < (this.timeline.segments || []).length; i++) {
      const seg = this.timeline.segments[i];
      if (seg?.cached_video) {
        cacheMap[i] = {
          cached_video: seg.cached_video,
          locked: seg.locked === true,
        };
      }
    }
    try { localStorage.setItem(`mmc-timeline-cache-${id}`, JSON.stringify(cacheMap)); } catch {}
  }

  restoreLocalCache() {
    const id = this.getId();
    if (!id) return;
    try {
      const raw = localStorage.getItem(`mmc-timeline-cache-${id}`);
      if (!raw) return;
      const cacheMap = JSON.parse(raw);
      let changed = false;
      for (const [idxStr, item] of Object.entries(cacheMap)) {
        const idx = Number(idxStr);
        const seg = (this.timeline.segments || [])[idx];
        if (seg && item?.cached_video) {
          if (seg.cached_video !== item.cached_video || seg.locked !== item.locked) {
            seg.cached_video = item.cached_video;
            seg.locked = item.locked;
            changed = true;
          }
        }
      }
      if (changed) this.write(S.serializeTimeline(this.timeline));
    } catch {}
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
          this.saveLocalCache();
          this.commit();
        }
      }
    } else if (type === "execution_start") {
      this.activeSegment = null;
      this.render();
    } else if (type === "executed") {
      if (String(detail.display_node) === String(this.getId() ?? "") || this.ours(detail.node)) {
        this.activeSegment = null;
        const allCached = detail.output?.mmc_segment_cached || [];
        for (const item of allCached) {
          const idx = (item.index ?? 1) - 1;
          const seg = (this.timeline.segments || [])[idx];
          if (seg && item.cached_video) seg.cached_video = item.cached_video;
        }
        this.saveLocalCache();
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
    this.restoreLocalCache();
    if (this.promptBox) {
      this.promptBox.setValue(this.timeline.prompt || "");
    }
    this.render();
  }

  commit() {
    S.syncTimeline(this.timeline);
    Turbo.sync(this.timeline, this.widgetIO());
    this.saveLocalCache();
    this.write(S.serializeTimeline(this.timeline));
    this.render();
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

  /**
   * Effective duration of a segment in seconds, accurately subtracting
   * the inherited motion blend frames (feathering) trimmed from rendered video.
   */
  getEffectiveDuration(seg, index) {
    const rawFrames = framesForSeconds(seg?.duration_s || 6);
    const isChained = !S.isSingle(this.timeline);
    const overlap = (isChained && index > 0 && S.continues(seg) && S.feather(seg) > 1)
      ? S.feather(seg)
      : 0;
    const effectiveFrames = Math.max(1, rawFrames - overlap);
    return effectiveFrames / FPS;
  }

  // --- Smooth Multi-Segment Gapless Player ---
  play() {
    if (!this.deckA || !this.deckB) return;
    this.isPlaying = true;
    this.lastTime = performance.now();
    this.updatePlayBtnIcon();

    this.syncDualDecks(this.currentTime, true);

    const activeDeck = this.activeDeckName === "A" ? this.deckA : this.deckB;
    if (activeDeck && activeDeck.src) {
      activeDeck.muted = this.isMuted;
      activeDeck.play().catch(() => {});
    }

    const tick = (now) => {
      if (!this.isPlaying) return;
      const dt = (now - this.lastTime) / 1000;
      this.lastTime = now;

      const totalDur = S.timelineSeconds(this.timeline);
      let nextTime = this.currentTime + dt;

      const loopEnd = this.markOut !== null ? this.markOut : totalDur;
      const loopStart = this.markIn !== null ? this.markIn : 0;

      // Handle Loop Boundary smoothly without 1s stall
      if (nextTime >= loopEnd - 0.02) {
        nextTime = loopStart;
        this.seek(nextTime, true);
        const curDeck = this.activeDeckName === "A" ? this.deckA : this.deckB;
        if (curDeck && curDeck.src && this.isPlaying) {
          curDeck.muted = this.isMuted;
          curDeck.play().catch(() => {});
        }
      } else {
        const prevShotIdx = this.getActiveShotInfo(this.currentTime).index;
        const nextShotIdx = this.getActiveShotInfo(nextTime).index;

        this.currentTime = nextTime;
        this.updatePlayheadPosition();
        this.updateHUD();

        // Cross cut boundary: swap decks seamlessly
        if (prevShotIdx !== nextShotIdx) {
          this.syncDualDecks(this.currentTime, true);
        }
      }

      this.playbackRaf = requestAnimationFrame(tick);
    };

    this.playbackRaf = requestAnimationFrame(tick);
  }

  pause() {
    this.isPlaying = false;
    if (this.playbackRaf) cancelAnimationFrame(this.playbackRaf);
    this.playbackRaf = null;

    if (this.deckA) { try { this.deckA.pause(); } catch {} }
    if (this.deckB) { try { this.deckB.pause(); } catch {} }

    this.updatePlayBtnIcon();
  }

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  updatePlayBtnIcon() {
    if (!this.playBtn) return;
    this.playBtn.replaceChildren(svg(this.isPlaying ? ICONS.pause : ICONS.play, 15));
  }

  seek(seconds, updatePlayer = true) {
    const total = S.timelineSeconds(this.timeline);
    this.currentTime = Math.max(0, Math.min(seconds, total));
    this.updatePlayheadPosition();
    this.updateHUD();
    if (updatePlayer) this.syncDualDecks(this.currentTime, this.isPlaying);
  }

  stepFrame(delta) {
    this.pause();
    this.seek(this.currentTime + (delta / FPS));
  }

  getActiveShotInfo(time = this.currentTime) {
    const segments = this.timeline.segments || [];
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const dur = this.getEffectiveDuration(seg, i);
      if (time >= acc && (time < acc + dur || i === segments.length - 1)) {
        return {
          segment: seg,
          index: i,
          localTime: Math.min(dur, Math.max(0, time - acc)),
          shotStart: acc,
          shotEnd: acc + dur,
          effectiveDuration: dur,
        };
      }
      acc += dur;
    }
    const lastIdx = Math.max(0, segments.length - 1);
    const lastDur = this.getEffectiveDuration(segments[lastIdx], lastIdx);
    return {
      segment: segments[lastIdx],
      index: lastIdx,
      localTime: 0,
      shotStart: acc,
      shotEnd: acc + lastDur,
      effectiveDuration: lastDur,
    };
  }

  syncDualDecks(time = this.currentTime, startPlayback = false) {
    if (!this.deckA || !this.deckB) return;
    const { segment, index, localTime } = this.getActiveShotInfo(time);
    const segments = this.timeline.segments || [];

    let activeDeck = this.activeDeckName === "A" ? this.deckA : this.deckB;
    let standbyDeck = this.activeDeckName === "A" ? this.deckB : this.deckA;

    if (this.currentShotIndex !== index) {
      this.currentShotIndex = index;

      this.activeDeckName = this.activeDeckName === "A" ? "B" : "A";
      const temp = activeDeck;
      activeDeck = standbyDeck;
      standbyDeck = temp;

      activeDeck.classList.add("active-deck");
      standbyDeck.classList.remove("active-deck");
      try { standbyDeck.pause(); } catch {}
    }

    const currentVideo = segment?.cached_video;
    if (currentVideo) {
      const activeUrl = viewUrl(currentVideo);
      if (activeDeck.src !== activeUrl) {
        activeDeck.src = activeUrl;
      }
      if (Math.abs(activeDeck.currentTime - localTime) > 0.08) {
        activeDeck.currentTime = localTime;
      }
      activeDeck.muted = this.isMuted;
      if (startPlayback && this.isPlaying) {
        activeDeck.play().catch(() => {});
      }
      this.showFallback(false);
    } else {
      activeDeck.classList.remove("active-deck");
      this.showFallback(true, segment, index);
    }

    // Preload next shot into standby deck for 0ms cut
    const nextIdx = (index + 1) < segments.length ? (index + 1) : (this.markIn !== null ? this.getActiveShotInfo(this.markIn).index : 0);
    const nextSeg = segments[nextIdx];
    if (nextSeg?.cached_video) {
      const nextUrl = viewUrl(nextSeg.cached_video);
      if (standbyDeck.src !== nextUrl) {
        standbyDeck.src = nextUrl;
        standbyDeck.currentTime = 0;
        standbyDeck.preload = "auto";
      }
    }
  }

  showFallback(show, segment = null, index = 0) {
    if (!this.fallbackContainer) return;
    if (!show) {
      this.fallbackContainer.style.display = "none";
      return;
    }
    this.fallbackContainer.style.display = "flex";

    const firstFrame = S.frameAsset(segment || {}, "first_frame");
    const lastFrame = S.frameAsset(segment || {}, "last_frame");
    const refImg = S.refImages(segment || {})[0];
    const thumbPath = firstFrame?.filename || lastFrame?.filename || refImg?.filename;

    if (thumbPath) {
      this.fallbackContainer.replaceChildren(
        el("img", { class: "mmc-nle-fallback-img", src: viewUrl(thumbPath, { preview: true }) })
      );
    } else {
      this.fallbackContainer.replaceChildren(
        el("span", { class: "mmc-nle-fallback-txt", text: `Shot ${index + 1} (Unrendered)` })
      );
    }
  }

  attachPoolFromMention(row) {
    const entry = {
      handle: S.nextPoolHandle(this.timeline),
      kind: row.kind, role: "reference", filename: row.path, ref_size: "max",
    };
    if (row.kind === "video") entry.track = row.track ?? S.DEFAULT_TRACK;
    if (row.trim) entry.trim = row.trim;
    this.timeline.assets = this.timeline.assets || [];
    this.timeline.assets.push(entry);
    this.commit();
    return entry.handle;
  }

  async addGlobalReference() {
    const chosen = await openPicker({
      kinds: ["image", "video", "audio", "renders"],
      kind: "image",
      capacity: () => ({ used: 0, max: S.MAX_REF_FILES, filesLeft: S.MAX_REF_FILES }),
    });
    if (!chosen) return;
    for (const picked of chosen) {
      this.attachPoolFromMention(picked);
    }
  }

  async openGallery() {
    const chosen = await openPicker({
      kinds: ["renders", "image", "video", "audio"],
      kind: "renders",
      capacity: () => ({ used: 0, max: S.MAX_REF_FILES, filesLeft: S.MAX_REF_FILES }),
    });
    if (!chosen) return;
    for (const picked of chosen) {
      this.attachPoolFromMention(picked);
    }
  }

  async editPieceSegment(asset) {
    const result = await openTrim({
      path: asset.filename,
      kind: asset.kind,
      trim: asset.trim ?? null,
      track: asset.track,
      showTrack: asset.kind === "video",
    });
    if (!result) return;
    if (result.trim) asset.trim = result.trim;
    else delete asset.trim;
    if (result.track) asset.track = result.track;
    this.commit();
  }

  razorSplitAtPlayhead() {
    const { segment, index, localTime } = this.getActiveShotInfo();
    const curDur = Number(segment.duration_s) || 6;
    if (localTime < 1.0 || curDur - localTime < 1.0) return;

    const split1Dur = Math.max(1, Math.round(localTime));
    const split2Dur = Math.max(1, Math.round(curDur - localTime));

    segment.duration_s = split1Dur;
    const newSeg = S.cloneSegment(segment);
    newSeg.duration_s = split2Dur;
    newSeg.continue = true;
    newSeg.continue_audio = true;
    newSeg.locked = false;
    newSeg.cached_video = null;

    this.timeline.segments.splice(index + 1, 0, newSeg);
    this.commit();
  }

  editShot(index) {
    this.pause();
    const segment = this.timeline.segments[index];
    const editor = new CreatorEditor({
      state: segment,
      onCommit: () => {
        this.saveLocalCache();
        this.write(S.serializeTimeline(this.timeline));
        this.render();
      },
      canvasPills: false,
      routeOf: () => this.timeline.models?.route ?? "auto",
      continuePill: index > 0 && !S.isSingle(this.timeline),
      refineTarget: () => ({
        kind: "segment",
        index,
        data: JSON.parse(S.serializeTimeline(this.timeline)),
      }),
    });

    const modal = el("div", { class: "mmc-modal mmc-tl-editor" }, [
      el("div", { class: "mmc-modal-head" }, [
        el("span", { class: "mmc-tab", "aria-selected": "true", text: t("Shot {n} Context Editor", { n: index + 1 }) }),
        el("span", { class: "mmc-tl-editor-sub", text: t("of {count} shots", { count: this.timeline.segments.length }) }),
        el("button", { class: "mmc-close", text: "✕", title: t("Done"), onclick: () => unmount() }),
      ]),
      el("div", { class: "mmc-tl-editor-body" }, [editor.root]),
    ]);

    const overlay = el("div", {
      class: "mmc-overlay",
      onpointerdown: (e) => { if (e.target === overlay) unmount(); },
    }, [modal]);

    const unmount = mountOverlay(overlay, () => {
      this.commit();
    });
  }

  revertAll() {
    this.timeline.refined = null;
    for (const segment of this.timeline.segments || []) {
      segment.refined = null;
      segment.soundscape = "";
      segment.music = "";
    }
    this.commit();
  }

  clearAllCache() {
    const id = this.getId();
    if (id) {
      try { localStorage.removeItem(`mmc-timeline-cache-${id}`); } catch {}
    }
    for (const segment of this.timeline.segments || []) {
      segment.cached_video = null;
      segment.locked = false;
    }
    this.commit();
  }

  downloadCurrentVideo() {
    const { segment } = this.getActiveShotInfo();
    const activeDeck = this.activeDeckName === "A" ? this.deckA : this.deckB;
    const videoUrl = segment?.cached_video ? viewUrl(segment.cached_video) : (activeDeck?.src || null);
    if (!videoUrl) return;

    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = `minimax_render_${Date.now()}.mp4`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  render() {
    this.root.replaceChildren(
      this.renderTopBar(),
      this.renderSplitBody(),
      this.renderTimelineTracks(),
      this.renderTransportToolbar(),
      this.renderSamplingDeck()
    );
    this.updatePlayheadPosition();
    this.updateHUD();
  }

  // Top Director Control Bar
  renderTopBar() {
    const activeLorasCount = S.activeGlobalLoras(this.timeline).length;
    const ratioVal = ASPECT_PRESETS.find(([l]) => l === this.timeline.aspect)?.[1] ?? 16 / 9;
    const [width, height] = resolveCanvas(ratioVal, this.timeline.short_edge || 768);

    const hasRefined = Boolean(
      this.timeline.refined || (this.timeline.segments || []).some((s) => s.refined?.body)
    );

    const hasCached = (this.timeline.segments || []).some((s) => s.cached_video);

    const cleanCacheBtn = hasCached ? el("button", {
      class: "mmc-nle-btn",
      title: t("Clear all cached videos and unlocked states"),
      onclick: () => this.clearAllCache(),
    }, [icon("broom", 14), el("span", { text: t("Clean Cache") })]) : null;

    const settingsBtn = el("button", {
      class: "mmc-nle-btn",
      title: t("Preferences for this ComfyUI — output quality. Not saved into the workflow."),
      onclick: () => openSettings(),
    }, [icon("gear", 14), el("span", { text: t("Settings") })]);

    const galleryBtn = el("button", {
      class: "mmc-nle-btn",
      title: t("Browse finished renders and stills"),
      onclick: () => this.openGallery(),
    }, [icon("gallery", 14), el("span", { text: t("Gallery") })]);

    const previewBtn = el("button", {
      class: `mmc-nle-btn${this.stage?.showing() ? " active" : ""}`,
      title: t("Toggle satellite preview window"),
      onclick: () => {
        this.stage?.toggleOpen();
        this.render();
      },
    }, [icon("play", 14), el("span", { text: t("Preview") })]);

    const seamModeBtn = el("button", {
      class: `mmc-nle-btn${this.aiSeamMode === "auto" ? " active" : ""}`,
      title: this.aiSeamMode === "auto"
        ? t("AI Auto-Seams (Active): AI refiner automatically infers match-cuts & continuity and sets timeline seams.")
        : t("User Seams: Your manually set cuts are preserved and sent as context to the AI."),
      onclick: () => {
        this.aiSeamMode = this.aiSeamMode === "auto" ? "context" : "auto";
        this.render();
      },
    }, [svg(ICONS.scissors, 13), el("span", { text: this.aiSeamMode === "auto" ? t("AI Seams: Auto") : t("AI Seams: User") })]);

    const revertAllBtn = hasRefined ? el("button", {
      class: "mmc-nle-btn",
      style: { color: "var(--mmc-dim)" },
      title: t("Revert all AI rewrites across global and segment prompts"),
      onclick: () => this.revertAll(),
    }, [el("span", { text: t("Revert All") })]) : null;

    return el("div", { class: "mmc-nle-top-bar" }, [
      el("div", { class: "mmc-nle-top-left" }, [
        el("span", { class: "mmc-nle-tag", text: "STUDIO" }),
        el("button", {
          class: "mmc-pill",
          title: t("Aspect ratio selector"),
          onclick: (e) => openAspectPopover(e.currentTarget, this.timeline, () => this.commit()),
        }, [aspectGlyph(ratioVal, PILL_GLYPH), el("span", { text: this.timeline.aspect })]),
        el("button", {
          class: "mmc-pill",
          title: t("Short edge resolution & two-pass refine options"),
          onclick: (e) => openResolutionPopover(e.currentTarget, this.timeline, () => {
            const [w, h] = resolveCanvas(ratioVal, this.timeline.short_edge || 768);
            return { width: w, height: h };
          }, () => this.commit()),
        }, [icon("res", 15), el("span", { text: `${this.timeline.short_edge || 768}p` }), el("span", { class: "mmc-pill-sub", text: `${width}×${height}` })]),
        el("button", {
          class: `mmc-pill${activeLorasCount ? " on" : ""}`,
          onclick: () => openLoras({ state: this.timeline, targets: S.timelineCheckpoints(this.timeline), onChange: () => this.commit() }),
        }, [icon("effect", 15), el("span", { text: t(activeLorasCount ? "{n} LoRAs" : "LoRAs", { n: activeLorasCount }) })]),
        seamModeBtn,
        cleanCacheBtn,
        galleryBtn,
        previewBtn,
        settingsBtn,
      ]),
      el("div", { class: "mmc-nle-top-right" }, [
        revertAllBtn,
        refineButton({
          run: () => this.refineAll(),
          label: t("Refine All"),
          className: "mmc-pill",
        }),
        el("button", {
          class: "mmc-nle-btn primary",
          text: t("▶ GENERATE"),
          onclick: () => { try { app.queuePrompt(0); } catch {} },
        }),
      ]),
    ]);
  }

  // Split Studio Body (Left: Master Prompt & Piece Bible | Right: Cinema Player)
  renderSplitBody() {
    const leftDeck = el("div", { class: "mmc-nle-left-deck" }, [
      el("div", { class: "mmc-nle-prompt-wrap" }, [
        el("span", { class: "mmc-nle-tag", text: t("GLOBAL SCENE & STYLE PROMPT") }),
        this.promptBox.root,
      ]),
      this.renderPieceBible(),
    ]);

    const rightMonitor = this.renderCinemaMonitor();

    return el("div", { class: "mmc-nle-split-body" }, [leftDeck, rightMonitor]);
  }

  renderPieceBible() {
    const TRACK_CHIP = {
      "picture+sound": { text: "sound on", next: "picture" },
      "picture": { text: "sound off", next: "picture+sound" },
      "sound": { text: "sound only", next: "picture+sound" },
    };

    const pieceChips = (this.timeline.assets || []).map((asset) => {
      const thumb = asset.kind === "image"
        ? el("img", { class: "mmc-asset-thumb", src: viewUrl(asset.filename, { preview: true }), alt: "" })
        : el("span", { class: "mmc-asset-thumb" }, [svg(ICONS[asset.kind] || ICONS.video, 14)]);

      const parts = [
        thumb,
        el("span", { class: "mmc-asset-handle", text: `@${asset.handle}` }),
      ];

      if (asset.kind !== "image") {
        parts.push(el("button", {
          class: "mmc-ghost",
          style: { fontSize: "11px" },
          title: t("Trim reference clip segment"),
          text: trimLabel(asset),
          onclick: () => this.editPieceSegment(asset),
        }));
      }

      if (asset.kind === "video") {
        const chip = TRACK_CHIP[asset.track] || TRACK_CHIP[S.DEFAULT_TRACK];
        parts.push(el("button", {
          class: "mmc-ghost",
          style: { fontSize: "11px" },
          text: t(chip.text),
          onclick: () => {
            asset.track = chip.next;
            this.commit();
          },
        }));
      }

      if (S.takeable(asset)) {
        const take = S.takes(asset);
        parts.push(el("button", {
          class: "mmc-ghost",
          style: { fontSize: "11px" },
          title: t("What of this picture is the reference (full, person, object, scene, style)"),
          text: t(take),
          onclick: () => {
            asset.takes = S.TAKES[(S.TAKES.indexOf(take) + 1) % S.TAKES.length];
            this.commit();
          },
        }));
      }

      if (S.sizeable(asset)) {
        const size = S.refSize(asset);
        parts.push(el("button", {
          class: "mmc-ghost",
          style: { fontSize: "11px" },
          text: t(size),
          onclick: () => {
            asset.ref_size = size === "max" ? "match" : "max";
            this.commit();
          },
        }));
      }

      parts.push(el("button", {
        class: "mmc-asset-x", text: "✕",
        onclick: () => {
          this.timeline.assets = this.timeline.assets.filter((a) => a !== asset);
          this.commit();
        },
      }));

      return el("div", {
        class: `mmc-asset mmc-tag-${S.tagIndex(asset.handle)}`,
        title: asset.filename,
      }, parts);
    });

    return el("div", { class: "mmc-nle-piece-bible" }, [
      el("div", { class: "mmc-nle-bible-head" }, [
        el("span", { class: "mmc-nle-tag", text: t("GLOBAL PIECE BIBLE (CAST & REFS)") }),
        el("button", {
          class: "mmc-nle-btn",
          text: "+ Ref",
          title: t("Attach piece reference for characters, locations, or style"),
          onclick: () => this.addGlobalReference(),
        }),
      ]),
      el("div", { class: "mmc-nle-bible-chips" }, pieceChips),
    ]);
  }

  async refineAll() {
    try {
      const payloadData = JSON.parse(S.serializeTimeline(this.timeline));
      payloadData.ai_seam_mode = this.aiSeamMode;

      const result = await refine({ kind: "timeline", data: payloadData });

      if (result.shots) {
        for (const shot of result.shots) {
          const seg = this.timeline.segments[shot.index];
          if (seg && shot.body) {
            seg.refined = {
              body: shot.body,
              scope: "shot",
              source: seg.prompt || "",
              model: refineModel(),
              enabled: true,
            };
            if (shot.soundscape) seg.soundscape = shot.soundscape;
            if (shot.music) seg.music = shot.music;
            if (this.aiSeamMode === "auto" && shot.auto_seam) {
              seg.continue = shot.auto_seam.continue === true;
              seg.continue_audio = shot.auto_seam.continue_audio === true;
              if (shot.auto_seam.feather) seg.feather = shot.auto_seam.feather;
            }
          }
        }
      }

      if (result.piece) {
        this.timeline.prompt = result.piece;
        this.promptBox.setValue(result.piece);
      }

      this.commit();
    } catch (e) {
      console.error(e);
    }
  }

  // Cinema Monitor Player with Dual-Deck A/B Layering
  renderCinemaMonitor() {
    this.monitorHUDLeft = el("div", { class: "mmc-nle-hud-left" });
    this.monitorHUDRight = el("div", { class: "mmc-nle-hud-right" });

    this.deckA = el("video", { class: "mmc-nle-monitor-video deck-a", playsinline: true, preload: "auto" });
    this.deckB = el("video", { class: "mmc-nle-monitor-video deck-b", playsinline: true, preload: "auto" });

    this.deckA.muted = this.isMuted;
    this.deckB.muted = this.isMuted;

    this.fallbackContainer = el("div", { class: "mmc-nle-monitor-fallback" });

    this.monitorWrap = el("div", { class: "mmc-nle-monitor-wrap" }, [
      el("div", { class: "mmc-nle-hud" }, [this.monitorHUDLeft, this.monitorHUDRight]),
      this.deckA,
      this.deckB,
      this.fallbackContainer,
      el("div", { class: "mmc-nle-monitor-tools" }, [
        el("button", {
          class: "mmc-nle-overlay-btn",
          title: t("Download current video (.mp4) directly"),
          onclick: () => this.downloadCurrentVideo(),
        }, [svg(ICONS.download, 13), el("span", { text: t("Download") })]),
        el("button", {
          class: "mmc-nle-overlay-btn",
          title: t("Grab current frame as reference still"),
          onclick: () => this.grabCurrentMonitorFrame(),
        }, [svg(ICONS.camera, 13), el("span", { text: t("Grab") })]),
        el("button", {
          class: `mmc-nle-overlay-btn${this.markIn !== null ? " active" : ""}`,
          title: t("Loop playback inside Mark In/Out bounds"),
          onclick: () => this.toggleLoop(),
        }, [svg(ICONS.loop, 13), el("span", { text: t("Loop") })]),
        el("button", {
          class: `mmc-nle-overlay-btn${this.isMuted ? " active" : ""}`,
          title: t("Toggle audio mute"),
          onclick: () => {
            this.isMuted = !this.isMuted;
            if (this.deckA) this.deckA.muted = this.isMuted;
            if (this.deckB) this.deckB.muted = this.isMuted;
            this.render();
          },
        }, [svg(this.isMuted ? ICONS.volumeMute : ICONS.volume, 13)]),
      ]),
    ]);

    this.syncDualDecks(this.currentTime, false);
    return this.monitorWrap;
  }

  updateHUD() {
    const { segment, index, effectiveDuration } = this.getActiveShotInfo();
    const tc = formatTimecode(this.currentTime, FPS);
    const isLocked = S.isLocked(segment);

    if (this.monitorHUDLeft) {
      this.monitorHUDLeft.replaceChildren(
        el("span", { class: "mmc-nle-hud-chip accent", text: t("Shot {n}/{total}", { n: index + 1, total: this.timeline.segments.length }) }),
        el("span", { class: "mmc-nle-hud-chip", text: S.mode(segment) }),
        el("span", { class: `mmc-nle-hud-chip ${isLocked ? "cache-ready" : ""}`, text: isLocked ? "🔒 Cached" : "Sampling" })
      );
    }
    if (this.monitorHUDRight) {
      this.monitorHUDRight.replaceChildren(
        el("span", { class: "mmc-nle-hud-chip", text: `${this.timeline.aspect}` }),
        el("span", { class: "mmc-nle-hud-chip accent", text: tc.display })
      );
    }
    if (this.timecodeDisplay) {
      this.timecodeDisplay.textContent = tc.display;
    }
  }

  async grabCurrentMonitorFrame() {
    const activeDeck = this.activeDeckName === "A" ? this.deckA : this.deckB;
    if (!activeDeck?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = activeDeck.videoWidth;
    canvas.height = activeDeck.videoHeight;
    canvas.getContext("2d").drawImage(activeDeck, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `frame_tc_${this.currentTime.toFixed(2)}.png`, { type: "image/png" });
        this.attachPoolFromMention({ path: `prestage_frames/${file.name}`, kind: "image" });
      }
    }, "image/png");
  }

  toggleLoop() {
    if (this.markIn === null || this.markOut === null) {
      this.markIn = 0;
      this.markOut = S.timelineSeconds(this.timeline);
    } else {
      this.markIn = null;
      this.markOut = null;
    }
    this.render();
  }

  // 5-Lane NLE Timeline Tracks
  renderTimelineTracks() {
    if (!this.tracksContainer) {
      this.tracksContainer = el("div", { class: "mmc-nle-tracks-container" });
    }
    this.updateTimelineTracks();
    return this.tracksContainer;
  }

  updateTimelineTracks() {
    if (!this.tracksContainer) return;
    const totalDuration = S.timelineSeconds(this.timeline);
    const segments = this.timeline.segments || [];
    const pxPerSec = 45 * this.zoomScale;
    const contentWidth = Math.max(700, Math.round(totalDuration * pxPerSec) + 140);

    this.rulerCanvas = el("canvas", { class: "mmc-nle-ruler-canvas", style: { width: `${contentWidth}px` } });
    this.drawRuler(this.rulerCanvas, totalDuration, contentWidth);

    this.rulerWrap = el("div", {
      class: "mmc-nle-ruler-wrap",
      onpointerdown: (e) => this.handleRulerPointer(e),
    }, [this.rulerCanvas]);

    // Lane 1: Prompt Track (Shows Refined Prompt or Manual Prompt)
    const promptTrack = el("div", { class: "mmc-nle-track mmc-nle-track-prompt" });
    let accP = 0;
    segments.forEach((seg, idx) => {
      const dur = this.getEffectiveDuration(seg, idx);
      const leftPx = accP * pxPerSec;
      const widthPx = dur * pxPerSec;

      const refinedText = S.refinedBody(seg);
      const activePrompt = refinedText || seg.prompt || "...";
      const isRefined = Boolean(refinedText);

      const pClip = el("div", {
        class: `mmc-nle-prompt-clip${isRefined ? " is-refined" : ""}`,
        style: { left: `${leftPx}px`, width: `${widthPx - 3}px` },
        title: isRefined ? `Shot ${idx + 1} (Refined): ${activePrompt}` : `Shot ${idx + 1}: ${activePrompt}`,
        onclick: () => this.seek(accP),
        ondblclick: () => this.editShot(idx),
      }, [
        el("span", { style: { fontWeight: "700" }, text: `Shot ${idx + 1}:` }),
        ...(isRefined ? [el("span", { class: "mmc-nle-prompt-badge", text: "AI" })] : []),
        el("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, text: activePrompt }),
      ]);
      promptTrack.appendChild(pClip);
      accP += dur;
    });

    // Lane 2: Video Filmstrip & Seams Track
    const videoTrack = el("div", { class: "mmc-nle-track mmc-nle-track-video" });
    let accV = 0;
    segments.forEach((seg, idx) => {
      const dur = this.getEffectiveDuration(seg, idx);
      const leftPx = accV * pxPerSec;
      const widthPx = dur * pxPerSec;
      const isLocked = S.isLocked(seg);

      const framesCount = Math.max(1, Math.floor(widthPx / 60));
      const filmstripFrames = [];
      if (seg.cached_video) {
        for (let f = 0; f < framesCount; f++) {
          const tSec = (f / framesCount) * dur;
          const vid = el("video", {
            class: "mmc-nle-filmstrip-frame",
            muted: true, playsinline: true, preload: "metadata",
            src: `${viewUrl(seg.cached_video)}#t=${tSec.toFixed(1)}`,
          });
          filmstripFrames.push(vid);
        }
      }

      const vClip = el("div", {
        class: `mmc-nle-video-clip${isLocked ? " locked" : ""}`,
        style: { left: `${leftPx}px`, width: `${widthPx - 3}px` },
        ondblclick: () => this.editShot(idx),
      }, [
        el("div", { class: "mmc-nle-filmstrip-row" }, filmstripFrames),
        el("div", {
          class: "mmc-nle-trim-handle left",
          title: t("Drag to trim start"),
          onpointerdown: (e) => this.startTrimDrag(e, idx, "left", pxPerSec),
        }),
        el("div", { class: `mmc-nle-clip-hud${idx === 0 ? " first-shot" : ""}` }, [
          el("span", { class: "mmc-nle-clip-title", text: `Shot ${idx + 1} (${dur.toFixed(1)}s)` }),
          el("div", { class: "mmc-nle-clip-actions" }, [
            el("button", { class: "mmc-nle-clip-btn", title: t("Edit shot"), onclick: (e) => { e.stopPropagation(); this.editShot(idx); } }, [svg(ICONS.edit, 11)]),
            el("button", {
              class: `mmc-nle-clip-btn${isLocked ? " locked" : ""}`,
              title: t("Lock segment cache"),
              onclick: (e) => { e.stopPropagation(); seg.locked = !seg.locked; this.commit(); },
            }, [svg(isLocked ? ICONS.lock : ICONS.unlock, 11)]),
            el("button", {
              class: "mmc-nle-clip-btn",
              title: t("Re-roll this shot"),
              onclick: (e) => { e.stopPropagation(); this.reRollSegment(idx); },
            }, [svg(ICONS.dice, 11)]),
            el("button", {
              class: "mmc-nle-clip-btn",
              title: t("Delete shot"),
              onclick: (e) => { e.stopPropagation(); this.deleteSegment(idx); },
            }, [svg(ICONS.trash, 11)]),
          ]),
        ]),
        el("div", {
          class: "mmc-nle-trim-handle right",
          title: t("Drag to trim end"),
          onpointerdown: (e) => this.startTrimDrag(e, idx, "right", pxPerSec),
        }),
      ]);
      videoTrack.appendChild(vClip);

      // Dedicated Vertical Seam Junction
      if (idx > 0) {
        let seamClass = "seam-hard";
        let seamIcon = "✂";
        let seamText = "cut";

        if (seg.continue) {
          if (seg.feather === 39) {
            seamClass = "seam-blend-39";
            seamIcon = "⟿";
            seamText = "39f";
          } else if (seg.feather === 22) {
            seamClass = "seam-blend-22";
            seamIcon = "⟿";
            seamText = "22f";
          } else {
            seamClass = "seam-match";
            seamIcon = "↝";
            seamText = "1f";
          }
        } else if (seg.continue_audio) {
          seamClass = "seam-sound";
          seamIcon = "♫";
          seamText = "sound";
        }

        const seamJunction = el("div", {
          class: "mmc-nle-seam-junction",
          style: { left: `${leftPx}px` },
        }, [
          el("button", {
            class: `mmc-nle-seam-vertical-pill ${seamClass}`,
            title: t("Click to switch transition preset"),
            onclick: (e) => {
              e.stopPropagation();
              this.pickTransitionPreset(e.currentTarget, seg);
            },
          }, [
            el("span", { class: "mmc-seam-icon", text: seamIcon }),
            el("span", { class: "mmc-seam-text", text: seamText }),
          ]),
        ]);
        videoTrack.appendChild(seamJunction);
      }

      accV += dur;
    });

    const addShotBtn = el("button", {
      class: "mmc-nle-add-shot",
      style: { left: `${accV * pxPerSec + 10}px` },
      text: "+ Shot",
      onclick: () => {
        this.timeline.segments.push(S.emptySegment());
        this.commit();
      },
    });
    videoTrack.appendChild(addShotBtn);

    // Lane 3: Audio / Soundscape Track
    const audioTrack = el("div", { class: "mmc-nle-track mmc-nle-track-audio" });
    const waveCanvas = el("canvas", { class: "mmc-nle-audio-canvas", style: { width: `${contentWidth}px` } });
    drawTimelineWaveform(waveCanvas, segments, "rgba(240,166,60,0.45)");
    audioTrack.appendChild(waveCanvas);

    let accA = 0;
    segments.forEach((seg, idx) => {
      const dur = this.getEffectiveDuration(seg, idx);
      if (seg.soundscape?.trim()) {
        const txtBlock = el("div", {
          class: "mmc-nle-lane-text-block",
          style: { left: `${accA * pxPerSec + 4}px`, maxWidth: `${dur * pxPerSec - 8}px` },
          text: `🔊 ${seg.soundscape}`,
        });
        audioTrack.appendChild(txtBlock);
      }
      accA += dur;
    });

    // Lane 4: Non-Diegetic Music Track
    const musicTrack = el("div", { class: "mmc-nle-track mmc-nle-track-music" });
    const musicCanvas = el("canvas", { class: "mmc-nle-music-canvas", style: { width: `${contentWidth}px` } });
    drawTimelineWaveform(musicCanvas, segments, "rgba(47,123,246,0.45)");
    musicTrack.appendChild(musicCanvas);

    let accM = 0;
    segments.forEach((seg, idx) => {
      const dur = this.getEffectiveDuration(seg, idx);
      if (seg.music?.trim()) {
        const musBlock = el("div", {
          class: "mmc-nle-lane-music-block",
          style: { left: `${accM * pxPerSec + 4}px`, maxWidth: `${dur * pxPerSec - 8}px` },
          text: `🎵 ${seg.music}`,
        });
        musicTrack.appendChild(musBlock);
      }
      accM += dur;
    });

    this.playheadNeedle = el("div", { class: "mmc-nle-playhead-needle" }, [
      el("div", { class: "mmc-nle-playhead-head" }),
    ]);

    const timelineContent = el("div", { class: "mmc-nle-timeline-content", style: { width: `${contentWidth}px` } }, [
      this.playheadNeedle,
      promptTrack,
      videoTrack,
      audioTrack,
      musicTrack,
    ]);

    this.tracksViewport = el("div", {
      class: "mmc-nle-tracks-viewport",
      onscroll: () => {
        if (this.rulerWrap && this.tracksViewport) {
          this.rulerCanvas.style.transform = `translateX(-${this.tracksViewport.scrollLeft}px)`;
        }
      },
    }, [timelineContent]);

    this.tracksContainer.replaceChildren(this.rulerWrap, this.tracksViewport);
    this.updatePlayheadPosition();
  }

  pickTransitionPreset(anchor, seg) {
    openChoicePopover(anchor, {
      title: t("Seam Transition Preset"),
      options: TRANSITION_PRESETS.map((p) => p.name),
      value: "",
      onPick: (name) => {
        const found = TRANSITION_PRESETS.find((p) => p.name === name);
        if (found) {
          found.apply(seg);
          this.commit();
        }
      },
    });
  }

  drawRuler(canvas, totalDuration, width) {
    requestAnimationFrame(() => {
      if (!canvas.isConnected) return;
      const h = 22;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(h * ratio);
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, width, h);

      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "9px ui-monospace, Menlo, monospace";

      const pxPerSec = 45 * this.zoomScale;
      for (let s = 0; s <= totalDuration + 5; s += 1) {
        const x = s * pxPerSec;
        ctx.fillRect(x, h - 8, 1, 8);
        ctx.fillText(formatTime(s), x + 3, h - 7);
      }
    });
  }

  handleRulerPointer(e) {
    e.preventDefault();
    const scrollLeft = this.tracksViewport?.scrollLeft || 0;
    const rect = this.rulerWrap.getBoundingClientRect();
    const pxPerSec = 45 * this.zoomScale;

    const update = (ev) => {
      const x = Math.max(0, ev.clientX - rect.left + scrollLeft);
      this.seek(x / pxPerSec);
    };

    update(e);
    const onMove = (ev) => update(ev);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  updatePlayheadPosition() {
    if (!this.playheadNeedle) return;
    const pxPerSec = 45 * this.zoomScale;
    const leftPx = this.currentTime * pxPerSec;
    this.playheadNeedle.style.left = `${leftPx}px`;
  }

  startTrimDrag(e, segIndex, edge, pxPerSec) {
    e.stopPropagation();
    e.preventDefault();
    const segment = this.timeline.segments[segIndex];
    const origDur = Number(segment.duration_s) || 6;
    const startX = e.clientX;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dSec = Math.round(dx / pxPerSec);
      let nextDur = edge === "right" ? origDur + dSec : origDur - dSec;
      nextDur = Math.max(1, Math.min(30, nextDur));
      segment.duration_s = nextDur;
      this.write(S.serializeTimeline(this.timeline));
      this.updateTimelineTracks();
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      this.commit();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  reRollSegment(targetIndex) {
    this.timeline.segments.forEach((seg, idx) => {
      if (idx === targetIndex) seg.locked = false;
      else if (seg.cached_video) seg.locked = true;
    });
    this.commit();
    try { app.queuePrompt(0); } catch {}
  }

  deleteSegment(index) {
    if (this.timeline.segments.length <= 1) return;
    this.timeline.segments.splice(index, 1);
    this.commit();
  }

  // Transport Toolbar
  renderTransportToolbar() {
    this.timecodeDisplay = el("div", { class: "mmc-nle-timecode-box", text: "00:00.000 / F0" });

    this.playBtn = el("button", {
      class: "mmc-nle-btn primary",
      title: t("Play / Pause (Space)"),
      onclick: () => this.togglePlay(),
    }, [svg(this.isPlaying ? ICONS.pause : ICONS.play, 15)]);

    const zoomSlider = el("input", {
      class: "mmc-nle-zoom-slider",
      type: "range", min: "0.5", max: "2.5", step: "0.1", value: String(this.zoomScale),
      oninput: (e) => {
        this.zoomScale = Number(e.target.value);
        this.updateTimelineTracks();
        this.updatePlayheadPosition();
      },
    });

    return el("div", { class: "mmc-nle-transport-bar" }, [
      el("div", { class: "mmc-nle-transport-group" }, [
        el("button", { class: "mmc-nle-btn", title: t("Jump to Start (|<)"), onclick: () => this.seek(0) }, [icon("skipStart", 14)]),
        el("button", { class: "mmc-nle-btn", title: t("Step Back 1 Frame (<)"), onclick: () => this.stepFrame(-1) }, [icon("stepBack", 14)]),
        this.playBtn,
        el("button", { class: "mmc-nle-btn", title: t("Step Forward 1 Frame (>)"), onclick: () => this.stepFrame(1) }, [icon("stepForward", 14)]),
        el("button", { class: "mmc-nle-btn", title: t("Jump to End (>|)"), onclick: () => this.seek(S.timelineSeconds(this.timeline)) }, [icon("skipEnd", 14)]),
      ]),
      this.timecodeDisplay,
      el("div", { class: "mmc-nle-transport-group" }, [
        el("button", { class: "mmc-nle-btn", title: t("Set Mark In ([)"), onclick: () => { this.markIn = this.currentTime; this.render(); } }, [icon("markIn", 14), el("span", { text: "[" })]),
        el("button", { class: "mmc-nle-btn", title: t("Set Mark Out (])"), onclick: () => { this.markOut = this.currentTime; this.render(); } }, [icon("markOut", 14), el("span", { text: "]" })]),
        el("button", { class: "mmc-nle-btn", title: t("Razor Split at Playhead"), onclick: () => this.razorSplitAtPlayhead() }, [svg(ICONS.scissors, 14), el("span", { text: t("Split") })]),
        el("div", { class: "mmc-nle-zoom-wrap" }, [
          el("span", { class: "mmc-nle-tag", text: "ZOOM" }),
          zoomSlider,
        ]),
      ]),
    ]);
  }

  // Sampling Deck
  renderSamplingDeck() {
    return samplingBar({
      widgets: this.widgets,
      value: (name, fallback) => this.value(name, fallback),
      set: (name, value) => {
        const widget = this.widgets[name];
        if (!widget) return;
        widget.value = value;
        widget.callback?.(value);
        this.onWidgetChange?.();
        this.render();
      },
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