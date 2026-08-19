import { el, mountOverlay } from "./dom.js";
import { loadSettings, saveSettings } from "./api.js";
import { t } from "./i18n.js";
import { TOKENS, cleanPrefix, folderOf, stemOf, examplePath } from "./outputs.js";

const QUALITY = [
  { crf: 28, label: "Draft",
    note: "Smallest files, about half of Standard. Fine for checking timing; "
        + "banding shows up in dark gradients." },
  { crf: 23, label: "Standard",
    note: "What libx264 picks on its own, and what this pack wrote before the "
        + "setting existed." },
  { crf: 18, label: "Fine",
    note: "About twice the size of Standard. Hard to tell from the frames the "
        + "sampler handed over." },
  { crf: 14, label: "Archival",
    note: "About three times the size of Standard. Keeps the grain and fine "
        + "texture H.264 usually eats first." },
];

export function openSettings() {
  return new Promise((resolve) => new SettingsPage(resolve).mount());
}

const TABS = [
  { key: "quality", label: "Quality" },
  { key: "folders", label: "Folders" },
  { key: "performance", label: "VAE & Performance" },
  { key: "editor", label: "Editor" },
  { key: "preview", label: "Preview" },
];

class SettingsPage {
  constructor(resolve) {
    this.resolve = resolve;
    this.settings = null;
    this.problem = null;
    this.tab = TABS[0].key;
  }

  mount() {
    this.body = el("div", { class: "mmc-set-body" });
    this.tabs = TABS.map((tab) => el("button", {
      class: "mmc-tab",
      "aria-selected": tab.key === this.tab,
      text: t(tab.label),
      onclick: () => this.show(tab.key),
    }));
    this.modal = el("div", { class: "mmc-modal mmc-settings" }, [
      el("div", { class: "mmc-modal-head" }, [
        ...this.tabs,
        el("button", { class: "mmc-close", text: "✕", title: t("Close"), onclick: () => this.close() }),
      ]),
      this.body,
      el("div", { class: "mmc-modal-foot" }, [
        el("button", { class: "mmc-add", text: t("Done"), onclick: () => this.close() }),
      ]),
    ]);
    this.modal.style.position = "relative";

    this.overlay = el("div", {
      class: "mmc-overlay",
      onpointerdown: (event) => { if (event.target === this.overlay) this.close(); },
    }, [this.modal]);

    this.unmount = mountOverlay(this.overlay, () => this.close());
    this.render();
    this.load();
  }

  async load() {
    try {
      this.settings = await loadSettings();
    } catch (error) {
      this.problem = t("Could not read the settings — {error}", { error: error.message });
    }
    this.render();
  }

  async set(patch) {
    const previous = this.settings;
    this.settings = { ...this.settings, ...patch };
    this.problem = null;
    this.render();
    try {
      this.settings = await saveSettings(patch);
    } catch (error) {
      this.settings = previous;
      this.problem = t("Not saved — {error}", { error: error.message });
    }
    this.render();
  }

  show(tab) {
    if (tab === this.tab) return;
    this.tab = tab;
    this.problem = null;
    this.render();
  }

  close() {
    this.unmount();
    this.resolve();
  }

  render() {
    if (!this.settings) {
      this.body.replaceChildren(el("div", { class: "mmc-set-wait", text: this.problem ?? t("Reading settings…") }));
      return;
    }
    for (const [index, tab] of TABS.entries()) {
      this.tabs[index].setAttribute("aria-selected", String(tab.key === this.tab));
    }
    this.body.replaceChildren(
      ...(this.problem ? [el("div", { class: "mmc-set-problem", text: this.problem })] : []),
      ...(this.tab === "quality" ? [this.renderQuality()]
         : this.tab === "folders" ? this.renderFolders()
         : this.tab === "performance" ? [this.renderPerformance()]
         : this.tab === "editor" ? [this.renderEditor()]
         : [this.renderPreview()]),
    );
  }

  renderQuality() {
    const current = this.settings.video_crf;
    const rows = QUALITY.some((tier) => tier.crf === current)
      ? QUALITY
      : [{ crf: current, label: "Custom",
           note: "Set by hand in the settings file. Pick one of the four below to leave it." },
         ...QUALITY];

    return this.section("Output", "Video quality",
      "How much the encoder may throw away when it writes an .mp4. Applies to "
      + "every render this ComfyUI makes, whatever workflow made it.",
      [
        el("div", { class: "mmc-set-choices" }, rows.map((tier) => el("button", {
          class: "mmc-opt mmc-set-opt",
          "aria-checked": tier.crf === current,
          onclick: () => tier.crf !== current && this.set({ video_crf: tier.crf }),
        }, [
          el("span", { class: "mmc-radio" }),
          el("span", { class: "mmc-set-opt-text" }, [
            el("span", { class: "mmc-set-opt-label", text: t(tier.label) }),
            el("span", { class: "mmc-set-opt-note", text: t(tier.note) }),
          ]),
          el("span", { class: "mmc-set-value", text: t("crf {crf}", { crf: tier.crf }) }),
        ]))),
        el("div", { class: "mmc-set-foot" }, [
          el("span", {
            text: t("MP4, H.264, 8-bit 4:2:0 — the file this pack has always written. "
                + "CRF is libx264's quality target: lower is better and larger, and six "
                + "points is roughly double the size. Needs ComfyUI 0.29 or newer; older "
                + "builds can only write the default."),
          }),
        ]),
      ]);
  }

  renderPerformance() {
    const isTiled = this.settings.tiled_vae === true;
    const tileSize = Number(this.settings.vae_tile_size || 512);

    const tiledOptions = [
      { enabled: true, label: "Enabled (Tiled VAE)",
        note: "Decodes latents in spatial tiles (e.g. 512x512) to drastically reduce peak VRAM usage during VAE decoding of high-res video and stills." },
      { enabled: false, label: "Disabled (Full VAE)",
        note: "Decodes full frame tensors in one single pass. Faster on high-VRAM GPUs (24GB+), but may OOM on large resolutions." },
    ];

    const tileSizes = [256, 384, 512, 768, 1024];

    return el("div", {}, [
      this.section("Memory Optimization", "Tiled VAE Decoder",
        "Enable spatial tiled VAE decoding across Creator, Timeline, and PreStage nodes.",
        [
          el("div", { class: "mmc-set-choices" }, tiledOptions.map((opt) => el("button", {
            class: "mmc-opt mmc-set-opt",
            "aria-checked": opt.enabled === isTiled,
            onclick: () => {
              if (opt.enabled !== isTiled) {
                this.set({ tiled_vae: opt.enabled });
              }
            },
          }, [
            el("span", { class: "mmc-radio" }),
            el("span", { class: "mmc-set-opt-text" }, [
              el("span", { class: "mmc-set-opt-label", text: t(opt.label) }),
              el("span", { class: "mmc-set-opt-note", text: t(opt.note) }),
            ]),
            el("span", { class: "mmc-set-value", text: opt.enabled ? t("on") : t("off") }),
          ]))),
        ]),
      this.section("Performance", "VAE Tile Size",
        "Set spatial tile dimension. 512px is the recommended default.",
        [
          el("div", { class: "mmc-chips", style: { marginTop: "8px" } }, tileSizes.map((sz) => el("button", {
            class: "mmc-chip",
            "aria-checked": sz === tileSize,
            text: `${sz}px`,
            onclick: () => this.set({ vae_tile_size: sz }),
          }))),
        ]),
    ]);
  }

  renderEditor() {
    const currentSyntax = this.settings.syntax_highlighting || "media";
    const linterEnabled = this.settings.enable_linter !== false;

    const syntaxOptions = [
      { key: "media", label: "Media Chips Only (Default)",
        note: "Highlights @img-1, @vid-1, and @aud-1 as colored badge chips." },
      { key: "full", label: "Full Context-IR Syntax",
        note: "Highlights [Shot N], <Subject N>, dialogue tags <d>, cut timestamps, and camera motion keywords." },
      { key: "off", label: "Disabled",
        note: "Displays plain text without token badges or highlights." },
    ];

    const linterOptions = [
      { enabled: true, label: "Enabled",
        note: "Shows live warnings for missing @handles, dialogue pacing, and mode conflicts as you type." },
      { enabled: false, label: "Disabled",
        note: "Hides all real-time validation notices beneath the prompt box." },
    ];

    return el("div", {}, [
      this.section("Prompt Editor", "Syntax Highlighting",
        "Choose how tokens, attachments, and Context-IR structures are colored in prompt boxes.",
        [
          el("div", { class: "mmc-set-choices" }, syntaxOptions.map((opt) => el("button", {
            class: "mmc-opt mmc-set-opt",
            "aria-checked": opt.key === currentSyntax,
            onclick: () => {
              if (opt.key !== currentSyntax) {
                try { localStorage.setItem("mmc-syntax-mode", opt.key); } catch {}
                this.set({ syntax_highlighting: opt.key });
              }
            },
          }, [
            el("span", { class: "mmc-radio" }),
            el("span", { class: "mmc-set-opt-text" }, [
              el("span", { class: "mmc-set-opt-label", text: t(opt.label) }),
              el("span", { class: "mmc-set-opt-note", text: t(opt.note) }),
            ]),
          ]))),
        ]),
      this.section("Validation", "Live Prompt Linter",
        "Checks prompt constraints in real time before queueing.",
        [
          el("div", { class: "mmc-set-choices" }, linterOptions.map((opt) => el("button", {
            class: "mmc-opt mmc-set-opt",
            "aria-checked": opt.enabled === linterEnabled,
            onclick: () => {
              if (opt.enabled !== linterEnabled) {
                try { localStorage.setItem("mmc-linter-enabled", String(opt.enabled)); } catch {}
                this.set({ enable_linter: opt.enabled });
              }
            },
          }, [
            el("span", { class: "mmc-radio" }),
            el("span", { class: "mmc-set-opt-text" }, [
              el("span", { class: "mmc-set-opt-label", text: t(opt.label) }),
              el("span", { class: "mmc-set-opt-note", text: t(opt.note) }),
            ]),
            el("span", { class: "mmc-set-value", text: opt.enabled ? t("on") : t("off") }),
          ]))),
        ]),
    ]);
  }

  renderPreview() {
    const current = this.settings.enable_preview !== false;
    const rows = [
      { enabled: true, label: "Enabled",
        note: "Automatically show live satellite preview box during sampling and generation." },
      { enabled: false, label: "Disabled",
        note: "Keep the preview box hidden. Generations run in the background without popping up the preview box." },
    ];

    return this.section("Preview", "Live Preview Box",
      "Controls whether the floating preview box automatically appears during generation.",
      [
        el("div", { class: "mmc-set-choices" }, rows.map((opt) => el("button", {
          class: "mmc-opt mmc-set-opt",
          "aria-checked": opt.enabled === current,
          onclick: () => {
            if (opt.enabled !== current) {
              try { localStorage.setItem("mmc-preview-disabled", String(!opt.enabled)); } catch {}
              this.set({ enable_preview: opt.enabled });
            }
          },
        }, [
          el("span", { class: "mmc-radio" }),
          el("span", { class: "mmc-set-opt-text" }, [
            el("span", { class: "mmc-set-opt-label", text: t(opt.label) }),
            el("span", { class: "mmc-set-opt-note", text: t(opt.note) }),
          ]),
          el("span", { class: "mmc-set-value", text: opt.enabled ? t("on") : t("off") }),
        ]))),
        el("div", { class: "mmc-set-foot" }, [
          el("span", {
            text: t("When disabled, you can still open the preview box manually by clicking the Preview button in the node toolbar."),
          }),
        ]),
      ]);
  }

  renderFolders() {
    return [
      this.section("Output", "Folders",
        "Where this ComfyUI files what it makes. Renders and stills get their "
        + "own, which is how the gallery tells them apart.",
        [
          el("div", { class: "mmc-set-field" }, [
            this.folderRow("video_prefix", "Renders",
              "finished videos — the Creator and the Timeline", "mp4"),
            this.folderRow("image_prefix", "Stills",
              "pre-stage stills", "png"),
          ]),
          el("div", { class: "mmc-set-foot" }, [
            el("span", { text: t("Relative to ComfyUI's output folder (") }),
            el("code", { text: "--output-directory" }),
            el("span", { text: t(" moves that). The last part names the files, not a folder — "
                             + "core's counter numbers them apart.") }),
          ]),
        ]),
    ];
  }

  folderRow(key, title, description, extension) {
    const stored = this.settings[key];
    const field = el("input", {
      class: "mmc-out-field",
      type: "text",
      value: stored,
      spellcheck: false,
      "aria-label": t("{title} — folder and filename prefix", { title: t(title) }),
      onkeydown: (event) => {
        event.stopPropagation();
        if (event.key === "Enter") field.blur();
        if (event.key === "Escape") { field.value = this.settings[key]; field.blur(); }
      },
      onchange: () => commit(),
      onblur: () => commit(),
    });
    const problem = el("div", { class: "mmc-out-problem" });
    const example = el("div", { class: "mmc-out-example" });

    const paint = () => {
      const { prefix, error } = cleanPrefix(field.value, stored);
      field.classList.toggle("bad", Boolean(error));
      problem.textContent = error ?? "";
      problem.style.display = error ? "" : "none";
      example.replaceChildren(...(error ? [] : [
        el("span", { class: "mmc-out-dim", text: "→ " }),
        el("span", {
          class: "mmc-out-dim",
          text: folderOf(prefix) ? `output/${folderOf(prefix)}/` : "output/",
        }),
        el("span", { text: examplePath(stemOf(prefix), { extension }) }),
      ]));
      return { prefix, error };
    };

    const commit = () => {
      const { prefix, error } = paint();
      if (error || prefix === this.settings[key]) return;
      this.set({ [key]: prefix });
    };

    field.addEventListener("input", paint);
    paint();

    return el("div", { class: "mmc-set-dest" }, [
      el("div", { class: "mmc-set-dest-head" }, [
        el("span", { class: "mmc-set-dest-name", text: t(title) }),
        el("span", { class: "mmc-set-dest-sub", text: t(description) }),
      ]),
      field,
      problem,
      example,
      el("div", { class: "mmc-out-tokens" }, [
        el("span", { class: "mmc-out-tokens-key", text: t("insert") }),
        ...TOKENS.map((token) => el("button", {
        class: "mmc-out-token",
        text: token.replaceAll("%", ""),
        title: t("Inserts {token} — filled in when the file is written", { token }),
        onpointerdown: (event) => event.preventDefault(),
        onclick: () => {
          const at = field.selectionStart ?? field.value.length;
          field.value = field.value.slice(0, at) + token + field.value.slice(field.selectionEnd ?? at);
          field.focus();
          field.setSelectionRange?.(at + token.length, at + token.length);
          paint();
        },
      }))]),
    ]);
  }

  section(group, title, description, controls) {
    return el("div", { class: "mmc-set-section" }, [
      el("div", { class: "mmc-note-key", text: t(group) }),
      el("div", { class: "mmc-set-title", text: t(title) }),
      el("div", { class: "mmc-set-desc", text: t(description) }),
      ...controls,
    ]);
  }
}