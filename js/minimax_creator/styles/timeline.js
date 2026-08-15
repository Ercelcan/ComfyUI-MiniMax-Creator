export const css = `
/* ==========================================================================
   MINIMAX H3 TIMELINE — PRO SPLIT-SCREEN NLE TIMELINE STUDIO STYLING
   ========================================================================== */

.mmc-nle-studio {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
  background: var(--mmc-bg, #0e0e0e);
}

/* Master Director Top Bar */
.mmc-nle-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--mmc-surface, #1c1c1c);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-radius: 12px;
  padding: 6px 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.mmc-nle-top-left { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mmc-nle-top-right { display: flex; align-items: center; gap: 6px; margin-left: auto; }

/* Split Studio Body: Left Director Deck (45%) | Right Cinema Player (55%) */
.mmc-nle-split-body {
  display: flex;
  gap: 10px;
  width: 100%;
  min-height: 150px;
  max-height: 42vh;
  flex: 1 1 auto;
  box-sizing: border-box;
}

/* Left Director Workspace */
.mmc-nle-left-deck {
  flex: 1 1 45%;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--mmc-surface, #1c1c1c);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-radius: 12px;
  padding: 10px 12px;
  overflow-y: auto;
  box-sizing: border-box;
}

.mmc-nle-tag {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  color: var(--mmc-accent, #f0a63c);
  letter-spacing: .08em;
  text-transform: uppercase;
}

.mmc-nle-prompt-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}
.mmc-nle-prompt-wrap .mmc-prompt {
  min-height: 46px;
  max-height: 90px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.45;
  background: rgba(0,0,0,0.35);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-radius: 8px;
}

.mmc-nle-piece-bible {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255,255,255,0.05);
}
.mmc-nle-bible-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.mmc-nle-bible-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* Cinema Monitor Player & Dual A/B Deck Layering */
.mmc-nle-monitor-wrap {
  position: relative;
  flex: 1 1 55%;
  min-width: 280px;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.mmc-nle-monitor-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: #000;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.08s ease-in-out;
}
.mmc-nle-monitor-video.active-deck {
  opacity: 1;
  pointer-events: auto;
  z-index: 2;
}

.mmc-nle-monitor-fallback {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #0d0d0d;
  color: var(--mmc-dim, #8b8b8b);
  z-index: 1;
}
.mmc-nle-fallback-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.mmc-nle-fallback-txt {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: .04em;
  color: var(--mmc-off, #565656);
}

.mmc-nle-hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(rgba(0,0,0,0.78), transparent);
  pointer-events: none;
  z-index: 10;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.mmc-nle-hud-left, .mmc-nle-hud-right { display: flex; align-items: center; gap: 8px; }
.mmc-nle-hud-chip {
  color: #ededed;
  background: rgba(0,0,0,0.55);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.12));
  border-radius: 6px;
  padding: 1px 6px;
}
.mmc-nle-hud-chip.accent { color: var(--mmc-accent, #f0a63c); border-color: rgba(240,166,60,0.4); }
.mmc-nle-hud-chip.cache-ready { color: #4ade80; border-color: rgba(74,222,128,0.4); }

.mmc-nle-monitor-tools {
  position: absolute;
  bottom: 6px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  z-index: 10;
}
.mmc-nle-overlay-btn {
  background: rgba(0,0,0,0.65);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.15));
  border-radius: 6px;
  padding: 3px 7px;
  color: #ededed;
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mmc-nle-overlay-btn:hover { background: rgba(35,35,35,0.9); color: #fff; }
.mmc-nle-overlay-btn.active { color: var(--mmc-accent); border-color: var(--mmc-accent); }

/* --- 5-Track NLE Timeline Viewport --- */
.mmc-nle-tracks-container {
  position: relative;
  width: 100%;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  background: #121212;
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-radius: 12px;
  overflow: hidden;
  user-select: none;
}

.mmc-nle-ruler-wrap {
  position: relative;
  width: 100%;
  height: 22px;
  background: #181818;
  border-bottom: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  cursor: pointer;
  overflow: hidden;
}
.mmc-nle-ruler-canvas {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  display: block;
}

.mmc-nle-tracks-viewport {
  position: relative;
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}

.mmc-nle-timeline-content {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 100%;
}

.mmc-nle-playhead-needle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: #f43f5e;
  z-index: 40;
  pointer-events: none;
  box-shadow: 0 0 6px rgba(244, 63, 94, 0.7);
}
.mmc-nle-playhead-head {
  position: absolute;
  top: 0;
  left: -5px;
  width: 12px;
  height: 10px;
  background: #f43f5e;
  clip-path: polygon(0 0, 100% 0, 50% 100%);
}

.mmc-nle-track {
  position: relative;
  width: 100%;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  display: flex;
  align-items: stretch;
}

/* Lane 1: Prompt Track */
.mmc-nle-track-prompt {
  height: 26px;
  background: #141414;
}
.mmc-nle-prompt-clip {
  position: absolute;
  top: 2px;
  bottom: 2px;
  border-radius: 5px;
  background: rgba(240, 166, 60, 0.16);
  border: 1px solid rgba(240, 166, 60, 0.35);
  color: #ededed;
  font-size: 11px;
  padding: 2px 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 4;
}
.mmc-nle-prompt-clip:hover { background: rgba(240, 166, 60, 0.28); border-color: var(--mmc-accent); }
.mmc-nle-prompt-clip.is-refined {
  background: rgba(240, 166, 60, 0.24);
  border-color: var(--mmc-accent);
  color: #fff;
  font-weight: 500;
}
.mmc-nle-prompt-badge {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--mmc-accent);
  color: #111;
  font-weight: 700;
  letter-spacing: .04em;
  flex: none;
}

/* Lane 2: Video Filmstrip & Seams Track */
.mmc-nle-track-video {
  height: 54px;
  background: #0f0f0f;
}
.mmc-nle-video-clip {
  position: absolute;
  top: 2px;
  bottom: 2px;
  border-radius: 6px;
  background: #1e1e1e;
  border: 1px solid rgba(255,255,255,0.15);
  overflow: hidden;
  cursor: pointer;
  display: flex;
  align-items: stretch;
  z-index: 5;
  transition: border-color .12s ease;
}
.mmc-nle-video-clip:hover { border-color: rgba(255,255,255,0.35); }
.mmc-nle-video-clip.locked { border-color: rgba(47, 123, 246, 0.55); background: rgba(20,28,40,0.9); }
.mmc-nle-video-clip.generating {
  border-color: #22c55e !important;
  box-shadow: 0 0 12px rgba(34, 197, 94, 0.65);
}

.mmc-nle-filmstrip-row {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  opacity: 0.45;
  pointer-events: none;
  overflow: hidden;
}
.mmc-nle-filmstrip-frame {
  height: 100%;
  aspect-ratio: 16/9;
  object-fit: cover;
  flex: none;
  border-right: 1px solid rgba(0,0,0,0.5);
}

.mmc-nle-trim-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  background: rgba(255,255,255,0.12);
  cursor: ew-resize;
  z-index: 10;
}
.mmc-nle-trim-handle:hover { background: var(--mmc-accent); }
.mmc-nle-trim-handle.left { left: 0; border-top-left-radius: 5px; border-bottom-left-radius: 5px; }
.mmc-nle-trim-handle.right { right: 0; border-top-right-radius: 5px; border-bottom-right-radius: 5px; }

/* Clip HUD */
.mmc-nle-clip-hud {
  position: relative;
  z-index: 8;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 0 24px;
  pointer-events: none;
}
.mmc-nle-clip-hud.first-shot {
  padding-left: 8px;
}
.mmc-nle-clip-title {
  font-weight: 600;
  font-size: 11px;
  color: #fff;
  text-shadow: 0 1px 2px #000;
  white-space: nowrap;
}
.mmc-nle-clip-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  pointer-events: auto;
}
.mmc-nle-clip-btn {
  background: rgba(0,0,0,0.65);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.15));
  border-radius: 4px;
  padding: 2px 4px;
  font-size: 10px;
  color: var(--mmc-dim, #8b8b8b);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.mmc-nle-clip-btn:hover { color: #fff; background: var(--mmc-surface-3, #2f2f2f); }
.mmc-nle-clip-btn.locked { color: #5cb8f0; }

/* Dedicated Vertical Seam Junction between clips with Distinct Visual Badges */
.mmc-nle-seam-junction {
  position: absolute;
  top: 50%;
  width: 18px;
  height: 42px;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
}
.mmc-nle-seam-vertical-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 18px;
  height: 38px;
  border-radius: 5px;
  background: #181818;
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.25));
  color: var(--mmc-dim, #8b8b8b);
  font-size: 8.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.8);
  padding: 0;
  transition: all .12s ease;
}
.mmc-nle-seam-vertical-pill:hover {
  filter: brightness(1.25);
}

/* Distinct Seam Types */
.mmc-nle-seam-vertical-pill.seam-hard {
  border-color: #555;
  color: #888;
  background: #141414;
}
.mmc-nle-seam-vertical-pill.seam-sound {
  border-color: #2f7bf6;
  color: #5cb8f0;
  background: rgba(47, 123, 246, 0.22);
}
.mmc-nle-seam-vertical-pill.seam-match {
  border-color: #f0a63c;
  color: #f0a63c;
  background: rgba(240, 166, 60, 0.18);
}
.mmc-nle-seam-vertical-pill.seam-blend-22 {
  border-color: #d57de8;
  color: #d57de8;
  background: rgba(213, 125, 232, 0.22);
}
.mmc-nle-seam-vertical-pill.seam-blend-39 {
  border-color: #63c98e;
  color: #63c98e;
  background: rgba(99, 201, 142, 0.22);
}

.mmc-seam-icon {
  font-size: 11px;
  line-height: 1;
}
.mmc-seam-text {
  font-size: 7.5px;
  font-weight: 700;
  line-height: 1;
}

/* Add Shot Button at end of strip */
.mmc-nle-add-shot {
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 70px;
  border-radius: 6px;
  background: none;
  border: 1px dashed var(--mmc-line, rgba(255,255,255,0.2));
  color: var(--mmc-dim, #8b8b8b);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  z-index: 5;
}
.mmc-nle-add-shot:hover { border-color: var(--mmc-accent); color: #fff; }

/* Lane 3: Audio / Soundscape Track */
.mmc-nle-track-audio {
  height: 24px;
  background: #0b0b0b;
}
.mmc-nle-audio-canvas {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  display: block;
}
.mmc-nle-lane-text-block {
  position: absolute;
  top: 2px;
  bottom: 2px;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
  color: #f0a63c;
  background: rgba(0,0,0,0.65);
  border: 1px solid rgba(240,166,60,0.3);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
  z-index: 2;
}

/* Lane 4: Non-Diegetic Music Track */
.mmc-nle-track-music {
  height: 20px;
  background: #090909;
}
.mmc-nle-music-canvas {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  display: block;
}
.mmc-nle-lane-music-block {
  position: absolute;
  top: 2px;
  bottom: 2px;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
  color: #5cb8f0;
  background: rgba(0,0,0,0.65);
  border: 1px solid rgba(92,184,240,0.3);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
  z-index: 2;
}

/* --- Transport & NLE Toolbar --- */
.mmc-nle-transport-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--mmc-surface, #1c1c1c);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-radius: 12px;
  padding: 6px 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.mmc-nle-transport-group { display: flex; align-items: center; gap: 4px; }

.mmc-nle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border-radius: 7px;
  background: var(--mmc-surface-2, #262626);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  color: var(--mmc-text, #ededed);
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  transition: all .12s ease;
}
.mmc-nle-btn:hover:not(:disabled) { background: var(--mmc-surface-3, #2f2f2f); color: #fff; }
.mmc-nle-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.mmc-nle-btn.active { color: var(--mmc-accent); border-color: rgba(240,166,60,0.4); }
.mmc-nle-btn.primary { background: var(--mmc-accent); color: #111; font-weight: 600; border-color: transparent; }
.mmc-nle-btn.primary:hover:not(:disabled) { background: #f5b85c; }

.mmc-nle-timecode-box {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: #0a0a0a;
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.12));
  border-radius: 6px;
  padding: 3px 8px;
  letter-spacing: 0.04em;
}

.mmc-nle-zoom-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}
.mmc-nle-zoom-slider {
  width: 70px;
  accent-color: var(--mmc-accent);
}

/* --- Sampling Row & Weights Pills --- */
.mmc-nle-studio .mmc-pills {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
  padding: 6px 0 2px;
  border-top: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  margin-top: 2px;
}
`;