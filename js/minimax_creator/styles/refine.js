export const css = `
/* Tool rail Refine button (inside CreatorEditor vertical rail) */
.mmc-tool.mmc-refine-split {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  width: 50px;
  background: none;
  border: 0;
  padding: 0;
}
.mmc-tool.mmc-refine-split button.mmc-tool {
  width: 100%;
}
.mmc-tool.mmc-refine-split .mmc-tool-icon {
  width: 50px;
  height: 50px;
  border-radius: 13px;
  background: var(--mmc-surface-2, #262626);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.mmc-tool.mmc-refine-split .mmc-refine-more {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: rgba(0,0,0,0.65);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.1));
  color: var(--mmc-dim, #8b8b8b);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
}
.mmc-tool.mmc-refine-split .mmc-refine-more:hover { color: #fff; background: var(--mmc-surface-3); }

/* Horizontal Pill Bar Refine button (inside Timeline Deck) */
.mmc-refine-split.pill {
  display: inline-flex;
  align-items: stretch;
  height: 34px;
  position: relative;
}
.mmc-refine-split.pill .mmc-pill,
.mmc-refine-split.pill .mmc-nle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px 0 12px;
  border-radius: 17px 0 0 17px;
  background: var(--mmc-surface-2, #262626);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-right: 0;
  color: var(--mmc-text, #ededed);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.mmc-refine-split.pill .mmc-pill:hover,
.mmc-refine-split.pill .mmc-nle-btn:hover {
  background: var(--mmc-surface-3, #2f2f2f);
  color: #fff;
}
.mmc-refine-split.pill .mmc-refine-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 34px;
  border-radius: 0 17px 17px 0;
  background: var(--mmc-surface-2, #262626);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-left: 1px solid rgba(255,255,255,0.05);
  color: var(--mmc-dim, #8b8b8b);
  cursor: pointer;
  padding: 0;
}
.mmc-refine-split.pill .mmc-refine-more:hover {
  background: var(--mmc-surface-3, #2f2f2f);
  color: #fff;
}
.mmc-refine-split.pill svg {
  width: 15px;
  height: 15px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.6;
}

/* Active Running & Spinner Animations */
.mmc-tool.busy .mmc-tool-icon,
.mmc-refine-split.pill button.busy {
  border-color: var(--mmc-accent) !important;
  color: var(--mmc-accent) !important;
  cursor: progress !important;
  animation: mmc-shimmer 1.5s infinite linear;
}

.mmc-refine-spinner {
  display: inline-block;
  width: 13px;
  height: 13px;
  border: 2px solid rgba(240, 166, 60, 0.3);
  border-top-color: var(--mmc-accent);
  border-radius: 50%;
  animation: mmc-spin 0.8s infinite linear;
  margin-right: 2px;
}

@keyframes mmc-spin {
  to { transform: rotate(360deg); }
}

@keyframes mmc-shimmer {
  0% { box-shadow: 0 0 0 0 rgba(240, 166, 60, 0.4); }
  50% { box-shadow: 0 0 10px 2px rgba(240, 166, 60, 0.6); }
  100% { box-shadow: 0 0 0 0 rgba(240, 166, 60, 0.4); }
}

.mmc-refine-pop {
  width: 360px;
  max-width: 94vw;
  max-height: calc(100vh - 32px);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  box-sizing: border-box;
}
.mmc-refine-pop::-webkit-scrollbar { width: 5px; }
.mmc-refine-pop::-webkit-scrollbar-thumb { background: var(--mmc-surface-3); border-radius: 3px; }

.mmc-refine-models {
  max-height: 180px;
  overflow-y: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mmc-refine-models::-webkit-scrollbar { width: 5px; }
.mmc-refine-models::-webkit-scrollbar-thumb { background: var(--mmc-surface-3); border-radius: 3px; }

.mmc-refine-name {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mmc-opt-kind {
  flex: none;
  margin-left: auto;
  margin-right: 8px;
  font-size: 10px;
  color: var(--mmc-dim);
  border: 1px solid var(--mmc-line);
  border-radius: 999px;
  padding: 1px 7px;
}
.mmc-refine-hint { font-size: 11px; color: var(--mmc-dim); line-height: 1.45; }
.mmc-refine-note { padding: 0 2px 4px; }
.mmc-refine-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 4px 8px;
  font-size: 12px;
  color: var(--mmc-dim);
}

.mmc-refine-fold {
  font-size: 12px;
  border: 1px solid var(--mmc-line);
  border-radius: 10px;
  padding: 6px 10px;
}
.mmc-refine-fold > summary {
  cursor: pointer;
  color: var(--mmc-dim);
  font-weight: 500;
  list-style-position: inside;
}
.mmc-refine-fold > summary:hover { color: var(--mmc-text); }
.mmc-refine-more-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 4px 4px;
}
.mmc-refine-group { display: flex; flex-direction: column; gap: 6px; }
.mmc-refine-row { display: flex; gap: 8px; flex-wrap: wrap; }
.mmc-refine-seed { font-size: 12px; padding: 0 10px 0 2px; }

.mmc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mmc-chip {
  padding: 5px 11px;
  border-radius: 12px;
  background: var(--mmc-surface-2);
  border: 1px solid var(--mmc-line);
  color: var(--mmc-dim);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: all .12s ease;
}
.mmc-chip:hover { color: var(--mmc-text); background: var(--mmc-surface-3); }
.mmc-chip[aria-checked="true"] {
  color: var(--mmc-bg);
  background: var(--mmc-accent);
  border-color: var(--mmc-accent);
  font-weight: 500;
}

.mmc-refined {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
  background: rgba(22, 22, 22, 0.85);
  border: 1px solid var(--mmc-line);
  border-radius: 16px;
  padding: 14px;
  margin-top: 4px;
}
.mmc-refined:empty { display: none; }

.mmc-refined-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  flex-wrap: wrap;
}
.mmc-refined-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--mmc-line);
  border-radius: 20px;
  padding: 3px 10px;
  cursor: pointer;
  color: var(--mmc-dim);
  font: inherit;
  font-size: 11.5px;
  transition: all .15s ease;
}
.mmc-refined-toggle:hover { color: var(--mmc-text); background: rgba(255,255,255,0.1); }
.mmc-refined-toggle.on {
  color: #141414;
  background: var(--mmc-accent);
  border-color: transparent;
  font-weight: 600;
}
.mmc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: .7;
}

.mmc-refined-model {
  color: var(--mmc-dim);
  font-size: 11px;
  background: var(--mmc-surface-2);
  border: 1px solid var(--mmc-line);
  border-radius: 8px;
  padding: 2px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.mmc-refined-stale {
  color: var(--mmc-accent);
  font-size: 11px;
  background: rgba(240,166,60,0.15);
  border-radius: 8px;
  padding: 2px 8px;
}

.mmc-copy-btn:hover { color: var(--mmc-accent) !important; }

.mmc-refined-hero {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
}
.mmc-refined-box {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 100px;
  max-height: 400px;
  background: var(--mmc-surface);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 14px;
  color: var(--mmc-text);
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.6;
  padding: 12px 14px 28px 14px;
  outline: none;
  overflow-y: auto;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.mmc-refined-box:focus {
  border-color: var(--mmc-blue);
  box-shadow: 0 0 0 2px rgba(47, 123, 246, 0.2);
}
.mmc-refined-box::-webkit-scrollbar, .mmc-refined-sub-box::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.mmc-refined-box::-webkit-scrollbar-thumb, .mmc-refined-sub-box::-webkit-scrollbar-thumb {
  background: var(--mmc-surface-3);
  border-radius: 3px;
}

.mmc-refined-wordcount {
  position: absolute;
  right: 14px;
  bottom: 8px;
  font-size: 10.5px;
  color: var(--mmc-off);
  font-family: ui-monospace, Menlo, monospace;
  pointer-events: none;
}

.mmc-refined-fold {
  background: var(--mmc-surface-2);
  border: 1px solid var(--mmc-line);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 12px;
  transition: background .15s ease;
}
.mmc-refined-fold[open] { background: rgba(30, 30, 30, 0.95); }
.mmc-refined-fold summary {
  cursor: pointer;
  color: var(--mmc-dim);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
}
.mmc-refined-fold summary:hover { color: var(--mmc-text); }

.mmc-refined-sections {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 10px;
}
.mmc-refined-section { display: flex; flex-direction: column; gap: 5px; }
.mmc-refined-section .mmc-tl-field-name {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--mmc-accent);
  font-weight: 600;
}
.mmc-refined-sub-box {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 68px;
  max-height: 260px;
  background: var(--mmc-surface);
  border: 1px solid var(--mmc-line);
  border-radius: 10px;
  color: #ededed;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  padding: 10px 12px;
  outline: none;
  overflow-y: auto;
}
.mmc-refined-sub-box:focus {
  border-color: rgba(255,255,255,0.3);
  box-shadow: 0 0 0 2px rgba(255,255,255,0.08);
}

.mmc-refined-seen {
  padding: 10px 14px;
  margin-top: 8px;
  background: rgba(0,0,0,0.35);
  border-radius: 8px;
  border-left: 3px solid var(--mmc-accent);
  color: #d0d0d0;
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  user-select: text;
}
`;