import { el, icon, dismissable, placeNear } from "./dom.js";
import { t } from "./i18n.js";
import { ASPECT_PRESETS, MIN_SHORT_EDGE, MAX_SHORT_EDGE, NATIVE_SHORT_EDGE, CANVAS_MULTIPLE } from "./canvas.js";
import { UPSCALE_MODES, DEFAULT_REFINE_DENOISE, MIN_REFINE_DENOISE, MAX_REFINE_DENOISE,
         DEFAULT_REFINE_STEPS, DEFAULT_UPSCALE_SCALE, RTX_QUALITIES, DEFAULT_RTX_QUALITY,
         twoPass, rtxVsr, sampleEdge } from "./state.js";
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
  body.setValue = (newVal) => set(newVal);
  paint();
  return body;
}

export function openVramShieldPopover(anchor, hooks) {
  const pop = el("div", { class: "mmc-pop mmc-weights-pop", style: { width: "320px", padding: "12px 14px" } });

  const render = () => {
    const isAttnOn = hooks.getLowVram();
    const headChunks = hooks.getHeadChunks();
    const isFfnOn = hooks.getChunkFfn();
    const ffnChunks = hooks.getFfnChunks();
    const ffnThreshold = hooks.getFfnThreshold();

    const title = el("div", { class: "mmc-pop-title", style: { padding: "0 0 8px 0" }, text: t("🛡️ VRAM Shield (Memory Protection)") });

    const attnRow = el("div", { class: "mmc-refine-row", style: { padding: "6px 0" } }, [
      el("span", { class: "mmc-refine-label", text: t("Low VRAM Attention") }),
      el("button", {
        class: `mmc-pill${isAttnOn ? " on" : ""}`,
        title: t("Splits attention heads into smaller groups during computation to prevent VRAM spikes."),
        onclick: () => {
          hooks.setLowVram(!isAttnOn);
          render();
        },
      }, [el("span", { text: isAttnOn ? t("on") : t("off") })]),
    ]);

    const headChunksRow = isAttnOn ? el("div", { class: "mmc-refine-row", style: { padding: "4px 0" } }, [
      el("span", { class: "mmc-refine-label", text: t("Head Chunks") }),
      stepperPill({
        value: headChunks,
        min: 1, max: 16, step: 1, width: "42px",
        title: t("Number of head chunks. 4 chunks is recommended for 12GB/16GB VRAM GPUs."),
        format: (n) => `${n}x`,
        onChange: (next) => {
          hooks.setHeadChunks(next);
          render();
        },
      }),
    ]) : null;

    const ffnRow = el("div", { class: "mmc-refine-row", style: { padding: "6px 0", borderTop: "1px solid var(--mmc-line)", marginTop: "6px" } }, [
      el("span", { class: "mmc-refine-label", text: t("Chunk FeedForward (FFN)") }),
      el("button", {
        class: `mmc-pill${isFfnOn ? " on" : ""}`,
        title: t("Evaluates FFN (SwiGLU/MLP) layers in sequence chunks to prevent peak activation OOMs."),
        onclick: () => {
          hooks.setChunkFfn(!isFfnOn);
          render();
        },
      }, [el("span", { text: isFfnOn ? t("on") : t("off") })]),
    ]);

    const ffnChunksRow = isFfnOn ? el("div", { class: "mmc-refine-row", style: { padding: "4px 0" } }, [
      el("span", { class: "mmc-refine-label", text: t("FFN Chunks") }),
      stepperPill({
        value: ffnChunks,
        min: 1, max: 8, step: 1, width: "42px",
        title: t("Number of sequential chunks for FFN layers."),
        format: (n) => `${n}x`,
        onChange: (next) => {
          hooks.setFfnChunks(next);
          render();
        },
      }),
    ]) : null;

    const ffnThreshRow = isFfnOn ? el("div", { class: "mmc-refine-row", style: { padding: "4px 0" } }, [
      el("span", { class: "mmc-refine-label", text: t("Sequence Threshold") }),
      stepperPill({
        value: ffnThreshold,
        min: 1024, max: 32768, step: 1024, width: "56px",
        title: t("Token sequence threshold above which FFN chunking activates."),
        format: (n) => `${n}`,
        onChange: (next) => {
          hooks.setFfnThreshold(next);
          render();
        },
      }),
    ]) : null;

    pop.replaceChildren(
      title,
      attnRow,
      ...(headChunksRow ? [headChunksRow] : []),
      ffnRow,
      ...(ffnChunksRow ? [ffnChunksRow] : []),
      ...(ffnThreshRow ? [ffnThreshRow] : [])
    );
  };

  render();
  document.body.appendChild(pop);
  placeNear(pop, anchor);
  dismissable(pop);
}

export function openResolutionPopover(anchor, target, geometry, commit) {
  const pop = el("div", { class: "mmc-pop mmc-res-popover" });
  let sliderControl = null;

  const TARGET_PRESETS = [
    { edge: 480, label: "480p" },
    { edge: 576, label: "576p" },
    { edge: 720, label: "720p" },
    { edge: 768, label: "768p", native: true },
    { edge: 1080, label: "1080p" },
    { edge: 1440, label: "1440p (2K)" },
    { edge: 2048, label: "4K (Max)" },
  ];

  const BASE_SAMPLE_PRESETS = [
    { edge: 352, label: "352p" },
    { edge: 384, label: "384p" },
    { edge: 480, label: "480p" },
    { edge: 544, label: "544p" },
    { edge: 640, label: "640p" },
    { edge: 768, label: "768p" },
  ];

  const getGeometry = () => {
    const geom = typeof geometry === "function" ? geometry() : geometry;
    const width = geom?.width ?? (Array.isArray(geom) ? geom[0] : 1344);
    const height = geom?.height ?? (Array.isArray(geom) ? geom[1] : 768);
    return { width, height };
  };

  const getActiveStrategy = () => {
    if (target.upscale === "rtx_vsr" || target.rtx_upscale === true) return "rtx_vsr";
    if (target.upscale === "two_pass") return "two_pass";
    if (target.short_edge > NATIVE_SHORT_EDGE && !target.upscale) return "two_pass";
    return target.upscale || "direct";
  };

  const render = () => {
    const { width, height } = getGeometry();
    const curEdge = target.short_edge || NATIVE_SHORT_EDGE;
    const activeStrategy = getActiveStrategy();
    const curSampleEdge = sampleEdge(target);
    const cap = Math.min(NATIVE_SHORT_EDGE, curEdge);

    // =========================================================================
    // ZONE 1: TARGET OUTPUT RESOLUTION
    // =========================================================================
    const header = el("div", { class: "mmc-res-header" }, [
      el("div", { class: "mmc-res-title-row" }, [
        el("div", { class: "mmc-res-title" }, [
          icon("res", 14),
          el("span", { text: t("Target Output: {edge}p", { edge: curEdge }) }),
        ]),
        el("span", { class: "mmc-res-dim-badge", text: `${width} × ${height}` }),
      ]),
    ]);

    const targetChips = el("div", { class: "mmc-res-presets-row" }, TARGET_PRESETS.map((p) => el("button", {
      class: `mmc-chip mmc-res-chip${curEdge === p.edge ? " on" : ""}${p.native ? " native" : ""}`,
      text: p.label,
      title: t("Set output resolution to {edge}p", { edge: p.edge }),
      onclick: () => {
        target.short_edge = p.edge;
        if (p.edge > NATIVE_SHORT_EDGE && target.upscale === "direct") {
          target.upscale = "two_pass";
        }
        sliderControl?.setValue(p.edge);
        render();
        commit();
      },
    })));

    sliderControl = edgeSlider({
      min: MIN_SHORT_EDGE, max: MAX_SHORT_EDGE, step: CANVAS_MULTIPLE,
      value: curEdge, mark: NATIVE_SHORT_EDGE, markLabel: "native",
      apply: (edge) => {
        target.short_edge = edge;
        if (edge > NATIVE_SHORT_EDGE && target.upscale === "direct") {
          target.upscale = "two_pass";
        }
      },
      describe: () => {
        const { width: w, height: h } = getGeometry();
        const over = target.short_edge > NATIVE_SHORT_EDGE;
        return {
          size: `${w} × ${h}`,
          warn: over && activeStrategy === "direct",
          note: activeStrategy === "two_pass"
            ? t("Base sampled at {sample}p → Latent Refined up to {w} × {h}.", { sample: sampleEdge(target), w, h })
            : activeStrategy === "rtx_vsr"
              ? t("Base sampled at {sample}p → NVIDIA RTX VSR upscaled to {w} × {h}.", { sample: sampleEdge(target), w, h })
              : over
                ? t("⚠️ Above 768p native — direct sampling is off-distribution. Consider 2-Pass Refine or RTX VSR.")
                : t("✓ Native single-pass generation at {w} × {h}.", { w, h }),
        };
      },
      commit: () => {
        render();
        commit();
      },
    });

    // =========================================================================
    // ZONE 2: RENDERING STRATEGY SEGMENTED TABS (Always Visible)
    // =========================================================================
    const strategyBar = el("div", { class: "mmc-res-tabs" }, [
      el("button", {
        class: `mmc-res-tab${activeStrategy === "direct" ? " active" : ""}`,
        title: t("Direct generation: Single pass without neural or AI upscaling"),
        onclick: () => {
          target.upscale = "direct";
          target.rtx_upscale = false;
          render();
          commit();
        },
      }, [el("span", { text: t("⚡ Direct") })]),

      el("button", {
        class: `mmc-res-tab${activeStrategy === "two_pass" ? " active" : ""}`,
        title: t("2-Pass Refine: Fast low-res base latent + neural upscaler & refine diffusion pass"),
        onclick: () => {
          target.upscale = "two_pass";
          target.rtx_upscale = false;
          render();
          commit();
        },
      }, [el("span", { text: t("✨ 2-Pass Refine") })]),

      el("button", {
        class: `mmc-res-tab${activeStrategy === "rtx_vsr" ? " active" : ""}`,
        title: t("NVIDIA RTX VSR: Hardware Tensor Core AI pixel upscaling (zero diffusion overhead)"),
        onclick: () => {
          target.upscale = "rtx_vsr";
          target.rtx_upscale = true;
          render();
          commit();
        },
      }, [el("span", { text: t("🎮 RTX VSR") })]),
    ]);

    // =========================================================================
    // ZONE 3: CONTEXTUAL STRATEGY PANEL
    // =========================================================================
    let contextPanel;

    if (activeStrategy === "two_pass") {
      const upscalerModels = catalogLatentUpscalers();
      const curUpscaler = target.upscale_model || "bicubic (interpolated)";
      const formatModelLabel = (name) => {
        if (!name || name.startsWith("bicubic")) return "bicubic";
        const clean = name.split("/").pop().replace(/\.(safetensors|pth)$/i, "");
        return clean.length > 18 ? `${clean.slice(0, 16)}…` : clean;
      };

      const baseSampleChips = el("div", { class: "mmc-chips", style: { gap: "4px" } },
        BASE_SAMPLE_PRESETS.filter((p) => p.edge <= curEdge).map((p) => el("button", {
          class: `mmc-chip${curSampleEdge === p.edge ? " on" : ""}`,
          style: { fontSize: "10.5px", padding: "2px 7px" },
          text: p.label,
          onclick: () => {
            target.sample_edge = p.edge;
            render();
            commit();
          },
        }))
      );

      const isGlobalTurbo = target.turbo?.on === true;

      contextPanel = el("div", { class: "mmc-res-card" }, [
        el("div", { class: "mmc-res-row" }, [
          el("span", { class: "mmc-refine-label", text: t("Base Sample (Pass 1)") }),
          stepperPill({
            value: curSampleEdge,
            min: MIN_SHORT_EDGE, max: cap, step: CANVAS_MULTIPLE, width: "52px",
            title: t("Short edge Pass 1 samples at. Lower is faster; neural upscaler scales it to target resolution."),
            format: (n) => `${n}px`,
            onChange: (next) => {
              target.sample_edge = next;
              render();
              commit();
            },
          }),
        ]),
        baseSampleChips,
        el("div", { class: "mmc-res-row", style: { borderTop: "1px solid var(--mmc-line)", paddingTop: "8px", marginTop: "4px" } }, [
          el("span", { class: "mmc-refine-label", text: t("Latent Upscaler") }),
          el("button", {
            class: "mmc-pill",
            style: { maxWidth: "160px", overflow: "hidden" },
            title: t("Neural Latent Upscaler model from models/latent_upscale_models/"),
            onclick: (e) => openChoicePopover(e.currentTarget, {
              title: t("Latent Upscaler Model"),
              options: ["bicubic (interpolated)", ...upscalerModels],
              value: curUpscaler,
              onPick: (picked) => {
                target.upscale_model = picked.startsWith("bicubic") ? "" : picked;
                render();
                commit();
              },
            }),
          }, [el("span", { text: formatModelLabel(curUpscaler) })]),
        ]),
        el("div", { class: "mmc-res-row" }, [
          el("span", { class: "mmc-refine-label", text: t("Refine Denoise") }),
          stepperPill({
            value: Number(target.refine_denoise ?? DEFAULT_REFINE_DENOISE),
            min: MIN_REFINE_DENOISE, max: MAX_REFINE_DENOISE, step: 0.05, width: "42px",
            title: t("Denoise strength for Pass 2 (0.25 is optimal)"),
            format: (n) => n.toFixed(2),
            onChange: (next) => { target.refine_denoise = next; render(); commit(); },
          }),
        ]),
        el("div", { class: "mmc-res-row" }, [
          el("span", { class: "mmc-refine-label", text: t("Refine Steps") }),
          stepperPill({
            value: Number(target.refine_steps ?? DEFAULT_REFINE_STEPS),
            min: 1, max: 20, step: 1, width: "42px",
            title: t("Diffusion steps on Pass 2"),
            format: (n) => `${n}`,
            onChange: (next) => { target.refine_steps = next; render(); commit(); },
          }),
        ]),
        ...(!isGlobalTurbo ? [
          el("div", { class: "mmc-res-row" }, [
            el("span", { class: "mmc-refine-label", text: t("Turbo Refine (1-step)") }),
            el("button", {
              class: `mmc-pill${target.refine_turbo_only ? " on" : ""}`,
              title: t("Applies Turbo distillation specifically to Pass 2 so refinement takes only 1 fast step."),
              onclick: () => {
                target.refine_turbo_only = !target.refine_turbo_only;
                render();
                commit();
              },
            }, [icon("bolt", 13), el("span", { text: target.refine_turbo_only ? t("on") : t("off") })]),
          ])
        ] : []),
      ]);
    } else if (activeStrategy === "rtx_vsr") {
      const curQuality = target.rtx_quality || DEFAULT_RTX_QUALITY;
      const baseSampleChips = el("div", { class: "mmc-chips", style: { gap: "4px" } },
        BASE_SAMPLE_PRESETS.filter((p) => p.edge <= curEdge).map((p) => el("button", {
          class: `mmc-chip${curSampleEdge === p.edge ? " on" : ""}`,
          style: { fontSize: "10.5px", padding: "2px 7px" },
          text: p.label,
          onclick: () => {
            target.sample_edge = p.edge;
            render();
            commit();
          },
        }))
      );

      contextPanel = el("div", { class: "mmc-res-card" }, [
        el("div", { class: "mmc-res-row" }, [
          el("span", { class: "mmc-refine-label", text: t("Base Sample (Pass 1)") }),
          stepperPill({
            value: curSampleEdge,
            min: MIN_SHORT_EDGE, max: cap, step: CANVAS_MULTIPLE, width: "52px",
            title: t("Short edge Pass 1 samples at before RTX AI upscaling."),
            format: (n) => `${n}px`,
            onChange: (next) => {
              target.sample_edge = next;
              render();
              commit();
            },
          }),
        ]),
        baseSampleChips,
        el("div", { class: "mmc-res-row", style: { borderTop: "1px solid var(--mmc-line)", paddingTop: "8px", marginTop: "4px" } }, [
          el("span", { class: "mmc-refine-label", text: t("RTX AI Quality") }),
          el("button", {
            class: "mmc-pill",
            title: t("NVIDIA RTX VSR AI Model Quality Level"),
            onclick: (e) => openChoicePopover(e.currentTarget, {
              title: t("RTX VSR Quality"),
              options: [...RTX_QUALITIES],
              value: curQuality,
              onPick: (picked) => {
                target.rtx_quality = picked;
                render();
                commit();
              },
            }),
          }, [el("span", { text: curQuality })]),
        ]),
        el("div", { class: "mmc-res-hint-row" }, [
          el("span", { class: "mmc-res-badge-nvidia", text: "NVIDIA RTX" }),
          el("span", { class: "mmc-res-hint-text", text: t("Hardware Tensor Core AI upscaling ({sample}p → {edge}p in real-time).", { sample: curSampleEdge, edge: curEdge }) }),
        ]),
      ]);
    } else {
      contextPanel = el("div", { class: "mmc-res-card direct-card" }, [
        el("div", { class: "mmc-res-hint-text", text: curEdge > NATIVE_SHORT_EDGE
          ? t("⚠️ Generating directly at {edge}p is off-distribution for the open weights. Consider 2-Pass Refine or RTX VSR.", { edge: curEdge })
          : t("✓ Native single-pass sampling at {width} × {height}.", { width, height })
        }),
      ]);
    }

    // =========================================================================
    // ZONE 4: COLLAPSIBLE MEMORY & OUTPUT OPTIONS
    // =========================================================================
    const isTiled = target.tiled_vae === true;
    const curTileSize = Number(target.vae_tile_size || 512);

    const memoryFold = el("details", { class: "mmc-pop-fold mmc-res-memory-fold" }, [
      el("summary", { text: t("⚙️ Memory & Output Options") }),
      el("div", { class: "mmc-res-fold-content" }, [
        el("div", { class: "mmc-res-row" }, [
          el("span", { class: "mmc-refine-label", text: t("Tiled VAE Decoder") }),
          el("button", {
            class: `mmc-pill${isTiled ? " on" : ""}`,
            title: t("Decodes latents in spatial tiles to prevent VRAM spikes on large resolutions."),
            onclick: () => {
              target.tiled_vae = !isTiled;
              render();
              commit();
            },
          }, [el("span", { text: isTiled ? t("on (tiled)") : t("off") })]),
        ]),
        ...(isTiled ? [
          el("div", { class: "mmc-res-row" }, [
            el("span", { class: "mmc-refine-label", text: t("VAE Tile Size") }),
            stepperPill({
              value: curTileSize,
              min: 256, max: 2048, step: 64, width: "52px",
              title: t("Spatial tile size for VAE decoding. 512px is recommended."),
              format: (n) => `${n}px`,
              onChange: (next) => { target.vae_tile_size = next; render(); commit(); },
            }),
          ])
        ] : []),
        el("div", { class: "mmc-res-row" }, [
          el("span", { class: "mmc-refine-label", text: t("Clean VRAM (Auto-Flush)") }),
          el("button", {
            class: `mmc-pill${target.clean_vram !== false ? " on" : ""}`,
            title: t("Flushes PyTorch CUDA cache before upscaling to avoid memory fragmentation."),
            onclick: () => {
              target.clean_vram = target.clean_vram === false;
              render();
              commit();
            },
          }, [el("span", { text: target.clean_vram !== false ? t("auto-flush") : t("off") })]),
        ]),
        ...(activeStrategy === "two_pass" ? [
          el("div", { class: "mmc-res-row" }, [
            el("span", { class: "mmc-refine-label", text: t("Save Pass 1 (Base Video)") }),
            el("button", {
              class: `mmc-pill${target.save_pass1 ? " on" : ""}`,
              title: t("Also save the original non-upscaled Pass 1 base video alongside the final upscaled video."),
              onclick: () => {
                target.save_pass1 = !target.save_pass1;
                render();
                commit();
              },
            }, [el("span", { text: target.save_pass1 ? t("on (save both)") : t("off") })]),
          ])
        ] : []),
      ]),
    ]);

    pop.replaceChildren(
      header,
      targetChips,
      sliderControl,
      strategyBar,
      contextPanel,
      memoryFold
    );
  };

  render();
  document.body.appendChild(pop);
  placeNear(pop, anchor);
  dismissable(pop);

  loadCatalog(() => { if (pop.isConnected) render(); }, false);
}