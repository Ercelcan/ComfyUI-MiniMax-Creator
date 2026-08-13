# MiniMax H3 Creator & Timeline (Enhanced Edition)

Write a sentence, attach media with `@`, or drag-and-drop files directly onto the node, and press Run. One node holds the whole generation and hands back a finished video with sound included — no conditioning sockets, no sampler to re-assemble, no VAE to remember to connect.

Local open weights supported natively through core's `comfy_extras/nodes_minimax_h3.py`. No API keys required for video generation!

> 🚀 **Enhanced Edition:** Features Fast Default Live Previews, 4-Way Resizable Satellite Stage, OpenRouter/Ollama/OpenAI Refiner support, Direct Drag & Drop + Ctrl+V Image Paste, Dual Turbo LoRAs, 1-Click Timeline Transition Presets, and Active Generation Green Glowing Outlines!

---

## 📸 Overview & Previews


<img width="2045" height="693" alt="image" src="https://github.com/user-attachments/assets/a7115091-9479-44dd-b692-7cdd1d4d71ce" />


<img width="837" height="680" alt="image" src="https://github.com/user-attachments/assets/b5317ef8-eaee-4fb1-b1e2-9738b42927e1" />


---

## ✨ Key Features & Enhancements

### 👁️ Fast Default Live Previews
* Live previews (`latent2rgb`, `b_preview`, `b_preview_with_metadata`, `kj_preview_override`) render automatically on the stage box without requiring heavy TAEH3 VAE models.

### 🎥 Persistent, 4-Way Resizable Satellite Stage Box
* **Persisted Visibility:** The preview box stays open across tab and workflow switches (`localStorage`).
* **4-Way Positioning:** Snap the stage box to any side of the node (**Right**, **Bottom**, **Left**, or **Top**).
* **Drag-to-Resize:** Drag the bottom-right handle to resize the preview player. Height is smartly capped so it never expands off-screen.
* **🎬 Keep Video Mode:** Keeps your last generated video visible while sampling a new one.
* **Safety Delete & History:** Confirm deletions (🗑) safely and step back/forward through previous renders (◀ / ▶).

### 📥 Direct Drag & Drop + Ctrl+V Clipboard Image Paste
* **Ctrl+V Image Paste:** Copy any image to your clipboard (screenshot, Snipping Tool, or browser image) and press **Ctrl+V** inside the node to instantly upload to ComfyUI `input/` and attach as `@img-1`!
* **Drag & Drop Media:** Drag images (`.png`, `.jpg`), videos (`.mp4`, `.webm`), or audio (`.mp3`, `.wav`) directly from your OS file manager onto the node to auto-upload and attach them as references, complete with a visual blue drop overlay (`📥 Drop media here`).

### 🤖 LLM Prompt Refiner (OpenRouter / Ollama / LM Studio / OpenAI / Local)
* **Multi-Provider Refiner:** Refine prompts using **OpenRouter** (`https://openrouter.ai/api/v1`), **Ollama** (`:11434`), **LM Studio / OpenAI** (`:1234/v1`), or local ComfyUI text encoders (`qwen3vl_4b`/`8b`).
* **Real-Time Model Search Filter:** Includes a live search box in the refiner settings popover to filter through hundreds of models (e.g. OpenRouter's 200+ models) instantly.
* **Auto-Fallback for Text-Only Models:** If you use a text-only LLM (like DeepSeek V3/R1, Llama 3.3, Claude text) with attached images, it automatically catches image-rejection errors and retries in text-only mode without crashing!
* **Fuzzy Quote Verification:** Uses Longest Common Subsequence (LCS) matching so minor grammar or punctuation fixes made by LLMs in quoted speech no longer trigger false "dropped quote" warnings.

### ⚡ Dual Turbo LoRAs (FL2VA & Ref2VA)
* Supports separate Turbo LoRAs for **FL2VA** (`lora`) and **Ref2VA** (`ref_lora`). When your prompt switches between text/keyframes and `@` reference modes, the node automatically routes to the matching Turbo LoRA!

### 🎞️ Multi-Shot Timeline with Active Green Outline
* **Active Segment Highlight:** The segment currently being sampled during timeline generation gets a bright glowing/pulsing green outline (`#22c55e`) on both the node summary lane and the timeline modal cards.
* **1-Click Transition Presets:** `🪄 preset` shortcut on timeline seams (Match Cut, Cross-Blend, Hard Cut + Sound, Hard Reset).
<img width="1085" height="685" alt="image" src="https://github.com/user-attachments/assets/ca321659-fb2d-415d-907c-c2e7d7a5f77f" />

* **Seamless Motion & Audio Blending:** Carry last-frame motion context and phase-locked audio tails across cuts.

### 🎨 Fixed Node Layout & Dynamic Resizing
* Restructured panel flex layout: prompt box and refiner textareas sit in a scrollable middle container (`.mmc-prompt-scroll`) with `resize: vertical` handles and a **Collapse / Expand** toggle button.
* Config pills (`+ Start frame`, `+ End frame`, `Duration`, `Aspect`, `Resolution`, `Route badge`) are permanently pinned above sampling controls and never get overlapped by textareas.
* Global Input Guard prevents accidental ComfyUI canvas node copy/pasting when typing or pasting text in prompt boxes.

---

## 📦 Installation

1. Clone this repository into your ComfyUI `custom_nodes` folder:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Ercelcan/ComfyUI-MiniMax-Creator.git
