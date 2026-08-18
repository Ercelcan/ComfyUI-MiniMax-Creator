import { el, ICONS, svg, drawFrame, mountOverlay } from "./dom.js";
import { listLoras, loraPreviewUrl } from "./api.js";
import { openLoraDetail } from "./loradetail.js";
import { t } from "./i18n.js";
import * as S from "./state.js";

const CHUNK = 48;
const LOOKAHEAD = 500;

const FOLDER_KEY = "mmc.loraFolder";

const MAX_STRENGTH = 2;
const MODE_CHOICES = [
  ["fl2va", "FL2VA", "Only when generating from text or start/end frames."],
  ["ref2va", "Ref2VA", "Only when @ references are attached."],
  ["both", "Both", "Patch whichever checkpoint is routed."],
];

export function openLoras(options) {
  return new Promise((resolve) => {
    new LoraManager(options, resolve).mount();
  });
}

class LoraManager {
  constructor({ state, onChange, targets, checkpointModes = true }, resolve) {
    this.state = state;
    this.checkpointModes = checkpointModes;
    this.targets = targets ?? (checkpointModes ? [S.checkpoint(state)] : [...S.CHECKPOINTS]);
    this.onChange = onChange;
    this.resolve = resolve;
    this.query = "";
    this.rows = [];
    this.folders = [];
    this.cards = new Map();
    this.shown = 0;
    this.loaded = false;
    try {
      this.folder = localStorage.getItem(FOLDER_KEY) || "";
    } catch {
      this.folder = "";
    }
  }

  mount() {
    this.stillWatch = this.watchStills();
    this.grid = el("div", {
      class: "mmc-grid mmc-lora-grid",
      onscroll: () => this.fill(),
    });
    this.picker = el("select", {
      class: "mmc-folder",
      title: t("Which folder under models/loras to browse."),
      onchange: (event) => this.setFolder(event.target.value),
    });
    this.search = el("input", {
      class: "mmc-search",
      type: "search",
      placeholder: t("Search LoRAs..."),
      oninput: (event) => { this.query = event.target.value.toLowerCase(); this.renderGrid(); },
    });
    this.foot = el("div", { class: "mmc-modal-foot" }, [
      this.slots = el("span", { class: "mmc-slots" }),
      el("button", { class: "mmc-add", text: t("Done"), onclick: () => this.close() }),
    ]);

    this.modal = el("div", { class: "mmc-modal" }, [
      el("div", { class: "mmc-modal-head" }, [
        el("button", { class: "mmc-tab", "aria-selected": true, text: t("LoRAs") }),
        el("button", { class: "mmc-close", text: "✕", onclick: () => this.close() }),
      ]),
      el("div", { class: "mmc-modal-bar" }, [
        this.picker,
        this.search,
        el("button", { class: "mmc-ghost", text: t("Rescan"), onclick: () => this.load({ force: true }) }),
      ]),
      this.grid,
      this.foot,
    ]);
    this.modal.style.position = "relative";

    this.overlay = el("div", {
      class: "mmc-overlay",
      onpointerdown: (event) => { if (event.target === this.overlay) this.close(); },
    }, [this.modal]);

    this.unmount = mountOverlay(this.overlay, () => this.close());

    this.renderFoot();
    this.load();
    setTimeout(() => this.search.focus(), 30);
  }

  async load({ force = false } = {}) {
    const folder = this.folder;
    this.loaded = false;
    this.renderGrid();
    let body;
    try {
      body = await listLoras({ folder, force });
      this.loadError = null;
    } catch (error) {
      body = { loras: [], folders: this.folders };
      this.loadError = error.message;
    }
    if (folder !== this.folder) return;
    this.rows = body.loras ?? [];
    this.folders = body.folders ?? [];
    this.matched = body.matched ?? this.rows.length;
    this.truncated = !!body.truncated;
    this.loaded = true;
    this.renderPicker();
    this.renderGrid();
  }

  setFolder(folder) {
    this.folder = folder;
    try {
      localStorage.setItem(FOLDER_KEY, folder);
    } catch {}
    this.load();
  }

  renderPicker() {
    const known = this.folders.some((entry) => entry.path === this.folder);
    const entries = known ? this.folders : [...this.folders, { path: this.folder, count: 0 }];
    this.picker.replaceChildren(...entries.map((entry) => el("option", {
      value: entry.path,
      text: `${entry.path || t("All folders")} (${entry.count})`,
    })));
    this.picker.value = this.folder;
  }

  visible() {
    if (!this.query) return this.rows;
    return this.rows.filter((row) =>
      [row.name, row.title, row.version, row.base_model, ...(row.tags || []), ...(row.trained_words || [])]
        .filter(Boolean).join(" ").toLowerCase().includes(this.query));
  }

  changed() {
    this.onChange?.();
    this.renderFoot();
  }

  toggle(row) {
    const existing = S.findLora(this.state, row.name);
    if (existing) {
      S.removeLora(this.state, row.name);
    } else {
      S.addLora(this.state, row.name, row.trained_words || [], row.strength);
    }
    this.refreshCard(row);
    this.changed();
  }

  toggleTrigger(entry, word) {
    const at = entry.triggers.findIndex((w) => w.toLowerCase() === word.toLowerCase());
    if (at >= 0) entry.triggers.splice(at, 1);
    else entry.triggers.push(word);
    this.changed();
  }

  addTrigger(entry, raw) {
    const word = raw.trim();
    if (!word || entry.triggers.some((w) => w.toLowerCase() === word.toLowerCase())) return false;
    entry.triggers.push(word);
    this.changed();
    return true;
  }

  setModes(entry, row, choice) {
    entry.modes = choice === "both" ? [...S.CHECKPOINTS] : [choice];
    this.refreshCard(row);
    this.changed();
  }

  refreshCard(row) {
    const current = this.cards.get(row.name);
    if (!current) return;
    const next = this.card(row);
    current.replaceWith(next);
    this.cards.set(row.name, next);
    this.fill();
  }

  message(text) {
    this.grid.replaceChildren(el("div", { class: "mmc-empty", text }));
    this.cards.clear();
    this.pending = null;
    this.shown = 0;
  }

  renderGrid() {
    if (!this.loaded) return this.message(t("Loading…"));
    if (this.loadError) return this.message(t("Could not read models/loras: {error}", { error: this.loadError }));

    const rows = this.visible();
    if (!rows.length) {
      const where = this.folder ? `“${this.folder}”` : "models/loras";
      const capped = this.truncated
        ? " " + t("Only the {shown} most recent of {matched} here were listed — try a narrower folder.",
                  { shown: this.rows.length, matched: this.matched })
        : "";
      return this.message((this.query
        ? t("No LoRA matching “{query}” in {where}.", { query: this.query, where })
        : t("No LoRAs in {where} yet.", { where })) + capped);
    }

    this.pending = rows;
    this.shown = 0;
    this.cards.clear();
    this.note = el("div", { class: "mmc-grid-note" });
    this.grid.replaceChildren(this.note);
    this.grid.scrollTop = 0;
    this.fill();
  }

  fill() {
    if (!this.pending || this.shown >= this.pending.length) return;
    const bottom = this.grid.getBoundingClientRect().bottom + LOOKAHEAD;
    while (this.shown < this.pending.length
           && this.note.getBoundingClientRect().top < bottom) {
      this.appendChunk();
    }
  }

  appendChunk() {
    const batch = this.pending.slice(this.shown, this.shown + CHUNK);
    const frag = document.createDocumentFragment();
    for (const row of batch) {
      const card = this.card(row);
      this.cards.set(row.name, card);
      frag.appendChild(card);
    }
    this.grid.insertBefore(frag, this.note);
    this.shown += batch.length;
    this.renderNote();
  }

  renderNote() {
    const left = this.pending.length - this.shown;
    if (left > 0) {
      this.note.textContent = t("{left} more below…", { left });
    } else if (this.truncated) {
      this.note.textContent = t(
        "Only the {shown} most recent of {matched} LoRAs in this scope were "
        + "listed. Choose a narrower folder to reach the older ones.",
        { shown: this.rows.length, matched: this.matched });
    } else {
      this.note.textContent = "";
    }
  }

  still(source) {
    const video = el("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.dataset.src = `${source}#t=0.12`;
    this.stillWatch.observe(video);
    return video;
  }

  watchStills() {
    return new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const video = entry.target;
        this.stillWatch.unobserve(video);
        if (video.dataset.src) {
          video.src = video.dataset.src;
          delete video.dataset.src;
        }
      }
    }, { rootMargin: "300px" });
  }

  hoverClip(art, before, source) {
    let video = null;
    let stage = null;
    let timer = null;

    const follow = () => {
      timer = null;
      if (!video || video.paused) return;
      drawFrame(stage, video, 480);
      timer = requestAnimationFrame(follow);
    };

    art.addEventListener("pointerenter", () => {
      if (!video) {
        stage = el("canvas");
        art.insertBefore(stage, before);
        video = document.createElement("video");
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "auto";
        video.src = source;
      }
      video.play().then(follow, () => {});
    });

    art.addEventListener("pointerleave", () => {
      if (timer) cancelAnimationFrame(timer);
      timer = null;
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video = null;
      }
      stage?.remove();
      stage = null;
    });
  }

  card(row) {
    const entry = S.findLora(this.state, row.name);
    const card = el("div", { class: "mmc-lora", "aria-selected": !!entry });

    const art = el("div", {
      class: "mmc-lora-art",
      role: "button",
      tabindex: "0",
      title: t("{name} — double-click for details", { name: row.name }),
      onclick: () => {
        const now = Date.now();
        const double = this.lastClick
          && this.lastClick.name === row.name && now - this.lastClick.at < 400;
        this.lastClick = double ? null : { name: row.name, at: now };
        if (double) {
          openLoraDetail(row);
        } else {
          this.toggle(row);
        }
      },
      onkeydown: (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.toggle(row); }
      },
    });

    if (row.preview === "image") {
      art.appendChild(el("img", { src: loraPreviewUrl(row.name), loading: "lazy", alt: "" }));
    } else {
      art.appendChild(el("div", { class: "mmc-cell-fallback" }, [svg(ICONS.effect, 26)]));
    }
    if (row.preview === "video") {
      art.appendChild(this.still(loraPreviewUrl(row.name)));
    }
    const check = el("div", { class: "mmc-check" });
    art.appendChild(check);
    if (row.preview === "video") this.hoverClip(art, check, loraPreviewUrl(row.name));
    card.appendChild(art);

    const meta = [row.base_model, row.version].filter(Boolean).join(" · ");
    const body = el("div", { class: "mmc-lora-body" }, [
      el("div", { class: "mmc-lora-name", text: row.title || row.base, title: row.name }),
      el("div", { class: "mmc-lora-sub", text: meta || row.name }),
    ]);

    if (!entry && row.trained_words?.length) {
      body.appendChild(el("div", {
        class: "mmc-lora-words",
        title: t("Trigger words from the sidecar. Adding this LoRA takes them on, and you can then drop or extend them."),
        text: row.trained_words.join(", "),
      }));
    }

    if (!entry && !row.sources?.length) {
      body.appendChild(el("div", {
        class: "mmc-lora-words",
        title: t("No sidecar and nothing in the file's own header. Double-click for what the safetensors header does say."),
        text: t("no metadata"),
      }));
    }
    if (entry) body.appendChild(this.controls(entry, row));
    card.appendChild(body);
    return card;
  }

  triggerBox(entry, row) {
    if (!Array.isArray(entry.triggers)) entry.triggers = [];
    const suggested = row.trained_words || [];
    const isSuggested = (word) => suggested.some((s) => s.toLowerCase() === word.toLowerCase());
    const chosen = (word) => entry.triggers.some((w) => w.toLowerCase() === word.toLowerCase());

    const chips = el("div", { class: "mmc-trigs" });
    const renderChips = () => {
      const own = entry.triggers.filter((word) => !isSuggested(word));
      chips.replaceChildren(...[
        ...suggested.map((word) => el("button", {
          class: "mmc-trig", "aria-pressed": chosen(word),
          title: chosen(word) ? t("In the prompt — click to drop") : t("From the sidecar — click to use"),
          text: word,
          onclick: () => { this.toggleTrigger(entry, word); renderChips(); },
        })),
        ...own.map((word) => el("button", {
          class: "mmc-trig own", "aria-pressed": true,
          title: t("Yours — click to remove"),
          text: word,
          onclick: () => { this.toggleTrigger(entry, word); renderChips(); },
        })),
      ]);
    };
    renderChips();

    const input = el("input", {
      class: "mmc-trig-add",
      type: "text",
      placeholder: suggested.length ? t("add a word") : t("no sidecar words — add your own"),
      onkeydown: (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (this.addTrigger(entry, event.target.value)) renderChips();
        event.target.value = "";
      },
      onkeyup: (event) => event.stopPropagation(),
    });

    return el("div", { class: "mmc-trig-box" }, [
      el("div", { class: "mmc-lora-row" }, [el("span", { class: "mmc-lora-label", text: t("Triggers") })]),
      chips,
      input,
    ]);
  }

  controls(entry, row) {
    const rawVal = Number(entry.strength);
    entry.strength = Number.isFinite(rawVal) ? Math.round(rawVal * 100) / 100 : S.DEFAULT_STRENGTH;

    const readout = el("span", { class: "mmc-lora-strength", text: entry.strength.toFixed(2) });
    const slider = el("input", {
      type: "range", min: "-1.0", max: String(MAX_STRENGTH), step: "0.05", value: String(entry.strength),
      oninput: (event) => {
        entry.strength = Math.round(Number(event.target.value) * 100) / 100;
        readout.textContent = entry.strength.toFixed(2);
        this.changed();
      },
      onchange: () => this.changed(),
      onpointerdown: (event) => event.stopPropagation(),
    });

    const current = S.claimsBoth(entry) ? "both" : S.loraModes(entry)[0];
    const modes = el("div", { class: "mmc-seg" }, MODE_CHOICES.map(([value, label, hint]) =>
      el("button", {
        class: "mmc-seg-btn",
        "aria-pressed": value === current,
        title: t(hint),
        text: t(label),
        onclick: () => this.setModes(entry, row, value),
      })));

    const rows = [
      el("div", { class: "mmc-lora-row" }, [el("span", { class: "mmc-lora-label", text: t("Strength") }), readout]),
      slider,
      ...(this.checkpointModes ? [modes] : []),
      this.triggerBox(entry, row),
    ];

    if (this.checkpointModes && !this.applies(entry)) {
      rows.push(el("div", {
        class: "mmc-lora-idle",
        text: this.targets.length > 1
          ? t("Idle — {targets} are routed here.", { targets: this.routesTo() })
          : t("Idle — {targets} is routed here.", { targets: this.routesTo() }),
      }));
    }
    return el("div", { class: "mmc-lora-ctl" }, rows);
  }

  applies(entry) {
    return S.loraModes(entry).some((mode) => this.targets.includes(mode));
  }

  routesTo() {
    return this.targets.map((name) => S.CHECKPOINT_LABEL[name]).join(" + ") || t("nothing");
  }

  renderFoot() {
    const entries = this.state.loras || [];
    const active = entries.filter((entry) => this.applies(entry)).length;
    const extra = entries.length > active
      ? " " + t("({count} idle)", { count: entries.length - active })
      : "";
    this.slots.textContent = t("{active} on {targets}", { active, targets: this.routesTo() }) + extra;
    this.slots.classList.toggle("full", false);
  }

  close() {
    this.cards.forEach((card) => {
      const videos = card.querySelectorAll("video");
      videos.forEach((v) => {
        try { v.pause(); v.muted = true; v.currentTime = 0; v.removeAttribute("src"); v.load(); } catch {}
      });
    });
    this.stillWatch.disconnect();
    this.unmount();
    this.resolve();
  }
}