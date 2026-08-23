import { el, icon, ICONS, svg, dismissable, placeNear } from "./dom.js";
import { openPicker } from "./picker.js";
import { openLoras } from "./loras.js";
import { openFrameGrab } from "./framegrab.js";
import { openChoicePopover, stepperPill, aspectGlyph, edgeSlider, PILL_GLYPH } from "./pills.js";
import { CreatorEditor } from "./editor.js";
import { samplingBar, handlePreGenerateSeed } from "./sampling.js";
import { Stage } from "./stage.js";
import { loadCatalog, catalogByFolder } from "./models.js";
import { viewUrl } from "./api.js";
import { t } from "./i18n.js";
import { PromptBox } from "./prompt.js";
import { RefinePanel, refineButton, refine } from "./refine.js";
import * as S from "./state.js";
import { setupDragAndDrop } from "./media_drop.js";
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const QUALITY_TITLE = {
  quality: "48 steps on the tight schedule — the hosted service's 'Quality' tier.",
  default: "20 steps — the hosted service's default tier.",
  turbo: "12 steps on the shifted schedule — the hosted service's 'Turbo' tier.",
};

const TURBO_TITLE = {
  draft: "4 steps — the fast look. Softer detail.",
  medium: "6 steps — quick and usable.",
  good: "8 steps — what the Turbo checkpoint was distilled for.",
};

/**
 * Randomizes seed if configured and queues execution strictly for the PreStage node
 * and its upstream dependencies without triggering other video output nodes on canvas.
 */
async function queuePreStageOnly(nodeId, widgetIO) {
  const idStr = String(typeof nodeId === "function" ? nodeId() : nodeId);
  if (widgetIO && typeof widgetIO.value === "function" && typeof widgetIO.set === "function") {
    handlePreGenerateSeed(widgetIO.value, widgetIO.set);
  }
  try {
    const p = await app.graphToPrompt();
    if (!p || !p.output || !p.output[idStr]) {
      app.queuePrompt(0);
      return;
    }

    const needed = new Set([idStr]);
    const toCheck = [idStr];

    while (toCheck.length > 0) {
      const curId = toCheck.pop();
      const nodeData = p.output[curId];
      if (!nodeData || !nodeData.inputs) continue;
      for (const val of Object.values(nodeData.inputs)) {
        if (Array.isArray(val) && val.length === 2) {
          const depId = String(val[0]);
          if (!needed.has(depId) && p.output[depId]) {
            needed.add(depId);
            toCheck.push(depId);
          }
        }
      }
    }

    const filteredOutput = {};
    for (const id of needed) {
      if (p.output[id]) {
        filteredOutput[id] = p.output[id];
      }
    }

    await api.queuePrompt(0, {
      output: filteredOutput,
      workflow: p.workflow,
    });
  } catch (err) {
    console.error("[MiniMax Creator] queuePreStageOnly error:", err);
    try { app.queuePrompt(0); } catch {}
  }
}

export class PreStageEditor {
  constructor({ state, onCommit, samplingWidgets, onWidgetChange, nodeId,
                stage = null, archPill = null }) {
    this.state = state;
    this.onCommit = onCommit;
    this.samplingWidgets = samplingWidgets || {};
    this.onWidgetChange = onWidgetChange;
    this.nodeId = nodeId;
    this.stage = stage;
    this.archPill = archPill;
    this.sizes = new Map();

    this.prompt = new PromptBox({
      getState: () => this.state,
      onInput: (text) => {
        this.state.prompt = text;
        this.onCommit?.();
      },
      onAttach: (row) => this.attachFromMention(row),
      attachBlocked: () => null,
      getPool: () => [],
      onQueue: () => { try { app.queuePrompt(0); } catch {} },
      removeAsset: (handle) => {
        this.state.refs = (this.state.refs ?? []).filter((r) => r.handle !== handle);
        this.commit();
      },
    });

    this.refinePanel = new RefinePanel({
      getState: () => this.state,
      getNodeId: () => this.nodeId,
      onCommit: () => {
        this.onCommit?.();
        this.syncPrompt();
      },
      audioFields: false,
      onRevert: () => {
        this.syncPrompt();
        this.commit();
      },
    });

    this.railHost = el("div");
    this.assetsHost = el("div");
    this.loraHost = el("div");
    this.pillsHost = el("div");
    this.noticeHost = el("div");
    this.samplingHost = el("div");

    this.promptScroll = el("div", { class: "mmc-prompt-scroll" }, [
      this.prompt.chipsBar,
      this.prompt.root,
      this.refinePanel.root,
    ]);

    this.root = el("div", { class: `mmc-root mmc-prestage` }, [
      this.railHost,
      this.assetsHost,
      this.loraHost,
      el("div", { class: "mmc-panel" }, [this.promptScroll, this.pillsHost]),
      this.noticeHost,
      this.samplingHost,
    ]);
    setupDragAndDrop(this.root, this);

    this.prompt.setValue(this.state.prompt ?? "");
    this.render();
    this.probeInit();

    loadCatalog(() => this.adoptWeights());
  }

  destroy() {
    this.refinePanel?.destroy?.();
  }

  adoptWeights() {
    if (S.guessPreStageModels(this.state.models, catalogByFolder())) {
      this.commit();
    } else {
      this.render();
    }
  }

  widgetIO() {
    return {
      value: (name, fallback) => this.samplingWidgets?.[name]?.value ?? fallback,
      set: (name, value) => {
        const widget = this.samplingWidgets?.[name];
        if (!widget) return;
        widget.value = value;
        widget.callback?.(value);
        this.onWidgetChange?.();
        this.render(); // Re-render to update the seed readout immediately in DOM
      },
    };
  }

  commit() {
    this.onCommit?.();
    this.render();
  }

  setState(state) {
    this.state = state;
    this.sizes.clear();
    this.prompt.setValue(this.state.prompt ?? "");
    this.refinePanel.problems = [];
    this.render();
    this.probeInit();
  }

  syncPrompt() {
    const refined = this.state.refined;
    this.prompt.setSuperseded(Boolean(refined?.body?.trim() && refined.enabled !== false));
  }

  async refineImagePrompt() {
    try {
      const result = await refine({
        kind: "prestage",
        data: JSON.parse(S.serializePreStage(this.state)),
        node_id: typeof this.nodeId === "function" ? this.nodeId() : this.nodeId,
      });
      const shot = result.shots?.[0];
      if (!shot?.body) throw new Error(t("the refiner returned no prompt text"));
      this.refinePanel.apply(result, shot);
      this.commit();
    } catch (error) {
      this.refinePanel.fail(String(error.message || error));
    }
  }

  attachFromMention(row) {
    if (row.kind === "image") {
      const room = S.PRESTAGE_MAX_REFS - this.state.refs.length;
      if (room <= 0) {
        this.flash(t("At most {max} style references.", { max: S.PRESTAGE_MAX_REFS }));
        return null;
      }
      const handle = S.nextPreStageHandle(this.state);
      this.state.refs.push({ handle, filename: row.path || row.filename });
      this.commit();
      return handle;
    }
    return null;
  }

  async setInit(fromVideo = false) {
    let path = null;
    if (fromVideo) {
      const clip = await openPicker({
        kinds: ["video", "renders"], kind: "video", single: true,
        capacity: () => ({ used: 0, max: 1, filesLeft: 1 }),
      });
      if (!clip) return;
      const grabbed = await openFrameGrab({ path: clip[0].path });
      if (!grabbed) return;
      path = grabbed.path;
    } else {
      const chosen = await openPicker({
        kinds: ["image", "renders"], kind: "image", single: true,
        capacity: () => ({ used: 0, max: 1, filesLeft: 1 }),
      });
      if (!chosen) return;
      path = chosen[0].path;
    }
    this.state.init = { filename: path, denoise: this.state.init?.denoise ?? S.PRESTAGE_DEFAULT_DENOISE };
    this.commit();
    this.probeInit();
  }

  async addRefs(fromVideo = false) {
    if (this.state.arch === "ideogram4") {
      return this.flash(t("Ideogram 4.0 has no local reference conditioning — switch the model pill to Krea 2 to use style references."));
    }
    const room = S.PRESTAGE_MAX_REFS - this.state.refs.length;
    if (room <= 0) {
      return this.flash(t("At most {max} style references — the Qwen edit encoder the model reads them through has exactly three image slots.", { max: S.PRESTAGE_MAX_REFS }));
    }
    if (fromVideo) {
      const clip = await openPicker({
        kinds: ["video", "renders"], kind: "video", single: true,
        capacity: () => ({ used: 0, max: 1, filesLeft: 1 }),
      });
      if (!clip) return;
      const grabbed = await openFrameGrab({ path: clip[0].path });
      if (!grabbed) return;
      this.state.refs.push({ handle: S.nextPreStageHandle(this.state), filename: grabbed.path });
      return this.commit();
    }
    const chosen = await openPicker({
      kinds: ["image", "renders"], kind: "image",
      capacity: () => ({ used: this.state.refs.length, max: S.PRESTAGE_MAX_REFS, filesLeft: room }),
    });
    if (!chosen) return;
    for (const asset of chosen.slice(0, room)) {
      this.state.refs.push({ handle: S.nextPreStageHandle(this.state), filename: asset.path });
    }
    this.commit();
  }

  async manageLoras() {
    await openLoras({ state: this.state, checkpointModes: false, onChange: () => this.commit() });
    this.commit();
  }

  probeInit() {
    const init = this.state.init;
    if (!init || this.sizes.has(init.filename)) return;
    const probe = new Image();
    probe.onload = () => {
      this.sizes.set(init.filename, { width: probe.naturalWidth, height: probe.naturalHeight });
      this.render();
    };
    probe.src = viewUrl(init.filename);
  }

  flash(message) {
    this.notice = message;
    this.render();
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => { this.notice = null; this.render(); }, 6000);
  }

  render() {
    const state = this.state;
    this.railHost.replaceChildren(this.renderRail());
    const chips = [
      ...(state.init ? [this.renderInitChip()] : []),
      ...(state.refs || []).map((ref) => this.renderRefChip(ref)),
    ];
    this.assetsHost.replaceChildren(...(chips.length ? [el("div", { class: "mmc-assets" }, chips)] : []));
    this.loraHost.replaceChildren(...((state.loras || []).length ? [this.renderLoras()] : []));
    this.pillsHost.replaceChildren(this.renderPills());
    this.noticeHost.replaceChildren(
      ...(this.notice ? [el("div", { class: "mmc-warn", text: this.notice })] : []));
    this.samplingHost.replaceChildren(samplingBar({
      widgets: this.samplingWidgets,
      ...this.widgetIO(),
      set: (name, value) => { this.widgetIO().set(name, value); this.render(); },
      perSegment: false,
      turbo: state.arch === "krea2" ? this.renderTurbo() : [],
      trailing: [this.renderWeightsPill()],
    }));
    this.prompt.refresh();
    this.syncPrompt();
    this.refinePanel.render();
  }

  renderRail() {
    const tool = (label, iconName, title, onclick) => el("button", {
      class: "mmc-tool", title, onclick,
    }, [el("span", { class: "mmc-tool-icon" }, [icon(iconName)]), el("span", { text: label })]);

    const refineBtn = refineButton({
      run: () => this.refineImagePrompt(),
      label: t("Refine"),
      mode: "rail",
    });

    return el("div", { class: "mmc-rail" }, [
      el("div", { class: "mmc-rail-group" }, [
        tool(t("Init image"), "frameIn",
             t("Start from an image instead of noise — img2img. The strength pill says how much of it survives."),
             () => this.setInit(false)),
        tool(t("Style refs"), "image",
             this.state.arch === "ideogram4"
               ? t("Ideogram 4.0 has no local reference conditioning — style references are a Krea 2 feature.")
               : t("Up to three images whose look this render should carry."),
             () => this.addRefs(false)),
        tool(t("From video"), "video",
             t("Pull a single frame off a video's playhead — as the init image."),
             () => this.setInit(true)),
        tool(t("Add LoRA"), "effect",
             t("Manage the LoRAs patched onto the image model."),
             () => this.manageLoras()),
        refineBtn,
      ]),
      el("div", { class: "mmc-rail-group" }, [
        el("button", {
          class: "mmc-tool mmc-tool-primary",
          title: t("Generate only this still image (without triggering video generation)"),
          onclick: () => queuePreStageOnly(this.nodeId, this.widgetIO()),
        }, [el("span", { class: "mmc-tool-icon" }, [icon("play")]), el("span", { text: t("Generate") })]),
        el("button", {
          class: `mmc-tool${this.stage?.showing() ? " active" : ""}`,
          title: t("Open or close the satellite preview box"),
          onclick: () => {
            this.stage?.toggleOpen();
            this.render();
          },
        }, [el("span", { class: "mmc-tool-icon" }, [icon("play")]), el("span", { text: t("Preview") })]),
      ]),
    ]);
  }

  renderInitChip() {
    const init = this.state.init;
    return el("div", { class: "mmc-asset mmc-tag-0", title: init.filename }, [
      el("img", { class: "mmc-asset-thumb", src: viewUrl(init.filename, { preview: true }), alt: init.filename }),
      el("span", { class: "mmc-asset-handle", text: t("init") }),
      el("button", {
        class: "mmc-ghost",
        style: { fontSize: "11px" },
        title: t("img2img strength"),
        text: init.denoise.toFixed(2),
        onclick: () => {
          init.denoise = Math.max(S.PRESTAGE_MIN_DENOISE, Math.round((init.denoise - 0.05) * 100) / 100);
          this.commit();
        },
        oncontextmenu: (event) => {
          event.preventDefault();
          init.denoise = Math.min(1, Math.round((init.denoise + 0.05) * 100) / 100);
          this.commit();
        },
      }),
      el("button", {
        class: "mmc-asset-x", text: "✕", title: t("Remove the init image"),
        onclick: () => { this.state.init = null; this.commit(); },
      }),
    ]);
  }

  renderRefChip(ref) {
    return el("div", {
      class: `mmc-asset mmc-tag-${S.tagIndex(ref.handle)}`,
      title: ref.filename,
    }, [
      el("img", { class: "mmc-asset-thumb", src: viewUrl(ref.filename, { preview: true }), alt: ref.filename }),
      el("span", { class: "mmc-asset-handle", text: `@${ref.handle}` }),
      el("span", { class: "mmc-asset-role", text: t("style") }),
      el("button", {
        class: "mmc-asset-x", text: "✕", title: t("Remove @{handle}", { handle: ref.handle }),
        onclick: () => {
          this.state.refs = this.state.refs.filter((r) => r.handle !== ref.handle);
          this.commit();
        },
      }),
    ]);
  }

  renderLoras() {
    const chip = (entry) => el("div", { class: "mmc-asset", title: entry.name }, [
      el("span", { class: "mmc-asset-thumb" }, [svg(ICONS.effect, 15)]),
      el("span", { class: "mmc-asset-handle", text: entry.name.split("/").pop().replace(/\.[^.]+$/, "") }),
      el("button", {
        class: "mmc-ghost",
        style: { fontSize: "11px" },
        title: t("Strength"),
        text: Number(entry.strength ?? 1).toFixed(2),
        onclick: () => this.manageLoras(),
      }),
      el("button", {
        class: "mmc-asset-x", text: "✕", title: t("Remove {name}", { name: entry.name }),
        onclick: () => { S.removeLora(this.state, entry.name); this.commit(); },
      }),
    ]);

    const parts = [el("div", { class: "mmc-assets" }, this.state.loras.map(chip))];
    const triggers = S.promptTriggers(this.state);
    if (triggers.length) {
      parts.push(el("div", {
        class: "mmc-note",
        title: t("Triggers"),
      }, [
        el("span", { class: "mmc-note-key", text: t("triggers") }),
        el("span", { text: triggers.join(", ") }),
      ]));
    }
    return el("div", { class: "mmc-lora-block" }, parts);
  }

  renderPills() {
    const state = this.state;
    const geometry = S.resolvedPreStage(state, state.init ? this.sizes.get(state.init.filename) : null);

    const archPill = this.archPill?.() ?? el("span");

    const aspectPill = el("button", {
      class: "mmc-pill",
      disabled: geometry.fromImage || undefined,
      title: geometry.fromImage
        ? t("The aspect follows the init image — the resolution pill still sets the scale.")
        : t("Aspect Ratio"),
      onclick: (event) => this.openAspect(event.currentTarget),
    }, geometry.fromImage
      ? [aspectGlyph(geometry.ratio, PILL_GLYPH), el("span", { class: "mmc-pill-sub", text: t("from image") })]
      : [aspectGlyph(geometry.ratio, PILL_GLYPH), el("span", { text: state.aspect })]);

    const resPill = el("button", {
      class: "mmc-pill",
      title: t("Short edge. Both models are comfortable up to a 2048×2048 area."),
      onclick: (event) => this.openResolution(event.currentTarget),
    }, [
      icon("res", 16),
      el("span", { text: `${state.short_edge}p` }),
      el("span", { class: "mmc-pill-sub", text: `${geometry.width} × ${geometry.height}` }),
    ]);

    const pills = [archPill, aspectPill, resPill];

    if (state.arch === "ideogram4") {
      pills.push(el("button", {
        class: "mmc-pill",
        title: t(QUALITY_TITLE[state.quality]),
        onclick: (event) => openChoicePopover(event.currentTarget, {
          title: t("Ideogram preset"),
          options: [...S.PRESTAGE_IDEOGRAM_QUALITIES],
          value: state.quality,
          onPick: (picked) => {
            state.quality = picked;
            this.widgetIO().set("steps", S.PRESTAGE_IDEOGRAM_STEPS[picked]);
            this.commit();
          },
        }),
      }, [icon("steps", 16), el("span", { text: `${state.quality} · ${S.PRESTAGE_IDEOGRAM_STEPS[state.quality]}` })]));
    }

    if (state.init) {
      pills.push(stepperPill({
        value: state.init.denoise, min: S.PRESTAGE_MIN_DENOISE, max: 1, step: 0.05, width: "52px",
        title: t("img2img strength"),
        format: (n) => t("img {value}", { value: n.toFixed(2) }),
        onChange: (next) => { state.init.denoise = next; this.commit(); },
      }));
    }

    return el("div", { class: "mmc-pills" }, pills);
  }

  renderTurbo() {
    const state = this.state;
    const turbo = state.turbo;
    const io = this.widgetIO();
    const pills = [];

    pills.push(el("div", { class: `mmc-pill mmc-pill-group${turbo.on ? " accel-on" : ""}` }, [
      el("button", {
        class: "mmc-turbo-main",
        title: turbo.on
          ? t("Turbo on", { steps: io.value("steps", "?") })
          : t("Turbo off"),
        onclick: () => {
          if (turbo.on) {
            const saved = turbo.saved ?? S.PRESTAGE_KREA_RAW;
            io.set("steps", saved.steps);
            io.set("cfg", saved.cfg);
            io.set("sampler_name", saved.sampler_name);
            io.set("scheduler", saved.scheduler);
            turbo.on = false;
            turbo.saved = null;
          } else {
            turbo.saved = {
              steps: Number(io.value("steps", S.PRESTAGE_KREA_RAW.steps)),
              cfg: Number(io.value("cfg", S.PRESTAGE_KREA_RAW.cfg)),
              sampler_name: String(io.value("sampler_name", S.PRESTAGE_KREA_RAW.sampler_name)),
              scheduler: String(io.value("scheduler", S.PRESTAGE_KREA_RAW.scheduler)),
            };
            turbo.on = true;
            io.set("steps", S.PRESTAGE_TURBO_STEPS[turbo.quality]);
            io.set("cfg", S.PRESTAGE_KREA_TURBO.cfg);
            io.set("sampler_name", S.PRESTAGE_KREA_TURBO.sampler_name);
            io.set("scheduler", S.PRESTAGE_KREA_TURBO.scheduler);
          }
          this.commit();
        },
      }, [icon("bolt", 16), el("span", { text: t(turbo.on ? "turbo" : "turbo off") })]),
    ]));

    if (turbo.on) {
      const steps = Number(io.value("steps", 0));
      pills.push(el("div", { class: "mmc-pill mmc-turbo-seg" }, S.PRESTAGE_TURBO_QUALITIES.map((quality) =>
        el("button", {
          class: "mmc-turbo-opt",
          "aria-pressed": steps === S.PRESTAGE_TURBO_STEPS[quality],
          title: t(TURBO_TITLE[quality]),
          onclick: () => {
            turbo.quality = quality;
            io.set("steps", S.PRESTAGE_TURBO_STEPS[quality]);
            this.commit();
          },
        }, [
          el("span", { text: t(quality === "medium" ? "med" : quality) }),
          el("span", { class: "mmc-pill-sub", text: String(S.PRESTAGE_TURBO_STEPS[quality]) }),
        ]))));
    }

    return pills;
  }

  renderWeightsPill() {
    const missing = S.missingPreStageModels(this.state);
    const dtype = this.state.models?.dtype || "default";
    const label = missing.length
      ? (missing.length === 1
          ? t("no {field}", { field: t(S.PRESTAGE_FIELD_LABEL[missing[0]] || "").toLowerCase() })
          : t("{count} weights missing", { count: missing.length }))
      : dtype === "default"
        ? t("weights") : t("weights · {dtype}", { dtype: dtype.replace("fp8_", "fp8 ") });
    return el("button", {
      class: `mmc-pill mmc-weights${missing.length ? " missing" : ""}`,
      title: missing.length
        ? t("Not picked yet: {fields}.", { fields: missing.map((f) => t(S.PRESTAGE_FIELD_LABEL[f] || "")).join(", ") })
        : t("Which files {arch} loads.", { arch: S.PRESTAGE_ARCH_LABEL[this.state.arch] }),
      onclick: (event) => this.openWeights(event.currentTarget),
    }, [icon("weights", 16), el("span", { text: label })]);
  }

  openWeights(anchor) {
    const NONE = t("— none —");
    const state = this.state;
    const pop = el("div", { class: "mmc-pop mmc-weights-pop" });
    const body = el("div");

    const render = () => {
      const byFolder = catalogByFolder();
      const lists = {
        model: byFolder.diffusion_models ?? [], turbo_model: byFolder.diffusion_models ?? [],
        uncond_model: byFolder.diffusion_models ?? [],
        clip: byFolder.text_encoders ?? [], vae: byFolder.vae ?? [],
      };
      const side = state.models?.[state.arch] || {};
      const missing = new Set(S.missingPreStageModels(state));

      const rows = (S.PRESTAGE_FIELDS[state.arch] || []).map((field) => el("div", {
        class: `mmc-weight-row${missing.has(field) ? " missing" : ""}`,
      }, [
        el("span", { class: "mmc-weight-name", text: t(S.PRESTAGE_FIELD_LABEL[field] || field) }),
        el("button", {
          class: `mmc-weight-file${side[field] ? "" : " empty"}`,
          title: t(S.PRESTAGE_FIELD_HINT[state.arch]?.[field] || ""),
          text: side[field] || t("not set"),
          onclick: (event) => openChoicePopover(event.currentTarget, {
            title: t(S.PRESTAGE_FIELD_LABEL[field] || field),
            options: [NONE, ...lists[field]],
            value: side[field] || NONE,
            onPick: (picked) => {
              side[field] = picked === NONE ? "" : picked;
              this.commit();
              render();
            },
          }),
        }),
      ]));

      const curDtype = state.models?.dtype || "default";
      rows.push(el("div", { class: "mmc-weight-row" }, [
        el("span", { class: "mmc-weight-name", text: t("Precision") }),
        el("button", {
          class: "mmc-weight-file",
          title: t("Precision"),
          text: curDtype,
          onclick: (event) => openChoicePopover(event.currentTarget, {
            title: t("Precision"),
            options: S.MODEL_DTYPES,
            value: curDtype,
            onPick: (picked) => {
              state.models = state.models || {};
              state.models.dtype = picked;
              this.commit();
              render();
            },
          }),
        }),
      ]));

      body.replaceChildren(...rows);
    };

    pop.append(el("div", { class: "mmc-pop-title", text: t("Weights — {arch}", { arch: S.PRESTAGE_ARCH_LABEL[state.arch] }) }), body);
    render();
    document.body.appendChild(pop);
    placeNear(pop, anchor);
    dismissable(pop);
    loadCatalog(() => pop.isConnected && render());
  }

  openAspect(anchor) {
    const pop = el("div", { class: "mmc-pop" }, [el("div", { class: "mmc-pop-title", text: t("Aspect Ratio") })]);
    for (const [label, ratio] of S.PRESTAGE_ASPECTS) {
      pop.appendChild(el("button", {
        class: "mmc-opt",
        "aria-checked": this.state.aspect === label,
        onclick: () => { this.state.aspect = label; close(); this.commit(); },
      }, [
        el("span", { class: "mmc-opt-label" }, [aspectGlyph(ratio), el("span", { text: label })]),
        el("span", { class: "mmc-radio" }),
      ]));
    }
    document.body.appendChild(pop);
    placeNear(pop, anchor);
    const close = dismissable(pop);
  }

  openResolution(anchor) {
    const body = edgeSlider({
      min: S.PRESTAGE_MIN_EDGE, max: S.PRESTAGE_MAX_EDGE, step: S.PRESTAGE_CANVAS_MULTIPLE,
      value: this.state.short_edge,
      mark: S.PRESTAGE_DEFAULT_EDGE, markLabel: t("default"),
      apply: (edge) => { this.state.short_edge = edge; },
      describe: () => {
        const geometry = S.resolvedPreStage(this.state,
          this.state.init ? this.sizes.get(this.state.init.filename) : null);
        return {
          size: `${geometry.width} × ${geometry.height}`,
          note: this.state.short_edge >= S.PRESTAGE_MAX_EDGE
            ? t("The models' 2048 ceiling — wide ratios trade the short edge down to hold the area.")
            : t("{speed} {edge} is the comfortable default for both models.", {
                speed: t(this.state.short_edge < S.PRESTAGE_DEFAULT_EDGE ? "Faster, softer." : "Sharper, slower."),
                edge: S.PRESTAGE_DEFAULT_EDGE,
              }),
        };
      },
      commit: () => this.commit(),
    });
    const pop = el("div", { class: "mmc-pop mmc-slider" }, [body]);
    document.body.appendChild(pop);
    placeNear(pop, anchor);
    dismissable(pop);
  }
}

export class PreStageBody {
  constructor({ state, onCommit, samplingWidgets, onWidgetChange, nodeId, peer = null }) {
    this.state = state;
    this.onCommit = onCommit;
    this.samplingWidgets = samplingWidgets;
    this.onWidgetChange = onWidgetChange;
    this.nodeId = nodeId;
    this.peer = peer;

    this.stage = new Stage({
      nodeId: this.nodeId,
      resultChips: (saved) => this.renderResultChips(saved),
    });

    this.host = el("div", { class: "mmc-prestage-host" });
    this.root = this.host;
    this.mount();
  }

  destroy() {
    this.editor?.destroy();
    this.stage?.destroy();
  }

  commit() {
    this.onCommit?.();
    this.editor?.render();
  }

  setState(state) {
    this.state = state;
    this.mount();
  }

  mount() {
    this.editor?.destroy();
    this.editor = S.isStill(this.state) ? this.mountStill() : this.mountImage();
    this.host.replaceChildren(this.editor.root);
  }

  mountImage() {
    return new PreStageEditor({
      state: this.state,
      onCommit: () => this.onCommit?.(),
      samplingWidgets: this.samplingWidgets,
      onWidgetChange: this.onWidgetChange,
      nodeId: this.nodeId,
      stage: this.stage,
      archPill: () => this.renderArchPill(),
    });
  }

  mountStill() {
    const still = this.state.minimax;
    const editor = new CreatorEditor({
      state: still.request,
      onCommit: () => this.onCommit?.(),
      samplingWidgets: this.samplingWidgets,
      onWidgetChange: this.onWidgetChange,
      nodeId: this.nodeId,
      stage: this.stage,
      durationPill: false,
      settingsTool: false,
      extraPills: () => [this.renderArchPill(), ...this.renderStillPills()],
      extraTools: () => [
        this.renderFrameGrabTool(),
        refineButton({
          run: async () => {
            try {
              const result = await refine({
                kind: "prestage",
                data: JSON.parse(S.serializePreStage(this.state)),
                node_id: typeof this.nodeId === "function" ? this.nodeId() : this.nodeId,
              });
              const shot = result.shots?.[0];
              if (shot?.body) {
                still.request.prompt = shot.body;
                editor.prompt?.setValue(shot.body);
                this.commit();
              }
            } catch (err) {
              editor.flash?.(err.message || String(err));
            }
          },
          label: t("Refine"),
          mode: "rail",
        }),
      ],
      setRoute: (route) => {
        still.request.models.route = route;
        this.commit();
      },
    });
    return editor;
  }

  widgetIO() {
    return {
      value: (name, fallback) => this.samplingWidgets?.[name]?.value ?? fallback,
      set: (name, value) => {
        const widget = this.samplingWidgets?.[name];
        if (!widget) return;
        widget.value = value;
        widget.callback?.(value);
        this.onWidgetChange?.();
        this.editor?.render();
      },
    };
  }

  setArch(arch) {
    if (arch === this.state.arch) return;
    const io = this.widgetIO();
    const from = this.promptOf();

    this.state.turbo.on = false;
    this.state.turbo.saved = null;
    this.state.arch = arch;

    if (arch === "krea2") {
      const row = S.PRESTAGE_KREA_RAW;
      io.set("steps", row.steps);
      io.set("cfg", row.cfg);
      io.set("sampler_name", row.sampler_name);
      io.set("scheduler", row.scheduler);
    } else if (arch === "ideogram4") {
      io.set("steps", S.PRESTAGE_IDEOGRAM_STEPS[this.state.quality]);
      io.set("cfg", S.PRESTAGE_IDEOGRAM_ROW.cfg);
      io.set("sampler_name", S.PRESTAGE_IDEOGRAM_ROW.sampler_name);
    } else {
      const row = S.PRESTAGE_STILL_ROW;
      io.set("steps", row.steps);
      io.set("cfg", row.cfg);
      io.set("sampler_name", row.sampler_name);
      io.set("scheduler", row.scheduler);
    }

    if (from && !this.promptOf()) this.setPrompt(from);
    this.onCommit?.();
    this.mount();
  }

  promptOf() {
    return (S.isStill(this.state) ? this.state.minimax?.request?.prompt : this.state.prompt) ?? "";
  }

  setPrompt(text) {
    if (S.isStill(this.state)) {
      this.state.minimax = this.state.minimax || {};
      this.state.minimax.request = this.state.minimax.request || {};
      this.state.minimax.request.prompt = text;
    } else {
      this.state.prompt = text;
    }
  }

  renderArchPill() {
    const state = this.state;
    const ARCH_TITLE = {
      krea2: "Krea 2 — 12.9B open-weights DiT.",
      ideogram4: "Ideogram 4.0 — 9.3B open-weights DiT.",
      minimax: "MiniMax H3 — experimental still generation.",
    };
    return el("button", {
      class: `mmc-pill mmc-prestage-arch${S.isStill(state) ? " mmc-experimental" : ""}`,
      title: t("{arch} Click to switch.", { arch: t(ARCH_TITLE[state.arch] || "") }),
      onclick: (event) => openChoicePopover(event.currentTarget, {
        title: t("Image model"),
        options: S.PRESTAGE_ARCHES.map((arch) => S.PRESTAGE_ARCH_LABEL[arch]),
        value: S.PRESTAGE_ARCH_LABEL[state.arch],
        onPick: (picked) => this.setArch(
          S.PRESTAGE_ARCHES.find((arch) => S.PRESTAGE_ARCH_LABEL[arch] === picked) ?? "krea2"),
      }),
    }, [icon("model", 16), el("span", { text: S.PRESTAGE_ARCH_LABEL[state.arch] || state.arch })]);
  }

  renderStillPills() {
    const still = this.state.minimax || {};
    const framesCount = still.frames || 5;
    const latents = S.stillLatentFrames(framesCount);

    const lengthLabel = (n) => t("{frames} frames · {latents} latent",
                                 { frames: n, latents: S.stillLatentFrames(n) });
    const length = el("button", {
      class: "mmc-pill",
      title: t("Sampled length"),
      onclick: (event) => openChoicePopover(event.currentTarget, {
        title: t("Sampled length"),
        options: S.PRESTAGE_STILL_LENGTHS.map(lengthLabel),
        value: lengthLabel(framesCount),
        onPick: (picked) => {
          const frames = S.PRESTAGE_STILL_LENGTHS.find((n) => lengthLabel(n) === picked);
          if (frames == null) return;
          still.frames = frames;
          const total = S.stillLatentFrames(still.frames);
          if (still.latent_index >= total) still.latent_index = total - 1;
          if (still.latent_index < -total) still.latent_index = 0;
          this.commit();
        },
      }),
    }, [icon("clock", 16), el("span", { text: `${framesCount}f` }),
        el("span", { class: "mmc-pill-sub", text: t("{latents} latent", { latents }) })]);

    const index = stepperPill({
      value: still.latent_index || 0, min: -latents, max: latents - 1, step: 1, width: "56px",
      title: t("Which latent frame becomes the picture."),
      format: (n) => t("latent {n}", { n }),
      onChange: (next) => { still.latent_index = Math.round(next); this.commit(); },
    });

    return [length, index];
  }

  renderFrameGrabTool() {
    return el("button", {
      class: "mmc-tool",
      title: t("Pull frame from video"),
      onclick: () => this.grabFrame(),
    }, [el("span", { class: "mmc-tool-icon" }, [icon("video")]), el("span", { text: t("From video") })]);
  }

  async grabFrame() {
    const request = this.state.minimax?.request;
    if (!request) return;
    const blocked = S.blockedReason(request, "first_frame");
    if (blocked) return;
    const clip = await openPicker({
      kinds: ["video", "renders"], kind: "video", single: true,
      capacity: () => ({ used: 0, max: 1, filesLeft: 1 }),
    });
    if (!clip) return;
    const grabbed = await openFrameGrab({ path: clip[0].path });
    if (!grabbed) return;
    const existing = S.frameAsset(request, "first_frame");
    if (existing) request.assets = request.assets.filter((a) => a.handle !== existing.handle);
    request.assets.push({
      handle: S.nextHandle(request, "image"),
      kind: "image",
      role: "first_frame",
      filename: grabbed.path,
    });
    this.commit();
  }

  renderResultChips(saved) {
    const target = this.peer?.();
    if (!target) return [];
    const filename = `${saved.subfolder ? `${saved.subfolder}/` : ""}${saved.filename} [output]`;
    const chip = (role, label, title) => el("button", {
      class: "mmc-stage-chip mmc-stage-send",
      text: t(label),
      title: t("{action} on {target}.", { action: t(title), target: target.label }),
      onpointerdown: (event) => event.stopPropagation(),
      onclick: () => target.attach(role, filename),
    });

    const sendAndQueueChip = el("button", {
      class: "mmc-stage-chip mmc-stage-send-queue",
      text: t("⚡ Send & Queue"),
      title: t("Attach this still as start frame and immediately queue video generation on {target}.", { target: target.label }),
      onpointerdown: (event) => event.stopPropagation(),
      onclick: () => {
        target.attach("first_frame", filename);
        try {
          app.queuePrompt(0);
        } catch {}
      },
    });

    return [
      sendAndQueueChip,
      chip("first_frame", "→ start", "Use this still as the start frame"),
      chip("last_frame", "→ end", "Use this still as the end frame"),
      chip("reference", "→ ref", "Attach this still as a reference"),
    ];
  }
}