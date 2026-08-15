"""Preferences that belong to this ComfyUI rather than to a workflow."""

import json
import os

from . import outputs

FILE = "minimax_creator.settings.json"

MIN_CRF = 0
MAX_CRF = 51
DEFAULT_CRF = 23

DEFAULT_VIDEO_PREFIX = outputs.VIDEO_PREFIX
DEFAULT_IMAGE_PREFIX = outputs.IMAGE_PREFIX

SYNTAX_MODES = ("media", "full", "off")

DEFAULTS = {
    "video_crf": DEFAULT_CRF,
    "video_prefix": DEFAULT_VIDEO_PREFIX,
    "image_prefix": DEFAULT_IMAGE_PREFIX,
    "enable_preview": True,
    "syntax_highlighting": "media",
    "enable_linter": True,
}


def clean(raw):
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
    return clean_settings


def path():
    """The settings file. Imported lazily so this module stays standalone."""
    import folder_paths

    return os.path.join(folder_paths.get_user_directory(), FILE)


def load():
    """The stored settings, with every key filled in."""
    try:
        with open(path(), "r", encoding="utf-8") as handle:
            return clean(json.load(handle))
    except (OSError, ValueError):
        return dict(DEFAULTS)


def save(raw):
    """Store a settings blob and hand back what was stored."""
    stored = clean(raw)
    target = path()
    os.makedirs(os.path.dirname(target), exist_ok=True)
    temporary = f"{target}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(stored, handle, indent=2)
    os.replace(temporary, target)
    return stored


def video_crf():
    return load()["video_crf"]


def video_prefix():
    return load()["video_prefix"]


def image_prefix():
    return load()["image_prefix"]


def enable_preview():
    return load().get("enable_preview", True)


def syntax_highlighting():
    return load().get("syntax_highlighting", "media")


def enable_linter():
    return load().get("enable_linter", True)