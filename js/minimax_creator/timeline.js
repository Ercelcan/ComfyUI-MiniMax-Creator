import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { viewUrl, thumbUrl, exportTimeline, clearTimelineCache } from "./api.js";
import {
  el,
  svg,
  ICONS,
  icon,
  formatTimecode,
  formatTime,
  renderCinemaCanvas,
  dismissable,
  placeNear,
} from "./dom.js";
import { CreatorEditor } from "./editor.js";
import { t } from "./i18n.js";
import { openLoras } from "./loras.js";
import { openPicker } from "./picker.js";
import { openSettings } from "./settings.js";
import { openTrim, trimLabel } from "./trim.js";
import {
  openAspectPopover,
  openResolutionPopover,
  openChoicePopover,
  aspectGlyph,
  PILL_GLYPH,
} from "./pills.js";
import { PromptBox } from "./prompt.js";
import { refine, refineButton, chosenModel as refineModel, confirmIfOpenRouter } from "./refine.js";
import { samplingBar } from "./sampling.js";
import { Stage } from "./stage.js";
import { weightsPill, loadCatalog, catalogFiles } from "./models.js";
import * as Turbo from "./turbo.js";
import * as S from "./state.js";
import { setupDragAndDrop } from "./media_drop.js";
import { drawTimelineWaveform } from "./waveform.js";
import { FPS, resolveCanvas, ASPECT_PRESETS } from "./canvas.js";

const FILMSTRIP_CACHE = new Map();

const TRANSITION_PRESETS = [
  {
    id: "av_mask",
    name: "AV Masked Continuity",
    tag: "Lossless A+V",
    badge: "Recommended",
    color: "#4ade80",
    desc: "Preserves the previous shot's video AND audio in latent space behind a denoise mask — zero roundtrip drift, the soundtrack hands over through an audio feather. Needs H3 mask support.",
    apply: (seg) => {
      seg.continue = true;
      seg.feather = 39;
      seg.continuity_mode = "av_mask";
      seg.continue_audio = true;
    },
  },
  {
    id: "latent_mask_39f",
    name: "Lossless Latent Mask",
    tag: "39f · 1.62s",
    badge: "Recommended",
    color: "#34d399",
    desc: "Highest continuity. Smooth 39-frame raw latent feather blend across character motion, lighting & soundtrack.",
    apply: (seg) => {
      seg.continue = true;
      seg.feather = 39;
      seg.continuity_mode = "latent_mask";
      seg.continue_audio = true;
    },
  },
  {
    id: "latent_mask_22f",
    name: "Fast Latent Mask",
    tag: "22f · 0.91s",
    badge: "Fast Blend",
    color: "#e879f9",
    desc: "Shorter overlap blend. Great for fast-paced camera moves and quick action scenes with lower overlap duration.",
    apply: (seg) => {
      seg.continue = true;
      seg.feather = 22;
      seg.continuity_mode = "latent_mask";
      seg.continue_audio = true;
    },
  },
  {
    id: "keyframe_blend",
    name: "Keyframe Motion Blend",
    tag: "Decoded Still",
    badge: "Visual Match",
    color: "#fbbf24",
    desc: "Anchors continuity to the previous decoded still frame without blending raw latent context.",
    apply: (seg) => {
      seg.continue = true;
      seg.feather = 22;
      seg.continuity_mode = "keyframe_still";
      seg.continue_audio = true;
    },
  },
  {
    id: "hard_audio",
    name: "Cut + Sound Carryover",
    tag: "Audio Only",
    badge: "L-Cut / J-Cut",
    color: "#60a5fa",
    desc: "Instant camera & scene switch while background score and ambient soundscape crossfade seamlessly.",
    apply: (seg) => {
      seg.continue = false;
      seg.continue_audio = true;
      delete seg.feather;
    },
  },
  {
    id: "hard_scene",
    name: "Hard Scene Cut",
    tag: "Full Reset",
    badge: "New Scene",
    color: "#999999",
    desc: "Complete visual and audio reset. Ideal for location jumps, time lapses, or new narrative scenes.",
    apply: (seg) => {
      seg.continue = false;
      seg.continue_audio = false;
      delete seg.feather;
    },
  },
];

function getActivePresetId(seg) {
  if (seg.continue) {
    if (seg.continuity_mode === "av_mask") {
      return "av_mask";
    }
    if (seg.continuity_mode === "latent_mask") {
      return seg.feather === 22 ? "latent_mask_22f" : "latent_mask_39f";
    }
    return "keyframe_blend";
  }
  if (seg.continue_audio) {
    return "hard_audio";
  }
  return "hard_scene";
}

export class TimelineBody {
  constructor({ read, write, widgets = {}, onWidgetChange, nodeId, preStage = null }) {
    this.read = read;
    this.write = write;
    this.widgets = widgets || {};
    this.onWidgetChange = onWidgetChange;
    this.nodeId = nodeId;
    this.preStage = preStage;

    this.currentTime = 0;
    this.isPlaying = false;
    this.shuttleSpeed = 1.0;
    this.playbackRaf = null;
    this.lastTime = 0;
    this.markIn = null;
    this.markOut = null;
    this.zoomScale = 1.0;
    this.activeSegment = null;
    this.isMuted = false;

    this.selectedShotIndex = 0;
    this.activeDeckTab = "bible";
    this._lastScrollLeft = 0;

    this.trackVideoLocked = false;
    this.trackAudioMuted = false;
    this.trackMusicMuted = false;

    try { this.deckCollapsed = localStorage.getItem("mmc-nle-deck-collapsed") === "1"; }
    catch { this.deckCollapsed = false; }
    try { this.samplingOpen = localStorage.getItem("mmc-nle-sampling-open") === "1"; }
    catch { this.samplingOpen = false; }
    try { this.zoomScale = Number(localStorage.getItem("mmc-nle-zoom")) || 1.0; }
    catch { this.zoomScale = 1.0; }
    try { this.deckWidth = Number(localStorage.getItem("mmc-nle-deck-width")) || 0; }
    catch { this.deckWidth = 0; }
    try { this.lanesCollapsed = localStorage.getItem("mmc-nle-lanes-collapsed") === "1"; }
    catch { this.lanesCollapsed = false; }
    this.fitMode = false;

    this.undoStack = [];
    this.redoStack = [];

    this.audioCtx = null;
    this.activeDeckName = "A";
    this.deckA = null;
    this.deckB = null;
    this.currentShotIndex = -1;

    this.timeline = S.parseTimeline(read());

    let savedSeamMode = "auto";
    try {
      savedSeamMode = this.timeline.ai_seam_mode || localStorage.getItem("mmc-ai-seam-mode") || "auto";
    } catch {}
    this.aiSeamMode = savedSeamMode;

    this.promptBox = new PromptBox({
      getState: () => ({
        prompt: this.timeline.prompt || "",
        assets: this.timeline.assets || [],
      }),
      onInput: (text) => {
        this.pushUndoSnapshot("Edit Global Prompt");
        this.timeline.prompt = text;
        if (!this.timeline.refined) {
          this.timeline.soundscape = "";
          this.timeline.music = "";
        }
        this.write(S.serializeTimeline(this.timeline));
      },
      onAttach: (row) => this.attachPoolFromMention(row),
      attachBlocked: () => null,
      getPool: () => this.timeline.assets || [],
      onQueue: () => { try { app.queuePrompt(0); } catch {} },
      removeAsset: (handle) => {
        this.pushUndoSnapshot("Remove Reference");
        this.timeline.assets = (this.timeline.assets || []).filter((a) => a.handle !== handle);
        this.write(S.serializeTimeline(this.timeline));
      },
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

    this.onKeyDown = (event) => this.handleShortcutKey(event);
    window.addEventListener("keydown", this.onKeyDown);

    loadCatalog(() => this.adoptWeights());
    this.render();
  }

  destroy() {
    this.pause();
    const events = ["mmc_segment", "mmc_segment_cached", "execution_start", "executed", "execution_error"];
    for (const name of events) api.removeEventListener(name, this.onApiEvent);
    window.removeEventListener("keydown", this.onKeyDown);
    this.stage?.destroy();
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch {}
    }
  }

  getId() {
    if (typeof this.nodeId === "function") {
      try { return this.nodeId(); } catch { return null; }
    }
    return this.nodeId;
  }

  getNode() {
    const id = this.getId();
    if (id !== null && id !== undefined) {
      return (app?.canvas?.graph?._nodes ?? []).find((n) => String(n.id) === String(id));
    }
    return null;
  }

  getWidget(name) {
    const node = this.getNode();
    if (node?.widgets) {
      const found = node.widgets.find((w) => w.name === name);
      if (found) return found;
    }
    return this.widgets?.[name] || null;
  }

  value(name, fallback) {
    const widget = this.getWidget(name);
    return widget?.value !== undefined ? widget.value : fallback;
  }

  ours(id) {
    if (id === null || id === undefined) return false;
    const mine = String(this.getId() ?? "");
    const other = String(id);
    return other === mine || (mine && other.startsWith(`${mine}.`));
  }

  getEffectivePlaybackBounds() {
    const totalDur = S.timelineSeconds(this.timeline);
    const loopStart = this.markIn !== null ? this.markIn : 0;
    if (this.markOut !== null) {
      return { loopStart, loopEnd: this.markOut };
    }

    const segments = this.timeline.segments || [];
    const isSingle = S.isSingle(this.timeline);
    const currentInfo = this.getActiveShotInfo(this.currentTime);

    if (currentInfo.segment?.cached_video) {
      let endAcc = currentInfo.shotEnd;
      for (let i = currentInfo.index + 1; i < segments.length; i++) {
        const nextSeg = segments[i];
        if (nextSeg?.cached_video) {
          endAcc += S.getEffectiveDuration(nextSeg, i, isSingle);
        } else {
          break;
        }
      }
      return { loopStart, loopEnd: Math.max(0.1, endAcc) };
    }

    let renderedEnd = 0;
    let hasAnyRendered = false;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const dur = S.getEffectiveDuration(seg, i, isSingle);
      if (seg.cached_video) {
        renderedEnd += dur;
        hasAnyRendered = true;
      } else {
        break;
      }
    }

    return { loopStart, loopEnd: hasAnyRendered ? renderedEnd : totalDur };
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
  }

  play() {
    this.initAudioContext();
    if (!this.deckA || !this.deckB) return;
    this.isPlaying = true;
    this.lastTime = performance.now();
    this.updatePlayBtnIcon();

    this.syncDualDecks(this.currentTime, true);

    const activeDeck = this.activeDeckName === "A" ? this.deckA : this.deckB;
    if (this.shuttleSpeed > 0) {
      // Browsers cannot play <video> backwards; reverse is time-driven scrubbing.
      if (activeDeck && activeDeck.src) {
        activeDeck.playbackRate = Math.abs(this.shuttleSpeed);
        activeDeck.muted = this.isMuted;
        activeDeck.play().catch(() => {});
      }
    } else {
      try { activeDeck?.pause(); } catch {}
      try { this.deckA.pause(); } catch {}
      try { this.deckB.pause(); } catch {}
    }

    const tick = (now) => {
      if (!this.isPlaying) return;
      const dt = ((now - this.lastTime) / 1000) * this.shuttleSpeed;
      this.lastTime = now;

      let nextTime = this.currentTime + dt;
      const { loopStart, loopEnd } = this.getEffectivePlaybackBounds();

      if (nextTime >= loopEnd - 0.02) {
        nextTime = loopStart;
        this.seek(nextTime, true);
        const curDeck = this.activeDeckName === "A" ? this.deckA : this.deckB;
        if (this.shuttleSpeed > 0 && curDeck && curDeck.src && this.isPlaying) {
          curDeck.muted = this.isMuted;
          curDeck.play().catch(() => {});
        }
      } else if (nextTime < loopStart) {
        nextTime = Math.min(loopEnd - 0.04, S.timelineSeconds(this.timeline));
        this.seek(nextTime, true);
      } else {
        const prevShotIdx = this.getActiveShotInfo(this.currentTime).index;
        const nextShotIdx = this.getActiveShotInfo(nextTime).index;

        this.currentTime = nextTime;
        this.updatePlayheadPosition();
        this.updateHUD();
        this.drawCinemaFrame();

        if (prevShotIdx !== nextShotIdx || this.shuttleSpeed < 0) {
          // Forward: start the swapped-in deck. Reverse: the deck is paused, so
          // pin it to the exact local time every frame (scrub-style instead of
          // letting it free-run forward).
          this.syncDualDecks(this.currentTime, this.shuttleSpeed > 0, this.shuttleSpeed < 0);
        }
      }

      this.playbackRaf = requestAnimationFrame(tick);
    };

    this.playbackRaf = requestAnimationFrame(tick);
  }

  pause() {
    this.isPlaying = false;
    this.shuttleSpeed = 1.0;
    if (this.playbackRaf) cancelAnimationFrame(this.playbackRaf);
    this.playbackRaf = null;

    if (this.deckA) { try { this.deckA.pause(); } catch {} }
    if (this.deckB) { try { this.deckB.pause(); } catch {} }

    this.updatePlayBtnIcon();
    this.drawCinemaFrame();
  }

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  updatePlayBtnIcon() {
    if (!this.playBtn) return;
    this.playBtn.replaceChildren(svg(this.isPlaying ? ICONS.pause : ICONS.play, 14));
  }

  shuttle(direction) {
    this.initAudioContext();
    if (!this.isPlaying) {
      this.shuttleSpeed = direction;
      this.play();
    } else {
      if (Math.sign(this.shuttleSpeed) === Math.sign(direction)) {
        const speeds = [1.0, 2.0, 4.0];
        const curMag = Math.abs(this.shuttleSpeed);
        const idx = speeds.indexOf(curMag);
        const nextMag = idx >= 0 && idx < speeds.length - 1 ? speeds[idx + 1] : 1.0;
        this.shuttleSpeed = direction * nextMag;
      } else {
        this.shuttleSpeed = direction * 1.0;
      }
      const curDeck = this.activeDeckName === "A" ? this.deckA : this.deckB;
      if (curDeck) curDeck.playbackRate = Math.abs(this.shuttleSpeed);
      if (this.shuttleSpeed < 0) {
        // Reverse is scrub-driven; stop the forward-running deck audio.
        try { this.deckA?.pause(); } catch {}
        try { this.deckB?.pause(); } catch {}
      }
    }
  }

  seek(seconds, updatePlayer = true) {
    const total = S.timelineSeconds(this.timeline);
    this.currentTime = Math.max(0, Math.min(seconds, total));
    this.updatePlayheadPosition();
    this.updateHUD();
    if (updatePlayer) {
      this.syncDualDecks(this.currentTime, this.isPlaying);
    }
    this.drawCinemaFrame();
  }

  stepFrame(delta) {
    this.pause();
    this.seek(this.currentTime + (delta / FPS));
  }

  getActiveShotInfo(time = this.currentTime) {
    const segments = this.timeline.segments || [];
    const isSingle = S.isSingle(this.timeline);
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const dur = S.getEffectiveDuration(seg, i, isSingle);
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
    const lastDur = S.getEffectiveDuration(segments[lastIdx], lastIdx, isSingle);
    return {
      segment: segments[lastIdx],
      index: lastIdx,
      localTime: 0,
      shotStart: acc,
      shotEnd: acc + lastDur,
      effectiveDuration: lastDur,
    };
  }

  syncDualDecks(time = this.currentTime, startPlayback = false, exact = false) {
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
      try { standbyDeck.pause(); } catch {}
    }

    const currentVideo = segment?.cached_video;
    if (currentVideo) {
      const activeUrl = viewUrl(currentVideo);
      if (activeDeck.src !== activeUrl) {
        activeDeck.src = activeUrl;
      }
      // In reverse-scrub mode pin exactly; otherwise tolerate small drift so
      // normal playback isn't constantly interrupted by seeks.
      if (exact || Math.abs(activeDeck.currentTime - localTime) > 0.05) {
        try { activeDeck.currentTime = localTime; } catch {}
      }
      activeDeck.muted = this.isMuted || this.shuttleSpeed < 0;
      activeDeck.playbackRate = Math.abs(this.shuttleSpeed);
      if (startPlayback && this.isPlaying && this.shuttleSpeed > 0) {
        // Start the (possibly just-swapped) deck as soon as it's actually
        // decodable and not mid-seek. Ready can arrive via several events and
        // the deck may still be loading from the standby prefetch, so retry on
        // any of them plus a rAF fallback, bounded by a timeout.
        let timer = null;
        const cleanup = () => {
          if (timer) { clearTimeout(timer); timer = null; }
          activeDeck.removeEventListener("seeked", tryStart);
          activeDeck.removeEventListener("loadeddata", tryStart);
          activeDeck.removeEventListener("canplay", tryStart);
        };
        const tryStart = () => {
          if (!this.isPlaying || this.shuttleSpeed <= 0) { cleanup(); return; }
          if (activeDeck.seeking) { return; }
          if (activeDeck.readyState < 2) { return; }
          cleanup();
          const now = this.getActiveShotInfo(this.currentTime);
          if (now.index === index) {
            try { activeDeck.currentTime = now.localTime; } catch {}
          }
          activeDeck.play().catch(() => {});
        };
        activeDeck.addEventListener("seeked", tryStart);
        activeDeck.addEventListener("loadeddata", tryStart);
        activeDeck.addEventListener("canplay", tryStart);
        timer = setTimeout(() => { cleanup(); tryStart(); }, 800);
        tryStart();
      }
    }

    const nextIdx = (index + 1) < segments.length
      ? (index + 1)
      : (this.markIn !== null ? this.getActiveShotInfo(this.markIn).index : 0);
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

  drawCinemaFrame() {
    if (!this.cinemaCanvas) return;
    const info = this.getActiveShotInfo();
    const segment = info.segment;
    const activeDeck = this.activeDeckName === "A" ? this.deckA : this.deckB;

    if (segment?.cached_video) {
      // While the deck is seeking, still loading, or — when paused/stepping —
      // momentarily out of sync with the playhead, keep the last drawn frame
      // instead of flashing a wrong one. Never applies during normal playback,
      // where small deck/playhead drift is expected.
      const deckReady = !!activeDeck
        && !activeDeck.seeking
        && activeDeck.readyState >= 2
        && activeDeck.videoWidth > 0;
      if (!deckReady) return;
      if (!this.isPlaying
          && Math.abs(activeDeck.currentTime - info.localTime) > 0.3) {
        return;
      }
      renderCinemaCanvas(this.cinemaCanvas, activeDeck);
      return;
    }

    {
      const firstFrame = S.frameAsset(segment || {}, "first_frame");
      const lastFrame = S.frameAsset(segment || {}, "last_frame");
      const refImg = S.refImages(segment || {})[0];
      const thumbPath = firstFrame?.filename || lastFrame?.filename || refImg?.filename || segment?.cached_video;

      if (thumbPath) {
        const isVideo = /\.(mp4|webm|mov|mkv|avi)/i.test(thumbPath);
        const targetUrl = isVideo ? thumbUrl(thumbPath) : viewUrl(thumbPath, { preview: true });

        if (FILMSTRIP_CACHE.has(targetUrl)) {
          const cached = FILMSTRIP_CACHE.get(targetUrl);
          if (cached && cached.complete && cached.naturalWidth > 0) {
            renderCinemaCanvas(this.cinemaCanvas, cached);
            return;
          }
        }
        const img = new Image();
        img.onload = () => {
          FILMSTRIP_CACHE.set(targetUrl, img);
          renderCinemaCanvas(this.cinemaCanvas, img);
        };
        img.src = targetUrl;
      } else {
        renderCinemaCanvas(this.cinemaCanvas, null);
      }
    }
  }

  pushUndoSnapshot(label = "Edit Timeline") {
    const serialized = S.serializeTimeline(this.timeline);
    if (this.undoStack.length && this.undoStack[this.undoStack.length - 1].data === serialized) return;
    this.undoStack.push({ data: serialized, label });
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return;
    const current = S.serializeTimeline(this.timeline);
    this.redoStack.push({ data: current, label: "Redo" });
    const prev = this.undoStack.pop();
    this.timeline = S.parseTimeline(prev.data);
    this.write(S.serializeTimeline(this.timeline));
    this.render();
  }

  redo() {
    if (!this.redoStack.length) return;
    const current = S.serializeTimeline(this.timeline);
    this.undoStack.push({ data: current, label: "Undo" });
    const next = this.redoStack.pop();
    this.timeline = S.parseTimeline(next.data);
    this.write(S.serializeTimeline(this.timeline));
    this.render();
  }

  saveLocalCache() {
    const id = this.getId();
    if (!id) return;
    const cacheMap = {};
    for (let i = 0; i < (this.timeline.segments || []).length; i++) {
      const seg = this.timeline.segments[i];
      if (seg?.cached_video) {
        cacheMap[i] = { cached_video: seg.cached_video, locked: seg.locked === true };
      }
    }
    try { localStorage.setItem(`mmc-timeline-cache-${id}`, JSON.stringify(cacheMap)); } catch {}
  }

  handleApiEvent(type, detail) {
    if (type === "execution_start") {
      // Clear any stale highlight from a previous run before its detail check,
      // so a queued re-roll never keeps the last run's clip lit.
      this.activeSegment = null;
      this.render();
    }
    if (!detail) return;
    if (type === "mmc_segment") {
      if (this.ours(detail.node)) {
        // Prefer the explicit zero-based segment_index; fall back to legacy 1-based index.
        let n;
        if (detail.segment_index !== undefined && detail.segment_index !== null) {
          n = Number(detail.segment_index);
        } else {
          const one = Number(detail.index);
          n = Number.isFinite(one) && one > 0 ? one - 1 : NaN;
        }
        this.activeSegment = Number.isFinite(n) && n >= 0 ? n : null;
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

  handleShortcutKey(event) {
    // Never hijack typing in inputs, the prompt box, or any overlay.
    const target = event.target;
    if (target && (target.isContentEditable
        || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!this.root?.isConnected) return;
    if (document.querySelector(".mmc-overlay, .mmc-pop")) return;

    const total = S.timelineSeconds(this.timeline);
    switch (event.key) {
      case " ":
        event.preventDefault();
        this.togglePlay();
        break;
      case "j": case "J":
        this.shuttle(-1);
        break;
      case "l": case "L":
        this.shuttle(1);
        break;
      case "k": case "K":
        this.pause();
        break;
      case ",":
        this.stepFrame(-1);
        break;
      case ".":
        this.stepFrame(1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        this.seek(Math.max(0, this.currentTime - 1));
        break;
      case "ArrowRight":
        event.preventDefault();
        this.seek(Math.min(total, this.currentTime + 1));
        break;
      case "[":
        this.markIn = this.currentTime;
        this.render();
        break;
      case "]":
        this.markOut = this.currentTime;
        this.render();
        break;
      case "s": case "S":
        this.razorSplitAtPlayhead();
        break;
      case "d": case "D":
        this.duplicateSelectedShot();
        break;
      case "Delete": case "Backspace":
        if ((this.timeline.segments || [])[this.selectedShotIndex]) {
          this.deleteSegment(this.selectedShotIndex);
        }
        break;
      default:
        return;
    }
  }

  reload() {
    this.timeline = S.parseTimeline(this.read());
    if (this.timeline.ai_seam_mode) {
      this.aiSeamMode = this.timeline.ai_seam_mode;
    }
    if (this.promptBox) {
      this.promptBox.setValue(this.timeline.prompt || "");
    }
    this.render();
  }

  fitZoom() {
    const vp = this.tracksViewport;
    if (!vp || !vp.clientWidth) return;
    const total = S.timelineSeconds(this.timeline);
    if (total <= 0) return;
    // content width is total * 45 * zoom + 160px of tail room; solve for zoom
    const zoom = (vp.clientWidth - 200) / (total * 45);
    this.zoomScale = Math.max(0.12, Math.min(3, Math.round(zoom * 100) / 100));
    try { localStorage.setItem("mmc-nle-zoom", String(this.zoomScale)); } catch {}
    if (this.zoomSliderEl) this.zoomSliderEl.value = String(this.zoomScale);
    const readout = this.root?.querySelector(".mmc-nle-zoom-readout");
    if (readout) readout.textContent = `${Math.round(this.zoomScale * 100)}%`;
  }

  commit() {
    this.timeline.ai_seam_mode = this.aiSeamMode;
    S.syncTimeline(this.timeline);
    Turbo.sync(this.timeline, this.widgetIO());
    this.saveLocalCache();
    this.write(S.serializeTimeline(this.timeline));
    if (this.fitMode && this.tracksViewport) this.fitZoom();
    this.render();
  }

  widgetIO() {
    return {
      value: (name, fallback) => this.value(name, fallback),
      set: (name, value) => {
        const widget = this.getWidget(name);
        if (widget) {
          widget.value = value;
          widget.callback?.(value);
        }
        this.onWidgetChange?.();
        this.render();
      },
    };
  }

  attachPoolFromMention(row) {
    this.pushUndoSnapshot("Attach Reference");
    const entry = {
      handle: S.nextPoolHandle(this.timeline, row.kind),
      kind: row.kind, role: "reference", filename: row.path, ref_size: "max",
    };
    if (row.kind === "video") entry.track = row.track ?? S.DEFAULT_TRACK;
    if (row.trim) entry.trim = row.trim;
    this.timeline.assets = this.timeline.assets || [];
    this.timeline.assets.push(entry);
    this.commit();
    return entry.handle;
  }

  async addGlobalReference(kind = "image") {
    const chosen = await openPicker({
      kinds: [kind, "renders"],
      kind,
      capacity: () => ({ used: 0, max: S.MAX_REF_FILES, filesLeft: S.MAX_REF_FILES }),
    });
    if (!chosen) return;
    for (const picked of chosen) {
      this.attachPoolFromMention(picked);
    }
  }

  async attachMasterAudio() {
    const chosen = await openPicker({
      kinds: ["audio", "video", "renders"],
      kind: "audio",
      single: true,
      capacity: () => ({ used: 0, max: 1, filesLeft: 1 }),
    });
    if (!chosen) return;
    this.pushUndoSnapshot("Attach Master Song");
    this.timeline.master_audio = { filename: chosen[0].path };
    this.commit();
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
    this.pushUndoSnapshot("Edit Reference Trim");
    if (result.trim) asset.trim = result.trim;
    else delete asset.trim;
    if (result.track) asset.track = result.track;
    this.commit();
  }

  selectShot(index, autoScroll = false) {
    const segments = this.timeline.segments || [];
    if (index < 0 || index >= segments.length) return;
    this.selectedShotIndex = index;
    this.activeDeckTab = "shot";
    this.render();
    if (autoScroll) {
      this.ensureShotVisible(index);
    }
  }

  ensureShotVisible(index) {
    if (!this.tracksViewport) return;
    const segments = this.timeline.segments || [];
    const isSingle = S.isSingle(this.timeline);
    const pxPerSec = 45 * this.zoomScale;

    let acc = 0;
    for (let i = 0; i < index && i < segments.length; i++) {
      acc += S.getEffectiveDuration(segments[i], i, isSingle);
    }
    const shotStartPx = acc * pxPerSec;
    const shotDur = S.getEffectiveDuration(segments[index], index, isSingle);
    const shotEndPx = shotStartPx + (shotDur * pxPerSec);

    const viewLeft = this.tracksViewport.scrollLeft;
    const viewWidth = this.tracksViewport.clientWidth || 600;
    const viewRight = viewLeft + viewWidth;

    if (shotStartPx < viewLeft) {
      this.tracksViewport.scrollLeft = Math.max(0, shotStartPx - 40);
    } else if (shotEndPx > viewRight) {
      this.tracksViewport.scrollLeft = Math.max(0, shotEndPx - viewWidth + 60);
    }
  }

  handleTimelineTrackDrop(uploadedItem) {
    if (!uploadedItem) return;
    const segments = this.timeline.segments || [];
    const activeIdx = Math.max(0, Math.min(this.selectedShotIndex ?? 0, segments.length - 1));
    const targetSeg = segments[activeIdx];

    this.pushUndoSnapshot(`Attach ${uploadedItem.kind}`);

    if (uploadedItem.kind === "audio") {
      if (this.timeline.master_audio === null) {
        this.timeline.master_audio = { filename: uploadedItem.path };
      } else if (targetSeg) {
        targetSeg.assets = targetSeg.assets || [];
        targetSeg.assets.push({
          handle: S.nextHandle(targetSeg, "audio"),
          kind: "audio", role: "reference", filename: uploadedItem.path,
        });
      }
    } else if (uploadedItem.kind === "image" || uploadedItem.kind === "video") {
      if (targetSeg) {
        targetSeg.assets = targetSeg.assets || [];
        targetSeg.assets.push({
          handle: S.nextHandle(targetSeg, uploadedItem.kind),
          kind: uploadedItem.kind, role: "reference", filename: uploadedItem.path, ref_size: "max",
        });
      }
    }
    this.commit();
  }

  razorSplitAtPlayhead() {
    const { segment, index, localTime } = this.getActiveShotInfo();
    const curDur = Number(segment.duration_s) || 6;

    if (localTime < 1.5 || curDur - localTime < 1.5) return;

    this.pushUndoSnapshot("Razor Split");

    const split1Dur = Math.max(1.5, Math.round(localTime * 10) / 10);
    const split2Dur = Math.max(1.5, Math.round((curDur - localTime) * 10) / 10);

    segment.duration_s = split1Dur;
    const newSeg = S.cloneSegment(segment);
    newSeg.duration_s = split2Dur;
    newSeg.continue = true;
    newSeg.continue_audio = true;
    newSeg.continuity_mode = "latent_mask";
    newSeg.feather = 39;
    newSeg.locked = false;
    newSeg.cached_video = null;

    this.timeline.segments.splice(index + 1, 0, newSeg);
    this.selectedShotIndex = index + 1;
    this.activeDeckTab = "shot";
    this.commit();
  }

  duplicateSelectedShot() {
    const segments = this.timeline.segments || [];
    if (!segments.length) return;
    const idx = this.selectedShotIndex ?? 0;
    const orig = segments[idx];
    if (!orig) return;

    this.pushUndoSnapshot("Duplicate Shot");
    const dup = S.cloneSegment(orig);
    dup.seed = Math.floor(Math.random() * 0xffffffff);
    dup.locked = false;
    dup.cached_video = null;
    segments.splice(idx + 1, 0, dup);
    this.selectedShotIndex = idx + 1;
    this.commit();
  }

  deleteSelectedShot() {
    const idx = this.selectedShotIndex ?? 0;
    this.deleteSegment(idx);
  }

  deleteSegment(index) {
    if (this.timeline.segments.length <= 1) return;
    this.pushUndoSnapshot("Delete Shot");
    this.timeline.segments.splice(index, 1);
    this.selectedShotIndex = Math.max(0, index - 1);
    this.commit();
  }

  revertAll() {
    this.pushUndoSnapshot("Revert All AI Rewrites");
    this.timeline.refined = null;
    this.timeline.soundscape = "";
    this.timeline.music = "";
    for (const segment of this.timeline.segments || []) {
      segment.refined = null;
      segment.soundscape = "";
      segment.music = "";
    }
    this.commit();
  }

  async clearAllCache() {
    const id = this.getId();
    if (id) {
      try { localStorage.removeItem(`mmc-timeline-cache-${id}`); } catch {}
    }
    try {
      await clearTimelineCache();
    } catch (e) {
      console.error("[MiniMax Creator] Clear cache error:", e);
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
    try {
      this.root.replaceChildren(
        this.renderTopBar(),
        this.renderSplitBody(),
        this.renderSamplingDeck(),
      );
      this.updatePlayheadPosition();
      this.updateHUD();
      this.drawCinemaFrame();
    } catch (err) {
      console.error("[MiniMax Creator] Timeline render error:", err);
    }
  }

  renderTopBar() {
    const activeLorasCount = S.activeGlobalLoras(this.timeline).length;
    const ratioVal = ASPECT_PRESETS.find(([l]) => l === this.timeline.aspect)?.[1] ?? 16 / 9;
    const [width, height] = resolveCanvas(ratioVal, this.timeline.short_edge || 768);

    const hasCached = (this.timeline.segments || []).some((s) => s.cached_video);

    const galleryBtn = el("button", {
      class: "mmc-nle-btn",
      title: t("Browse finished renders and stills"),
      onclick: () => this.openGallery(),
    }, [icon("gallery", 13)]);

    const previewBtn = el("button", {
      class: `mmc-nle-btn${this.stage?.showing() ? " active" : ""}`,
      title: t("Toggle satellite preview window"),
      onclick: () => {
        this.stage?.toggleOpen();
        this.render();
      },
    }, [icon("play", 13)]);

    const settingsBtn = el("button", {
      class: "mmc-nle-btn",
      title: t("Preferences for this ComfyUI — output quality."),
      onclick: () => openSettings(),
    }, [icon("gear", 13)]);

    const refined = S.twoPass(this.timeline);
    const rtxOn = S.rtxVsr(this.timeline);
    const refineInfo = rtxOn
      ? `${S.sampleEdge(this.timeline)} → ${width}×${height} · RTX VSR ${this.timeline.rtx_quality || "ULTRA"}`
      : refined
      ? `${S.sampleEdge(this.timeline)} → ${width}×${height} · ${this.timeline.refine_steps ?? 1}st@${(this.timeline.refine_denoise ?? S.DEFAULT_REFINE_DENOISE).toFixed(2)}${this.timeline.save_pass1 ? " (+base)" : ""}`
      : `${width}×${height}`;

    return el("div", { class: "mmc-nle-top-bar" }, [
      el("div", { class: "mmc-nle-top-left" }, [
        el("span", { class: "mmc-nle-tag", text: "STUDIO" }),
        el("button", {
          class: "mmc-pill",
          title: t("Aspect ratio selector"),
          onclick: (e) => openAspectPopover(e.currentTarget, this.timeline, () => this.commit()),
        }, [aspectGlyph(ratioVal, PILL_GLYPH), el("span", { text: this.timeline.aspect })]),
        el("button", {
          class: "mmc-pill mmc-pill-res",
          title: t("Short edge resolution & two-pass neural latent upscale settings"),
          onclick: (e) => openResolutionPopover(e.currentTarget, this.timeline, () => {
            const [w, h] = resolveCanvas(ratioVal, this.timeline.short_edge || 768);
            return { width: w, height: h };
          }, () => this.commit()),
        }, [icon("res", 14), el("span", { text: `${this.timeline.short_edge || 768}p` }), el("span", { class: "mmc-pill-sub", text: refineInfo })]),
        el("button", {
          class: `mmc-pill${activeLorasCount ? " on" : ""}`,
          onclick: () => openLoras({ state: this.timeline, targets: S.timelineCheckpoints(this.timeline), onChange: () => this.commit() }),
        }, [icon("effect", 14), el("span", { text: t(activeLorasCount ? "{n} LoRAs" : "LoRAs", { n: activeLorasCount }) })]),
      ]),
      el("div", { class: "mmc-nle-top-right" }, [
        galleryBtn,
        previewBtn,
        settingsBtn,
        el("button", {
          class: `mmc-nle-btn${this.deckCollapsed ? "" : " active"}`,
          title: this.deckCollapsed ? t("Show the project panel") : t("Hide the project panel to give the timeline full width"),
          onclick: () => {
            this.deckCollapsed = !this.deckCollapsed;
            try { localStorage.setItem("mmc-nle-deck-collapsed", this.deckCollapsed ? "1" : "0"); } catch {}
            this.render();
          },
        }, [svg(ICONS.panel ?? ICONS.edit, 13)]),
        el("button", {
          class: "mmc-nle-btn",
          title: t("More: seams, cache & NLE export"),
          onclick: (e) => this.openOverflowMenu(e.currentTarget),
        }, [el("span", { text: "⋯" })]),
      ]),
    ]);
  }

  openOverflowMenu(anchor) {
    const items = [
      {
        label: this.aiSeamMode === "auto" ? t("AI Seams: Auto") : t("AI Seams: User"),
        title: this.aiSeamMode === "auto"
          ? t("AI Auto-Seams (Active): AI refiner automatically infers match-cuts & continuity and sets timeline seams.")
          : t("User Seams: Your manually set cuts are preserved and sent as context to the AI."),
        run: () => {
          this.aiSeamMode = this.aiSeamMode === "auto" ? "context" : "auto";
          this.timeline.ai_seam_mode = this.aiSeamMode;
          try { localStorage.setItem("mmc-ai-seam-mode", this.aiSeamMode); } catch {}
          this.commit();
        },
      },
      ...((this.timeline.segments || []).some((s) => s.cached_video) ? [{
        label: t("Clean Cache"),
        title: t("Purge intermediate segment videos & .safetensors checkpoints from disk"),
        run: () => this.clearAllCache(),
      }] : []),
      {
        label: t("Export NLE"),
        title: t("Export sequence to DaVinci Resolve or Premiere (.edl / .xml)"),
        run: (anchorEl) => this.openExportPopover(anchorEl),
      },
      {
        label: (this.timeline.segments?.[0]?.extend_video) ? t("Remove extended video") : t("Extend video…"),
        title: t("Use a video from the input folder as the timeline's opening shot and continue it with AI"),
        run: async () => {
          const seg = this.timeline.segments?.[0];
          if (!seg) return;
          if (seg.extend_video) {
            this.pushUndoSnapshot("Remove Extended Video");
            seg.extend_video = null;
            this.commit();
            return;
          }
          const chosen = await openPicker({
            kinds: ["video"], kind: "video", single: true,
            capacity: () => ({ used: 0, max: 1, filesLeft: 1 }),
          });
          if (!chosen?.length) return;
          this.pushUndoSnapshot("Extend Video");
          seg.extend_video = chosen[0].path;
          this.commit();
        },
      },
    ];
    const pop = el("div", { class: "mmc-pop mmc-chip-menu" },
      items.map((item) => el("button", {
        class: "mmc-chip-menu-item",
        text: item.label,
        title: item.title || "",
        onclick: (event) => {
          event.stopPropagation();
          // Run while this item is still attached so it can serve as a
          // positioning anchor for any popover the action opens.
          try { item.run(event.currentTarget); } catch (error) { console.error("[MiniMax Creator] menu action failed:", error); }
          pop.remove();
        },
      }))
    );
    document.body.appendChild(pop);
    placeNear(pop, anchor);
    dismissable(pop);
  }

  openExportPopover(anchor) {
    openChoicePopover(anchor, {
      title: t("Export NLE Timeline"),
      options: [
        "CMX 3600 EDL (.edl)",
        "Final Cut Pro 7 XML (.xml)",
      ],
      value: "CMX 3600 EDL (.edl)",
      onPick: async (picked) => {
        const fmt = picked.includes("XML") ? "xml" : "edl";
        try {
          await exportTimeline(JSON.parse(S.serializeTimeline(this.timeline)), fmt);
        } catch (err) {
          alert(t("Export failed: {err}", { err: err.message || err }));
        }
      },
    });
  }

  renderSplitBody() {
    const segments = this.timeline.segments || [];
    const activeIdx = Math.max(0, Math.min(this.selectedShotIndex ?? 0, segments.length - 1));
    const selectedSeg = segments[activeIdx];

    const tabBible = el("button", {
      class: `mmc-nle-deck-tab${this.activeDeckTab === "bible" ? " active" : ""}`,
      onclick: () => { this.activeDeckTab = "bible"; this.updateLeftDeck(); },
    }, [icon("globe", 13), el("span", { text: t("Project Bible & Scene") })]);

    const tabShot = el("button", {
      class: `mmc-nle-deck-tab${this.activeDeckTab === "shot" ? " active" : ""}`,
      onclick: () => { this.activeDeckTab = "shot"; this.updateLeftDeck(); },
    }, [icon("clapper", 13), el("span", { text: t("Shot {n} Inspector", { n: activeIdx + 1 }) })]);

    if (!this.leftDeckEl) {
      this.leftDeckEl = el("div", { class: "mmc-nle-left-deck" });
    }
    if (this.deckWidth) this.leftDeckEl.style.flex = `0 0 ${this.deckWidth}px`;
    this.updateLeftDeck();

    const splitter = this.deckCollapsed ? null : el("div", {
      class: "mmc-nle-deck-splitter",
      title: t("Drag to resize the project panel"),
      onpointerdown: (e) => this.startDeckDrag(e),
    });

    const studio = el("div", { class: "mmc-nle-studio-zone" }, [
      this.renderCinemaMonitor(),
      this.renderTransportToolbar(),
      this.renderTimelineTracks(),
    ]);

    return el("div", {
      class: `mmc-nle-split-body${this.deckCollapsed ? " collapsed" : ""}`,
    }, [this.leftDeckEl, ...(splitter ? [splitter] : []), studio]);
  }

  startDeckDrag(e) {
    e.preventDefault();
    const splitter = e.currentTarget;
    const body = splitter.parentElement;
    if (splitter.setPointerCapture) {
      try { splitter.setPointerCapture(e.pointerId); } catch {}
    }
    const onMove = (ev) => {
      const rect = body.getBoundingClientRect();
      const max = rect.width * 0.7;
      const width = Math.max(220, Math.min(max, ev.clientX - rect.left));
      this.deckWidth = Math.round(width);
      this.leftDeckEl.style.flex = `0 0 ${this.deckWidth}px`;
    };
    const onUp = (ev) => {
      if (splitter.releasePointerCapture) {
        try { splitter.releasePointerCapture(ev.pointerId); } catch {}
      }
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onUp);
      try { localStorage.setItem("mmc-nle-deck-width", String(this.deckWidth)); } catch {}
    };
    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
  }

  updateLeftDeck() {
    if (!this.leftDeckEl) return;
    const savedDeckScroll = this.leftDeckEl.scrollTop;
    const segments = this.timeline.segments || [];
    const activeIdx = Math.max(0, Math.min(this.selectedShotIndex ?? 0, segments.length - 1));
    const selectedSeg = segments[activeIdx];

    const tabBible = el("button", {
      class: `mmc-nle-deck-tab${this.activeDeckTab === "bible" ? " active" : ""}`,
      onclick: () => { this.activeDeckTab = "bible"; this.updateLeftDeck(); },
    }, [icon("globe", 13), el("span", { text: t("Project Bible & Scene") })]);

    const tabShot = el("button", {
      class: `mmc-nle-deck-tab${this.activeDeckTab === "shot" ? " active" : ""}`,
      onclick: () => { this.activeDeckTab = "shot"; this.updateLeftDeck(); },
    }, [icon("clapper", 13), el("span", { text: t("Shot {n} Inspector", { n: activeIdx + 1 }) })]);

    const hasRefined = Boolean(
      this.timeline.refined || (this.timeline.segments || []).some((s) => s.refined?.body)
    );

    const revertAllBtn = hasRefined ? el("button", {
      class: "mmc-nle-deck-action-btn",
      title: t("Revert all AI rewrites across global and segment prompts"),
      onclick: () => this.revertAll(),
    }, [el("span", { text: t("Revert All") })]) : null;

    const refineAllBtn = refineButton({
      run: () => this.refineAll(),
      label: t("Refine All"),
      mode: "pill",
      className: "mmc-nle-deck-refine-btn",
    });

    const deckTabs = el("div", { class: "mmc-nle-deck-tabs" }, [
      el("div", { class: "mmc-nle-deck-tabs-left" }, [tabBible, tabShot]),
      el("div", { class: "mmc-nle-deck-tabs-right" }, [
        ...(revertAllBtn ? [revertAllBtn] : []),
        refineAllBtn,
      ]),
    ]);

    let deckContent;
    if (this.activeDeckTab === "shot" && selectedSeg) {
      deckContent = this.renderShotInspector(selectedSeg, activeIdx);
    } else {
      deckContent = el("div", { class: "mmc-nle-bible-pane" }, [
        el("div", { class: "mmc-nle-prompt-wrap" }, [
          this.promptBox.chipsBar,
          this.promptBox.root,
        ]),
        this.renderPieceBible(),
      ]);
    }

    this.leftDeckEl.replaceChildren(deckTabs, deckContent);
    this.leftDeckEl.scrollTop = savedDeckScroll;
  }

  renderShotInspector(seg, idx) {
    const isChained = !S.isSingle(this.timeline);
    let gainTxt;

    const editor = new CreatorEditor({
      state: seg,
      compact: true,
      onCommit: () => {
        this.pushUndoSnapshot(`Edit Shot ${idx + 1}`);
        this.saveLocalCache();
        this.write(S.serializeTimeline(this.timeline));
        this.updateTimelineTracks();
        this.updateHUD();
        this.drawCinemaFrame();
      },
      canvasPills: false,
      durationPill: false,
      settingsTool: false,
      routeOf: () => this.timeline.models?.route ?? "auto",
      continuePill: idx > 0 && isChained,
      refineTarget: () => ({
        kind: "segment",
        index: idx,
        data: JSON.parse(S.serializeTimeline(this.timeline)),
      }),
      onRefined: () => this.commit(),
      onReverted: () => this.commit(),
      extraPills: () => [
        el("div", { class: "mmc-pill mmc-pill-group", title: t("Shot audio volume gain") }, [
          icon("volume", 13),
          el("input", {
            type: "range", min: "0.0", max: "2.0", step: "0.05",
            value: String(seg.gain ?? 1.0),
            style: { width: "48px", accentColor: "var(--mmc-accent, #f0a63c)" },
            oninput: (e) => {
              seg.gain = Number(e.target.value);
              if (gainTxt) gainTxt.textContent = `${Math.round(seg.gain * 100)}%`;
            },
            onchange: () => this.commit(),
          }),
          gainTxt = el("span", {
            class: "mmc-pill-sub",
            text: `${Math.round((seg.gain ?? 1.0) * 100)}%`,
            style: { minWidth: "30px", textAlign: "right", fontVariantNumeric: "tabular-nums" },
          }),
        ]),
        el("button", {
          class: `mmc-pill${seg.ducking !== false ? " on" : ""}`,
          title: t("Auto-duck background music during spoken dialogue"),
          onclick: () => {
            seg.ducking = seg.ducking === false;
            this.commit();
          },
        }, [icon("music", 13), el("span", { text: seg.ducking !== false ? t("Ducking: On") : t("Ducking: Off") })]),
      ],
    });

    const lockBtn = el("button", {
      class: `mmc-nle-btn${S.isLocked(seg) ? " active" : ""}`,
      title: t("Lock segment cache to bypass generation"),
      onclick: () => {
        this.pushUndoSnapshot("Toggle Shot Lock");
        seg.locked = !seg.locked;
        this.commit();
      },
    }, [icon(S.isLocked(seg) ? "lock" : "unlock", 13), el("span", { text: S.isLocked(seg) ? t("Locked") : t("Unlocked") })]);

    const dupBtn = el("button", {
      class: "mmc-nle-btn",
      title: t("Duplicate shot (D)"),
      onclick: () => this.duplicateSelectedShot(),
    }, [icon("duplicate", 13), el("span", { text: t("Duplicate") })]);

    const rerollBtn = el("button", {
      class: "mmc-nle-btn",
      title: t("Generate variation of this shot with a new seed"),
      onclick: () => this.reRollSegment(idx),
    }, [icon("dice", 13), el("span", { text: t("Re-roll") })]);

    const delBtn = el("button", {
      class: "mmc-nle-btn",
      title: t("Delete shot (Del)"),
      onclick: () => this.deleteSegment(idx),
    }, [icon("trash", 13), el("span", { text: t("Delete") })]);

    return el("div", { class: "mmc-nle-inspector" }, [
      el("div", { class: "mmc-nle-inspector-head" }, [
        el("span", { class: "mmc-nle-tag", text: t("SHOT {n} ({dur}s)", { n: idx + 1, dur: (Number(seg.duration_s) || 6).toFixed(1) }) }),
        el("div", { class: "mmc-nle-inspector-actions" }, [
          lockBtn,
          dupBtn,
          rerollBtn,
          delBtn,
        ]),
      ]),
      editor.root,
    ]);
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
            this.pushUndoSnapshot("Toggle Track Sound");
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
            this.pushUndoSnapshot("Change Take Scope");
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
            this.pushUndoSnapshot("Change Reference Resolution");
            asset.ref_size = size === "max" ? "match" : "max";
            this.commit();
          },
        }));
      }

      parts.push(el("button", {
        class: "mmc-asset-x", text: "✕",
        onclick: () => {
          this.pushUndoSnapshot("Remove Reference");
          this.timeline.assets = this.timeline.assets.filter((a) => a !== asset);
          this.commit();
        },
      }));

      return el("div", {
        class: `mmc-asset mmc-tag-${S.tagIndex(asset.handle)}`,
        title: asset.filename,
      }, parts);
    });

    const masterAudioChip = this.timeline.master_audio ? el("div", {
      class: "mmc-asset mmc-tag-2",
      title: this.timeline.master_audio.filename,
    }, [
      el("span", { class: "mmc-asset-thumb" }, [svg(ICONS.audio, 14)]),
      el("span", { class: "mmc-asset-handle", text: "Master Song (Lip-Sync Track)" }),
      el("button", {
        class: "mmc-asset-x", text: "✕",
        onclick: () => {
          this.pushUndoSnapshot("Remove Master Audio");
          this.timeline.master_audio = null;
          this.commit();
        },
      }),
    ]) : null;

    return el("div", { class: "mmc-nle-piece-bible" }, [
      el("div", { class: "mmc-nle-bible-head" }, [
        el("span", { class: "mmc-nle-tag", text: t("GLOBAL PIECE BIBLE (CAST & REFS)") }),
        el("div", { style: { display: "flex", gap: "4px" } }, [
          el("button", {
            class: "mmc-nle-btn",
            text: t("+ Song"),
            title: t("Attach full master song soundtrack for lip-sync & audio mask"),
            onclick: () => this.attachMasterAudio(),
          }),
          el("button", {
            class: "mmc-nle-btn",
            text: t("+ Ref"),
            title: t("Attach piece reference for characters, locations, or style"),
            onclick: () => this.addGlobalReference("image"),
          }),
        ]),
      ]),
      el("div", { class: "mmc-nle-bible-chips" }, [
        ...(masterAudioChip ? [masterAudioChip] : []),
        ...pieceChips,
        el("div", {
          class: "mmc-nle-bible-dropzone",
          title: t("Drag & Drop media here to add as piece reference"),
        }, [icon("folder", 12), el("span", { text: t("Drop References / Audio") })]),
      ]),
    ]);
  }

  async refineAll() {
    try {
      this.pushUndoSnapshot("Refine Entire Timeline");
      const payloadData = JSON.parse(S.serializeTimeline(this.timeline));
      payloadData.ai_seam_mode = this.aiSeamMode;

      const result = await refine({
        kind: "timeline",
        data: payloadData,
        node_id: typeof this.nodeId === "function" ? this.nodeId() : this.nodeId,
      });

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
              seg.continuity_mode = shot.auto_seam.continuity_mode || "latent_mask";
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
      alert(t("Refine failed: {error}", { error: e.message || e }));
    }
  }

  renderCinemaMonitor() {
    this.monitorHUDLeft = el("div", { class: "mmc-nle-hud-left" });
    this.monitorHUDRight = el("div", { class: "mmc-nle-hud-right" });
    this.cinemaCanvas = el("canvas", { class: "mmc-nle-cinema-canvas" });

    if (!this.deckA) {
      this.deckA = el("video", { style: { display: "none" }, playsinline: true, preload: "auto" });
      this.deckA.muted = this.isMuted;
      this.deckA.addEventListener("seeked", () => {
        if (!this.isPlaying) this.drawCinemaFrame();
      });
      this.deckA.addEventListener("loadeddata", () => {
        if (!this.isPlaying) this.drawCinemaFrame();
      });
    }
    if (!this.deckB) {
      this.deckB = el("video", { style: { display: "none" }, playsinline: true, preload: "auto" });
      this.deckB.muted = this.isMuted;
      this.deckB.addEventListener("seeked", () => {
        if (!this.isPlaying) this.drawCinemaFrame();
      });
      this.deckB.addEventListener("loadeddata", () => {
        if (!this.isPlaying) this.drawCinemaFrame();
      });
    }

    this.monitorWrap = el("div", { class: "mmc-nle-monitor-wrap" }, [
      el("div", { class: "mmc-nle-hud" }, [this.monitorHUDLeft, this.monitorHUDRight]),
      this.cinemaCanvas,
      this.deckA,
      this.deckB,
      el("div", { class: "mmc-nle-monitor-tools" }, [
        el("button", {
          class: "mmc-nle-overlay-btn",
          title: t("Download current video (.mp4) directly"),
          onclick: () => this.downloadCurrentVideo(),
        }, [icon("download", 13), el("span", { text: t("Download") })]),
        el("button", {
          class: "mmc-nle-overlay-btn",
          title: t("Grab current frame as reference still"),
          onclick: () => this.grabCurrentMonitorFrame(),
        }, [icon("camera", 13), el("span", { text: t("Grab") })]),
        el("button", {
          class: `mmc-nle-overlay-btn${this.markIn !== null ? " active" : ""}`,
          title: t("Loop playback inside Mark In/Out bounds"),
          onclick: () => this.toggleLoop(),
        }, [icon("loop", 13), el("span", { text: t("Loop") })]),
        el("button", {
          class: `mmc-nle-overlay-btn${this.isMuted ? " active" : ""}`,
          title: t("Toggle audio mute"),
          onclick: (e) => {
            this.isMuted = !this.isMuted;
            if (this.deckA) this.deckA.muted = this.isMuted;
            if (this.deckB) this.deckB.muted = this.isMuted;
            e.currentTarget?.classList?.toggle("active", this.isMuted);
          },
        }, [svg(this.isMuted ? ICONS.volumeMute : ICONS.volume, 13)]),
      ]),
    ]);

    this.syncDualDecks(this.currentTime, false);
    this.drawCinemaFrame();
    return this.monitorWrap;
  }

  updateHUD() {
    const { segment, index } = this.getActiveShotInfo();
    const tc = formatTimecode(this.currentTime, FPS);
    const isLocked = S.isLocked(segment);

    if (this.monitorHUDLeft) {
      this.monitorHUDLeft.replaceChildren(
        el("span", { class: "mmc-nle-hud-chip accent", text: t("Shot {n}/{total}", { n: index + 1, total: this.timeline.segments.length }) }),
        el("span", { class: "mmc-nle-hud-chip", text: S.mode(segment) }),
        el("span", { class: `mmc-nle-hud-chip ${isLocked ? "cache-ready" : ""}`, text: isLocked ? t("Cached") : t("Sampling") })
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
    if (!activeDeck?.videoWidth && !this.cinemaCanvas) return;

    const source = activeDeck?.videoWidth ? activeDeck : this.cinemaCanvas;
    const canvas = document.createElement("canvas");
    canvas.width = source.videoWidth || source.width || 1280;
    canvas.height = source.videoHeight || source.height || 720;
    canvas.getContext("2d").drawImage(source, 0, 0);

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

  renderTimelineTracks() {
    if (!this.tracksContainer) {
      this.tracksContainer = el("div", { class: "mmc-nle-timeline-wrapper" });
    }
    this.updateTimelineTracks();
    return this.tracksContainer;
  }

  updateTimelineTracks() {
    if (!this.tracksContainer) return;
    const savedScrollLeft = this.tracksViewport?.scrollLeft ?? this._lastScrollLeft ?? 0;

    const totalDuration = S.timelineSeconds(this.timeline);
    const segments = this.timeline.segments || [];
    const isSingle = S.isSingle(this.timeline);
    const pxPerSec = 45 * this.zoomScale;
    const contentWidth = Math.max(700, Math.round(totalDuration * pxPerSec) + 160);

    const headerCol = el("div", { class: "mmc-nle-track-headers" }, [
      el("div", { class: "mmc-nle-header-cell ruler-head" }, [
        el("span", { text: "TRACKS" }),
        el("button", {
          class: `mmc-track-btn${this.lanesCollapsed ? " active" : ""}`,
          title: this.lanesCollapsed ? t("Show audio lanes") : t("Hide the audio lanes"),
          onclick: () => {
            this.lanesCollapsed = !this.lanesCollapsed;
            try { localStorage.setItem("mmc-nle-lanes-collapsed", this.lanesCollapsed ? "1" : "0"); } catch {}
            this.updateTimelineTracks();
          },
        }, [el("span", { text: this.lanesCollapsed ? "▸" : "▾" })]),
      ]),
      el("div", { class: "mmc-nle-header-cell video-head" }, [
        el("div", { class: "mmc-nle-track-title-row" }, [
          icon("video", 13),
          el("span", { class: "mmc-track-label", text: "Video" }),
        ]),
        el("div", { class: "mmc-track-btns" }, [
          el("button", {
            class: `mmc-track-btn${this.trackVideoLocked ? " active" : ""}`,
            title: t("Lock / Unlock all clips"),
            onclick: () => {
              this.trackVideoLocked = !this.trackVideoLocked;
              segments.forEach((s) => { s.locked = this.trackVideoLocked; });
              this.commit();
            },
          }, [icon(this.trackVideoLocked ? "lock" : "unlock", 11)]),
        ]),
      ]),
      el("div", { class: "mmc-nle-header-cell audio-head" }, [
        el("div", { class: "mmc-nle-track-title-row" }, [
          icon("audio", 13),
          el("span", { class: "mmc-track-label", text: "Soundscape" }),
        ]),
        el("div", { class: "mmc-track-btns" }, [
          el("button", {
            class: `mmc-track-btn${this.trackAudioMuted ? " active" : ""}`,
            title: t("Mute / Unmute soundscape"),
            onclick: () => { this.trackAudioMuted = !this.trackAudioMuted; this.render(); },
          }, [svg(this.trackAudioMuted ? ICONS.volumeMute : ICONS.volume, 11)]),
        ]),
      ]),
      el("div", { class: "mmc-nle-header-cell music-head" }, [
        el("div", { class: "mmc-nle-track-title-row" }, [
          icon("music", 13),
          el("span", { class: "mmc-track-label", text: "Music" }),
        ]),
        el("div", { class: "mmc-track-btns" }, [
          el("button", {
            class: `mmc-track-btn${this.trackMusicMuted ? " active" : ""}`,
            title: t("Mute / Unmute music track"),
            onclick: () => { this.trackMusicMuted = !this.trackMusicMuted; this.render(); },
          }, [svg(this.trackMusicMuted ? ICONS.volumeMute : ICONS.volume, 11)]),
        ]),
      ]),
    ]);

    this.rulerCanvas = el("canvas", { class: "mmc-nle-ruler-canvas", style: { width: `${contentWidth}px` } });
    this.drawRuler(this.rulerCanvas, totalDuration, contentWidth, pxPerSec);

    if (!this.rulerWrap) {
      this.rulerWrap = el("div", {
        class: "mmc-nle-ruler-wrap",
        onpointerdown: (e) => this.handleRulerPointer(e),
      });
    }
    this.rulerWrap.replaceChildren(this.rulerCanvas);

    const videoTrack = el("div", { class: "mmc-nle-track mmc-nle-track-video" });
    let accV = 0;
    segments.forEach((seg, idx) => {
      const dur = S.getEffectiveDuration(seg, idx, isSingle);
      const leftPx = accV * pxPerSec;
      const widthPx = Math.max(80, dur * pxPerSec);
      const isLocked = S.isLocked(seg);
      const isSelected = this.selectedShotIndex === idx;
      const isNarrow = widthPx < 130;

      const filmstripCanvas = el("canvas", { class: "mmc-nle-filmstrip-canvas" });
      this.drawClipFilmstrip(filmstripCanvas, seg, dur, widthPx);

      const vClip = el("div", {
        class: `mmc-nle-video-clip${isLocked ? " locked" : ""}${isSelected ? " selected" : ""}${isNarrow ? " narrow" : ""}${this.activeSegment === idx ? " generating" : ""}`,
        style: { left: `${leftPx}px`, width: `${widthPx - 4}px` },
        onclick: (e) => { e.stopPropagation(); this.selectShot(idx, false); },
        ondblclick: (e) => { e.stopPropagation(); this.selectShot(idx, false); },
        oncontextmenu: (e) => {
          e.preventDefault();
          e.stopPropagation();
          const x = e.clientX;
          const y = e.clientY;
          this.selectShot(idx, false);
          this.openClipMenu({ clientX: x, clientY: y }, idx, seg);
        },
      }, [
        filmstripCanvas,
        el("div", {
          class: "mmc-nle-trim-handle left",
          title: t("Drag to trim start (Ripple Edit)"),
          onpointerdown: (e) => this.startTrimDrag(e, idx, "left", pxPerSec),
        }),
        el("div", { class: `mmc-nle-clip-hud${idx === 0 ? " first-shot" : ""}` }, [
          el("span", { class: "mmc-nle-clip-title", text: `Shot ${idx + 1} (${dur.toFixed(1)}s)${seg.extend_video ? " · ⤷" : ""}` }),
          el("div", { class: "mmc-nle-clip-actions" }, [
            el("button", { class: "mmc-nle-clip-btn", title: t("Select & inspect shot"), onclick: (e) => { e.stopPropagation(); this.selectShot(idx, false); } }, [icon("edit", 11)]),
            el("button", {
              class: `mmc-nle-clip-btn${isLocked ? " locked" : ""}`,
              title: t("Lock segment cache"),
              onclick: (e) => { e.stopPropagation(); seg.locked = !seg.locked; this.commit(); },
            }, [icon(isLocked ? "lock" : "unlock", 11)]),
            el("button", {
              class: "mmc-nle-clip-btn",
              title: t("Duplicate shot (D)"),
              onclick: (e) => { e.stopPropagation(); this.duplicateSelectedShot(); },
            }, [icon("duplicate", 11)]),
            el("button", {
              class: "mmc-nle-clip-btn",
              title: t("Re-roll this shot"),
              onclick: (e) => { e.stopPropagation(); this.reRollSegment(idx); },
            }, [icon("dice", 11)]),
            el("button", {
              class: "mmc-nle-clip-btn",
              title: t("Delete shot (Del)"),
              onclick: (e) => { e.stopPropagation(); this.deleteSegment(idx); },
            }, [icon("trash", 11)]),
          ]),
        ]),
        el("div", {
          class: "mmc-nle-trim-handle right",
          title: t("Drag to trim end (Ripple Edit)"),
          onpointerdown: (e) => this.startTrimDrag(e, idx, "right", pxPerSec),
        }),
      ]);
      videoTrack.appendChild(vClip);

      if (idx > 0 && !isSingle) {
        let seamClass = "seam-hard";
        let seamText = "cut";

        if (seg.continue) {
          if (seg.continuity_mode === "av_mask") {
            seamClass = "seam-av";
            seamText = `${seg.feather}f AV`;
          } else if (seg.continuity_mode === "latent_mask") {
            seamClass = seg.feather === 39 ? "seam-blend-39" : "seam-blend-22";
            seamText = seg.feather === 39 ? "39f" : "22f";
          } else {
            seamClass = "seam-match";
            seamText = "still";
          }
        } else if (seg.continue_audio) {
          seamClass = "seam-sound";
          seamText = "sound";
        }

        const seamConnector = el("div", {
          class: "mmc-nle-seam-connector",
          style: { left: `${leftPx}px` },
        }, [
          el("button", {
            class: `mmc-nle-seam-pill ${seamClass}`,
            title: t("Click to switch transition preset"),
            onclick: (e) => {
              e.stopPropagation();
              this.pickTransitionPreset(e.currentTarget, seg);
            },
          }, [
            icon("wobblyArrow", 10),
            el("span", { class: "mmc-seam-text", text: seamText }),
          ]),
        ]);
        videoTrack.appendChild(seamConnector);
      }

      accV += dur;
    });

    const addShotBtn = el("button", {
      class: "mmc-nle-add-shot",
      style: { left: `${accV * pxPerSec + 14}px` },
      text: "+ Shot",
      onclick: () => {
        this.pushUndoSnapshot("Add Shot");
        this.timeline.segments.push(S.emptySegment());
        this.selectedShotIndex = this.timeline.segments.length - 1;
        this.activeDeckTab = "shot";
        this.commit();
      },
    });
    videoTrack.appendChild(addShotBtn);

    const audioTrack = el("div", { class: "mmc-nle-track mmc-nle-track-audio" });
    const waveCanvas = el("canvas", { class: "mmc-nle-audio-canvas", style: { width: `${contentWidth}px` } });
    drawTimelineWaveform(waveCanvas, this.timeline, "soundscape", pxPerSec, "rgba(240,166,60,0.45)");
    audioTrack.appendChild(waveCanvas);

    const musicTrack = el("div", { class: "mmc-nle-track mmc-nle-track-music" });
    const musicCanvas = el("canvas", { class: "mmc-nle-music-canvas", style: { width: `${contentWidth}px` } });
    drawTimelineWaveform(musicCanvas, this.timeline, this.timeline.master_audio ? "master" : "music", pxPerSec, "rgba(47,123,246,0.45)");
    musicTrack.appendChild(musicCanvas);

    this.playheadNeedle = el("div", { class: "mmc-nle-playhead-needle" }, [
      el("div", { class: "mmc-nle-playhead-head" }),
    ]);

    const timelineContent = el("div", { class: "mmc-nle-timeline-content", style: { width: `${contentWidth}px` } }, [
      this.playheadNeedle,
      videoTrack,
      audioTrack,
      musicTrack,
    ]);

    if (!this.tracksViewport) {
      this.tracksViewport = el("div", {
        class: "mmc-nle-tracks-viewport",
        onscroll: () => {
          this._lastScrollLeft = this.tracksViewport.scrollLeft;
          if (this.rulerCanvas) {
            this.rulerCanvas.style.transform = `translateX(-${this.tracksViewport.scrollLeft}px)`;
          }
        },
      });
    }

    this.tracksViewport.replaceChildren(timelineContent);
    this.tracksViewport.scrollLeft = savedScrollLeft;
    this._lastScrollLeft = savedScrollLeft;

    if (this.rulerCanvas) {
      this.rulerCanvas.style.transform = `translateX(-${savedScrollLeft}px)`;
    }

    const tracksMain = el("div", { class: "mmc-nle-tracks-main" }, [
      this.rulerWrap,
      this.tracksViewport,
    ]);

    this.tracksContainer.classList.toggle("lanes-hidden", !!this.lanesCollapsed);
    this.tracksContainer.replaceChildren(headerCol, tracksMain);

    requestAnimationFrame(() => {
      if (this.tracksViewport) {
        this.tracksViewport.scrollLeft = savedScrollLeft;
        if (this.rulerCanvas) {
          this.rulerCanvas.style.transform = `translateX(-${savedScrollLeft}px)`;
        }
      }
    });

    this.updatePlayheadPosition();
  }

  openClipMenu(event, idx, seg) {
    const isLocked = S.isLocked(seg);
    const actions = [
      { label: t("Inspect shot"), run: () => this.selectShot(idx, false) },
      {
        label: isLocked ? t("Unlock cache") : t("Lock cache"),
        run: () => { this.pushUndoSnapshot("Toggle Shot Lock"); seg.locked = !seg.locked; this.commit(); },
      },
      { label: t("Duplicate shot (D)"), run: () => this.duplicateSelectedShot() },
      { label: t("Re-roll this shot"), run: () => this.reRollSegment(idx) },
    ];
    // Split at playhead when the playhead sits inside this clip
    let acc = 0;
    const isSingle = S.isSingle(this.timeline);
    for (let i = 0; i < idx; i++) acc += S.getEffectiveDuration((this.timeline.segments || [])[i], i, isSingle);
    const clipEnd = acc + S.getEffectiveDuration(seg, idx, isSingle);
    if (this.currentTime > acc + 0.2 && this.currentTime < clipEnd - 0.2) {
      actions.push({ label: t("Split at playhead (S)"), run: () => this.razorSplitAtPlayhead() });
    }
    actions.push({
      label: t("Delete shot (Del)"),
      danger: true,
      run: () => this.deleteSegment(idx),
    });

    const pop = el("div", { class: "mmc-pop mmc-chip-menu" },
      actions.map((action) => el("button", {
        class: `mmc-chip-menu-item${action.danger ? " danger" : ""}`,
        text: action.label,
        onclick: (e) => {
          e.stopPropagation();
          pop.remove();
          try { action.run(); } catch (error) { console.error("[MiniMax Creator] clip menu action failed:", error); }
        },
      }))
    );
    document.body.appendChild(pop);
    // Position at the cursor: the clip that was right-clicked may have been
    // rebuilt by selectShot(), so its element is no longer a valid anchor.
    const box = pop.getBoundingClientRect();
    const left = Math.max(8, Math.min(event.clientX, window.innerWidth - box.width - 8));
    const top = Math.max(8, Math.min(event.clientY, window.innerHeight - box.height - 8));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    dismissable(pop);
  }

  drawClipFilmstrip(canvas, seg, dur, widthPx) {
    if (!canvas || widthPx <= 0) return;
    const h = 58;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(widthPx * dpr);
    canvas.height = Math.round(h * dpr);

    const firstFrame = S.frameAsset(seg || {}, "first_frame");
    const lastFrame = S.frameAsset(seg || {}, "last_frame");
    const refImg = S.refImages(seg || {})[0];
    const thumbPath = firstFrame?.filename || lastFrame?.filename || refImg?.filename || seg?.cached_video;

    if (!thumbPath) return;

    const renderTiles = (img) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, widthPx, h);
      const tileW = Math.round(h * (16 / 9));
      const count = Math.max(1, Math.ceil(widthPx / tileW));
      for (let i = 0; i < count; i++) {
        try {
          ctx.drawImage(img, i * tileW, 0, tileW, h);
        } catch {}
      }
      ctx.restore();
    };

    const isVideo = /\.(mp4|webm|mov|mkv|avi)/i.test(thumbPath);
    const targetUrl = isVideo ? thumbUrl(thumbPath) : viewUrl(thumbPath, { preview: true });

    if (FILMSTRIP_CACHE.has(targetUrl)) {
      const cached = FILMSTRIP_CACHE.get(targetUrl);
      if (cached && cached.complete && cached.naturalWidth > 0) {
        renderTiles(cached);
        return;
      }
    }

    const img = new Image();
    img.onload = () => {
      FILMSTRIP_CACHE.set(targetUrl, img);
      renderTiles(img);
    };
    img.src = targetUrl;
  }

  pickTransitionPreset(anchor, seg) {
    document.querySelectorAll(".mmc-pop").forEach((p) => p.remove());

    const currentId = getActivePresetId(seg);
    const pop = el("div", { class: "mmc-pop mmc-transition-pop" }, [
      el("div", {
        class: "mmc-pop-title",
        style: { padding: "4px 8px 8px", borderBottom: "1px solid var(--mmc-line)" },
        text: t("Seam Transition Preset")
      }),
    ]);

    let close;

    for (const preset of TRANSITION_PRESETS) {
      const isCurrent = preset.id === currentId;
      const opt = el("button", {
        class: "mmc-trans-opt",
        "aria-checked": isCurrent,
        title: preset.desc,
        onclick: (e) => {
          e.stopPropagation();
          if (typeof close === "function") close();
          else pop.remove();
          this.pushUndoSnapshot("Change Transition");
          preset.apply(seg);
          this.commit();
        },
      }, [
        el("span", {
          class: "mmc-trans-badge-dot",
          style: { background: preset.color, boxShadow: `0 0 8px ${preset.color}88` },
        }),
        el("div", { class: "mmc-trans-content" }, [
          el("div", { class: "mmc-trans-title-row" }, [
            el("span", { class: "mmc-trans-title", text: t(preset.name) }),
            el("span", {
              class: "mmc-trans-tag",
              style: { color: preset.color, border: `1px solid ${preset.color}44`, background: `${preset.color}18` },
              text: preset.tag,
            }),
          ]),
          el("div", { class: "mmc-trans-desc", text: t(preset.desc) }),
        ]),
        el("span", { class: "mmc-radio", style: { marginTop: "4px" } }),
      ]);
      pop.appendChild(opt);
    }

    document.body.appendChild(pop);
    placeNear(pop, anchor);
    close = dismissable(pop);
  }

  drawRuler(canvas, totalDuration, width, pxPerSec = 45) {
    requestAnimationFrame(() => {
      if (!canvas.isConnected) return;
      const h = 24;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, h);

      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";

      let stepSec = 1;
      if (pxPerSec < 20) stepSec = 10;
      else if (pxPerSec < 40) stepSec = 5;
      else if (pxPerSec < 70) stepSec = 2;

      // Loop / mark region shading
      if (this.markIn !== null && this.markOut !== null) {
        const x0 = Math.max(0, this.markIn * pxPerSec);
        const x1 = Math.min(width, this.markOut * pxPerSec);
        if (x1 > x0) {
          ctx.fillStyle = "rgba(240,166,60,0.22)";
          ctx.fillRect(x0, 0, x1 - x0, h);
          ctx.fillStyle = "rgba(240,166,60,0.9)";
          ctx.fillRect(x0 - 1, 0, 2, h);
          ctx.fillRect(x1 - 1, 0, 2, h);
          ctx.fillStyle = "rgba(255,255,255,0.45)";
        }
      }

      for (let s = 0; s <= totalDuration + 10; s += stepSec) {
        const x = s * pxPerSec;
        ctx.fillRect(x, h - 9, 1, 9);
        ctx.fillText(formatTime(s), x + 3, h - 8);
      }
    });
  }

  handleRulerPointer(e) {
    e.preventDefault();
    if (this.rulerWrap?.setPointerCapture) {
      try { this.rulerWrap.setPointerCapture(e.pointerId); } catch {}
    }

    const scrollLeft = this.tracksViewport?.scrollLeft || 0;
    const rect = this.rulerWrap.getBoundingClientRect();
    const pxPerSec = 45 * this.zoomScale;

    const update = (ev) => {
      const x = Math.max(0, ev.clientX - rect.left + scrollLeft);
      this.seek(x / pxPerSec);
    };

    update(e);
    const onMove = (ev) => update(ev);
    const onUp = (ev) => {
      if (this.rulerWrap?.releasePointerCapture) {
        try { this.rulerWrap.releasePointerCapture(ev.pointerId); } catch {}
      }
      this.rulerWrap.removeEventListener("pointermove", onMove);
      this.rulerWrap.removeEventListener("pointerup", onUp);
      this.rulerWrap.removeEventListener("pointercancel", onUp);
    };

    this.rulerWrap.addEventListener("pointermove", onMove);
    this.rulerWrap.addEventListener("pointerup", onUp);
    this.rulerWrap.addEventListener("pointercancel", onUp);
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
    this.pushUndoSnapshot("Ripple Trim");
    const segment = this.timeline.segments[segIndex];
    const origDur = Number(segment.duration_s) || 6;
    const startX = e.clientX;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dSec = Math.round(dx / pxPerSec);
      let nextDur = edge === "right" ? origDur + dSec : origDur - dSec;
      nextDur = Math.max(1.5, Math.min(30, nextDur));
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
    this.pushUndoSnapshot("Re-roll Shot");
    const newSeed = Math.floor(Math.random() * 0xffffffff);
    this.widgetIO().set("seed", newSeed);

    this.timeline.segments.forEach((seg, idx) => {
      if (idx === targetIndex) {
        seg.locked = false;
      } else if (seg.cached_video) {
        seg.locked = true;
      }
    });

    this.activeSegment = null;
    this.commit();
    try { app.queuePrompt(0); } catch {}
  }

  renderTransportToolbar() {
    this.timecodeDisplay = el("div", { class: "mmc-nle-timecode-box", text: "00:00.000 / F0" });

    this.playBtn = el("button", {
      class: "mmc-nle-btn primary",
      title: t("Play / Pause (Space)"),
      onclick: () => this.togglePlay(),
    }, [svg(this.isPlaying ? ICONS.pause : ICONS.play, 14)]);

    const zoomReadout = el("span", { class: "mmc-nle-zoom-readout", text: `${Math.round(this.zoomScale * 100)}%` });
    const zoomSlider = el("input", {
      class: "mmc-nle-zoom-slider",
      type: "range", min: "0.12", max: "3", step: "0.02", value: String(this.zoomScale),
      oninput: (e) => {
        this.zoomScale = Number(e.target.value);
        this.fitMode = false;
        e.target.style.setProperty("--fill", `${((this.zoomScale - 0.12) / 2.88) * 100}%`);
        if (zoomReadout) zoomReadout.textContent = `${Math.round(this.zoomScale * 100)}%`;
        try { localStorage.setItem("mmc-nle-zoom", String(this.zoomScale)); } catch {}
        this.updateTimelineTracks();
        this.updatePlayheadPosition();
      },
    });
    this.zoomSliderEl = zoomSlider;
    try { zoomSlider.style.setProperty("--fill", `${((this.zoomScale - 0.12) / 2.88) * 100}%`); } catch {}

    const fitBtn = el("button", {
      class: `mmc-nle-btn${this.fitMode ? " active" : ""}`,
      title: t("Fit every clip into view — stays fitted as shots are added or trimmed"),
      onclick: () => {
        this.fitMode = !this.fitMode;
        fitBtn.classList.toggle("active", this.fitMode);
        if (this.fitMode) this.fitZoom();
      },
    }, [el("span", { text: "FIT" })]);

    return el("div", { class: "mmc-nle-transport-bar" }, [
      el("div", { class: "mmc-nle-transport-group" }, [
        el("button", { class: "mmc-nle-btn", title: t("Jump to Start (|<)"), onclick: () => this.seek(0) }, [icon("skipStart", 13)]),
        el("button", { class: "mmc-nle-btn", title: t("Rewind / Step Back (J / <)"), onclick: () => this.shuttle(-1) }, [icon("stepBack", 13)]),
        this.playBtn,
        el("button", { class: "mmc-nle-btn", title: t("Fast Forward / Step Forward (L / >)"), onclick: () => this.shuttle(1) }, [icon("stepForward", 13)]),
        el("button", { class: "mmc-nle-btn", title: t("Jump to End (>|)"), onclick: () => this.seek(S.timelineSeconds(this.timeline)) }, [icon("skipEnd", 13)]),
        el("button", { class: "mmc-nle-btn mono", title: t("Step back one frame (,)"), onclick: () => this.stepFrame(-1) }, [el("span", { text: "−1f" })]),
        el("button", { class: "mmc-nle-btn mono", title: t("Step forward one frame (.)"), onclick: () => this.stepFrame(1) }, [el("span", { text: "+1f" })]),
      ]),
      this.timecodeDisplay,
      el("div", { class: "mmc-nle-transport-group" }, [
        el("button", { class: "mmc-nle-btn", title: t("Set Mark In ([)"), onclick: () => { this.markIn = this.currentTime; this.render(); } }, [icon("markIn", 13), el("span", { text: "[" })]),
        el("button", { class: "mmc-nle-btn", title: t("Set Mark Out (])"), onclick: () => { this.markOut = this.currentTime; this.render(); } }, [icon("markOut", 13), el("span", { text: "]" })]),
        el("button", { class: "mmc-nle-btn", title: t("Razor Split at Playhead (S)"), onclick: () => this.razorSplitAtPlayhead() }, [svg(ICONS.scissors, 13), el("span", { text: t("Split") })]),
        el("button", { class: "mmc-nle-btn", title: t("Undo (Ctrl+Z)"), onclick: () => this.undo() }, [el("span", { text: "↶" })]),
        el("button", { class: "mmc-nle-btn", title: t("Redo (Ctrl+Y)"), onclick: () => this.redo() }, [el("span", { text: "↷" })]),
        el("div", { class: "mmc-nle-zoom-wrap" }, [
          el("span", { class: "mmc-nle-tag", text: "ZOOM" }),
          zoomSlider,
          zoomReadout,
          fitBtn,
        ]),
        el("button", {
          class: "mmc-nle-btn primary",
          title: t("Queue every unlocked shot"),
          onclick: () => { try { app.queuePrompt(0); } catch {} },
        }, [el("span", { text: t("GENERATE") })]),
      ]),
    ]);
  }

  renderSamplingDeck() {
    const bar = samplingBar({
      widgets: this.widgets,
      value: (name, fallback) => this.value(name, fallback),
      set: (name, val) => {
        const widget = this.getWidget(name);
        if (widget) {
          widget.value = val;
          widget.callback?.(val);
        }
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

    return el("div", { class: `mmc-nle-sampling${this.samplingOpen ? " open" : ""}` }, [
      el("button", {
        class: "mmc-nle-sampling-toggle",
        onclick: () => {
          this.samplingOpen = !this.samplingOpen;
          try { localStorage.setItem("mmc-nle-sampling-open", this.samplingOpen ? "1" : "0"); } catch {}
          this.render();
        },
      }, [
        svg(ICONS.edit ?? ICONS.gear, 12),
        el("span", { text: t("Sampling") }),
        el("span", { class: `mmc-nle-sampling-caret${this.samplingOpen ? " up" : ""}`, text: "▸" }),
      ]),
      el("div", { class: "mmc-nle-sampling-body" }, [bar]),
    ]);
  }
}