import { el, icon, dismissable, placeNear } from "./dom.js";
import { t } from "./i18n.js";
import { ASPECT_PRESETS, MIN_SHORT_EDGE, MAX_SHORT_EDGE, NATIVE_SHORT_EDGE, CANVAS_MULTIPLE } from "./canvas.js";
import { UPSCALE_MODES, DEFAULT_REFINE_DENOISE, MIN_REFINE_DENOISE, MAX_REFINE_DENOISE,
         DEFAULT_REFINE_STEPS, DEFAULT_UPSCALE_SCALE, twoPass, sampleEdge } from "./state.js";
import { catalogLatentUpscalers, loadCatalog } from "./models.js";

export function stepperPill({ value, onChange, min = -Infinity, max = Infinity, step = 1,
                              iconName, format = String, title, width = "34px" }) {
  const clamp = (next) => Math.min(max, Math.max(min, Math.round(next * 1e6) / 1e6));
  const arrow = (label, delta) => el("button", {
    class: "mmc-step", text: label,
    disabled: clamp(value + delta) === value || undefined,
    onclick: () => onChange(clamp(value + delta)),
  });
  return el("div", { class: "mmc-pill mmc-pill-group", title }, [
    arrow("−", -step),
    ...(iconName ? [icon(iconName, 16)] : []),
    el("span", { text: format(value), style: { minWidth: width, textAlign: "center" } }),
    arrow("+", step),
  ]);
}

export function openChoicePopover(anchor, { title, options, value, onPick }) {
  const pop = el("div", { class: "mmc-pop mmc-pop-scroll" },
    title ? [el("div", { class: "mmc-pop-title", text: title })] : []);
  for (const option of options) {
    pop.appendChild(el("button", {
      class: "mmc-opt",
      "aria-checked": option === value,
      onclick: () => { close(); onPick(option); },
    }, [
      el("span", { class: "mmc-opt-label" }, [el("span", { text: option })]),
      el("span", { class: "mmc-radio" }),
    ]));
  }
  document.body.appendChild(pop);
  placeNear(pop, anchor);
  const close = dismissable(pop);
  pop.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: "center" });
}

export function aspectGlyph(ratio, long = 18) {
  const width = ratio >= 1 ? long : long * ratio;
  const height = ratio >= 1 ? long / ratio : long;
  return el("span", { class: "mmc-aspect-glyph", style: { width: `${long}px`, height: `${long}px` } }, [
    el("span", { style: { width: `${width}px`, height: `${height}px` } }),
  ]);
}

export const PILL_GLYPH = 16;

export function openAspectPopover(anchor, target, commit) {
  const pop = el("div", { class: "mmc-pop" }, [el("div", { class: "mmc-pop-title", text: t("Aspect Ratio") })]);
  for (const [label, ratio] of ASPECT_PRESETS) {
    pop.appendChild(el("button", {
      class: "mmc-opt",
      "aria-checked": target.aspect === label,
      onclick: () => { target.aspect = label; close(); commit(); },
    }, [
      el("span", { class: "mmc-opt-label" }, [aspectGlyph(ratio), el("span", { text: label })]),
      el("span", { class: "mmc-radio" }),
    ]));
  }
  document.body.appendChild(pop);
  placeNear(pop, anchor);
  const close = dismissable(pop);
}

export function edgeSlider({ min, max, step, value, mark, markLabel, apply, describe, commit }) {
  const edge = el("span", { class: "mmc-edge" });
  const size = el("span");
  const note = el("div", { class: "mmc-native" });
  const read = el("div", { class: "mmc-slider-read" }, [
    el("span", {}, [edge, el("span", { class: "mmc-edge-unit", text: "px" })]),
    size,
  ]);
  const slider = el("input", {
    type: "range", min, max, step, value,
    "aria-label": t("Short edge in pixels"),
    onpointerdown: (event) => event.stopPropagation(),
  });

  const snap = (n) => Math.min(max, Math.max(min, Math.round((n - min) / step) * step + min));

  const paint = () => {
    const current = Number(slider.value);
    edge.textContent = String(current);
    const shown = describe();
    size.textContent = shown.size;
    note.textContent = shown.note;
    note.classList.toggle("over", Boolean(shown.warn));
    down.disabled = current <= min;
    up.disabled = current >= max;
    marker?.classList.toggle("on", current === mark);
  };

  const set = (next) => {
    slider.value = String(snap(next));
    apply(Number(slider.value));
    paint();
    commit();
  };

  const stepper = (label, delta) => el("button", {
    class: "mmc-step", text: label,
    title: t(delta < 0 ? "Down {step} px" : "Up {step} px", { step }),
    "aria-label": t(delta < 0 ? "Smaller by {step} pixels" : "Larger by {step} pixels", { step }),
    onclick: () => set(Number(slider.value) + delta * step),
  });
  const down = stepper("−", -1);
  const up = stepper("+", 1);

  const marker = mark > min && mark < max
    ? el("button", {
        class: "mmc-slider-mark",
        title: t("{label} — {mark} px", { label: t(markLabel), mark }),
        onclick: () => set(mark),
      }, [el("span", { text: t(markLabel) })])
    : null;
  marker?.style.setProperty("--p", String((mark - min) / (max - min)));

  slider.addEventListener("input", () => { apply(Number(slider.value)); paint(); });
  slider.addEventListener("change", () => commit());

  if (Number(slider.value) !== value) apply(Number(slider.value));

  const body = el("div", { class: "mmc-slider-body" }, [
    read,
    el("div", { class: "mmc-slider-row" }, [
      down,
      el("div", { class: "mmc-slider-track" }, [slider, marker]),
      up,
    ]),
    note,
  ]);
  body.repaint = paint;
  paint();
  return body;
}

export function openResolutionPopover(anchor, target, geometry, commit) {
  loadCatalog(() => { if (pop.isConnected) renderSection(); });
  const section = el("div");

  const BASE_PRESETS = [
    { edge: 352, label: "352p" },
    { edge: 384, label: "384p" },
    { edge: 480, label: "480p" },
    { edge: 544, label: "544p" },
    { edge: 640, label: "640p" },
    { edge: 768, label: "768p" },
  ];

  const renderSection = () => {
    const { width, height } = geometry();
    const over = target.short_edge > NATIVE_SHORT_EDGE;
    const cap = Math.min(NATIVE_SHORT_EDGE, target.short_edge);
    const curSampleEdge = sampleEdge(target);
    const upscalerModels = catalogLatentUpscalers();

    const option = (mode, label, sub) => el("button", {
      class: "mmc-opt",
      "aria-checked": target.upscale === mode,
      onclick: () => {
        target.upscale = mode;
        body.repaint();
        commit();
      },
    }, [
      el("span", { class: "mmc-opt-label mmc-opt-col" }, [
        el("span", { text: label }),
        el("span", { class: "mmc-opt-sub", text: sub }),
      ]),
      el("span", { class: "mmc-radio" }),
    ]);

    const rows = [];
    if (over) {
      rows.push(
        option(UPSCALE_MODES[0], t("two passes"),
               t("{edge} px first, refined up to {width} × {height}",
                 { edge: curSampleEdge, width, height })),
        option("direct", t("direct"),
               t("one pass at {width} × {height} — off-distribution", { width, height })));
    }

    // Base sampling resolution selector & quick presets
    if (!over || target.upscale !== "direct") {
      const presetChips = BASE_PRESETS.filter((p) => p.edge <= target.short_edge).map((p) => el("button", {
        class: `mmc-chip${curSampleEdge === p.edge ? " on" : ""}`,
        style: { fontSize: "11px", padding: "2px 8px" },
        text: p.label,
        title: t("Sample Pass 1 at {edge}px base resolution", { edge: p.edge }),
        onclick: () => {
          target.sample_edge = p.edge;
          if (p.edge < target.short_edge) target.upscale = UPSCALE_MODES[0];
          body.repaint();
          commit();
        },
      }));

      rows.push(el("div", { class: "mmc-refine-row", style: { flexDirection: "column", alignItems: "flex-start", gap: "6px" } }, [
        el("div", { style: { display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center" } }, [
          el("span", { class: "mmc-refine-label", text: t("sampled at (pass 1)") }),
          stepperPill({
            value: curSampleEdge,
            min: MIN_SHORT_EDGE, max: cap, step: CANVAS_MULTIPLE, width: "56px",
            title: t("The short edge Pass 1 samples at. Lower is much faster; the upscaler and refine pass upscale it to target size."),
            format: (n) => `${n} px`,
            onChange: (next) => {
              target.sample_edge = next;
              if (next < target.short_edge) target.upscale = UPSCALE_MODES[0];
              body.repaint();
              commit();
            },
          }),
        ]),
        el("div", { class: "mmc-chips", style: { gap: "4px" } }, presetChips),
      ]));
    }

    if (twoPass(target)) {
      // 1. Latent Upscaler Model Selection with Clean Truncation & Ellipsis
      const curUpscaler = target.upscale_model || "bicubic (interpolated)";
      const formatModelLabel = (name) => {
        if (!name || name.startsWith("bicubic")) return "bicubic";
        const clean = name.split("/").pop().replace(/\.(safetensors|pth)$/i, "");
        return clean.length > 20 ? `${clean.slice(0, 18)}…` : clean;
      };

      rows.push(el("div", { class: "mmc-refine-row" }, [
        el("span", { class: "mmc-refine-label", text: t("upscaler") }),
        el("button", {
          class: "mmc-pill",
          style: {
            maxWidth: "160px",
            minWidth: "0",
            padding: "0 8px",
            display: "inline-flex",
            alignItems: "center",
            overflow: "hidden"
          },
          title: t("Model: {name}\nPick a neural latent upscaler (2D or 3D) from models/latent_upscale_models/", { name: curUpscaler }),
          onclick: (e) => openChoicePopover(e.currentTarget, {
            title: t("Latent Upscaler Model"),
            options: ["bicubic (interpolated)", ...upscalerModels],
            value: curUpscaler,
            onPick: (picked) => {
              target.upscale_model = picked.startsWith("bicubic") ? "" : picked;
              body.repaint();
              commit();
            },
          }),
        }, [
          el("span", {
            style: {
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "block",
              maxWidth: "100%",
            },
            text: formatModelLabel(curUpscaler),
          })
        ]),
      ]));

      // 2. Refine Steps (Default: 1)
      rows.push(el("div", { class: "mmc-refine-row" }, [
        el("span", { class: "mmc-refine-label", text: t("refine steps") }),
        stepperPill({
          value: Number(target.refine_steps ?? DEFAULT_REFINE_STEPS),
          min: 1, max: 20, step: 1, width: "40px",
          title: t("How many diffusion steps to run on Pass 2 at target resolution."),
          format: (n) => t("{n} step{s}", { n, s: n > 1 ? "s" : "" }),
          onChange: (next) => { target.refine_steps = next; body.repaint(); commit(); },
        }),
      ]));

      // 3. Refine Denoise (Default: 0.25)
      rows.push(el("div", { class: "mmc-refine-row" }, [
        el("span", { class: "mmc-refine-label", text: t("refine denoise") }),
        stepperPill({
          value: Number(target.refine_denoise ?? DEFAULT_REFINE_DENOISE),
          min: MIN_REFINE_DENOISE, max: MAX_REFINE_DENOISE, step: 0.05, width: "40px",
          title: t("Denoise strength for Pass 2. 0.25 is the optimal sweet spot."),
          format: (n) => n.toFixed(2),
          onChange: (next) => { target.refine_denoise = next; body.repaint(); commit(); },
        }),
      ]));

      // 4. Turbo on Refine Only Toggle
      const isGlobalTurbo = target.turbo?.on === true;
      if (!isGlobalTurbo) {
        rows.push(el("div", { class: "mmc-refine-row" }, [
          el("span", { class: "mmc-refine-label", text: t("turbo on refine") }),
          el("button", {
            class: `mmc-pill${target.refine_turbo_only ? " on" : ""}`,
            title: t("Apply Turbo LoRA specifically to Pass 2 so 1-step refinement runs ultra fast."),
            onclick: () => {
              target.refine_turbo_only = !target.refine_turbo_only;
              body.repaint();
              commit();
            },
          }, [icon("bolt", 13), el("span", { text: target.refine_turbo_only ? t("on (1-step)") : t("off") })]),
        ]));
      }
    }

    section.className = rows.length ? "mmc-twopass" : "";
    section.replaceChildren(...rows);
  };

  const body = edgeSlider({
    min: MIN_SHORT_EDGE, max: MAX_SHORT_EDGE, step: CANVAS_MULTIPLE,
    value: target.short_edge, mark: NATIVE_SHORT_EDGE, markLabel: "native",
    apply: (edge) => { target.short_edge = edge; },
    describe: () => {
      renderSection();
      const { width, height } = geometry();
      const over = target.short_edge > NATIVE_SHORT_EDGE;
      if (twoPass(target)) {
        return {
          size: `${width} × ${height}`,
          warn: false,
          note: t("Pass 1 at {edge} px, then refined up to {width} × {height} ({steps} step @ {denoise}).",
                  { edge: sampleEdge(target), width, height, steps: target.refine_steps ?? 1, denoise: (target.refine_denoise ?? DEFAULT_REFINE_DENOISE).toFixed(2) }),
        };
      }
      return {
        size: `${width} × ${height}`,
        warn: over,
        note: over
          ? t("Above the trained {edge} px short edge — off-distribution, not just slower.", { edge: NATIVE_SHORT_EDGE })
          : target.short_edge === NATIVE_SHORT_EDGE
            ? t("Native. What the open weights were trained at.")
            : t("{ratio}× smaller short edge than native — faster, softer.",
                { ratio: (NATIVE_SHORT_EDGE / target.short_edge).toFixed(1) }),
      };
    },
    commit,
  });

  const pop = el("div", { class: "mmc-pop mmc-slider" }, [body, section]);
  document.body.appendChild(pop);
  placeNear(pop, anchor);
  dismissable(pop);
}