"""Feature C — "Ask Thyme": one chat surface answering free-text questions
about the user's own pantry.

Not a separate system from A and B — it's a conversational wrapper around
the same facts: the user's real item data (grounds "what's expiring this
week?") and the same curated disposal guidance used by /v1/guidance (grounds
"can I still use this?" without ever inventing a disposal programme name).
The model is only ever handed real data and told explicitly not to guess
beyond it.

Unlike suggestions.py (feature A), a failure here is NOT swallowed to an
empty result — a chat answer that silently comes back blank looks broken to
someone who just asked a direct question, whereas a missing suggestion
button is barely noticed. The route converts GeminiUnavailable into a
visible error instead.
"""

from __future__ import annotations

from datetime import date
from typing import NamedTuple

from app.schemas.item import ItemOut
from app.services import guidance as guidance_service
from app.services.gemini_client import generate_text
from app.services.item_view import as_date

MAX_ITEMS_IN_CONTEXT = 40
MAX_GUIDANCE_ITEMS = 8
MAX_HISTORY_TURNS = 6

_SYSTEM_PROMPT = """You are "Ask Thyme", the in-app assistant for Thyme, a \
pantry and cosmetics expiry tracker used by a household in Malaysia.

Answer the user's question using ONLY the pantry data and guidance notes \
given below - never invent an item, a date, or a disposal programme name \
that isn't in this data. If the data doesn't cover what's asked, say so \
plainly rather than guessing.

For anything about whether it's safe to eat or use an item, or how to \
dispose of medicine or chemicals: if a guidance note is given for that \
item, base your answer on it and mention it's backed by a cited source; if \
none is given, say you don't have official guidance for that item and \
suggest checking the packaging or asking a pharmacist - never invent a \
disposal scheme name.

Keep answers short (2-4 sentences), plain, and conversational - no \
markdown, no headings, no bullet lists."""


class ChatTurn(NamedTuple):
    role: str  # "user" | "assistant"
    text: str


def _item_line(item: ItemOut, category_label: str | None) -> str:
    bits = [
        item.name,
        f"category: {category_label or 'uncategorised'}",
        f"status: {item.status.value}",
        f"urgency: {item.urgency.value}",
        f"days_remaining: {item.days_remaining}",
        f"expiry: {item.effective_expiry_date}",
    ]
    if item.opened_at:
        bits.append(f"opened: {item.opened_at}")
    return "- " + ", ".join(bits)


def build_pantry_context(items: list[ItemOut], category_labels: dict[str, str]) -> str:
    if not items:
        return "The user's pantry is currently empty."
    lines = [_item_line(item, category_labels.get(item.category_id or "")) for item in items[:MAX_ITEMS_IN_CONTEXT]]
    return (
        "Pantry items (name, category, status, urgency, days remaining, expiry, opened date if any):\n"
        + "\n".join(lines)
    )


def build_guidance_context(db, items: list[ItemOut], today: date) -> str:
    """Curated advice for the user's most urgent items, so a safety-adjacent
    question ("can I still use this?") is grounded in a real cited source
    instead of the model guessing. Skips generic fallback rows — those
    aren't a real citation, just a category-agnostic default.
    """
    urgent = [item for item in items if item.urgency.value in ("expired", "critical")][:MAX_GUIDANCE_ITEMS]
    notes: list[str] = []
    for item in urgent:
        condition = guidance_service.condition_for(as_date(item.effective_expiry_date), today)
        g = guidance_service.lookup(db, category_id=item.category_id, condition=condition)
        if g.is_fallback:
            continue
        source = f" (source: {g.source_url})" if g.source_url else ""
        notes.append(f"- {item.name}: {g.title} — {g.body} Steps: {'; '.join(g.steps)}{source}")

    if not notes:
        return ""
    return "Guidance notes for urgent/expired items (curated, cite as instructed above):\n" + "\n".join(notes)


def _build_prompt(question: str, history: list[ChatTurn], pantry_context: str, guidance_context: str) -> str:
    parts = [_SYSTEM_PROMPT, "", pantry_context]
    if guidance_context:
        parts += ["", guidance_context]
    if history:
        parts += ["", "Conversation so far:"]
        for turn in history[-MAX_HISTORY_TURNS:]:
            speaker = "User" if turn.role == "user" else "Thyme"
            parts.append(f"{speaker}: {turn.text}")
    parts += ["", f"User: {question}", "Thyme:"]
    return "\n".join(parts)


async def ask(
    *, question: str, history: list[ChatTurn], pantry_context: str, guidance_context: str
) -> str:
    """Raises GeminiUnavailable on failure — the caller must surface this as
    a real error, not swallow it (see module docstring for why)."""
    prompt = _build_prompt(question, history, pantry_context, guidance_context)
    answer = await generate_text(prompt)
    return answer.strip()
