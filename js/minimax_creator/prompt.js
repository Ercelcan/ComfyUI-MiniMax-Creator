import { el, icon, floatAbove } from "./dom.js";
import { t } from "./i18n.js";
import { listAssets, viewUrl } from "./api.js";
import { tagIndex } from "./state.js";

const TRIGGER = /@([\w-]*)$/;
const MAX_SUGGESTIONS = 40;

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

export class PromptBox {
  constructor(hooks) {
    this.hooks = hooks;
    this.menu = null;
    this.showChips = false;

    this.root = el("div", {
      class: "mmc-prompt",
      contenteditable: "true",
      spellcheck: "false",
      role: "textbox",
      "aria-multiline": "true",
      "data-placeholder": t("Describe your video, use @ to reference images, videos, audio, or elements"),
    });

    this.wordCountEl = el("span", { class: "mmc-prompt-wordcount", text: "0 words" });

    this.chipsBar = el("div", { class: "mmc-prompt-chips-bar" });

    this.root.addEventListener("input", () => {
      this.onEdit();
      this.updateWordCount();
    });
    this.root.addEventListener("keydown", (event) => this.onKeyDown(event), true);
    this.root.addEventListener("paste", (event) => this.onPaste(event));
    this.root.addEventListener("blur", () => setTimeout(() => this.closeMenu(), 150));

    for (const name of ["keyup", "keydown", "copy", "cut", "paste", "pointerdown", "pointerup", "wheel"]) {
      this.root.addEventListener(name, (event) => event.stopPropagation());
    }

    this.renderChipsBar();
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
      },
    });

    const topBar = el("div", { class: "mmc-prompt-top-row" }, [
      toggleBtn,
      el("span", { style: { flex: "1" } }),
      copyBtn,
      clearBtn,
      this.wordCountEl,
    ]);

    if (!this.showChips) {
      this.chipsBar.replaceChildren(topBar);
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
          this.insertTextAtCursor(`${phrase}, `);
          this.onEdit();
          this.updateWordCount();
        },
      }))),
    ]));

    this.chipsBar.replaceChildren(topBar, ...groups);
  }

  getValue() {
    let text = "";
    for (const node of this.root.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue;
      else if (node.dataset?.handle) text += `@${node.dataset.handle}`;
      else if (node.tagName === "BR") text += "\n";
      else text += node.textContent;
    }
    return text;
  }

  setValue(text) {
    if (this.getValue() === text) return;
    this.root.replaceChildren(...this.build(text));
    this.updateWordCount();
  }

  build(text) {
    const state = this.hooks.getState?.() ?? {};
    const known = new Set([
      ...(state.assets ?? []).map((a) => a.handle),
      ...(this.hooks.getPool?.() ?? []).map((a) => a.handle),
    ]);
    const out = [];
    let at = 0;
    const pattern = /@([A-Za-z]+-\d+)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (!known.has(match[1])) continue;
      if (match.index > at) out.push(document.createTextNode(text.slice(at, match.index)));
      out.push(this.chip(match[1]));
      at = match.index + match[0].length;
    }
    if (at < text.length) out.push(document.createTextNode(text.slice(at)));
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
      ? t("Not queued while the rewrite below is on — that is what the model reads. "
        + "Edit this and refine again, or revert the rewrite, to send it.")
      : "";
  }

  refresh() {
    if (document.activeElement === this.root) return;
    this.root.replaceChildren(...this.build(this.hooks.getState?.()?.prompt ?? ""));
    this.updateWordCount();
  }

  onEdit() {
    this.hooks.onInput(this.getValue());
    const trigger = this.triggerRange();
    if (trigger) this.openMenu(trigger.query);
    else this.closeMenu();
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