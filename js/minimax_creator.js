import { app } from "../../scripts/app.js";
import { installStyles } from "./minimax_creator/styles.js";
import { CreatorEditor } from "./minimax_creator/editor.js";
import { TimelineBody } from "./minimax_creator/timeline.js";
import { PreStageBody } from "./minimax_creator/prestage.js";
import { Satellite } from "./minimax_creator/satellite.js";
import { SAMPLING_WIDGETS } from "./minimax_creator/sampling.js";
import * as S from "./minimax_creator/state.js";
import { t } from "./minimax_creator/i18n.js";

// Global input guard to prevent ComfyUI node copy/paste when focused in text fields
function installInputGuard() {
  if (globalThis._mmcInputGuardInstalled) return;
  globalThis._mmcInputGuardInstalled = true;

  const isMmcInput = (el) => {
    if (!el) return false;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      return !!el.closest?.(".mmc-root, .mmc-overlay, .mmc-pop, .mmc-prompt");
    }
    if (el.isContentEditable) {
      return !!el.closest?.(".mmc-root, .mmc-overlay, .mmc-pop, .mmc-prompt");
    }
    return !!el.closest?.(".mmc-prompt, .mmc-root, .mmc-overlay, .mmc-pop");
  };

  window.addEventListener("keydown", (e) => {
    if (!isMmcInput(document.activeElement)) return;
    const key = e.key?.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ["c", "v", "x", "a", "z", "y"].includes(key)) {
      e.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener("copy", (e) => {
    if (isMmcInput(document.activeElement)) {
      e.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener("cut", (e) => {
    if (isMmcInput(document.activeElement)) {
      e.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener("paste", (e) => {
    const active = document.activeElement;
    if (!isMmcInput(active)) return;

    e.stopImmediatePropagation();

    if (active.classList?.contains("mmc-prompt") || active.isContentEditable) {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text) {
        document.execCommand("insertText", false, text.replace(/\r\n?/g, "\n"));
      }
    }
  }, true);
}

installInputGuard();

const CREATOR = "MiniMaxH3Creator";
const TIMELINE = "MiniMaxH3Timeline";
const PRESTAGE = "MiniMaxH3PreStage";
const MIN_SIZE = { [CREATOR]: [620, 520], [TIMELINE]: [620, 360], [PRESTAGE]: [460, 420] };
const WIDGET = { [CREATOR]: "creator_data", [TIMELINE]: "timeline_data", [PRESTAGE]: "prestage_data" };
const SIDE = { [PRESTAGE]: "left" };

const SPAWN_GAP = 28;
const STASH = "mmc_prestage_stash";

const nodeById = (graph, id) =>
  (graph?._nodes ?? []).find((n) => String(n.id) === String(id)) ?? null;

function findPreStage(node) {
  return (node.graph?._nodes ?? []).find((n) =>
    n.comfyClass === PRESTAGE && n.mmcBody
    && String(n.mmcBody.state?.peer) === String(node.id)) ?? null;
}

function adoptOrphan(node) {
  const orphan = (node.graph?._nodes ?? []).find((n) =>
    n.comfyClass === PRESTAGE && n.mmcBody
    && n.mmcBody.state?.peer != null
    && !nodeById(node.graph, n.mmcBody.state.peer)
    && n.pos[0] < node.pos[0]
    && Math.abs(n.pos[1] - node.pos[1]) < 600) ?? null;
  if (orphan) {
    orphan.mmcBody.state.peer = node.id;
    orphan.mmcBody.commit();
  }
  return orphan;
}

function stashPreStage(mother, pre) {
  const state = pre?.mmcBody?.state;
  if (!mother || !state) return;
  const sampling = {};
  for (const widget of pre.widgets ?? []) {
    if (widget.name === WIDGET[PRESTAGE]) continue;
    if (["string", "number", "boolean"].includes(typeof widget.value)) sampling[widget.name] = widget.value;
  }
  mother.properties = mother.properties || {};
  mother.properties[STASH] = JSON.stringify({ blob: S.serializePreStage(state), sampling });
}

function togglePreStage(node) {
  const existing = findPreStage(node) ?? adoptOrphan(node);
  if (existing) {
    stashPreStage(node, existing);
    node.graph.remove(existing);
    node.graph.setDirtyCanvas(true, true);
    return;
  }
  const spawned = globalThis.LiteGraph?.createNode?.(PRESTAGE);
  if (!spawned) return;
  node.graph.add(spawned);
  spawned.pos = [node.pos[0] - spawned.size[0] - SPAWN_GAP, node.pos[1]];
  const claim = () => {
    const body = spawned.mmcBody;
    if (!body) { requestAnimationFrame(claim); return; }
    spawned.size = [spawned.size[0], Math.max(spawned.size[1], node.size[1])];
    const stashed = node.properties?.[STASH];
    if (stashed) {
      try {
        const { blob, sampling } = JSON.parse(stashed);
        body.setState(S.parsePreStage(blob));
        for (const [name, value] of Object.entries(sampling ?? {})) {
          const widget = spawned.widgets?.find((w) => w.name === name);
          if (!widget) continue;
          widget.value = value;
          widget.callback?.(value);
        }
      } catch {}
    }
    body.state.peer = node.id;
    body.commit();
  };
  claim();
  node.graph.setDirtyCanvas(true, true);
}

const preStageControls = (node) => ({
  active: () => !!findPreStage(node),
  toggle: () => togglePreStage(node),
});

const peerOf = (node) => () => {
  const id = node.mmcBody?.state?.peer;
  const peer = id == null ? null : nodeById(node.graph, id);
  const body = peer?.mmcBody;
  if (!body?.attachFromPreStage) return null;
  return {
    label: peer.title || peer.comfyClass,
    attach: (role, filename) => body.attachFromPreStage({ role, filename }),
  };
};

function hideWidget(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.options = widget.options || {};
  widget.options.hidden = true;
  widget.computeSize = () => [0, 0];
  if (widget.element) {
    widget.element.style.display = "none";
    widget.element.style.visibility = "hidden";
  }
  if (widget.type !== "hidden") {
    widget.origType = widget.type;
    widget.type = "hidden";
  }
}

function collectSampling(node) {
  const widgets = {};
  for (const name of SAMPLING_WIDGETS) {
    const found = node.widgets?.find((w) => w.name === name);
    if (!found) continue;
    widgets[name] = found;
    hideWidget(found);
    for (const linked of found.linkedWidgets || []) {
      widgets.control_after_generate = widgets.control_after_generate || linked;
      hideWidget(linked);
    }
  }
  requestAnimationFrame(() => {
    for (const name of SAMPLING_WIDGETS) {
      const found = node.widgets?.find((w) => w.name === name);
      if (found) hideWidget(found);
    }
  });
  return widgets;
}

function attach(node, build) {
  installStyles();

  if (!node) return null;
  if (node.mmcBody) return node.mmcBody;

  const targetWidgetName = WIDGET[node.comfyClass];
  if (!targetWidgetName) return null;

  const doAttach = () => {
    if (node.mmcBody) return node.mmcBody;
    try {
      const widget = node.widgets?.find((w) => w.name === targetWidgetName);
      if (!widget) return null;

      hideWidget(widget);
      requestAnimationFrame(() => hideWidget(widget));

      const body = build(widget);
      if (!body) return null;
      node.mmcBody = body;

      if (body.root) {
        node.addDOMWidget("mmc_ui", "MMC_CREATOR", body.root, {
          serialize: false,
          hideOnZoom: false,
          getMinHeight: () => 200,
        });
      }

      const [minWidth, minHeight] = MIN_SIZE[node.comfyClass] || [620, 520];
      node.size = [Math.max(node.size?.[0] ?? 0, minWidth), Math.max(node.size?.[1] ?? 0, minHeight)];

      const satellite = body.stage
        ? new Satellite({ node, stage: body.stage, side: SIDE[node.comfyClass] ?? "right" })
        : null;

      const removed = node.onRemoved;
      node.onRemoved = function () {
        try { removed?.apply(this, arguments); } catch {}
        try { body.destroy?.(); } catch {}
        try { satellite?.destroy(); } catch {}
      };

      try { node.setDirtyCanvas?.(true, true); } catch {}
      return body;
    } catch (err) {
      return null;
    }
  };

  const body = doAttach();
  if (!body) {
    const checkInterval = setInterval(() => {
      if (node.widgets?.find((w) => w.name === targetWidgetName)) {
        if (doAttach()) clearInterval(checkInterval);
      }
    }, 100);
    setTimeout(() => clearInterval(checkInterval), 5000);
  }
  return body;
}

function createCreatorBody(node) {
  return attach(node, (widget) => {
    const state = S.parseState(widget.value);
    let editor;
    editor = new CreatorEditor({
      state,
      onCommit: () => {
        widget.value = S.serializeState(state);
        node.graph?.setDirtyCanvas(true, true);
      },
      refineTarget: () => ({
        kind: "creator",
        data: JSON.parse(S.serializeState(editor.state)),
      }),
      samplingWidgets: collectSampling(node),
      onWidgetChange: () => node.graph?.setDirtyCanvas(true, true),
      nodeId: () => node.id,
      setRoute: (route) => { editor.state.models.route = route; editor.commit(); },
      preStage: preStageControls(node),
    });
    return editor;
  });
}

function createTimelineBody(node) {
  return attach(node, (widget) => {
    const widgets = collectSampling(node);
    return new TimelineBody({
      read: () => widget.value,
      write: (raw) => {
        widget.value = raw;
        node.graph?.setDirtyCanvas(true, true);
      },
      widgets,
      onWidgetChange: () => node.graph?.setDirtyCanvas(true, true),
      nodeId: () => node.id,
      preStage: preStageControls(node),
    });
  });
}

function createPrestageBody(node) {
  return attach(node, (widget) => {
    const state = S.parsePreStage(widget.value);
    let body;
    body = new PreStageBody({
      state,
      onCommit: () => {
        widget.value = S.serializePreStage(body.state);
        node.graph?.setDirtyCanvas(true, true);
      },
      samplingWidgets: collectSampling(node),
      onWidgetChange: () => node.graph?.setDirtyCanvas(true, true),
      nodeId: () => node.id,
      peer: peerOf(node),
    });
    return body;
  });
}

app.registerExtension({
  name: "minimax.creator",

  async nodeCreated(node) {
    if (node.comfyClass === CREATOR) {
      createCreatorBody(node);
    } else if (node.comfyClass === TIMELINE) {
      createTimelineBody(node);
    } else if (node.comfyClass === PRESTAGE) {
      createPrestageBody(node);
    }
  },

  loadedGraphNode(node) {
    if (WIDGET[node.comfyClass] && !node.mmcBody) {
      if (node.comfyClass === CREATOR) createCreatorBody(node);
      else if (node.comfyClass === TIMELINE) createTimelineBody(node);
      else if (node.comfyClass === PRESTAGE) createPrestageBody(node);
    }
    const body = node.mmcBody;
    if (!body) return;
    if (node.comfyClass === CREATOR) {
      const widget = node.widgets?.find((w) => w.name === WIDGET[CREATOR]);
      if (widget) {
        const state = S.parseState(widget.value);
        body.onCommit = () => {
          widget.value = S.serializeState(state);
          node.graph?.setDirtyCanvas(true, true);
        };
        body.setState(state);
      }
    } else if (node.comfyClass === PRESTAGE) {
      const widget = node.widgets?.find((w) => w.name === WIDGET[PRESTAGE]);
      if (widget) {
        const state = S.parsePreStage(widget.value);
        body.onCommit = () => {
          widget.value = S.serializePreStage(state);
          node.graph?.setDirtyCanvas(true, true);
        };
        body.setState(state);
      }
    } else {
      body.reload();
    }
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    const name = WIDGET[nodeData.name];
    if (!name) return;
    const original = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
      original?.apply(this, arguments);
      options.push({
        content: t("Copy {name} JSON", { name }),
        callback: () => {
          const widget = this.widgets?.find((w) => w.name === name);
          if (widget) navigator.clipboard?.writeText(widget.value);
        },
      });
      return options;
    };
  },
});