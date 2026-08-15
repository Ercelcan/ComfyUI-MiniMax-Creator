export const css = `
.mmc-refine-split { position: relative; display: flex; }
.mmc-refine-more {
  position: absolute; top: 32px; left: 50%; margin-left: 8px; width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: 0; border-radius: 6px; padding: 0;
  color: var(--mmc-off); cursor: pointer; transition: color .12s ease, background .12s ease;
}
.mmc-refine-more svg { width: 12px; height: 12px; }
.mmc-refine-split:hover .mmc-refine-more { color: var(--mmc-dim); }
.mmc-refine-more:hover { color: var(--mmc-text); background: var(--mmc-surface-3); }
.mmc-refine-more:focus:not(:focus-visible) { outline: none; }

.mmc-tool.busy, .mmc-pill.busy { color: var(--mmc-accent); cursor: progress; }
.mmc-tool.busy .mmc-tool-icon { animation: mmc-pulse 1.4s ease-in-out infinite; }
.mmc-pill.busy { animation: mmc-pulse 1.4s ease-in-out infinite; }
@keyframes mmc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }

.mmc-tl-refine .mmc-tool-icon {
  width: auto; height: auto; background: none; border: 0; border-radius: 0;
}
.mmc-tl-refine svg { width: 15px; height: 15px; }
.mmc-tl-unrefine { color: var(--mmc-dim); }
.mmc-tl-unrefine:hover { color: var(--mmc-text); }
.mmc-refine-split.pill { align-items: stretch; }
.mmc-refine-split.pill .mmc-refine-more {
  position: static; width: 24px; height: 34px; border-radius: 0 17px 17px 0;
  margin-left: -10px; background: var(--mmc-surface-2);
  border: 1px solid var(--mmc-line); border-left: 0; color: var(--mmc-dim);
}
.mmc-refine-split.pill .mmc-refine-more:hover { background: var(--mmc-surface-3); }
.mmc-refine-split.pill .mmc-pill { padding-right: 16px; }

.mmc-refine-pop { width: 264px; padding: 8px; }
.mmc-refine-models { max-height: 190px; overflow-y: auto; }
.mmc-refine-name {
  display: block; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.mmc-opt-kind {
  flex: none; margin-left: auto; margin-right: 8px;
  font-size: 10px; color: var(--mmc-dim);
  border: 1px solid var(--mmc-line); border-radius: 999px; padding: 1px 7px;
}
.mmc-refine-hint { font-size: 11px; color: var(--mmc-dim); line-height: 1.4; }
.mmc-refine-note { padding: 2px 10px 8px; }
.mmc-refine-empty {
  display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
  padding: 4px 10px 10px; font-size: 12px; color: var(--mmc-dim);
}
.mmc-refine-empty code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  color: var(--mmc-text); background: var(--mmc-surface-2);
  border: 1px solid var(--mmc-line); border-radius: 7px; padding: 5px 8px;
}
.mmc-refine-empty .mmc-ghost { font-size: 12px; }

.mmc-refine-fold { font-size: 12px; }
.mmc-refine-fold > summary {
  cursor: pointer; color: var(--mmc-dim); padding: 6px 8px;
  border-top: 1px solid var(--mmc-line); list-style-position: inside;
}
.mmc-refine-fold > summary:hover { color: var(--mmc-text); }
.mmc-refine-more-body {
  display: flex; flex-direction: column; gap: 12px; padding: 4px 10px 8px;
}
.mmc-refine-group { display: flex; flex-direction: column; gap: 7px; }
.mmc-refine-row { display: flex; gap: 8px; flex-wrap: wrap; }
.mmc-refine-seed { font-size: 12px; padding: 0 10px 0 2px; }

.mmc-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.mmc-chip {
  padding: 4px 10px; border-radius: 12px; background: var(--mmc-surface-2);
  border: 1px solid var(--mmc-line); color: var(--mmc-dim);
  font-family: inherit; font-size: 11px; cursor: pointer; transition: all .12s ease;
}
.mmc-chip:hover { color: var(--mmc-text); background: var(--mmc-surface-3); }
.mmc-chip[aria-checked="true"] {
  color: var(--mmc-bg); background: var(--mmc-accent); border-color: var(--mmc-accent);
}

.mmc-refined {
  display: flex; flex-direction: column; gap: 10px; flex-shrink: 0;
  background: rgba(22, 22, 22, 0.85); border: 1px solid var(--mmc-line);
  border-radius: 16px; padding: 14px; margin-top: 4px;
}
.mmc-refined:empty { display: none; }

.mmc-refined-head {
  display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap;
}
.mmc-refined-toggle {
  display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.06);
  border: 1px solid var(--mmc-line); border-radius: 20px;
  padding: 3px 10px; cursor: pointer; color: var(--mmc-dim); font: inherit; font-size: 11.5px;
  transition: all .15s ease;
}
.mmc-refined-toggle:hover { color: var(--mmc-text); background: rgba(255,255,255,0.1); }
.mmc-refined-toggle.on {
  color: #141414; background: var(--mmc-accent); border-color: transparent; font-weight: 600;
}
.mmc-dot {
  width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .7;
}

.mmc-refined-model {
  color: var(--mmc-dim); font-size: 11px;
  background: var(--mmc-surface-2); border: 1px solid var(--mmc-line);
  border-radius: 8px; padding: 2px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.mmc-refined-stale {
  color: var(--mmc-accent); font-size: 11px; background: rgba(240,166,60,0.15);
  border-radius: 8px; padding: 2px 8px;
}

.mmc-copy-btn:hover { color: var(--mmc-accent) !important; }

/* Hero Box Styling */
.mmc-refined-hero {
  position: relative; display: flex; flex-direction: column; width: 100%; box-sizing: border-box;
}
.mmc-refined-box {
  width: 100%; box-sizing: border-box; resize: vertical;
  min-height: 100px; max-height: 400px;
  background: var(--mmc-surface); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px;
  color: var(--mmc-text); font-family: inherit; font-size: 13.5px; line-height: 1.6;
  padding: 12px 14px 28px 14px; outline: none; overflow-y: auto;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.mmc-refined-box:focus {
  border-color: var(--mmc-blue);
  box-shadow: 0 0 0 2px rgba(47, 123, 246, 0.2);
}
.mmc-refined-box::-webkit-scrollbar, .mmc-refined-sub-box::-webkit-scrollbar {
  width: 6px; height: 6px;
}
.mmc-refined-box::-webkit-scrollbar-thumb, .mmc-refined-sub-box::-webkit-scrollbar-thumb {
  background: var(--mmc-surface-3); border-radius: 3px;
}
.mmc-refined-box::-webkit-scrollbar-thumb:hover, .mmc-refined-sub-box::-webkit-scrollbar-thumb:hover {
  background: var(--mmc-dim);
}

.mmc-refined-wordcount {
  position: absolute; right: 14px; bottom: 8px;
  font-size: 10.5px; color: var(--mmc-off); font-family: ui-monospace, Menlo, monospace;
  pointer-events: none;
}

/* Accordion Fold Details */
.mmc-refined-fold {
  background: var(--mmc-surface-2); border: 1px solid var(--mmc-line);
  border-radius: 12px; padding: 10px 14px; font-size: 12px;
  transition: background .15s ease;
}
.mmc-refined-fold[open] { background: rgba(30, 30, 30, 0.95); }
.mmc-refined-fold summary {
  cursor: pointer; color: var(--mmc-dim); font-weight: 500;
  display: flex; align-items: center; gap: 8px; user-select: none;
}
.mmc-refined-fold summary:hover { color: var(--mmc-text); }

.mmc-refined-sections {
  display: flex; flex-direction: column; gap: 12px; padding-top: 10px;
}
.mmc-refined-section { display: flex; flex-direction: column; gap: 5px; }
.mmc-refined-section .mmc-tl-field-name {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--mmc-accent); font-weight: 600;
}
.mmc-refined-sub-box {
  width: 100%; box-sizing: border-box; resize: vertical;
  min-height: 68px; max-height: 260px;
  background: var(--mmc-surface); border: 1px solid var(--mmc-line); border-radius: 10px;
  color: #ededed; font-family: inherit; font-size: 12.5px; line-height: 1.5;
  padding: 10px 12px; outline: none; overflow-y: auto;
}
.mmc-refined-sub-box:focus {
  border-color: rgba(255,255,255,0.3);
  box-shadow: 0 0 0 2px rgba(255,255,255,0.08);
}

.mmc-refined-seen {
  padding: 10px 14px; margin-top: 8px;
  background: rgba(0,0,0,0.35); border-radius: 8px; border-left: 3px solid var(--mmc-accent);
  color: #d0d0d0; font-size: 12.5px; line-height: 1.55;
  white-space: pre-wrap; user-select: text;
}
`;