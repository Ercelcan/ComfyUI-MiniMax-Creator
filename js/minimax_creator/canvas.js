// Mirror of canvas.py. The pills show the resolved frame count and WxH live.
// canvas.py is the source of truth for execution.

export const CANVAS_MULTIPLE = 32;
export const FPS = 24;

export const NATIVE_SHORT_EDGE = 768;
export const NATIVE_MAX_PIXELS = 768 * 1344;

// Updated to 352 to support down to 0.2 MP base generation (e.g. 608x352 / 864x480)
export const MIN_SHORT_EDGE = 352;
export const MAX_SHORT_EDGE = 2048;

export const MIN_RATIO = 9 / 16;
export const MAX_RATIO = 21 / 9;

export const ASPECT_PRESETS = [
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["9:16", 9 / 16],
  ["21:9", 21 / 9],
];

export const TRAINED_MIN_FRAMES = 124;
export const TRAINED_MAX_FRAMES = 362;
export const MIN_SECONDS = 1;
export const MAX_SECONDS = 60;

export function legalFrameCounts() {
  const counts = [];
  for (let n = 5; n <= MAX_SECONDS * FPS + 17; n += 17) counts.push(n);
  return counts;
}

export const isTrainedLength = (frames) =>
  frames >= TRAINED_MIN_FRAMES && frames <= TRAINED_MAX_FRAMES;

export function framesForSeconds(seconds) {
  const target = Math.round(seconds * FPS);
  let best = null;
  for (const n of legalFrameCounts()) {
    if (best === null || Math.abs(n - target) < Math.abs(best - target)) best = n;
  }
  return best;
}

export function secondsForFrames(frames) {
  return frames / FPS;
}

export function clampRatio(ratio) {
  if (ratio < MIN_RATIO) return [MIN_RATIO, true];
  if (ratio > MAX_RATIO) return [MAX_RATIO, true];
  return [ratio, false];
}

function snap(value) {
  return Math.max(CANVAS_MULTIPLE, Math.floor(value / CANVAS_MULTIPLE + 0.5) * CANVAS_MULTIPLE);
}

export function resolveCanvas(ratio, shortEdge) {
  const [clamped] = clampRatio(ratio);
  const edge = Math.max(MIN_SHORT_EDGE, Math.min(MAX_SHORT_EDGE, Math.round(shortEdge)));
  const maxPixels = NATIVE_MAX_PIXELS * (edge / NATIVE_SHORT_EDGE) ** 2;

  let width, height;
  if (clamped >= 1) { width = edge * clamped; height = edge; }
  else { width = edge; height = edge / clamped; }

  if (width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height));
    width *= scale;
    height *= scale;
  }

  width = snap(width);
  height = snap(height);

  while (width * height > maxPixels && Math.max(width, height) > CANVAS_MULTIPLE) {
    if (width >= height) width -= CANVAS_MULTIPLE;
    else height -= CANVAS_MULTIPLE;
  }
  return [width, height];
}

export function describeRatio(ratio) {
  let best = ASPECT_PRESETS[0];
  for (const preset of ASPECT_PRESETS) {
    if (Math.abs(preset[1] - ratio) < Math.abs(best[1] - ratio)) best = preset;
  }
  return best[0];
}