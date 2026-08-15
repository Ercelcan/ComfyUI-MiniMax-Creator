export const css = `
:root {
  --mmc-bg: #0e0e0e;
  --mmc-surface: #1c1c1c;
  --mmc-surface-2: #262626;
  --mmc-surface-3: #2f2f2f;
  --mmc-line: rgba(255,255,255,.09);
  --mmc-text: #ededed;
  --mmc-dim: #8b8b8b;
  --mmc-off: #565656;
  --mmc-accent: #f0a63c;
  --mmc-blue: #2f7bf6;
  --mmc-tag-0: #5cb8f0;
  --mmc-tag-1: #63c98e;
  --mmc-tag-2: #9d95f5;
  --mmc-tag-3: #f07da0;
  --mmc-tag-4: #45c4c0;
  --mmc-tag-5: #f0906b;
  --mmc-tag-6: #d57de8;
  --mmc-tag-7: #a8c858;
}

.mmc-tag-0 { --tag: var(--mmc-tag-0); }
.mmc-tag-1 { --tag: var(--mmc-tag-1); }
.mmc-tag-2 { --tag: var(--mmc-tag-2); }
.mmc-tag-3 { --tag: var(--mmc-tag-3); }
.mmc-tag-4 { --tag: var(--mmc-tag-4); }
.mmc-tag-5 { --tag: var(--mmc-tag-5); }
.mmc-tag-6 { --tag: var(--mmc-tag-6); }
.mmc-tag-7 { --tag: var(--mmc-tag-7); }

.mmc-root {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  color: var(--mmc-text);
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px; box-sizing: border-box;
  height: 100% !important; width: 100% !important;
  min-width: 440px !important;
  min-height: 320px !important;
  overflow: hidden;
  transition: width .15s ease, margin-right .15s ease;
}

/* When output sockets are enabled, leave the right 115px lane completely clear for canvas sockets & wire dragging */
.mmc-root.mmc-has-outputs {
  width: calc(100% - 115px) !important;
  margin-right: 115px !important;
  box-sizing: border-box !important;
}

.mmc-prestage-host { display: flex; flex-direction: column; height: 100%; min-height: 0; width: 100%; }
.mmc-prestage-host > * { flex: 1 1 auto; min-height: 0; width: 100%; }
`;