import { el, icon, floatAbove, dismissable, placeNear } from "./dom.js";
import { t } from "./i18n.js";
import { listAssets, viewUrl } from "./api.js";
import { tagIndex } from "./state.js";

const TRIGGER = /@([\w-]*)$/;
const MAX_SUGGESTIONS = 40;
const MAX_HISTORY = 15;

export const QUICK_CHIPS = [
  { group: "Camera Motion", items: [
    "The camera pushes in with small amplitude at slow speed",
    "The camera pulls out with small amplitude at slow speed",
    "The camera pans left with large amplitude",
    "The camera pans right with large amplitude",
    "The camera tilts up at slow speed",
    "The camera tilts down at slow speed",
    "The camera holds a static shot",
    "Tracking shot following the motion",
    "Arc shot circling the subject",
    "POV shot from the character's perspective",
  ]},
  { group: "Framing", items: [
    "Wide shot establishing the scene",
    "Medium shot framing the character from the waist up",
    "Close-up shot focusing on the details",
    "Extreme close-up shot",
  ]},
  { group: "Style & Lighting", items: [
    "Cinematic film shot on 35mm anamorphic lens",
    "1980s retro VHS aesthetic with fine grain",
    "Bioluminescent neon lighting in dark atmosphere",
    "Soft warm golden hour lighting",
  ]},
];

function diffWords(oldText, newText) {
  const oldWords = (oldText || "").trim().split(/\s+/).filter(Boolean);
  const newWords = (newText || "").trim().split(/\s+/).filter(Boolean);
  const result = [];

  let i = 0, j = 0;
  while (i < oldWords.length || j < newWords.length) {
    if (i < oldWords.length && j < newWords.length && oldWords[i] === newWords[j]) {
      result.push({ type: "same", text: newWords[j] });
      i++; j++;
    } else if (j < newWords.length && (!oldWords.includes(newWords[j]) || oldWords.indexOf(newWords[j]) < i)) {
      result.push({ type: "add", text: newWords[j] });
      j++;
    } else if (i < oldWords.length) {
      result.push({ type: "del", text: oldWords[i] });
      i++;
    } else {
      result.push({ type: "add", text: newWords[j] });
      j++;
    }
  }
  return result;
}

function extractStructuredText(elNode) {
  let text = "";
  for (const node of elNode.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue;
    } else if (node.dataset?.handle) {
      text += `@${node.dataset.handle}`;
    } else if (node.tagName === "BR") {
      text += "\n";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const isBlock = /^(DIV|P|LI|TR|BLOCKQUOTE)$/i.test(node.tagName);
      if (isBlock && text.length > 0 && !text.endsWith("\n")) {
        text += "\n";
      }
      text += extractStructuredText(node);
      if (isBlock && !text.endsWith("\n")) {
        text += "\n";
      }
    }
  }
  return text;
}

export class PromptBox {
  constructor(hooks) {
    this.hooks = hooks;
    this.menu = null;
    this.showChips = false;
    this.historyDebounce = null;

    this.root = el("div", {
      class: "mmc-prompt",
      contenteditable: "true",
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
      autocomplete: "off",
      role: "textbox",
      "aria-multiline": "true",
      "data-placeholder": t("Describe your video or still image with structured details...\n• Subject & Wardrobe:\n• Environment & Lighting:\n• Camera & Action:"),
    });

    this.wordCountEl = el("span", { class: "mmc-prompt-wordcount", text: "0 words" });
    this.linterBar = el("div", { class: "mmc-linter-bar" });
    this.chipsBar = el("div", { class: "mmc-prompt-chips-bar" });

    this.root.addEventListener("input", () => {
      this.onEdit();
      this.updateWordCount();
      this.recordHistoryDebounced();
      this.runLinter();
    });
    this.root.addEventListener("keydown", (event) => this.onKeyDown(event), true);
    this.root.addEventListener("paste", (event) => this.onPaste(event));
    this.root.addEventListener("blur", () => setTimeout(() => this.closeMenu(), 150));
    this.root.addEventListener("contextmenu", (event) => {
      const chipEl = event.target.closest?.(".mmc-ref[data-handle]");
      if (!chipEl) return;
      event.preventDefault();
      event.stopPropagation();
      this.openChipMenu(chipEl.dataset.handle, chipEl);
    });

    for (const name of ["keyup", "keydown", "copy", "cut", "paste", "pointerdown", "pointerup", "wheel"]) {
      this.root.addEventListener(name, (event) => event.stopPropagation());
    }

    this.renderChipsBar();
    this.runLinter();
  }

  get syntaxMode() {
    try {
      return localStorage.getItem("mmc-syntax-mode") || "media";
    } catch {
      return "media";
    }
  }

  get linterEnabled() {
    try {
      return localStorage.getItem("mmc-linter-enabled") !== "false";
    } catch {
      return true;
    }
  }

  getHistoryKey() {
    const id = this.hooks.getState?.()?.nodeId || "default";
    return `mmc-prompt-history-${id}`;
  }

  getHistory() {
    try {
      return JSON.parse(localStorage.getItem(this.getHistoryKey()) || "[]");
    } catch {
      return [];
    }
  }

  recordHistoryDebounced() {
    clearTimeout(this.historyDebounce);
    this.historyDebounce = setTimeout(() => {
      this.saveSnapshot("Edit");
    }, 1000);
  }

  saveSnapshot(label = "Edit") {
    const text = this.getValue().trim();
    if (!text || text.length < 5) return;
    const history = this.getHistory();
    if (history.length && history[0].text.trim() === text) return;
    if (history.length && Date.now() - history[0].timestamp < 5000 && Math.abs(history[0].text.length - text.length) < 4) return;

    const entry = { text, timestamp: Date.now(), label };
    history.unshift(entry);
    try {
      localStorage.setItem(this.getHistoryKey(), JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch {}
  }

  clearHistory() {
    try {
      localStorage.removeItem(this.getHistoryKey());
    } catch {}
  }

  openHistoryModal(anchor) {
    const current = this.getValue();
    const pop = el("div", { class: "mmc-pop mmc-history-pop" });

    const render = () => {
      const hist = this.getHistory();
      if (!hist.length) {
        pop.replaceChildren(
          el("div", { class: "mmc-history-header" }, [
            el("span", { class: "mmc-pop-title", style: { padding: 0 }, text: t("Prompt History") }),
          ]),
          el("div", { class: "mmc-refine-hint", style: { padding: "14px 4px", textAlign: "center" }, text: t("No previous prompt snapshots yet.") })
        );
        return;
      }

      const header = el("div", { class: "mmc-history-header" }, [
        el("span", { class: "mmc-pop-title", style: { padding: 0 }, text: t("Prompt History & Diff") }),
        el("button", {
          class: "mmc-ghost mmc-history-clear-btn",
          text: t("🗑 Clear history"),
          title: t("Clear all saved snapshots"),
          onclick: () => {
            this.clearHistory();
            render();
          },
        }),
      ]);

      const list = el("div", { class: "mmc-history-list" });
      for (const item of hist) {
        const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const words = (item.text || "").trim().split(/\s+/).filter(Boolean).length;

        const row = el("div", { class: "mmc-history-item" }, [
          el("div", { class: "mmc-history-item-head" }, [
            el("span", { class: "mmc-history-time", text: timeStr }),
            el("span", { class: "mmc-history-label", text: `· ${item.label || "Edit"}` }),
            el("span", { class: "mmc-history-count", text: `${words} ${words === 1 ? "word" : "words"}` }),
            el("button", {
              class: "mmc-ghost mmc-history-restore-btn",
              text: t("Restore"),
              onclick: () => {
                this.setValue(item.text);
                this.hooks.onInput(item.text);
                close();
              },
            }),
          ]),
          el("div", { class: "mmc-history-diff" }, diffWords(item.text, current).map((part) =>
            el("span", {
              class: part.type === "add" ? "mmc-diff-add" : part.type === "del" ? "mmc-diff-del" : "mmc-diff-same",
              text: `${part.text} `,
            })
          )),
        ]);
        list.appendChild(row);
      }

      pop.replaceChildren(header, list);
    };

    render();
    document.body.appendChild(pop);
    placeNear(pop, anchor);
    const close = dismissable(pop);
  }

  insertStructureTemplate() {
    const current = this.getValue().trim();
    if (!current) {
      const template = "• Subject:\n• Wardrobe & Appearance:\n• Environment & Lighting:\n• Camera & Action:\n";
      this.setValue(template);
      this.hooks.onInput(template);
    } else {
      const formatted = `• Scene Description:\n${current}\n\n• Camera Motion:\n\n• Lighting & Style:\n`;
      this.setValue(formatted);
      this.hooks.onInput(formatted);
    }
    this.updateWordCount();
    this.runLinter();
    this.root.focus();
  }

  runLinter() {
    if (!this.linterEnabled) {
      this.linterBar.replaceChildren();
      return;
    }

    const text = this.getValue();
    const state = this.hooks.getState?.() ?? {};
    const attached = new Set([
      ...(state.assets ?? []).map((a) => a.handle),
      ...(this.hooks.getPool?.() ?? []).map((a) => a.handle),
    ]);

    const warnings = [];

    const mentioned = [...new Set(Array.from(text.matchAll(/@([A-Za-z]+-?\d+)/g), (m) => m[1]))];
    const missing = mentioned.filter((h) => !attached.has(h));
    if (missing.length) {
      warnings.push({
        text: t("Mentions @{handles} which are not attached.", { handles: missing.join(", @") }),
        type: "warn",
      });
    }

    const dialogueMatches = Array.from(text.matchAll(/<d>(?:\[\w+\])?\s*([\s\S]*?)\s*<\/d>/g), (m) => m[1]);
    if (dialogueMatches.length) {
      const dialogueWords = dialogueMatches.join(" ").split(/\s+/).filter(Boolean).length;
      const duration = Number(state.duration_s || 6);
      const rate = dialogueWords / Math.max(1, duration);
      if (rate > 3.8) {
        warnings.push({
          text: t("Dialogue is {words} words for a {sec}s shot (~{rate} words/sec) — may exceed duration.", {
            words: dialogueWords, sec: duration, rate: rate.toFixed(1),
          }),
          type: "warn",
        });
      }
    }

    if (!warnings.length) {
      this.linterBar.replaceChildren();
      return;
    }

    this.linterBar.replaceChildren(...warnings.map((w) =>
      el("div", { class: `mmc-lint-item ${w.type}` }, [
        el("span", { class: "mmc-lint-dot" }),
        el("span", { text: w.text }),
      ])
    ));
  }

  updateWordCount() {
    const text = this.getValue().trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const chars = text.length;
    this.wordCountEl.textContent = words ? `${words} words · ${chars} chars` : "";
  }

  renderChipsBar() {
    const toggleBtn = el("button", {
      class: `mmc-chip-toggle${this.showChips ? " on" : ""}`,
      title: t("Toggle camera, framing and style quick chips"),
      onclick: (e) => {
        e.stopPropagation();
        this.showChips = !this.showChips;
        this.renderChipsBar();
      },
      onpointerdown: (e) => e.stopPropagation(),
    }, [icon("camera", 14), el("span", { text: t("Camera & Style") })]);

    const structureBtn = el("button", {
      class: "mmc-ghost mmc-prompt-tool-btn",
      text: t("📄 Structure"),
      title: t("Insert structured bullet template into prompt"),
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => {
        e.stopPropagation();
        this.insertStructureTemplate();
      },
    });

    const historyBtn = el("button", {
      class: "mmc-ghost mmc-prompt-tool-btn",
      text: t("🕒 History"),
      title: t("Open prompt snapshot history & diff comparison"),
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => {
        e.stopPropagation();
        this.openHistoryModal(e.currentTarget);
      },
    });

    const copyBtn = el("button", {
      class: "mmc-ghost mmc-prompt-tool-btn",
      text: t("📋 Copy"),
      title: t("Copy prompt text to clipboard"),
      onpointerdown: (e) => e.stopPropagation(),
      onclick: async (e) => {
        e.stopPropagation();
        const text = this.getValue().trim();
        if (text) {
          await navigator.clipboard?.writeText(text);
          copyBtn.textContent = t("✓ Copied");
          setTimeout(() => { copyBtn.textContent = t("📋 Copy"); }, 1500);
        }
      },
    });

    const clearBtn = el("button", {
      class: "mmc-ghost mmc-prompt-tool-btn",
      text: t("✕ Clear"),
      title: t("Clear prompt text"),
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => {
        e.stopPropagation();
        this.setValue("");
        this.hooks.onInput("");
        this.updateWordCount();
        this.runLinter();
      },
    });

    const helpBtn = el("button", {
      class: "mmc-ghost mmc-prompt-tool-btn",
      text: t("? Shortcuts"),
      title: t("Keyboard shortcuts"),
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => {
        e.stopPropagation();
        this.openHelpPopover(helpBtn);
      },
    });

    const topBar = el("div", { class: "mmc-prompt-top-row" }, [
      toggleBtn,
      structureBtn,
      historyBtn,
      el("span", { style: { flex: "1" } }),
      copyBtn,
      clearBtn,
      helpBtn,
      this.wordCountEl,
    ]);

    if (!this.showChips) {
      this.chipsBar.replaceChildren(topBar, this.linterBar);
      return;
    }

    const groups = QUICK_CHIPS.map((cat) => el("div", { class: "mmc-chip-group" }, [
      el("span", { class: "mmc-chip-group-label", text: t(cat.group) }),
      el("div", { class: "mmc-chips" }, cat.items.map((phrase) => el("button", {
        class: "mmc-chip mmc-quick-chip",
        text: phrase,
        title: t("Insert '{text}' at cursor", { text: phrase }),
        onpointerdown: (e) => e.stopPropagation(),
        onclick: (e) => {
          e.stopPropagation();
          this.insertTextAtCursor(`\n• ${phrase}`);
          this.onEdit();
          this.updateWordCount();
        },
      }))),
    ]));

    this.chipsBar.replaceChildren(topBar, ...groups, this.linterBar);
  }

  getValue() {
    return extractStructuredText(this.root);
  }

  setValue(text) {
    if (this.getValue() === text) return;
    this.root.replaceChildren(...this.build(text));
    this._lastHighlighted = this.getValue();
    this.updateWordCount();
    this.runLinter();
  }

  build(text) {
    const mode = this.syntaxMode;
    if (mode === "off") {
      return [document.createTextNode(text)];
    }

    const state = this.hooks.getState?.() ?? {};
    const known = new Set([
      ...(state.assets ?? []).map((a) => a.handle),
      ...(this.hooks.getPool?.() ?? []).map((a) => a.handle),
    ]);

    const out = [];
    let at = 0;

    const pattern = mode === "full"
      ? /(@[A-Za-z]+-?\d+)|(\[Shot\s+\d+\])|(At\s+\d{1,3}:\d{2}\.\d{3},?)|(<\s*(?:Subject|Picture|Video|Audio)\s+\d+\s*>)|(<d>[\s\S]*?<\/d>)/gi
      : /@([A-Za-z]+-?\d+)/g;

    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > at) {
        out.push(document.createTextNode(text.slice(at, match.index)));
      }

      if (match[1]) {
        const handle = match[1].replace(/^@/, "");
        if (known.has(handle)) {
          out.push(this.chip(handle));
        } else {
          out.push(document.createTextNode(match[1]));
        }
      } else if (match[2]) {
        out.push(el("span", { class: "mmc-tok-shot", contenteditable: "false", text: match[2] }));
      } else if (match[3]) {
        out.push(el("span", { class: "mmc-tok-time", contenteditable: "false", text: match[3] }));
      } else if (match[4]) {
        out.push(el("span", { class: "mmc-tok-subject", contenteditable: "false", text: match[4] }));
      } else if (match[5]) {
        out.push(el("span", { class: "mmc-tok-dialogue", text: match[5] }));
      }

      at = match.index + match[0].length;
    }

    if (at < text.length) {
      out.push(document.createTextNode(text.slice(at)));
    }
    return out;
  }

  chip(handle) {
    return el("span", {
      class: `mmc-ref mmc-tag-${tagIndex(handle)}`,
      contenteditable: "false",
      "data-handle": handle,
      text: `@${handle}`,
    });
  }

  setSuperseded(on) {
    this.root.classList.toggle("superseded", !!on);
    this.root.title = on
      ? t("Not queued while the rewrite below is on — that is what the model reads.")
      : "";
  }

  refresh() {
    if (document.activeElement === this.root) return;
    this.root.replaceChildren(...this.build(this.hooks.getState?.()?.prompt ?? ""));
    this._lastHighlighted = this.getValue();
    this.updateWordCount();
    this.runLinter();
  }

  /* ---- live re-highlighting while typing ------------------------------- */

  scheduleHighlight() {
    clearTimeout(this._highlightTimer);
    this._highlightTimer = setTimeout(() => {
      // Wait for the mention menu to close so its rows aren't rebuilt mid-use.
      if (this.menu) { this.scheduleHighlight(); return; }
      this.rehighlightIfChanged();
    }, 350);
  }

  rehighlightIfChanged() {
    if (!this.root.isConnected || this.syntaxMode === "off") return;
    const text = this.getValue();
    if (text === this._lastHighlighted) return;
    const caret = this.caretTextOffset();
    this.root.replaceChildren(...this.build(text));
    this._lastHighlighted = text;
    if (caret >= 0 && document.activeElement === this.root) this.restoreCaret(caret);
  }

  caretTextOffset() {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !this.root.contains(sel.getRangeAt(0).startContainer)) return -1;
    const active = sel.getRangeAt(0);
    const pre = active.cloneRange();
    pre.selectNodeContents(this.root);
    pre.setEnd(active.startContainer, active.startOffset);
    return pre.toString().length;
  }

  restoreCaret(offset) {
    try {
      const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
      let remaining = offset;
      let node;
      while ((node = walker.nextNode())) {
        const length = node.nodeValue.length;
        if (remaining <= length) {
          const selection = window.getSelection();
          const range = document.createRange();
          range.setStart(node, Math.max(0, remaining));
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        remaining -= length;
      }
    } catch {}
  }

  onEdit() {
    this.hooks.onInput(this.getValue());
    const trigger = this.triggerRange();
    if (trigger) this.openMenu(trigger.query);
    else this.closeMenu();
    this.scheduleHighlight();
  }

  onPaste(event) {
    event.stopPropagation();
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    this.insertTextAtCursor(text.replace(/\r\n?/g, "\n"));
    this.onEdit();
    this.updateWordCount();
  }

  onKeyDown(event) {
    if (this.menu && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") this.closeMenu();
      else if (event.key === "Enter" || event.key === "Tab") this.choose(this.active);
      else this.move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    event.stopPropagation();

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      // Ctrl/Cmd+Enter queues the prompt without leaving the keyboard.
      event.preventDefault();
      if (this.menu) this.choose(this.active);
      else this.hooks.onQueue?.();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this.insertTextAtCursor("\n");
      this.onEdit();
      this.updateWordCount();
    }
  }

  triggerRange() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !this.root.contains(node)) return null;
    const match = TRIGGER.exec(node.nodeValue.slice(0, range.startOffset));
    if (!match) return null;
    return { node, start: range.startOffset - match[0].length, end: range.startOffset, query: match[1] };
  }

  insertTextAtCursor(text) {
    this.root.focus();
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      this.root.appendChild(document.createTextNode(text));
      return;
    }
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  insertChip(handle) {
    const trigger = this.triggerRange();
    const selection = window.getSelection();
    const range = document.createRange();
    if (trigger) {
      range.setStart(trigger.node, trigger.start);
      range.setEnd(trigger.node, trigger.end);
      range.deleteContents();
    } else if (selection?.rangeCount) {
      range.setStart(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
      range.collapse(true);
    } else {
      this.root.appendChild(this.chip(handle));
      this.root.appendChild(document.createTextNode(" "));
      this.hooks.onInput(this.getValue());
      this.updateWordCount();
      return;
    }
    const chip = this.chip(handle);
    const space = document.createTextNode(" ");
    range.insertNode(space);
    range.insertNode(chip);
    const after = document.createRange();
    after.setStart(space, 1);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    this.hooks.onInput(this.getValue());
    this.updateWordCount();
  }

  async openMenu(query) {
    this.query = query.toLowerCase();
    if (!this.menu) {
      this.menu = el("div", { class: "mmc-mention" });
      floatAbove(this.menu);
      document.body.appendChild(this.menu);
      this.active = 0;
    }
    floatAbove(this.menu);
    this.place();
    this.renderMenu();
    try {
      this.library = await listAssets();
    } catch {
      this.library = [];
    }
    if (this.menu) this.renderMenu();
  }

  closeMenu() {
    this.menu?.remove();
    this.menu = null;
    this.active = 0;
    this.rows = null;
    this.signature = null;
  }

  openHelpPopover(anchor) {
    const shortcuts = [
      ["@", t("Attach or reference media from the prompt")],
      ["↑ ↓", t("Move through the mention menu")],
      ["Enter / Tab", t("Pick the highlighted mention")],
      ["Esc", t("Close menus and popovers")],
      ["Ctrl+Enter", t("Queue the prompt")],
      ["Right-click @chip", t("Trim, switch sound, copy or remove")],
    ];
    const pop = el("div", { class: "mmc-pop mmc-help-pop" }, [
      el("div", { class: "mmc-pop-title", text: t("Keyboard shortcuts") }),
      ...shortcuts.map(([key, what]) => el("div", { class: "mmc-help-row" }, [
        el("kbd", { class: "mmc-help-key", text: key }),
        el("span", { class: "mmc-help-what", text: what }),
      ])),
    ]);
    floatAbove(pop);
    document.body.appendChild(pop);
    placeNear(pop, anchor);
    dismissable(pop);
  }

  defaultChipActions(handle) {
    const state = this.hooks.getState?.() ?? {};
    const attached = (state.assets ?? state.refs ?? []).find((a) => a.handle === handle);
    const actions = [{
      label: t(`Copy @${handle}`),
      title: t("Copy the mention to the clipboard"),
      run: () => { try { navigator.clipboard.writeText(`@${handle}`); } catch {} },
    }];
    if (attached && this.hooks.removeAsset) {
      actions.push({
        label: t("Remove attachment"),
        danger: true,
        run: () => this.hooks.removeAsset(handle),
      });
    }
    return actions;
  }

  openChipMenu(handle, anchorEl) {
    const actions = this.hooks.chipActions?.(handle) ?? this.defaultChipActions(handle);
    if (!actions.length) return;
    this.closeChipMenu();
    const pop = el("div", { class: "mmc-pop mmc-chip-menu" },
      actions.map((action) => el("button", {
        class: `mmc-chip-menu-item${action.danger ? " danger" : ""}`,
        text: action.label,
        title: action.title || "",
        onclick: (event) => {
          event.stopPropagation();
          this.closeChipMenu();
          try { action.run?.(); } catch (error) { console.error("[minimax_creator] chip action failed:", error); }
        },
      }))
    );
    floatAbove(pop);
    document.body.appendChild(pop);
    placeNear(pop, anchorEl);
    this.chipMenuCloser = dismissable(pop, () => { this.chipMenuCloser = null; });
  }

  closeChipMenu() {
    this.chipMenuCloser?.();
    this.chipMenuCloser = null;
  }

  place() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !this.menu) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const anchor = rect.width || rect.height ? rect : this.root.getBoundingClientRect();
    const box = this.menu.getBoundingClientRect();
    const height = box.height || 260;
    const top = anchor.top - height - 8 > 8 ? anchor.top - height - 8 : anchor.bottom + 8;
    this.menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - 340))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
  }

  options() {
    const state = this.hooks.getState?.() ?? {};
    const attachedAssets = state.assets ?? [];
    const attached = attachedAssets
      .filter((asset) => !this.query || asset.handle.toLowerCase().includes(this.query)
        || asset.filename.toLowerCase().includes(this.query))
      .map((asset) => ({ kind: "attached", handle: asset.handle, path: asset.filename, mediaKind: asset.kind }));

    const own = new Set(attachedAssets.map((a) => a.handle));
    const pool = this.hooks.attachBlocked?.("reference") ? []
      : (this.hooks.getPool?.() ?? [])
        .filter((asset) => !own.has(asset.handle))
        .filter((asset) => !this.query || asset.handle.toLowerCase().includes(this.query)
          || asset.filename.toLowerCase().includes(this.query))
        .map((asset) => ({ kind: "pool", handle: asset.handle, path: asset.filename, mediaKind: asset.kind }));

    const used = new Set(attachedAssets.map((a) => a.filename));
    const library = (this.library ?? [])
      .filter((row) => !used.has(row.path))
      .filter((row) => !this.query || row.path.toLowerCase().includes(this.query))
      .slice(0, MAX_SUGGESTIONS)
      .map((row) => ({ kind: "library", path: row.path, mediaKind: row.kind, row }));

    return { attached, pool, library };
  }

  renderMenu() {
    if (!this.menu) return;
    const { attached, pool, library } = this.options();
    this.flat = [...attached, ...pool, ...library];
    if (this.active >= this.flat.length) this.active = Math.max(0, this.flat.length - 1);

    const signature = this.flat.map((option) => option.handle ?? option.path).join("\u0000");
    if (this.rows?.length && signature === this.signature) return;
    this.signature = signature;

    this.menu.replaceChildren();
    this.rows = [];
    if (!this.flat.length) {
      this.menu.appendChild(el("div", { class: "mmc-mention-empty", text: t("Nothing matches.") }));
      return;
    }

    let index = 0;
    const row = (option) => {
      const here = index++;
      const thumb = option.mediaKind === "image"
        ? el("img", { class: "mmc-mention-thumb", src: viewUrl(option.path, { preview: true }), alt: "" })
        : el("span", { class: "mmc-mention-thumb", text: option.mediaKind === "video" ? "▶" : "♪" });

      const title = option.handle ? `@${option.handle}` : option.path.split("/").pop();
      const subtitle = option.handle ? option.path : (option.row?.subfolder || "");

      const item = el("button", {
        class: "mmc-mention-row",
        "aria-selected": here === this.active,
        title: option.path,
        onmouseenter: () => this.highlight(here),
        onclick: (event) => { event.preventDefault(); this.choose(here); },
      }, [
        thumb,
        el("span", { class: "mmc-mention-text" }, [
          el("span", {
            class: `mmc-mention-handle${option.handle ? ` mmc-tag-${tagIndex(option.handle)}` : ""}`,
            text: title,
          }),
          ...(subtitle ? [el("span", { class: "mmc-mention-sub", text: subtitle })] : []),
        ]),
      ]);
      item.addEventListener("pointerdown", (event) => event.preventDefault());
      this.rows.push(item);
      return item;
    };

    if (attached.length) {
      this.menu.appendChild(el("div", { class: "mmc-mention-head", text: t("Attached") }));
      for (const option of attached) this.menu.appendChild(row(option));
    }
    if (pool.length) {
      this.menu.appendChild(el("div", { class: "mmc-mention-head", text: t("Piece references") }));
      for (const option of pool) this.menu.appendChild(row(option));
    }
    if (library.length) {
      const blocked = this.hooks.attachBlocked?.("reference");
      this.menu.appendChild(el("div", {
        class: "mmc-mention-head",
        text: blocked ? t("Input folder — unavailable while a start/end frame is set") : t("Input folder"),
      }));
      for (const option of library) this.menu.appendChild(row(option));
    }
    this.place();
  }

  highlight(index, { scroll = false } = {}) {
    if (!this.rows?.length) return;
    this.active = index;
    this.rows.forEach((row, at) => row.setAttribute("aria-selected", String(at === index)));
    if (scroll) this.rows[index]?.scrollIntoView({ block: "nearest" });
  }

  move(delta) {
    if (!this.flat?.length) return;
    this.highlight((this.active + delta + this.flat.length) % this.flat.length, { scroll: true });
  }

  choose(index) {
    const option = this.flat?.[index];
    if (!option) return;
    if (option.kind === "attached" || option.kind === "pool") {
      this.closeMenu();
      this.insertChip(option.handle);
      return;
    }
    const handle = this.hooks.onAttach(option.row);
    this.closeMenu();
    if (handle) this.insertChip(handle);
  }
}