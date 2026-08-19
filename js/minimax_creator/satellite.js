import { app } from "../../../scripts/app.js";
import { el } from "./dom.js";

const GAP = 14;

export class Satellite {
  constructor({ node, stage, side = "right" }) {
    this.node = node;
    this.stage = stage;
    this.defaultSide = side;
    this.raf = 0;
    this.root = el("div", { class: "mmc-satellite" }, [stage?.root].filter(Boolean));
    document.body.appendChild(this.root);

    if (stage) {
      stage.onVisibility = (showing) => {
        if (!showing) stage.stopMedia?.();
        this.setShowing(showing);
      };
      stage.onCyclePosition = () => this.cycleSide();
      this.setShowing(stage.showing());
      this.setupResize(stage.resizeHandle);
    }
  }

  get sideKey() {
    const type = this.node?.comfyClass || this.node?.type || (this.defaultSide === "left" ? "MiniMaxH3PreStage" : "MiniMaxH3Creator");
    return `mmc-satellite-side-${type}`;
  }

  get sizeKeyW() {
    const type = this.node?.comfyClass || this.node?.type || (this.defaultSide === "left" ? "MiniMaxH3PreStage" : "MiniMaxH3Creator");
    return `mmc-satellite-w-${type}`;
  }

  get sizeKeyH() {
    const type = this.node?.comfyClass || this.node?.type || (this.defaultSide === "left" ? "MiniMaxH3PreStage" : "MiniMaxH3Creator");
    return `mmc-satellite-h-${type}`;
  }

  get side() {
    try {
      return localStorage.getItem(this.sideKey) || this.defaultSide;
    } catch {
      return this.defaultSide;
    }
  }

  get customSize() {
    try {
      const w = Number(localStorage.getItem(this.sizeKeyW));
      const h = Number(localStorage.getItem(this.sizeKeyH));
      return {
        w: Number.isFinite(w) && w >= 200 ? w : null,
        h: Number.isFinite(h) && h >= 150 ? h : null,
      };
    } catch {
      return { w: null, h: null };
    }
  }

  setupResize(resizeEl) {
    if (!resizeEl) return;
    resizeEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const canvas = app?.canvas;
      const scale = canvas?.ds?.scale ?? 1;
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = this.root.offsetWidth / scale;
      const startH = this.root.offsetHeight / scale;
      const side = this.side;

      try {
        resizeEl.setPointerCapture(e.pointerId);
      } catch {}

      const onMove = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        let dx = (ev.clientX - startX) / scale;
        let dy = (ev.clientY - startY) / scale;
        let newW = side === "left" ? startW - dx : startW + dx;
        let newH = side === "top" ? startH - dy : startH + dy;
        newW = Math.max(200, Math.round(newW));
        newH = Math.max(150, Math.round(newH));
        try {
          localStorage.setItem(this.sizeKeyW, String(newW));
          localStorage.setItem(this.sizeKeyH, String(newH));
        } catch {}
        this.follow();
      };

      const onUp = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          if (resizeEl.hasPointerCapture(ev.pointerId)) {
            resizeEl.releasePointerCapture(ev.pointerId);
          }
        } catch {}
        resizeEl.removeEventListener("pointermove", onMove);
        resizeEl.removeEventListener("pointerup", onUp);
        resizeEl.removeEventListener("pointercancel", onUp);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      resizeEl.addEventListener("pointermove", onMove);
      resizeEl.addEventListener("pointerup", onUp);
      resizeEl.addEventListener("pointercancel", onUp);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    resizeEl.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        localStorage.removeItem(this.sizeKeyW);
        localStorage.removeItem(this.sizeKeyH);
      } catch {}
      this.follow();
    });
  }

  cycleSide() {
    const order = ["right", "bottom", "left", "top"];
    const current = this.side;
    const next = order[(order.indexOf(current) + 1) % order.length];
    try {
      localStorage.setItem(this.sideKey, next);
    } catch {}
    this.follow();
  }

  setShowing(showing) {
    this.root.classList.toggle("showing", Boolean(showing));
    cancelAnimationFrame(this.raf);
    if (showing) this.follow();
    else if (this.stage) this.stage.stopMedia?.();
  }

  follow() {
    const canvas = app?.canvas;
    const node = this.node;
    if (!node || !canvas || !canvas.canvas || !canvas.ds) {
      this.raf = requestAnimationFrame(() => this.follow());
      return;
    }

    const away = canvas.graph !== node.graph || Boolean(node.flags?.collapsed);
    this.root.style.visibility = away ? "hidden" : "";
    if (away && this.stage) {
      this.stage.stopMedia?.();
    }

    if (!away && this.stage?.showing()) {
      try {
        const rect = canvas.canvas.getBoundingClientRect();
        const scale = canvas.ds.scale ?? 1;
        const offset = canvas.ds.offset ?? [0, 0];
        const ox = offset[0];
        const oy = offset[1];
        const title = globalThis.LiteGraph?.NODE_TITLE_HEIGHT ?? 30;

        const currentSide = this.side;
        this.root.classList.toggle("mmc-satellite-left", currentSide === "left");
        this.root.classList.toggle("mmc-satellite-bottom", currentSide === "bottom");
        this.root.classList.toggle("mmc-satellite-top", currentSide === "top");

        const pos = node.pos ?? [0, 0];
        const size = node.size ?? [400, 300];
        const { w: customW, h: customH } = this.customSize;

        let x, y;
        if (currentSide === "left") {
          x = (pos[0] - GAP + ox) * scale + rect.left;
          y = (pos[1] - title + oy) * scale + rect.top;
          this.root.style.transformOrigin = "top right";
          this.root.style.transform = `translate(${x}px, ${y}px) translateX(-100%) scale(${scale})`;
        } else if (currentSide === "bottom") {
          x = (pos[0] + ox) * scale + rect.left;
          y = (pos[1] + size[1] + GAP + oy) * scale + rect.top;
          this.root.style.transformOrigin = "top left";
          this.root.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        } else if (currentSide === "top") {
          x = (pos[0] + ox) * scale + rect.left;
          y = (pos[1] - title - GAP + oy) * scale + rect.top;
          this.root.style.transformOrigin = "bottom left";
          this.root.style.transform = `translate(${x}px, ${y}px) translateY(-100%) scale(${scale})`;
        } else {
          x = (pos[0] + size[0] + GAP + ox) * scale + rect.left;
          y = (pos[1] - title + oy) * scale + rect.top;
          this.root.style.transformOrigin = "top left";
          this.root.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        }

        const defaultMaxH = Math.min(Math.round(window.innerHeight * 0.6), 480);
        const autoH = Math.min(defaultMaxH, (currentSide === "bottom" || currentSide === "top") ? size[1] : size[1] + title);
        this.root.style.height = `${customH ?? autoH}px`;
        if (customW) {
          this.root.style.width = `${customW}px`;
        } else {
          this.root.style.width = "";
        }
      } catch {}
    }
    this.raf = requestAnimationFrame(() => this.follow());
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }
}