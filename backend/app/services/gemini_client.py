"""Google Gemini — used only for short, non-critical AI suggestions.

Never used for anything a user could be harmed by trusting blindly, like
medicine or chemical disposal advice; that stays curated in services/guidance.py
on purpose. This client is for lower-stakes, advisory-only text: a "what
should I use this for?" suggestion is a minor loss if it's ever wrong or
simply unavailable, unlike a disposal instruction.

Talked to directly over its REST API via httpx (already a dependency) rather
than adding the google-genai SDK — one JSON endpoint doesn't need a whole
client library on top of what's already installed.
"""

from __future__ import annotations

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiUnavailable(Exception):
    """Raised whenever a call could not produce an answer — no key
    configured, a network failure, a non-2xx response, or an unexpected
    response shape. Callers must catch this and degrade (hide the AI
    feature, return an empty result) rather than let it become a 500."""


async def _call(prompt: str, *, json_mode: bool, timeout: float) -> str:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise GeminiUnavailable("GEMINI_API_KEY is not configured")

    url = _ENDPOINT.format(model=settings.gemini_model)
    body: dict = {"contents": [{"role": "user", "parts": [{"text": prompt}]}]}
    if json_mode:
        body["generationConfig"] = {"responseMimeType": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, params={"key": settings.gemini_api_key}, json=body)
        response.raise_for_status()
        data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as exc:  # noqa: BLE001 - any failure here must degrade, not crash
        logger.warning("gemini_call_failed", extra={"reason": str(exc)})
        raise GeminiUnavailable(str(exc)) from exc


async def generate_json(prompt: str, *, timeout: float = 12.0) -> str:
    """Sends one prompt, asking Gemini to answer as JSON, and returns the raw
    JSON text from the first candidate. Raises GeminiUnavailable on any
    failure; never raises anything else."""
    return await _call(prompt, json_mode=True, timeout=timeout)


async def generate_text(prompt: str, *, timeout: float = 20.0) -> str:
    """Sends one prompt and returns the plain-text answer from the first
    candidate — for conversational output, not structured data. A longer
    default timeout than generate_json: a chat answer with fuller context
    takes longer to produce than a short suggestions list. Raises
    GeminiUnavailable on any failure; never raises anything else."""
    return await _call(prompt, json_mode=False, timeout=timeout)
