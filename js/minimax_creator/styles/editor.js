export const css = `
.mmc-root svg, .mmc-overlay svg, .mmc-pop svg {
  fill: none; stroke: currentColor; stroke-width: 1.6;
  stroke-linecap: round; stroke-linejoin: round;
}

.mmc-rail { display: flex; gap: 8px 16px; flex-wrap: wrap; justify-content: space-between; flex-shrink: 0; }
.mmc-rail-group { display: flex; gap: 8px; flex-wrap: wrap; }
.mmc-rail-group:last-child { margin-left: auto; }
.mmc-tool {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--mmc-dim); font-size: 11px; font-family: inherit;
}
.mmc-tool-icon {
  width: 50px; height: 50px; border-radius: 13px;
  background: var(--mmc-surface-2); border: 1px solid var(--mmc-line);
  display: flex; align-items: center; justify-content: center;
  transition: background .12s ease;
}
.mmc-tool:hover:not(:disabled) .mmc-tool-icon { background: var(--mmc-surface-3); }
.mmc-tool:hover:not(:disabled) { color: var(--mmc-text); }
.mmc-tool:disabled { cursor: not-allowed; color: var(--mmc-off); }
.mmc-tool:disabled .mmc-tool-icon { opacity: .45; }
.mmc-tool svg { width: 20px; height: 20px; stroke: currentColor; fill: none;
  stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.mmc-tool.active .mmc-tool-icon { background: var(--mmc-surface-3); border-color: var(--mmc-accent); color: var(--mmc-accent); }
.mmc-tool.active { color: var(--mmc-accent); }
.mmc-tool-primary .mmc-tool-icon {
  background: var(--mmc-accent);
  border-color: transparent;
  color: #141414;
}
.mmc-tool-primary:hover:not(:disabled) .mmc-tool-icon {
  background: #f5b85c;
  color: #141414;
}
.mmc-tool-primary:hover:not(:disabled) {
  color: #fff;
}

.mmc-prompt-chips-bar { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; flex-shrink: 0; }
.mmc-chip-toggle {
  display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
  padding: 4px 10px; border-radius: 12px; background: var(--mmc-surface-2);
  border: 1px solid var(--mmc-line); color: var(--mmc-dim); font-size: 11px;
  font-family: inherit; cursor: pointer; transition: all .12s ease;
}
.mmc-chip-toggle:hover { color: var(--mmc-text); background: var(--mmc-surface-3); }
.mmc-chip-toggle.on { color: var(--mmc-accent); border-color: rgba(240,166,60,.4); }
.mmc-chip-group { display: flex; flex-direction: column; gap: 4px; }
.mmc-chip-group-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--mmc-off); }
.mmc-quick-chip { font-size: 11px; padding: 3px 8px; text-align: left; }

.mmc-assets { display: flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
.mmc-asset {
  display: flex; align-items: center; gap: 6px; padding: 3px 6px 3px 3px;
  background: var(--mmc-surface-2); border: 1px solid var(--mmc-line);
  border-radius: 10px; font-size: 11.5px;
}
.mmc-asset-thumb {
  width: 28px; height: 28px; border-radius: 6px; object-fit: cover;
  background: var(--mmc-surface-3); display: flex; align-items: center; justify-content: center;
  color: var(--mmc-dim); flex: none;
  box-shadow: 0 0 0 2px var(--tag, transparent);
}
.mmc-asset-handle { color: var(--tag, var(--mmc-accent)); font-weight: 500; }
.mmc-asset-role { color: var(--mmc-dim); }
.mmc-asset-x {
  background: none; border: 0; color: var(--mmc-off); cursor: pointer;
  font-size: 14px; line-height: 1; padding: 2px 3px; font-family: inherit;
}
.mmc-asset-x:hover { color: var(--mmc-text); }
.mmc-asset.idle { opacity: .5; }
.mmc-asset.idle .mmc-asset-handle { color: var(--mmc-dim); }
.mmc-lora-block { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
.mmc-note {
  display: flex; gap: 8px; font-size: 11px; color: var(--mmc-dim); line-height: 1.4;
}
.mmc-note-key {
  color: var(--mmc-off); letter-spacing: .06em; text-transform: uppercase;
  font-size: 10px; padding-top: 1px; flex: none;
}

.mmc-panel {
  background: var(--mmc-surface); border: 1px solid var(--mmc-line);
  border-radius: 20px; padding: 12px 14px; display: flex; flex-direction: column;
  gap: 10px; flex: 1; min-height: 0; overflow: hidden; position: relative;
}
.mmc-prompt-scroll {
  flex: 1; min-height: 60px; overflow-y: auto; overflow-x: hidden;
  display: flex; flex-direction: column; gap: 10px; padding-right: 4px;
}
.mmc-prompt-scroll::-webkit-scrollbar { width: 5px; }
.mmc-prompt-scroll::-webkit-scrollbar-thumb { background: var(--mmc-surface-3); border-radius: 3px; }
.mmc-prompt-scroll::-webkit-scrollbar-thumb:hover { background: var(--mmc-dim); }

.mmc-prompt {
  min-height: 54px; max-height: 200px; resize: vertical;
  background: none; border: 0; outline: none;
  color: var(--mmc-text); font-family: inherit; font-size: 15px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word; overflow-y: auto;
}
.mmc-prompt:empty::before {
  content: attr(data-placeholder); color: #6a6a6a; pointer-events: none;
}
.mmc-prompt.superseded { opacity: .42; }
.mmc-prompt.superseded:focus { opacity: .72; }
.mmc-ref {
  display: inline-block; padding: 1px 7px; margin: 0 1px; border-radius: 7px;
  background: color-mix(in srgb, var(--tag, var(--mmc-accent)) 14%, transparent);
  color: var(--tag, var(--mmc-accent));
  font-size: .92em; white-space: nowrap; user-select: all;
}

.mmc-mention {
  position: fixed; z-index: 2000; width: 330px; max-height: 300px; overflow-y: auto;
  background: #212121; border: 1px solid var(--mmc-line); border-radius: 14px;
  padding: 6px; box-shadow: 0 20px 50px rgba(0,0,0,.65);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
}
.mmc-mention-head {
  color: #7d7d7d; font-size: 10px; letter-spacing: .09em; text-transform: uppercase;
  padding: 10px 10px 6px;
}
.mmc-mention-row {
  display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0;
  padding: 7px 8px; background: none; border: 1px solid transparent;
  border-radius: 10px; font-family: inherit; text-align: left; cursor: pointer;
  color: #ededed; overflow: hidden;
}
.mmc-mention-row[aria-selected="true"] { background: #2e2e2e; border-color: rgba(255,255,255,.13); }
.mmc-mention-thumb {
  width: 30px; height: 30px; border-radius: 7px; object-fit: cover; flex: none;
  background: #333; display: flex; align-items: center; justify-content: center;
  color: #8b8b8b; font-size: 13px;
}
.mmc-mention-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.mmc-mention-handle {
  color: var(--tag, var(--mmc-accent)); font-size: 14px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mmc-mention-sub {
  color: #7d7d7d; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mmc-mention-empty { color: #7d7d7d; font-size: 13px; padding: 14px 10px; }

.mmc-pills {
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap; flex-shrink: 0;
  padding-top: 8px; border-top: 1px solid var(--mmc-line); margin-top: auto;
}
.mmc-pill {
  display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px;
  border-radius: 17px; background: var(--mmc-surface-2); border: 1px solid var(--mmc-line);
  color: var(--mmc-text); font-size: 12px; font-family: inherit; cursor: pointer;
  white-space: nowrap; transition: background .12s ease; max-width: 100%; box-sizing: border-box;
}
.mmc-pill:hover:not(:disabled) { background: var(--mmc-surface-3); }
.mmc-pill:disabled { cursor: not-allowed; color: var(--mmc-off); }
.mmc-pill.on { border-color: var(--mmc-accent); color: var(--mmc-accent); }
.mmc-pill svg { width: 15px; height: 15px; stroke: currentColor; fill: none;
  stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.mmc-pill-sub { color: var(--mmc-dim); font-size: 10.5px; }
.mmc-pill-group { gap: 0; padding: 0 4px; }
.mmc-step {
  background: none; border: 0; color: var(--mmc-text); cursor: pointer;
  font-size: 15px; width: 24px; height: 32px; font-family: inherit;
}
.mmc-step:disabled { color: var(--mmc-off); cursor: not-allowed; }
.mmc-mode {
  margin-left: auto; font-size: 11px; letter-spacing: .04em; color: var(--mmc-dim);
  display: flex; align-items: center; gap: 5px;
  background: none; border: 1px solid transparent; border-radius: 13px;
  padding: 4px 8px; font-family: inherit;
}
button.mmc-mode { cursor: pointer; }
button.mmc-mode:hover { background: var(--mmc-surface-2); border-color: var(--mmc-line); }
.mmc-mode.pinned { border-color: var(--mmc-line); background: var(--mmc-surface-2); }
.mmc-mode b { color: var(--mmc-accent); font-weight: 600; }
.mmc-pin {
  font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--mmc-accent); border: 1px solid currentColor; border-radius: 8px;
  padding: 0 4px; opacity: .8;
}
.mmc-warn { color: #e0743c; font-size: 12px; flex-shrink: 0; }
.mmc-root { position: relative; }
.mmc-root.mmc-drag-drop-active::after {
  content: "📥 Drop media here to attach as reference";
  position: absolute; inset: 0; z-index: 1000;
  background: rgba(47, 123, 246, 0.88);
  color: #ffffff;
  font-size: 15px; font-weight: 600; font-family: inherit;
  display: flex; align-items: center; justify-content: center;
  border: 2px dashed #ffffff; border-radius: 20px;
  pointer-events: none;
  backdrop-filter: blur(4px);
  box-sizing: border-box;
}
`;