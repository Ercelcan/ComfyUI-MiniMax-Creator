export const css = `
/* --- timeline ------------------------------------------------------------- */

.mmc-continue.on { border-color: var(--mmc-accent); color: var(--mmc-accent); }

.mmc-pill-group.off-distribution { border-color: rgba(224,116,60,.4); }
.mmc-pill-group.off-distribution > span { color: #e0743c; }
.mmc-tl-dur.off-distribution { color: #e0743c; }

.mmc-tl-modal {
  width: min(1040px, 94vw); height: min(720px, 94vh);
  background: #141414; border: 1px solid var(--mmc-line);
}
.mmc-tl-body {
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px 20px 20px; overflow: hidden; flex: 1 1 auto; min-height: 0;
}
.mmc-tl-prompt {
  width: 100%; box-sizing: border-box; min-height: 64px; max-height: 200px; resize: vertical;
  background: var(--mmc-surface); border: 1px solid var(--mmc-line); border-radius: 12px;
  color: var(--mmc-text); font-family: inherit; font-size: 13.5px; line-height: 1.5;
  padding: 10px 12px; outline: none; overflow-y: auto;
}
.mmc-tl-prompt:focus { border-color: rgba(255,255,255,.25); }
.mmc-tl-prompt::placeholder { color: var(--mmc-off); }
.mmc-tl-prompt::-webkit-scrollbar, .mmc-tl-small::-webkit-scrollbar { width: 5px; height: 5px; }
.mmc-tl-prompt::-webkit-scrollbar-thumb, .mmc-tl-small::-webkit-scrollbar-thumb {
  background: var(--mmc-surface-3); border-radius: 3px;
}

.mmc-tl-audio-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px;
}
.mmc-tl-field-card {
  display: flex; flex-direction: column; gap: 4px; min-width: 0;
  background: var(--mmc-surface-2); border: 1px solid var(--mmc-line);
  border-radius: 12px; padding: 8px 10px;
}
.mmc-tl-field-tag {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px; font-weight: 600; color: var(--mmc-accent); letter-spacing: .08em;
}
.mmc-tl-small { min-height: 52px; max-height: 140px; resize: vertical; font-size: 12.5px; padding: 8px 10px; }

.mmc-tl-pool-card {
  display: flex; flex-direction: column; gap: 4px;
  background: var(--mmc-surface-2); border: 1px solid var(--mmc-line);
  border-radius: 12px; padding: 8px 12px;
}
.mmc-tl-pool-head { display: flex; gap: 10px; align-items: center; min-width: 0; }
.mmc-tl-pool-hint {
  font-size: 11px; color: var(--mmc-off); flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mmc-tl-pool-add { font-size: 11.5px; color: var(--mmc-accent); cursor: pointer; }
.mmc-tl-pool-add:hover { color: #f5b85c; }
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
  display: flex; align-items: center; gap: 7px; height: 100%; padding: 0 4px 0 8px;
  background: none; border: 0; color: inherit; font-size: 12px;
  font-family: inherit; cursor: pointer; white-space: nowrap;
  max-width: 240px;
}
.mmc-turbo-main span {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;
}
.mmc-turbo-pick {
  display: flex; align-items: center; justify-content: center; width: 20px; color: inherit;
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
.mmc-tl-render-opt {
  height: 24px; padding: 0 10px; border: 0; border-radius: 8px; background: none;
  color: var(--mmc-dim); font-family: inherit; font-size: 12px; cursor: pointer;
}
.mmc-tl-render-opt:hover { color: var(--mmc-text); }
.mmc-tl-render-opt.on { background: var(--mmc-surface); color: var(--mmc-text); }

.mmc-tl-problem {
  display: flex; gap: 8px; align-items: baseline; flex-basis: 100%;
  font-size: 11px; line-height: 1.4; color: #e0743c;
}
.mmc-tl-problem .mmc-note-key { color: inherit; opacity: .8; }

.mmc-tl-strip {
  display: flex; align-items: stretch; gap: 0;
  overflow-x: auto; padding-bottom: 8px; min-height: 200px; flex-shrink: 0;
}
.mmc-tl-card {
  flex: 0 0 auto; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 7px;
  background: var(--mmc-surface); border: 1px solid var(--mmc-line);
  border-radius: 14px; padding: 12px; font-size: 12px; cursor: default;
  transition: border-color .12s ease, box-shadow .12s ease;
  position: relative;
}
.mmc-tl-card:hover { border-color: rgba(255,255,255,.2); }
.mmc-tl-card.generating {
  border-color: #22c55e !important;
  box-shadow: 0 0 14px rgba(34, 197, 94, 0.5);
  animation: mmc-green-pulse 1.2s ease-in-out infinite;
}
.mmc-tl-card.locked {
  border-color: rgba(47, 123, 246, 0.45);
  background: rgba(26, 26, 26, 0.95);
}
.mmc-tl-card.locked .mmc-tl-card-prompt {
  opacity: .75;
}

.mmc-tl-card-head { display: flex; align-items: center; gap: 6px; }
.mmc-tl-index {
  width: 20px; height: 20px; border-radius: 50%; background: var(--mmc-surface-3);
  display: flex; align-items: center; justify-content: center; font-size: 11px; flex: 0 0 auto;
}
.mmc-tl-dur { color: var(--mmc-text); font-weight: 500; }
.mmc-tl-mode { color: var(--mmc-accent); font-size: 10.5px; margin-left: auto; }

.mmc-tl-card-badge {
  font-size: 9px; padding: 1px 5px; border-radius: 6px; font-weight: 600;
  letter-spacing: 0.04em;
}
.mmc-tl-card-badge.locked {
  background: rgba(47, 123, 246, 0.22); color: #5cb8f0; border: 1px solid rgba(47, 123, 246, 0.4);
}
.mmc-tl-card-badge.ready {
  background: rgba(34, 197, 94, 0.16); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.35);
}

.mmc-tl-icon-btn {
  font-size: 12px; padding: 0 4px; cursor: pointer; color: var(--mmc-dim);
  opacity: .75; transition: opacity .15s ease;
}
.mmc-tl-icon-btn:hover { opacity: 1; color: var(--mmc-text); }
.mmc-tl-icon-btn.locked { color: #5cb8f0; opacity: 1; }

/* Visual Filmstrip & Keyframe Slots */
.mmc-tl-filmstrip {
  display: flex; gap: 5px; height: 42px; border-radius: 8px; overflow: hidden;
  background: #0e0e0e; border: 1px solid var(--mmc-line);
}
.mmc-tl-filmstrip-media { width: 100%; height: 100%; object-fit: cover; }
.mmc-tl-filmstrip-slot {
  flex: 1 1 0; height: 100%; border: 0; background: none; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  color: var(--mmc-off); font-size: 9.5px; font-family: inherit; position: relative;
  transition: background .12s ease, color .12s ease;
}
.mmc-tl-filmstrip-slot:hover { background: var(--mmc-surface-2); color: var(--mmc-text); }
.mmc-tl-filmstrip-slot.has-asset img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mmc-tl-slot-tag {
  position: absolute; bottom: 2px; left: 2px; font-size: 8px; font-weight: 700;
  background: rgba(0,0,0,0.7); color: #fff; padding: 1px 4px; border-radius: 3px;
}

/* Audio Waveform inside Card */
.mmc-tl-card-wave {
  width: 100%; height: 14px; border-radius: 4px; background: rgba(0,0,0,0.3);
  display: block; pointer-events: none;
}
.mmc-tl-card-wave:empty { display: none; }

.mmc-tl-card-prompt {
  flex: 1 1 auto; color: var(--mmc-text); line-height: 1.45; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
}
.mmc-tl-card-prompt.empty { color: var(--mmc-off); font-style: italic; }
.mmc-tl-card-prompt.superseded { opacity: .42; }
.mmc-tl-card-meta { color: var(--mmc-dim); font-size: 11px; }
.mmc-tl-card-foot { display: flex; align-items: center; gap: 4px; margin-top: auto; }
.mmc-tl-edit {
  height: 24px; padding: 0 10px; border-radius: 6px; background: var(--mmc-surface-3);
  border: 0; color: var(--mmc-text); font-size: 11.5px; font-family: inherit; cursor: pointer;
  margin-right: auto;
}
.mmc-tl-edit:hover { background: #3c3c3c; }
.mmc-tl-card-foot button:disabled { opacity: .3; cursor: not-allowed; }

/* In-Between Seam Controls */
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
  flex: 0 0 auto; align-self: center; width: 62px;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  background: none; border: 0; color: var(--mmc-off); cursor: pointer;
  font-family: inherit; font-size: 10px; padding: 4px 0;
}
.mmc-tl-join span:first-child { font-size: 15px; }
.mmc-tl-join:hover:not(:disabled) { color: var(--mmc-text); }
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
  flex: 0 0 auto; align-self: stretch; width: 90px; margin-left: 10px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  background: none; border: 1px dashed var(--mmc-line); border-radius: 14px;
  color: var(--mmc-dim); font-family: inherit; font-size: 12px; cursor: pointer;
}
.mmc-tl-add:hover:not(:disabled) { color: var(--mmc-text); border-color: rgba(255,255,255,.25); }
.mmc-tl-add:disabled { cursor: not-allowed; opacity: .4; }

.mmc-tl-editor { width: min(880px, 100%); height: min(720px, 100%); }
.mmc-tl-editor-sub { color: var(--mmc-dim); font-size: 13px; }
.mmc-tl-editor-body { overflow: auto; flex: 1; min-height: 0; }
.mmc-tl-editor-body .mmc-root { height: auto; overflow: visible; padding: 18px 24px 24px; }

/* --- timeline node body summary ------------------------------------------ */

.mmc-tl-summary {
  gap: 10px; flex: 1 1 auto; min-height: 200px; display: flex; flex-direction: column;
}

.mmc-tl-summary-header {
  display: flex; align-items: center; gap: 8px; width: 100%; flex-shrink: 0;
}
.mmc-tl-summary-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mmc-accent);
}

.mmc-tl-summary-prompt {
  font-size: 14px; line-height: 1.6; color: var(--mmc-text); cursor: pointer;
  flex: 1 1 auto; min-height: 70px; max-height: none; overflow-y: auto; word-break: break-word;
  padding: 10px 14px; background: rgba(0,0,0,0.3); border-radius: 12px; border: 1px solid var(--mmc-line);
  box-sizing: border-box; transition: border-color .15s ease;
}
.mmc-tl-summary-prompt:hover { border-color: rgba(255,255,255,0.22); }
.mmc-tl-summary-prompt.empty { color: var(--mmc-off); font-style: italic; }
.mmc-tl-summary-prompt::-webkit-scrollbar { width: 5px; height: 5px; }
.mmc-tl-summary-prompt::-webkit-scrollbar-thumb { background: var(--mmc-surface-3); border-radius: 3px; }

/* Interactive Storyboard Filmstrip Lane */
.mmc-tl-lane-wrapper {
  position: relative; width: 100%; height: 64px; flex-shrink: 0;
  border-radius: 12px; overflow: hidden; background: #0c0c0c;
  border: 1px solid var(--mmc-line); display: flex; align-items: stretch;
}

.mmc-tl-lane-wave {
  position: absolute; inset: 0; width: 100%; height: 100%;
  pointer-events: none; opacity: 0.75; z-index: 1;
}

.mmc-tl-lane {
  position: relative; z-index: 2; display: flex; gap: 4px; padding: 4px;
  width: 100%; height: 100%; cursor: pointer; box-sizing: border-box;
  overflow-x: auto; overflow-y: hidden;
}
.mmc-tl-lane::-webkit-scrollbar { height: 4px; }
.mmc-tl-lane::-webkit-scrollbar-thumb { background: var(--mmc-surface-3); border-radius: 2px; }

.mmc-tl-tick {
  position: relative; display: flex; flex-direction: column; justify-content: space-between;
  border-radius: 8px; min-width: 58px; max-width: 160px; overflow: hidden;
  background: rgba(32, 32, 32, 0.85); backdrop-filter: blur(4px);
  border: 1px solid rgba(255,255,255,0.1); padding: 5px 7px;
  box-sizing: border-box; transition: all .12s ease;
}
.mmc-tl-tick:hover { border-color: rgba(255,255,255,0.3); background: rgba(45, 45, 45, 0.9); }
.mmc-tl-tick.on {
  border-color: rgba(240,166,60,0.5); background: rgba(240,166,60,0.12);
}
.mmc-tl-tick.locked {
  border-color: rgba(47, 123, 246, 0.55); background: rgba(47, 123, 246, 0.16);
}
.mmc-tl-tick.generating {
  border-color: #22c55e !important;
  box-shadow: 0 0 12px rgba(34, 197, 94, 0.7);
  animation: mmc-green-pulse 1.2s ease-in-out infinite;
}

/* Tick Thumbnail Background */
.mmc-tl-tick-thumb {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; opacity: 0.35; z-index: 1; pointer-events: none;
}
.mmc-tl-tick-overlay {
  position: relative; z-index: 2; width: 100%; height: 100%;
  display: flex; flex-direction: column; justify-content: space-between;
}
.mmc-tl-tick-top { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.mmc-tl-tick-n { font-size: 11px; font-weight: 600; color: #ededed; text-shadow: 0 1px 2px #000; }
.mmc-tl-tick.on .mmc-tl-tick-n { color: var(--mmc-accent); }
.mmc-tl-tick-lock { font-size: 9.5px; }
.mmc-tl-tick-s { font-size: 10px; color: var(--mmc-dim); font-variant-numeric: tabular-nums; text-shadow: 0 1px 2px #000; }

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