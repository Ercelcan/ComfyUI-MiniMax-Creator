import { el, icon, dismissable, placeNear } from "./dom.js";
import { stepperPill } from "./pills.js";
import { t } from "./i18n.js";
import { api } from "../../../scripts/api.js";

const STORE = "minimax_creator.refiner";

const DEFAULTS = {
  provider: "comfy",
  ollamaUrl: "http://localhost:11434",
  openaiUrl: "http://localhost:1234/v1",
  openrouterUrl: "https://openrouter.ai/api/v1",
  openrouterKey: "",
  model: "",
  temperature: 0.3,
  seed: -1,
  language: "English",
  skill: "",
  template: "auto",
  maxTokens: 6144,
};

const TOKENS = { min: 1024, max: 32768, step: 1024 };

export const LANGUAGES = [
  "English", "Chinese", "Spanish", "French", "German", "Portuguese",
  "Russian", "Japanese", "Korean", "Italian", "Arabic",
];

export function settings() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(STORE) || "{}");
  } catch {
    return { ...DEFAULTS };
  }
  if (stored.localModel !== undefined) {
    const { localModel, backend, url, ...rest } = stored;
    stored = { ...rest, model: localModel };
  }
  if (stored.temperature === 0.7) {
    const { temperature, ...rest } = stored;
    stored = rest;
  }
  return { ...DEFAULTS, ...stored };
}

export function saveSettings(patch) {
  const next = { ...settings(), ...patch };
  try { localStorage.setItem(STORE, JSON.stringify(next)); } catch {}
  return next;
}

export function chosenModel(current = settings()) {
  return current.model || "";
}

let modelCache = { key: "", at: 0, names: [], error: null };

export async function listModels({ provider = "comfy", url = "", apiKey = "", force = false } = {}) {
  const key = `${provider}:${url}:${apiKey}`;
  if (!force && modelCache.key === key && Date.now() - modelCache.at < 20000) return modelCache.names;
  try {
    const query = new URLSearchParams({ provider, url, api_key: apiKey });
    const response = await api.fetchApi(`/minimax_creator/refine/models?${query}`);
    const body = await response.json();
    const names = body.models ?? [];
    names.error = body.error || null;
    modelCache = { key, at: Date.now(), names };
    return names;
  } catch (err) {
    const names = [];
    names.error = String(err);
    modelCache = { key, at: Date.now(), names };
    return names;
  }
}

let skillCache = { at: 0, names: [] };

export async function listSkills({ force = false } = {}) {
  if (!force && Date.now() - skillCache.at < 20000) return skillCache.names;
  try {
    const response = await api.fetchApi("/minimax_creator/refine/skills");
    const body = await response.json();
    skillCache = { at: Date.now(), names: body.skills ?? [] };
  } catch {
    skillCache = { at: Date.now(), names: [] };
  }
  return skillCache.names;
}

export async function refine(payload) {
  const current = settings();
  const provider = current.provider || "comfy";
  let url = "";
  let apiKey = "";
  if (provider === "ollama") url = current.ollamaUrl;
  else if (provider === "openai") url = current.openaiUrl;
  else if (provider === "openrouter") {
    url = current.openrouterUrl;
    apiKey = current.openrouterKey;
  }

  const response = await api.fetchApi("/minimax_creator/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      provider,
      url,
      api_key: apiKey,
      model: current.model,
      temperature: current.temperature,
      seed: current.seed,
      language: current.language,
      max_tokens: current.maxTokens,
      skill: current.skill,
      template: current.template,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || t("the refiner failed ({status})", { status: response.status }));
  return body;
}

export async function cancelRefine(nodeId) {
  try {
    await api.fetchApi("/minimax_creator/refine/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: String(nodeId || "") }),
    });
  } catch {}
}

export function openSettings(anchor, onChange) {
  const pop = el("div", { class: "mmc-pop mmc-refine-pop" });
  const providerHost = el("div", { class: "mmc-refine-group", style: { padding: "4px 8px 8px" } });
  const modelHost = el("div", { class: "mmc-refine-models" });
  const skillHost = el("div", { class: "mmc-refine-models" });
  const templateHost = el("div", { class: "mmc-refine-models" });
  const moreHost = el("div", { class: "mmc-refine-more-body" });

  const changed = () => { onChange?.(); drawTemplate(); drawMore(); };

  const PROVIDERS = [
    ["comfy", "ComfyUI Text Encoder", "Local Qwen3-VL model loaded in ComfyUI memory"],
    ["ollama", "Ollama Server", "Ollama API server (e.g. http://localhost:11434)"],
    ["openai", "LM Studio / OpenAI", "LM Studio or OpenAI-compatible server (e.g. http://localhost:1234/v1)"],
    ["openrouter", "OpenRouter", "OpenRouter API (https://openrouter.ai/api/v1)"],
  ];

  function drawProvider() {
    const current = settings();
    const activeProvider = current.provider || "comfy";
    const providerBtns = PROVIDERS.map(([key, label, hint]) => el("button", {
      class: "mmc-chip",
      "aria-checked": key === activeProvider,
      text: t(label),
      title: t(hint),
      onclick: () => {
        saveSettings({ provider: key, model: "" });
        changed();
        drawProvider();
        drawModels(true);
      },
    }));

    const urlRow = [];
    if (activeProvider === "ollama") {
      const urlInput = el("input", {
        class: "mmc-out-field",
        type: "text",
        value: current.ollamaUrl || "http://localhost:11434",
        placeholder: "http://localhost:11434",
        spellcheck: "false",
        onchange: (e) => {
          saveSettings({ ollamaUrl: e.target.value.trim() });
          changed();
          drawModels(true);
        },
      });
      urlRow.push(el("div", { class: "mmc-refine-group", style: { marginTop: "6px" } }, [
        el("span", { class: "mmc-note-key", text: t("server url") }),
        urlInput,
      ]));
    } else if (activeProvider === "openai") {
      const urlInput = el("input", {
        class: "mmc-out-field",
        type: "text",
        value: current.openaiUrl || "http://localhost:1234/v1",
        placeholder: "http://localhost:1234/v1",
        spellcheck: "false",
        onchange: (e) => {
          saveSettings({ openaiUrl: e.target.value.trim() });
          changed();
          drawModels(true);
        },
      });
      urlRow.push(el("div", { class: "mmc-refine-group", style: { marginTop: "6px" } }, [
        el("span", { class: "mmc-note-key", text: t("server url") }),
        urlInput,
      ]));
    } else if (activeProvider === "openrouter") {
      const urlInput = el("input", {
        class: "mmc-out-field",
        type: "text",
        value: current.openrouterUrl || "https://openrouter.ai/api/v1",
        placeholder: "https://openrouter.ai/api/v1",
        spellcheck: "false",
        onchange: (e) => {
          saveSettings({ openrouterUrl: e.target.value.trim() });
          changed();
          drawModels(true);
        },
      });
      const keyInput = el("input", {
        class: "mmc-out-field",
        type: "password",
        value: current.openrouterKey || "",
        placeholder: "sk-or-v1-...",
        spellcheck: "false",
        onchange: (e) => {
          saveSettings({ openrouterKey: e.target.value.trim() });
          changed();
          drawModels(true);
        },
      });
      urlRow.push(
        el("div", { class: "mmc-refine-group", style: { marginTop: "6px" } }, [
          el("span", { class: "mmc-note-key", text: t("server url") }),
          urlInput,
        ]),
        el("div", { class: "mmc-refine-group", style: { marginTop: "6px" } }, [
          el("span", { class: "mmc-note-key", text: t("api key") }),
          keyInput,
        ])
      );
    }

    providerHost.replaceChildren(
      el("span", { class: "mmc-note-key", text: t("provider") }),
      el("div", { class: "mmc-chips" }, providerBtns),
      ...urlRow,
    );
  }

  const TEMPLATES = [
    ["auto", "follows what is attached: frames pick I2VA / L2VA / FL2VA, @ references pick REF2VA, a bare prompt picks T2VA."],
    ["T2VA", "text only — the video is described from nothing."],
    ["I2VA", "first frame — the rewrite opens on the attached image and develops forward."],
    ["L2VA", "last frame — the rewrite converges on the attached image at the end."],
    ["FL2VA", "first and last frame — the rewrite is the motion path between the two."],
    ["REF2VA", "@ references — the six-section form that defines and tracks them. Follows references automatically; it cannot be pinned without them."],
  ];

  function drawTemplate() {
    if (settings().skill) {
      templateHost.replaceChildren();
      return;
    }
    const chosen = settings().template || "auto";
    templateHost.replaceChildren(
      el("span", { class: "mmc-note-key", text: t("template") }),
      el("div", { class: "mmc-chips" }, TEMPLATES.map(([name, why]) => el("button", {
        class: "mmc-chip",
        "aria-checked": name === chosen,
        text: name === "auto" ? "auto" : name.toLowerCase(),
        title: t(why),
        onclick: () => { saveSettings({ template: name }); changed(); },
      }))),
      el("div", { class: "mmc-refine-hint",
                  text: t("Which of the built-in prompt templates writes the rewrite. auto follows the request, like the weights route; the result panel says which one was used.") }),
    );
  }

  async function drawSkills(force = false) {
    const names = await listSkills({ force });
    let chosen = settings().skill;
    if (chosen && !names.includes(chosen)) {
      saveSettings({ skill: "" });
      chosen = "";
    }
    if (!names.length) {
      skillHost.replaceChildren();
      return;
    }
    const row = (label, value, kind, title) => el("button", {
      class: "mmc-opt",
      "aria-checked": value === chosen,
      title,
      onclick: () => { saveSettings({ skill: value }); changed(); drawSkills(); },
    }, [
      el("span", { class: "mmc-opt-label mmc-refine-name", text: label }),
      el("span", { class: "mmc-opt-kind", text: t(kind) }),
      el("span", { class: "mmc-radio" }),
    ]);
    skillHost.replaceChildren(
      el("span", { class: "mmc-note-key", text: t("prompting") }),
      row(t("built-in"), "", "prompt",
          t("The node's own instructions and guides, with the format assembled around the model's prose.")),
      ...names.map((name) => row(name, name, "skill",
          t("The '{name}' skill package, handed to the model as its only instruction. The model writes the whole prompt document itself — instruction line, shot markers and timestamps included — and the rewrite lands as one block.", { name }))),
      el("div", { class: "mmc-refine-hint",
                  text: t("A skill replaces the built-in prompting entirely, and rewrites one generation at a time.") }),
    );
  }

  async function drawModels(force = false) {
    const current = settings();
    const provider = current.provider || "comfy";
    let url = "";
    let apiKey = "";
    if (provider === "ollama") url = current.ollamaUrl;
    else if (provider === "openai") url = current.openaiUrl;
    else if (provider === "openrouter") {
      url = current.openrouterUrl;
      apiKey = current.openrouterKey;
    }

    modelHost.replaceChildren(el("div", { class: "mmc-refine-hint", text: t("Detecting models…") }));
    const names = await listModels({ provider, url, apiKey, force });

    if (names.error || !names.length) {
      modelHost.replaceChildren(el("div", { class: "mmc-refine-empty" }, [
        el("div", { text: names.error || t("No models detected on server.") }),
        el("button", { class: "mmc-ghost", text: t("Detect again"), onclick: () => drawModels(true) }),
      ]));
      return;
    }

    const filterInput = el("input", {
      class: "mmc-out-field",
      type: "search",
      placeholder: t("Search model name..."),
      spellcheck: "false",
      style: { marginBottom: "8px", width: "100%", boxSizing: "border-box" },
      oninput: (e) => {
        const query = e.target.value.toLowerCase().trim();
        renderList(query);
      },
      onpointerdown: (e) => e.stopPropagation(),
      onkeydown: (e) => e.stopPropagation(),
    });

    const listContainer = el("div", { class: "mmc-refine-models" });

    const renderList = (filterQuery = "") => {
      const chosen = chosenModel();
      const filtered = filterQuery
        ? names.filter((n) => n.toLowerCase().includes(filterQuery))
        : names;

      if (!filtered.length) {
        listContainer.replaceChildren(el("div", { class: "mmc-refine-hint", text: t("No matching models.") }));
        return;
      }

      listContainer.replaceChildren(...filtered.map((name) => el("button", {
        class: "mmc-opt",
        "aria-checked": name === chosen,
        title: name,
        onclick: () => { saveSettings({ model: name }); changed(); drawModels(); },
      }, [
        el("span", { class: "mmc-opt-label mmc-refine-name", text: name }),
        el("span", { class: "mmc-radio" }),
      ])));
    };

    modelHost.replaceChildren(filterInput, listContainer);
    renderList();
  }

  function drawMore() {
    const current = settings();
    const chip = (name) => el("button", {
      class: "mmc-chip",
      "aria-checked": name === current.language,
      text: t(name),
      onclick: () => { saveSettings({ language: name }); changed(); },
    });

    const random = current.seed < 0;
    moreHost.replaceChildren(
      el("div", { class: "mmc-refine-group" }, [
        el("span", { class: "mmc-note-key", text: t("language") }),
        el("div", { class: "mmc-chips" }, LANGUAGES.map(chip)),
        el("div", { class: "mmc-refine-hint",
                    text: t("The prose and the dialogue. Field names, labels and camera terms stay English.") }),
      ]),
      el("div", { class: "mmc-refine-group" }, [
        el("span", { class: "mmc-note-key", text: t("reply length") }),
        el("div", { class: "mmc-refine-row" }, [
          stepperPill({
            value: Number(current.maxTokens), ...TOKENS, width: "62px",
            title: t("How many tokens the rewrite may run to. Raise it if a whole-timeline refine comes back cut off; there is no cost to a model that stops early."),
            format: (n) => t("{n}k tokens", { n: Math.round(n / 1024) }),
            onChange: (next) => { saveSettings({ maxTokens: next }); changed(); },
          }),
        ]),
        el("div", { class: "mmc-refine-hint",
                    text: t("The answer's budget, not a context size — the prompt is never truncated to fit, however long it gets.") }),
      ]),
      el("div", { class: "mmc-refine-group" }, [
        el("span", { class: "mmc-note-key", text: t("sampling") }),
        el("div", { class: "mmc-refine-row" }, [
          stepperPill({
            value: Number(current.temperature), min: 0, max: 2, step: 0.05, width: "58px",
            title: t("Lower keeps closer to your wording; higher invents more around it."),
            format: (n) => t("temp {n}", { n: n.toFixed(2) }),
            onChange: (next) => { saveSettings({ temperature: next }); changed(); },
          }),
          el("div", { class: "mmc-pill mmc-pill-group" }, [
            el("button", {
              class: "mmc-step mmc-seed-dice",
              title: random ? t("Fix the seed at a number") : t("Roll a new seed now"),
              onclick: () => {
                saveSettings({ seed: Math.floor(Math.random() * 0x7fffffff) });
                changed();
              },
            }, [icon("dice", 15)]),
            el("button", {
              class: "mmc-ghost mmc-refine-seed",
              text: random ? t("new every time") : String(current.seed),
              title: random
                ? t("Every refine comes out differently. Click to fix it.")
                : t("Refining the same prompt gives the same rewrite. Click to vary it again."),
              onclick: () => {
                saveSettings({ seed: random ? Math.floor(Math.random() * 0x7fffffff) : -1 });
                changed();
              },
            }),
          ]),
        ]),
      ]),
    );
  }

  pop.append(
    el("div", { class: "mmc-pop-title", text: t("Refiner") }),
    providerHost,
    modelHost,
    el("div", { class: "mmc-refine-hint mmc-refine-note",
                text: t("Selected LLM model for refining prompts.") }),
    skillHost,
    templateHost,
    el("details", { class: "mmc-refine-fold" }, [
      el("summary", { text: t("Language and sampling") }),
      moreHost,
    ]),
  );

  document.body.appendChild(pop);
  placeNear(pop, anchor);
  dismissable(pop);
  drawProvider();
  drawModels();
  drawSkills();
  drawTemplate();
  drawMore();
}

export class RefinePanel {
  constructor({ getState, onCommit, audioFields = true, onRevert = null, getNodeId = null }) {
    this.getState = getState;
    this.onCommit = onCommit;
    this.audioFields = audioFields;
    this.onRevert = onRevert;
    this.getNodeId = getNodeId;
    this.problems = [];
    this.seen = "";
    this.collapsed = false;

    this.isStreaming = false;
    this.streamThought = "";
    this.streamContent = "";
    this.tokenCount = 0;
    this.tokenSpeed = 0;

    this.root = el("div", { class: "mmc-refined" });
    this.bodyBox = null;

    this.onStreamEvent = (event) => this.handleStream(event.detail);
    api.addEventListener("mmc_refine_stream", this.onStreamEvent);

    this.render();
  }

  destroy() {
    api.removeEventListener("mmc_refine_stream", this.onStreamEvent);
  }

  handleStream(detail) {
    if (!detail) return;
    const targetNode = this.getNodeId?.() ? String(this.getNodeId()) : "";
    if (detail.node && targetNode && String(detail.node) !== targetNode) return;

    if (detail.done) {
      this.isStreaming = false;
      this.render();
      return;
    }

    if (!this.isStreaming) {
      this.isStreaming = true;
      this.streamThought = "";
      this.streamContent = "";
    }

    if (detail.is_thought) {
      this.streamThought += detail.chunk || "";
    } else {
      this.streamContent += detail.chunk || "";
    }

    this.tokenCount = Number(detail.token_count || 0);
    this.tokenSpeed = Number(detail.speed || 0);
    this.renderLiveStream();
  }

  renderLiveStream() {
    if (!this.isStreaming) return;

    const meter = el("span", {
      class: "mmc-stream-meter",
      text: `${this.tokenCount} tokens · ${this.tokenSpeed} t/s`,
    });

    const cancelBtn = el("button", {
      class: "mmc-ghost mmc-stream-cancel-btn",
      text: t("✕ Cancel"),
      title: t("Abort generation"),
      onclick: () => {
        cancelRefine(this.getNodeId?.() || "");
        this.isStreaming = false;
        this.render();
      },
    });

    const head = el("div", { class: "mmc-stream-head" }, [
      el("span", { class: "mmc-refine-spinner" }),
      el("span", { class: "mmc-stream-label", text: t("Live AI Streaming...") }),
      el("span", { style: { flex: "1" } }),
      meter,
      cancelBtn,
    ]);

    const parts = [head];

    if (this.streamThought) {
      const thoughtBlock = el("div", { class: "mmc-stream-thought-text", text: this.streamThought });
      const fold = el("details", { class: "mmc-refined-fold mmc-stream-thought-fold", open: true }, [
        el("summary", { text: t("🧠 Model Thinking / Reasoning") }),
        thoughtBlock,
      ]);
      parts.push(fold);
      setTimeout(() => { thoughtBlock.scrollTop = thoughtBlock.scrollHeight; }, 0);
    }

    if (this.streamContent) {
      const liveBox = el("div", { class: "mmc-stream-live-box" }, [
        el("span", { text: this.streamContent }),
        el("span", { class: "mmc-stream-cursor", text: "█" }),
      ]);
      parts.push(liveBox);
      setTimeout(() => { liveBox.scrollTop = liveBox.scrollHeight; }, 0);
    }

    this.root.replaceChildren(...parts);
  }

  get refined() {
    return this.getState().refined || null;
  }

  apply(result, shot) {
    this.isStreaming = false;
    const state = this.getState();
    const replaced = this.refined?.replaced ?? {
      prompt: state.prompt ?? "",
      soundscape: state.soundscape ?? "",
      music: state.music ?? "",
    };

    state.refined = {
      body: shot.body,
      scope: "shot",
      ...(result.sections ? { sections: result.sections } : {}),
      ...(result.skill ? { skill: result.skill } : {}),
      ...(result.template ? { template: result.template, forced: !result.forced } : {}),
      source: state.prompt ?? "",
      model: chosenModel(),
      enabled: true,
      replaced,
    };

    if (shot.soundscape !== undefined && shot.soundscape !== "") state.soundscape = shot.soundscape;
    else if (result.soundscape) state.soundscape = result.soundscape;

    if (shot.music !== undefined && shot.music !== "") state.music = shot.music;
    else if (result.music) state.music = result.music;

    this.seen = result.seen ?? "";
    this.problems = result.problems ?? [];
    this.render();
  }

  fail(message) {
    this.isStreaming = false;
    this.problems = [message];
    this.render();
  }

  clear() {
    this.isStreaming = false;
    const state = this.getState();
    const replaced = state.refined?.replaced;
    delete state.refined;

    if (replaced) {
      if (replaced.prompt !== undefined) state.prompt = replaced.prompt;
      state.soundscape = replaced.soundscape ?? "";
      state.music = replaced.music ?? "";
    } else {
      state.soundscape = "";
      state.music = "";
    }

    this.seen = "";
    this.problems = [];
    this.onCommit?.();
    this.onRevert?.();
    this.render();
  }

  get stale() {
    const refined = this.refined;
    return !refined && (refined.source ?? "") !== (this.getState().prompt ?? "");
  }

  getFullPromptText() {
    const state = this.getState();
    const refined = this.refined;
    if (!refined) return state.prompt || "";
    
    const parts = [];
    if (refined.sections) {
      for (const [name, text] of Object.entries(refined.sections)) {
        if (text && text.trim()) parts.push(`${name}:\n${text.trim()}`);
      }
    }
    if (refined.body && refined.body.trim()) {
      const isRef = Boolean(refined.sections);
      const header = isRef ? "detailed_description:" : "integrated_multimodal_description:";
      parts.push(`${header}\n${refined.body.trim()}`);
    }
    if (state.soundscape && state.soundscape.trim()) {
      parts.push(`overall_soundscape:\n${state.soundscape.trim()}`);
    }
    if (state.music && state.music.trim()) {
      parts.push(`non_diegetic_music:\n${state.music.trim()}`);
    }
    return parts.join("\n\n");
  }

  textarea(get, set, { rows = 3, placeholder = "", className = "mmc-refined-box" }) {
    const box = el("textarea", {
      class: className,
      rows: String(rows),
      placeholder,
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
      autocomplete: "off",
      value: get() ?? "",
      oninput: (event) => { set(event.target.value); this.onCommit?.(); },
    });
    box.value = get() ?? "";
    for (const name of ["pointerdown", "keydown", "keyup", "paste", "copy", "cut"]) {
      box.addEventListener(name, (event) => event.stopPropagation());
    }
    return box;
  }

  render() {
    if (this.isStreaming) {
      this.renderLiveStream();
      return;
    }

    const state = this.getState();
    const refined = this.refined;
    const audio = Boolean(state.soundscape?.trim() || state.music?.trim());
    if (!refined && !audio && !this.problems.length) {
      this.root.replaceChildren();
      return;
    }

    const parts = [];
    if (refined) {
      const on = refined.enabled !== false;
      
      const copyBtn = el("button", {
        class: "mmc-ghost mmc-copy-btn",
        style: { fontSize: "11px" },
        text: t("📋 Copy all"),
        title: t("Copy full Context-IR formatted prompt"),
        onclick: async () => {
          const full = this.getFullPromptText();
          if (full) {
            await navigator.clipboard?.writeText(full);
            copyBtn.textContent = t("✓ Copied all");
            setTimeout(() => { copyBtn.textContent = t("📋 Copy all"); }, 1500);
          }
        },
      });

      parts.push(el("div", { class: "mmc-refined-head" }, [
        el("button", {
          class: `mmc-refined-toggle${on ? " on" : ""}`,
          title: on ? t("Rewrite active") : t("Rewrite off"),
          onclick: () => {
            refined.enabled = !on;
            this.onCommit?.();
            this.render();
          },
        }, [el("span", { class: "mmc-dot" }), el("span", { text: on ? t("refined (active)") : t("refined (off)") })]),
        ...(refined.model ? [el("span", { class: "mmc-refined-model", text: refined.model })] : []),
        ...(refined.template ? [el("span", { class: "mmc-refined-model", text: refined.template.toLowerCase() })] : []),
        el("span", { style: { flex: "1" } }),
        copyBtn,
        el("button", {
          class: "mmc-ghost",
          style: { fontSize: "11px" },
          text: this.collapsed ? t("Expand") : t("Collapse"),
          onclick: () => { this.collapsed = !this.collapsed; this.render(); },
        }),
        el("button", {
          class: "mmc-ghost",
          style: { fontSize: "11px" },
          text: t("Revert"),
          onclick: () => this.clear(),
        }),
      ]));

      if (!this.collapsed) {
        if (this.seen) {
          parts.push(el("details", { class: "mmc-refined-fold" }, [
            el("summary", { text: t("👁 What the model saw in your images") }),
            el("div", { class: "mmc-refined-seen", text: this.seen }),
          ]));
        }

        const words = (refined.body || "").trim().split(/\s+/).filter(Boolean).length;
        const chars = (refined.body || "").length;
        const wordBadge = el("span", { class: "mmc-refined-wordcount", text: `${words} words · ${chars} chars` });

        this.bodyBox = this.textarea(
          () => refined.body,
          (value) => { 
            refined.body = value;
            const w = value.trim().split(/\s+/).filter(Boolean).length;
            const c = value.length;
            wordBadge.textContent = `${w} words · ${c} chars`;
          },
          { rows: 5, placeholder: t("The rewritten description.") });
        
        const statusRow = el("div", { class: "mmc-refined-status-row" }, [
          wordBadge,
        ]);

        parts.push(el("div", { class: "mmc-refined-hero" }, [
          this.bodyBox,
          statusRow,
        ]));

        if (refined.sections) {
          const sections = el("div", { class: "mmc-refined-sections" });
          for (const name of ["subject_definitions", "summary", "retention_analysis"]) {
            sections.append(el("label", { class: "mmc-refined-section" }, [
              el("span", { class: "mmc-tl-field-name", text: name }),
              this.textarea(
                () => refined.sections[name],
                (value) => { refined.sections[name] = value; },
                { rows: 3, className: "mmc-refined-sub-box" }),
            ]));
          }
          const fold = el("details", { class: "mmc-refined-fold" }, [
            el("summary", { text: t("🏷 Reference Analysis & Retention") }),
            sections,
          ]);
          fold.open = true;
          parts.push(fold);
        }
      }
    }

    if (refined || audio) {
      parts.push(el("div", { class: "mmc-tl-audio" }, [
        el("label", { class: "mmc-tl-field" }, [
          el("span", { class: "mmc-tl-field-name", text: "overall_soundscape" }),
          this.textarea(
            () => state.soundscape,
            (value) => { state.soundscape = value; },
            { rows: 2, className: "mmc-refined-sub-box", placeholder: t("Ambient noise, action sounds in this shot...") }),
        ]),
        el("label", { class: "mmc-tl-field" }, [
          el("span", { class: "mmc-tl-field-name", text: "non_diegetic_music" }),
          this.textarea(
            () => state.music,
            (value) => { state.music = value; },
            { rows: 2, className: "mmc-refined-sub-box", placeholder: t("Music, background score for this shot...") }),
        ]),
      ]));
    }

    for (const problem of this.problems) {
      parts.push(el("div", { class: "mmc-warn", text: problem }));
    }
    this.root.replaceChildren(...parts);
  }
}

export function refineButton({ run, label = "Refine", title, mode = "auto", className = "" }) {
  let busy = false;

  let effectiveMode = mode;
  if (effectiveMode === "auto") {
    if (className.includes("micro")) effectiveMode = "micro";
    else if (className.includes("pill") || className.includes("deck") || className.includes("nle")) effectiveMode = "pill";
    else if (className.includes("tool") && !className.includes("micro")) effectiveMode = "rail";
    else effectiveMode = "pill";
  }

  const spinner = el("span", { class: "mmc-refine-spinner", style: { display: "none" } });
  const brainIcon = icon("brain", effectiveMode === "micro" ? 13 : effectiveMode === "pill" ? 14 : 20);
  const text = el("span", { text: t(label) });

  let btnContent;
  let btnClass;

  if (effectiveMode === "rail") {
    btnContent = [el("span", { class: "mmc-tool-icon" }, [spinner, brainIcon]), text];
    btnClass = "mmc-tool";
  } else if (effectiveMode === "micro") {
    btnContent = [spinner, brainIcon, text];
    btnClass = `mmc-micro-tool mmc-micro-refine ${className}`.trim();
  } else {
    btnContent = [spinner, brainIcon, text];
    btnClass = `mmc-nle-deck-refine-btn ${className}`.trim();
  }

  const button = el("button", {
    class: btnClass,
    title: title || t("Rewrite prompt with Context-IR AI refiner"),
    onclick: async (e) => {
      e.stopPropagation();
      if (busy) return;
      busy = true;
      button.classList.add("busy");
      spinner.style.display = "inline-block";
      brainIcon.style.display = "none";
      text.textContent = t("Refining…");
      try {
        await run();
      } finally {
        busy = false;
        button.classList.remove("busy");
        spinner.style.display = "none";
        brainIcon.style.display = "";
        text.textContent = t(label);
      }
    },
  }, btnContent);

  const moreClass = effectiveMode === "micro"
    ? "mmc-micro-more"
    : effectiveMode === "pill"
      ? "mmc-refine-pill-more"
      : "mmc-refine-more";

  const more = el("button", {
    class: moreClass,
    title: chosenModel()
      ? t("{model} — click to change model settings", { model: chosenModel() })
      : t("Choose refiner model"),
    onclick: (event) => {
      event.stopPropagation();
      openSettings(event.currentTarget, () => {
        more.title = chosenModel()
          ? t("{model} — click to change model settings", { model: chosenModel() })
          : t("Choose refiner model");
      });
    },
  }, [icon("chevron", effectiveMode === "micro" ? 9 : 10)]);

  if (effectiveMode === "micro") {
    return el("div", { class: "mmc-micro-refine-group" }, [button, more]);
  }

  if (effectiveMode === "pill") {
    return el("div", { class: "mmc-refine-split pill" }, [button, more]);
  }

  return el("div", { class: "mmc-tool mmc-refine-split" }, [button, more]);
}