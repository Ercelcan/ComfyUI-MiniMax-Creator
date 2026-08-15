import { api } from "../../../scripts/api.js";
import { el, mountOverlay } from "./dom.js";
import { listAssets, deleteAsset, outputUrl } from "./api.js";
import { t } from "./i18n.js";

const EVENTS = ["progress_state", "b_preview_with_metadata", "b_preview",
                "kj_preview_override", "executed", "execution_error", "execution_start",
                "mmc_segment", "mmc_segment_cached"];

export class Stage {
  constructor({ nodeId, onVisibility, onGallery, resultChips, segmentLabel }) {
    this.nodeId = nodeId;
    this.onVisibility = onVisibility;
    this.onGallery = onGallery;
    this.resultChips = resultChips;
    this.segmentLabel = segmentLabel;
    this.state = "idle";
    this.segment = null;
    this.progress = null;
    this.frame = null;
    this.result = null;
    this.error = null;
    this.startedAt = 0;
    this.currentMediaSrc = null;
    this.historyList = [];

    this.media = el("div", { class: "mmc-stage-media" });
    this.rule = el("div", { class: "mmc-stage-rule" });
    this.readout = el("div", { class: "mmc-stage-readout" });
    this.resizeHandle = el("div", { class: "mmc-stage-resize", title: t("Drag to resize preview box (double-click to reset)") });
    this.root = el("div", { class: "mmc-stage" }, [this.media, this.rule, this.readout, this.resizeHandle]);

    this.onEvent = (event) => this.handle(event.type, event.detail);
    for (const name of EVENTS) api.addEventListener(name, this.onEvent);

    this.loadSavedResult();
    this.render();
  }

  destroy() {
    for (const name of EVENTS) api.removeEventListener(name, this.onEvent);
    this.stopMedia();
    this.releaseFrame();
    clearInterval(this.ticker);
  }

  getId() {
    if (typeof this.nodeId === "function") {
      try { return this.nodeId(); } catch { return null; }
    }
    return this.nodeId;
  }

  loadSavedResult() {
    try {
      const id = this.getId();
      if (!id) return;
      const closed = localStorage.getItem(`mmc-stage-closed-${id}`);
      if (closed === "true") return;
      const raw = localStorage.getItem(`mmc-stage-result-${id}`);
      if (raw) {
        this.result = JSON.parse(raw);
        this.state = "done";
      }
    } catch {}
  }

  saveResult(result) {
    try {
      const id = this.getId();
      if (!id || !result) return;
      localStorage.setItem(`mmc-stage-result-${id}`, JSON.stringify(result));
      localStorage.removeItem(`mmc-stage-closed-${id}`);
    } catch {}
  }

  releaseFrame() {
    if (this.frameUrl) URL.revokeObjectURL(this.frameUrl);
    this.frameUrl = null;
  }

  stopMedia() {
    if (!this.media) return;
    try {
      const mediaElements = this.media.querySelectorAll("video, audio");
      mediaElements.forEach((m) => {
        try {
          m.pause();
          m.muted = true;
          m.currentTime = 0;
          m.removeAttribute("src");
          m.load();
        } catch {}
      });
      this.media.replaceChildren();
    } catch {}
    this.currentMediaSrc = null;
  }

  ours(id) {
    if (id === null || id === undefined) return false;
    const mine = String(this.getId() ?? "");
    const other = String(id);
    return other === mine || (mine && other.startsWith(`${mine}.`));
  }

  showing() {
    return this.state !== "idle";
  }

  get keepLastVideo() {
    try {
      return localStorage.getItem("mmc-stage-keep-video") === "true";
    } catch {
      return false;
    }
  }

  get previewDisabled() {
    try {
      return localStorage.getItem("mmc-preview-disabled") === "true";
    } catch {
      return false;
    }
  }

  toggleKeepVideo() {
    const next = !this.keepLastVideo;
    try { localStorage.setItem("mmc-stage-keep-video", String(next)); } catch {}
    this.stopMedia();
    this.render();
  }

  toggleOpen() {
    const id = this.getId();
    if (this.showing()) {
      if (id) {
        try { localStorage.setItem(`mmc-stage-closed-${id}`, "true"); } catch {}
      }
      this.reset();
    } else {
      if (id) {
        try { localStorage.removeItem(`mmc-stage-closed-${id}`); } catch {}
      }
      if (!this.result) {
        this.fetchHistory().then(() => {
          if (this.historyList.length) {
            const item = this.historyList[0];
            const saved = { filename: item.name, subfolder: item.subfolder, type: "output" };
            this.result = {
              url: outputUrl(saved),
              name: item.name,
              isImage: item.kind === "image",
              saved,
            };
            this.state = "done";
            this.saveResult(this.result);
          } else {
            this.state = "done";
          }
          this.render();
        });
      } else {
        if (this.state === "idle") this.state = "done";
        this.render();
      }
    }
  }

  async fetchHistory() {
    try {
      const assets = await listAssets({ root: "output", force: true });
      this.historyList = assets ?? [];
    } catch {
      this.historyList = [];
    }
  }

  async navHistory(delta) {
    await this.fetchHistory();
    if (!this.historyList.length) return;
    let idx = -1;
    if (this.result?.name) {
      idx = this.historyList.findIndex((a) => a.name === this.result.name || a.path.includes(this.result.name));
    }
    if (idx < 0) idx = 0;
    let nextIdx = idx + delta;
    if (nextIdx < 0) nextIdx = this.historyList.length - 1;
    if (nextIdx >= this.historyList.length) nextIdx = 0;

    const item = this.historyList[nextIdx];
    if (!item) return;

    this.stopMedia();
    const saved = { filename: item.name, subfolder: item.subfolder, type: "output" };
    this.result = {
      url: outputUrl(saved),
      name: item.name,
      isImage: item.kind === "image",
      saved,
    };
    this.state = "done";
    this.saveResult(this.result);
    this.render();
  }

  confirmDeleteCurrentResult() {
    if (!this.result?.name) return;
    const filename = this.result.name;

    let unmount;
    const modal = el("div", { class: "mmc-modal mmc-confirm-modal" }, [
      el("div", { class: "mmc-modal-head" }, [
        el("span", { class: "mmc-tab", "aria-selected": "true", text: t("Delete Render") }),
      ]),
      el("div", { class: "mmc-confirm-body" }, [
        el("div", { class: "mmc-confirm-msg", text: t("Are you sure you want to permanently delete {name}?", { name: filename }) }),
        el("div", { class: "mmc-confirm-sub", text: t("This action cannot be undone.") }),
      ]),
      el("div", { class: "mmc-modal-foot" }, [
        el("button", { class: "mmc-ghost", text: t("Cancel"), onclick: () => unmount?.() }),
        el("button", { class: "mmc-del armed", text: t("Delete"), onclick: async () => {
          unmount?.();
          await this.deleteCurrentResult();
        }}),
      ]),
    ]);

    const overlay = el("div", {
      class: "mmc-overlay",
      onpointerdown: (e) => { if (e.target === overlay) unmount?.(); },
    }, [modal]);

    unmount = mountOverlay(overlay, () => unmount?.());
  }

  async deleteCurrentResult() {
    if (!this.result?.name) return;
    try {
      await deleteAsset(this.result.name);
    } catch {}
    await this.navHistory(1);
    if (!this.historyList.length) {
      this.reset();
    }
  }

  handle(type, detail) {
    if (!detail) return;
    switch (type) {
      case "execution_start":
        this.stopMedia();
        this.progress = null;
        this.segment = null;
        this.error = null;
        if (!this.previewDisabled) {
          if (this.state === "done" && !this.keepLastVideo) {
            this.state = "sampling";
            this.releaseFrame();
            this.frame = null;
          }
        }
        this.renderReadout();
        break;

      case "progress_state": {
        let best = null;
        for (const entry of Object.values(detail.nodes ?? {})) {
          const parentId = entry.parent_node_id ?? entry.parentNodeId;
          const nodeId = entry.node_id ?? entry.nodeId;
          const displayId = entry.display_node_id ?? entry.display_node;
          if (!this.ours(parentId) && !this.ours(nodeId) && !this.ours(displayId)) continue;
          if (entry.state !== "running") continue;
          if (!best || (entry.max ?? 0) > (best.max ?? 0)) best = entry;
        }
        if (!best) break;
        if (this.state !== "sampling" && !this.previewDisabled) {
          this.begin();
          this.render();
        }
        this.progress = { step: best.value ?? 0, total: best.max ?? 0 };
        this.renderReadout();
        break;
      }

      case "b_preview_with_metadata": {
        const parentId = detail.parentNodeId ?? detail.parent_node_id;
        const nodeId = detail.nodeId ?? detail.node_id;
        const displayId = detail.display_node ?? detail.display_node_id;
        if (parentId || nodeId || displayId) {
          if (!this.ours(parentId) && !this.ours(nodeId) && !this.ours(displayId)) break;
        }
        this.metaFrameAt = Date.now();
        if (this.state !== "sampling" && !this.previewDisabled) this.begin();
        this.releaseFrame();
        this.frameUrl = URL.createObjectURL(detail.blob);
        this.frame = this.frameUrl;
        this.frameIsClip = false;
        if (!this.previewDisabled) this.render();
        break;
      }

      case "b_preview": {
        const blob = detail instanceof Blob ? detail : detail.blob;
        if (!blob) break;
        if (this.metaFrameAt && Date.now() - this.metaFrameAt < 2000) break;
        if (this.state !== "sampling" && !this.previewDisabled) this.begin();
        this.releaseFrame();
        this.frameUrl = URL.createObjectURL(detail.blob);
        this.frame = this.frameUrl;
        this.frameIsClip = false;
        if (!this.previewDisabled) this.render();
        break;
      }

      case "kj_preview_override": {
        if (!this.ours(detail.node_id)) break;
        if (Number.isFinite(detail.total)) {
          this.progress = { step: detail.step ?? 0, total: detail.total };
        }
        if (!detail.image) break;
        if (this.state !== "sampling" && !this.previewDisabled) this.begin();
        this.releaseFrame();
        this.frame = `data:${detail.mime || "image/jpeg"};base64,${detail.image}`;
        this.frameIsClip = (detail.mime || "").startsWith("video/");
        if (!this.previewDisabled) this.render();
        break;
      }

      case "executed": {
        if (String(detail.display_node) !== String(this.getId() ?? "")) break;
        const saved = detail.output?.mmc_video?.[0] ?? detail.output?.mmc_image?.[0] ?? detail.output?.videos?.[0] ?? detail.output?.gifs?.[0] ?? detail.output?.images?.[0];
        if (!saved) break;
        this.stopMedia();
        if (!this.previewDisabled) {
          this.state = "done";
        }
        this.progress = null;
        this.result = {
          url: outputUrl(saved),
          name: saved.filename,
          isImage: !detail.output?.mmc_video && !detail.output?.videos && !detail.output?.gifs,
          saved,
        };
        this.saveResult(this.result);
        clearInterval(this.ticker);
        this.releaseFrame();
        this.frame = null;
        if (!this.previewDisabled) this.render();
        break;
      }

      case "mmc_segment":
        if (!this.ours(detail.node)) break;
        this.segment = detail.index ?? null;
        this.renderReadout();
        break;

      case "execution_error":
        if (!this.ours(detail.node_id)) break;
        this.state = "failed";
        this.progress = null;
        clearInterval(this.ticker);
        this.error = detail.exception_message || t("the render failed");
        this.render();
        break;
    }
  }

  reset() {
    const id = this.getId();
    if (id) {
      try {
        localStorage.setItem(`mmc-stage-closed-${id}`, "true");
        localStorage.removeItem(`mmc-stage-result-${id}`);
      } catch {}
    }
    clearInterval(this.ticker);
    this.stopMedia();
    this.metaFrameAt = 0;
    this.state = "idle";
    this.result = null;
    this.error = null;
    this.progress = null;
    this.segment = null;
    this.releaseFrame();
    this.frame = null;
    this.frameIsClip = false;
    this.render();
  }

  begin() {
    if (this.state === "sampling") return;
    this.stopMedia();
    this.state = "sampling";
    this.startedAt = Date.now();
    clearInterval(this.ticker);
    this.ticker = setInterval(() => this.renderReadout(), 1000);
  }

  setMediaContent(elementOrFactory, targetSrc) {
    if (targetSrc && this.currentMediaSrc === targetSrc && this.media?.firstElementChild) {
      return;
    }
    this.stopMedia();
    this.currentMediaSrc = targetSrc;
    const element = typeof elementOrFactory === "function" ? elementOrFactory() : elementOrFactory;
    if (this.media && element) {
      this.media.replaceChildren(element);
    }
  }

  render() {
    const showing = this.showing();
    this.root.style.display = showing ? "flex" : "none";
    this.root.dataset.state = this.state;
    this.onVisibility?.(showing);
    if (!showing) {
      this.stopMedia();
      return;
    }

    if (this.state === "done" && this.result) {
      this.setMediaContent(() => (this.result.isImage ? this.still() : this.video()), this.result.url);
    }
    else if (this.state === "sampling" && this.keepLastVideo && this.result) {
      this.setMediaContent(() => (this.result.isImage ? this.still() : this.video()), this.result.url);
    }
    else if (this.frame) {
      this.setMediaContent(() => this.previewFrame(), this.frame);
    }
    else if (this.result) {
      this.setMediaContent(() => (this.result.isImage ? this.still() : this.video()), this.result.url);
    }
    else {
      this.stopMedia();
    }

    if (this.state === "sampling" && this.progress?.total) {
      this.rule.style.transform = `scaleX(${Math.min(1, this.progress.step / this.progress.total)})`;
      this.rule.style.opacity = "1";
    } else {
      this.rule.style.opacity = "0";
    }

    this.renderReadout();
  }

  renderReadout() {
    if (!this.showing()) return;

    const prevBtn = el("button", {
      class: "mmc-stage-chip mmc-stage-nav",
      text: t("◀"),
      title: t("Previous generated render"),
      onclick: () => this.navHistory(1),
      onpointerdown: (e) => e.stopPropagation(),
    });

    const nextBtn = el("button", {
      class: "mmc-stage-chip mmc-stage-nav",
      text: t("▶"),
      title: t("Next generated render"),
      onclick: () => this.navHistory(-1),
      onpointerdown: (e) => e.stopPropagation(),
    });

    const delBtn = el("button", {
      class: "mmc-stage-chip mmc-stage-del",
      text: t("🗑"),
      title: t("Delete this render"),
      onclick: () => this.confirmDeleteCurrentResult(),
      onpointerdown: (e) => e.stopPropagation(),
    });

    const posBtn = el("button", {
      class: "mmc-stage-chip mmc-stage-pos",
      text: t("⤢"),
      title: t("Cycle preview location (Right / Bottom / Left / Top)"),
      onclick: () => this.onCyclePosition?.(),
      onpointerdown: (e) => e.stopPropagation(),
    });

    const modeBtn = el("button", {
      class: `mmc-stage-chip mmc-stage-mode${this.keepLastVideo ? " on" : ""}`,
      text: this.keepLastVideo ? t("🎬 Keep Video") : t("👁 Live"),
      title: this.keepLastVideo
        ? t("Showing last generated video during sampling. Click to show live sampling preview instead.")
        : t("Showing live sampling preview. Click to keep last generated video visible during sampling."),
      onclick: () => this.toggleKeepVideo(),
      onpointerdown: (event) => event.stopPropagation(),
    });

    const closeBtn = el("button", {
      class: "mmc-stage-chip mmc-stage-close",
      text: "✕",
      title: t("Close preview"),
      onclick: () => this.reset(),
      onpointerdown: (event) => event.stopPropagation(),
    });

    if (this.state === "failed") {
      this.readout.replaceChildren(
        el("span", { class: "mmc-stage-chip warn", text: this.error }),
        modeBtn,
        posBtn,
        closeBtn
      );
      return;
    }

    if (this.state !== "sampling") {
      this.readout.replaceChildren(
        prevBtn,
        nextBtn,
        ...(this.onGallery ? [
          el("button", {
            class: "mmc-stage-chip mmc-stage-gallery",
            text: t("Gallery"),
            title: t("Browse finished renders"),
            onclick: () => this.onGallery(),
            onpointerdown: (e) => e.stopPropagation(),
          }),
        ] : []),
        ...(this.result?.saved && this.resultChips ? this.resultChips(this.result.saved) : []),
        delBtn,
        posBtn,
        closeBtn
      );
      return;
    }

    this.readout.replaceChildren(
      ...(this.segment ? [el("span", {
        class: "mmc-stage-chip mmc-stage-segment",
        text: this.segmentLabel?.(this.segment) ?? t("Segment {n}", { n: this.segment }),
      })] : []),
      el("span", {
        class: "mmc-stage-chip",
        text: this.progress?.total ? `${this.progress.step} / ${this.progress.total}` : t("sampling"),
      }),
      el("span", { class: "mmc-stage-chip", text: elapsed(Date.now() - this.startedAt) }),
      modeBtn,
      posBtn,
      closeBtn
    );
  }

  previewFrame() {
    if (!this.frameIsClip) {
      return el("img", { class: "mmc-stage-img", src: this.frame, alt: "" });
    }
    const clip = el("video", {
      class: "mmc-stage-video",
      src: this.frame,
      autoplay: true, loop: true, playsinline: true,
    });
    clip.muted = true;
    return clip;
  }

  still() {
    if (!this.result?.url) return el("div");
    return el("img", {
      class: "mmc-stage-img",
      src: this.result.url,
      alt: this.result.name || "",
      onpointerdown: (event) => event.stopPropagation(),
    });
  }

  video() {
    if (!this.result?.url) return el("div");
    return el("video", {
      class: "mmc-stage-video",
      src: this.result.url,
      controls: true, autoplay: true, loop: true, muted: true, playsinline: true,
      onmouseenter: (event) => { event.currentTarget.muted = false; },
      onmouseleave: (event) => { event.currentTarget.muted = true; },
      onpointerdown: (event) => event.stopPropagation(),
    });
  }
}

function elapsed(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}