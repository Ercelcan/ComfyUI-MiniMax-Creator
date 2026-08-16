import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { el, icon, ICONS, svg, floatAbove } from "./dom.js";
import { t } from "./i18n.js";
import { openChoicePopover } from "./pills.js";
import { listModels, openSettings, settings as getRefineSettings, saveSettings } from "./refine.js";
import { viewUrl, listAssets } from "./api.js";
import * as S from "./state.js";
import { setupDragAndDrop } from "./media_drop.js";

const DIRECTOR_PERSONAS = [
  { label: "🎵 Pop Music Video", promptPrefix: "Direct this as a high-production pop music video with dynamic camera choreography, vibrant atmospheric lighting, and emotional vocal performance:" },
  { label: "🎬 35mm Cinema", promptPrefix: "Direct this as a cinematic 35mm feature film sequence with natural human motion, soft depth of field, and grounded dramatic pacing:" },
  { label: "🌌 Sci-Fi Cyberpunk", promptPrefix: "Direct this as a futuristic cyberpunk thriller with bioluminescent neon lighting, rainy reflections, and high-tech environmental Foley:" },
  { label: "🎌 Anime Action", promptPrefix: "Direct this as a high-energy anime sequence with dynamic multi-angle camera moves, dramatic speed lines, and stylized action:" },
];

const QUICK_DIRECTOR_CHIPS = [
  { label: "✂️ Script → 4 Shots", text: "Please break this concept into 4 continuous cinematic storyboard shots with seamless transition types, rich wardrobe details, camera moves, and complete lyrics:" },
  { label: "🎤 Compose Lyrics", text: "Compose an original, emotional rhyming song verse and chorus inside <d>[English] ...</d> tags for this scene:" },
  { label: "🎥 Cinematic Camera", text: "Enhance the camera choreography across this sequence using dynamic tracking, push-in, and arc movements:" },
  { label: "🌊 Soundscape Polish", text: "Generate detailed diegetic action sound effects and non-diegetic background score description for this sequence:" },
];

function sanitizeJsonKeys(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeJsonKeys);
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const cleanKey = key.trim();
    out[cleanKey] = sanitizeJsonKeys(value);
  }
  return out;
}

function extractStoryboardPayload(text) {
  if (!text) return null;

  // 1. Markdown code fence: ```json ... ```
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(text);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1]);
      if (parsed && (parsed.shots || parsed.global_prompt)) {
        return {
          payload: sanitizeJsonKeys(parsed),
          rawJson: fenced[1].trim(),
          preProse: text.slice(0, fenced.index).trim(),
          postProse: text.slice(fenced.index + fenced[0].length).trim(),
        };
      }
    } catch {}
  }

  // 2. Bare JSON object containing "shots"
  const startIdx = text.indexOf("{");
  const endIdx = text.lastIndexOf("}");
  if (startIdx >= 0 && endIdx > startIdx) {
    const candidate = text.slice(startIdx, endIdx + 1);
    if (candidate.includes('"shots"') || candidate.includes('"global_prompt"')) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && (parsed.shots || parsed.global_prompt)) {
          return {
            payload: sanitizeJsonKeys(parsed),
            rawJson: candidate.trim(),
            preProse: text.slice(0, startIdx).trim(),
            postProse: text.slice(endIdx + 1).trim(),
          };
        }
      } catch {}
    }
  }

  return null;
}

function formatTimelineContext(target) {
  if (!target) return { sheet: "", assets: [] };
  const cls = target.comfyClass || target.type || "";
  const collectedAssets = [];

  if (cls === "MiniMaxH3Timeline") {
    const timeline = target.mmcBody?.timeline;
    if (!timeline) return { sheet: "", assets: [] };
    const segments = timeline.segments || [];
    const totalDuration = S.timelineSeconds(timeline);

    const lines = [
      `[ACTIVE TIMELINE CONTEXT — ${target.title || cls} (#${target.id})]`,
      `• Canvas Specs: ${timeline.aspect || "16:9"} @ ${timeline.short_edge || 768}p · Total Timeline Length: ${totalDuration.toFixed(1)}s (${segments.length} Shots)`,
    ];

    if (timeline.prompt?.trim()) {
      lines.push(`• Global Style/Scene: "${timeline.prompt.trim()}"`);
    }
    if (timeline.soundscape?.trim()) {
      lines.push(`• Global Soundscape: "${timeline.soundscape.trim()}"`);
    }
    if (timeline.music?.trim()) {
      lines.push(`• Global Music: "${timeline.music.trim()}"`);
    }

    const bibleAssets = timeline.assets || [];
    if (bibleAssets.length) {
      const assetDescriptions = bibleAssets.map((a) => {
        collectedAssets.push(a);
        return `@${a.handle} [${a.kind}${a.role ? ` · ${a.role}` : ""}] (File: ${a.filename})`;
      });
      lines.push(`• Global Piece Bible References: ${assetDescriptions.join(", ")}`);
    }

    if (timeline.master_audio) {
      lines.push(`• Master Lip-Sync Audio Track Attached: ${timeline.master_audio.filename}`);
    }

    lines.push("• Current Timeline Shots:");
    segments.forEach((seg, idx) => {
      const dur = Number(seg.duration_s || 6.0).toFixed(1);
      const mode = S.mode(seg);
      let trans = "First Shot";
      if (idx > 0) {
        if (seg.continue) {
          trans = seg.continuity_mode === "latent_mask" ? `${seg.feather || 39}f Latent Mask` : "Keyframe Still Match";
        } else if (seg.continue_audio) {
          trans = "Hard Cut + Sound Carryover";
        } else {
          trans = "Hard Scene Cut";
        }
      }
      (seg.assets || []).forEach((a) => collectedAssets.push(a));
      const promptSnippet = (seg.prompt || "").trim() || "(empty prompt)";
      lines.push(`  - Shot ${idx + 1} (${dur}s) [${mode} · Transition: ${trans}]: "${promptSnippet}"`);
    });

    return { sheet: lines.join("\n"), assets: collectedAssets };
  }

  if (cls === "MiniMaxH3Creator") {
    const state = target.mmcBody?.state;
    if (!state) return { sheet: "", assets: [] };
    const dur = Number(state.duration_s || 6.0).toFixed(1);
    const mode = S.mode(state);
    const lines = [
      `[ACTIVE CREATOR CONTEXT — ${target.title || cls} (#${target.id})]`,
      `• Single Generation: ${state.aspect || "16:9"} @ ${state.short_edge || 768}p · Duration: ${dur}s [Mode: ${mode}]`,
      `• Current Prompt: "${(state.prompt || "").trim() || "(empty)"}"`,
    ];
    const assets = state.assets || [];
    if (assets.length) {
      const assetDescriptions = assets.map((a) => {
        collectedAssets.push(a);
        return `@${a.handle} (${a.kind}: ${a.filename})`;
      });
      lines.push(`• Attached References: ${assetDescriptions.join(", ")}`);
    }
    return { sheet: lines.join("\n"), assets: collectedAssets };
  }

  return { sheet: "", assets: [] };
}

export class DirectorBody {
  constructor({ node, widget, onCommit }) {
    this.node = node;
    this.widget = widget;
    this.onCommit = onCommit;

    this.isGenerating = false;
    this.ignoreStream = false;
    this.activeStreamText = "";
    this.activeThoughtText = "";
    this.tokenCount = 0;
    this.tokenSpeed = 0;
    this.currentNotice = null;
    this.mentionMenu = null;

    this.data = this.parseData(widget.value);

    const globalSettings = getRefineSettings();
    if (!this.data.model_config.model && globalSettings.model) {
      this.data.model_config = { ...globalSettings };
    }

    this.root = el("div", { class: "mmc-root mmc-director-root" });
    setupDragAndDrop(this.root, this);

    this.onStreamEvent = (event) => this.handleStream(event.detail);
    api.addEventListener("mmc_director_stream", this.onStreamEvent);

    this.render();
  }

  destroy() {
    api.removeEventListener("mmc_director_stream", this.onStreamEvent);
    this.mentionMenu?.remove();
  }

  parseData(raw) {
    try {
      const parsed = JSON.parse(raw || "{}");
      return {
        version: 1,
        target_peer: parsed.target_peer ?? null,
        model_config: { ...getRefineSettings(), ...(parsed.model_config || {}) },
        history: Array.isArray(parsed.history) ? parsed.history : [],
        last_timeline_payload: parsed.last_timeline_payload ?? null,
        last_single_prompt: parsed.last_single_prompt ?? "",
      };
    } catch {
      return {
        version: 1,
        target_peer: null,
        model_config: getRefineSettings(),
        history: [],
        last_timeline_payload: null,
        last_single_prompt: "",
      };
    }
  }

  commit() {
    this.widget.value = JSON.stringify(this.data, null, 2);
    this.onCommit?.();
  }

  findAvailableTargets() {
    const graph = this.node?.graph || app.graph;
    if (!graph) return [];
    return (graph._nodes || []).filter((n) => {
      if (n === this.node) return false;
      const cls = n.comfyClass || n.type || "";
      return cls === "MiniMaxH3Timeline" || cls === "MiniMaxH3Creator";
    });
  }

  getTargetNode() {
    const targets = this.findAvailableTargets();
    if (!targets.length) return null;
    if (this.data.target_peer != null) {
      const match = targets.find((n) => String(n.id) === String(this.data.target_peer));
      if (match) return match;
    }
    return targets[0];
  }

  async unloadVRAM() {
    const cfg = this.data.model_config;
    try {
      const resp = await api.fetchApi("/minimax_creator/director/vram_unload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: cfg.provider || "ollama",
          url: cfg.ollamaUrl || "http://localhost:11434",
          model: cfg.model || "",
        }),
      });
      const res = await resp.json();
      if (res.ok) {
        this.flashNotice(t("✓ LLM unloaded from VRAM. GPU ready for H3 sampling."));
      }
    } catch (err) {
      this.flashNotice(t("VRAM unload failed: {err}", { err: err.message || err }), true);
    }
  }

  flashNotice(msg, isError = false) {
    this.currentNotice = { msg, isError };
    if (this.noticeEl) {
      this.noticeEl.textContent = msg;
      this.noticeEl.className = `mmc-director-notice${isError ? " error" : ""}`;
      this.noticeEl.style.display = "block";
    }
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.currentNotice = null;
      if (this.noticeEl) this.noticeEl.style.display = "none";
    }, 5000);
  }

  handleStream(detail) {
    if (!detail || this.ignoreStream) return;
    if (detail.node && String(detail.node) !== String(this.node.id)) return;

    if (detail.done) {
      this.isGenerating = false;
      if (detail.error && !this.ignoreStream) {
        this.flashNotice(`Error: ${detail.error}`, true);
      }
      this.ignoreStream = false;
      this.render();
      return;
    }

    this.isGenerating = true;
    if (detail.is_thought) {
      this.activeThoughtText += detail.chunk || "";
    } else {
      this.activeStreamText += detail.chunk || "";
    }
    this.tokenCount = Number(detail.token_count || 0);
    this.tokenSpeed = Number(detail.speed || 0);

    this.updateStreamLiveView();
  }

  updateStreamLiveView() {
    if (!this.chatStreamContainer) return;
    let liveMsg = this.chatStreamContainer.querySelector(".mmc-director-live-msg");
    if (!liveMsg) {
      liveMsg = el("div", { class: "mmc-director-msg assistant mmc-director-live-msg" });
      this.chatStreamContainer.appendChild(liveMsg);
    }

    const parts = [];

    if (this.activeThoughtText) {
      const thoughtBlock = el("div", { class: "mmc-director-thought-text", text: this.activeThoughtText });
      const fold = el("details", { class: "mmc-director-thought-fold", open: true }, [
        el("summary", { text: t("🧠 Model Thinking / Reasoning") }),
        thoughtBlock,
      ]);
      parts.push(fold);
      setTimeout(() => { thoughtBlock.scrollTop = thoughtBlock.scrollHeight; }, 0);
    }

    if (this.activeStreamText) {
      const formatted = this.renderAssistantMessageContent(this.activeStreamText);
      parts.push(formatted);
    }

    liveMsg.replaceChildren(...parts);
    this.chatStreamContainer.scrollTop = this.chatStreamContainer.scrollHeight;

    if (this.liveMeterEl) {
      this.liveMeterEl.textContent = `${this.tokenCount} tokens · ${this.tokenSpeed} t/s`;
      this.liveMeterEl.style.display = "inline-block";
    }
  }

  async sendMessage(customText = null) {
    if (this.isGenerating) return;

    const model = (this.data.model_config?.model || "").trim();
    if (!model) {
      this.flashNotice(t("Please select an LLM model first!"), true);
      const modelBtn = this.root.querySelector(".mmc-director-model-pill");
      if (modelBtn) {
        openSettings(modelBtn, () => {
          this.data.model_config = getRefineSettings();
          this.commit();
          this.render();
        });
      }
      return;
    }

    const text = customText ?? (this.inputBox?.value || "").trim();
    if (!text) return;

    if (this.inputBox) this.inputBox.value = "";
    this.mentionMenu?.remove();

    this.data.history.push({ role: "user", content: text, timestamp: Date.now() });
    this.isGenerating = true;
    this.ignoreStream = false;
    this.activeStreamText = "";
    this.activeThoughtText = "";
    this.tokenCount = 0;
    this.tokenSpeed = 0;

    this.render();

    try {
      const target = this.getTargetNode();
      const { sheet: contextSheet, assets } = formatTimelineContext(target);

      let enrichedMessage = text;
      if (contextSheet) {
        enrichedMessage += `\n\n${contextSheet}`;
      }

      const msgsToSend = this.data.history.map((m, idx) => ({
        role: m.role,
        content: idx === this.data.history.length - 1 ? enrichedMessage : m.content,
      }));

      const resp = await api.fetchApi("/minimax_creator/director/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_id: String(this.node.id),
          messages: msgsToSend,
          model_config: this.data.model_config,
          assets,
        }),
      });

      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || "Director request failed");

      if (!this.ignoreStream) {
        this.data.history.push({
          role: "assistant",
          content: body.content,
          thought: this.activeThoughtText,
          timestamp: Date.now(),
        });

        const extracted = extractStoryboardPayload(body.content);
        if (extracted?.payload) {
          this.data.last_timeline_payload = extracted.payload;
        }

        this.commit();
      }
    } catch (err) {
      if (!this.ignoreStream) {
        this.flashNotice(t("Chat error: {err}", { err: err.message || err }), true);
      }
    } finally {
      this.isGenerating = false;
      this.ignoreStream = false;
      this.activeStreamText = "";
      this.activeThoughtText = "";
      this.render();
    }
  }

  async cancelChat() {
    this.ignoreStream = true;
    this.isGenerating = false;
    try {
      await api.fetchApi("/minimax_creator/director/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: String(this.node.id) }),
      });
    } catch {}
    this.flashNotice(t("Generation stopped."));
    this.render();
  }

  pushStoryboardToTimeline(payload) {
    const target = this.getTargetNode();
    if (!target) {
      this.flashNotice(t("No target Timeline/Creator node selected."), true);
      return;
    }

    const cls = target.comfyClass || target.type || "";

    // 1. Target is Creator Node
    if (cls === "MiniMaxH3Creator") {
      const body = target.mmcBody;
      if (!body) return;
      const shotBody = payload.shots?.[0]?.body || payload.global_prompt || "";
      if (shotBody) {
        body.state.refined = {
          body: shotBody,
          scope: "shot",
          enabled: true,
          source: body.state.prompt || "",
          replaced: {
            prompt: body.state.prompt || "",
            soundscape: body.state.soundscape || "",
            music: body.state.music || "",
          },
        };
        body.state.prompt = shotBody;
        body.prompt?.setValue(shotBody);
      }
      if (payload.overall_soundscape) body.state.soundscape = payload.overall_soundscape;
      if (payload.non_diegetic_music) body.state.music = payload.non_diegetic_music;
      body.commit?.();
      this.flashNotice(t("🚀 Prompt pushed to {target}!", { target: target.title || cls }));
      return;
    }

    // 2. Target is Timeline Node
    const tBody = target.mmcBody;
    const timeline = tBody?.timeline;
    if (!timeline) return;

    tBody.pushUndoSnapshot?.("Apply Director Storyboard");

    if (payload.global_prompt) {
      timeline.refined = {
        body: payload.global_prompt,
        enabled: true,
        source: timeline.prompt || "",
        replaced: {
          prompt: timeline.prompt || "",
          soundscape: timeline.soundscape || "",
          music: timeline.music || "",
        },
      };
      timeline.prompt = payload.global_prompt;
      tBody.promptBox?.setValue(payload.global_prompt);
    }
    if (payload.overall_soundscape) timeline.soundscape = payload.overall_soundscape;
    if (payload.non_diegetic_music) timeline.music = payload.non_diegetic_music;

    if (Array.isArray(payload.shots) && payload.shots.length) {
      timeline.segments = payload.shots.map((shot, idx) => {
        const origSeg = (timeline.segments || [])[idx] || {};
        const seg = S.emptySegment();
        seg.duration_s = Number(shot.duration_s || origSeg.duration_s || 6.0);
        seg.prompt = shot.body || "";
        seg.soundscape = shot.soundscape || "";
        seg.music = shot.music || "";

        seg.refined = {
          body: shot.body || "",
          scope: "shot",
          enabled: true,
          source: origSeg.prompt || "",
          replaced: {
            prompt: origSeg.prompt || "",
            soundscape: origSeg.soundscape || "",
            music: origSeg.music || "",
          },
        };

        const trans = String(shot.transition || "").toLowerCase();
        if (idx > 0) {
          if (trans.includes("39")) {
            seg.continue = true;
            seg.feather = 39;
            seg.continuity_mode = "latent_mask";
            seg.continue_audio = true;
          } else if (trans.includes("22")) {
            seg.continue = true;
            seg.feather = 22;
            seg.continuity_mode = "latent_mask";
            seg.continue_audio = true;
          } else if (trans.includes("match") || trans.includes("still")) {
            seg.continue = true;
            seg.feather = 22;
            seg.continuity_mode = "keyframe_still";
            seg.continue_audio = true;
          } else if (trans.includes("sound") || trans.includes("audio")) {
            seg.continue = false;
            seg.continue_audio = true;
          } else {
            seg.continue = false;
            seg.continue_audio = false;
          }
        }
        return seg;
      });
      tBody.selectedShotIndex = 0;
    }

    tBody.commit?.();
    this.flashNotice(t("🚀 Storyboard pushed to {target}!", { target: target.title || cls }));
  }

  applySingleShotToTimeline(shot, shotIndex) {
    const target = this.getTargetNode();
    if (!target?.mmcBody) return;

    const cls = target.comfyClass || target.type || "";
    if (cls === "MiniMaxH3Creator") {
      target.mmcBody.state.refined = {
        body: shot.body || "",
        scope: "shot",
        enabled: true,
        source: target.mmcBody.state.prompt || "",
        replaced: {
          prompt: target.mmcBody.state.prompt || "",
          soundscape: target.mmcBody.state.soundscape || "",
          music: target.mmcBody.state.music || "",
        },
      };
      target.mmcBody.state.prompt = shot.body || "";
      target.mmcBody.prompt?.setValue(shot.body || "");
      if (shot.soundscape) target.mmcBody.state.soundscape = shot.soundscape;
      if (shot.music) target.mmcBody.state.music = shot.music;
      target.mmcBody.commit?.();
      this.flashNotice(t("⚡ Applied Shot to Creator node!"));
      return;
    }

    const tBody = target.mmcBody;
    const timeline = tBody.timeline;
    if (!timeline) return;

    tBody.pushUndoSnapshot?.(`Update Shot ${shotIndex + 1}`);

    if (shotIndex < (timeline.segments || []).length) {
      const seg = timeline.segments[shotIndex];
      seg.duration_s = Number(shot.duration_s || seg.duration_s || 6.0);
      seg.refined = {
        body: shot.body || "",
        scope: "shot",
        enabled: true,
        source: seg.prompt || "",
        replaced: {
          prompt: seg.prompt || "",
          soundscape: seg.soundscape || "",
          music: seg.music || "",
        },
      };
      seg.prompt = shot.body || "";
      if (shot.soundscape) seg.soundscape = shot.soundscape;
      if (shot.music) seg.music = shot.music;
      tBody.selectedShotIndex = shotIndex;
      tBody.commit?.();
      this.flashNotice(t("⚡ Shot {n} updated on Timeline!", { n: shotIndex + 1 }));
    } else {
      const seg = S.emptySegment();
      seg.duration_s = Number(shot.duration_s || 6.0);
      seg.prompt = shot.body || "";
      seg.refined = {
        body: shot.body || "",
        scope: "shot",
        enabled: true,
        source: "",
        replaced: { prompt: "", soundscape: "", music: "" },
      };
      if (shot.soundscape) seg.soundscape = shot.soundscape;
      if (shot.music) seg.music = shot.music;
      timeline.segments.push(seg);
      tBody.selectedShotIndex = timeline.segments.length - 1;
      tBody.commit?.();
      this.flashNotice(t("⚡ Added as Shot {n} on Timeline!", { n: timeline.segments.length }));
    }
  }

  render() {
    const header = this.renderHeader();
    const historyView = this.renderChatHistory();
    const personas = this.renderPersonas();
    const quickChips = this.renderQuickChips();
    const inputArea = this.renderInputArea();

    this.noticeEl = el("div", {
      class: `mmc-director-notice${this.currentNotice?.isError ? " error" : ""}`,
      text: this.currentNotice?.msg || "",
      style: { display: this.currentNotice ? "block" : "none" },
    });

    this.root.replaceChildren(
      header,
      this.noticeEl,
      historyView,
      personas,
      quickChips,
      inputArea
    );
  }

  renderHeader() {
    const targets = this.findAvailableTargets();
    const currentTarget = this.getTargetNode();

    const targetPicker = el("button", {
      class: "mmc-pill",
      title: t("Select which Timeline/Creator node to direct"),
      onclick: (e) => {
        const options = targets.map((n) => `${n.title || n.comfyClass || n.type} (#${n.id})`);
        const curLabel = currentTarget ? `${currentTarget.title || currentTarget.comfyClass || currentTarget.type} (#${currentTarget.id})` : t("None");
        openChoicePopover(e.currentTarget, {
          title: t("Target Node"),
          options,
          value: curLabel,
          onPick: (picked) => {
            const match = targets.find((n) => `${n.title || n.comfyClass || n.type} (#${n.id})` === picked);
            if (match) {
              this.data.target_peer = match.id;
              this.commit();
              this.render();
            }
          },
        });
      },
    }, [
      icon("timeline", 14),
      el("span", { text: currentTarget ? `Target: #${currentTarget.id}` : t("No Target") }),
    ]);

    const modelCfg = this.data.model_config;
    const modelPill = el("button", {
      class: `mmc-pill mmc-director-model-pill${modelCfg.model ? " on" : ""}`,
      title: t("Director LLM Model settings"),
      onclick: (e) => {
        openSettings(e.currentTarget, () => {
          this.data.model_config = getRefineSettings();
          this.commit();
          this.render();
        });
      },
    }, [
      icon("brain", 14),
      el("span", { text: modelCfg.model ? modelCfg.model.split("/").pop() : t("Select Model") }),
    ]);

    const freeVramBtn = el("button", {
      class: "mmc-nle-btn",
      title: t("Unload LLM from GPU memory immediately"),
      onclick: () => this.unloadVRAM(),
    }, [icon("broom", 13), el("span", { text: t("Free VRAM") })]);

    const clearChatBtn = el("button", {
      class: "mmc-nle-btn",
      title: t("Clear chat history"),
      onclick: () => {
        this.data.history = [];
        this.commit();
        this.render();
      },
    }, [icon("trash", 13)]);

    return el("div", { class: "mmc-director-header" }, [
      el("span", { class: "mmc-nle-tag", text: "DIRECTOR" }),
      targetPicker,
      modelPill,
      freeVramBtn,
      el("span", { style: { flex: "1" } }),
      clearChatBtn,
    ]);
  }

  renderChatHistory() {
    this.chatStreamContainer = el("div", { class: "mmc-director-chat-stream" });

    if (!this.data.history.length && !this.isGenerating) {
      this.chatStreamContainer.appendChild(el("div", {
        class: "mmc-empty",
        text: t("Chat with your AI Director to brainstorm scenes, structure shots, write lyrics, and build Context-IR timelines."),
      }));
      return this.chatStreamContainer;
    }

    for (const msg of this.data.history) {
      const isUser = msg.role === "user";
      const item = el("div", { class: `mmc-director-msg ${isUser ? "user" : "assistant"}` });

      if (isUser) {
        item.appendChild(el("div", { class: "mmc-director-user-text", text: msg.content }));
      } else {
        const parts = [];
        if (msg.thought) {
          parts.push(el("details", { class: "mmc-director-thought-fold" }, [
            el("summary", { text: t("🧠 Model Thinking / Reasoning") }),
            el("div", { class: "mmc-director-thought-text", text: msg.thought }),
          ]));
        }

        const formatted = this.renderAssistantMessageContent(msg.content);
        parts.push(formatted);
        item.replaceChildren(...parts);
      }
      this.chatStreamContainer.appendChild(item);
    }

    setTimeout(() => {
      this.chatStreamContainer.scrollTop = this.chatStreamContainer.scrollHeight;
    }, 0);

    return this.chatStreamContainer;
  }

  renderAssistantMessageContent(text) {
    const container = el("div", { class: "mmc-director-content-box" });
    const extracted = extractStoryboardPayload(text);

    if (extracted) {
      if (extracted.preProse) {
        container.appendChild(this.renderFormattedMarkdown(extracted.preProse));
      }

      if (extracted.payload && Array.isArray(extracted.payload.shots) && extracted.payload.shots.length) {
        const storyboardCard = this.renderStoryboardCard(extracted.payload, extracted.rawJson);
        container.appendChild(storyboardCard);
      } else {
        container.appendChild(el("pre", { class: "mmc-director-json-block", text: extracted.rawJson }));
      }

      if (extracted.postProse) {
        container.appendChild(this.renderFormattedMarkdown(extracted.postProse));
      }
    } else {
      container.appendChild(this.renderFormattedMarkdown(text));
    }

    return container;
  }

  renderFormattedMarkdown(markdownText) {
    const prose = el("div", { class: "mmc-director-prose" });
    const lines = (markdownText || "").split("\n");

    let currentList = null;

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        currentList = null;
        return;
      }

      if (trimmed.startsWith("### ")) {
        currentList = null;
        prose.appendChild(el("h3", { class: "mmc-director-h3", text: trimmed.slice(4) }));
      } else if (trimmed.startsWith("## ")) {
        currentList = null;
        prose.appendChild(el("h2", { class: "mmc-director-h2", text: trimmed.slice(3) }));
      } else if (trimmed.startsWith("• ") || trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        if (!currentList) {
          currentList = el("ul", { class: "mmc-director-list" });
          prose.appendChild(currentList);
        }
        const item = el("li");
        item.appendChild(this.formatInlineTokens(trimmed.slice(2)));
        currentList.appendChild(item);
      } else {
        currentList = null;
        const p = el("p", { class: "mmc-director-p" });
        p.appendChild(this.formatInlineTokens(trimmed));
        prose.appendChild(p);
      }
    });

    return prose;
  }

  formatInlineTokens(rawText) {
    const frag = document.createDocumentFragment();
    const tokenRegex = /(\*\*[^*]+\*\*)|(@[A-Za-z]+-\d+)|(\[Shot\s+\d+\])|(<d>[\s\S]*?<\/d>)/g;
    let at = 0;
    let match;

    while ((match = tokenRegex.exec(rawText)) !== null) {
      if (match.index > at) {
        frag.appendChild(document.createTextNode(rawText.slice(at, match.index)));
      }

      if (match[1]) {
        const strong = el("strong", { text: match[1].slice(2, -2) });
        frag.appendChild(strong);
      } else if (match[2]) {
        frag.appendChild(el("span", { class: "mmc-ref", text: match[2] }));
      } else if (match[3]) {
        frag.appendChild(el("span", { class: "mmc-tok-shot", text: match[3] }));
      } else if (match[4]) {
        frag.appendChild(el("span", { class: "mmc-tok-dialogue", text: match[4] }));
      }

      at = match.index + match[0].length;
    }

    if (at < rawText.length) {
      frag.appendChild(document.createTextNode(rawText.slice(at)));
    }
    return frag;
  }

  renderStoryboardCard(payload, rawJsonText) {
    const shots = payload.shots || [];
    const totalSec = shots.reduce((acc, s) => acc + (Number(s.duration_s) || 6.0), 0);

    const card = el("div", { class: "mmc-director-storyboard-card" });

    const head = el("div", { class: "mmc-director-storyboard-head" }, [
      el("div", { class: "mmc-director-storyboard-title" }, [
        icon("clapper", 14),
        el("strong", { text: t("Storyboard Proposal ({count} Shots · {dur}s)", { count: shots.length, dur: totalSec.toFixed(1) }) }),
      ]),
      el("div", { style: { display: "flex", gap: "6px" } }, [
        el("button", {
          class: "mmc-nle-btn primary mmc-director-push-btn",
          text: t("🚀 Push to Timeline"),
          title: t("Directly apply all shots and parameters into your Timeline"),
          onclick: () => this.pushStoryboardToTimeline(payload),
        }),
        el("button", {
          class: "mmc-nle-btn",
          text: t("📋 Copy JSON"),
          title: t("Copy raw JSON"),
          onclick: () => navigator.clipboard?.writeText(rawJsonText || JSON.stringify(payload, null, 2)),
        }),
      ]),
    ]);

    const shotList = el("div", { class: "mmc-director-storyboard-shots" });
    shots.forEach((shot, i) => {
      const dur = Number(shot.duration_s || 6.0).toFixed(1);
      const row = el("div", { class: "mmc-director-storyboard-shot-row" }, [
        el("span", { class: "mmc-director-shot-idx", text: `Shot ${i + 1}` }),
        el("span", { class: "mmc-director-shot-dur", text: `${dur}s` }),
        el("span", { class: "mmc-director-shot-trans", text: shot.transition || "39f" }),
        el("span", { class: "mmc-director-shot-snippet", text: (shot.body || "").slice(0, 85) + "..." }),
        el("button", {
          class: "mmc-nle-btn mmc-director-shot-inject-btn",
          text: t("⚡ Apply Shot {n}", { n: i + 1 }),
          title: t("Inject only this single shot into your timeline"),
          onclick: (e) => {
            e.stopPropagation();
            this.applySingleShotToTimeline(shot, i);
          },
        }),
      ]);
      shotList.appendChild(row);
    });

    const jsonFold = el("details", { class: "mmc-director-thought-fold", style: { marginTop: "6px" } }, [
      el("summary", { text: t("📄 View Raw JSON Parameters") }),
      el("pre", { class: "mmc-director-json-block", text: rawJsonText || JSON.stringify(payload, null, 2) }),
    ]);

    card.replaceChildren(head, shotList, jsonFold);
    return card;
  }

  renderPersonas() {
    return el("div", { class: "mmc-director-personas-bar" }, DIRECTOR_PERSONAS.map((p) =>
      el("button", {
        class: "mmc-chip mmc-director-persona-chip",
        text: p.label,
        onclick: () => this.sendMessage(`${p.promptPrefix} ${(this.inputBox?.value || "").trim()}`),
      })
    ));
  }

  renderQuickChips() {
    return el("div", { class: "mmc-director-quick-chips" }, QUICK_DIRECTOR_CHIPS.map((chip) =>
      el("button", {
        class: "mmc-chip",
        text: t(chip.label),
        onclick: () => this.sendMessage(chip.text),
      })
    ));
  }

  renderInputArea() {
    this.inputBox = el("textarea", {
      class: "mmc-director-input-box",
      rows: "2",
      placeholder: t("Message the AI Director... (Type @ to cite reference images)"),
      spellcheck: "false",
      oninput: () => this.handleMentionTrigger(),
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      },
    });

    this.liveMeterEl = el("span", { class: "mmc-stream-meter", style: { display: "none" } });

    const sendBtn = el("button", {
      class: "mmc-nle-btn primary",
      text: this.isGenerating ? t("⏹ Stop") : t("Send ↵"),
      onclick: () => {
        if (this.isGenerating) this.cancelChat();
        else this.sendMessage();
      },
    });

    const footBar = el("div", { class: "mmc-director-input-bar" }, [
      this.inputBox,
      this.liveMeterEl,
      sendBtn,
    ]);

    return footBar;
  }

  async handleMentionTrigger() {
    const val = this.inputBox.value;
    const pos = this.inputBox.selectionStart;
    const match = /@([\w-]*)$/.exec(val.slice(0, pos));

    if (!match) {
      this.mentionMenu?.remove();
      this.mentionMenu = null;
      return;
    }

    const query = match[1].toLowerCase();
    const target = this.getTargetNode();
    const assets = [];

    const tAssets = target?.mmcBody?.timeline?.assets || target?.mmcBody?.state?.assets || [];
    tAssets.forEach((a) => assets.push(a));

    const filtered = assets.filter((a) => !query || a.handle.toLowerCase().includes(query) || a.filename.toLowerCase().includes(query));

    if (!this.mentionMenu) {
      this.mentionMenu = el("div", { class: "mmc-mention mmc-director-mention-menu" });
      floatAbove(this.mentionMenu);
      document.body.appendChild(this.mentionMenu);
    }

    if (!filtered.length) {
      this.mentionMenu.replaceChildren(el("div", { class: "mmc-mention-empty", text: t("No matching project assets.") }));
    } else {
      this.mentionMenu.replaceChildren(...filtered.map((asset) => el("button", {
        class: "mmc-mention-row",
        onclick: (e) => {
          e.preventDefault();
          const before = val.slice(0, match.index);
          const after = val.slice(pos);
          this.inputBox.value = `${before}@${asset.handle} ${after}`;
          this.mentionMenu?.remove();
          this.mentionMenu = null;
          this.inputBox.focus();
        },
      }, [
        el("img", { class: "mmc-mention-thumb", src: viewUrl(asset.filename, { preview: true }), alt: "" }),
        el("div", { class: "mmc-mention-text" }, [
          el("span", { class: "mmc-mention-handle", text: `@${asset.handle}` }),
          el("span", { class: "mmc-mention-sub", text: asset.filename.split("/").pop() }),
        ]),
      ])));
    }

    const rect = this.inputBox.getBoundingClientRect();
    this.mentionMenu.style.left = `${Math.max(8, rect.left)}px`;
    this.mentionMenu.style.top = `${Math.max(8, rect.top - 200)}px`;
  }
}