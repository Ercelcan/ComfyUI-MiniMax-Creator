import { el, icon, dismissable, placeNear } from "./dom.js";
import { t } from "./i18n.js";
import { openChoicePopover } from "./pills.js";
import { listModels, invalidateModelsCache } from "./api.js";
import * as S from "./state.js";
import { turboRow, loadLoraNames } from "./turbo.js";

const NONE = "— none —";
const AUTO = "— auto —";

export const ROUTE_LABEL = {
  auto: "auto — follow the mode",
  fl2va: "always FL2VA",
  ref2va: "always Ref2VA",
};

let catalog = null;

export function invalidateCatalog() {
  catalog = null;
  invalidateModelsCache();
}

export function loadCatalog(onReady, force = false) {
  if (!force && catalog) {
    onReady?.(catalog);
    return catalog;
  }
  if (force) {
    invalidateCatalog();
  }
  listModels({ force }).then((body) => {
    catalog = body;
    onReady?.(body);
  }).catch(() => {
    catalog = { files: {}, dtypes: S.MODEL_DTYPES, preview_override: false };
    onReady?.(catalog);
  });
  return catalog;
}

export const catalogFiles = () => catalog?.files ?? {};

export const catalogByFolder = () => catalog?.by_folder ?? {};

export const catalogDevices = () => catalog?.devices ?? [];

export const catalogLatentUpscalers = () =>
  catalog?.files?.latent_upscaler ?? catalog?.by_folder?.latent_upscale_models ?? [];

export const hasPreviewOverride = () => catalog?.preview_override !== false;

export function weightsPill({ models, checkpoints, onChange, turbo }) {
  const routed = S.routedCheckpoints(models, checkpoints);
  const missing = S.missingModels(models, S.requiredModels(routed));
  const spread = new Set(S.DEVICE_FIELDS.map((f) => models.devices[f]).filter(Boolean));
  const settled = models.route !== "auto"
    ? t("weights · always {checkpoint}", { checkpoint: S.CHECKPOINT_LABEL[models.route] })
    : spread.size
      ? (spread.size > 1
          ? t("weights · {count} devices", { count: spread.size })
          : t("weights · {device}", { device: [...spread][0] }))
      : models.dtype === "default" ? t("weights") : t("weights · {dtype}", { dtype: models.dtype.replace("fp8_", "fp8 ") });
  const label = missing.length
    ? (missing.length === 1
        ? t("no {model}", { model: t(S.MODEL_LABEL[missing[0]]).toLowerCase() })
        : t("{count} weights missing", { count: missing.length }))
    : settled;

  return el("button", {
    class: `mmc-pill mmc-weights${missing.length ? " missing" : ""}`,
    title: missing.length
      ? t("Not picked yet: {models}. The render is refused without them.", {
          models: missing.map((f) => t(S.MODEL_LABEL[f])).join(", "),
        })
      : t("Which checkpoints, text encoder and VAEs this node loads."),
    onclick: (event) => openWeightsPopover(event.currentTarget, { models, checkpoints, onChange, turbo }),
  }, [icon("weights", 16), el("span", { text: label })]);
}

export function openWeightsPopover(anchor, { models, checkpoints, onChange, turbo }) {
  const pop = el("div", { class: "mmc-pop mmc-weights-pop" });
  const body = el("div");

  const required = () => new Set(S.requiredModels(S.routedCheckpoints(models, checkpoints)));

  const render = () => {
    const files = catalogFiles();
    const devices = catalogDevices();

    const routeRow = el("div", { class: "mmc-weight-row" }, [
      el("span", { class: "mmc-weight-name", text: t("Route") }),
      el("button", {
        class: `mmc-weight-file${models.route === "auto" ? "" : " forced"}`,
        title: t("Which checkpoint every generation runs on.\n\n"
             + "auto follows the mode: references go to Ref2VA, everything else to FL2VA.\n"
             + "Forced, that is ignored and one checkpoint takes the lot — the two are one "
             + "architecture trained twice, and Ref2VA handles text-only and keyframe "
             + "payloads perfectly well.\n\n"
             + "FL2VA cannot take references at all, so forcing it is refused on a "
             + "generation that has any."),
        text: t(ROUTE_LABEL[models.route]),
        onclick: (event) => openChoicePopover(event.currentTarget, {
          title: t("Route"),
          options: S.ROUTES.map((route) => t(ROUTE_LABEL[route])),
          value: t(ROUTE_LABEL[models.route]),
          onPick: (picked) => {
            models.route = S.ROUTES.find((route) => t(ROUTE_LABEL[route]) === picked) ?? "auto";
            onChange();
            render();
          },
        }),
      }),
    ]);

    const devicePill = (field) => {
      if (!devices.length || !S.DEVICE_FIELDS.includes(field)) return null;
      const pinned = models.devices[field] || "";
      return el("button", {
        class: `mmc-weight-device${pinned ? " pinned" : ""}`,
        title: pinned
          ? t("Loaded on {device}, through ComfyUI-MultiGPU.", { device: pinned })
          : t("Loaded wherever ComfyUI would put it. Pick a device to pin it — "
            + "putting the text encoder on a second card frees the first one for the DiT."),
        text: pinned || t("auto"),
        onclick: (event) => openChoicePopover(event.currentTarget, {
          title: t("{model} — device", { model: t(S.MODEL_LABEL[field]) }),
          options: [t(AUTO), ...devices],
          value: pinned || t(AUTO),
          onPick: (picked) => {
            if (picked === t(AUTO)) delete models.devices[field];
            else models.devices[field] = picked;
            onChange();
            render();
          },
        }),
      });
    };

    const needed = required();
    const rows = S.MODEL_FIELDS.filter((f) => f !== "latent_upscaler").map((field) => {
      const chosen = models[field];
      const options = files[field] ?? [];
      const unavailable = field === "preview" && !hasPreviewOverride();

      return el("div", {
        class: `mmc-weight-row${needed.has(field) && !chosen ? " missing" : ""}`
             + (S.CHECKPOINTS.includes(field) && !needed.has(field) ? " idle" : ""),
      }, [
        el("span", { class: "mmc-weight-name", text: t(S.MODEL_LABEL[field]) }),
        el("button", {
          class: `mmc-weight-file${chosen ? "" : " empty"}`,
          title: unavailable
            ? t("Needs KJNodes' Model Preview Override. Without it the live preview "
              + "falls back to latent2rgb, and the render is unaffected either way.")
            : t(S.MODEL_HINT[field]),
          text: chosen || (unavailable ? t("unavailable") : t("not set")),
          onclick: (event) => openChoicePopover(event.currentTarget, {
            title: t(S.MODEL_LABEL[field]),
            options: [t(NONE), ...options],
            value: chosen || t(NONE),
            onPick: (picked) => {
              models[field] = picked === t(NONE) ? "" : picked;
              onChange();
              render();
            },
          }),
        }),
        devicePill(field),
      ]);
    });

    rows.push(el("div", { class: "mmc-weight-row" }, [
      el("span", { class: "mmc-weight-name", text: t("Precision") }),
      el("button", {
        class: "mmc-weight-file",
        title: t("How the checkpoints are loaded. fp8 halves the weights in VRAM at "
             + "some cost in fidelity; 'default' loads them as they were saved. "
             + "GGUF files ignore this — their precision was baked in when they "
             + "were quantized."),
        text: models.dtype,
        onclick: (event) => openChoicePopover(event.currentTarget, {
          title: t("Precision"),
          options: catalog?.dtypes ?? S.MODEL_DTYPES,
          value: models.dtype,
          onPick: (picked) => { models.dtype = picked; onChange(); render(); },
        }),
      }),
    ]));

    if (turbo) {
      rows.push(...turboRow({
        container: turbo.container,
        widgetIO: turbo.widgetIO,
        onChange: () => { onChange(); render(); },
      }));
    }

    body.replaceChildren(routeRow, ...rows);
  };

  const head = el("div", {
    style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px 8px" },
  }, [
    el("span", { class: "mmc-pop-title", style: { padding: 0 }, text: t("Weights") }),
    el("button", {
      class: "mmc-ghost",
      style: { fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 6px" },
      title: t("Rescan models directory to find newly added weights without restarting ComfyUI"),
      onclick: () => {
        loadCatalog(() => { if (pop.isConnected) render(); }, true);
      },
    }, [icon("loop", 12), el("span", { text: t("Rescan") })]),
  ]);

  pop.append(head, body);
  render();
  document.body.appendChild(pop);
  placeNear(pop, anchor);
  dismissable(pop);

  loadCatalog(() => { if (pop.isConnected) render(); }, false);
  if (turbo) loadLoraNames(() => { if (pop.isConnected) render(); });
}