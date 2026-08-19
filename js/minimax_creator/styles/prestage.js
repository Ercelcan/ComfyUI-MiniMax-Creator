export const css = `
/* ---- pre-stage --------------------------------------------------------------
   The image node wears the Creator's clothes: same tokens, same pills, same
   chip vocabulary with unified PromptBox styling and parity. */

.mmc-prestage .mmc-panel {
  min-height: 160px;
}

/* The spawn pill. On, it wears the accent the continue pill wears */
.mmc-prestage-toggle.on { 
  border-color: rgba(240,166,60,.5); 
  color: var(--mmc-accent); 
}
.mmc-prestage-toggle.on:hover:not(:disabled) { 
  border-color: rgba(240,166,60,.8); 
}

/* The left-hand satellite anchors on its right edge */
.mmc-satellite-left { 
  transform-origin: 100% 0; 
}

/* Hand-off chips on a finished still */
.mmc-stage-send {
  pointer-events: auto;
  background: rgba(0,0,0,.55); 
  border: 1px solid #4a4a4a; 
  border-radius: 999px;
  padding: 3px 10px; 
  cursor: pointer; 
  font-family: inherit; 
  font-size: 11.5px;
  color: #ededed;
  transition: all .12s ease;
}
.mmc-stage-send:hover { 
  border-color: var(--mmc-accent); 
  color: var(--mmc-accent); 
  background: rgba(0,0,0,.85);
}

.mmc-stage-send-queue {
  pointer-events: auto;
  background: var(--mmc-accent, #f0a63c); 
  border: 1px solid transparent; 
  border-radius: 999px;
  padding: 3px 12px; 
  cursor: pointer; 
  font-family: inherit; 
  font-size: 11.5px;
  font-weight: 600;
  color: #111;
  transition: all .12s ease;
}
.mmc-stage-send-queue:hover { 
  background: #f5b85c;
  color: #000;
}

/* ---- the frame grab --------------------------------------------------------- */
.mmc-grab-card {
  display: flex; 
  flex-direction: column; 
  gap: 14px;
  width: min(720px, 92vw); 
  padding: 20px 24px;
  background: var(--mmc-bg); 
  border: 1px solid var(--mmc-line); 
  border-radius: 18px;
  box-shadow: 0 24px 64px rgba(0,0,0,.55);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  color: var(--mmc-text); 
  font-size: 13px;
}
.mmc-grab-title { 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  font-size: 14px; 
}
.mmc-grab-title svg { 
  stroke: currentColor; 
  fill: none; 
  stroke-width: 1.6; 
}
.mmc-grab-stage {
  width: 100%; 
  max-height: 46vh; 
  object-fit: contain;
  background: #000; 
  border-radius: 12px;
}
.mmc-grab-row { 
  display: flex; 
  align-items: center; 
  gap: 10px; 
}
.mmc-grab-scrub { 
  flex: 1; 
}
.mmc-grab-time { 
  min-width: 64px; 
  text-align: right; 
  color: var(--mmc-dim); 
  font-variant-numeric: tabular-nums; 
}
.mmc-grab-actions { 
  display: flex; 
  justify-content: flex-end; 
  gap: 12px; 
}
.mmc-grab-actions .mmc-btn {
  padding: 8px 18px; 
  border-radius: 999px; 
  cursor: pointer; 
  font-family: inherit;
  font-size: 13px; 
  background: var(--mmc-surface-2); 
  color: var(--mmc-text);
  border: 1px solid var(--mmc-line);
  transition: all .12s ease;
}
.mmc-grab-actions .mmc-btn:hover:not(:disabled) { 
  border-color: rgba(255,255,255,.25); 
}
.mmc-grab-actions .mmc-btn-primary { 
  background: var(--mmc-accent); 
  color: #141414; 
  border-color: transparent; 
  font-weight: 600;
}
.mmc-grab-actions .mmc-btn:disabled { 
  opacity: .5; 
  cursor: progress; 
}
`;