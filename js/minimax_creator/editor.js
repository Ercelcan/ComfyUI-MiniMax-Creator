import { el, icon, ICONS, svg } from "./dom.js";
import { t } from "./i18n.js";
import { openPicker } from "./picker.js";
import { openLoras } from "./loras.js";
import { openSettings } from "./settings.js";
import { openTrim, trimLabel } from "./trim.js";
import { PromptBox } from "./prompt.js";
import { RefinePanel, refineButton, refine } from "./refine.js";
import { openAspectPopover, openResolutionPopover, aspectGlyph, PILL_GLYPH } from "./pills.js";
import { samplingBar, handlePreGenerateSeed } from "./sampling.js";
import { Stage } from "./stage.js";
import { weightsPill, loadCatalog, catalogFiles } from "./models.js";
import * as Turbo from "./turbo.js";
import { viewUrl, probeAudio } from "./api.js";
import * as S from "./state.js";
import { setupDragAndDrop } from "./media_drop.js";
import { MIN_SECONDS, MAX_SECONDS, describeRatio, isTrainedLength } from "./canvas.js";
import { app } from "../../../scripts/app.js";

const TRACK_CHIP = {
  "picture+sound": { text: "sound on", next: "picture" },
  "picture": { text: "sound off", next: "picture+sound" },
  "sound": { text: "sound only", next: "picture+sound" },
};

export class CreatorEditor {
  constructor({
    state, onCommit, canvasPills = true, continuePill = false,
    refineTarget = null, onRefined = null, onReverted = null,
    samplingWidgets = null, onWidgetChange = null, nodeId = null,
    routeOf = null, setRoute = null, preStage = null,
    durationPill = true, extraPills = null, extraTools = null,
    settingsTool = true, stage = null, compact = false,
  }) {
    this.compact = compact;
    this.preStage = preStage;
    this.durationPill = durationPill;
    this.settingsTool = settingsTool;
    this.extraPills = extraPills;
    this.extraTools = extraTools;
    this.state = state;
    this.routeOf = routeOf ?? (() => this.state.models?.route ?? "auto");
    this.setRoute = setRoute;
    this.onCommit = onCommit;
    this.canvasPills = canvasPills;
    this.continuePill = continuePill;
    this.refineTarget = refineTarget;
    this.onRefined = onRefined;
    this.onReverted = onReverted;
    this.samplingWidgets = samplingWidgets || {};
    this.onWidgetChange = onWidgetChange;
    this.nodeId = nodeId;
    this.sizes = new Map();

    this.prompt = new PromptBox({
      getState: () => this.state,
      onInput: (text) => {
        this.state.prompt = text;
        this.onCommit?.();
        this.renderNotices();
      },
      onAttach: (row) => this.attachFromMention(row),
      attachBlocked: (action) => S.blockedReason(this.state, action),
      getPool: () => this.state.pool ?? [],
      onQueue: () => { try { app.queuePrompt(0); } catch {} },
      removeAsset: (handle) => this.remove(handle),
      chipActions: (handle) => this.chipMenuActions(handle),
    });

    this.refinePanel = new RefinePanel({
      getState: () => this.state,
      getNodeId: () => this.nodeId,
      onCommit: () => { this.onCommit?.(); this.syncPrompt(); },
      audioFields: !this.onRefined,
      onRevert: () => this.onReverted?.(),
    });

    this.railHost = el("div");
    this.assetsHost = el("div");
    this.loraHost = el("div");
    this.pillsHost = el("div");
    this.noticeHost = el("div");
    this.samplingHost = el("div");

    this.stage = stage ?? (this.nodeId && !this.compact ? new Stage({
      nodeId: this.nodeId,
      onGallery: () => this.openGallery(),
    }) : null);
    this.ownsStage = !stage && !this.compact;

    this.promptScroll = el("div", { class: "mmc-prompt-scroll" }, [
      this.prompt.chipsBar,
      this.prompt.root,
      this.refinePanel.root,
    ]);

    this.root = el("div", { class: `mmc-root${this.compact ? " mmc-editor-compact" : ""}` }, [
      this.railHost,
      this.assetsHost,
      this.loraHost,
      el("div", { class: "mmc-panel" }, [
        this.promptScroll,
        this.pillsHost,
      ]),
      this.noticeHost,
      this.samplingHost,
    ]);
    setupDragAndDrop(this.root, this);

    if (this.nodeId) loadCatalog(() => this.adoptWeights());

    this.prompt.setValue(this.state.prompt ?? "");
    this.render();
    this.probeKeyframe();
  }

  destroy() {
    if (this.ownsStage) this.stage?.destroy();
    this.refinePanel?.destroy?.();
  }

  getNode() {
    const id = typeof this.nodeId === "function" ? this.nodeId() : this.nodeId;
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
    return this.samplingWidgets?.[name] || null;
  }

  value(name, fallback) {
    const widget = this.getWidget(name);
    return widget?.value !== undefined ? widget.value : fallback;
  }

  adoptWeights() {
    if (S.guessModels(this.state.models, catalogFiles())) this.commit();
    else this.render();
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

  commit() {
    S.normalizeCheckpoint(this.state);
    if (this.state.turbo) Turbo.sync(this.state, this.widgetIO());
    this.onCommit?.();
    this.render();
  }

  setState(state) {
    this.state = state;
    this.sizes.clear();
    this.prompt.setValue(this.state.prompt ?? "");
    this.refinePanel.problems = [];
    this.render();
    this.probeKeyframe();
  }

  async refine() {
    try {
      const targetPayload = this.refineTarget ? this.refineTarget() : {};
      const result = await refine({
        ...targetPayload,
        node_id: typeof this.nodeId === "function" ? this.nodeId() : this.nodeId,
      });
      const shot = result.shots?.[0];
      if (!shot?.body) throw new Error(t("the refiner returned nothing for this prompt"));
      this.refinePanel.apply(result, shot);
      this.onRefined?.(result);
      this.commit();
    } catch (error) {
      this.refinePanel.fail(String(error.message || error));
    }
  }

  attachPoolFromMention(row) {
    return this.attachFromMention(row);
  }

  attachFromMention(row) {
    const blocked = S.blockedReason(this.state, "reference");
    if (blocked) { this.flash(blocked); return null; }
    const { used, max, filesLeft } = S.capacity(this.state, row.kind);
    if (used >= max || filesLeft <= 0) {
      this.flash(t("No {kind} slots left ({used}/{max} used, {filesLeft} files free of {maxFiles}).",
        { kind: t(row.kind), used, max, filesLeft, maxFiles: S.MAX_REF_FILES }));
      return null;
    }
    const handle = S.nextHandle(this.state, row.kind);
    const entry = {
      handle,
      kind: row.kind,
      role: "reference",
      filename: row.path || row.filename,
      ref_size: "max",
    };
    if (row.kind === "video") entry.track = S.DEFAULT_TRACK;
    if (row.trim) entry.trim = row.trim;
    this.state.assets.push(entry);
    this.commit();
    if (row.kind === "video") this.applySoundDefault(entry);
    return handle;
  }

  async addReferences(kind) {
    const blocked = S.blockedReason(this.state, "reference");
    if (blocked) return this.flash(blocked);
    const { used, max, filesLeft } = S.capacity(this.state, kind);
    if (used >= max || filesLeft <= 0) {
      return this.flash(t("No {kind} slots left ({used}/{max} used, {filesLeft} files free of {maxFiles}).",
        { kind: t(kind), used, max, filesLeft, maxFiles: S.MAX_REF_FILES }));
    }
    const chosen = await openPicker({
      kinds: ["image", "video", "audio", "renders"],
      kind,
      capacity: (k) => S.capacity(this.state, k),
    });
    if (!chosen) return;
    await this.attachAssets(chosen);
  }

  async openGallery() {
    const chosen = await openPicker({
      kinds: ["renders", "image", "video", "audio"],
      kind: "renders",
      capacity: (k) => S.capacity(this.state, k),
    });
    if (!chosen) return;
    const blocked = S.blockedReason(this.state, "reference");
    if (blocked) return this.flash(blocked);
    await this.attachAssets(chosen);
  }

  async attachAssets(chosen) {
    const undecided = [];
    for (const asset of chosen) {
      const entry = {
        handle: S.nextHandle(this.state, asset.kind),
        kind: asset.kind,
        role: "reference",
        filename: asset.path,
        ref_size: "max",
      };
      if (asset.kind === "video") entry.track = S.DEFAULT_TRACK;
      if (asset.trim) entry.trim = asset.trim;
      this.state.assets.push(entry);
      if (asset.kind !== "video") continue;
      if (asset.track) this.setTrack(entry, asset.track, { defer: true });
      else undecided.push(entry);
    }
    this.commit();
    for (const entry of undecided) await this.applySoundDefault(entry);
  }

  async applySoundDefault(asset) {
    const has = await probeAudio(asset.filename);
    if (has === false) return;
    if (!this.state.assets.includes(asset)) return;
    if (this.setTrack(asset, "picture+sound", { defer: true })) this.commit();
  }

  setTrack(asset, track, { defer = false } = {}) {
    const previous = asset.track;
    if (previous === track) return true;
    asset.track = track;
    const problem = S.overflow(this.state);
    if (problem) {
      asset.track = previous;
      this.flash(t("@{handle} stays {track} — {problem}", {
        handle: asset.handle,
        track: t(TRACK_CHIP[previous]?.text || previous),
        problem,
      }));
      return false;
    }
    if (!defer) this.commit();
    return true;
  }

  async editSegment(asset) {
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
    if (result.track) this.setTrack(asset, result.track, { defer: true });
    this.commit();
  }

  async setFrame(role) {
    const blocked = S.blockedReason(this.state, role);
    if (blocked) return this.flash(blocked);
    const existing = S.frameAsset(this.state, role);
    const chosen = await openPicker({
      kinds: ["image"], kind: "image", single: true,
      capacity: () => ({ used: 0, max: 1, filesLeft: 1 }),
    });
    if (!chosen) return;
    const asset = chosen[0];
    if (existing) this.remove(existing.handle, { silent: true });
    this.state.assets.push({
      handle: S.nextHandle(this.state, "image"),
      kind: "image",
      role,
      filename: asset.path,
    });
    this.commit();
    this.probeKeyframe();
  }

  remove(handle, { silent = false } = {}) {
    this.state.assets = this.state.assets.filter((a) => a.handle !== handle);
    if (!silent) this.commit();
  }

  chipMenuActions(handle) {
    const asset = this.state.assets.find((a) => a.handle === handle);
    if (!asset) return [];
    const actions = [{
      label: t(`Copy @${handle}`),
      title: t("Copy the mention to the clipboard"),
      run: () => { try { navigator.clipboard.writeText(`@${handle}`); } catch {} },
    }];
    const isFrame = asset.role === "first_frame" || asset.role === "last_frame";
    if (!isFrame && asset.kind !== "image") {
      actions.push({
        label: t("Trim / track…"),
        title: trimLabel(asset),
        run: () => this.editSegment(asset),
      });
      if (asset.kind === "video") {
        const next = TRACK_CHIP[asset.track]?.next;
        if (next) {
          actions.push({
            label: t("{from} → {to}", { from: TRACK_CHIP[asset.track].text, to: TRACK_CHIP[next].text }),
            title: t("Switch what this clip contributes"),
            run: () => this.setTrack(asset, next),
          });
        }
      }
    }
    actions.push({
      label: t(isFrame ? "Remove frame" : "Remove attachment"),
      danger: true,
      run: () => this.remove(asset.handle),
    });
    return actions;
  }

  probeKeyframe() {
    const anchor = S.frameAsset(this.state, "first_frame") || S.frameAsset(this.state, "last_frame");
    if (!anchor || this.sizes.has(anchor.filename)) return;
    const probe = new Image();
    probe.onload = () => {
      this.sizes.set(anchor.filename, { width: probe.naturalWidth, height: probe.naturalHeight });
      this.render();
    };
    probe.src = viewUrl(anchor.filename);
  }

  flash(message) {
    this.notice = message;
    this.render();
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => { this.notice = null; this.render(); }, 6000);
  }

  render() {
    const state = this.state;
    const anchor = S.frameAsset(state, "first_frame") || S.frameAsset(state, "last_frame");
    const geometry = S.resolved(state, anchor ? this.sizes.get(anchor.filename) : null);

    this.railHost.replaceChildren(this.renderRail());
    this.assetsHost.replaceChildren(...(state.assets.length ? [this.renderAssets()] : []));
    this.loraHost.replaceChildren(...(state.loras.length ? [this.renderLoras()] : []));
    this.pillsHost.replaceChildren(this.renderPills(geometry, S.mode(state)));
    this.samplingHost.replaceChildren(...(!this.compact ? [samplingBar({
      widgets: this.samplingWidgets,
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
      perSegment: false,
      turbo: this.nodeId ? Turbo.turboPills({
        container: this.state,
        ...this.widgetIO(),
        onCommit: () => this.commit(),
      }) : [],
      trailing: this.nodeId ? [weightsPill({
        models: this.state.models,
        checkpoints: [S.checkpoint(this.state)],
        onChange: () => this.commit(),
        turbo: { container: this.state, widgetIO: this.widgetIO() },
      })] : [],
    })] : []));
    this.prompt.refresh();
    this.syncPrompt();
    this.refinePanel.render();
    this.renderNotices();
  }

  syncPrompt() {
    const refined = this.state.refined;
    this.prompt.setSuperseded(Boolean(refined?.body?.trim() && refined.enabled !== false));
  }

  renderNotices() {
    this.noticeHost.replaceChildren(
      ...(this.notice ? [el("div", { class: "mmc-warn", text: this.notice })] : []),
      ...(this.renderDangling() || []),
    );
  }

  renderRail() {
    const disabled = Boolean(S.blockedReason(this.state, "reference"));

    if (this.compact) {
      const microBtn = (kind, label, iconName) => el("button", {
        class: "mmc-micro-tool",
        disabled: disabled || undefined,
        title: disabled ? S.blockedReason(this.state, "reference") : t("Attach a reference {kind}", { kind: t(kind) }),
        onclick: () => this.addReferences(kind),
      }, [icon(iconName, 13), el("span", { text: t(label) })]);

      return el("div", { class: "mmc-micro-toolbar" }, [
        microBtn("image", "+ Image", "image"),
        microBtn("video", "+ Video", "video"),
        microBtn("audio", "+ Audio", "audio"),
        el("button", {
          class: "mmc-micro-tool",
          title: t("Manage LoRAs"),
          onclick: () => this.manageLoras(),
        }, [icon("effect", 13), el("span", { text: t("+ LoRA") })]),
        ...(this.refineTarget ? [refineButton({ run: () => this.refine(), mode: "micro" })] : []),
      ]);
    }

    const tool = (kind, label, iconName) =>
      el("button", {
        class: "mmc-tool",
        disabled: disabled || undefined,
        title: disabled ? S.blockedReason(this.state, "reference") : t("Attach a reference {kind}", { kind: t(kind) }),
        onclick: () => this.addReferences(kind),
      }, [el("span", { class: "mmc-tool-icon" }, [icon(iconName)]), el("span", { text: t(label) })]);

    return el("div", { class: "mmc-rail" }, [
      el("div", { class: "mmc-rail-group" }, [
        tool("image", "Add image", "image"),
        tool("video", "Add video", "video"),
        tool("audio", "Add audio", "audio"),
        el("button", {
          class: "mmc-tool",
          title: t("Manage the LoRAs patched onto the routed checkpoint"),
          onclick: () => this.manageLoras(),
        }, [el("span", { class: "mmc-tool-icon" }, [icon("effect")]), el("span", { text: t("Add LoRA") })]),
        ...(this.extraTools?.() ?? []),
        ...(this.refineTarget ? [refineButton({ run: () => this.refine(), mode: "rail" })] : []),
      ]),
      el("div", { class: "mmc-rail-group" }, [
        el("button", {
          class: "mmc-tool mmc-tool-primary",
          title: t("Queue prompt in ComfyUI to generate video"),
          onclick: () => {
            handlePreGenerateSeed(this.widgetIO().value, this.widgetIO().set);
            try { app.queuePrompt(0); } catch {}
          },
        }, [el("span", { class: "mmc-tool-icon" }, [icon("play")]), el("span", { text: t("Generate") })]),
        el("button", {
          class: `mmc-tool${this.stage?.showing() ? " active" : ""}`,
          title: t("Open or close the satellite preview box"),
          onclick: () => {
            this.stage?.toggleOpen();
            this.render();
          },
        }, [el("span", { class: "mmc-tool-icon" }, [icon("play")]), el("span", { text: t("Preview") })]),
        el("button", {
          class: "mmc-tool",
          title: t("Browse, organize and attach finished renders and pre-stage stills"),
          onclick: () => this.openGallery(),
        }, [el("span", { class: "mmc-tool-icon" }, [icon("gallery")]), el("span", { text: t("Gallery") })]),
        ...(this.settingsTool ? [el("button", {
          class: "mmc-tool",
          title: t("Preferences for this ComfyUI — output quality. Not saved into the workflow."),
          onclick: () => openSettings(),
        }, [el("span", { class: "mmc-tool-icon" }, [icon("gear")]), el("span", { text: t("Settings") })])] : []),
      ]),
    ]);
  }

  async manageLoras() {
    await openLoras({ state: this.state, onChange: () => this.commit() });
    this.commit();
  }

  renderLoras() {
    const target = S.checkpoint(this.state);
    const chip = (entry) => {
      const modes = S.loraModes(entry);
      const idle = !modes.includes(target);
      return el("div", {
        class: `mmc-asset${idle ? " idle" : ""}`,
        title: idle
          ? t("{name} — set to {modes}, but this graph routes to {target}.", {
              name: entry.name,
              modes: modes.map((m) => S.CHECKPOINT_LABEL[m]).join(" + "),
              target: S.CHECKPOINT_LABEL[target],
            })
          : entry.name,
      }, [
        el("span", { class: "mmc-asset-thumb" }, [svg(ICONS.effect, 15)]),
        el("span", { class: "mmc-asset-handle", text: entry.name.split("/").pop().replace(/\.[^.]+$/, "") }),
        el("button", {
          class: "mmc-ghost",
          style: { fontSize: "11px" },
          title: t("Strength, and which checkpoint this LoRA belongs to"),
          text: `${Number(entry.strength ?? 1).toFixed(2)} · ${S.claimsBoth(entry) ? t("both") : S.CHECKPOINT_LABEL[modes[0]]}`,
          onclick: () => this.manageLoras(),
        }),
        el("button", {
          class: "mmc-asset-x", text: "✕", title: t("Remove {name}", { name: entry.name }),
          onclick: () => { S.removeLora(this.state, entry.name); this.commit(); },
        }),
      ]);
    };

    const parts = [el("div", { class: "mmc-assets" }, this.state.loras.map(chip))];
    const triggers = S.promptTriggers(this.state);
    if (triggers.length) {
      parts.push(el("div", {
        class: "mmc-note",
        title: t("Prefixed to the prompt when this queues. Edit the list on the LoRA cards."),
      }, [
        el("span", { class: "mmc-note-key", text: t("triggers") }),
        el("span", { text: triggers.join(", ") }),
      ]));
    }
    return el("div", { class: "mmc-lora-block" }, parts);
  }

  renderAssets() {
    const chip = (asset) => {
      const thumb = asset.kind === "image"
        ? el("img", { class: "mmc-asset-thumb", src: viewUrl(asset.filename, { preview: true }), alt: asset.filename })
        : el("span", { class: "mmc-asset-thumb" }, [svg(ICONS[asset.kind], 15)]);

      const parts = [thumb, el("span", { class: "mmc-asset-handle", text: `@${asset.handle}` })];

      if (asset.role !== "reference") {
        parts.push(el("span", { class: "mmc-asset-role", text: asset.role === "first_frame" ? t("start") : t("end") }));
      }
      if (asset.kind !== "image") {
        parts.push(el("button", {
          class: "mmc-ghost",
          style: { fontSize: "11px" },
          title: t("Use the whole clip, or only a segment of it"),
          text: trimLabel(asset),
          onclick: () => this.editSegment(asset),
        }));
      }
      if (asset.kind === "video") {
        const chip = TRACK_CHIP[asset.track] || TRACK_CHIP[S.DEFAULT_TRACK];
        parts.push(el("button", {
          class: "mmc-ghost",
          style: { fontSize: "11px" },
          text: t(chip.text),
          onclick: () => this.setTrack(asset, chip.next),
        }));
      }
      if (S.takeable(asset)) {
        const take = S.takes(asset);
        parts.push(el("button", {
          class: "mmc-ghost",
          style: { fontSize: "11px" },
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
          onclick: () => { asset.ref_size = size === "max" ? "match" : "max"; this.commit(); },
        }));
      }
      parts.push(el("button", {
        class: "mmc-asset-x", text: "✕", title: t("Remove @{handle}", { handle: asset.handle }),
        onclick: () => this.remove(asset.handle),
      }));
      return el("div", {
        class: `mmc-asset mmc-tag-${S.tagIndex(asset.handle)}`,
        title: asset.filename,
      }, parts);
    };

    return el("div", { class: "mmc-assets" }, this.state.assets.map(chip));
  }

  renderPills(geometry, currentMode) {
    const state = this.state;

    const frameLabel = (role, fallback) => {
      const asset = S.frameAsset(state, role);
      return asset ? `@${asset.handle}` : t(fallback);
    };

    const framePill = (role, label, iconName) => {
      const blocked = S.blockedReason(state, role);
      return el("button", {
        class: "mmc-pill",
        disabled: blocked ? true : undefined,
        title: blocked || t("Choose the {label}", { label: t(label).toLowerCase() }),
        onclick: blocked ? undefined : () => this.setFrame(role),
      }, [
        icon(iconName, 15),
        el("span", {
          text: role === "first_frame" && S.continues(state)
            ? t("from last frame") : frameLabel(role, label),
        }),
      ]);
    };

    const grain = state.duration_s >= 15 ? 5 : 1;
    const trained = isTrainedLength(geometry.frames);
    const duration = el("div", {
      class: `mmc-pill mmc-pill-group${trained ? "" : " off-distribution"}`,
      title: t("{frames} frames · {seconds} s at 24 fps", { frames: geometry.frames, seconds: geometry.seconds.toFixed(2) }),
    }, [
      el("button", {
        class: "mmc-step", text: "−", disabled: state.duration_s <= MIN_SECONDS || undefined,
        onclick: () => {
          const step = state.duration_s > 15 ? 5 : 1;
          state.duration_s = Math.max(MIN_SECONDS, state.duration_s - step);
          this.commit();
        },
      }),
      icon("clock", 15),
      el("span", { text: t("{seconds} s", { seconds: state.duration_s }), style: { minWidth: "36px", textAlign: "center" } }),
      el("button", {
        class: "mmc-step", text: "+", disabled: state.duration_s >= MAX_SECONDS || undefined,
        onclick: () => {
          state.duration_s = Math.min(MAX_SECONDS, state.duration_s + grain);
          this.commit();
        },
      }),
    ]);

    const aspectPill = el("button", {
      class: "mmc-pill",
      disabled: geometry.fromImage || undefined,
      title: t("Aspect Ratio"),
      onclick: (event) => this.openAspect(event.currentTarget),
    }, geometry.fromImage
      ? [aspectGlyph(geometry.ratio, PILL_GLYPH),
         el("span", { text: describeRatio(geometry.ratio) }),
         el("span", { class: "mmc-pill-sub", text: t("from image") })]
      : [aspectGlyph(geometry.ratio, PILL_GLYPH), el("span", { text: state.aspect })]);

    const refined = S.twoPass(state);
    const rtxOn = S.rtxVsr(state);
    const refineInfo = rtxOn
      ? `${S.sampleEdge(state)} → ${geometry.width}×${geometry.height} · RTX VSR ${state.rtx_quality || "ULTRA"}`
      : refined
      ? `${S.sampleEdge(state)} → ${geometry.width}×${geometry.height} · ${state.refine_steps ?? 1}st@${(state.refine_denoise ?? S.DEFAULT_REFINE_DENOISE).toFixed(2)}${state.save_pass1 ? " (+base)" : ""}`
      : `${geometry.width} × ${geometry.height}`;

    const resPill = el("button", {
      class: "mmc-pill mmc-pill-res",
      title: t("Short edge resolution, two-pass latent refine & NVIDIA RTX VSR upscaling"),
      onclick: (event) => this.openResolution(event.currentTarget),
    }, [
      icon("res", 15),
      el("span", { text: `${state.short_edge}p` }),
      el("span", { class: "mmc-pill-sub", text: refineInfo }),
    ]);
    this.resPill = resPill;

    return el("div", { class: "mmc-pills" }, [
      ...(this.continuePill ? [this.renderContinue()] : []),
      framePill("first_frame", "Start frame", "frameIn"),
      framePill("last_frame", "End frame", "frameOut"),
      ...(this.durationPill ? [duration] : []),
      ...(this.extraPills?.() ?? []),
      ...(this.canvasPills ? [aspectPill, resPill] : []),
      this.renderRouting(currentMode),
      ...(this.preStage && !this.compact ? [this.renderPreStagePill()] : []),
    ]);
  }

  renderPreStagePill() {
    const on = this.preStage?.active?.() ?? false;
    return el("button", {
      class: `mmc-pill mmc-prestage-toggle${on ? " on" : ""}`,
      title: t("Toggle PreStage still generator"),
      onclick: () => { this.preStage.toggle(); this.render(); },
    }, [icon("image", 15), el("span", { text: t("pre-stage") })]);
  }

  attachFromPreStage({ role, filename }) {
    if (role === "reference") {
      const blocked = S.blockedReason(this.state, "reference");
      if (blocked) return blocked;
      const { used, max, filesLeft } = S.capacity(this.state, "image");
      if (used >= max || filesLeft <= 0) {
        return t("No {kind} slots left.", { kind: t("image") });
      }
      this.state.assets.push({
        handle: S.nextHandle(this.state, "image"),
        kind: "image", role: "reference", filename, ref_size: "max",
      });
      this.commit();
      return null;
    }
    const blocked = S.blockedReason(this.state, role);
    if (blocked) return blocked;
    const existing = S.frameAsset(this.state, role);
    if (existing) this.remove(existing.handle, { silent: true });
    this.state.assets.push({
      handle: S.nextHandle(this.state, "image"),
      kind: "image", role, filename,
    });
    this.commit();
    this.probeKeyframe();
    return null;
  }

  renderContinue() {
    const on = S.continues(this.state);
    const isMask = this.state.continuity_mode === "latent_mask";
    return el("button", {
      class: `mmc-pill mmc-continue${on ? " on" : ""}`,
      title: on ? (isMask ? t("Lossless AV Latent Mask Continuation") : t("Keyframe Still Continuation")) : t("Hard cut"),
      onclick: () => {
        this.state.continue = !on;
        this.commit();
      },
    }, [icon("frameIn", 14), el("span", { text: on ? (isMask ? t("latent mask") : t("continues")) : t("hard cut") })]);
  }

  renderRouting(currentMode) {
    const state = this.state;
    const route = this.routeOf?.() ?? "auto";
    const forced = route !== "auto";
    const routed = forced ? route : S.checkpoint(state);
    const pinned = !forced && S.checkpointPinned(state);
    const impossible = forced && route === "fl2va" && S.hasReferences(state);
    const canCycle = Boolean(this.setRoute);

    const badge = el(canCycle ? "button" : "span", {
      class: `mmc-mode${forced || pinned ? " pinned" : ""}${impossible ? " bad" : ""}`,
      onclick: canCycle ? () => this.setRoute(S.nextRoute(route)) : undefined,
    });
    badge.appendChild(el("b", { text: currentMode }));
    badge.appendChild(document.createTextNode(` → ${S.CHECKPOINT_LABEL[routed]}`));
    if (forced) badge.appendChild(el("span", { class: "mmc-pin", text: t("always") }));
    else if (pinned) badge.appendChild(el("span", { class: "mmc-pin", text: t("pinned") }));
    return badge;
  }

  renderDangling() {
    const known = new Set([
      ...this.state.assets.map((a) => a.handle),
      ...(this.state.pool ?? []).map((a) => a.handle),
    ]);
    const missing = [...new Set(Array.from(this.state.prompt.matchAll(S.HANDLE_RE), (m) => m[1]))]
      .filter((handle) => !known.has(handle));
    if (!missing.length) return null;
    return [el("div", {
      class: "mmc-warn",
      text: t("{handles} in prompt but not attached.", { handles: missing.map((h) => "@" + h).join(", ") }),
    })];
  }

  openAspect(anchor) {
    openAspectPopover(anchor, this.state, () => this.commit());
  }

  openResolution(anchor) {
    openResolutionPopover(
      () => (this.resPill?.isConnected ? this.resPill : (this.root?.querySelector(".mmc-pill-res") || anchor)),
      this.state,
      () => {
        const asset = S.frameAsset(this.state, "first_frame") || S.frameAsset(this.state, "last_frame");
        return S.resolved(this.state, asset ? this.sizes.get(asset.filename) : null);
      },
      () => this.commit()
    );
  }
}