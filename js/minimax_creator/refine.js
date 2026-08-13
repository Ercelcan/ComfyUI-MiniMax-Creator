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
  constructor({ getState, onCommit, audioFields = true, onRevert = null }) {
    this.getState = getState;
    this.onCommit = onCommit;
    this.audioFields = audioFields;
    this.onRevert = onRevert;
    this.problems = [];
    this.seen = "";
    this.root = el("div", { class: "mmc-refined" });
    this.bodyBox = null;
    this.render();
  }

  get refined() {
    return this.getState().refined || null;
  }

  apply(result, shot) {
    const state = this.getState();
    const replaced = this.refined?.replaced
      ?? { soundscape: state.soundscape ?? "", music: state.music ?? "" };

    state.refined = {
      body: shot.body,
      ...(result.scope ? { scope: result.scope } : {}),
      ...(result.sections ? { sections: result.sections } : {}),
      ...(result.skill ? { skill: result.skill } : {}),
      ...(result.template ? { template: result.template, forced: !!result.forced } : {}),
      source: state.prompt ?? "",
      model: chosenModel(),
      enabled: true,
      ...(this.audioFields ? { replaced } : {}),
    };
    if (this.audioFields) {
      state.soundscape = result.soundscape ?? "";
      state.music = result.music ?? "";
    }
    this.seen = result.seen ?? "";
    this.problems = result.problems ?? [];
    this.render();
  }

  fail(message) {
    this.problems = [message];
    this.render();
  }

  clear() {
    const state = this.getState();
    const replaced = state.refined?.replaced;
    delete state.refined;
    if (this.audioFields && replaced) {
      state.soundscape = replaced.soundscape ?? "";
      state.music = replaced.music ?? "";
    }
    this.seen = "";
    this.problems = [];
    this.onCommit?.();
    this.onRevert?.();
    this.render();
  }

  get stale() {
    const refined = this.refined;
    return !!refined && (refined.source ?? "") !== (this.getState().prompt ?? "");
  }

  textarea(get, set, { rows = 3, placeholder = "", className = "mmc-refined-box" }) {
    const box = el("textarea", {
      class: className, rows: String(rows), placeholder,
      oninput: (event) => { set(event.target.value); this.onCommit?.(); },
    });
    box.value = get() ?? "";
    for (const name of ["pointerdown", "keydown", "keyup", "paste", "copy", "cut"]) {
      box.addEventListener(name, (event) => event.stopPropagation());
    }
    return box;
  }

  render() {
    const state = this.getState();
    const refined = this.refined;
    const audio = this.audioFields && (state.soundscape?.trim() || state.music?.trim());
    if (!refined && !audio && !this.problems.length) {
      this.root.replaceChildren();
      return;
    }

    const parts = [];
    if (refined) {
      const on = refined.enabled !== false;
      parts.push(el("div", { class: "mmc-refined-head" }, [
        el("button", {
          class: `mmc-refined-toggle${on ? " on" : ""}`,
          title: on
            ? t("This rewrite is what the model will read. Click to queue your own prompt instead — the rewrite is kept.")
            : t("Your own prompt is what the model will read. Click to use the rewrite again."),
          onclick: () => {
            refined.enabled = !on;
            this.onCommit?.();
            this.render();
          },
        }, [el("span", { class: "mmc-dot" }), el("span", { text: on ? t("refined") : t("refined (off)") })]),
        ...(refined.model ? [el("span", { class: "mmc-refined-model", text: refined.model })] : []),
        ...(refined.template ? [el("span", {
          class: "mmc-refined-model",
          text: refined.forced ? t("{template} (pinned)", { template: refined.template.toLowerCase() })
                               : refined.template.toLowerCase(),
          title: refined.forced
            ? t("Written with the {template} template you pinned in the refiner's settings, not the one the attachments imply.", { template: refined.template })
            : t("Written with the {template} template, picked automatically from what is attached.", { template: refined.template }),
        })] : []),
        ...(refined.skill ? [el("span", { class: "mmc-refined-model",
                                          text: t("skill: {skill}", { skill: refined.skill }),
                                          title: t("Written by this skill package rather than the built-in prompts — the whole document, format included.") })] : []),
        ...(this.stale ? [el("span", {
          class: "mmc-refined-stale",
          text: t("prompt edited since"),
          title: t("Your prompt has changed since this was written. It still queues as it stands — refine again to fold the change in."),
        })] : []),
        el("span", { style: { flex: "1" } }),
        el("button", {
          class: "mmc-ghost", text: t("Revert"),
          title: t("Throw the rewrite away and go back to your own prompt. The soundscape and score it wrote go with it."),
          onclick: () => this.clear(),
        }),
      ]));

      parts.push(el("div", {
        class: "mmc-refined-lede",
        text: on
          ? t("Queued instead of the prompt above, not alongside it.")
          : t("Off — the prompt above is queued as you wrote it."),
      }));

      if (this.seen) {
        parts.push(el("details", { class: "mmc-refined-fold" }, [
          el("summary", { text: t("what the model saw in your images") }),
          el("div", { class: "mmc-refine-hint mmc-refined-seen", text: this.seen }),
        ]));
      }

      this.bodyBox = this.textarea(
        () => refined.body,
        (value) => { refined.body = value; },
        { rows: 8, placeholder: t("The rewritten description.") });
      parts.push(this.bodyBox);

      if (refined.sections) {
        const sections = el("div", { class: "mmc-refined-sections" });
        for (const name of ["subject_definitions", "summary", "retention_analysis"]) {
          sections.append(el("label", { class: "mmc-refined-section" }, [
            el("span", { class: "mmc-tl-field-name", text: name }),
            this.textarea(
              () => refined.sections[name],
              (value) => { refined.sections[name] = value; },
              { rows: 3, className: "mmc-refined-box mmc-tl-small" }),
          ]));
        }
        const fold = el("details", { class: "mmc-refined-fold" }, [
          el("summary", { text: t("reference analysis — where your @references are defined") }),
          sections,
        ]);
        fold.open = true;
        parts.push(fold);
      }
    }

    if (this.audioFields && (refined || audio)) {
      parts.push(el("div", { class: "mmc-tl-audio" }, [
        el("label", { class: "mmc-tl-field" }, [
          el("span", { class: "mmc-tl-field-name", text: "overall_soundscape" }),
          this.textarea(
            () => state.soundscape,
            (value) => { state.soundscape = value; },
            { rows: 3, className: "mmc-refined-box mmc-tl-small",
              placeholder: t("Everything heard in the room. Empty leaves it to the model; N/A is silence.") }),
        ]),
        el("label", { class: "mmc-tl-field" }, [
          el("span", { class: "mmc-tl-field-name", text: "non_diegetic_music" }),
          this.textarea(
            () => state.music,
            (value) => { state.music = value; },
            { rows: 3, className: "mmc-refined-box mmc-tl-small",
              placeholder: t("The score only the audience hears. Empty leaves it to the model.") }),
        ]),
      ]));
    }

    for (const problem of this.problems) {
      parts.push(el("div", { class: "mmc-warn", text: problem }));
    }
    this.root.replaceChildren(...parts);
  }
}

export function refineButton({ run, label = "Refine", title, className = "mmc-tool" }) {
  let busy = false;
  const text = el("span", { text: t(label) });
  const button = el("button", {
    class: className,
    title: title || t("Rewrite this prompt into the expanded description H3 was trained to read, keeping everything you wrote and expanding it."),
    onclick: async () => {
      if (busy) return;
      busy = true;
      button.classList.add("busy");
      text.textContent = t("Refining…");
      try {
        await run();
      } finally {
        busy = false;
        button.classList.remove("busy");
        text.textContent = t(label);
      }
    },
  }, [el("span", { class: "mmc-tool-icon" }, [icon("brain")]), text]);

  const more = el("button", {
    class: "mmc-refine-more",
    title: chosenModel()
      ? t("{model} — click to change the model, template, language or sampling", { model: chosenModel() })
      : t("Choose a model"),
    onclick: (event) => {
      event.stopPropagation();
      openSettings(event.currentTarget, () => {
        more.title = chosenModel()
          ? t("{model} — click to change the model, template, language or sampling", { model: chosenModel() })
          : t("Choose a model");
      });
    },
  }, [icon("chevron", 12)]);

  const pill = className.includes("mmc-pill");
  return el("div", { class: `mmc-refine-split${pill ? " pill" : ""}` }, [button, more]);
}