export const css = `
.mmc-satellite {
  position: fixed; left: 0; top: 0; z-index: 100;
  transform-origin: 0 0; display: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  color: var(--mmc-text);
}
.mmc-satellite.showing { display: block; }

.mmc-stage {
  position: relative; height: 100%; min-width: 240px;
  flex-direction: column; min-height: 0;
  border-radius: 16px; overflow: hidden;
  background: #000; border: 1px solid var(--mmc-line);
  box-shadow: 0 8px 30px rgba(0,0,0,.45);
}
.mmc-stage[data-state="sampling"] { outline: 3px solid #000; outline-offset: 4.5px; }
.mmc-stage-media { flex: 1; min-height: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.mmc-stage-img, .mmc-stage-video {
  width: 100%; height: 100%; min-height: 0; min-width: 0; object-fit: contain;
  display: block; background: #000; image-rendering: pixelated;
}

.mmc-stage-rule {
  position: absolute; left: 0; right: 0; top: 0; height: 2px;
  background: var(--mmc-accent);
  transform-origin: left center; transform: scaleX(0);
  opacity: 0; transition: transform .3s linear, opacity .2s ease;
  pointer-events: none; z-index: 5;
}
.mmc-stage-readout {
  position: absolute; left: 0; right: 0; top: 0;
  display: flex; justify-content: space-between; gap: 4px;
  padding: 8px 8px 24px; pointer-events: none;
  font-size: 11px; font-variant-numeric: tabular-nums;
  background: linear-gradient(rgba(0,0,0,.72), transparent);
  flex-wrap: wrap; align-items: center; z-index: 4;
}
.mmc-stage-readout:empty { display: none; }
.mmc-stage-chip { color: #ededed; text-shadow: 0 1px 3px rgba(0,0,0,.8); }
.mmc-stage-chip.warn { color: #e0743c; }
.mmc-stage[data-state="sampling"] .mmc-stage-chip:first-child { color: var(--mmc-accent); }
.mmc-stage-segment { font-weight: 500; }
.mmc-stage-gallery {
  pointer-events: auto; cursor: pointer; font: inherit;
  background: rgba(0,0,0,.55); border: 1px solid var(--mmc-line);
  border-radius: 999px; padding: 3px 12px;
}
.mmc-stage-gallery:hover { border-color: #7a7a7a; }
.mmc-stage-close, .mmc-stage-pos, .mmc-stage-mode, .mmc-stage-nav, .mmc-stage-del {
  pointer-events: auto; cursor: pointer; font: inherit;
  background: rgba(0,0,0,.55); border: 1px solid var(--mmc-line);
  border-radius: 999px; padding: 2px 8px; color: #ededed;
  display: inline-flex; align-items: center; justify-content: center;
}
.mmc-stage-mode.on { border-color: var(--mmc-accent); color: var(--mmc-accent); }
.mmc-stage-del:hover { background: rgba(220,50,50,.8); color: #fff; }
.mmc-stage-nav:hover, .mmc-stage-pos:hover, .mmc-stage-mode:hover { background: var(--mmc-surface-3); color: #fff; }

.mmc-stage-resize {
  position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px;
  cursor: nwse-resize; pointer-events: auto; z-index: 10;
  opacity: .5; transition: opacity .12s ease;
}
.mmc-stage-resize:hover { opacity: 1; }
.mmc-stage-resize::after {
  content: ""; position: absolute; right: 3px; bottom: 3px;
  width: 6px; height: 6px; border-right: 2px solid #fff; border-bottom: 2px solid #fff;
}

.mmc-confirm-modal {
  width: min(420px, 90vw) !important;
  height: auto !important;
  min-height: 0 !important;
  padding: 0 !important;
  position: relative !important;
}
.mmc-confirm-body { padding: 20px 24px 12px; display: flex; flex-direction: column; gap: 8px; }
.mmc-confirm-msg { font-size: 14px; color: var(--mmc-text); font-weight: 500; word-break: break-all; }
.mmc-confirm-sub { font-size: 12px; color: #e0743c; }
.mmc-confirm-modal .mmc-modal-foot {
  position: static !important;
  display: flex !important;
  justify-content: flex-end !important;
  align-items: center !important;
  gap: 12px !important;
  padding: 12px 20px 20px !important;
  background: none !important;
  border: 0 !important;
  box-shadow: none !important;
}

.mmc-weight-row {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 3px 4px; box-sizing: border-box;
}
.mmc-weight-name { flex: none; color: var(--mmc-dim); font-size: 12px; width: 112px; }
.mmc-weight-file, .mmc-weight-device {
  background: none; border: 0; border-radius: 8px; padding: 5px 8px;
  color: var(--mmc-text); font-family: inherit; font-size: 13px;
  text-align: left; cursor: pointer;
}
.mmc-weight-file:hover, .mmc-weight-device:hover { background: var(--mmc-surface-2); }
.mmc-weight-file {
  flex: 1; min-width: 0; overflow: hidden; white-space: nowrap;
  text-overflow: ellipsis; direction: rtl;
}
.mmc-weight-file.empty { color: var(--mmc-off); direction: ltr; }
.mmc-weight-row.missing .mmc-weight-file { color: #e0743c; }
.mmc-weight-device {
  flex: none; width: 72px; text-align: center; font-size: 11px;
  color: var(--mmc-off); border: 1px solid transparent;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.mmc-weight-device.pinned {
  color: var(--mmc-blue); border-color: rgba(47,123,246,.35);
}
.mmc-weight-file.forced { color: var(--mmc-accent); }
.mmc-weight-row.idle { opacity: .45; }
.mmc-mode.bad { color: #e0743c; border-color: rgba(224,116,60,.45); }
.mmc-mode.bad b, .mmc-mode.bad .mmc-pin { color: inherit; }
`;