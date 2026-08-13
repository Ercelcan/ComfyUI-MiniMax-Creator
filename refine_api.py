import base64
import json
import urllib.error
import urllib.request
from io import BytesIO
from . import refine


def pil_to_base64(img, fmt="JPEG"):
    buffer = BytesIO()
    img.convert("RGB").save(buffer, format=fmt, quality=85)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def fetch_models_ollama(url):
    base = (url or "http://localhost:11434").rstrip("/")
    if base.endswith("/api"):
        endpoint = f"{base}/tags"
    else:
        endpoint = f"{base}/api/tags"
    req = urllib.request.Request(endpoint, headers={"User-Agent": "MiniMaxCreator"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            models = [m.get("name") for m in data.get("models", []) if m.get("name")]
            return models
    except Exception as exc:
        raise RuntimeError(f"Could not connect to Ollama at {url}: {exc}") from exc


def fetch_models_openai(url):
    base = (url or "http://localhost:1234/v1").rstrip("/")
    if base.endswith("/v1"):
        endpoint = f"{base}/models"
    else:
        endpoint = f"{base}/v1/models"
    req = urllib.request.Request(endpoint, headers={"User-Agent": "MiniMaxCreator"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            models = [m.get("id") for m in data.get("data", []) if m.get("id")]
            return models
    except Exception as exc:
        raise RuntimeError(f"Could not connect to LM Studio/OpenAI at {url}: {exc}") from exc


def fetch_models_openrouter(url, api_key=""):
    base = (url or "https://openrouter.ai/api/v1").rstrip("/")
    if base.endswith("/v1"):
        endpoint = f"{base}/models"
    else:
        endpoint = f"{base}/v1/models"
    
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
            models = [m.get("id") for m in data.get("data", []) if m.get("id")]
            return sorted(models)
    except Exception as exc:
        raise RuntimeError(f"Could not connect to OpenRouter at {url}: {exc}") from exc


def chat_ollama(url, model, system, message, images=(), temperature=0.3, seed=-1, max_tokens=None):
    base = (url or "http://localhost:11434").rstrip("/")
    if base.endswith("/api"):
        endpoint = f"{base}/chat"
    else:
        endpoint = f"{base}/api/chat"

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
    }
    if seed >= 0:
        options["seed"] = int(seed)
    if max_tokens:
        options["num_predict"] = int(max_tokens)

    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": options,
    }

    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "MiniMaxCreator"},
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            content = res_data.get("message", {}).get("content", "")
            if not content.strip():
                raise refine.RefineError("Ollama returned an empty response.")
            return content
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise refine.RefineError(f"Ollama API error ({exc.code}): {err_body}") from exc
    except Exception as exc:
        raise refine.RefineError(f"Ollama connection error: {exc}") from exc


def chat_openai(url, model, system, message, images=(), temperature=0.3, seed=-1, max_tokens=None):
    base = (url or "http://localhost:1234/v1").rstrip("/")
    if base.endswith("/v1"):
        endpoint = f"{base}/chat/completions"
    else:
        endpoint = f"{base}/v1/chat/completions"

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

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            choices = res_data.get("choices", [])
            if not choices:
                raise refine.RefineError("LM Studio/OpenAI returned no completion choices.")
            content = choices[0].get("message", {}).get("content", "")
            if not content.strip():
                raise refine.RefineError("LM Studio/OpenAI returned an empty response.")
            return content
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise refine.RefineError(f"LM Studio/OpenAI API error ({exc.code}): {err_body}") from exc
    except Exception as exc:
        raise refine.RefineError(f"LM Studio/OpenAI connection error: {exc}") from exc


def chat_openrouter(url, model, system, message, images=(), temperature=0.3, seed=-1, max_tokens=None, api_key=""):
    base = (url or "https://openrouter.ai/api/v1").rstrip("/")
    if base.endswith("/v1"):
        endpoint = f"{base}/chat/completions"
    else:
        endpoint = f"{base}/v1/chat/completions"

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

    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            choices = res_data.get("choices", [])
            if not choices:
                raise refine.RefineError("OpenRouter returned no completion choices.")
            content = choices[0].get("message", {}).get("content", "")
            if not content.strip():
                raise refine.RefineError("OpenRouter returned an empty response.")
            return content
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise refine.RefineError(f"OpenRouter API error ({exc.code}): {err_body}") from exc
    except Exception as exc:
        raise refine.RefineError(f"OpenRouter connection error: {exc}") from exc