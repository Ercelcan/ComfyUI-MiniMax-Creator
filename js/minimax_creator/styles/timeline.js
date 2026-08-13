export const css = `
/* --- timeline ------------------------------------------------------------- */

.mmc-continue.on { border-color: var(--mmc-accent); color: var(--mmc-accent); }

.mmc-pill-group.off-distribution { border-color: rgba(224,116,60,.4); }
.mmc-pill-group.off-distribution > span { color: #e0743c; }
.mmc-tl-dur.off-distribution { color: #e0743c; }

.mmc-tl-modal { height: min(680px, 100%); }
.mmc-tl-body {
  display: flex; flex-direction: column; gap: 14px;
  padding: 18px 24px 24px; overflow: hidden; flex: 1; min-height: 0;
}
.mmc-tl-prompt {
  width: 100%; box-sizing: border-box; min-height: 72px; max-height: 180px; resize: vertical;
  background: var(--mmc-surface); border: 1px solid var(--mmc-line); border-radius: 14px;
  color: var(--mmc-text); font-family: inherit; font-size: 14px; line-height: 1.5;
  padding: 12px 14px; outline: none; overflow-y: auto;
}
.mmc-tl-prompt:focus { border-color: rgba(255,255,255,.2); }
.mmc-tl-prompt::placeholder { color: var(--mmc-off); }

.mmc-tl-audio {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px;
}
.mmc-tl-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mmc-tl-field-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; color: var(--mmc-dim); letter-spacing: .02em;
}
.mmc-tl-small { min-height: 54px; max-height: 140px; resize: vertical; font-size: 13px; padding: 8px 10px; }

.mmc-tl-pool { display: flex; flex-direction: column; gap: 6px; }
.mmc-tl-pool-head { display: flex; gap: 10px; align-items: center; min-width: 0; }
.mmc-tl-pool-hint {
  font-size: 11px; color: var(--mmc-off); flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mmc-tl-pool-add { display: inline-flex; gap: 5px; align-items: center; }
.mmc-tl-pool-where { font-size: 11px; color: var(--mmc-dim); white-space: nowrap; }
.mmc-tl-pool-cite {
  background: none; border: 0; padding: 0; font: inherit; cursor: pointer;
}
.mmc-tl-pool-cite:hover { text-decoration: underline; }

.mmc-tl-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; flex-shrink: 0; }
.mmc-pill.on { border-color: rgba(255,255,255,.22); }
.mmc-pill.accel-on { border-color: rgba(110,190,255,.45); color: #6ebeff; }
.mmc-pill.accel-on:hover:not(:disabled) { border-color: rgba(110,190,255,.7); }
.mmc-pill.mmc-experimental { border-style: dashed; border-color: rgba(255,196,110,.5); }
.mmc-pill.mmc-experimental:hover:not(:disabled) { border-color: rgba(255,196,110,.8); }
.mmc-pill[aria-pressed="true"] { border-color: rgba(110,190,255,.45); color: #6ebeff; }
.mmc-turbo-main {
  display: flex; align-items: center; gap: 7px; height: 100%; padding: 0 2px 0 8px;
  background: none; border: 0; color: inherit; font-size: 12px;
  font-family: inherit; cursor: pointer; white-space: nowrap;
}
.mmc-turbo-pick {
  display: flex; align-items: center; justify-content: center; width: 22px; color: inherit;
}
.mmc-pill.mmc-turbo-seg { gap: 0; padding: 0; overflow: hidden; }
.mmc-turbo-opt {
  display: flex; align-items: center; gap: 5px; height: 100%; padding: 0 10px;
  background: none; border: 0; border-left: 1px solid var(--mmc-line);
  color: var(--mmc-dim); font-size: 12px; font-family: inherit; cursor: pointer;
}
.mmc-turbo-opt:first-child { border-left: 0; }
.mmc-turbo-opt:hover { color: #ededed; }
.mmc-turbo-opt[aria-pressed="true"] { background: rgba(110,190,255,.14); color: #6ebeff; }
.mmc-turbo-opt[aria-pressed="true"] .mmc-pill-sub { color: rgba(110,190,255,.75); }
.mmc-tl-total { display: flex; gap: 8px; align-items: baseline; margin-left: auto; font-size: 12px; }
.mmc-tl-total span { color: var(--mmc-dim); }

.mmc-tl-render {
  display: flex; gap: 2px; padding: 2px; border-radius: 10px;
  background: var(--mmc-surface-3); border: 1px solid var(--mmc-line);
}
/* Laid out rather than left to the button's own centring, because the middle
   position is a span and an inline box would sit its text a couple of pixels
   above the two buttons' — which is exactly what it looked like. */
.mmc-tl-render-opt {
  display: flex; align-items: center; justify-content: center;
  height: 24px; padding: 0 10px; border: 0; border-radius: 8px; background: none;
  color: var(--mmc-dim); font-family: inherit; font-size: 12px; line-height: 1; cursor: pointer;
}
.mmc-tl-render-opt:hover { color: var(--mmc-text); }
.mmc-tl-render-opt.on { background: var(--mmc-surface); color: var(--mmc-text); }

.mmc-tl-problem {
  display: flex; gap: 8px; align-items: baseline;
  font-size: 11px; line-height: 1.4; color: #e0743c;
}
.mmc-tl-problem .mmc-note-key { color: inherit; opacity: .8; }

.mmc-tl-strip {
  display: flex; align-items: stretch; gap: 0;
  overflow-x: auto; padding-bottom: 8px; min-height: 170px; flex-shrink: 0;
}
/* The cards row, which is all a seam or the add button occupies: they have no
   rail above them and nothing to say underneath. */
.mmc-tl-seam, .mmc-tl-add { grid-row: 2; }
.mmc-tl-card {
  flex: 0 0 auto; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 8px;
  background: var(--mmc-surface); border: 1px solid var(--mmc-line);
  border-radius: 14px; padding: 12px; font-size: 12px; cursor: default;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.mmc-tl-card:hover { border-color: rgba(255,255,255,.18); }
.mmc-tl-card.generating {
  border-color: #22c55e !important;
  box-shadow: 0 0 14px rgba(34, 197, 94, 0.5);
  animation: mmc-green-pulse 1.2s ease-in-out infinite;
}
.mmc-tl-card-head { display: flex; align-items: center; gap: 8px; }
.mmc-tl-index {
  width: 20px; height: 20px; border-radius: 50%; background: var(--mmc-surface-3);
  display: flex; align-items: center; justify-content: center; font-size: 11px; flex: 0 0 auto;
}
.mmc-tl-dur { color: var(--mmc-text); font-weight: 500; }
.mmc-tl-mode { color: var(--mmc-accent); font-size: 11px; margin-left: auto; }
.mmc-tl-card-prompt {
  flex: 1; color: var(--mmc-text); line-height: 1.45; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
}
.mmc-tl-card-prompt.empty { color: var(--mmc-off); font-style: italic; }
.mmc-tl-card-prompt.superseded { opacity: .42; }
.mmc-tl-card-meta { color: var(--mmc-dim); font-size: 11px; }
.mmc-tl-card-foot { display: flex; align-items: center; gap: 4px; }
.mmc-tl-edit {
  height: 26px; padding: 0 12px; border-radius: 8px; background: var(--mmc-surface-3);
  border: 0; color: var(--mmc-text); font-size: 12px; font-family: inherit; cursor: pointer;
  margin-right: auto;
}
.mmc-tl-edit:hover { background: #3a3a3a; }
.mmc-tl-card-foot .mmc-ghost { padding: 0 4px; font-size: 12px; }
.mmc-tl-card-foot button:disabled { opacity: .3; cursor: not-allowed; }

.mmc-tl-seam {
  flex: 0 0 auto; align-self: center;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
}
.mmc-tl-cut {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  width: 62px; padding: 4px 0; color: var(--mmc-off); font-size: 10px;
  font-variant-numeric: tabular-nums; cursor: default;
}
.mmc-tl-cut span:first-child { font-size: 15px; }

.mmc-tl-join {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  background: none; border: 0; color: var(--mmc-off); cursor: pointer;
  font-family: inherit; font-size: 10px; line-height: 1.25; padding: 4px 2px;
  border-radius: 8px;
}
.mmc-tl-join span:first-child { font-size: 15px; line-height: 1; }
.mmc-tl-join:hover:not(:disabled) { color: var(--mmc-text); background: var(--mmc-surface-2); }
.mmc-tl-join.on { color: var(--mmc-accent); }
.mmc-tl-join:disabled { cursor: not-allowed; opacity: .5; }

.mmc-tl-join-preset {
  width: auto; padding: 2px 6px; font-size: 10px;
}

.mmc-tl-join-sound { padding-top: 0; }
.mmc-tl-join-sound svg { width: 13px; height: 13px; stroke: currentColor; fill: none;
  stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

.mmc-tl-join-from { padding-top: 0; }
.mmc-tl-join-from span:first-child { font-size: 10px; }

.mmc-tl-add {
  width: 108px; box-sizing: border-box; margin: 6px 0 6px 12px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  background: none; border: 1px dashed var(--mmc-line); border-radius: 14px;
  color: var(--mmc-dim); font-family: inherit; font-size: 12px; cursor: pointer;
}
.mmc-tl-add span:first-child { font-size: 20px; }
.mmc-tl-add:hover:not(:disabled) { color: var(--mmc-text); border-color: rgba(255,255,255,.2); }
.mmc-tl-add:disabled { cursor: not-allowed; opacity: .4; }

.mmc-tl-editor { width: min(880px, 100%); height: min(720px, 100%); }
.mmc-tl-editor-sub { color: var(--mmc-dim); font-size: 13px; }
.mmc-tl-editor-body { overflow: auto; flex: 1; min-height: 0; }
.mmc-tl-editor-body .mmc-root { height: auto; overflow: visible; padding: 18px 24px 24px; }

/* --- timeline node body --------------------------------------------------- */

.mmc-tl-summary { gap: 10px; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.mmc-tl-summary-prompt {
  font-size: 13px; line-height: 1.5; color: var(--mmc-text); cursor: pointer;
  flex: 1; min-height: 36px; max-height: 120px; overflow-y: auto; word-break: break-word;
}
.mmc-tl-summary-prompt.empty { color: var(--mmc-off); }

.mmc-tl-lane { display: flex; gap: 4px; height: 34px; cursor: pointer; flex: 0 0 auto; margin-top: auto; padding-top: 6px; border-top: 1px solid var(--mmc-line); }
.mmc-tl-tick {
  display: flex; align-items: center; justify-content: center; gap: 4px;
  background: var(--mmc-surface-2); border: 1px solid var(--mmc-line);
  border-radius: 8px; min-width: 20px; overflow: hidden; padding: 0 6px; transition: all .12s ease;
}
.mmc-tl-tick svg { width: 13px; height: 13px; stroke: currentColor; fill: none;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: 0 0 auto; }
.mmc-tl-tick-n { color: var(--mmc-text); font-size: 11.5px; font-weight: 500; }
.mmc-tl-tick-s { color: var(--mmc-dim); font-size: 10.5px; }
.mmc-tl-lane:hover .mmc-tl-tick { border-color: rgba(255,255,255,.18); }
.mmc-tl-tick.on {
  background: rgba(240,166,60,.13); border-color: rgba(240,166,60,.32); color: var(--mmc-accent);
}
.mmc-tl-tick.on .mmc-tl-tick-n { color: var(--mmc-accent); }

/* Generating active green outline & pulse animation */
.mmc-tl-tick.generating {
  border-color: #22c55e !important;
  outline: 2px solid #22c55e;
  outline-offset: -1px;
  box-shadow: 0 0 10px rgba(34, 197, 94, 0.6);
  color: #4ade80 !important;
  animation: mmc-green-pulse 1.2s ease-in-out infinite;
}
.mmc-tl-tick.generating .mmc-tl-tick-n {
  color: #4ade80 !important;
}

@keyframes mmc-green-pulse {
  0%, 100% { box-shadow: 0 0 6px rgba(34, 197, 94, 0.4); }
  50% { box-shadow: 0 0 14px rgba(34, 197, 94, 0.85); }
}

.mmc-tl-open {
  margin-left: auto; height: 32px; padding: 0 14px; display: flex; align-items: center; gap: 8px;
  border-radius: 999px; background: var(--mmc-surface-3); border: 1px solid var(--mmc-line);
  color: var(--mmc-text); font-family: inherit; font-size: 13px; cursor: pointer;
}
.mmc-tl-open:hover { background: #3a3a3a; border-color: rgba(255,255,255,.18); }
.mmc-tl-open svg { width: 16px; height: 16px; stroke: currentColor; fill: none;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }

/* --- sampler pills -------------------------------------------------------- */

.mmc-pill-static { cursor: default; }
.mmc-pill-static:hover { background: var(--mmc-surface-2); }
.mmc-pill-static svg { color: var(--mmc-dim); }
.mmc-seed-dice { display: flex; align-items: center; padding: 0 4px; }
.mmc-seed-dice svg { width: 15px; height: 15px; stroke: currentColor; fill: none;
  stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.mmc-seed-input {
  width: 92px; background: none; border: 0; outline: none; color: var(--mmc-text);
  font-family: inherit; font-size: 13px; text-align: center; padding: 0;
}
.mmc-seed-mode { font-size: 11px; padding: 0 8px 0 4px; }
.mmc-pop-scroll { max-height: 320px; overflow-y: auto; min-width: 190px; }
`;