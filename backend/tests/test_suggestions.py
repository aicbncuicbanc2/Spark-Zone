"""Feature A — "what should I use this for?" suggestions.

Pure logic around the Gemini call, which is mocked here: these tests check
that a valid response gets parsed and capped correctly, and that every kind
of failure degrades to an empty list rather than raising.
"""

from __future__ import annotations

import json

import pytest

from app.services import suggestions
from app.services.gemini_client import GeminiUnavailable


async def test_parses_a_valid_json_array(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_generate_json(prompt: str, **kwargs: object) -> str:
        return json.dumps(["Use it in a stir-fry tonight.", "Freeze the rest for later."])

    monkeypatch.setattr(suggestions, "generate_json", fake_generate_json)

    result = await suggestions.get_usage_suggestions(name="Chicken Breast", category="Food", days_remaining=2)

    assert result == ["Use it in a stir-fry tonight.", "Freeze the rest for later."]


async def test_caps_at_three_suggestions(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_generate_json(prompt: str, **kwargs: object) -> str:
        return json.dumps(["one", "two", "three", "four", "five"])

    monkeypatch.setattr(suggestions, "generate_json", fake_generate_json)

    result = await suggestions.get_usage_suggestions(name="X", category=None, days_remaining=5)

    assert result == ["one", "two", "three"]


async def test_drops_blank_and_non_string_entries(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_generate_json(prompt: str, **kwargs: object) -> str:
        return json.dumps(["Real suggestion.", "  ", "", 42])

    monkeypatch.setattr(suggestions, "generate_json", fake_generate_json)

    result = await suggestions.get_usage_suggestions(name="X", category=None, days_remaining=1)

    assert result == ["Real suggestion."]


async def test_returns_empty_list_when_gemini_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_generate_json(prompt: str, **kwargs: object) -> str:
        raise GeminiUnavailable("no key configured")

    monkeypatch.setattr(suggestions, "generate_json", fake_generate_json)

    result = await suggestions.get_usage_suggestions(name="X", category=None, days_remaining=1)

    assert result == []


async def test_returns_empty_list_on_unparsable_json(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_generate_json(prompt: str, **kwargs: object) -> str:
        return "not json at all"

    monkeypatch.setattr(suggestions, "generate_json", fake_generate_json)

    result = await suggestions.get_usage_suggestions(name="X", category=None, days_remaining=1)

    assert result == []


async def test_returns_empty_list_when_response_is_not_a_list(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_generate_json(prompt: str, **kwargs: object) -> str:
        return json.dumps({"not": "a list"})

    monkeypatch.setattr(suggestions, "generate_json", fake_generate_json)

    result = await suggestions.get_usage_suggestions(name="X", category=None, days_remaining=1)

    assert result == []


def test_prompt_includes_the_item_facts() -> None:
    prompt = suggestions._PROMPT.format(name="Panadol Extra", category="Medicine", days_remaining=-3)

    assert "Panadol Extra" in prompt
    assert "Medicine" in prompt
    assert "-3" in prompt
