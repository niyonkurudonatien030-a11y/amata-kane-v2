"""Server-side Gemini client. The API key lives only in the server environment (.env) and is never sent to the browser."""
import base64
import json
import re

import requests
from flask import current_app

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class AIUnavailable(Exception):
    """Gemini is not configured, unreachable, or returned something unusable."""


def image_part(data: bytes, mime_type: str):
    return {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(data).decode("ascii")}}


def generate(parts, system=None, json_mode=False, timeout=60):
    cfg = current_app.config
    key = cfg.get("GEMINI_API_KEY")
    if not key:
        raise AIUnavailable("Gemini is not configured on this server (GEMINI_API_KEY is empty).")
    body = {"contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": 0.1}}
    if system:
        body["system_instruction"] = {"parts": [{"text": system}]}
    if json_mode:
        body["generationConfig"]["responseMimeType"] = "application/json"
    try:
        # The key goes in a header, not the URL, so it does not end up in access logs.
        resp = requests.post(API_URL.format(model=cfg["GEMINI_MODEL"]), json=body, timeout=timeout,
                             headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    except requests.RequestException:
        raise AIUnavailable("Could not reach Gemini. Check the internet connection and try again.")
    if resp.status_code != 200:
        raise AIUnavailable(f"Gemini returned HTTP {resp.status_code}. Check the API key, model name and quota.")
    try:
        data = resp.json()
        return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"]).strip()
    except (ValueError, KeyError, IndexError, TypeError):
        raise AIUnavailable("Gemini returned an unexpected response (it may have blocked the content).")


def parse_json(text):
    """Gemini sometimes wraps JSON in ```json fences. Return a dict or None."""
    cleaned = re.sub(r"^```(?:json)?|```$", "", (text or "").strip(), flags=re.M).strip()
    try:
        value = json.loads(cleaned)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None
