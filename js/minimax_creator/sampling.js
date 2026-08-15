import { el, icon } from "./dom.js";
import { t } from "./i18n.js";
import { openChoicePopover, stepperPill } from "./pills.js";

export const SEED_CONTROL = ["fixed", "increment", "decrement", "randomize"];

export const SAMPLING_WIDGETS = [
  "seed", "control_after_generate", "steps", "cfg", "sampler_name", "scheduler",
  "block_cache", "spectrum", "spectrum_blend",
];

const BLOCK_CACHE_TITLE = {
  off: "FirstBlockCache is off.",
  safe: "FirstBlockCache, safest preset — fewest skipped steps.",
  fast: "FirstBlockCache, the pack's recommended preset.",
  aggressive: "FirstBlockCache, most skipping — fastest, furthest from a native render.",
};

export function samplingBar({ widgets, value, set, perSegment = false, turbo = [], trailing = [] }) {
  const pills = [];

  if (widgets.seed) {
    const control = value("control_after_generate", "fixed");
    pills.push(el("div", { class: "mmc-pill mmc-pill-group" }, [
      el("button", {
        class: "mmc-step mmc-seed-dice",
        title: t("Roll a new seed now"),
        onclick: () => set("seed", Math.floor(Math.random() * 0xffffffff)),
      }, [icon("dice", 15)]),
      el("input", {
        class: "mmc-seed-input",
        type: "text",
        value: String(value("seed", 0)),
        title: perSegment
          ? t("Segment k runs on seed + k, so consecutive shots are not the same noise twice.")
          : t("The seed of the one generation."),
        onchange: (event) => {
          const parsed = Number(String(event.target.value).replace(/[^\d]/g, "")) || 0;
          set("seed", parsed);
        },
        onpointerdown: (event) => event.stopPropagation(),
      }),
      ...(widgets.control_after_generate ? [el("button", {
        class: "mmc-ghost mmc-seed-mode",
        title: t("What happens to the seed after each queue"),
        text: control,
        onclick: (event) => openChoicePopover(event.currentTarget, {
          title: t("After generate"),
          options: SEED_CONTROL,
          value: control,
          onPick: (picked) => set("control_after_generate", picked),
        }),
      })] : []),
    ]));
  }

  if (widgets.steps) {
    pills.push(stepperPill({
      value: Number(value("steps", 20)), min: 1, max: 200, step: 1,
      iconName: "steps", width: "42px",
      title: perSegment ? t("Denoising steps, per segment") : t("Denoising steps"),
      format: (n) => t("{n} steps", { n }),
      onChange: (next) => set("steps", next),
    }));
  }

  if (widgets.cfg) {
    pills.push(stepperPill({
      value: Number(value("cfg", 1)), min: 0, max: 30, step: 0.5, width: "52px",
      title: t("Classifier-free guidance. The distilled H3 checkpoints want 1.0, "
           + "and at 1.0 the negative is skipped entirely."),
      format: (n) => t("cfg {n}", { n: n.toFixed(1) }),
      onChange: (next) => set("cfg", next),
    }));
  }

  for (const [name, label] of [["sampler_name", "Sampler"], ["scheduler", "Scheduler"]]) {
    const widget = widgets[name];
    if (!widget) continue;
    const options = widget.options?.values || [];
    pills.push(el("button", {
      class: "mmc-pill",
      title: t(label),
      onclick: (event) => openChoicePopover(event.currentTarget, {
        title: t(label),
        options: typeof options === "function" ? options(widget) : options,
        value: widget.value,
        onPick: (picked) => set(name, picked),
      }),
    }, [el("span", { text: String(widget.value) })]));
  }

  pills.push(...turbo);

  if (widgets.block_cache) {
    const options = widgets.block_cache.options?.values || [];
    const current = String(value("block_cache", "off"));
    pills.push(el("button", {
      class: `mmc-pill${current === "off" ? "" : " accel-on"}`,
      title: BLOCK_CACHE_TITLE[current] ? t(BLOCK_CACHE_TITLE[current]) : t("FirstBlockCache"),
      onclick: (event) => openChoicePopover(event.currentTarget, {
        title: t("Block cache"),
        options: typeof options === "function" ? options(widgets.block_cache) : options,
        value: current,
        onPick: (picked) => set("block_cache", picked),
      }),
    }, [el("span", { text: current === "off" ? t("cache off") : t("cache {preset}", { preset: current }) })]));
  }

  if (widgets.spectrum) {
    const on = Boolean(value("spectrum", false));
    pills.push(el("button", {
      class: `mmc-pill${on ? " accel-on" : ""}`,
      title: on
        ? t("Spectrum on — forecasting features across steps.")
        : t("Spectrum off. Needs ComfyUI-Spectrum-MiniMax-H3 when switched on."),
      onclick: () => set("spectrum", !on),
    }, [el("span", { text: on ? t("spectrum") : t("spectrum off") })]));

    if (on && widgets.spectrum_blend) {
      pills.push(stepperPill({
        value: Number(value("spectrum_blend", 0.5)), min: 0, max: 1, step: 0.05, width: "52px",
        title: t("Spectrum's video spectral share — higher is faster and further from a native render"),
        format: (n) => t("blend {n}", { n: n.toFixed(2) }),
        onChange: (next) => set("spectrum_blend", next),
      }));
    }
  }

  return el("div", { class: "mmc-pills" }, [...pills, ...trailing]);
}