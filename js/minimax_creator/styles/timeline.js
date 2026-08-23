export const css = `
/* ==========================================================================
   MINIMAX H3 TIMELINE — SPLIT-SCREEN STUDIO & NLE TRACK HEADERS
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
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  color: var(--mmc-text, #ededed);
}

/* Master Top Bar */
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
  z-index: 10;
}
.mmc-nle-top-left { 
  display: flex; 
  align-items: center; 
  gap: 6px; 
  flex-wrap: wrap; 
}
.mmc-nle-top-right { 
  display: flex; 
  align-items: center; 
  gap: 6px; 
  margin-left: auto; 
}

/* Split Studio Body: Left Director Deck | Right Studio (monitor+transport+tracks) */
.mmc-nle-split-body {
  display: flex;
  gap: 10px;
  width: 100%;
  min-height: 170px;
  flex: 1 1 auto;
  box-sizing: border-box;
  position: relative;
}
.mmc-nle-split-body.collapsed .mmc-nle-left-deck { display: none; }

/* Resizable deck splitter */
.mmc-nle-deck-splitter {
  flex: 0 0 5px;
  border-radius: 3px;
  cursor: col-resize;
  background: transparent;
  transition: background .12s ease;
}
.mmc-nle-deck-splitter:hover, .mmc-nle-deck-splitter:active {
  background: var(--mmc-accent, #f0a63c);
}

/* Collapsible audio lanes */
.mmc-nle-timeline-wrapper.lanes-hidden .audio-head,
.mmc-nle-timeline-wrapper.lanes-hidden .music-head,
.mmc-nle-timeline-wrapper.lanes-hidden .mmc-nle-track-audio,
.mmc-nle-timeline-wrapper.lanes-hidden .mmc-nle-track-music { display: none; }

/* Right studio zone: monitor on top, transport + tracks below */
.mmc-nle-studio-zone {
  flex: 1 1 58%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

/* Collapsible sampling deck */
.mmc-nle-sampling {
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-radius: 12px;
  background: var(--mmc-surface, #1c1c1c);
  overflow: hidden;
}
.mmc-nle-sampling-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 12px;
  background: transparent;
  border: 0;
  color: var(--mmc-dim, #8b8b8b);
  font-size: 11px;
  letter-spacing: .06em;
  text-transform: uppercase;
  cursor: pointer;
}
.mmc-nle-sampling-toggle:hover { color: var(--mmc-text, #eee); }
.mmc-nle-sampling-caret { margin-left: auto; transition: transform .15s ease; }
.mmc-nle-sampling-caret.up { transform: rotate(90deg); }
.mmc-nle-sampling:not(.open) .mmc-nle-sampling-body { display: none; }
.mmc-nle-sampling.open .mmc-nle-sampling-body { padding: 2px 4px 6px; }

/* Left Director Workspace */
.mmc-nle-left-deck {
  flex: 1 1 42%;
  min-width: 280px;
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
.mmc-nle-left-deck::-webkit-scrollbar { width: 5px; }
.mmc-nle-left-deck::-webkit-scrollbar-thumb { background: var(--mmc-surface-3, #2f2f2f); border-radius: 3px; }

.mmc-nle-deck-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
}
.mmc-nle-deck-tabs-left {
  display: flex;
  align-items: center;
  gap: 4px;
}
.mmc-nle-deck-tabs-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mmc-nle-deck-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 8px;
  background: none;
  border: 1px solid transparent;
  color: var(--mmc-dim, #8b8b8b);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all .12s ease;
}
.mmc-nle-deck-tab:hover {
  color: var(--mmc-text, #ededed);
  background: var(--mmc-surface-2, #262626);
}
.mmc-nle-deck-tab.active {
  color: #fff;
  background: var(--mmc-surface-2, #262626);
  border-color: var(--mmc-line, rgba(255,255,255,0.12));
}

.mmc-nle-deck-action-btn {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 6px;
  background: none;
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.1));
  color: var(--mmc-dim, #8b8b8b);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all .12s ease;
}
.mmc-nle-deck-action-btn:hover {
  color: #fff;
  background: var(--mmc-surface-2, #262626);
}

.mmc-nle-deck-refine-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  background: rgba(240, 166, 60, 0.14);
  border: 1px solid rgba(240, 166, 60, 0.4);
  color: var(--mmc-accent, #f0a63c);
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all .12s ease;
}
.mmc-nle-deck-refine-btn:hover {
  background: var(--mmc-accent, #f0a63c);
  color: #141414;
}

.mmc-nle-tag {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  color: var(--mmc-accent, #f0a63c);
  letter-spacing: .08em;
  text-transform: uppercase;
}

.mmc-nle-bible-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.mmc-nle-prompt-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
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
.mmc-nle-bible-dropzone {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px dashed var(--mmc-line, rgba(255,255,255,0.2));
  color: var(--mmc-dim, #8b8b8b);
  font-size: 11px;
}

/* Shot Inspector (Integrated Left Drawer) */
.mmc-nle-inspector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.mmc-nle-inspector-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mmc-nle-inspector-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

/* Cinema Monitor Player & Single Canvas Layout */
.mmc-nle-monitor-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 160px;
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  box-shadow: inset 0 0 40px rgba(0,0,0,0.8);
}

.mmc-nle-cinema-canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: #000;
  image-rendering: -webkit-optimize-contrast;
}

/* Head-Up Display (HUD) Overlay */
.mmc-nle-hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(rgba(0,0,0,0.82), transparent);
  pointer-events: none;
  z-index: 10;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.mmc-nle-hud-left, .mmc-nle-hud-right { 
  display: flex; 
  align-items: center; 
  gap: 6px; 
}
.mmc-nle-hud-chip {
  color: #ededed;
  background: rgba(0,0,0,0.65);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.14));
  border-radius: 6px;
  padding: 2px 6px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.5);
}
.mmc-nle-hud-chip.accent { 
  color: var(--mmc-accent, #f0a63c); 
  border-color: rgba(240,166,60,0.45); 
}
.mmc-nle-hud-chip.cache-ready { 
  color: #4ade80; 
  border-color: rgba(74,222,128,0.45); 
}

.mmc-nle-monitor-tools {
  position: absolute;
  bottom: 8px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 5px;
  z-index: 10;
}
.mmc-nle-overlay-btn {
  background: rgba(0,0,0,0.72);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.18));
  border-radius: 6px;
  padding: 4px 8px;
  color: #ededed;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all .12s ease;
  backdrop-filter: blur(4px);
}
.mmc-nle-overlay-btn:hover { 
  background: rgba(45,45,45,0.95); 
  color: #fff; 
  border-color: rgba(255,255,255,0.35); 
}
.mmc-nle-overlay-btn.active { 
  color: var(--mmc-accent, #f0a63c); 
  border-color: var(--mmc-accent, #f0a63c); 
  background: rgba(240, 166, 60, 0.15); 
}

/* --- Multi-Track NLE Timeline Container with Clean Headers --- */
.mmc-nle-timeline-wrapper {
  position: relative;
  width: 100%;
  flex: 0 0 auto;
  display: flex;
  background: #121212;
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-radius: 12px;
  overflow: hidden;
  user-select: none;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}

.mmc-nle-track-headers {
  width: 90px;
  flex: 0 0 90px;
  display: flex;
  flex-direction: column;
  background: #161616;
  border-right: 1px solid var(--mmc-line, rgba(255,255,255,0.12));
  z-index: 25;
}
.mmc-nle-header-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  box-sizing: border-box;
}
.mmc-nle-header-cell.ruler-head {
  height: 24px;
  background: #1a1a1a;
  color: var(--mmc-off, #666);
  font-size: 9px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.mmc-nle-header-cell.video-head { height: 60px; }
.mmc-nle-header-cell.audio-head { height: 28px; }
.mmc-nle-header-cell.music-head { height: 28px; }

.mmc-nle-track-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.mmc-nle-track-title-row svg {
  width: 12px;
  height: 12px;
  color: var(--mmc-accent, #f0a63c);
  flex-shrink: 0;
}
.mmc-track-label {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--mmc-dim, #8b8b8b);
  white-space: nowrap;
}
.mmc-track-btns {
  display: flex;
  gap: 2px;
}
.mmc-track-btn {
  background: none;
  border: 0;
  padding: 2px;
  color: var(--mmc-off, #666);
  cursor: pointer;
  border-radius: 3px;
}
.mmc-track-btn:hover { color: #fff; background: var(--mmc-surface-3); }
.mmc-track-btn.active { color: var(--mmc-accent); }

.mmc-nle-tracks-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.mmc-nle-ruler-wrap {
  position: relative;
  width: 100%;
  height: 24px;
  background: #171717;
  border-bottom: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  cursor: pointer;
  overflow: hidden;
  touch-action: none;
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
  box-sizing: border-box;
}
.mmc-nle-tracks-viewport::-webkit-scrollbar { height: 6px; }
.mmc-nle-tracks-viewport::-webkit-scrollbar-thumb { background: var(--mmc-surface-3, #2f2f2f); border-radius: 3px; }

.mmc-nle-timeline-content {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 100%;
  box-sizing: border-box;
}

/* Playhead Scrubber Needle */
.mmc-nle-playhead-needle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: #f43f5e;
  z-index: 40;
  pointer-events: none;
  box-shadow: 0 0 8px rgba(244, 63, 94, 0.85);
}
.mmc-nle-playhead-head {
  position: absolute;
  top: 0;
  left: -5px;
  width: 12px;
  height: 11px;
  background: #f43f5e;
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  box-shadow: 0 2px 4px rgba(0,0,0,0.6);
}

.mmc-nle-track {
  position: relative;
  width: 100%;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  display: flex;
  align-items: stretch;
  box-sizing: border-box;
}

/* Video Filmstrip Track */
.mmc-nle-track-video {
  height: 60px;
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
  box-sizing: border-box;
  transition: border-color .12s ease, box-shadow .12s ease;
  min-width: 80px;
}
.mmc-nle-video-clip:hover { border-color: rgba(255,255,255,0.38); }
.mmc-nle-video-clip.selected {
  border-color: var(--mmc-accent, #f0a63c) !important;
  box-shadow: 0 0 10px rgba(240, 166, 60, 0.45);
}
.mmc-nle-video-clip.locked { 
  border-color: rgba(47, 123, 246, 0.65); 
  background: rgba(20,28,40,0.92); 
}

.mmc-nle-filmstrip-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.32;
  pointer-events: none;
}

/* Drag Handles for Trimming */
.mmc-nle-trim-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  background: rgba(255,255,255,0.12);
  cursor: ew-resize;
  z-index: 12;
  transition: background .12s ease;
}
.mmc-nle-trim-handle:hover { background: var(--mmc-accent, #f0a63c); }
.mmc-nle-trim-handle.left { left: 0; border-top-left-radius: 5px; border-bottom-left-radius: 5px; }
.mmc-nle-trim-handle.right { right: 0; border-top-right-radius: 5px; border-bottom-right-radius: 5px; }

/* Clip HUD Details — hidden until hover or selection to reduce clutter */
.mmc-nle-clip-hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 8;
  width: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 6px 3px 12px;
  pointer-events: none;
  background: linear-gradient(rgba(0,0,0,0.65), rgba(0,0,0,0));
  opacity: 0;
  transition: opacity .12s ease;
}
.mmc-nle-video-clip:hover .mmc-nle-clip-hud,
.mmc-nle-video-clip.selected .mmc-nle-clip-hud {
  opacity: 1;
}
.mmc-nle-clip-title {
  font-weight: 600;
  font-size: 11px;
  color: #fff;
  text-shadow: 0 1px 3px #000;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mmc-nle-clip-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  pointer-events: auto;
}
.mmc-nle-clip-btn {
  background: rgba(0,0,0,0.68);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.16));
  border-radius: 4px;
  padding: 2px 4px;
  font-size: 10px;
  color: var(--mmc-dim, #8b8b8b);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all .12s ease;
}
.mmc-nle-clip-btn:hover { color: #fff; background: var(--mmc-surface-3); }
.mmc-nle-clip-btn.locked { color: #5cb8f0; border-color: rgba(92,184,240,0.45); }

.mmc-nle-video-clip.narrow .mmc-nle-clip-actions { display: none; }
.mmc-nle-video-clip.narrow .mmc-nle-clip-hud { padding: 0 4px; justify-content: center; }

/* Currently-generating clip: quiet pulsing outline */
.mmc-nle-video-clip.generating {
  border-color: #2456b3;
  animation: mmc-gen-pulse 1.8s ease-in-out infinite;
}
@keyframes mmc-gen-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(47, 107, 219, 0.30); }
  50% { box-shadow: 0 0 0 3px rgba(47, 107, 219, 0.65); }
}

/* Seam Transition Nodes */
.mmc-nle-seam-connector {
  position: absolute;
  top: 50%;
  width: 18px;
  height: 42px;
  z-index: 35;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
  pointer-events: auto;
}
.mmc-nle-seam-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 18px;
  height: 40px;
  border-radius: 6px;
  background: #141414;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--mmc-dim, #8b8b8b);
  font-size: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.95);
  padding: 0;
  transition: all 0.15s ease;
}
.mmc-nle-seam-pill svg {
  width: 10px;
  height: 10px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
}
.mmc-nle-seam-pill:hover {
  filter: brightness(1.35);
  transform: scale(1.1);
  z-index: 40;
}

.mmc-nle-seam-pill.seam-blend-39 {
  border-color: #34d399;
  color: #34d399;
  background: #0d261b;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.9), 0 0 8px rgba(52, 211, 153, 0.4);
}
.mmc-nle-seam-pill.seam-av {
  border-color: #4ade80;
  color: #4ade80;
  background: #0c2a1a;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.9), 0 0 10px rgba(74, 222, 128, 0.55);
}
.mmc-nle-seam-pill.seam-blend-22 {
  border-color: #e879f9;
  color: #e879f9;
  background: #26112a;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.9), 0 0 8px rgba(232, 121, 249, 0.4);
}
.mmc-nle-seam-pill.seam-match {
  border-color: #fbbf24;
  color: #fbbf24;
  background: #2a200f;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.9), 0 0 8px rgba(251, 191, 36, 0.4);
}
.mmc-nle-seam-pill.seam-sound {
  border-color: #60a5fa;
  color: #60a5fa;
  background: #0e1e30;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.9), 0 0 8px rgba(96, 165, 250, 0.4);
}
.mmc-nle-seam-pill.seam-hard {
  border-color: #555555;
  color: #888888;
  background: #181818;
}
.mmc-seam-text {
  font-size: 7.5px;
  font-weight: 800;
  line-height: 1;
}

/* Add Shot Button */
.mmc-nle-add-shot {
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 76px;
  border-radius: 6px;
  background: none;
  border: 1px dashed var(--mmc-line, rgba(255,255,255,0.22));
  color: var(--mmc-dim, #8b8b8b);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  z-index: 5;
  transition: all .12s ease;
}
.mmc-nle-add-shot:hover { border-color: var(--mmc-accent); color: #fff; background: rgba(240, 166, 60, 0.08); }

/* Audio Lanes */
.mmc-nle-track-audio { height: 28px; background: #0b0b0b; }
.mmc-nle-audio-canvas { position: absolute; top: 0; left: 0; height: 100%; display: block; }
.mmc-nle-track-music { height: 28px; background: #090909; }
.mmc-nle-music-canvas { position: absolute; top: 0; left: 0; height: 100%; display: block; }

/* --- Rich Transition Preset Popover --- */
.mmc-transition-pop {
  width: 390px;
  max-width: 92vw;
  padding: 10px;
  background: rgba(20, 20, 20, 0.96);
  backdrop-filter: blur(16px);
  border: 1px solid var(--mmc-line, rgba(255, 255, 255, 0.12));
  border-radius: 14px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mmc-trans-opt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--mmc-surface-2, #242424);
  border: 1px solid transparent;
  color: var(--mmc-text, #ededed);
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: all 0.14s ease;
}
.mmc-trans-opt:hover {
  background: var(--mmc-surface-3, #2f2f2f);
  border-color: rgba(255, 255, 255, 0.18);
  transform: translateX(2px);
}
.mmc-trans-opt[aria-checked="true"] {
  background: rgba(240, 166, 60, 0.12);
  border-color: var(--mmc-accent, #f0a63c);
}
.mmc-trans-badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
}
.mmc-trans-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.mmc-trans-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mmc-trans-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
}
.mmc-trans-tag {
  font-size: 9.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}
.mmc-trans-desc {
  font-size: 11px;
  color: var(--mmc-dim, #8b8b8b);
  line-height: 1.4;
}

/* --- Transport Toolbar --- */
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
  z-index: 10;
}
.mmc-nle-transport-group { display: flex; align-items: center; gap: 4px; }
.mmc-nle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: 7px;
  background: var(--mmc-surface-2, #262626);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  color: var(--mmc-text, #ededed);
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  transition: all .12s ease;
  white-space: nowrap;
}
.mmc-nle-btn:hover:not(:disabled) { background: var(--mmc-surface-3); color: #fff; }
.mmc-nle-btn.active { color: var(--mmc-accent); border-color: rgba(240,166,60,0.45); }
.mmc-nle-btn.primary { background: var(--mmc-accent); color: #111; font-weight: 600; border-color: transparent; }
.mmc-nle-btn.primary:hover:not(:disabled) { background: #f5b85c; color: #000; }

.mmc-nle-timecode-box {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: #0a0a0a;
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.14));
  border-radius: 6px;
  padding: 4px 10px;
}
.mmc-nle-zoom-wrap { display: flex; align-items: center; gap: 6px; }

/* Custom zoom slider */
.mmc-nle-zoom-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 110px;
  height: 14px;
  background: transparent;
  cursor: ew-resize;
}
.mmc-nle-zoom-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--mmc-accent, #f0a63c) var(--fill, 30%), #333 var(--fill, 30%));
}
.mmc-nle-zoom-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -4px;
  border-radius: 50%;
  background: #e8e8e8;
  border: 2px solid var(--mmc-accent, #f0a63c);
  box-shadow: 0 1px 4px rgba(0,0,0,.6);
  transition: transform .1s ease, box-shadow .1s ease;
}
.mmc-nle-zoom-slider:hover::-webkit-slider-thumb { transform: scale(1.15); box-shadow: 0 0 6px rgba(240,166,60,.6); }
.mmc-nle-zoom-slider::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: #333;
}
.mmc-nle-zoom-slider::-moz-range-progress {
  height: 4px;
  border-radius: 2px;
  background: var(--mmc-accent, #f0a63c);
}
.mmc-nle-zoom-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #e8e8e8;
  border: 2px solid var(--mmc-accent, #f0a63c);
  box-shadow: 0 1px 4px rgba(0,0,0,.6);
}
.mmc-nle-zoom-readout {
  min-width: 38px;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  color: var(--mmc-dim, #8b8b8b);
  font-variant-numeric: tabular-nums;
}
`;