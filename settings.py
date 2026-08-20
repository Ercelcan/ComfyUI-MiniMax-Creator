"""Preferences that belong to this ComfyUI rather than to a workflow."""

from __future__ import annotations

import json
import os
from typing import Any

from . import outputs

FILE = "minimax_creator.settings.json"

MIN_CRF = 0
MAX_CRF = 51
DEFAULT_CRF = 23

DEFAULT_VIDEO_PREFIX = outputs.VIDEO_PREFIX
DEFAULT_IMAGE_PREFIX = outputs.IMAGE_PREFIX

SYNTAX_MODES = ("media", "full", "off")

DEFAULT_TILED_VAE = False
DEFAULT_VAE_TILE_SIZE = 512

DEFAULT_SPEED_PRESET = "off"
DEFAULT_LOW_VRAM_ATTN = False
DEFAULT_HEAD_CHUNKS = 4
DEFAULT_CHUNK_FFN = False
DEFAULT_FFN_CHUNKS = 2
DEFAULT_FFN_SEQ_THRESHOLD = 4096

DEFAULTS = {
    "video_crf": DEFAULT_CRF,
    "video_prefix": DEFAULT_VIDEO_PREFIX,
    "image_prefix": DEFAULT_IMAGE_PREFIX,
    "enable_preview": True,
    "syntax_highlighting": "media",
    "enable_linter": True,
    "tiled_vae": DEFAULT_TILED_VAE,
    "vae_tile_size": DEFAULT_VAE_TILE_SIZE,
    "speed_preset": DEFAULT_SPEED_PRESET,
    "low_vram_attn": DEFAULT_LOW_VRAM_ATTN,
    "head_chunks": DEFAULT_HEAD_CHUNKS,
    "chunk_ffn": DEFAULT_CHUNK_FFN,
    "ffn_chunks": DEFAULT_FFN_CHUNKS,
    "ffn_seq_threshold": DEFAULT_FFN_SEQ_THRESHOLD,
}


def clean(raw: Any) -> dict:
    """A settings blob -> the settings this pack will use. Unknown keys dropped."""
    if not isinstance(raw, dict):
        raise ValueError("settings must be an object")
    clean_settings = dict(DEFAULTS)
    if "video_crf" in raw and raw["video_crf"] is not None:
        crf = raw["video_crf"]
        if isinstance(crf, bool) or not isinstance(crf, (int, float)) or crf != int(crf):
            raise ValueError("video_crf must be a whole number")
        crf = int(crf)
        if not MIN_CRF <= crf <= MAX_CRF:
            raise ValueError(f"video_crf must be between {MIN_CRF} and {MAX_CRF}")
        clean_settings["video_crf"] = crf
    for key, fallback in (("video_prefix", DEFAULT_VIDEO_PREFIX),
                          ("image_prefix", DEFAULT_IMAGE_PREFIX)):
        if key in raw and raw[key] is not None:
            try:
                clean_settings[key] = outputs.clean(raw[key], fallback)
            except outputs.PrefixError as exc:
                raise ValueError(f"{key}: {exc}") from exc
    if "enable_preview" in raw and raw["enable_preview"] is not None:
        clean_settings["enable_preview"] = bool(raw["enable_preview"])
    if "syntax_highlighting" in raw and raw["syntax_highlighting"] in SYNTAX_MODES:
        clean_settings["syntax_highlighting"] = raw["syntax_highlighting"]
    if "enable_linter" in raw and raw["enable_linter"] is not None:
        clean_settings["enable_linter"] = bool(raw["enable_linter"])
    if "tiled_vae" in raw and raw["tiled_vae"] is not None:
        clean_settings["tiled_vae"] = bool(raw["tiled_vae"])
    if "vae_tile_size" in raw and raw["vae_tile_size"] is not None:
        try:
            ts = int(raw["vae_tile_size"])
            clean_settings["vae_tile_size"] = max(64, min(4096, (ts // 64) * 64))
        except (ValueError, TypeError):
            pass
    if "speed_preset" in raw and isinstance(raw["speed_preset"], str):
        clean_settings["speed_preset"] = raw["speed_preset"].strip()
    if "low_vram_attn" in raw and raw["low_vram_attn"] is not None:
        clean_settings["low_vram_attn"] = bool(raw["low_vram_attn"])
    if "head_chunks" in raw and raw["head_chunks"] is not None:
        try:
            hc = int(raw["head_chunks"])
            clean_settings["head_chunks"] = max(1, min(16, hc))
        except (ValueError, TypeError):
            pass
    if "chunk_ffn" in raw and raw["chunk_ffn"] is not None:
        clean_settings["chunk_ffn"] = bool(raw["chunk_ffn"])
    if "ffn_chunks" in raw and raw["ffn_chunks"] is not None:
        try:
            fc = int(raw["ffn_chunks"])
            clean_settings["ffn_chunks"] = max(1, min(8, fc))
        except (ValueError, TypeError):
            pass
    if "ffn_seq_threshold" in raw and raw["ffn_seq_threshold"] is not None:
        try:
            st = int(raw["ffn_seq_threshold"])
            clean_settings["ffn_seq_threshold"] = max(256, min(65536, st))
        except (ValueError, TypeError):
            pass
    return clean_settings


def path() -> str:
    """The settings file. Imported lazily so this module stays standalone."""
    import folder_paths

    return os.path.join(folder_paths.get_user_directory(), FILE)


def load() -> dict:
    """The stored settings, with every key filled in."""
    try:
        with open(path(), "r", encoding="utf-8") as handle:
            return clean(json.load(handle))
    except (OSError, ValueError):
        return dict(DEFAULTS)


def save(raw: Any) -> dict:
    """Store a settings blob and hand back what was stored."""
    stored = clean(raw)
    target = path()
    os.makedirs(os.path.dirname(target), exist_ok=True)
    temporary = f"{target}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(stored, handle, indent=2)
    os.replace(temporary, target)
    return stored


def video_crf() -> int:
    return load()["video_crf"]


def video_prefix() -> str:
    return load()["video_prefix"]


def image_prefix() -> str:
    return load()["image_prefix"]


def enable_preview() -> bool:
    return load().get("enable_preview", True)


def syntax_highlighting() -> str:
    return load().get("syntax_highlighting", "media")


def enable_linter() -> bool:
    return load().get("enable_linter", True)


def tiled_vae() -> bool:
    return bool(load().get("tiled_vae", False))


def vae_tile_size() -> int:
    return int(load().get("vae_tile_size", 512))


def speed_preset() -> str:
    return str(load().get("speed_preset", "off"))


def low_vram_attn() -> bool:
    return bool(load().get("low_vram_attn", False))


def head_chunks() -> int:
    return int(load().get("head_chunks", 4))


def chunk_ffn() -> bool:
    return bool(load().get("chunk_ffn", False))


def ffn_chunks() -> int:
    return int(load().get("ffn_chunks", 2))


def ffn_seq_threshold() -> int:
    return int(load().get("ffn_seq_threshold", 4096))