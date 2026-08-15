import { el, icon } from "./dom.js";
import { openChoicePopover } from "./pills.js";
import { listLoras } from "./api.js";
import * as S from "./state.js";
import { t } from "./i18n.js";

let names = null;

export function loadLoraNames(onReady) {
  if (names) { onReady?.(); return; }
  listLoras({ folder: "" }).then((body) => {
    names = (body.loras ?? []).map((row) => row.name);
    onReady?.();
  }).catch(() => { names = []; });
}

export const loraNames = () => names ?? [];

const looksTurbo = (name) => /turbo|distill/i.test(name);

const SHOW_ALL = "— show all —";

export const NO_LORA = "— no LoRA · merged checkpoint —";

function openTurboChoice(anchor, { value, onPick, includeNone = false, all = false }) {
  const matched = loraNames().filter(looksTurbo);
  const showAll = all || !matched.length;
  const listed = showAll ? loraNames() : matched;
  openChoicePopover(anchor, {
    title: showAll ? t("Turbo LoRA — all files") : t("Turbo LoRA"),
    options: [
      ...(includeNone ? [typeof includeNone === "string" ? t(includeNone) : t("— none —")] : []),
      ...listed,
      ...(showAll || matched.length === loraNames().length ? [] : [t(SHOW_ALL)]),
    ],
    value,
    onPick: (picked) => {
      if (picked === t(SHOW_ALL)) {
        openTurboChoice(anchor, { value, onPick, includeNone, all: true });
        return;
      }
      onPick(picked);
    },
  });
}

export const engaged = (container) => {
  const turbo = container.turbo;
  if (!turbo) return false;
  if (!turbo.lora && !turbo.ref_lora) return true;
  
  const entryFL = turbo.lora ? S.findLora(container, turbo.lora) : null;
  const entryRef = turbo.ref_lora ? S.findLora(container, turbo.ref_lora) : null;

  const flOk = !turbo.lora || (entryFL && entryFL.enabled !== false && Math.round((Number(entryFL.strength) || 0) * 100) !== 0);
  const refOk = !turbo.ref_lora || (entryRef && entryRef.enabled !== false && Math.round((Number(entryRef.strength) || 0) * 100) !== 0);

  return flOk || refOk;
};

export function throwOn(container, { value, set }) {
  const turbo = container.turbo;

  const applyLora = (loraName, targetModes) => {
    if (!loraName) return;
    let entry = S.findLora(container, loraName);
    if (entry) {
      entry.enabled = true;
      entry.modes = [...targetModes];
      if (Math.round((Number(entry.strength) || 0) * 100) === 0) {
        entry.strength = S.turboStrength(loraName);
      }
    } else {
      entry = S.addLora(container, loraName, []);
      if (entry) {
        entry.modes = [...targetModes];
        entry.strength = S.turboStrength(loraName);
      }
    }
  };

  const sameLora = turbo.lora && turbo.ref_lora && turbo.lora === turbo.ref_lora;

  if (sameLora) {
    applyLora(turbo.lora, ["fl2va", "ref2va"]);
  } else {
    if (turbo.lora) applyLora(turbo.lora, ["fl2va"]);
    if (turbo.ref_lora) applyLora(turbo.ref_lora, ["ref2va"]);
  }

  if (!turbo.on) {
    turbo.saved = {
      steps: Number(value("steps", S.TURBO_RESET.steps)),
      sampler_name: String(value("sampler_name", S.TURBO_RESET.sampler_name)),
      scheduler: String(value("scheduler", S.TURBO_RESET.scheduler)),
    };
  }
  turbo.on = true;
  set("steps", S.TURBO_STEPS[turbo.quality] ?? S.TURBO_STEPS.medium);
  set("sampler_name", S.TURBO_SAMPLER);
  set("scheduler", S.TURBO_SCHEDULER);
}

export function throwOff(container, { set }, { removeEntry = true } = {}) {
  const turbo = container.turbo;
  if (removeEntry) {
    if (turbo.lora) S.removeLora(container, turbo.lora);
    if (turbo.ref_lora && turbo.ref_lora !== turbo.lora) S.removeLora(container, turbo.ref_lora);
  }
  const saved = turbo.saved ?? S.TURBO_RESET;
  set("steps", saved.steps);
  set("sampler_name", saved.sampler_name);
  set("scheduler", saved.scheduler);
  turbo.on = false;
  turbo.saved = null;
}

export function sync(container, widgetIO) {
  if (container.turbo?.on && !engaged(container)) {
    throwOff(container, widgetIO, { removeEntry: false });
    return true;
  }
  return false;
}

export function setTurboLora(container, name, widgetIO, mode = "fl2va") {
  const turbo = container.turbo;
  if (mode === "ref2va") {
    const was = turbo.ref_lora;
    if (name === was) return;
    turbo.ref_lora = name;
    if (!turbo.on) return;
    if (was && was !== turbo.lora) S.removeLora(container, was);
    if (name || turbo.lora || turbo.merged) throwOn(container, widgetIO);
  } else {
    const was = turbo.lora;
    if (name === was) return;
    turbo.lora = name;
    if (!turbo.on) return;
    if (was && was !== turbo.ref_lora) S.removeLora(container, was);
    if (name || turbo.ref_lora || turbo.merged) throwOn(container, widgetIO);
  }
}

const QUALITY_TITLE = {
  draft: "4 steps — the fast look. Softer detail; heavy motion can smear.",
  medium: "6 steps — the comfort zone the turbo LoRAs were tuned for.",
  good: "8 steps — about as close to a native 20-step render as a distill gets. "
      + "Past 8 they over-sharpen rather than improve.",
};

// Truncate long model file names for the pill UI while keeping the full string in tooltips
const shortName = (name, maxLen = 18) => {
  if (!name) return "";
  const base = name.split("/").pop().replace(/\.[^.]+$/, "");
  return base.length > maxLen ? `${base.slice(0, maxLen - 2)}…` : base;
};

export function turboPills({ container, value, set, onCommit }) {
  const turbo = container.turbo;
  const on = turbo.on && engaged(container);

  let labelText = t("turbo off");
  if (on) {
    if (turbo.lora && turbo.ref_lora && turbo.lora !== turbo.ref_lora) {
      labelText = t("turbo · {fl} / {ref}", { fl: shortName(turbo.lora, 12), ref: shortName(turbo.ref_lora, 12) });
    } else if (turbo.lora) {
      labelText = t("turbo · {name}", { name: shortName(turbo.lora, 20) });
    } else if (turbo.ref_lora) {
      labelText = t("turbo · Ref: {name}", { name: shortName(turbo.ref_lora, 20) });
    } else {
      labelText = t("turbo · merged");
    }
  }

  const pills = [];

  pills.push(el("div", { class: `mmc-pill mmc-pill-group${on ? " accel-on" : ""}` }, [
    el("button", {
      class: "mmc-turbo-main",
      title: on
        ? t("Turbo on — steps: {steps}, sampler: euler + beta.\nFL2VA: {fl}\nRef2VA: {ref}", {
            steps: value("steps", "?"),
            fl: turbo.lora || t("none"),
            ref: turbo.ref_lora || turbo.lora || t("none"),
          })
        : t("Turbo off. Click to turn on Turbo sampling with the selected Turbo LoRA(s)."),
      onclick: (event) => {
        if (turbo.on) {
          throwOff(container, { value, set });
          onCommit();
        } else if (turbo.lora || turbo.ref_lora || turbo.merged) {
          throwOn(container, { value, set });
          onCommit();
        } else {
          openTurboChoice(event.currentTarget, {
            includeNone: NO_LORA,
            value: "",
            onPick: (picked) => {
              if (picked === t(NO_LORA)) turbo.merged = true;
              else {
                turbo.lora = picked;
                turbo.ref_lora = picked;
              }
              throwOn(container, { value, set });
              onCommit();
            },
          });
        }
      },
    }, [icon("bolt", 16), el("span", { text: labelText })]),

    ...(turbo.lora || turbo.ref_lora ? [el("button", {
      class: "mmc-step mmc-turbo-pick",
      title: t("Pick or change FL2VA / Ref2VA Turbo LoRAs."),
      onclick: (event) => openTurboChoice(event.currentTarget, {
        includeNone: true,
        value: turbo.lora || turbo.ref_lora,
        onPick: (picked) => {
          const val = picked === t("— none —") ? "" : picked;
          setTurboLora(container, val, { value, set }, "fl2va");
          if (!turbo.ref_lora) setTurboLora(container, val, { value, set }, "ref2va");
          onCommit();
        },
      }),
    }, [icon("chevron", 14)])] : []),
  ]));

  if (on) {
    const steps = Number(value("steps", 0));
    pills.push(el("div", { class: "mmc-pill mmc-turbo-seg" }, S.TURBO_QUALITIES.map((quality) => el("button", {
      class: "mmc-turbo-opt",
      "aria-pressed": steps === S.TURBO_STEPS[quality],
      title: t(QUALITY_TITLE[quality]),
      onclick: () => {
        turbo.quality = quality;
        set("steps", S.TURBO_STEPS[quality]);
        onCommit();
      },
    }, [
      el("span", { text: t(quality === "medium" ? "med" : quality) }),
      el("span", { class: "mmc-pill-sub", text: String(S.TURBO_STEPS[quality]) }),
    ]))));
  }

  return pills;
}

export function turboRow({ container, widgetIO, onChange }) {
  const NONE = "— none —";
  const turbo = container.turbo;

  const makeRow = (label, propName, hint, mode) => el("div", { class: "mmc-weight-row" }, [
    el("span", { class: "mmc-weight-name", text: t(label) }),
    el("button", {
      class: `mmc-weight-file${turbo[propName] ? "" : " empty"}`,
      title: t(hint),
      text: turbo[propName] || (turbo.merged ? t("no LoRA · merged checkpoint") : t("not set")),
      onclick: (event) => openTurboChoice(event.currentTarget, {
        includeNone: true,
        value: turbo[propName] || t(NONE),
        onPick: (picked) => {
          if (picked === t(NONE)) {
            if (propName === "lora") turbo.lora = "";
            else turbo.ref_lora = "";
            if (!turbo.lora && !turbo.ref_lora) turbo.merged = false;
          }
          setTurboLora(container, picked === t(NONE) ? "" : picked, widgetIO, mode);
          onChange();
        },
      }),
    }),
  ]);

  return [
    makeRow(
      "FL2VA Turbo LoRA",
      "lora",
      "The distillation LoRA used for FL2VA generations (text-only, keyframes, continuing shots).\n\n"
      + "'none' fits a checkpoint with distillation merged into the weights.",
      "fl2va"
    ),
    makeRow(
      "Ref2VA Turbo LoRA",
      "ref_lora",
      "The distillation LoRA used for Ref2VA generations (@ references).\n\n"
      + "If left unset, the FL2VA Turbo LoRA is used for both if set.",
      "ref2va"
    ),
  ];
}