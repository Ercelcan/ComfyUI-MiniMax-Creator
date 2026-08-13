import { ASPECT_PRESETS, FPS, MIN_SHORT_EDGE, NATIVE_SHORT_EDGE, CANVAS_MULTIPLE,
         framesForSeconds, secondsForFrames, resolveCanvas } from "./canvas.js";
import { t } from "./i18n.js";

export const MAX_REF_IMAGES = 9;
export const MAX_REF_VIDEOS = 3;
export const MAX_REF_AUDIOS = 3;
export const MAX_REF_FILES = 12;

const PREFIX = { image: "img", video: "vid", audio: "aud" };

export const TRACKS = ["picture", "picture+sound", "sound"];
export const DEFAULT_TRACK = "picture";

export const DEFAULT_REF_SIZE = { image: "match", video: "max" };

export const refSize = (asset) => asset.ref_size || DEFAULT_REF_SIZE[asset.kind] || "match";

export const sizeable = (asset) =>
  asset.role === "reference" && DEFAULT_REF_SIZE[asset.kind] !== undefined;

export const TAKES = ["full", "person", "object", "scene", "style"];

export const takes = (asset) => (TAKES.includes(asset.takes) ? asset.takes : "full");

export const takeable = (asset) => asset.kind === "image" && asset.role === "reference";

export const MODEL_FIELDS = ["fl2va", "ref2va", "clip", "vae", "audio_vae", "preview"];

export const MODEL_LABEL = {
  fl2va: "FL2VA checkpoint",
  ref2va: "Ref2VA checkpoint",
  clip: "Text encoder",
  vae: "Video VAE",
  audio_vae: "Audio VAE",
  preview: "Preview decoder",
};

export const MODEL_HINT = {
  fl2va: "Text-only, start/end frame and continuing shots run on these weights.",
  ref2va: "Anything with an @ reference runs on these weights.",
  clip: "H3's text encoder. Loaded as CLIPLoader type 'minimax'.",
  vae: "Decodes the picture.",
  audio_vae: "Decodes the sound. H3 always generates some, so this is never optional.",
  preview: "taeh3, from models/vae_approx — what the live preview decodes through. "
         + "Without it the preview is latent2rgb, which is colour without detail.",
};

export const MODEL_DTYPES = ["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"];

export const ROUTES = ["auto", "fl2va", "ref2va"];

export const nextRoute = (route) => ROUTES[(ROUTES.indexOf(route) + 1) % ROUTES.length];

export const DEVICE_FIELDS = MODEL_FIELDS.filter((field) => field !== "preview");

export const ALWAYS_REQUIRED = ["clip", "vae", "audio_vae"];

export function emptyModels() {
  return {
    fl2va: "", ref2va: "", clip: "", vae: "", audio_vae: "", preview: "",
    dtype: "default",
    route: "auto",
    devices: {},
  };
}

export function parseModels(raw) {
  const out = emptyModels();
  if (!raw || typeof raw !== "object") return out;
  for (const field of MODEL_FIELDS) {
    if (typeof raw[field] === "string") out[field] = raw[field].trim();
  }
  if (MODEL_DTYPES.includes(raw.dtype)) out.dtype = raw.dtype;
  if (ROUTES.includes(raw.route)) out.route = raw.route;
  if (raw.devices && typeof raw.devices === "object") {
    for (const field of DEVICE_FIELDS) {
      if (typeof raw.devices[field] === "string" && raw.devices[field].trim()) {
        out.devices[field] = raw.devices[field].trim();
      }
    }
  }
  return out;
}

function serializeModels(models) {
  const picked = parseModels(models);
  const out = {};
  for (const field of MODEL_FIELDS) {
    if (picked[field]) out[field] = picked[field];
  }
  if (picked.dtype !== "default") out.dtype = picked.dtype;
  if (picked.route !== "auto") out.route = picked.route;
  if (Object.keys(picked.devices).length) out.devices = { ...picked.devices };
  return { models: out };
}

export const IMAGE_VAE_RE = /t1[_-]?image|image[_-]vae/i;

const MODEL_HINTS = {
  fl2va: ["fl2va", "first_last"],
  ref2va: ["ref2va"],
  clip: ["minimax"],
  vae: ["minimax", "h3"],
  audio_vae: ["audio"],
  preview: [],
};

export function guessModels(models, files) {
  let changed = false;
  for (const field of MODEL_FIELDS) {
    if (models[field]) continue;
    const needles = MODEL_HINTS[field] || [];
    if (!needles.length) continue;
    let matched = (files?.[field] ?? []).filter((name) =>
      needles.some((needle) => name.toLowerCase().includes(needle)));
    if (field === "vae") {
      matched = matched.filter((name) => !IMAGE_VAE_RE.test(name) && !name.toLowerCase().includes("audio"));
    }
    if (matched.length !== 1) continue;
    models[field] = matched[0];
    changed = true;
  }
  return changed;
}

export function requiredModels(checkpoints) {
  return [...ALWAYS_REQUIRED, ...checkpoints];
}

export function routedCheckpoints(models, derived) {
  const route = models?.route ?? "auto";
  return route === "auto" ? derived : [route];
}

export function missingModels(models, required) {
  return required.filter((field) => !models[field])
    .sort((a, b) => MODEL_FIELDS.indexOf(a) - MODEL_FIELDS.indexOf(b));
}

export const TURBO_QUALITIES = ["draft", "medium", "good"];
export const TURBO_STEPS = { draft: 4, medium: 6, good: 8 };

export const TURBO_SAMPLER = "euler";
export const TURBO_SCHEDULER = "beta";

export const TURBO_RESET = { steps: 20, sampler_name: "res_multistep", scheduler: "simple" };

export const turboStrength = (name) => (/lightx2v/i.test(name || "") ? 0.6 : 1.0);

export function emptyTurbo() {
  return {
    lora: "",
    ref_lora: "",
    merged: false,
    quality: "medium",
    on: false,
    saved: null,
  };
}

export function parseTurbo(raw) {
  const out = emptyTurbo();
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.lora === "string") out.lora = raw.lora.trim();
  if (typeof raw.ref_lora === "string") out.ref_lora = raw.ref_lora.trim();
  out.merged = raw.merged === true;
  if (TURBO_QUALITIES.includes(raw.quality)) out.quality = raw.quality;
  out.on = raw.on === true;
  if (raw.saved && typeof raw.saved === "object") {
    out.saved = {
      steps: Number(raw.saved.steps) || TURBO_RESET.steps,
      sampler_name: typeof raw.saved.sampler_name === "string"
        ? raw.saved.sampler_name : TURBO_RESET.sampler_name,
      scheduler: typeof raw.saved.scheduler === "string"
        ? raw.saved.scheduler : TURBO_RESET.scheduler,
    };
  }
  return out;
}

export function serializeTurbo(turbo) {
  const picked = parseTurbo(turbo);
  if (!picked.lora && !picked.ref_lora && !picked.merged && !picked.on) return {};
  const out = {};
  if (picked.lora) out.lora = picked.lora;
  if (picked.ref_lora) out.ref_lora = picked.ref_lora;
  if (picked.merged) out.merged = true;
  if (picked.quality !== "medium") out.quality = picked.quality;
  if (picked.on) out.on = true;
  if (picked.saved) out.saved = { ...picked.saved };
  return { turbo: out };
}

export const CHECKPOINTS = ["fl2va", "ref2va"];
export const CHECKPOINT_LABEL = { fl2va: "FL2VA", ref2va: "Ref2VA" };
export const CHECKPOINT_CHOICES = ["auto", ...CHECKPOINTS];
export const DEFAULT_STRENGTH = 1.0;

export const UPSCALE_MODES = ["two_pass", "direct"];
export const DEFAULT_REFINE_DENOISE = 0.5;
export const MIN_REFINE_DENOISE = 0.1;
export const MAX_REFINE_DENOISE = 0.9;

const clampSampleEdge = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return NATIVE_SHORT_EDGE;
  const snapped = Math.round(n / CANVAS_MULTIPLE) * CANVAS_MULTIPLE;
  return Math.min(NATIVE_SHORT_EDGE, Math.max(MIN_SHORT_EDGE, snapped));
};

export const sampleEdge = (target) =>
  Math.min(clampSampleEdge(target.sample_edge), target.short_edge);

export const twoPass = (target) =>
  sampleEdge(target) < target.short_edge && target.upscale !== "direct";

const clampRefineDenoise = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_REFINE_DENOISE;
  return Math.min(MAX_REFINE_DENOISE, Math.max(MIN_REFINE_DENOISE, n));
};

export function emptyState() {
  return {
    version: 1,
    prompt: "",
    refined: null,
    soundscape: "",
    music: "",
    assets: [],
    loras: [],
    duration_s: 6,
    aspect: "16:9",
    short_edge: NATIVE_SHORT_EDGE,
    upscale: UPSCALE_MODES[0],
    sample_edge: NATIVE_SHORT_EDGE,
    refine_denoise: DEFAULT_REFINE_DENOISE,
    checkpoint: "auto",
    models: emptyModels(),
    turbo: emptyTurbo(),
  };
}

export function parseState(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const state = { ...emptyState(), ...parsed };
      if (!Array.isArray(state.loras)) state.loras = [];
      if (!Array.isArray(state.assets)) state.assets = [];
      if (!state.refined || typeof state.refined !== "object") state.refined = null;
      for (const key of ["soundscape", "music"]) {
        if (typeof state[key] !== "string") state[key] = "";
      }
      if (!CHECKPOINT_CHOICES.includes(state.checkpoint)) state.checkpoint = "auto";
      if (!UPSCALE_MODES.includes(state.upscale)) state.upscale = UPSCALE_MODES[0];
      state.sample_edge = clampSampleEdge(state.sample_edge);
      state.refine_denoise = clampRefineDenoise(state.refine_denoise);
      state.models = parseModels(state.models);
      state.turbo = parseTurbo(state.turbo);
      normalizeCheckpoint(state);
      for (const asset of state.assets) {
        if (asset?.kind !== "video") continue;
        if (!TRACKS.includes(asset.track)) asset.track = asset.with_audio ? "picture+sound" : DEFAULT_TRACK;
        delete asset.with_audio;
      }
      return state;
    }
  } catch {
  }
  return emptyState();
}

function serializeLoras(entries) {
  return entries.map((entry) => {
    const out = { name: entry.name, strength: round2(entry.strength) };
    if (entry.enabled === false) out.enabled = false;
    if (entry.triggers?.length) out.triggers = [...entry.triggers];
    if (!claimsBoth(entry)) out.modes = [...entry.modes];
    return out;
  });
}

function serializeRefined(refined) {
  const body = (refined?.body ?? "").trim();
  const sections = refined?.sections;
  if (!body && !sections && !refined?.replaced) return {};
  return {
    refined: {
      ...(body ? { body } : {}),
      ...(refined.scope === "shot" ? { scope: "shot" } : {}),
      ...(sections ? { sections: { ...sections } } : {}),
      source: refined.source ?? "",
      ...(refined.model ? { model: refined.model } : {}),
      ...(refined.template ? { template: refined.template } : {}),
      ...(refined.forced ? { forced: true } : {}),
      ...(refined.replaced ? { replaced: { ...refined.replaced } } : {}),
      ...(refined.enabled === false ? { enabled: false } : {}),
    },
  };
}

function serializeAssets(assets) {
  return assets.map((asset) => {
    const out = { handle: asset.handle, kind: asset.kind, role: asset.role, filename: asset.filename };
    if (asset.kind === "video") out.track = asset.track || DEFAULT_TRACK;
    if (sizeable(asset) && refSize(asset) !== DEFAULT_REF_SIZE[asset.kind]) {
      out.ref_size = refSize(asset);
    }
    if (asset.trim && asset.kind !== "image") {
      out.trim = { start: asset.trim.start, end: asset.trim.end };
    }
    if (takeable(asset) && takes(asset) !== "full") {
      out.takes = takes(asset);
    }
    return out;
  });
}

function serializeCommon(state) {
  return {
    prompt: state.prompt ?? "",
    ...serializeRefined(state.refined),
    ...(state.soundscape?.trim() ? { soundscape: state.soundscape } : {}),
    ...(state.music?.trim() ? { music: state.music } : {}),
    assets: serializeAssets(state.assets),
    loras: serializeLoras(state.loras),
    duration_s: state.duration_s,
    ...(state.checkpoint && state.checkpoint !== "auto" ? { checkpoint: state.checkpoint } : {}),
  };
}

export function serializeState(state) {
  return JSON.stringify({
    version: 1,
    ...serializeCommon(state),
    aspect: state.aspect,
    short_edge: state.short_edge,
    ...(state.upscale !== UPSCALE_MODES[0] ? { upscale: state.upscale } : {}),
    ...(state.sample_edge !== NATIVE_SHORT_EDGE ? { sample_edge: state.sample_edge } : {}),
    ...(state.refine_denoise !== DEFAULT_REFINE_DENOISE
      ? { refine_denoise: state.refine_denoise } : {}),
    ...serializeModels(state.models),
    ...serializeTurbo(state.turbo),
  }, null, 2);
}

export const MAX_SEGMENTS = 24;

export const RENDER_MODES = ["chained", "single"];
export const isSingle = (timeline) => timeline.render === "single";

export const DEFAULT_AUDIO_TAIL_S = 1.0;
export const MAX_AUDIO_TAIL_S = 4.0;

const clampTail = (value) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_AUDIO_TAIL_S;
  return Math.min(seconds, MAX_AUDIO_TAIL_S);
};

export function emptySegment() {
  const state = emptyState();
  delete state.version;
  state.continue = false;
  state.continue_audio = false;
  return state;
}

/** A segment added behind another. A strip is usually one continuous piece, so
 *  the seam opens live on both tracks with a medium blend of motion across the
 *  cut — the settings a hard cut would make the user click on every card. The
 *  first segment has no seam and stays `emptySegment`, and a loaded timeline
 *  keeps exactly what it stored. */
export function continuingSegment() {
  const state = emptySegment();
  state.continue = true;
  state.continue_audio = true;
  state.feather = FEATHER_GRID[2]; // Medium — 0.9 s of motion at 24 fps
  return state;
}

export function emptyTimeline() {
  return {
    version: 2,
    render: "chained",
    prompt: "",
    soundscape: "",
    music: "",
    refined: null,
    aspect: "16:9",
    short_edge: NATIVE_SHORT_EDGE,
    upscale: UPSCALE_MODES[0],
    sample_edge: NATIVE_SHORT_EDGE,
    refine_denoise: DEFAULT_REFINE_DENOISE,
    loras: [],
    assets: [],
    audio_tail_s: DEFAULT_AUDIO_TAIL_S,
    models: { ...emptyModels(), route: "ref2va" },
    turbo: emptyTurbo(),
    segments: [emptySegment()],
  };
}

function syncCanvas(timeline) {
  for (const segment of timeline.segments) {
    segment.aspect = timeline.aspect;
    segment.short_edge = timeline.short_edge;
    segment.upscale = timeline.upscale;
    segment.sample_edge = timeline.sample_edge;
    segment.refine_denoise = timeline.refine_denoise;
    segment.pool = timeline.assets ?? [];
    segment.globalTexts = {
      prompt: timeline.prompt ?? "",
      soundscape: timeline.soundscape ?? "",
      music: timeline.music ?? "",
    };
  }
  if (timeline.segments.length) {
    timeline.segments[0].continue = false;
    timeline.segments[0].continue_audio = false;
    delete timeline.segments[0].merge;
  }
  // `render` is derived, not set: it is the name for a strip that turned out to
  // be one pass end to end, which is a fact about the merge flags. Everything
  // that asks `isSingle` is asking exactly that. A lone segment keeps whatever
  // it was told — with no seam in the strip there is nothing to derive from,
  // and the answer only decides whether the card is called a shot.
  if (timeline.segments.length > 1) {
    timeline.render = timeline.segments.every((segment, index) => !index || merged(segment))
      ? "single" : "chained";
  }
  timeline.segments.forEach((segment, index) => {
    const from = segment.continue_from;
    if (!Number.isInteger(from) || from < 1 || from >= index) delete segment.continue_from;
    if (segment.feather && 2 * segment.feather > framesForSeconds(segment.duration_s)) {
      delete segment.feather;
    }
  });
  return timeline;
}

export { syncCanvas as syncTimeline };

export function parseTimeline(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const timeline = { ...emptyTimeline(), ...parsed };
      if (!Array.isArray(timeline.loras)) timeline.loras = [];
      if (!Array.isArray(timeline.assets)) timeline.assets = [];
      timeline.assets = timeline.assets.filter(
        (asset) => asset && typeof asset.handle === "string" && typeof asset.filename === "string");
      for (const asset of timeline.assets) {
        asset.role = "reference";
        if (asset.kind === "video" && !TRACKS.includes(asset.track)) {
          asset.track = asset.with_audio ? "picture+sound" : DEFAULT_TRACK;
        }
        delete asset.with_audio;
      }
      if (!RENDER_MODES.includes(timeline.render)) timeline.render = "chained";
      timeline.audio_tail_s = clampTail(timeline.audio_tail_s);
      for (const key of ["soundscape", "music"]) {
        if (typeof timeline[key] !== "string") timeline[key] = "";
      }
      if (!timeline.refined || typeof timeline.refined !== "object") timeline.refined = null;
      if (!UPSCALE_MODES.includes(timeline.upscale)) timeline.upscale = UPSCALE_MODES[0];
      timeline.sample_edge = clampSampleEdge(timeline.sample_edge);
      timeline.refine_denoise = clampRefineDenoise(timeline.refine_denoise);
      timeline.models = parseModels(timeline.models);
      timeline.turbo = parseTurbo(timeline.turbo);
      const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
      timeline.segments = (segments.length ? segments : [{}]).map((raw) => {
        const segment = parseState(JSON.stringify(raw ?? {}));
        delete segment.version;
        delete segment.models;
        delete segment.turbo;
        segment.continue = raw?.continue === true;
        segment.continue_audio = raw?.continue_audio === true;
        delete segment.continue_from;
        const from = Number(raw?.continue_from);
        if (Number.isInteger(from)) segment.continue_from = from;
        delete segment.feather;
        const width = Number(raw?.feather);
        if (FEATHER_GRID.includes(width) && width > 1) segment.feather = width;
        return segment;
      });
      return syncCanvas(timeline);
    }
  } catch {
  }
  return emptyTimeline();
}

export function serializeTimeline(timeline) {
  return JSON.stringify({
    version: 2,
    render: timeline.render === "single" ? "single" : "chained",
    prompt: timeline.prompt ?? "",
    ...(timeline.soundscape?.trim() ? { soundscape: timeline.soundscape } : {}),
    ...(timeline.music?.trim() ? { music: timeline.music } : {}),
    ...serializeRefined(timeline.refined),
    aspect: timeline.aspect,
    short_edge: timeline.short_edge,
    ...(timeline.upscale !== UPSCALE_MODES[0] ? { upscale: timeline.upscale } : {}),
    ...(timeline.sample_edge !== NATIVE_SHORT_EDGE ? { sample_edge: timeline.sample_edge } : {}),
    ...(timeline.refine_denoise !== DEFAULT_REFINE_DENOISE
      ? { refine_denoise: timeline.refine_denoise } : {}),
    loras: serializeLoras(timeline.loras ?? []),
    ...(timeline.assets?.length ? { assets: serializeAssets(timeline.assets) } : {}),
    audio_tail_s: clampTail(timeline.audio_tail_s),
    ...serializeModels(timeline.models),
    ...serializeTurbo(timeline.turbo),
    segments: timeline.segments.map((segment, index) => {
      const out = serializeCommon(segment);
      if (index > 0 && segment.continue) out.continue = true;
      if (index > 0 && segment.continue_audio) out.continue_audio = true;
      if ((out.continue || out.continue_audio)
          && Number.isInteger(segment.continue_from)
          && segment.continue_from >= 1 && segment.continue_from < index) {
        out.continue_from = segment.continue_from;
      }
      if (out.continue && feather(segment) > 1) out.feather = feather(segment);
      return out;
    }),
  }, null, 2);
}

export function cloneSegment(segment) {
  return JSON.parse(JSON.stringify(segment));
}

export function cutTimes(timeline) {
  const at = [];
  let total = 0;
  for (const segment of segments) {
    at.push(total);
    total += Number(segment.duration_s) || 0;
  }
  return { at, total };
}

export function shotTime(seconds) {
  const ms = Math.round(Number(seconds) * 1000);
  const pad = (n, width) => String(n).padStart(width, "0");
  return `${pad(Math.floor(ms / 60000), 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`;
}

export function timelineFrames(timeline) {
  if (isSingle(timeline)) return framesForSeconds(cutTimes(timeline).total);
  return timeline.segments.reduce((total, segment, index) => {
    const overlap = index > 0 && continues(segment) && feather(segment) > 1 ? feather(segment) : 0;
    return total + framesForSeconds(segment.duration_s) - overlap;
  }, 0);
}

export function timelineSeconds(timeline) {
  return secondsForFrames(timelineFrames(timeline));
}

export const PRESTAGE_ARCHES = ["krea2", "ideogram4", "minimax"];
export const PRESTAGE_ARCH_LABEL = {
  krea2: "Krea 2", ideogram4: "Ideogram 4", minimax: "MiniMax H3",
};

export const PRESTAGE_STILL_ARCH = "minimax";
export const isStill = (state) => state?.arch === PRESTAGE_STILL_ARCH;

export const PRESTAGE_STILL_LENGTHS = [5, 22, 39, 56, 90, 124];
export const PRESTAGE_STILL_FRAMES = 5;
export const PRESTAGE_STILL_INDEX = 0;
export const PRESTAGE_PROMPT_MODES = ["context-ir", "plain"];

export const stillLatentFrames = (frames) =>
  (frames <= 5 ? 2 : Math.floor((frames - 5) / 17) * 5 + 2);

export const PRESTAGE_STILL_ROW = {
  steps: 20, cfg: 1.0, sampler_name: "res_multistep", scheduler: "simple",
};

export function emptyStill() {
  return {
    frames: PRESTAGE_STILL_FRAMES,
    latent_index: PRESTAGE_STILL_INDEX,
    prompt_mode: "context-ir",
    request: emptyState(),
  };
}

export function parseStill(raw) {
  const out = emptyStill();
  if (!raw || typeof raw !== "object") return out;
  const frames = Number(raw.frames);
  if (Number.isFinite(frames)) out.frames = framesForSeconds(Math.max(1, frames) / FPS);
  const index = Number(raw.latent_index);
  if (Number.isFinite(index)) out.latent_index = Math.round(index);
  if (PRESTAGE_PROMPT_MODES.includes(raw.prompt_mode)) out.prompt_mode = raw.prompt_mode;
  out.request = parseState(JSON.stringify(raw.request ?? {}));
  return out;
}

function serializeStill(still) {
  const out = {
    frames: still.frames,
    latent_index: still.latent_index,
    request: JSON.parse(serializeState(still.request)),
  };
  if (still.prompt_mode !== "context-ir") out.prompt_mode = still.prompt_mode;
  return out;
}

export const PRESTAGE_CANVAS_MULTIPLE = 16;
export const PRESTAGE_MIN_EDGE = 512;
export const PRESTAGE_MAX_EDGE = 2048;
export const PRESTAGE_DEFAULT_EDGE = 1024;
export const PRESTAGE_MAX_PIXELS = 2048 * 2048;
export const PRESTAGE_MIN_RATIO = 1 / 3;
export const PRESTAGE_MAX_RATIO = 3;

export const PRESTAGE_ASPECTS = [
  ["16:9", 16 / 9],
  ["3:2", 3 / 2],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
  ["21:9", 21 / 9],
];

export const PRESTAGE_MAX_REFS = 3;

export const PRESTAGE_KREA_RAW = { steps: 52, cfg: 3.5, sampler_name: "euler", scheduler: "simple" };
export const PRESTAGE_KREA_TURBO = { cfg: 1.0, sampler_name: "euler", scheduler: "simple" };
export const PRESTAGE_TURBO_QUALITIES = ["draft", "medium", "good"];
export const PRESTAGE_TURBO_STEPS = { draft: 4, medium: 6, good: 8 };

export const PRESTAGE_IDEOGRAM_QUALITIES = ["quality", "default", "turbo"];
export const PRESTAGE_IDEOGRAM_STEPS = { quality: 48, default: 20, turbo: 12 };
export const PRESTAGE_IDEOGRAM_ROW = { cfg: 7.0, sampler_name: "euler" };

export const PRESTAGE_DEFAULT_DENOISE = 0.65;
export const PRESTAGE_MIN_DENOISE = 0.05;

export const PRESTAGE_FIELDS = {
  krea2: ["model", "turbo_model", "clip", "vae"],
  ideogram4: ["model", "uncond_model", "clip", "vae"],
};
export const PRESTAGE_FIELD_LABEL = {
  model: "Checkpoint",
  turbo_model: "Turbo checkpoint",
  uncond_model: "Unconditional checkpoint",
  clip: "Text encoder",
  vae: "VAE",
};
export const PRESTAGE_FIELD_HINT = {
  krea2: {
    model: "Krea 2 RAW — the undistilled base. ~52 steps at cfg 3.5, and the one to train LoRAs against.",
    turbo_model: "Krea 2 Turbo — the 8-step distillation the turbo pill swaps in. LoRAs trained on RAW apply here too.",
    clip: "Qwen3-VL 4B, loaded as CLIPLoader type 'krea2'.",
    vae: "The Qwen image VAE.",
  },
  ideogram4: {
    model: "Ideogram 4.0's conditional branch.",
    uncond_model: "The unconditional branch — Ideogram ships CFG as a second model. Optional: without it the render runs ordinary CFG on the one checkpoint.",
    clip: "Qwen3-VL 8B, loaded as CLIPLoader type 'ideogram4'.",
    vae: "The Flux 2 VAE.",
  },
};

const PRESTAGE_HINTS = {
  krea2: { model: ["krea2_raw"], turbo_model: ["krea2_turbo"], clip: ["qwen3vl_4b"], vae: ["qwen_image_vae"] },
  ideogram4: {
    model: ["ideogram4"], uncond_model: ["ideogram4_unconditional"],
    clip: ["qwen3vl_8b"], vae: ["flux2"],
  },
};

export function emptyPreStage() {
  return {
    version: 1,
    arch: "krea2",
    prompt: "",
    aspect: "16:9",
    short_edge: PRESTAGE_DEFAULT_EDGE,
    init: null,
    refs: [],
    loras: [],
    turbo: { on: false, quality: "good", saved: null },
    quality: "default",
    minimax: emptyStill(),
    models: emptyPreStageModels(),
    peer: null,
  };
}

export function emptyPreStageModels() {
  return { krea2: {}, ideogram4: {}, dtype: "default" };
}

export const PRESTAGE_IMAGE_ARCHES = PRESTAGE_ARCHES.filter((arch) => arch !== PRESTAGE_STILL_ARCH);

export function parsePreStage(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const state = { ...emptyPreStage(), ...parsed };
      if (!PRESTAGE_ARCHES.includes(state.arch)) state.arch = "krea2";
      if (typeof state.prompt !== "string") state.prompt = "";
      if (!Array.isArray(state.refs)) state.refs = [];
      state.refs = state.refs
        .filter((ref) => ref && typeof ref.filename === "string")
        .slice(0, PRESTAGE_MAX_REFS);
      if (!Array.isArray(state.loras)) state.loras = [];
      state.assets = [];
      state.checkpoint = "auto";
      if (!state.init || typeof state.init !== "object" || !state.init.filename) state.init = null;
      if (state.init) {
        const denoise = Number(state.init.denoise);
        state.init.denoise = Number.isFinite(denoise)
          ? Math.min(1, Math.max(PRESTAGE_MIN_DENOISE, denoise)) : PRESTAGE_DEFAULT_DENOISE;
      }
      if (!PRESTAGE_IDEOGRAM_QUALITIES.includes(state.quality)) state.quality = "default";
      state.minimax = parseStill(state.minimax);
      const turbo = state.turbo && typeof state.turbo === "object" ? state.turbo : {};
      state.turbo = {
        on: turbo.on === true,
        quality: PRESTAGE_TURBO_QUALITIES.includes(turbo.quality) ? turbo.quality : "good",
        saved: turbo.saved && typeof turbo.saved === "object" ? { ...turbo.saved } : null,
      };
      const models = state.models && typeof state.models === "object" ? state.models : {};
      state.models = emptyPreStageModels();
      for (const arch of PRESTAGE_IMAGE_ARCHES) {
        const side = models[arch];
        if (!side || typeof side !== "object") continue;
        for (const field of PRESTAGE_FIELDS[arch]) {
          if (typeof side[field] === "string" && side[field].trim()) {
            state.models[arch][field] = side[field].trim();
          }
        }
      }
      if (MODEL_DTYPES.includes(models.dtype)) state.models.dtype = models.dtype;
      return state;
    }
  } catch {
  }
  return emptyPreStage();
}

export function serializePreStage(state) {
  const models = {};
  for (const arch of PRESTAGE_IMAGE_ARCHES) {
    const side = {};
    for (const field of PRESTAGE_FIELDS[arch]) {
      if (state.models?.[arch]?.[field]) side[field] = state.models[arch][field];
    }
    if (Object.keys(side).length) models[arch] = side;
  }
  if (state.models?.dtype && state.models.dtype !== "default") models.dtype = state.models.dtype;
  return JSON.stringify({
    version: 1,
    arch: state.arch,
    prompt: state.prompt ?? "",
    aspect: state.aspect,
    short_edge: state.short_edge,
    ...(state.init ? { init: { filename: state.init.filename, denoise: round2(state.init.denoise) } } : {}),
    ...(state.refs.length ? { refs: state.refs.map((r) => ({ handle: r.handle, filename: r.filename })) } : {}),
    loras: serializeLoras(state.loras),
    ...(state.turbo.on || state.turbo.saved
      ? { turbo: { on: state.turbo.on, quality: state.turbo.quality,
                   ...(state.turbo.saved ? { saved: { ...state.turbo.saved } } : {}) } }
      : {}),
    ...(state.quality !== "default" ? { quality: state.quality } : {}),
    minimax: serializeStill(state.minimax),
    ...(Object.keys(models).length ? { models } : {}),
    ...(state.peer != null ? { peer: state.peer } : {}),
  }, null, 2);
}

export function guessPreStageModels(models, byFolder) {
  const lists = {
    model: byFolder?.diffusion_models ?? [], turbo_model: byFolder?.diffusion_models ?? [],
    uncond_model: byFolder?.diffusion_models ?? [],
    clip: byFolder?.text_encoders ?? [], vae: byFolder?.vae ?? [],
  };
  let changed = false;
  for (const arch of PRESTAGE_IMAGE_ARCHES) {
    for (const field of PRESTAGE_FIELDS[arch]) {
      if (models[arch][field]) continue;
      const needles = PRESTAGE_HINTS[arch][field];
      let matched = lists[field].filter((name) =>
        needles.some((needle) => name.toLowerCase().includes(needle)));
      if (field === "model" && arch === "ideogram4") {
        matched = matched.filter((name) => !name.toLowerCase().includes("unconditional"));
      }
      if (matched.length !== 1) continue;
      models[arch][field] = matched[0];
      changed = true;
    }
  }
  return changed;
}

export function resolvedPreStage(state, initSize = null) {
  let ratio = PRESTAGE_ASPECTS.find(([label]) => label === state.aspect)?.[1] ?? 16 / 9;
  let fromImage = false;
  if (state.init && initSize?.width && initSize?.height) {
    ratio = initSize.width / initSize.height;
    fromImage = true;
  }
  ratio = Math.min(PRESTAGE_MAX_RATIO, Math.max(PRESTAGE_MIN_RATIO, ratio));
  const edge = Math.max(PRESTAGE_MIN_EDGE, Math.min(PRESTAGE_MAX_EDGE, Math.round(state.short_edge)));

  let width, height;
  if (ratio >= 1) { width = edge * ratio; height = edge; }
  else { width = edge; height = edge / ratio; }
  if (width * height > PRESTAGE_MAX_PIXELS) {
    const scale = Math.sqrt(PRESTAGE_MAX_PIXELS / (width * height));
    width *= scale;
    height *= scale;
  }
  if (Math.max(width, height) > PRESTAGE_MAX_EDGE) {
    const scale = PRESTAGE_MAX_EDGE / Math.max(width, height);
    width *= scale;
    height *= scale;
  }
  const snap16 = (v) => Math.max(PRESTAGE_CANVAS_MULTIPLE,
    Math.floor(v / PRESTAGE_CANVAS_MULTIPLE + 0.5) * PRESTAGE_CANVAS_MULTIPLE);
  width = snap16(width);
  height = snap16(height);
  while (width * height > PRESTAGE_MAX_PIXELS && Math.max(width, height) > PRESTAGE_CANVAS_MULTIPLE) {
    if (width >= height) width -= PRESTAGE_CANVAS_MULTIPLE;
    else height -= PRESTAGE_CANVAS_MULTIPLE;
  }
  return { width, height, ratio, fromImage };
}

export function nextPreStageHandle(state) {
  const taken = new Set(state.refs.map((r) => r.handle));
  for (let n = 1; ; n += 1) {
    const handle = `img-${n}`;
    if (!taken.has(handle)) return handle;
  }
}

export function missingPreStageModels(state) {
  const side = state.models[state.arch] ?? {};
  const dit = state.arch === "krea2" && state.turbo.on ? "turbo_model" : "model";
  return [dit, "clip", "vae"].filter((field) => !side[field]);
}

const TAG_OFFSET = { img: 0, vid: 1, aud: 2 };
export function tagIndex(handle) {
  const match = /^([A-Za-z]+)-(\d+)$/.exec(handle || "");
  if (!match) return 0;
  return (Number(match[2]) - 1 + (TAG_OFFSET[match[1]] ?? 0)) % 8;
}

export function nextHandle(state, kind) {
  const prefix = PREFIX[kind];
  const taken = new Set(state.assets.map((a) => a.handle));
  for (let n = 1; ; n += 1) {
    const handle = `${prefix}-${n}`;
    if (!taken.has(handle)) return handle;
  }
}

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function loraModes(entry) {
  const claimed = (entry.modes || []).filter((m) => CHECKPOINTS.includes(m));
  return claimed.length ? claimed : [...CHECKPOINTS];
}

export const claimsBoth = (entry) => loraModes(entry).length === CHECKPOINTS.length;

export const derivedCheckpoint = (state) => (hasReferences(state) ? "ref2va" : "fl2va");

export function checkpoint(state) {
  const pin = state.checkpoint;
  return !pin || pin === "auto" ? derivedCheckpoint(state) : pin;
}

export const checkpointPinned = (state) => canPinCheckpoint(state) && state.checkpoint !== "auto";

export const canPinCheckpoint = (state) => derivedCheckpoint(state) === "fl2va";

export function normalizeCheckpoint(state) {
  if (!canPinCheckpoint(state)) state.checkpoint = "auto";
}

export function refinedBody(state) {
  const refined = state?.refined;
  if (!refined || refined.enabled === false) return "";
  return (refined.body || "").trim();
}

export const findLora = (state, name) => state.loras.find((l) => l.name === name) || null;

export function activeLoras(state) {
  const target = checkpoint(state);
  return state.loras.filter((entry) =>
    entry.enabled !== false && loraModes(entry).includes(target) && round2(entry.strength) !== 0);
}

export function addLora(state, name, triggers = [], strength = null) {
  if (findLora(state, name)) return null;
  const preferred = Number(strength);
  const entry = {
    name,
    strength: Number.isFinite(preferred) && preferred >= -1 && preferred <= 2
      ? preferred : DEFAULT_STRENGTH,
    enabled: true,
    modes: [...CHECKPOINTS], triggers: [...triggers],
  };
  state.loras.push(entry);
  return entry;
}

export function promptTriggers(state) {
  const out = [];
  const seen = new Set();
  for (const entry of activeLoras(state)) {
    for (const raw of entry.triggers || []) {
      const word = String(raw).trim();
      if (!word || seen.has(word.toLowerCase())) continue;
      seen.add(word.toLowerCase());
      out.push(word);
    }
  }
  return out;
}

export function timelineCheckpoints(timeline) {
  if (isSingle(timeline)) {
    if (timeline.segments.some(hasReferences)) return ["ref2va"];
    const pin = timeline.segments.map((s) => s.checkpoint).find((c) => c && c !== "auto");
    return [pin || "fl2va"];
  }
  const routed = new Set(timeline.segments.map((segment) => checkpoint(segment)));
  return CHECKPOINTS.filter((name) => routed.has(name));
}

export function singleMode(timeline) {
  const shots = timeline.segments;
  if (shots.some(hasReferences)) return "REF2VA";
  const first = frameAsset(shots[0] ?? { assets: [] }, "first_frame");
  const last = frameAsset(shots[shots.length - 1] ?? { assets: [] }, "last_frame");
  if (first && last) return "FL2VA";
  if (first) return "I2VA";
  if (last) return "L2VA";
  return "T2VA";
}

export function singleProblem(timeline) {
  const shots = timeline.segments;
  const globalPrompt = (timeline.prompt || "").trim();
  const number = (index) => pass.start + index + 1;

  for (const [index, shot] of shots.entries()) {
    const text = (refinedBody(shot) || shot.prompt || "").trim();
    // The global prompt opens the first shot of every pass, so it is that
    // shot's text when the box under it is empty.
    if (!text && !(index === 0 && globalPrompt)) {
      return t("Shot {shot} has no prompt. The shots of a pass are one description "
             + "with cuts in it, so an empty one leaves a cut with nothing on the far side.",
             { shot: number(index) });
    }
    if (frameAsset(shot, "first_frame") && index !== 0) {
      return t("Shot {shot} has a start frame, but this pass opens on shot {first}.",
               { shot: number(index), first: number(0) });
    }
    if (frameAsset(shot, "last_frame") && index !== shots.length - 1) {
      return t("Shot {shot} has an end frame, but this pass ends on shot {last}.",
               { shot: number(index), last: number(shots.length - 1) });
    }
  }

  const withRefs = shots.findIndex(hasReferences);
  const withFrames = shots.findIndex((s) => frameAsset(s, "first_frame") || frameAsset(s, "last_frame"));
  if (withRefs >= 0 && withFrames >= 0) {
    return t("Shot {frames} has a start/end frame and shot {refs} has references. "
           + "Those are different checkpoints and one generation runs on one of them.",
           { frames: number(withFrames), refs: number(withRefs) });
  }

  for (const [key, what] of [["checkpoint", "the checkpoint"], ["soundscape", "the soundscape"],
                             ["music", "the music"]]) {
    const seen = new Set(shots
      .map((shot) => (key === "checkpoint" ? shot.checkpoint : (shot[key] || "").trim()))
      .filter((value) => value && value !== "auto"));
    if (key !== "checkpoint" && (timeline[key] || "").trim()) seen.add((timeline[key] || "").trim());
    if (seen.size > 1) return t("The shots disagree about {what}. One pass has only one.", { what: t(what) });
  }
  return null;
}

export function activeGlobalLoras(timeline) {
  const targets = timelineCheckpoints(timeline);
  return (timeline.loras ?? []).filter((entry) =>
    entry.enabled !== false && round2(entry.strength) !== 0
    && loraModes(entry).some((mode) => targets.includes(mode)));
}

export function removeLora(state, name) {
  state.loras = state.loras.filter((entry) => entry.name !== name);
}

export const HANDLE_RE = /@([A-Za-z]+-\d+)/g;

function citedHandles(texts) {
  const found = new Set();
  for (const text of texts) {
    for (const match of String(text ?? "").matchAll(HANDLE_RE)) found.add(match[1]);
  }
  return found;
}

function poolTexts(state, { own = false } = {}) {
  const global_ = (own ? null : state.globalTexts) ?? {};
  const texts = [state.prompt ?? "", global_.prompt ?? "",
                 state.soundscape || global_.soundscape || "",
                 state.music || global_.music || ""];
  if (state.refined && state.refined.enabled !== false) {
    texts.push(state.refined.body ?? "");
    for (const text of Object.values(state.refined.sections ?? {})) texts.push(text ?? "");
  }
  return texts;
}

export function citedPool(state) {
  const pool = state.pool ?? [];
  if (!pool.length) return [];
  const found = citedHandles(poolTexts(state));
  const own = new Set(state.assets.map((a) => a.handle));
  return pool.filter((asset) => found.has(asset.handle) && !own.has(asset.handle));
}

export function citedPoolOwn(state) {
  const found = citedHandles(poolTexts(state, { own: true }));
  return citedPool(state).filter((asset) => found.has(asset.handle));
}

export function poolCitedGlobally(timeline, asset) {
  return citedHandles([timeline.prompt, timeline.soundscape, timeline.music])
    .has(asset.handle);
}

export function poolCitations(timeline, asset) {
  return timeline.segments
    .map((segment, index) => (citedPool(segment).includes(asset) ? index + 1 : null))
    .filter((n) => n !== null);
}

export function nextPoolHandle(timeline) {
  const taken = new Set((timeline.assets ?? []).map((a) => a.handle));
  for (let n = 1; ; n += 1) {
    const handle = `ref-${n}`;
    if (!taken.has(handle)) return handle;
  }
}

export const references = (state) => state.assets.filter((a) => a.role === "reference");
export const refImages = (state) => references(state).filter((a) => a.kind === "image");
export const soundOnly = (asset) => asset.kind === "video" && asset.track === "sound";
export const refVideos = (state) => references(state).filter((a) => a.kind === "video" && !soundOnly(a));
export const refAudios = (state) => references(state).filter((a) => a.kind === "audio" || soundOnly(a));
export const frameAsset = (state, role) => state.assets.find((a) => a.role === role) || null;

export function hasReferences(state) {
  return references(state).length > 0 || citedPool(state).length > 0;
}

export const continues = (state) => state.continue === true;

export const FEATHER_GRID = [1, 5, 22, 39];

export function feather(segment) {
  return FEATHER_GRID.includes(segment.feather) && segment.feather > 1 ? segment.feather : 1;
}

export function maxFeather(segment) {
  const frames = framesForSeconds(segment.duration_s);
  return FEATHER_GRID.filter((f) => 2 * f <= frames).pop() ?? 1;
}

export function continueSource(segment, index) {
  const from = segment.continue_from;
  return Number.isInteger(from) && from >= 1 && from < index ? from : index;
}

export function remapContinueFrom(timeline, map) {
  for (const segment of timeline.segments) {
    if (!Number.isInteger(segment.continue_from)) continue;
    const next = map(segment.continue_from);
    if (Number.isInteger(next) && next >= 1) segment.continue_from = next;
    else delete segment.continue_from;
  }
}

export const continuesAudio = (state) => state.continue_audio === true;

export function frameFile(state) {
  return !!(frameAsset(state, "first_frame") || frameAsset(state, "last_frame"));
}

export function mode(state) {
  if (hasReferences(state)) return "REF2VA";
  const first = frameAsset(state, "first_frame");
  const last = frameAsset(state, "last_frame");
  if (continues(state)) return last ? "FL2VA" : "I2VA";
  if (first && last) return "FL2VA";
  if (first) return "I2VA";
  if (last) return "L2VA";
  return "T2VA";
}

function counts(state) {
  const images = refImages(state).length;
  const videos = refVideos(state).length;
  const audios = refAudios(state).length
    + refVideos(state).filter((v) => v.track === "picture+sound").length;
  return { image: images, video: videos, audio: audios, files: images + videos + audios };
}

export function capacity(state, kind) {
  const used = counts(state);
  const max = { image: MAX_REF_IMAGES, video: MAX_REF_VIDEOS, audio: MAX_REF_AUDIOS }[kind];
  return { used: used[kind], max, filesLeft: MAX_REF_FILES - used.files };
}

export function overflow(state) {
  const used = counts(state);
  if (used.image > MAX_REF_IMAGES) return t("At most {max} reference images.", { max: MAX_REF_IMAGES });
  if (used.video > MAX_REF_VIDEOS) return t("At most {max} reference videos.", { max: MAX_REF_VIDEOS });
  if (used.audio > MAX_REF_AUDIOS) {
    return t("At most {max} reference audio clips, counting video soundtracks.", { max: MAX_REF_AUDIOS });
  }
  if (used.files > MAX_REF_FILES) return t("At most {max} reference files in total.", { max: MAX_REF_FILES });
  return null;
}

export function resolved(state, keyframeSize = null) {
  const frames = framesForSeconds(state.duration_s);
  let ratio = ASPECT_PRESETS.find(([label]) => label === state.aspect)?.[1] ?? 16 / 9;
  let fromImage = false;
  if (keyframeSize && keyframeSize.width && keyframeSize.height) {
    ratio = keyframeSize.width / keyframeSize.height;
    fromImage = true;
  }
  const [width, height] = resolveCanvas(ratio, state.short_edge);
  return { frames, seconds: secondsForFrames(frames), width, height, ratio, fromImage };
}

export function blockedReason(state, action) {
  if (action === "reference" && frameFile(state)) {
    return t("Remove the start/end frame first — references use the Ref2VA checkpoint, frames use FL2VA.");
  }
  if (action === "first_frame" && continues(state)) {
    return t("This segment's start frame is an earlier segment's last frame. Turn continuation off to choose one.");
  }
  if ((action === "first_frame" || action === "last_frame") && hasReferences(state)) {
    if (references(state).length) {
      return t("Remove the references first — start/end frames use the FL2VA checkpoint, references use Ref2VA.");
    }
    const own = citedPoolOwn(state);
    if (own.length) {
      return t("This segment cites a piece reference ({handles}) — edit the mention out first: "
        + "start/end frames use the FL2VA checkpoint, references use Ref2VA.",
          { handles: own.map((a) => `@${a.handle}`).join(", ") });
    }
    return t("The global prompt cites {handles}, which rides into every segment — edit the "
      + "mention out of the global prompt to use start/end frames here.",
        { handles: citedPool(state).map((a) => `@${a.handle}`).join(", ") });
  }
  if (action === "continue" && frameAsset(state, "first_frame")) {
    return t("Remove this segment's start frame first — continuing would replace it with the source "
           + "segment's last frame.");
  }
  return null;
}