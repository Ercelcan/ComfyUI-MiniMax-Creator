// Tokens and the pre-stage root body.
// No backticks or ${} anywhere in the CSS: each chunk is one template literal.
export const css = `
/* Tokens live on :root, not .mmc-root: popovers and the picker portal to
   document.body, so anything scoped to the node body would leave them
   resolving to nothing. */
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
  /* Reference identity hues: one per attached asset, worn by its thumbnail
     ring, its handle in the bar, and its chip in the prompt, so a chip in the
     sentence can be matched to a picture without reading. Equal perceived
     lightness on the dark surfaces; the amber zone is skipped so an asset
     never masquerades as the accent. Index comes from state.tagIndex(). */
  --mmc-tag-0: #5cb8f0;
  --mmc-tag-1: #63c98e;
  --mmc-tag-2: #9d95f5;
  --mmc-tag-3: #f07da0;
  --mmc-tag-4: #45c4c0;
  --mmc-tag-5: #f0906b;
  --mmc-tag-6: #d57de8;
  --mmc-tag-7: #a8c858;
}

/* Setting --tag is all these do; components read it with an accent fallback,
   so an untagged element (a LoRA row, a dangling handle) keeps today's look. */
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
  padding: 12px; box-sizing: border-box; height: 100%; overflow: hidden;
}

/* The pre-stage's outer body. It holds whichever editor the architecture calls
   for and is swapped when that changes, so it has to be the full height the DOM
   widget gave it — the .mmc-root inside is what does the layout. */
.mmc-prestage-host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.mmc-prestage-host > * { flex: 1 1 auto; min-height: 0; }

`;
