import { api } from "../../../scripts/api.js";
import { t } from "./i18n.js";

const cache = new Map();
const CACHE_MS = 4000;

export async function listAssets({ force = false, root = "input" } = {}) {
  const hit = cache.get(root);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.assets;
  const response = await api.fetchApi(`/minimax_creator/assets?root=${encodeURIComponent(root)}`);
  if (!response.ok) throw new Error(t("asset listing failed ({status})", { status: response.status }));
  const body = await response.json();
  const assets = body.assets ?? [];
  cache.set(root, { at: Date.now(), assets, truncated: body.truncated === true });
  return assets;
}

export function listingTruncated(root = "input") {
  return cache.get(root)?.truncated === true;
}

export function invalidate() {
  cache.clear();
}

export async function moveAsset(filename, subfolder) {
  const response = await api.fetchApi("/minimax_creator/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, subfolder }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || t("move failed ({status})", { status: response.status }));
  invalidate();
  return body.path;
}

export async function deleteAsset(filename) {
  const response = await api.fetchApi("/minimax_creator/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || t("delete failed ({status})", { status: response.status }));
  invalidate();
}

export async function clearTimelineCache() {
  const response = await api.fetchApi("/minimax_creator/clear_cache", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || t("clear cache failed ({status})", { status: response.status }));
  invalidate();
  return body;
}

// ---- picker preferences -----------------------------------------------------

const PREFS_FILE = "minimax_creator.picker.json";
const PREFS_KEY = "mmc-picker-prefs";
let prefsCache = null;

const names = (value) => (Array.isArray(value) ? value.filter((p) => typeof p === "string") : []);

function normalizePrefs(raw) {
  return {
    favorites: names(raw?.favorites),
    folders: names(raw?.folders),
    renderFolders: names(raw?.renderFolders),
  };
}

export async function loadPickerPrefs() {
  if (prefsCache) return prefsCache;
  let raw = null;
  try {
    const response = await api.getUserData(PREFS_FILE);
    if (response.status === 200) raw = await response.json();
  } catch {
    try { raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null"); } catch {}
  }
  prefsCache = normalizePrefs(raw);
  return prefsCache;
}

export function savePickerPrefs(prefs) {
  prefsCache = normalizePrefs(prefs);
  const body = JSON.stringify(prefsCache);
  try { localStorage.setItem(PREFS_KEY, body); } catch {}
  try { api.storeUserData(PREFS_FILE, prefsCache, { stringify: true }); } catch {}
}

// ---- settings ---------------------------------------------------------------

export async function loadSettings() {
  const response = await api.fetchApi("/minimax_creator/settings");
  if (!response.ok) throw new Error(t("settings failed ({status})", { status: response.status }));
  return (await response.json()).settings ?? {};
}

export async function saveSettings(patch) {
  const response = await api.fetchApi("/minimax_creator/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || t("settings failed ({status})", { status: response.status }));
  return body.settings ?? {};
}

let modelsAt = 0;
let modelsCache = null;
let modelsInFlight = null;

export async function listModels({ force = false } = {}) {
  if (!force && modelsCache && Date.now() - modelsAt < 60000) return modelsCache;
  if (!force && modelsInFlight) return modelsInFlight;
  modelsInFlight = (async () => {
    try {
      const response = await api.fetchApi("/minimax_creator/models");
      if (!response.ok) throw new Error(t("model listing failed ({status})", { status: response.status }));
      modelsCache = await response.json();
      modelsAt = Date.now();
      return modelsCache;
    } finally {
      modelsInFlight = null;
    }
  })();
  return modelsInFlight;
}

export function outputUrl({ filename, subfolder = "", type = "output" }) {
  return api.apiURL(`/view?${new URLSearchParams({ filename, subfolder, type })}`);
}

const loraCache = new Map();

export async function listLoras({ folder = "", force = false } = {}) {
  const hit = loraCache.get(folder);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  const query = new URLSearchParams({ folder });
  if (force) query.set("refresh", "1");
  const response = await api.fetchApi(`/minimax_creator/loras?${query}`);
  if (!response.ok) throw new Error(t("LoRA listing failed ({status})", { status: response.status }));
  const body = await response.json();
  if (force) loraCache.clear();
  loraCache.set(folder, { at: Date.now(), body });
  return body;
}

export function loraPreviewUrl(name) {
  return api.apiURL(`/minimax_creator/lora_preview?name=${encodeURIComponent(name)}`);
}

const detailCache = new Map();

export async function loraDetail(name) {
  const hit = detailCache.get(name);
  if (hit && Date.now() - hit.at < 60000) return hit.detail;
  const response = await api.fetchApi(`/minimax_creator/lora_detail?name=${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(t("detail failed ({status})", { status: response.status }));
  const detail = await response.json();
  detailCache.set(name, { at: Date.now(), detail });
  return detail;
}

export function loraShowcaseUrl(name, item, { thumb = false } = {}) {
  const params = new URLSearchParams({ name, item: String(item) });
  if (thumb) params.set("thumb", "1");
  return api.apiURL(`/minimax_creator/lora_showcase?${params}`);
}

const PROBES = new Map();

export function probe(path) {
  if (!PROBES.has(path)) PROBES.set(path, ask(path));
  return PROBES.get(path);
}

export async function probeAudio(path) {
  return (await probe(path)).hasAudio;
}

async function ask(path) {
  try {
    const response = await api.fetchApi(`/minimax_creator/probe?filename=${encodeURIComponent(path)}`);
    const body = await response.json();
    return {
      hasAudio: typeof body.has_audio === "boolean" ? body.has_audio : null,
      duration: Number.isFinite(body.duration) ? body.duration : null,
    };
  } catch {
    return { hasAudio: null, duration: null };
  }
}

export function thumbUrl(path, version) {
  const params = new URLSearchParams({ filename: path });
  if (version) params.set("v", String(version));
  return api.apiURL(`/minimax_creator/thumb?${params}`);
}

export function viewUrl(path, { preview = false } = {}) {
  const str = String(path ?? "");
  const annotated = /^(.*) \[(input|output|temp)\]$/.exec(str);
  const clean = annotated ? annotated[1] : str;
  const at = clean.lastIndexOf("/");

  // Videos must NEVER be requested with /view?preview=webp because Pillow crashes on video files!
  const isVideo = /\.(mp4|webm|mov|mkv|avi)$/i.test(clean);
  if (isVideo && preview) {
    return thumbUrl(path);
  }

  const params = new URLSearchParams({
    filename: at < 0 ? clean : clean.slice(at + 1),
    subfolder: at < 0 ? "" : clean.slice(0, at),
    type: annotated ? annotated[2] : "input",
  });
  if (preview && !isVideo) params.set("preview", "webp;70");
  return api.apiURL(`/view?${params}`);
}

export async function fetchPeaks(path) {
  try {
    const response = await api.fetchApi(`/minimax_creator/peaks?filename=${encodeURIComponent(path)}`);
    if (!response.ok) return null;
    const body = await response.json();
    return {
      peaks: Array.isArray(body.peaks) ? Float32Array.from(body.peaks) : null,
      duration: Number(body.duration) || 0,
      sampleRate: Number(body.sample_rate) || 44100,
      channels: Number(body.channels) || 2,
    };
  } catch {
    return null;
  }
}

export async function upload(file, subfolder = "") {
  const form = new FormData();
  form.append("image", file);
  if (subfolder) form.append("subfolder", subfolder);
  const response = await api.fetchApi("/upload/image", { method: "POST", body: form });
  if (!response.ok) throw new Error(t("upload failed ({status})", { status: response.status }));
  const body = await response.json();
  invalidate();
  return {
    path: body.subfolder ? `${body.subfolder}/${body.name}` : body.name,
    name: body.name,
    subfolder: body.subfolder || "",
  };
}

export async function exportTimeline(timelineData, format = "edl") {
  const response = await api.fetchApi("/minimax_creator/export_timeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeline: timelineData, format }),
  });
  if (!response.ok) throw new Error(t("Timeline export failed ({status})", { status: response.status }));
  const body = await response.json();

  const blob = new Blob([body.content], { type: format === "xml" ? "application/xml" : "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = body.filename || `timeline_export.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return body;
}