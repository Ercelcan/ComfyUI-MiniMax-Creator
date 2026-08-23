# MiniMax H3 Creator

Write a sentence, attach your media with `@`, press Run. One node holds the whole
generation — prompt, references, LoRAs, sampling, sound — and hands back a
finished clip with its audio already in it. No conditioning sockets, no sampler
to re-assemble, no VAE to remember to connect.

Runs **local open weights only**, through ComfyUI core's
`comfy_extras/nodes_minimax_h3.py`. No API key, nothing uploaded.

---

## Table of contents

- [Install](#install)
- [The Creator node](#the-creator-node)
- [Attaching media (`@` mentions)](#attaching-media--mentions)
- [Trimming & reference scopes](#trimming--reference-scopes)
- [Prompt toolbox](#prompt-toolbox)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [LoRA manager](#lora-manager)
- [AI Refiner](#ai-refiner)
- [Performance: SPEED, caching & VRAM](#performance-speed-caching--vram)
- [PreStage (stills)](#prestage-stills)
- [Timeline Studio](#timeline-studio)
- [AI Director](#ai-director)
- [Utility nodes](#utility-nodes)
- [GGUF quantized models](#gguf-quantized-models)

---

## Install

```
cd ComfyUI/custom_nodes
git clone https://github.com/roadmaus/ComfyUI-MiniMax-Creator.git
```

Restart ComfyUI. Nothing to `pip install`. You need a ComfyUI new enough to ship
`comfy_extras/nodes_minimax_h3.py`, since that is where the model lives.

Put the weights where ComfyUI already looks:

| file | folder |
|---|---|
| FL2VA, Ref2VA checkpoints | `models/diffusion_models` |
| text encoder | `models/text_encoders` (CLIPLoader type `minimax`) |
| video VAE, audio VAE | `models/vae` |
| preview decoder | `models/vae_approx` — [taeh3.safetensors](https://github.com/madebyollin/taehv) |
| refiner (optional) | `models/text_encoders` — any Qwen3-VL, 4B is plenty |
| Krea 2 / Ideogram 4.0 (optional) | `models/diffusion_models` / `models/text_encoders` / `models/vae` |
| single-image H3 VAE (optional) | `models/vae` — [MiniMax-H3-Image-VAE](https://huggingface.co/Mamad8/MiniMax-H3-Image-VAE) |

You pick the files on the node itself, on the **weights** pill. Anything a render
needs and does not have is refused before the queue starts, naming the field and
the folder it looks in.

---

## The Creator node

Everything lives on one node:

- **Tool rail** at the top — attach images, video, audio; open the gallery; manage LoRAs; open settings.
- **Prompt box** in the middle — a rich text editor with `@` mentions, syntax highlighting, a linter, prompt history and quick phrase chips.
- **Pill row** at the bottom — duration, aspect ratio, resolution, checkpoint route, output prefix.
- **Sampling widgets** — seed, steps, cfg, sampler/scheduler plus the performance toggles (see below).

Outputs: finished **images + audio** (already muxed lengths), plus the loaded
`model_fl2va` / `model_ref2va`, `vae` and `clip` for downstream graphing if you
want it.

### Checkpoint routing

FL2VA and Ref2VA are different checkpoints; what you attach picks the mode, and
the mode picks which input is passed through. The badge on the node tells you
which checkpoint this render will land on. A saved workflow keeps whatever route
it stored; `auto` follows what is attached.

---

## Attaching media (`@` mentions)

H3 does not take free text. It takes a structured description where every
reference is addressed as `<Picture 1>`, `<Video 2>`, `<Audio 1>`. Type `@`
anywhere in the prompt:

1. A menu lists what is already attached first, then piece references, then everything in your `input/` folder.
2. Pick a file that is not attached yet and it gets attached automatically.
3. Every attachment gets a colour, and its chip in the sentence wears the same one, so you can match a reference in the prose to a picture without reading.

Writing `use @img-2 for her face` assigns the ordinal labels for you, in the
exact order the tokenizer expects.

### Right-click any chip

Right-click an `@mention` chip in the prompt for quick actions:

- **Copy @handle** — copy the mention text.
- **Trim / track…** — video & audio clips open the segment editor.
- **Track toggle** — e.g. `sound on → sound off`; switches what the clip contributes (refused safely if it would overflow a slot).
- **Remove attachment / Remove frame**

The same actions are available from the asset cards under the prompt.

---

## Trimming & reference scopes

Video and audio get a segment editor — on the picker cell, the attached card, or
the chip's right-click menu. Scrub, drag the handles, or slide a fixed-length
selection along the clip. The range sits on a waveform decoded in the browser,
so you can see where the sound is before you cut it.

Three buttons decide what a video reference contributes:

| mode | meaning |
|---|---|
| **picture + sound** | its soundtrack comes in as reference audio too |
| **picture only** | referenced silently |
| **sound only** | picture thrown away — for voices, room tone, scoring living in an mp4 |

A silent clip attaches silent instead of failing at queue time (the container is
probed server-side). Explicitly choosing a track in the editor outranks the default.

Reference *images* get a scope dial instead:
`full · person · object · scene · style`. On `person`, "her from @img-1" stops
dragging that image's background, palette and pose along with the face.

---

## Prompt toolbox

The strip above the prompt box carries:

- **Chips toggle** — quick phrase groups (camera motion, framing, style & lighting) inserted at the cursor.
- **Structure highlight** — media / full / off syntax modes; shots `[Shot 2]`, times `At 0:02.000`, subject labels `<Picture 1>` and dialogue `<d>…</d>` colourise as you type.
- **History & diff** — automatic snapshots per node (last 15) with a word-level diff view and restore.
- **Copy / Clear**.
- **? Shortcuts** — in-app list of every key binding.
- **Live linter** — catches missing sections, dangling labels and other Context-IR mistakes before they cost a render.
- **Word count**.

### Keyboard shortcuts

| key | action |
|---|---|
| `@` | attach or reference media from the prompt |
| ↑ ↓ | move through the mention menu |
| Enter / Tab | pick the highlighted mention |
| Esc | close menus and popovers |
| Ctrl+Enter (⌘Enter) | queue the prompt |
| Right-click `@chip` | trim, switch sound, copy or remove |

---

## LoRA manager

A full-screen manager over `models/loras`. Cards carry the showcase image or
clip, title, base model and trigger words read from whatever metadata sits beside
the file; a LoRA nothing has described still gets a working card from its
filename. Each card sets strength, target checkpoint and trigger words. Trigger
words are prefixed to the prompt at compile time and printed under the LoRA
chips in the node body.

Metadata is read from all known sidecar formats and merged — later entries only
fill in what earlier ones left blank.

---

## AI Refiner

A local Context-IR rewrite through a vision-language model (any Qwen3-VL in
`models/text_encoders`, 4B is plenty; Ollama / LM Studio / OpenAI-compatible /
OpenRouter endpoints also work). It receives MiniMax's own prompt-writing guides
(shipped in `prompts/`), a glossary of what each handle holds, downscaled stills
of every reference image, and your sentence — then drafts a structured prompt
into an editable box next to the original. Nothing overwrites your text until
you accept; `prompt_override` remains the manual escape hatch.

It looks at stills, not motion, and cannot hear audio — treat everything it
writes as a draft.

---

## Performance: SPEED, caching & VRAM

On the Creator's widget row:

- **SPEED progressive sampler** (`speed_preset`) — denoises the initial layout at lower resolution for roughly +40% speedup. Auto-bypasses on I2V keyframes.
- **FirstBlockCache** (`block_cache`) — skips the rest of the DiT on steps where the first block barely moved (`fast` recommended; needs the companion pack).
- **Spectrum** — forecasts features across steps instead of evaluating every one, with a spectral blend dial.
- **Low VRAM Attention** (`low_vram_attn`, `head_chunks`) — chunks multi-head attention to prevent VRAM spikes at high resolution (4 heads recommended for 12–16 GB cards).
- **Chunk FeedForward** (`chunk_ffn`, `ffn_chunks`, `ffn_seq_threshold`) — chunked FFN/SwiGLU evaluation along sequence length to stop peak-memory crashes.

Standalone model-patch versions (`MiniMax H3 Low VRAM Attention`,
`MiniMax H3 Chunk FeedForward`) exist for use in hand-built graphs, alongside a
`MiniMax H3 SPEED — Progressive Sampler`.

---

## PreStage (stills)

A left-side image node spawned from a pill on the Creator or Timeline. Three
architectures on its model pill:

- **Krea 2** and **Ideogram 4.0** — local open-weight image models.
- **H3 stills** (experimental) — a still made by the *video* model: one temporal slice of the sampled latent, decoded with the experimental single-image H3 VAE. Same canvas as the shot will render at, and everything a shot can attach a still can attach (references, frames, LoRAs, taeh3 preview).

Stills land back as start/end frames or references through chips on the result
card. Same picker, same LoRA manager, same prompt architecture.

---

## Timeline Studio

A multi-segment NLE-style body for clips too long or too cut-up for one pass:

- Up to **24 segments**, each with its own prompt, duration, seed, lock and cached result.
- **Continuity modes** between segments: lossless latent mask (recommended), fast latent mask, keyframe motion blend, hard cuts with sound carryover, full scene reset.
- Per-shot inspector, re-roll, take scope, reference resolution, gain & ducking.
- Full **undo/redo**, transport toolbar with timecode, J/K/L stepping, mark in/out, razor split.
- Global project bible & scene prompt shared by every shot.
- **Export**: CMX 3600 EDL and Final Cut Pro 7 XML for round-tripping into real NLEs.
- Low-RAM video muxing for long timelines.

Known trade-off: chained segments decode → last frame → re-encode between hops,
so exposure and colour can walk across many joins. One-pass mode (a single
generation that fits) never has this — reach for it first.

---

## AI Director

An interactive writers' room node. Chat with a local LLM (Ollama, LM Studio,
OpenAI-compatible, OpenRouter, or a ComfyUI-hosted Qwen3-VL) to brainstorm shots
and compose Context-IR storyboards with live token streaming. It sees your
reference images, pushes finished timelines straight into the Timeline node or
single prompts into the Creator, and evicts model VRAM before sampling starts.

---

## Utility nodes

| node | purpose |
|---|---|
| MiniMax H3 Timeline | segment container / player |
| MiniMax H3 Timeline Segment | one shot's compile+sample line |
| MiniMax H3 Streamed Assembly | low-RAM sequential assembly |
| MiniMax H3 Last Frame | tail frame extraction for chaining |
| MiniMax H3 Seam Trim | seam overlap trimming |
| MiniMax H3 Audio Tail | carry audio across a join |
| MiniMax H3 Timeline Join | linear visual blend + photometric seam match + equal-power audio crossfade |
| MiniMax H3 Save / Save Segment / Load Segment | output & segment persistence |
| MiniMax H3 PreStage / Save Image / Still Latent | still-image pipeline |
| MiniMax H3 Refine Pass | hi-res refine stage |
| MiniMax H3 RTX VSR Upscale | NVIDIA RTX video super resolution |
| Minimax H3 Latent Upscaler (3D) | latent-space upscale |
| MiniMax H3 Low VRAM Attention / Chunk FeedForward | standalone memory patches |
| MiniMax H3 SPEED — Progressive Sampler | standalone progressive sampler |

---

## GGUF quantized models

GGUF checkpoints and text encoders work with
[ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) installed: drop the
`.gguf` in the same folders and pick it like any other file — the format is read
off the extension and the right loader is emitted, no setting to switch. The
precision control does not apply to them (that was decided at quantization), and
picking one without the pack refuses up front, naming it.

> Note: the single-image H3 VAE is a merged H3 VAE and loads through the same
> node as the real one. It belongs in the PreStage's VAE slot and nowhere else —
> in a video workflow it costs multi-frame reconstruction.

---

## License

See [LICENSE](LICENSE).











