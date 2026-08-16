"""Real-time streaming LLM API callers for MiniMax H3 Context-IR prompt refinement & Director."""

from __future__ import annotations

import base64
import json
import threading
import time
import urllib.error
import urllib.request
from io import BytesIO
from typing import Callable, Optional

from . import refine

_ACTIVE_SOCKETS = {}
_CANCEL_EVENTS = {}


def cancel_stream(node_id: str):
    """Immediately aborts in-flight LLM generation across thread and socket layers."""
    nid = str(node_id)
    ev = _CANCEL_EVENTS.get(nid)
    if ev:
        ev.set()

    sock = _ACTIVE_SOCKETS.pop(nid, None)
    if sock:
        try:
            sock.close()
        except Exception:
            pass
        try:
            if hasattr(sock, "fp") and sock.fp:
                sock.fp.close()
        except Exception:
            pass
        return True
    return False


def pil_to_base64(img, fmt="JPEG"):
    buffer = BytesIO()
    img.convert("RGB").save(buffer, format=fmt, quality=85)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def fetch_models_ollama(url):
    base = (url or "http://localhost:11434").rstrip("/")
    endpoint = f"{base}/tags" if base.endswith("/api") else f"{base}/api/tags"
    req = urllib.request.Request(endpoint, headers={"User-Agent": "MiniMaxCreator"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return [m.get("name") for m in data.get("models", []) if m.get("name")]
    except Exception as exc:
        raise RuntimeError(f"Could not connect to Ollama at {url}: {exc}") from exc


def fetch_models_openai(url):
    base = (url or "http://localhost:1234/v1").rstrip("/")
    endpoint = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"
    req = urllib.request.Request(endpoint, headers={"User-Agent": "MiniMaxCreator"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return [m.get("id") for m in data.get("data", []) if m.get("id")]
    except Exception as exc:
        raise RuntimeError(f"Could not connect to LM Studio/OpenAI at {url}: {exc}") from exc


def fetch_models_openrouter(url, api_key=""):
    base = (url or "https://openrouter.ai/api/v1").rstrip("/")
    endpoint = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"

    headers = {
        "User-Agent": "MiniMaxCreator",
        "HTTP-Referer": "https://github.com/roadmaus/ComfyUI-MiniMax-Creator",
        "X-Title": "ComfyUI-MiniMax-Creator",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(endpoint, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return sorted([m.get("id") for m in data.get("data", []) if m.get("id")])
    except Exception as exc:
        raise RuntimeError(f"Could not connect to OpenRouter at {url}: {exc}") from exc


# ---------------------------------------------------------------------------
# Streaming Tracker
# ---------------------------------------------------------------------------

class _StreamTracker:
    def __init__(self, on_chunk: Optional[Callable[[str, bool, int, float], None]] = None):
        self.on_chunk = on_chunk
        self.accumulated = []
        self.thought_buffer = []
        self.in_think = False
        self.token_count = 0
        self.start_time = time.time()

    def process(self, text: str):
        if not text:
            return
        self.token_count += 1
        elapsed = max(0.001, time.time() - self.start_time)
        speed = round(self.token_count / elapsed, 1)

        if "<think>" in text:
            self.in_think = True
            text = text.replace("<think>", "")
        if "</think>" in text:
            parts = text.split("</think>", 1)
            if parts[0]:
                self.thought_buffer.append(parts[0])
                if self.on_chunk:
                    self.on_chunk(parts[0], True, self.token_count, speed)
            self.in_think = False
            text = parts[1] if len(parts) > 1 else ""

        if text:
            if self.in_think:
                self.thought_buffer.append(text)
                if self.on_chunk:
                    self.on_chunk(text, True, self.token_count, speed)
            else:
                self.accumulated.append(text)
                if self.on_chunk:
                    self.on_chunk(text, False, self.token_count, speed)

    def full_text(self) -> str:
        res = "".join(self.accumulated).strip()
        if not res and self.thought_buffer:
            return "".join(self.thought_buffer).strip()
        return res


def _raw_chat_ollama(
    url,
    model,
    system,
    message,
    images=(),
    temperature=0.3,
    seed=-1,
    max_tokens=None,
    node_id="",
    on_chunk: Optional[Callable] = None,
    raw_messages: Optional[list] = None,
):
    base = (url or "http://localhost:11434").rstrip("/")
    endpoint = f"{base}/chat" if base.endswith("/api") else f"{base}/api/chat"

    if raw_messages:
        messages = raw_messages
    else:
        encoded_images = [pil_to_base64(img) for img in images]
        user_msg = {"role": "user", "content": message}
        if encoded_images:
            user_msg["images"] = encoded_images

        messages = [
            {"role": "system", "content": system},
            user_msg,
        ]

    options = {
        "temperature": max(float(temperature), 0.01),
        "repeat_penalty": 1.1,
        "stop": ["<|im_end|>", "<|endoftext|>"],
    }
    if seed >= 0:
        options["seed"] = int(seed)
    if max_tokens:
        options["num_predict"] = int(max_tokens)

    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": options,
    }

    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "MiniMaxCreator"},
    )

    tracker = _StreamTracker(on_chunk)
    cancel_ev = threading.Event()
    if node_id:
        _CANCEL_EVENTS[str(node_id)] = cancel_ev

    try:
        resp = urllib.request.urlopen(req, timeout=600)
        if node_id:
            _ACTIVE_SOCKETS[str(node_id)] = resp

        while True:
            if cancel_ev.is_set():
                raise refine.RefineError("Refinement was cancelled.")
            line = resp.readline()
            if not line or cancel_ev.is_set():
                break
            try:
                chunk_obj = json.loads(line.decode("utf-8", errors="replace"))
                msg = chunk_obj.get("message", {})
                delta = msg.get("content", "") or msg.get("thinking", "")
                tracker.process(delta)
                if chunk_obj.get("done", False):
                    break
            except Exception:
                continue

        content = tracker.full_text()
        if not content.strip() and not cancel_ev.is_set():
            raise refine.RefineError("Ollama stream returned empty output.")
        return content
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise refine.RefineError(f"Ollama API error ({exc.code}): {err_body}") from exc
    except Exception as exc:
        if cancel_ev.is_set() or "closed" in str(exc).lower():
            raise refine.RefineError("Refinement was cancelled.") from exc
        raise refine.RefineError(f"Ollama stream error: {exc}") from exc
    finally:
        if node_id:
            _ACTIVE_SOCKETS.pop(str(node_id), None)
            _CANCEL_EVENTS.pop(str(node_id), None)


def _raw_chat_openai(
    url,
    model,
    system,
    message,
    images=(),
    temperature=0.3,
    seed=-1,
    max_tokens=None,
    node_id="",
    on_chunk: Optional[Callable] = None,
    raw_messages: Optional[list] = None,
):
    base = (url or "http://localhost:1234/v1").rstrip("/")
    endpoint = f"{base}/chat/completions" if base.endswith("/v1") else f"{base}/v1/chat/completions"

    if raw_messages:
        messages = raw_messages
    else:
        user_content = [{"type": "text", "text": message}]
        for img in images:
            b64_img = pil_to_base64(img)
            user_content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"},
            })

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content if images else message},
        ]

    payload = {
        "model": model,
        "messages": messages,
        "temperature": max(float(temperature), 0.01),
        "stream": True,
    }
    if seed >= 0:
        payload["seed"] = int(seed)
    if max_tokens:
        payload["max_tokens"] = int(max_tokens)

    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "MiniMaxCreator"},
    )

    tracker = _StreamTracker(on_chunk)
    cancel_ev = threading.Event()
    if node_id:
        _CANCEL_EVENTS[str(node_id)] = cancel_ev

    try:
        resp = urllib.request.urlopen(req, timeout=600)
        if node_id:
            _ACTIVE_SOCKETS[str(node_id)] = resp

        while True:
            if cancel_ev.is_set():
                raise refine.RefineError("Refinement was cancelled.")
            line = resp.readline()
            if not line or cancel_ev.is_set():
                break
            line_str = line.decode("utf-8", errors="replace").strip()
            if not line_str or not line_str.startswith("data:"):
                continue
            data_part = line_str[5:].strip()
            if data_part == "[DONE]":
                break
            try:
                chunk_obj = json.loads(data_part)
                choices = chunk_obj.get("choices", [])
                if choices:
                    delta_obj = choices[0].get("delta", {})
                    delta_text = delta_obj.get("content", "") or delta_obj.get("reasoning_content", "")
                    tracker.process(delta_text)
            except Exception:
                continue

        content = tracker.full_text()
        if not content.strip() and not cancel_ev.is_set():
            raise refine.RefineError("LM Studio/OpenAI stream returned empty output.")
        return content
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise refine.RefineError(f"LM Studio/OpenAI API error ({exc.code}): {err_body}") from exc
    except Exception as exc:
        if cancel_ev.is_set() or "closed" in str(exc).lower():
            raise refine.RefineError("Refinement was cancelled.") from exc
        raise refine.RefineError(f"LM Studio/OpenAI stream error: {exc}") from exc
    finally:
        if node_id:
            _ACTIVE_SOCKETS.pop(str(node_id), None)
            _CANCEL_EVENTS.pop(str(node_id), None)


def _raw_chat_openrouter(
    url,
    model,
    system,
    message,
    images=(),
    temperature=0.3,
    seed=-1,
    max_tokens=None,
    api_key="",
    node_id="",
    on_chunk: Optional[Callable] = None,
    raw_messages: Optional[list] = None,
):
    base = (url or "https://openrouter.ai/api/v1").rstrip("/")
    endpoint = f"{base}/chat/completions" if base.endswith("/v1") else f"{base}/v1/chat/completions"

    if raw_messages:
        messages = raw_messages
    else:
        user_content = [{"type": "text", "text": message}]
        for img in images:
            b64_img = pil_to_base64(img)
            user_content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"},
            })

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content if images else message},
        ]

    payload = {
        "model": model,
        "messages": messages,
        "temperature": max(float(temperature), 0.01),
        "stream": True,
    }
    if seed >= 0:
        payload["seed"] = int(seed)
    if max_tokens:
        payload["max_tokens"] = int(max_tokens)

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "MiniMaxCreator",
        "HTTP-Referer": "https://github.com/roadmaus/ComfyUI-MiniMax-Creator",
        "X-Title": "ComfyUI-MiniMax-Creator",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(endpoint, data=json.dumps(payload).encode("utf-8"), headers=headers)

    tracker = _StreamTracker(on_chunk)
    cancel_ev = threading.Event()
    if node_id:
        _CANCEL_EVENTS[str(node_id)] = cancel_ev

    try:
        resp = urllib.request.urlopen(req, timeout=600)
        if node_id:
            _ACTIVE_SOCKETS[str(node_id)] = resp

        while True:
            if cancel_ev.is_set():
                raise refine.RefineError("Refinement was cancelled.")
            line = resp.readline()
            if not line or cancel_ev.is_set():
                break
            line_str = line.decode("utf-8", errors="replace").strip()
            if not line_str or not line_str.startswith("data:"):
                continue
            data_part = line_str[5:].strip()
            if data_part == "[DONE]":
                break
            try:
                chunk_obj = json.loads(data_part)
                choices = chunk_obj.get("choices", [])
                if choices:
                    delta_obj = choices[0].get("delta", {})
                    delta_text = delta_obj.get("content", "") or delta_obj.get("reasoning", "")
                    tracker.process(delta_text)
            except Exception:
                continue

        content = tracker.full_text()
        if not content.strip() and not cancel_ev.is_set():
            raise refine.RefineError("OpenRouter stream returned empty output.")
        return content
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise refine.RefineError(f"OpenRouter API error ({exc.code}): {err_body}") from exc
    except Exception as exc:
        if cancel_ev.is_set() or "closed" in str(exc).lower():
            raise refine.RefineError("Refinement was cancelled.") from exc
        raise refine.RefineError(f"OpenRouter stream error: {exc}") from exc
    finally:
        if node_id:
            _ACTIVE_SOCKETS.pop(str(node_id), None)
            _CANCEL_EVENTS.pop(str(node_id), None)


# ---------------------------------------------------------------------------
# Public Wrappers
# ---------------------------------------------------------------------------

def chat_ollama(url, model, system, message, images=(), temperature=0.3, seed=-1, max_tokens=None, node_id="", on_chunk=None, raw_messages=None):
    if images and not raw_messages:
        try:
            return _raw_chat_ollama(url, model, system, message, images, temperature, seed, max_tokens, node_id, on_chunk)
        except refine.RefineError as exc:
            err_msg = str(exc).lower()
            if any(k in err_msg for k in ("image", "vision", "multimodal", "400", "404")):
                return _raw_chat_ollama(url, model, system, message, (), temperature, seed, max_tokens, node_id, on_chunk)
            raise
    return _raw_chat_ollama(url, model, system, message, (), temperature, seed, max_tokens, node_id, on_chunk, raw_messages=raw_messages)


def chat_openai(url, model, system, message, images=(), temperature=0.3, seed=-1, max_tokens=None, node_id="", on_chunk=None, raw_messages=None):
    if images and not raw_messages:
        try:
            return _raw_chat_openai(url, model, system, message, images, temperature, seed, max_tokens, node_id, on_chunk)
        except refine.RefineError as exc:
            err_msg = str(exc).lower()
            if any(k in err_msg for k in ("image", "vision", "multimodal", "400", "404", "detail")):
                return _raw_chat_openai(url, model, system, message, (), temperature, seed, max_tokens, node_id, on_chunk)
            raise
    return _raw_chat_openai(url, model, system, message, (), temperature, seed, max_tokens, node_id, on_chunk, raw_messages=raw_messages)


def chat_openrouter(url, model, system, message, images=(), temperature=0.3, seed=-1, max_tokens=None, api_key="", node_id="", on_chunk=None, raw_messages=None):
    if images and not raw_messages:
        try:
            return _raw_chat_openrouter(url, model, system, message, images, temperature, seed, max_tokens, api_key, node_id, on_chunk)
        except refine.RefineError as exc:
            err_msg = str(exc).lower()
            if any(k in err_msg for k in ("image", "vision", "multimodal", "400", "404", "endpoint")):
                return _raw_chat_openrouter(url, model, system, message, (), temperature, seed, max_tokens, api_key, node_id, on_chunk)
            raise
    return _raw_chat_openrouter(url, model, system, message, (), temperature, seed, max_tokens, api_key, node_id, on_chunk, raw_messages=raw_messages)