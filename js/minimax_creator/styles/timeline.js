// Timeline, timeline node body, sampler pills.
// No backticks or ${} anywhere in the CSS: each chunk is one template literal.
export const css = `
/* --- timeline ------------------------------------------------------------- */

/* The continuation switch, on a segment's pill row. Lit when on, because a
   segment that inherits its first frame is not the default and should not
   look like it. */
.mmc-continue.on { border-color: var(--mmc-accent); color: var(--mmc-accent); }

/* Past the ~5-15 s the weights were trained on. The same warm orange the
   resolution slider uses above 768: a statement about distribution, not a
   refusal, so it marks rather than disables. */
.mmc-pill-group.off-distribution { border-color: rgba(224,116,60,.4); }
.mmc-pill-group.off-distribution > span { color: #e0743c; }
.mmc-tl-dur.off-distribution { color: #e0743c; }

.mmc-tl-modal { height: min(680px, 100%); }
.mmc-tl-body {
  display: flex; flex-direction: column; gap: 16px;
  padding: 18px 24px 24px; overflow: auto; flex: 1; min-height: 0;
}
.mmc-tl-prompt {
  width: 100%; box-sizing: border-box; min-height: 84px; resize: vertical;
  background: var(--mmc-surface); border: 1px solid var(--mmc-line); border-radius: 14px;
  color: var(--mmc-text); font-family: inherit; font-size: 14px; line-height: 1.5;
  padding: 14px 16px; outline: none;
}
.mmc-tl-prompt:focus { border-color: rgba(255,255,255,.2); }
.mmc-tl-prompt::placeholder { color: var(--mmc-off); }

/* The two Context-IR audio fields, side by side under the prompt. They wrap to
   one column when the modal is too narrow to give each a readable measure. */
.mmc-tl-audio {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px;
}
.mmc-tl-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
/* Named for the field they become, not prettified: the value goes into the
   prompt under exactly this key, and someone comparing against MiniMax's guide
   should be able to find it by the same word. */
.mmc-tl-field-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; color: var(--mmc-dim); letter-spacing: .02em;
}
.mmc-tl-small { min-height: 64px; font-size: 13px; padding: 10px 12px; }

/* The piece's reference pool: a shelf between the audio fields and the bar.
   Chips reuse the editor's asset row; what is ours here is only the head line
   and the "used in segments 2, 4" readout. */
.mmc-tl-pool { display: flex; flex-direction: column; gap: 8px; }
.mmc-tl-pool-head { display: flex; gap: 10px; align-items: center; min-width: 0; }
.mmc-tl-pool-hint {
  font-size: 11px; color: var(--mmc-off); flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mmc-tl-pool-add { display: inline-flex; gap: 5px; align-items: center; }
.mmc-tl-pool-where { font-size: 11px; color: var(--mmc-dim); white-space: nowrap; }
/* The handle is a button: clicking it writes the citation into the global
   prompt. Reset to read exactly like the editor's handle span. */
.mmc-tl-pool-cite {
  background: none; border: 0; padding: 0; font: inherit; cursor: pointer;
}
.mmc-tl-pool-cite:hover { text-decoration: underline; }

.mmc-tl-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.mmc-pill.on { border-color: rgba(255,255,255,.22); }
/* An accelerator that is doing something. Lit rather than merely outlined,
   because a render with one on is not a native render and that is worth seeing
   without reading the pill. */
.mmc-pill.accel-on { border-color: rgba(110,190,255,.45); color: #6ebeff; }
.mmc-pill.accel-on:hover:not(:disabled) { border-color: rgba(110,190,255,.7); }
/* An architecture that is not settled yet. Dashed rather than coloured: this
   says "the output may not be good", which is a different statement from the
   accelerator blue's "this render is not native". */
.mmc-pill.mmc-experimental { border-style: dashed; border-color: rgba(255,196,110,.5); }
.mmc-pill.mmc-experimental:hover:not(:disabled) { border-color: rgba(255,196,110,.8); }
/* A sweep choice inside the dev popover: the same on/off reading as the turbo
   stops, on ordinary pills because the lists are of no fixed length. */
.mmc-pill[aria-pressed="true"] { border-color: rgba(110,190,255,.45); color: #6ebeff; }
/* The turbo switch: the seed pill's shape — one pill, a big half that throws
   it and a small half that picks what it throws. Both inherit the group's
   colour so the accelerator blue lights the whole pill, chevron included. */
.mmc-turbo-main {
  display: flex; align-items: center; gap: 7px; height: 100%; padding: 0 2px 0 8px;
  background: none; border: 0; color: inherit; font-size: 13px;
  font-family: inherit; cursor: pointer; white-space: nowrap;
}
.mmc-turbo-pick {
  display: flex; align-items: center; justify-content: center; width: 22px; color: inherit;
}
/* The turbo quality stops. One pill holding three mutually exclusive answers,
   like the trim editor's track switch — three loose pills would read as
   independent toggles, and draft/med/good are one dial. Lit in the accelerator
   blue, because that is the family it belongs to. */
.mmc-pill.mmc-turbo-seg { gap: 0; padding: 0; overflow: hidden; }
.mmc-turbo-opt {
  display: flex; align-items: center; gap: 5px; height: 100%; padding: 0 12px;
  background: none; border: 0; border-left: 1px solid var(--mmc-line);
  color: var(--mmc-dim); font-size: 13px; font-family: inherit; cursor: pointer;
}
.mmc-turbo-opt:first-child { border-left: 0; }
.mmc-turbo-opt:hover { color: #ededed; }
.mmc-turbo-opt[aria-pressed="true"] { background: rgba(110,190,255,.14); color: #6ebeff; }
.mmc-turbo-opt[aria-pressed="true"] .mmc-pill-sub { color: rgba(110,190,255,.75); }
.mmc-tl-total { display: flex; gap: 8px; align-items: baseline; margin-left: auto; font-size: 13px; }
.mmc-tl-total span { color: var(--mmc-dim); }

/* Chained / one pass. A segmented control rather than two pills, because they
   are one choice with two answers and every other pill on this bar is a value
   you set independently. It leads the bar for the same reason: it is the one
   control that changes what all the others mean. */
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

/* A refusal compile.py would raise, said while the shots are still editable.
   Reads as a note rather than an alarm — the timeline is still saveable, and
   switching back to chained makes it correct again. */
.mmc-tl-problem {
  display: flex; gap: 8px; align-items: baseline;
  font-size: 11px; line-height: 1.4; color: #e0743c;
}
.mmc-tl-problem .mmc-note-key { color: inherit; opacity: .8; }

/* Laid out left to right and scrolled, not wrapped: a timeline that wraps onto
   a second line stops reading as time.
 *
 * Three rows shared by everything on it: the pass rails, the cards, and the
 * notes underneath. One grid rather than one height per column, because a rail
 * that only some columns have and a note that only one column carries used to
 * push their own cards up and down — cards ended up at three different heights
 * on the same strip. On the grid every rail sits on one line, every card top
 * and bottom on another, and a note under one pass moves nothing above it.
 * Columns are min-content so a card's set width is what sizes its column, and
 * a long note wraps into that width instead of stretching the pass to fit it.
 */
.mmc-tl-strip {
  display: grid; grid-auto-flow: column; grid-auto-columns: min-content;
  grid-template-rows: auto 1fr auto; row-gap: 6px;
  overflow-x: auto; padding-bottom: 10px; min-height: 190px;
}
/* The cards row, which is all a seam or the add button occupies: they have no
   rail above them and nothing to say underneath. */
.mmc-tl-seam, .mmc-tl-add { grid-row: 2; }
.mmc-tl-card {
  flex: 0 0 auto; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 8px;
  background: var(--mmc-surface); border: 1px solid var(--mmc-line);
  border-radius: 14px; padding: 12px; font-size: 12px; cursor: default;
}
.mmc-tl-card:hover { border-color: rgba(255,255,255,.18); }
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
/* The card keeps showing the typed sentence because that is what the shot is
   recognised by — dimmed, because it is not what the shot queues. */
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

/* The seam between two cards. It is a control, so it is wide enough to hit. */
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

/* Picture above, sound below — the two switches on one seam. Stacked rather
   than side by side so the seam stays as narrow as it was.
 *
 * The padding is the card's own — the enclosure's inset plus the card's padding
 * and head — so the switches open level with the first line of the prompt beside
 * them and the merge button sits on the row of Edit buttons. A seam carrying two
 * chips and a seam carrying four then open and close on the same two lines,
 * instead of each centring itself on a different height. */
.mmc-tl-seam {
  width: 78px; box-sizing: border-box; padding: 47px 3px 19px;
  display: flex; flex-direction: column; align-items: stretch; gap: 2px;
}
/* The join inside a pass. Not the seam's two switches, because there is no seam
   to switch: what it shows is the cut time the description will carry, and what
   clicking it does is split the pass back apart. Narrow, and without the seam's
   breathing room on either side — the cards it separates are one piece of film
   and should look it. */
.mmc-tl-cut {
  flex: 0 0 auto; align-self: stretch;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  width: 52px; padding: 0; border: 0; border-left: 1px dashed rgba(240,166,60,.32);
  background: none; color: rgba(240,166,60,.55); font-family: inherit; font-size: 9px;
  font-variant-numeric: tabular-nums; cursor: pointer;
}
.mmc-tl-cut span:first-child { font-size: 13px; }
.mmc-tl-cut:hover { color: var(--mmc-accent); border-left-color: var(--mmc-accent); }

/* --- passes --------------------------------------------------------------- */

/* Every card sits in one of these whether or not it shares it, so the cards
   line up whatever the runs look like. Only a pass holding more than one draws
   itself. It takes all three of the strip's rows and hands them straight to its
   rail, its cards and its note, so those line up across passes too. */
.mmc-tl-pass { grid-row: 1 / -1; display: grid; grid-template-rows: subgrid; }
/* Fills the enclosure so the cards inside go on stretching to the strip's
   height, which is what they did when they were its direct children. It carries
   the casing's inset and border whether or not the casing is drawn, so a card
   that shares a pass and a card that is one are the same box either way — the
   alternative was every merged card sitting 6 px shorter than its neighbours. */
.mmc-tl-pass-cards {
  display: flex; align-items: stretch; min-height: 0;
  padding: 5px; border: 1px solid transparent; border-radius: 16px;
}
/* The rail costs nothing until the strip has a pass in it — an untouched
   timeline is the strip it always was, with no empty band above the cards.
   Emptied rather than removed: it is the row every column is measured against,
   and a pass that dropped it would slide its cards up into the rail's line. */
.mmc-tl-pass-head { display: flex; height: 0; align-items: center; gap: 8px; padding: 0 4px; overflow: hidden; }
.mmc-tl-strip.has-pass .mmc-tl-pass-head { height: 20px; }

/* The casing: one generation, drawn as one piece of film. The cards inside give
   up their own borders and become panels of it. */
.mmc-tl-pass.on .mmc-tl-pass-cards {
  background: var(--mmc-surface-2); border-color: rgba(240,166,60,.32);
}
.mmc-tl-pass.on .mmc-tl-card { background: none; border-color: transparent; }
.mmc-tl-pass.on .mmc-tl-card:hover { border-color: rgba(255,255,255,.12); }
.mmc-tl-pass-name {
  display: flex; align-items: center; gap: 5px; color: var(--mmc-accent); font-size: 11px;
}
.mmc-tl-pass-name svg { width: 13px; height: 13px; stroke: currentColor; fill: none;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
/* The rail is as wide as the shots under it, which for a pass of two short ones
   is not much. The length is what gives first: the name says what the enclosure
   is and Split is the way out of it, and neither is worth losing to a number
   that is also on the bar. */
.mmc-tl-pass-name, .mmc-tl-pass-split { flex: 0 0 auto; }
.mmc-tl-pass-len {
  color: var(--mmc-dim); font-size: 11px;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mmc-tl-pass-len.off-distribution { color: #e0743c; }
.mmc-tl-pass-head .mmc-tl-mode { margin-left: 0; }
.mmc-tl-pass-split { margin-left: auto; font-size: 11px; }
/* The refusals compile.py would raise, under the pass they are about. */
.mmc-tl-pass .mmc-tl-problem { padding: 0 4px; }

/* The third answer on a seam: no seam at all. Held at the foot of the seam,
   level with the cards' own buttons, and set apart from the switches above it —
   they say how this join behaves, this says whether it is a join. */
.mmc-tl-join-merge {
  margin-top: auto; padding-top: 6px; border-top: 1px solid var(--mmc-line);
  border-radius: 0 0 8px 8px;
}
.mmc-tl-join-merge span:first-child { font-size: 12px; }
.mmc-tl-join-merge:hover:not(:disabled) { color: var(--mmc-accent); }

/* Reported, not offered: some seams merged and some not is a real state of the
   strip, but there is nothing for clicking it to do. So it is not dressed as
   the selected one of the two answers either — it wears the accent the merged
   passes below it wear, and reads as a readout wedged between them. */
.mmc-tl-render-opt.mmc-tl-render-mixed {
  cursor: default; color: var(--mmc-accent); background: rgba(240,166,60,.14);
}

.mmc-tl-join-sound { padding-top: 0; }
.mmc-tl-join-sound svg { width: 13px; height: 13px; stroke: currentColor; fill: none;
  stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

/* Where the seam inherits from — one line under the two switches, only shown
   while a seam is live and there is more than one segment to inherit from. */
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

/* The segment editor, over the strip. Its body is the Creator node's, unchanged. */
.mmc-tl-editor { width: min(880px, 100%); height: min(720px, 100%); }
.mmc-tl-editor-sub { color: var(--mmc-dim); font-size: 13px; }
.mmc-tl-editor-body { overflow: auto; flex: 1; min-height: 0; }
.mmc-tl-editor-body .mmc-root { height: auto; overflow: visible; padding: 18px 24px 24px; }

/* --- timeline node body --------------------------------------------------- */

.mmc-tl-summary { gap: 14px; flex: 1; min-height: 0; }
.mmc-tl-summary-prompt {
  font-size: 13px; line-height: 1.5; color: var(--mmc-text); cursor: text;
  flex: 1; min-height: 40px; overflow: hidden;
}
.mmc-tl-summary-prompt.empty { color: var(--mmc-off); }
/* Segments at their real relative lengths — the node's one honest picture of
   the timeline without room for the strip itself. */
.mmc-tl-lane { display: flex; gap: 4px; height: 40px; cursor: pointer; flex: 0 0 auto; }
/* A pass in the lane: its shots close ranks and share one outline, which is the
   casing's reading at a tenth the size. A pass of one is just its own tick. */
.mmc-tl-run { display: flex; gap: 4px; min-width: 0; }
.mmc-tl-run.on {
  gap: 0; border: 1px solid rgba(240,166,60,.32); border-radius: 8px; padding: 1px;
  background: rgba(240,166,60,.08);
}
.mmc-tl-run.on .mmc-tl-tick {
  background: none; border: 0; border-left: 1px dashed rgba(240,166,60,.4); border-radius: 0;
}
.mmc-tl-run.on .mmc-tl-tick:first-child { border-left: 0; }
.mmc-tl-tick {
  display: flex; align-items: center; justify-content: center; gap: 5px;
  background: var(--mmc-surface-2); border: 1px solid var(--mmc-line);
  border-radius: 8px; min-width: 18px; overflow: hidden; padding: 0 4px;
}
.mmc-tl-tick svg { width: 13px; height: 13px; stroke: currentColor; fill: none;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: 0 0 auto; }
.mmc-tl-tick-n { color: var(--mmc-text); font-size: 12px; font-weight: 500; }
.mmc-tl-tick-s { color: var(--mmc-dim); font-size: 11px; }
.mmc-tl-lane:hover .mmc-tl-tick { border-color: rgba(255,255,255,.18); }
.mmc-tl-tick.on {
  background: rgba(240,166,60,.13); border-color: rgba(240,166,60,.32); color: var(--mmc-accent);
}
.mmc-tl-tick.on .mmc-tl-tick-n { color: var(--mmc-accent); }

/* Where the Creator puts its mode badge: the right end of the pill row. */
.mmc-tl-open {
  margin-left: auto; height: 32px; padding: 0 14px; display: flex; align-items: center; gap: 8px;
  border-radius: 999px; background: var(--mmc-surface-3); border: 1px solid var(--mmc-line);
  color: var(--mmc-text); font-family: inherit; font-size: 13px; cursor: pointer;
}
.mmc-tl-open:hover { background: #3a3a3a; border-color: rgba(255,255,255,.18); }
.mmc-tl-open svg { width: 16px; height: 16px; stroke: currentColor; fill: none;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }

/* --- sampler pills -------------------------------------------------------- */

/* A pill that only reports. Same shape, no hover lift — it is not a control. */
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
/* Sampler lists are long; the popover scrolls rather than running off screen. */
.mmc-pop-scroll { max-height: 320px; overflow-y: auto; min-width: 190px; }

`;
