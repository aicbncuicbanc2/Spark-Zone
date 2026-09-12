"""Feature C — "Ask Thyme".

Pure logic around context-building and prompt assembly, plus the one
deliberate behavioural difference from feature A: a Gemini failure here must
propagate, not degrade to something that looks like a normal answer.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app.schemas.common import Urgency
from app.schemas.item import DateSource, ItemOut, ItemStatus
from app.services import ask
from app.services.gemini_client import GeminiUnavailable

NOW = datetime(2026, 9, 12, tzinfo=timezone.utc)


def make_item(
    *,
    name: str,
    category_id: str | None,
    urgency: Urgency,
    days_remaining: int,
    effective_expiry_date: date = date(2026, 9, 12),
    opened_at: date | None = None,
    status: ItemStatus = ItemStatus.ACTIVE,
) -> ItemOut:
    return ItemOut(
        id="item-1",
        name=name,
        category_id=category_id,
        expiry_date=effective_expiry_date,
        opened_at=opened_at,
        effective_expiry_date=effective_expiry_date,
        days_remaining=days_remaining,
        urgency=urgency,
        quantity=1,
        date_source=DateSource.USER,
        status=status,
        created_at=NOW,
        updated_at=NOW,
    )


def test_build_pantry_context_empty() -> None:
    assert ask.build_pantry_context([], {}) == "The user's pantry is currently empty."


def test_build_pantry_context_includes_key_facts() -> None:
    item = make_item(name="Fresh Milk 1L", category_id="food", urgency=Urgency.EXPIRED, days_remaining=-22)

    context = ask.build_pantry_context([item], {"food": "Food"})

    assert "Fresh Milk 1L" in context
    assert "category: Food" in context
    assert "urgency: expired" in context
    assert "days_remaining: -22" in context


def test_build_pantry_context_caps_at_max_items() -> None:
    items = [
        make_item(name=f"Item {i}", category_id=None, urgency=Urgency.OK, days_remaining=100) for i in range(50)
    ]

    context = ask.build_pantry_context(items, {})

    assert context.count("Item ") == ask.MAX_ITEMS_IN_CONTEXT


def test_build_guidance_context_only_covers_urgent_items(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import guidance as guidance_service

    expired_item = make_item(name="Panadol", category_id="medicine", urgency=Urgency.EXPIRED, days_remaining=-5)
    fine_item = make_item(name="Milo", category_id="food", urgency=Urgency.OK, days_remaining=200)

    calls: list[str | None] = []

    def fake_lookup(db, *, category_id, condition, locale="en"):
        calls.append(category_id)
        return guidance_service.Guidance(
            category_id=category_id,
            condition=condition,
            locale="en",
            title="Return to a pharmacy",
            body="Do not throw in household waste.",
            steps=["Bring to a collection point."],
            severity="hazard",
            source_url="https://example.gov/medicine-disposal",
            is_fallback=False,
        )

    monkeypatch.setattr(guidance_service, "lookup", fake_lookup)

    context = ask.build_guidance_context(db=object(), items=[expired_item, fine_item], today=date(2026, 9, 12))

    assert calls == ["medicine"]  # only the urgent item triggers a lookup
    assert "Panadol" in context
    assert "Return to a pharmacy" in context
    assert "https://example.gov/medicine-disposal" in context
    assert "Milo" not in context


def test_build_guidance_context_skips_generic_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import guidance as guidance_service

    expired_item = make_item(name="Mystery Item", category_id="other", urgency=Urgency.EXPIRED, days_remaining=-1)

    def fake_lookup(db, *, category_id, condition, locale="en"):
        return guidance_service.Guidance(
            category_id=None,
            condition=condition,
            locale="en",
            title="Generic advice",
            body="...",
            steps=[],
            severity="info",
            source_url=None,
            is_fallback=True,
        )

    monkeypatch.setattr(guidance_service, "lookup", fake_lookup)

    context = ask.build_guidance_context(db=object(), items=[expired_item], today=date(2026, 9, 12))

    assert context == ""


async def test_ask_propagates_gemini_failure_instead_of_degrading(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unlike feature A's suggestions, a chat answer must not silently
    become an empty/blank string on failure - the route needs to see this
    error and turn it into a visible message."""

    async def fake_generate_text(prompt: str, **kwargs: object) -> str:
        raise GeminiUnavailable("no key configured")

    monkeypatch.setattr(ask, "generate_text", fake_generate_text)

    with pytest.raises(GeminiUnavailable):
        await ask.ask(question="What's expiring soon?", history=[], pantry_context="...", guidance_context="")


async def test_ask_strips_whitespace_from_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_generate_text(prompt: str, **kwargs: object) -> str:
        return "  Sure, here's the answer.  \n"

    monkeypatch.setattr(ask, "generate_text", fake_generate_text)

    answer = await ask.ask(question="q", history=[], pantry_context="...", guidance_context="")

    assert answer == "Sure, here's the answer."


def test_prompt_includes_question_pantry_and_history() -> None:
    history = [ask.ChatTurn(role="user", text="Earlier question"), ask.ChatTurn(role="assistant", text="Earlier answer")]

    prompt = ask._build_prompt("New question", history, "PANTRY_CONTEXT_MARKER", "GUIDANCE_CONTEXT_MARKER")

    assert "PANTRY_CONTEXT_MARKER" in prompt
    assert "GUIDANCE_CONTEXT_MARKER" in prompt
    assert "Earlier question" in prompt
    assert "Earlier answer" in prompt
    assert "New question" in prompt


def test_prompt_omits_guidance_section_when_empty() -> None:
    prompt = ask._build_prompt("q", [], "PANTRY_CONTEXT_MARKER", "")

    assert "Guidance notes" not in prompt
