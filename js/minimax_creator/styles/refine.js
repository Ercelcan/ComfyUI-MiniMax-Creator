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

.mmc-refined { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
.mmc-refined:empty { display: none; }
.mmc-refined-head { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.mmc-refined-toggle {
  display: flex; align-items: center; gap: 6px; background: none; border: 0;
  padding: 0; cursor: pointer; color: var(--mmc-off); font: inherit; font-size: 12px;
}
.mmc-refined-toggle.on { color: var(--mmc-accent); }
.mmc-dot {
  width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .5;
}
.mmc-refined-toggle.on .mmc-dot { opacity: 1; }
.mmc-refined-model { color: var(--mmc-dim); font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.mmc-refined-stale { color: var(--mmc-accent); font-size: 11px; opacity: .8; }
.mmc-refined-lede { color: var(--mmc-dim); font-size: 11px; margin-top: -4px; }
.mmc-refined-box {
  width: 100%; box-sizing: border-box; resize: vertical;
  max-height: 180px; min-height: 54px;
  background: var(--mmc-surface); border: 1px solid var(--mmc-line); border-radius: 12px;
  color: var(--mmc-text); font-family: inherit; font-size: 13px; line-height: 1.5;
  padding: 10px 12px; outline: none; overflow-y: auto;
}
.mmc-refined-box:focus { border-color: rgba(255,255,255,.2); }
.mmc-refined-fold { font-size: 12px; color: var(--mmc-dim); }
.mmc-refined-fold summary { cursor: pointer; padding: 2px 0; }
.mmc-refined-sections { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; }
.mmc-refined-section { display: flex; flex-direction: column; gap: 4px; }
.mmc-refined-seen {
  padding: 6px 10px; border-left: 2px solid var(--mmc-line);
  white-space: pre-wrap; user-select: text;
}
`;