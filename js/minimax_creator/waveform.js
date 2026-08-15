import { fetchPeaks } from "./api.js";
import { FPS, framesForSeconds } from "./canvas.js";
import * as S from "./state.js";

const CACHE = new Map();

export function peaks(path) {
  if (!path) return Promise.resolve(null);
  if (!CACHE.has(path)) CACHE.set(path, fetchPeaks(path).catch(() => null));
  return CACHE.get(path);
}

/** Paint peaks into a canvas at its current CSS size, one column per pixel. */
export function draw(canvas, data, colour = "rgba(255,255,255,.34)") {
  if (!canvas) return;
  const width = canvas.clientWidth || canvas.offsetWidth;
  const height = canvas.clientHeight || canvas.offsetHeight;
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  if (!data?.length) return;

  context.fillStyle = colour;
  const middle = height / 2;
  for (let x = 0; x < width; x += 1) {
    const from = Math.floor((x / width) * data.length);
    const to = Math.max(from + 1, Math.floor(((x + 1) / width) * data.length));
    let peak = 0;
    for (let at = from; at < to && at < data.length; at += 1) {
      if (data[at] > peak) peak = data[at];
    }
    const bar = Math.max(1, peak * (height - 4));
    context.fillRect(x, middle - bar / 2, 1, bar);
  }
}

/**
 * Draw a continuous timeline audio waveform composed of multiple shots with 
 * accurate effective duration accounting for motion blend trims.
 */
export function drawTimelineWaveform(canvas, segments, colour = "rgba(240,166,60,0.45)") {
  if (!canvas) return;

  const render = async () => {
    const width = canvas.clientWidth || canvas.offsetWidth;
    const height = canvas.clientHeight || canvas.offsetHeight;
    if (!width || !height) return;

    const segList = segments || [];
    if (!segList.length) return;

    // Calculate effective total duration accounting for seam blend trimming
    const effectiveDurations = segList.map((seg, idx) => {
      const rawFrames = framesForSeconds(seg.duration_s || 6);
      const overlap = (idx > 0 && S.continues(seg) && S.feather(seg) > 1) ? S.feather(seg) : 0;
      const effectiveFrames = Math.max(1, rawFrames - overlap);
      return effectiveFrames / FPS;
    });

    const totalDuration = effectiveDurations.reduce((acc, d) => acc + d, 0);
    if (totalDuration <= 0) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    let currentX = 0;
    for (let i = 0; i < segList.length; i++) {
      const seg = segList[i];
      const segDur = effectiveDurations[i];
      const segWidth = (segDur / totalDuration) * width;
      
      const audioAsset = (seg?.assets || []).find((a) => a.kind === "audio" || (a.kind === "video" && a.track !== "picture"));
      const sourcePath = seg?.cached_video || audioAsset?.filename;

      if (sourcePath) {
        try {
          const data = await peaks(sourcePath);
          if (data?.length && canvas.isConnected) {
            context.fillStyle = colour;
            const middle = height / 2;
            for (let x = 0; x < segWidth; x += 1) {
              const from = Math.floor((x / segWidth) * data.length);
              const to = Math.max(from + 1, Math.floor(((x + 1) / segWidth) * data.length));
              let peak = 0;
              for (let at = from; at < to && at < data.length; at += 1) {
                if (data[at] > peak) peak = data[at];
              }
              const bar = Math.max(1, peak * (height - 6));
              context.fillRect(currentX + x, middle - bar / 2, 1, bar);
            }
          }
        } catch {}
      } else if (seg?.continue_audio) {
        context.fillStyle = "rgba(47, 123, 246, 0.35)";
        context.fillRect(currentX, height / 2 - 1, segWidth, 2);
      }
      
      currentX += segWidth;
    }
  };

  const observer = new ResizeObserver(() => {
    if (!canvas.isConnected) { observer.disconnect(); return; }
    render();
  });
  observer.observe(canvas);

  requestAnimationFrame(render);
}