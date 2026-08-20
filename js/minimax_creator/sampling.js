import { el, icon } from "./dom.js";
import { t } from "./i18n.js";
import { openChoicePopover, stepperPill, openVramShieldPopover } from "./pills.js";
import * as S from "./state.js";

export const SEED_CONTROL = ["fixed", "increment", "decrement", "randomize"];

export const SAMPLING_WIDGETS = [
  "seed",
  "control_after_generate",
  "steps",
  "cfg",
  "sampler_name",
  "scheduler",
  "speed_preset",
  "block_cache",
  "spectrum",
  "spectrum_blend",
  "low_vram_attn",
  "head_chunks",
  "chunk_ffn",
  "ffn_chunks",
  "ffn_seq_threshold",
];

const BLOCK_CACHE_TITLE = {
  off: "FirstBlockCache is off.",
  safe: "FirstBlockCache, safest preset — fewest skipped steps.",
  fast: "FirstBlockCache, the pack's recommended preset.",
  aggressive: "FirstBlockCache, most skipping — fastest, furthest from a native render.",
};

export function randomizeSeed(set) {
  const newSeed = Math.floor(Math.random() * 0xffffffff);
  set("seed", newSeed);
  return newSeed;
}

export function handlePreGenerateSeed(value, set) {
  const control = value("control_after_generate", "fixed");
  if (control === "randomize") {
    return randomizeSeed(set);
  } else if (control === "increment") {
    const cur = Number(value("seed", 0));
    const next = (cur + 1) % 0xffffffff;
    set("seed", next);
    return next;
  } else if (control === "decrement") {
    const cur = Number(value("seed", 0));
    const next = cur > 0 ? cur - 1 : 0xffffffff;
    set("seed", next);
    return next;
  }
  return value("seed", 0);
}

export function samplingBar({ widgets = {}, value, set, perSegment = false, turbo = [], trailing = [] }) {
  const pills = [];

  // 1. Seed & Generation Control
  const seedVal = value("seed", 0);
  const control = value("control_after_generate", "fixed");
  pills.push(el("div", { class: "mmc-pill mmc-pill-group" }, [
    el("button", {
      class: "mmc-step mmc-seed-dice",
      title: t("Roll a new seed now"),
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => {
        e.stopPropagation();
        randomizeSeed(set);
      },
    }, [icon("dice", 15)]),
    el("input", {
      class: "mmc-seed-input",
      type: "text",
      value: String(seedVal),
      title: perSegment
        ? t("Segment k runs on seed + k, so consecutive shots are not the same noise twice.")
        : t("The seed of the one generation."),
      onchange: (event) => {
        const parsed = Number(String(event.target.value).replace(/[^\d]/g, "")) || 0;
        set("seed", parsed);
      },
      onpointerdown: (event) => event.stopPropagation(),
    }),
    el("button", {
      class: "mmc-ghost mmc-seed-mode",
      title: t("What happens to the seed after each queue"),
      text: control,
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (event) => {
        event.stopPropagation();
        openChoicePopover(event.currentTarget, {
          title: t("After generate"),
          options: SEED_CONTROL,
          value: control,
          onPick: (picked) => set("control_after_generate", picked),
        });
      },
    }),
  ]));

  // 2. Steps Stepper
  const stepsVal = Number(value("steps", 20));
  pills.push(stepperPill({
    value: stepsVal, min: 1, max: 200, step: 1,
    iconName: "steps", width: "42px",
    title: perSegment ? t("Denoising steps, per segment") : t("Denoising steps"),
    format: (n) => t("{n} steps", { n }),
    onChange: (next) => set("steps", next),
  }));

  // 3. CFG Stepper
  const cfgVal = Number(value("cfg", 1.0));
  pills.push(stepperPill({
    value: cfgVal, min: 0, max: 30, step: 0.5, width: "52px",
    title: t("Classifier-free guidance."),
    format: (n) => t("cfg {n}", { n: n.toFixed(1) }),
    onChange: (next) => set("cfg", next),
  }));

  // 4. Sampler & Scheduler Choices
  for (const [name, label, defVal] of [["sampler_name", "Sampler", "res_multistep"], ["scheduler", "Scheduler", "simple"]]) {
    const curVal = String(value(name, defVal));
    const widget = widgets[name];
    const options = widget?.options?.values || [];
    pills.push(el("button", {
      class: "mmc-pill",
      title: t(label),
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (event) => {
        event.stopPropagation();
        openChoicePopover(event.currentTarget, {
          title: t(label),
          options: typeof options === "function" ? options(widget) : (options.length ? options : [curVal]),
          value: curVal,
          onPick: (picked) => set(name, picked),
        });
      },
    }, [el("span", { text: curVal })]));
  }

  // 5. Turbo Pills
  pills.push(...turbo);

  // 6. SPEED Progressive Sampler Pill
  const curSpeed = String(value("speed_preset", "off"));
  const speedOn = curSpeed !== "off";
  const speedLabel = () => {
    if (!speedOn) return t("speed off");
    if (curSpeed.includes("Half -> Full")) return t("speed: 0.5x");
    if (curSpeed.includes("Three-Quarter")) return t("speed: 0.75x");
    if (curSpeed.includes("3-Stage")) return t("speed: 3-stage");
    return t("speed on");
  };

  pills.push(el("button", {
    class: `mmc-pill${speedOn ? " accel-on" : ""}`,
    title: speedOn
      ? t("SPEED Progressive Sampler Active (+40% speedup): Layout denoised at coarse resolution before DCT expanding to 100%. Auto-bypasses on I2V keyframes.")
      : t("SPEED Progressive Sampler: Denoises coarse layout early for high-speed DiT evaluation, then spectral-expands to full resolution."),
    onpointerdown: (e) => e.stopPropagation(),
    onclick: (event) => {
      event.stopPropagation();
      openChoicePopover(event.currentTarget, {
        title: t("SPEED Progressive Sampler"),
        options: S.SPEED_PRESETS,
        value: curSpeed,
        onPick: (picked) => set("speed_preset", picked),
      });
    },
  }, [
    icon("bolt", 14),
    el("span", { text: speedLabel() }),
  ]));

  // 7. VRAM Shield (Low VRAM Attention & Chunk FeedForward)
  const lowVramOn = Boolean(value("low_vram_attn", false)) || Boolean(value("chunk_ffn", false));
  pills.push(el("button", {
    class: `mmc-pill${lowVramOn ? " accel-on" : ""}`,
    title: lowVramOn
      ? t("VRAM Shield Active: Attention Head Chunking & FFN Sequence Chunking enabled to prevent OOM.")
      : t("VRAM Shield Off: Click to configure Low VRAM Attention & Chunk FeedForward memory protection."),
    onpointerdown: (e) => e.stopPropagation(),
    onclick: (event) => {
      event.stopPropagation();
      openVramShieldPopover(event.currentTarget, {
        getLowVram: () => Boolean(value("low_vram_attn", false)),
        setLowVram: (v) => set("low_vram_attn", v),
        getHeadChunks: () => Number(value("head_chunks", 4)),
        setHeadChunks: (v) => set("head_chunks", v),
        getChunkFfn: () => Boolean(value("chunk_ffn", false)),
        setChunkFfn: (v) => set("chunk_ffn", v),
        getFfnChunks: () => Number(value("ffn_chunks", 2)),
        setFfnChunks: (v) => set("ffn_chunks", v),
        getFfnThreshold: () => Number(value("ffn_seq_threshold", 4096)),
        setFfnThreshold: (v) => set("ffn_seq_threshold", v),
      });
    },
  }, [
    icon("lock", 13),
    el("span", { text: lowVramOn ? t("vram shield") : t("vram shield off") }),
  ]));

  // 8. FirstBlockCache
  if (widgets.block_cache || value("block_cache", null) !== null) {
    const curCache = String(value("block_cache", "off"));
    const cacheWidget = widgets.block_cache;
    const cacheOptions = cacheWidget?.options?.values || ["off", "safe", "fast", "aggressive"];
    pills.push(el("button", {
      class: `mmc-pill${curCache !== "off" ? " accel-on" : ""}`,
      title: BLOCK_CACHE_TITLE[curCache] ? t(BLOCK_CACHE_TITLE[curCache]) : t("FirstBlockCache"),
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (event) => {
        event.stopPropagation();
        openChoicePopover(event.currentTarget, {
          title: t("Block cache"),
          options: typeof cacheOptions === "function" ? cacheOptions(cacheWidget) : cacheOptions,
          value: curCache,
          onPick: (picked) => set("block_cache", picked),
        });
      },
    }, [el("span", { text: curCache === "off" ? t("cache off") : t("cache {preset}", { preset: curCache }) })]));
  }

  // 9. Spectrum
  if (widgets.spectrum || value("spectrum", null) !== null) {
    const spectrumOn = Boolean(value("spectrum", false));
    pills.push(el("button", {
      class: `mmc-pill${spectrumOn ? " accel-on" : ""}`,
      title: spectrumOn
        ? t("Spectrum on — forecasting features across steps. Click to turn off.")
        : t("Spectrum off. Click to turn on."),
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => {
        e.stopPropagation();
        set("spectrum", !spectrumOn);
      },
    }, [el("span", { text: spectrumOn ? t("spectrum") : t("spectrum off") })]));

    if (spectrumOn) {
      const blendVal = Number(value("spectrum_blend", 0.5));
      pills.push(stepperPill({
        value: blendVal, min: 0, max: 1, step: 0.05, width: "52px",
        title: t("Spectrum's video spectral share — higher is faster and further from a native render"),
        format: (n) => t("blend {n}", { n: n.toFixed(2) }),
        onChange: (next) => set("spectrum_blend", next),
      }));
    }
  }

  return el("div", { class: "mmc-pills", onpointerdown: (e) => e.stopPropagation() }, [...pills, ...trailing]);
}