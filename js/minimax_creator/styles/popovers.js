export const css = `
/* --- popovers ------------------------------------------------------------- */
.mmc-pop {
  position: fixed; z-index: 1300; background: #141414; border: 1px solid var(--mmc-line);
  border-radius: 16px; padding: 8px; min-width: 190px;
  box-shadow: 0 18px 48px rgba(0,0,0,.6);
  max-height: calc(100vh - 16px); overflow-y: auto;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  color: var(--mmc-text);
  box-sizing: border-box;
}
.mmc-pop-title { color: var(--mmc-dim); font-size: 12px; padding: 6px 10px 8px; }

/* The output-prefix field and its live reading */
.mmc-out-field {
  width: 100%; box-sizing: border-box; padding: 8px 10px;
  background: var(--mmc-surface); border: 1px solid var(--mmc-line);
  border-radius: 10px; color: var(--mmc-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
}
.mmc-out-field:focus { outline: none; border-color: var(--mmc-blue); }
.mmc-out-field.bad { border-color: #e0743c; }
.mmc-out-problem { color: #e0743c; font-size: 11.5px; line-height: 1.45; padding: 6px 2px 0; }
.mmc-out-example {
  padding: 8px 2px 2px; font-size: 11.5px; line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--mmc-text);
  overflow-wrap: anywhere;
}
.mmc-out-dim { color: var(--mmc-off); }
.mmc-out-tokens { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 8px 2px 2px; }
.mmc-out-tokens-key {
  color: var(--mmc-off); font-size: 10px; letter-spacing: .06em;
  text-transform: uppercase; padding-right: 4px;
}
.mmc-out-token {
  padding: 3px 7px; background: var(--mmc-surface-2); border: 0; border-radius: 7px;
  color: var(--mmc-dim); font-family: ui-monospace, Menlo, monospace; font-size: 11px;
  cursor: pointer;
}
.mmc-out-token:hover { background: var(--mmc-surface-3); color: var(--mmc-text); }

.mmc-opt {
  display: flex; align-items: center; justify-content: space-between; width: 100%;
  padding: 9px 10px; background: none; border: 0; border-radius: 10px;
  color: var(--mmc-text); font-size: 13.5px; font-family: inherit; cursor: pointer;
  text-align: left;
}
.mmc-opt:hover { background: var(--mmc-surface-2); }
.mmc-opt-label { display: flex; align-items: center; gap: 10px; }
.mmc-aspect-glyph {
  width: 18px; height: 18px; flex: none;
  display: flex; align-items: center; justify-content: center;
}
.mmc-aspect-glyph > span { box-sizing: border-box; border: 1.5px solid #6a6a6a; border-radius: 2px; }
.mmc-opt[aria-checked="true"] .mmc-aspect-glyph > span { border-color: var(--mmc-blue); }
.mmc-pill .mmc-aspect-glyph > span { border-color: currentColor; border-width: 1.25px; }

.mmc-radio {
  width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid #4a4a4a; flex: none;
}
.mmc-opt[aria-checked="true"] .mmc-radio {
  border-color: var(--mmc-blue); background: var(--mmc-blue);
  display: flex; align-items: center; justify-content: center;
}
.mmc-opt[aria-checked="true"] .mmc-radio::after {
  content: ""; width: 5px; height: 9px; border: solid #fff;
  border-width: 0 2px 2px 0; transform: rotate(45deg) translate(-1px,-1px);
}

/* ==========================================================================
   REDESIGNED RESOLUTION & UPSCALE POPOVER
   ========================================================================== */
.mmc-res-popover {
  width: 350px;
  max-width: 95vw;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mmc-res-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mmc-res-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mmc-res-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 600;
  color: #fff;
}
.mmc-res-dim-badge {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--mmc-accent, #f0a63c);
  background: rgba(240, 166, 60, 0.12);
  border: 1px solid rgba(240, 166, 60, 0.35);
  border-radius: 6px;
  padding: 1px 6px;
}

.mmc-res-presets-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.mmc-res-chip {
  font-size: 11px !important;
  padding: 3px 8px !important;
}
.mmc-res-chip.native {
  border-color: rgba(240, 166, 60, 0.4);
}

/* The 3-Tab Strategy Selector */
.mmc-res-tabs {
  display: flex;
  background: var(--mmc-surface-2, #262626);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.1));
  border-radius: 10px;
  padding: 2px;
  gap: 2px;
}
.mmc-res-tab {
  flex: 1;
  background: none;
  border: 0;
  border-radius: 8px;
  padding: 6px 4px;
  color: var(--mmc-dim, #8b8b8b);
  font-size: 11.5px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  text-align: center;
  white-space: nowrap;
  transition: all .12s ease;
}
.mmc-res-tab:hover { color: #fff; background: rgba(255,255,255,0.06); }
.mmc-res-tab.active {
  background: var(--mmc-accent, #f0a63c);
  color: #141414;
  font-weight: 600;
}

/* Contextual Card */
.mmc-res-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  background: rgba(0,0,0,0.38);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.08));
  border-radius: 10px;
  padding: 10px;
}
.mmc-res-card.direct-card {
  padding: 8px 10px;
  background: rgba(255,255,255,0.02);
}

.mmc-res-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.mmc-res-hint-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 4px;
}
.mmc-res-badge-nvidia {
  font-size: 9.5px;
  font-weight: 700;
  color: #10b981;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.35);
  border-radius: 4px;
  padding: 1px 5px;
  flex-shrink: 0;
}
.mmc-res-hint-text {
  font-size: 11px;
  color: var(--mmc-dim, #8b8b8b);
  line-height: 1.45;
}

/* Collapsible Memory Fold */
.mmc-res-memory-fold {
  background: var(--mmc-surface-2, #262626) !important;
  border: 1px solid var(--mmc-line) !important;
  border-radius: 10px !important;
  padding: 6px 10px !important;
  font-size: 11.5px !important;
}
.mmc-res-memory-fold summary {
  cursor: pointer;
  color: var(--mmc-dim);
  font-weight: 500;
  user-select: none;
}
.mmc-res-memory-fold summary:hover { color: #fff; }
.mmc-res-fold-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
}

/* Base Slider Styles */
.mmc-slider { width: 300px; padding: 12px; box-sizing: border-box; }
.mmc-slider-body { display: flex; flex-direction: column; gap: 6px; }
.mmc-slider-read {
  display: flex; align-items: baseline; justify-content: space-between;
  font-size: 13px; font-variant-numeric: tabular-nums; line-height: 20px;
}
.mmc-slider-read .mmc-edge { font-size: 16px; font-weight: 600; color: #fff; }
.mmc-slider-read .mmc-edge-unit { color: var(--mmc-dim); font-size: 11px; margin-left: 3px; }
.mmc-slider-read > span:last-child { color: var(--mmc-dim); font-size: 11px; }

.mmc-slider-row { display: flex; align-items: center; gap: 2px; }
.mmc-slider-track { position: relative; flex: 1; padding-bottom: 12px; min-width: 0; }
.mmc-slider input[type="range"], .mmc-res-popover input[type="range"] {
  display: block; width: 100%; margin: 0; height: 18px; accent-color: var(--mmc-blue);
}
.mmc-slider-mark {
  position: absolute; bottom: 0; height: 14px; width: 34px; padding: 0; border: 0;
  background: none; cursor: pointer; font-family: inherit; font-size: 9px;
  letter-spacing: .04em; color: var(--mmc-off);
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  left: calc(8px + var(--p) * (100% - 16px)); margin-left: -17px;
}
.mmc-slider-mark::before { content: ""; width: 2px; height: 4px; border-radius: 1px; background: currentColor; }
.mmc-slider-mark:hover { color: var(--mmc-text); }
.mmc-slider-mark.on { color: var(--mmc-blue); }

.mmc-native { color: var(--mmc-dim); font-size: 11px; line-height: 1.45; min-height: 28px; }
.mmc-native.over { color: #e0743c; }
/* --- chip context menu ----------------------------------------------------- */
.mmc-chip-menu {
  display: flex; flex-direction: column; gap: 2px; min-width: 190px; padding: 5px;
}
.mmc-chip-menu-item {
  text-align: left; border: 0; background: transparent; color: var(--mmc-text);
  font: inherit; font-size: 12.5px; line-height: 1.3; padding: 8px 10px;
  border-radius: 9px; cursor: pointer; white-space: nowrap;
}
.mmc-chip-menu-item:hover { background: var(--mmc-surface-2); }
.mmc-chip-menu-item.danger { color: #e0743c; }
.mmc-chip-menu-item.danger:hover { background: rgba(224,116,60,.12); }
;

/* --- shortcuts popover ----------------------------------------------------- */
.mmc-help-pop { min-width: 260px; padding: 10px 12px; }
.mmc-help-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 12px; color: var(--mmc-text); }
.mmc-help-key {
  flex: none; min-width: 74px; text-align: center; padding: 3px 7px;
  background: var(--mmc-surface-2); border: 1px solid var(--mmc-line); border-radius: 6px;
  font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: var(--mmc-dim);
}
.mmc-help-what { color: var(--mmc-dim); line-height: 1.4; }

`;
