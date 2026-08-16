import { fetchPeaks } from "./api.js";
import * as S from "./state.js";

const CACHE = new Map();

/**
 * Retrieves cached peak buffer & duration metadata.
 * @param {string} path Media filepath
 * @returns {Promise<{peaks: Float32Array|null, duration: number, sampleRate: number, channels: number}|null>}
 */
export function peaks(path) {
  if (!path) return Promise.resolve(null);
  if (!CACHE.has(path)) {
    CACHE.set(path, fetchPeaks(path).catch(() => null));
  }
  return CACHE.get(path);
}

/**
 * Paints a standalone audio peak array into a canvas at its current CSS size.
 */
export function draw(canvas, peakData, colour = "rgba(255,255,255,.34)") {
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

  const rawPeaks = peakData?.peaks ?? (peakData instanceof Float32Array || Array.isArray(peakData) ? peakData : null);
  if (!rawPeaks || !rawPeaks.length) return;

  context.fillStyle = colour;
  const middle = height / 2;
  for (let x = 0; x < width; x += 1) {
    const from = Math.floor((x / width) * rawPeaks.length);
    const to = Math.max(from + 1, Math.floor(((x + 1) / width) * rawPeaks.length));
    let peak = 0;
    for (let at = from; at < to && at < rawPeaks.length; at += 1) {
      if (rawPeaks[at] > peak) peak = rawPeaks[at];
    }
    const bar = Math.max(1, peak * (height - 4));
    context.fillRect(x, middle - bar / 2, 1, bar);
  }
}

/**
 * Frame-accurate multi-lane timeline waveform renderer with per-clip peak slicing,
 * trim offset handling, transition overlap shading, and gain scaling.
 *
 * @param {HTMLCanvasElement} canvas Target drawing canvas
 * @param {object} timeline Full timeline state object
 * @param {string} trackType "soundscape" | "music" | "master"
 * @param {number} pxPerSec Current horizontal timeline zoom ratio
 * @param {string} colour Base wave RGBA color
 */
export function drawTimelineWaveform(canvas, timeline, trackType = "soundscape", pxPerSec = 45, colour = "rgba(240,166,60,0.45)") {
  if (!canvas) return;

  const render = async () => {
    const width = canvas.clientWidth || canvas.offsetWidth;
    const height = canvas.clientHeight || canvas.offsetHeight;
    if (!width || !height) return;

    const segList = timeline?.segments || [];
    if (!segList.length && !timeline?.master_audio) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);

    const isSingle = S.isSingle(timeline);
    let currentX = 0;

    // 1. Master Audio Lip-Sync Mode
    if (trackType === "master" && timeline.master_audio?.filename) {
      const meta = await peaks(timeline.master_audio.filename);
      if (meta?.peaks && canvas.isConnected) {
        const fullDur = meta.duration || S.timelineSeconds(timeline);
        const waveWidth = fullDur * pxPerSec;
        ctx.fillStyle = "rgba(157, 149, 245, 0.55)";
        _drawSegmentPeaks(ctx, meta.peaks, 0, waveWidth, height, 0, 1.0, 1.0);
      }
      return;
    }

    // 2. Multi-Segment Lanes (Soundscape & Non-Diegetic Music)
    for (let i = 0; i < segList.length; i++) {
      const seg = segList[i];
      const effectiveDur = S.getEffectiveDuration(seg, i, isSingle);
      const clipWidth = effectiveDur * pxPerSec;
      const gain = Number(seg.gain ?? 1.0);

      const isMusicTrack = trackType === "music";
      const audioAsset = (seg?.assets || []).find((a) =>
        a.kind === "audio" || (a.kind === "video" && a.track !== "picture")
      );
      const sourcePath = isMusicTrack
        ? (seg.music_asset || null)
        : (seg.cached_video || audioAsset?.filename || null);

      if (sourcePath) {
        try {
          const meta = await peaks(sourcePath);
          if (meta?.peaks && canvas.isConnected) {
            const fileDuration = meta.duration || Number(seg.duration_s) || 6.0;
            const trimStart = audioAsset?.trim?.start ?? 0;
            const trimEnd = audioAsset?.trim?.end ?? fileDuration;

            const sliceFracStart = Math.max(0, Math.min(1, trimStart / fileDuration));
            const sliceFracEnd = Math.max(sliceFracStart, Math.min(1, trimEnd / fileDuration));

            const rawPeaks = meta.peaks;
            const startSample = Math.floor(sliceFracStart * rawPeaks.length);
            const endSample = Math.max(startSample + 1, Math.floor(sliceFracEnd * rawPeaks.length));
            const sliced = rawPeaks.slice(startSample, endSample);

            ctx.fillStyle = isMusicTrack ? "rgba(47, 123, 246, 0.55)" : colour;
            _drawSegmentPeaks(ctx, sliced, currentX, clipWidth, height, 0, 1.0, gain);

            // Highlight 100ms equal-power blend region on continuing clips
            if (!isSingle && i > 0 && S.continues(seg) && S.feather(seg) > 1) {
              const blendWidth = (S.feather(seg) / 24.0) * pxPerSec;
              ctx.fillStyle = "rgba(99, 201, 142, 0.25)";
              ctx.fillRect(currentX, 0, Math.min(blendWidth, clipWidth), height);
            }
          }
        } catch {}
      } else if (!isMusicTrack && seg.continue_audio && i > 0) {
        // Continuous room tone carryover line
        ctx.fillStyle = "rgba(47, 123, 246, 0.4)";
        ctx.fillRect(currentX, height / 2 - 1, clipWidth, 2);
      }

      currentX += clipWidth;
    }
  };

  const observer = new ResizeObserver(() => {
    if (!canvas.isConnected) { observer.disconnect(); return; }
    render();
  });
  observer.observe(canvas);

  requestAnimationFrame(render);
}

function _drawSegmentPeaks(ctx, peakArray, startX, widthPx, heightPx, startFrac = 0, endFrac = 1.0, gainMultiplier = 1.0) {
  if (!peakArray || !peakArray.length || widthPx <= 0) return;
  const middle = heightPx / 2;
  const totalLen = peakArray.length;
  const startIdx = Math.floor(startFrac * totalLen);
  const endIdx = Math.max(startIdx + 1, Math.floor(endFrac * totalLen));
  const sliceLen = endIdx - startIdx;

  for (let x = 0; x < widthPx; x += 1) {
    const from = startIdx + Math.floor((x / widthPx) * sliceLen);
    const to = Math.max(from + 1, startIdx + Math.floor(((x + 1) / widthPx) * sliceLen));
    let peak = 0;
    for (let at = from; at < to && at < totalLen; at += 1) {
      if (peakArray[at] > peak) peak = peakArray[at];
    }
    const scaledPeak = Math.min(1.0, peak * gainMultiplier);
    const bar = Math.max(1, scaledPeak * (heightPx - 4));
    ctx.fillRect(startX + x, middle - bar / 2, 1, bar);
  }
}