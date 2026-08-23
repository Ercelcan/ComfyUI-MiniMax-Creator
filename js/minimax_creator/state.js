import {
  ASPECT_PRESETS,
  FPS,
  MIN_SHORT_EDGE,
  NATIVE_SHORT_EDGE,
  CANVAS_MULTIPLE,
  framesForSeconds,
  secondsForFrames,
  resolveCanvas,
} from "./canvas.js";
import { t } from "./i18n.js";

// ==============================================================================
// Reference Capacity & Handles
// ==============================================================================
export const MAX_REF_IMAGES = 9;
export const MAX_REF_VIDEOS = 3;
export const MAX_REF_AUDIOS = 3;
export const MAX_REF_FILES = 12;

const PREFIX = { image: "picture", video: "video", audio: "audio" };

export const TRACKS = ["picture", "picture+sound", "sound"];
export const DEFAULT_TRACK = "picture";

export const DEFAULT_REF_SIZE = { image: "match", video: "max" };
export const refSize = (asset) => asset.ref_size || DEFAULT_REF_SIZE[asset.kind] || "match";
export const sizeable = (asset) => asset.role === "reference" && DEFAULT_REF_SIZE[asset.kind] !== undefined;

export const TAKES = ["full", "person", "object", "scene", "style"];
export const takes = (asset) => (TAKES.includes(asset.takes) ? asset.takes : "full");
export const takeable = (asset) => asset.kind === "image" && asset.role === "reference";

// ==============================================================================
// Models & Checkpoints
// ==============================================================================
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
  preview: "taeh3, from models/vae_approx — what the live preview decodes through.",
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

// ==============================================================================
// Turbo LoRA Accelerators
// ==============================================================================
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
      sampler_name: typeof raw.saved.sampler_name === "string" ? raw.saved.sampler_name : TURBO_RESET.sampler_name,
      scheduler: typeof raw.saved.scheduler === "string" ? raw.saved.scheduler : TURBO_RESET.scheduler,
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

// ==============================================================================
// SPEED Sampler & VRAM Protection Constants
// ==============================================================================
export const SPEED_PRESETS = [
  "off",
  "Half -> Full (0.5x -> 1.0x) [Balanced / Recommended]",
  "Three-Quarter -> Full (0.75x -> 1.0x) [Fast]",
  "Quarter -> Half -> Full (3-Stage) [High Detail]",
];
export const DEFAULT_SPEED_PRESET = "off";

export const DEFAULT_LOW_VRAM_ATTN = false;
export const DEFAULT_HEAD_CHUNKS = 4;
export const DEFAULT_CHUNK_FFN = false;
export const DEFAULT_FFN_CHUNKS = 2;
export const DEFAULT_FFN_SEQ_THRESHOLD = 4096;

// ==============================================================================
// LoRA & Upscale Settings
// ==============================================================================
export const CHECKPOINTS = ["fl2va", "ref2va"];
export const CHECKPOINT_LABEL = { fl2va: "FL2VA", ref2va: "Ref2VA" };
export const CHECKPOINT_CHOICES = ["auto", ...CHECKPOINTS];
export const DEFAULT_STRENGTH = 1.0;

export const UPSCALE_MODES = ["two_pass", "rtx_vsr", "direct"];
export const RTX_QUALITIES = ["ULTRA", "HIGH", "MEDIUM", "LOW"];
export const DEFAULT_RTX_QUALITY = "ULTRA";
export const DEFAULT_REFINE_DENOISE = 0.25;
export const MIN_REFINE_DENOISE = 0.01;
export const MAX_REFINE_DENOISE = 0.99;
export const DEFAULT_REFINE_STEPS = 1;
export const DEFAULT_UPSCALE_SCALE = 2.0;

const clampSampleEdge = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return NATIVE_SHORT_EDGE;
  const snapped = Math.round(n / CANVAS_MULTIPLE) * CANVAS_MULTIPLE;
  return Math.min(NATIVE_SHORT_EDGE, Math.max(MIN_SHORT_EDGE, snapped));
};

export const sampleEdge = (target) =>
  Math.min(clampSampleEdge(target.sample_edge), target.short_edge || NATIVE_SHORT_EDGE);

export const twoPass = (target) =>
  sampleEdge(target) < (target.short_edge || NATIVE_SHORT_EDGE) && target.upscale === "two_pass";

export const rtxVsr = (target) =>
  target.upscale === "rtx_vsr" || target.rtx_upscale === true;

const clampRefineDenoise = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_REFINE_DENOISE;
  return Math.min(MAX_REFINE_DENOISE, Math.max(MIN_REFINE_DENOISE, n));
};

export const CONTINUITY_MODES = ["latent_mask", "keyframe_still"];
export const START_MODES = ["t2v", "load_video"];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function parseLoras(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object" || !entry.name) return null;
    const strVal = Number(entry.strength);
    return {
      name: String(entry.name).trim(),
      strength: Number.isFinite(strVal) ? round2(strVal) : DEFAULT_STRENGTH,
      enabled: entry.enabled !== false,
      triggers: Array.isArray(entry.triggers) ? [...entry.triggers] : [],
      modes: Array.isArray(entry.modes) && entry.modes.length ? [...entry.modes] : [...CHECKPOINTS],
    };
  }).filter(Boolean);
}

// ==============================================================================
// State Factory & Parser for Single Node (Creator)
// ==============================================================================
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
    refine_steps: DEFAULT_REFINE_STEPS,
    upscale_model: "",
    refine_scale: DEFAULT_UPSCALE_SCALE,
    refine_turbo_only: false,
    save_pass1: false,
    clean_vram: true,
    tiled_vae: false,
    vae_tile_size: 512,
    rtx_upscale: false,
    rtx_scale: DEFAULT_UPSCALE_SCALE,
    rtx_quality: DEFAULT_RTX_QUALITY,
    speed_preset: DEFAULT_SPEED_PRESET,
    low_vram_attn: DEFAULT_LOW_VRAM_ATTN,
    head_chunks: DEFAULT_HEAD_CHUNKS,
    chunk_ffn: DEFAULT_CHUNK_FFN,
    ffn_chunks: DEFAULT_FFN_CHUNKS,
    ffn_seq_threshold: DEFAULT_FFN_SEQ_THRESHOLD,
    checkpoint: "auto",
    start_mode: "t2v",
    models: emptyModels(),
    turbo: emptyTurbo(),
  };
}

export function parseState(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object") {
      const state = { ...emptyState(), ...parsed };
      state.loras = parseLoras(parsed.loras);
      if (!Array.isArray(state.assets)) state.assets = [];
      if (!state.refined || typeof state.refined !== "object") state.refined = null;
      for (const key of ["soundscape", "music"]) {
        if (typeof state[key] !== "string") state[key] = "";
      }
      if (!CHECKPOINT_CHOICES.includes(state.checkpoint)) state.checkpoint = "auto";
      if (!UPSCALE_MODES.includes(state.upscale)) state.upscale = UPSCALE_MODES[0];
      if (!START_MODES.includes(state.start_mode)) state.start_mode = "t2v";
      state.sample_edge = clampSampleEdge(state.sample_edge);
      state.refine_denoise = clampRefineDenoise(state.refine_denoise);
      state.refine_steps = Math.max(1, Math.min(50, Number(state.refine_steps || DEFAULT_REFINE_STEPS)));
      state.upscale_model = String(state.upscale_model || state.upscaler_model || "");
      state.refine_scale = Number(state.refine_scale || DEFAULT_UPSCALE_SCALE);
      state.refine_turbo_only = state.refine_turbo_only === true;
      state.save_pass1 = state.save_pass1 === true;
      state.clean_vram = state.clean_vram !== false;
      state.tiled_vae = state.tiled_vae === true;
      state.vae_tile_size = Number(state.vae_tile_size || 512);
      state.rtx_upscale = state.rtx_upscale === true || state.upscale === "rtx_vsr";
      state.rtx_scale = Number(state.rtx_scale || DEFAULT_UPSCALE_SCALE);
      state.rtx_quality = RTX_QUALITIES.includes(state.rtx_quality) ? state.rtx_quality : DEFAULT_RTX_QUALITY;
      
      if (typeof state.speed_preset === "string") state.speed_preset = state.speed_preset.trim();
      state.low_vram_attn = state.low_vram_attn === true;
      state.head_chunks = Math.max(1, Math.min(16, Number(state.head_chunks || DEFAULT_HEAD_CHUNKS)));
      state.chunk_ffn = state.chunk_ffn === true;
      state.ffn_chunks = Math.max(1, Math.min(8, Number(state.ffn_chunks || DEFAULT_FFN_CHUNKS)));
      state.ffn_seq_threshold = Math.max(256, Math.min(65536, Number(state.ffn_seq_threshold || DEFAULT_FFN_SEQ_THRESHOLD)));

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
  } catch {}
  return emptyState();
}

function serializeLoras(entries) {
  return (entries || []).map((entry) => {
    const strNum = Number(entry.strength);
    const out = {
      name: entry.name,
      strength: Number.isFinite(strNum) ? round2(strNum) : DEFAULT_STRENGTH,
    };
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
      ...(refined.scope ? { scope: refined.scope } : {}),
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
  return (assets || []).map((asset) => {
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
    loras: serializeLoras(state.loras || []),
    duration_s: state.duration_s,
    ...(state.checkpoint && state.checkpoint !== "auto" ? { checkpoint: state.checkpoint } : {}),
    ...(state.start_mode && state.start_mode !== "t2v" ? { start_mode: state.start_mode } : {}),
    ...(state.gain !== undefined && state.gain !== 1.0 ? { gain: round2(state.gain) } : {}),
    ...(state.ducking === false ? { ducking: false } : {}),
    ...(state.cached_video ? { cached_video: state.cached_video } : {}),
    ...(state.extend_video ? { extend_video: state.extend_video } : {}),
    ...(state.locked ? { locked: true } : {}),
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
    ...(state.refine_denoise !== DEFAULT_REFINE_DENOISE ? { refine_denoise: state.refine_denoise } : {}),
    ...(state.refine_steps !== DEFAULT_REFINE_STEPS ? { refine_steps: state.refine_steps } : {}),
    ...(state.upscale_model ? { upscale_model: state.upscale_model } : {}),
    ...(state.refine_scale !== DEFAULT_UPSCALE_SCALE ? { refine_scale: state.refine_scale } : {}),
    ...(state.refine_turbo_only ? { refine_turbo_only: true } : {}),
    ...(state.save_pass1 ? { save_pass1: true } : {}),
    ...(state.clean_vram === false ? { clean_vram: false } : {}),
    ...(state.tiled_vae ? { tiled_vae: true } : {}),
    ...(state.vae_tile_size && state.vae_tile_size !== 512 ? { vae_tile_size: state.vae_tile_size } : {}),
    ...(state.rtx_upscale ? { rtx_upscale: true } : {}),
    ...(state.rtx_scale !== DEFAULT_UPSCALE_SCALE ? { rtx_scale: state.rtx_scale } : {}),
    ...(state.rtx_quality !== DEFAULT_RTX_QUALITY ? { rtx_quality: state.rtx_quality } : {}),
    ...(state.speed_preset && state.speed_preset !== "off" ? { speed_preset: state.speed_preset } : {}),
    ...(state.low_vram_attn ? { low_vram_attn: true, head_chunks: state.head_chunks } : {}),
    ...(state.chunk_ffn ? { chunk_ffn: true, ffn_chunks: state.ffn_chunks, ffn_seq_threshold: state.ffn_seq_threshold } : {}),
    ...serializeModels(state.models),
    ...serializeTurbo(state.turbo),
  }, null, 2);
}

// ==============================================================================
// Timeline Settings, Tracks, Segments & Parser
// ==============================================================================
export const MAX_SEGMENTS = 24;
export const RENDER_MODES = ["chained", "single"];
export const isSingle = (timeline) => timeline?.render === "single";

export const DEFAULT_AUDIO_TAIL_S = 1.0;
export const MAX_AUDIO_TAIL_S = 4.0;

const clampTail = (value) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_AUDIO_TAIL_S;
  return Math.min(seconds, MAX_AUDIO_TAIL_S);
};

export function emptyTracks() {
  return {
    video: { muted: false, locked: false },
    soundscape: { muted: false, volume: 1.0 },
    music: { muted: false, volume: 1.0 },
    master: { muted: false, volume: 1.0 },
  };
}

export function emptySegment() {
  const state = emptyState();
  delete state.version;
  state.continue = false;
  state.continue_audio = false;
  state.continuity_mode = "av_mask";
  state.feather = 39;
  state.locked = false;
  state.cached_video = null;
  state.gain = 1.0;
  state.ducking = true;
  return state;
}

export function emptyTimeline() {
  return {
    version: 2,
    render: "chained",
    prompt: "",
    soundscape: "",
    music: "",
    master_audio: null,
    refined: null,
    aspect: "16:9",
    short_edge: NATIVE_SHORT_EDGE,
    upscale: UPSCALE_MODES[0],
    sample_edge: NATIVE_SHORT_EDGE,
    refine_denoise: DEFAULT_REFINE_DENOISE,
    refine_steps: DEFAULT_REFINE_STEPS,
    upscale_model: "",
    refine_scale: DEFAULT_UPSCALE_SCALE,
    refine_turbo_only: false,
    save_pass1: false,
    clean_vram: true,
    tiled_vae: false,
    vae_tile_size: 512,
    rtx_upscale: false,
    rtx_scale: DEFAULT_UPSCALE_SCALE,
    rtx_quality: DEFAULT_RTX_QUALITY,
    speed_preset: DEFAULT_SPEED_PRESET,
    low_vram_attn: DEFAULT_LOW_VRAM_ATTN,
    head_chunks: DEFAULT_HEAD_CHUNKS,
    chunk_ffn: DEFAULT_CHUNK_FFN,
    ffn_chunks: DEFAULT_FFN_CHUNKS,
    ffn_seq_threshold: DEFAULT_FFN_SEQ_THRESHOLD,
    loras: [],
    assets: [],
    start_mode: "t2v",
    audio_tail_s: DEFAULT_AUDIO_TAIL_S,
    models: { ...emptyModels(), route: "ref2va" },
    turbo: emptyTurbo(),
    tracks: emptyTracks(),
    segments: [emptySegment()],
  };
}

export function syncTimeline(timeline) {
  for (const segment of (timeline.segments || [])) {
    segment.aspect = timeline.aspect;
    segment.short_edge = timeline.short_edge;
    segment.upscale = timeline.upscale;
    segment.sample_edge = timeline.sample_edge;
    segment.refine_denoise = timeline.refine_denoise;
    segment.refine_steps = timeline.refine_steps;
    segment.upscale_model = timeline.upscale_model;
    segment.refine_scale = timeline.refine_scale;
    segment.refine_turbo_only = timeline.refine_turbo_only;
    segment.save_pass1 = timeline.save_pass1;
    segment.clean_vram = timeline.clean_vram;
    segment.tiled_vae = timeline.tiled_vae;
    segment.vae_tile_size = timeline.vae_tile_size;
    segment.rtx_upscale = timeline.rtx_upscale;
    segment.rtx_scale = timeline.rtx_scale;
    segment.rtx_quality = timeline.rtx_quality;
    segment.speed_preset = timeline.speed_preset;
    segment.low_vram_attn = timeline.low_vram_attn;
    segment.head_chunks = timeline.head_chunks;
    segment.chunk_ffn = timeline.chunk_ffn;
    segment.ffn_chunks = timeline.ffn_chunks;
    segment.ffn_seq_threshold = timeline.ffn_seq_threshold;
    segment.pool = timeline.assets ?? [];
    segment.master_audio = timeline.master_audio ?? null;
    segment.globalTexts = {
      prompt: timeline.prompt ?? "",
      soundscape: timeline.soundscape ?? "",
      music: timeline.music ?? "",
    };
  }
  if (timeline.segments && timeline.segments.length) {
    timeline.segments[0].continue = false;
    timeline.segments[0].continue_audio = false;
  }
  (timeline.segments || []).forEach((segment, index) => {
    const from = segment.continue_from;
    if (!Number.isInteger(from) || from < 1 || from >= index) delete segment.continue_from;
  });
  return timeline;
}

export function parseTimeline(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object") {
      const timeline = { ...emptyTimeline(), ...parsed };
      timeline.loras = parseLoras(parsed.loras);
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
      timeline.refine_steps = Math.max(1, Math.min(50, Number(timeline.refine_steps || DEFAULT_REFINE_STEPS)));
      timeline.upscale_model = String(timeline.upscale_model || timeline.upscaler_model || "");
      timeline.refine_scale = Number(timeline.refine_scale || DEFAULT_UPSCALE_SCALE);
      timeline.refine_turbo_only = timeline.refine_turbo_only === true;
      timeline.save_pass1 = timeline.save_pass1 === true;
      timeline.clean_vram = timeline.clean_vram !== false;
      timeline.tiled_vae = timeline.tiled_vae === true;
      timeline.vae_tile_size = Number(timeline.vae_tile_size || 512);
      timeline.rtx_upscale = timeline.rtx_upscale === true || timeline.upscale === "rtx_vsr";
      timeline.rtx_scale = Number(timeline.rtx_scale || DEFAULT_UPSCALE_SCALE);
      timeline.rtx_quality = RTX_QUALITIES.includes(timeline.rtx_quality) ? timeline.rtx_quality : DEFAULT_RTX_QUALITY;
      
      if (typeof timeline.speed_preset === "string") timeline.speed_preset = timeline.speed_preset.trim();
      timeline.low_vram_attn = timeline.low_vram_attn === true;
      timeline.head_chunks = Math.max(1, Math.min(16, Number(timeline.head_chunks || DEFAULT_HEAD_CHUNKS)));
      timeline.chunk_ffn = timeline.chunk_ffn === true;
      timeline.ffn_chunks = Math.max(1, Math.min(8, Number(timeline.ffn_chunks || DEFAULT_FFN_CHUNKS)));
      timeline.ffn_seq_threshold = Math.max(256, Math.min(65536, Number(timeline.ffn_seq_threshold || DEFAULT_FFN_SEQ_THRESHOLD)));

      timeline.models = parseModels(timeline.models);
      timeline.turbo = parseTurbo(timeline.turbo);

      timeline.tracks = { ...emptyTracks(), ...(timeline.tracks || {}) };

      const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
      timeline.segments = (segments.length ? segments : [{}]).map((rawSeg, idx) => {
        const segment = parseState(JSON.stringify(rawSeg ?? {}));
        delete segment.version;
        delete segment.models;
        delete segment.turbo;

        segment.continue = idx > 0 ? (rawSeg?.continue === true) : false;
        segment.continue_audio = idx > 0 ? (rawSeg?.continue_audio === true) : false;
        segment.continuity_mode = rawSeg?.continuity_mode || "av_mask";
        segment.locked = rawSeg?.locked === true;
        segment.cached_video = typeof rawSeg?.cached_video === "string" ? rawSeg.cached_video : null;
        segment.extend_video = typeof rawSeg?.extend_video === "string" ? rawSeg.extend_video : null;
        segment.gain = typeof rawSeg?.gain === "number" ? rawSeg.gain : 1.0;
        segment.ducking = rawSeg?.ducking !== false;

        delete segment.continue_from;
        const from = Number(rawSeg?.continue_from);
        if (Number.isInteger(from)) segment.continue_from = from;
        const width = Number(rawSeg?.feather);
        segment.feather = FEATHER_GRID.includes(width) ? width : (segment.continuity_mode === "latent_mask" ? 39 : 1);
        return segment;
      });
      return syncTimeline(timeline);
    }
  } catch {}
  return emptyTimeline();
}

export function serializeTimeline(timeline) {
  return JSON.stringify({
    version: 2,
    render: timeline.render === "single" ? "single" : "chained",
    prompt: timeline.prompt ?? "",
    ...(timeline.soundscape?.trim() ? { soundscape: timeline.soundscape } : {}),
    ...(timeline.music?.trim() ? { music: timeline.music } : {}),
    ...(timeline.master_audio ? { master_audio: timeline.master_audio } : {}),
    ...serializeRefined(timeline.refined),
    aspect: timeline.aspect,
    short_edge: timeline.short_edge,
    ...(timeline.upscale !== UPSCALE_MODES[0] ? { upscale: timeline.upscale } : {}),
    ...(timeline.sample_edge !== NATIVE_SHORT_EDGE ? { sample_edge: timeline.sample_edge } : {}),
    ...(timeline.refine_denoise !== DEFAULT_REFINE_DENOISE ? { refine_denoise: timeline.refine_denoise } : {}),
    ...(timeline.refine_steps !== DEFAULT_REFINE_STEPS ? { refine_steps: timeline.refine_steps } : {}),
    ...(timeline.upscale_model ? { upscale_model: timeline.upscale_model } : {}),
    ...(timeline.refine_scale !== DEFAULT_UPSCALE_SCALE ? { refine_scale: timeline.refine_scale } : {}),
    ...(timeline.refine_turbo_only ? { refine_turbo_only: true } : {}),
    ...(timeline.save_pass1 ? { save_pass1: true } : {}),
    ...(timeline.clean_vram === false ? { clean_vram: false } : {}),
    ...(timeline.tiled_vae ? { tiled_vae: true } : {}),
    ...(timeline.vae_tile_size && timeline.vae_tile_size !== 512 ? { vae_tile_size: timeline.vae_tile_size } : {}),
    ...(timeline.rtx_upscale ? { rtx_upscale: true } : {}),
    ...(timeline.rtx_scale !== DEFAULT_UPSCALE_SCALE ? { rtx_scale: timeline.rtx_scale } : {}),
    ...(timeline.rtx_quality !== DEFAULT_RTX_QUALITY ? { rtx_quality: timeline.rtx_quality } : {}),
    ...(timeline.speed_preset && timeline.speed_preset !== "off" ? { speed_preset: timeline.speed_preset } : {}),
    ...(timeline.low_vram_attn ? { low_vram_attn: true, head_chunks: timeline.head_chunks } : {}),
    ...(timeline.chunk_ffn ? { chunk_ffn: true, ffn_chunks: timeline.ffn_chunks, ffn_seq_threshold: timeline.ffn_seq_threshold } : {}),
    loras: serializeLoras(timeline.loras ?? []),
    ...(timeline.assets?.length ? { assets: serializeAssets(timeline.assets) } : {}),
    audio_tail_s: clampTail(timeline.audio_tail_s),
    ...serializeModels(timeline.models),
    ...serializeTurbo(timeline.turbo),
    ...(timeline.tracks ? { tracks: timeline.tracks } : {}),
    segments: (timeline.segments || []).map((segment, index) => {
      const out = serializeCommon(segment);
      if (index > 0) {
        out.continue = segment.continue === true;
        out.continue_audio = segment.continue_audio === true;
        out.continuity_mode = segment.continuity_mode || "av_mask";
        out.feather = feather(segment);
      }
      if (segment.extend_video) {
        out.extend_video = segment.extend_video;
      }
      if (segment.cached_video) {
        out.cached_video = segment.cached_video;
      }
      if (segment.locked) {
        out.locked = true;
      }
      if ((out.continue || out.continue_audio)
          && Number.isInteger(segment.continue_from)
          && segment.continue_from >= 1 && segment.continue_from < index) {
        out.continue_from = segment.continue_from;
      }
      return out;
    }),
  }, null, 2);
}

export function cloneSegment(segment) {
  return JSON.parse(JSON.stringify(segment));
}

export const FEATHER_GRID = [1, 5, 22, 39, 56, 90];
export function feather(segment) {
  return FEATHER_GRID.includes(segment?.feather) ? segment.feather : (segment?.continuity_mode === "latent_mask" ? 39 : 1);
}

export function getEffectiveDuration(seg, index, isSingleMode = false) {
  const rawFrames = framesForSeconds(seg?.duration_s || 6);
  const overlap = (!isSingleMode && index > 0 && continues(seg) && feather(seg) > 1) ? feather(seg) : 0;
  const effectiveFrames = Math.max(1, rawFrames - overlap);
  return secondsForFrames(effectiveFrames);
}

export function cutTimes(timeline) {
  const single = isSingle(timeline);
  const at = [];
  let total = 0;
  for (let i = 0; i < (timeline.segments || []).length; i++) {
    const seg = timeline.segments[i];
    at.push(total);
    total += getEffectiveDuration(seg, i, single);
  }
  return { at, total };
}

export function timelineFrames(timeline) {
  if (isSingle(timeline)) return framesForSeconds(cutTimes(timeline).total);
  return (timeline.segments || []).reduce((total, segment, index) => {
    const overlap = index > 0 && continues(segment) && feather(segment) > 1 ? feather(segment) : 0;
    return total + framesForSeconds(segment.duration_s || 6) - overlap;
  }, 0);
}

export function timelineSeconds(timeline) {
  return secondsForFrames(timelineFrames(timeline));
}

export const continues = (state) => state?.continue === true;
export const continuesAudio = (state) => state?.continue_audio === true;
export const isLocked = (segment) => segment?.locked === true && Boolean(segment?.cached_video);

const TAG_OFFSET = { picture: 0, img: 0, video: 1, vid: 1, audio: 2, aud: 2 };
export function tagIndex(handle) {
  const match = /^([A-Za-z]+)-?(\d+)$/.exec(handle || "");
  if (!match) return 0;
  return (Number(match[2]) - 1 + (TAG_OFFSET[match[1]] ?? 0)) % 8;
}

export function nextHandle(state, kind) {
  const prefix = PREFIX[kind];
  const taken = new Set((state.assets || []).map((a) => a.handle));
  for (let n = 1; ; n += 1) {
    const handle = `${prefix}${n}`;
    if (!taken.has(handle)) return handle;
  }
}

export function nextPoolHandle(timeline, kind = "image") {
  const prefix = PREFIX[kind] ?? "picture";
  const taken = new Set((timeline.assets ?? []).map((a) => a.handle));
  for (let n = 1; ; n += 1) {
    const handle = `${prefix}${n}`;
    if (!taken.has(handle)) return handle;
  }
}

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

export const findLora = (state, name) => (state.loras || []).find((l) => l.name === name) || null;
export function activeLoras(state) {
  const target = checkpoint(state);
  return (state.loras || []).filter((entry) =>
    entry.enabled !== false && loraModes(entry).includes(target) && round2(entry.strength) !== 0);
}

export function addLora(state, name, triggers = [], strength = null) {
  const existing = findLora(state, name);
  if (existing) {
    if (strength !== null && Number.isFinite(Number(strength))) {
      existing.strength = round2(strength);
    }
    return existing;
  }
  const preferred = Number(strength);
  const entry = {
    name,
    strength: Number.isFinite(preferred) && preferred >= -1 && preferred <= 2 ? round2(preferred) : DEFAULT_STRENGTH,
    enabled: true,
    modes: [...CHECKPOINTS],
    triggers: [...triggers],
  };
  state.loras = state.loras || [];
  state.loras.push(entry);
  return entry;
}

export function removeLora(state, name) {
  state.loras = (state.loras || []).filter((entry) => entry.name !== name);
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

export function activeGlobalLoras(timeline) {
  const targets = timelineCheckpoints(timeline);
  return (timeline.loras ?? []).filter((entry) =>
    entry.enabled !== false && round2(entry.strength) !== 0
    && loraModes(entry).some((mode) => targets.includes(mode)));
}

export function timelineCheckpoints(timeline) {
  if (isSingle(timeline)) {
    if ((timeline.segments || []).some(hasReferences)) return ["ref2va"];
    const pin = (timeline.segments || []).map((s) => s.checkpoint).find((c) => c && c !== "auto");
    return [pin || "fl2va"];
  }
  const routed = new Set((timeline.segments || []).map((segment) => checkpoint(segment)));
  return CHECKPOINTS.filter((name) => routed.has(name));
}

export const references = (state) => (state.assets || []).filter((a) => a.role === "reference");
export const refImages = (state) => references(state).filter((a) => a.kind === "image");
export const soundOnly = (asset) => asset.kind === "video" && asset.track === "sound";
export const refVideos = (state) => references(state).filter((a) => a.kind === "video" && !soundOnly(a));
export const refAudios = (state) => references(state).filter((a) => a.kind === "audio" || soundOnly(a));
export const frameAsset = (state, role) => (state.assets || []).find((a) => a.role === role) || null;

export const HANDLE_RE = /@([A-Za-z]+-?\d+)/g;
function citedHandles(texts) {
  const found = new Set();
  for (const text of texts) {
    for (const match of String(text ?? "").matchAll(HANDLE_RE)) found.add(match[1]);
  }
  return found;
}

function poolTexts(state, { own = false } = {}) {
  const global_ = (own ? null : state.globalTexts) ?? {};
  const texts = [
    state.prompt ?? "",
    global_.prompt ?? "",
    state.soundscape || global_.soundscape || "",
    state.music || global_.music || "",
  ];
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
  const own = new Set((state.assets || []).map((a) => a.handle));
  return pool.filter((asset) => found.has(asset.handle) && !own.has(asset.handle));
}

export function hasReferences(state) {
  return references(state).length > 0 || citedPool(state).length > 0;
}

export function frameFile(state) {
  return Boolean(frameAsset(state, "first_frame") || frameAsset(state, "last_frame"));
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
  const audios = refAudios(state).length + refVideos(state).filter((v) => v.track === "picture+sound").length;
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
  if (used.audio > MAX_REF_AUDIOS) return t("At most {max} reference audio clips.", { max: MAX_REF_AUDIOS });
  if (used.files > MAX_REF_FILES) return t("At most {max} reference files in total.", { max: MAX_REF_FILES });
  return null;
}

export function resolved(state, keyframeSize = null) {
  const frames = framesForSeconds(state.duration_s || 6);
  let ratio = ASPECT_PRESETS.find(([label]) => label === state.aspect)?.[1] ?? 16 / 9;
  let fromImage = false;
  if (keyframeSize && keyframeSize.width && keyframeSize.height) {
    ratio = keyframeSize.width / keyframeSize.height;
    fromImage = true;
  }
  const [width, height] = resolveCanvas(ratio, state.short_edge || NATIVE_SHORT_EDGE);
  return { frames, seconds: secondsForFrames(frames), width, height, ratio, fromImage };
}

export function blockedReason(state, action) {
  if (action === "reference" && frameFile(state)) {
    return t("Remove start/end frame first — references use Ref2VA, frames use FL2VA.");
  }
  if (action === "first_frame" && continues(state)) {
    return t("This segment starts from previous segment's last frame. Turn continuation off to choose one.");
  }
  if ((action === "first_frame" || action === "last_frame") && hasReferences(state)) {
    return t("Remove references first — start/end frames use FL2VA, references use Ref2VA.");
  }
  if (action === "continue" && frameAsset(state, "first_frame")) {
    return t("Remove start frame first — continuing replaces it with previous segment's tail.");
  }
  return null;
}

// ==============================================================================
// PreStage Image Model & Still Constants & Helpers
// ==============================================================================
export const PRESTAGE_ARCHES = ["krea2", "ideogram4", "minimax"];
export const PRESTAGE_ARCH_LABEL = {
  krea2: "Krea 2",
  ideogram4: "Ideogram 4.0",
  minimax: "MiniMax H3",
};

export const PRESTAGE_ASPECTS = [
  ["21:9", 21 / 9], ["16:9", 16 / 9], ["3:2", 3 / 2], ["4:3", 4 / 3],
  ["1:1", 1], ["3:4", 3 / 4], ["2:3", 2 / 3], ["9:16", 9 / 16],
];

export const PRESTAGE_MIN_EDGE = 512;
export const PRESTAGE_MAX_EDGE = 2048;
export const PRESTAGE_DEFAULT_EDGE = 1024;
export const PRESTAGE_CANVAS_MULTIPLE = 16;
export const PRESTAGE_MAX_PIXELS = 2048 * 2048;

export const PRESTAGE_MAX_REFS = 3;
export const PRESTAGE_DEFAULT_DENOISE = 0.65;
export const PRESTAGE_MIN_DENOISE = 0.05;

export const PRESTAGE_TURBO_QUALITIES = ["draft", "medium", "good"];
export const PRESTAGE_TURBO_STEPS = { draft: 4, medium: 6, good: 8 };
export const PRESTAGE_KREA_RAW = { steps: 52, cfg: 3.5, sampler_name: "euler", scheduler: "simple" };
export const PRESTAGE_KREA_TURBO = { cfg: 1.0, sampler_name: "euler", scheduler: "simple" };

export const PRESTAGE_IDEOGRAM_QUALITIES = ["quality", "default", "turbo"];
export const PRESTAGE_IDEOGRAM_STEPS = { quality: 48, default: 20, turbo: 12 };
export const PRESTAGE_IDEOGRAM_ROW = { cfg: 7.0, sampler_name: "euler" };

export const PRESTAGE_STILL_LENGTHS = [5, 22, 39, 56, 90, 124];
export const PRESTAGE_STILL_ROW = { steps: 20, cfg: 1.0, sampler_name: "res_multistep", scheduler: "simple" };

export const stillLatentFrames = (frames) => (frames <= 5 ? 2 : Math.floor((frames - 5) / 17) * 5 + 2);
export const isStill = (state) => state?.arch === "minimax";

export const PRESTAGE_FIELDS = {
  krea2: ["model", "turbo_model", "clip", "vae"],
  ideogram4: ["model", "uncond_model", "clip", "vae"],
};

export const PRESTAGE_FIELD_LABEL = {
  model: "Model checkpoint",
  turbo_model: "Turbo checkpoint",
  uncond_model: "Unconditional model",
  clip: "Text encoder",
  vae: "VAE",
};

export const PRESTAGE_FIELD_HINT = {
  krea2: {
    model: "Krea 2 RAW — the full 12.9B base DiT. Used when Turbo is off.",
    turbo_model: "Krea 2 Turbo — the 8-step distilled checkpoint. Used when Turbo is on.",
    clip: "Qwen2.5-VL-7B (hidden size 2560). Loaded as CLIPLoader type 'krea2'.",
    vae: "Qwen Image VAE — decodes the 16-channel latent into pixels.",
  },
  ideogram4: {
    model: "Ideogram 4.0 DiT — the conditional branch.",
    uncond_model: "Ideogram 4.0 unconditional branch checkpoint.",
    clip: "Qwen3-VL-8B. Loaded as CLIPLoader type 'ideogram4'.",
    vae: "Flux/SD3 16-channel VAE.",
  },
};

export function emptyPreStageModels() {
  return {
    krea2: { model: "", turbo_model: "", clip: "", vae: "" },
    ideogram4: { model: "", uncond_model: "", clip: "", vae: "" },
    dtype: "default",
  };
}

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
    minimax: {
      frames: 5,
      latent_index: 0,
      request: emptyState(),
    },
    models: emptyPreStageModels(),
    peer: null,
  };
}

export function parsePreStage(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object") {
      const state = { ...emptyPreStage(), ...parsed };
      if (!PRESTAGE_ARCHES.includes(state.arch)) state.arch = "krea2";
      if (!Array.isArray(state.refs)) state.refs = [];
      state.loras = parseLoras(parsed.loras);
      if (!state.turbo || typeof state.turbo !== "object") state.turbo = emptyPreStage().turbo;
      if (!state.minimax || typeof state.minimax !== "object") state.minimax = emptyPreStage().minimax;
      state.minimax.request = parseState(JSON.stringify(state.minimax.request ?? {}));
      state.models = { ...emptyPreStageModels(), ...(parsed.models || {}) };
      state.models.dtype = parsed.models?.dtype || "default";
      return state;
    }
  } catch {}
  return emptyPreStage();
}

export function serializePreStage(state) {
  return JSON.stringify(state, null, 2);
}

export function nextPreStageHandle(state) {
  const taken = new Set((state.refs || []).map((r) => r.handle));
  for (let n = 1; ; n += 1) {
    const handle = `picture${n}`;
    if (!taken.has(handle)) return handle;
  }
}

export function missingPreStageModels(state) {
  const fields = PRESTAGE_FIELDS[state?.arch] || [];
  const side = state?.models?.[state?.arch] || {};
  return fields.filter((f) => !side[f]);
}

export function guessPreStageModels(models, byFolder) {
  let changed = false;
  for (const arch of ["krea2", "ideogram4"]) {
    const side = models[arch] || {};
    const unets = byFolder.diffusion_models || [];
    const clips = byFolder.text_encoders || [];
    const vaes = byFolder.vae || [];

    if (!side.model) {
      const hit = unets.find((n) => n.toLowerCase().includes(arch));
      if (hit) { side.model = hit; changed = true; }
    }
    if (arch === "krea2" && !side.turbo_model) {
      const hit = unets.find((n) => n.toLowerCase().includes("krea") && n.toLowerCase().includes("turbo"));
      if (hit) { side.turbo_model = hit; changed = true; }
    }
    if (!side.clip) {
      if (arch === "krea2") {
        const hit = clips.find((n) =>
          !n.toLowerCase().includes("minimax") &&
          (n.toLowerCase().includes("krea") ||
           n.toLowerCase().includes("qwen2.5_vl_7b") ||
           n.toLowerCase().includes("qwen2.5-vl-7b") ||
           n.toLowerCase().includes("qwen2-vl-7b") ||
           (n.toLowerCase().includes("qwen") && n.toLowerCase().includes("7b"))));
        if (hit) { side.clip = hit; changed = true; }
        else {
          const fallback = clips.find((n) => !n.toLowerCase().includes("minimax") && n.toLowerCase().includes("qwen"));
          if (fallback) { side.clip = fallback; changed = true; }
        }
      } else {
        const hit = clips.find((n) => n.toLowerCase().includes("qwen") || n.toLowerCase().includes(arch));
        if (hit) { side.clip = hit; changed = true; }
      }
    }
    if (!side.vae) {
      const hit = vaes.find((n) => n.toLowerCase().includes("qwen") || n.toLowerCase().includes("flux") || n.toLowerCase().includes("sd3"));
      if (hit) { side.vae = hit; changed = true; }
    }
  }
  return changed;
}

export function resolvedPreStage(state, initSize = null) {
  let ratio = PRESTAGE_ASPECTS.find(([label]) => label === state.aspect)?.[1] ?? 16 / 9;
  let fromImage = false;
  if (initSize && initSize.width && initSize.height) {
    ratio = initSize.width / initSize.height;
    fromImage = true;
  }
  const [width, height] = resolveCanvas(ratio, state.short_edge || PRESTAGE_DEFAULT_EDGE);
  return { width, height, ratio, fromImage };
}