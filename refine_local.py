"""Where the refiner's model runs: a VLM loaded as a ComfyUI text encoder."""

import gc
from . import refine

MAX_TOKENS = refine.NUM_PREDICT
TOP_K = 64
TOP_P = 0.95
MIN_P = 0.05
REPETITION_PENALTY = 1.05

SUPPORTED = ("qwen3vl_4b", "qwen3vl_8b")
TRUNCATED = "qwen3vl_32b"


def list_models():
    try:
        import folder_paths
    except ImportError:
        return []
    return list(folder_paths.get_filename_list("text_encoders"))


_loaded = {"name": None, "clip": None}


def _check(clip, name):
    inner = getattr(clip.cond_stage_model, clip.cond_stage_model.clip)
    kind = getattr(clip.cond_stage_model, "clip_name", "")

    if kind == TRUNCATED:
        raise refine.RefineError(
            f"'{name}' is H3's own conditioning encoder — Qwen3-VL-32B truncated to "
            f"50 of its 64 layers, with no final norm and no language head. It has "
            f"nothing to decode text with. Load a separate Qwen3-VL 4B or 8B text "
            f"encoder for the refiner."
        )
    if kind not in SUPPORTED:
        raise refine.RefineError(
            f"'{name}' loads as {kind or 'an unrecognised text encoder'}. The refiner "
            f"writes Qwen's chat format, so it needs a Qwen3-VL 4B or 8B text encoder."
        )

    config = inner.transformer.model.config
    if not getattr(config, "final_norm", True):
        raise refine.RefineError(
            f"'{name}' is a truncated conditioning checkpoint — no final norm, so no "
            f"usable output layer. Load a full Qwen3-VL text encoder instead."
        )
    return clip


def load(name):
    if not (name or "").strip():
        raise refine.RefineError("no text encoder chosen")
    if _loaded["name"] == name and _loaded["clip"] is not None:
        return _loaded["clip"]

    import comfy.sd
    import folder_paths

    unload()

    path = folder_paths.get_full_path_or_raise("text_encoders", name)
    try:
        clip = comfy.sd.load_clip(
            ckpt_paths=[path],
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
        )
    except refine.RefineError:
        raise
    except Exception as exc:
        raise refine.RefineError(f"'{name}' could not be loaded as a text encoder: {exc}") from exc

    _check(clip, name)
    _loaded.update(name=name, clip=clip)
    return clip


def release():
    if _loaded["clip"] is None:
        return
    try:
        import comfy.model_management as mm
        mm.unload_model_and_clones(_loaded["clip"].patcher)
    except Exception:
        pass


def unload():
    if _loaded["clip"] is None:
        return
    try:
        import comfy.model_management as mm
        mm.unload_model_and_clones(_loaded["clip"].patcher)
    except Exception:
        pass
    _loaded.update(name=None, clip=None)
    gc.collect()


def to_tensor(image):
    import numpy
    import torch
    from PIL import Image

    image = image.convert("RGB")
    if max(image.size) > refine.IMAGE_LONG_EDGE:
        image.thumbnail((refine.IMAGE_LONG_EDGE, refine.IMAGE_LONG_EDGE), Image.LANCZOS)
    array = numpy.asarray(image, dtype=numpy.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


PROGRESS_ID = "minimax-creator-refine"


def _progress_context():
    from comfy_execution.utils import CurrentNodeContext
    return CurrentNodeContext(prompt_id=PROGRESS_ID, node_id=PROGRESS_ID)


def chat(name, system, message, images=(), temperature=0.7, seed=-1, max_tokens=None,
         prefill=refine.PREFILL):
    clip = load(name)
    max_tokens = refine.reply_tokens(max_tokens) if max_tokens is not None else MAX_TOKENS

    prompt = refine.chatml(system, message, images=len(images), prefill=prefill)
    tokens = clip.tokenize(prompt, images=list(images))

    import comfy.model_management as mm

    seed = int(seed)
    try:
        with _progress_context():
            generated = clip.generate(
                tokens,
                do_sample=float(temperature) > 0,
                max_length=max_tokens,
                temperature=max(float(temperature), 0.01),
                top_k=TOP_K,
                top_p=TOP_P,
                min_p=MIN_P,
                repetition_penalty=REPETITION_PENALTY,
                seed=seed if seed >= 0 else 0,
            )
    except refine.RefineError:
        raise
    except mm.InterruptProcessingException as exc:
        raise refine.RefineError("the rewrite was cancelled") from exc
    except Exception as exc:
        raise refine.RefineError(f"'{name}' failed while generating: {type(exc).__name__}: {exc}") from exc

    content = prefill + clip.decode(generated)
    if not content[len(prefill):].strip():
        raise refine.RefineError(
            f"'{name}' returned nothing. It may have hit the token limit before "
            f"writing anything, or the prompt may be longer than its context."
        )
    if len(generated) >= max_tokens:
        raise refine.RefineError(
            f"'{name}' ran out of room after {max_tokens} tokens and the reply is "
            f"cut off. Raise the reply length in the refiner's settings, or refine "
            f"fewer cards at once."
        )
    return content