export const css = `
/* ==========================================================================
   MINIMAX H3 AI DIRECTOR / COPILOT STYLING
   ========================================================================== */

.mmc-director-root {
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

.mmc-director-header {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--mmc-surface, #1c1c1c);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-radius: 12px;
  padding: 6px 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.mmc-director-notice {
  padding: 6px 10px;
  background: rgba(74, 222, 128, 0.12);
  border: 1px solid rgba(74, 222, 128, 0.35);
  border-radius: 8px;
  color: #4ade80;
  font-size: 11.5px;
  font-weight: 500;
  flex-shrink: 0;
}
.mmc-director-notice.error {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.mmc-director-chat-stream {
  flex: 1 1 auto;
  min-height: 140px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 6px;
  box-sizing: border-box;
}
.mmc-director-chat-stream::-webkit-scrollbar { width: 5px; }
.mmc-director-chat-stream::-webkit-scrollbar-thumb { background: var(--mmc-surface-3, #2f2f2f); border-radius: 3px; }

.mmc-director-msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 96%;
  box-sizing: border-box;
}
.mmc-director-msg.user {
  align-self: flex-end;
  background: var(--mmc-surface-2, #262626);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.12));
  border-radius: 12px 12px 2px 12px;
  padding: 10px 14px;
}
.mmc-director-msg.assistant {
  align-self: flex-start;
  background: rgba(22, 22, 22, 0.95);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-radius: 12px 12px 12px 2px;
  padding: 12px 14px;
  width: 100%;
}

.mmc-director-user-text {
  font-size: 13px;
  line-height: 1.55;
  color: #fff;
  white-space: pre-wrap;
  word-break: break-word;
}

.mmc-director-thought-fold {
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 11.5px;
  margin-bottom: 6px;
}
.mmc-director-thought-fold summary {
  cursor: pointer;
  color: var(--mmc-accent, #f0a63c);
  font-weight: 500;
  user-select: none;
}
.mmc-director-thought-text {
  padding: 6px 4px 2px;
  color: var(--mmc-dim, #8b8b8b);
  font-size: 11.5px;
  line-height: 1.5;
  max-height: 140px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.mmc-director-content-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.mmc-director-prose {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--mmc-text, #ededed);
}
.mmc-director-h2 {
  font-size: 14.5px;
  font-weight: 700;
  color: #fff;
  margin: 6px 0 2px;
}
.mmc-director-h3 {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--mmc-accent, #f0a63c);
  margin: 6px 0 2px;
}
.mmc-director-p {
  margin: 0;
  line-height: 1.6;
}
.mmc-director-list {
  margin: 0 0 4px;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mmc-director-list li {
  line-height: 1.55;
}

/* Interactive Storyboard Proposal Card */
.mmc-director-storyboard-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(14, 14, 14, 0.95);
  border: 1px solid rgba(240, 166, 60, 0.45);
  border-radius: 12px;
  padding: 12px 14px;
  margin: 8px 0;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.6);
}
.mmc-director-storyboard-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.mmc-director-storyboard-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--mmc-accent, #f0a63c);
  font-size: 13px;
}
.mmc-director-push-btn {
  font-size: 11.5px;
  font-weight: 600;
  padding: 5px 14px;
  background: var(--mmc-accent, #f0a63c);
  color: #111;
  border-radius: 6px;
}
.mmc-director-push-btn:hover {
  background: #f5b85c;
  color: #000;
}
.mmc-director-storyboard-shots {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mmc-director-storyboard-shot-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--mmc-surface-2, #262626);
  font-size: 11.5px;
}
.mmc-director-shot-idx {
  font-weight: 700;
  color: #fff;
  min-width: 44px;
}
.mmc-director-shot-dur {
  color: var(--mmc-accent, #f0a63c);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  min-width: 36px;
}
.mmc-director-shot-trans {
  color: #38bdf8;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.12);
  min-width: 34px;
  text-align: center;
}
.mmc-director-shot-snippet {
  color: var(--mmc-dim, #8b8b8b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.mmc-director-shot-inject-btn {
  font-size: 10px;
  padding: 2px 8px;
  flex-shrink: 0;
}
.mmc-director-shot-inject-btn:hover {
  color: var(--mmc-accent, #f0a63c);
  border-color: var(--mmc-accent, #f0a63c);
}

.mmc-director-json-block {
  background: #090909;
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.12));
  border-radius: 8px;
  padding: 10px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.45;
  color: #38bdf8;
  max-height: 220px;
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.mmc-director-personas-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  padding: 2px 0;
  flex-shrink: 0;
}
.mmc-director-persona-chip {
  font-size: 10.5px;
  padding: 3px 8px;
  border-color: rgba(240, 166, 60, 0.3);
  color: var(--mmc-accent, #f0a63c);
  white-space: nowrap;
}
.mmc-director-persona-chip:hover {
  background: var(--mmc-accent, #f0a63c);
  color: #111;
}

.mmc-director-quick-chips {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  padding: 2px 0;
  flex-shrink: 0;
}
.mmc-director-quick-chips .mmc-chip {
  font-size: 10.5px;
  padding: 3px 8px;
  white-space: nowrap;
}

.mmc-director-input-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--mmc-surface, #1c1c1c);
  border: 1px solid var(--mmc-line, rgba(255,255,255,0.09));
  border-radius: 12px;
  padding: 8px 10px;
  flex-shrink: 0;
}
.mmc-director-input-box {
  flex: 1 1 auto;
  background: none;
  border: 0;
  outline: none;
  color: var(--mmc-text, #ededed);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  max-height: 90px;
  min-height: 38px;
  padding: 0;
  box-sizing: border-box;
}
.mmc-director-input-box::placeholder {
  color: var(--mmc-off, #666);
}

.mmc-director-mention-menu {
  position: fixed;
  z-index: 2500;
  width: 280px;
  max-height: 220px;
  overflow-y: auto;
}
`;