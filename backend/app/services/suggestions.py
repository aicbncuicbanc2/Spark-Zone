"""Feature A — "what should I use this for?"

Sends an item's name, category and days-remaining to Gemini and asks for 2-3
short, practical suggestions: a recipe idea for food, a repurposing tip for a
near-expiry cosmetic, a nudge to use up medicine as directed. Purely
advisory and non-critical — any failure degrades to an empty list rather
than a hard error, since a missing suggestion button is a minor loss, unlike
(say) a wrong disposal instruction.
"""

from __future__ import annotations

import json
import logging

from app.services.gemini_client import GeminiUnavailable, generate_json

logger = logging.getLogger(__name__)

MAX_SUGGESTIONS = 3

_PROMPT = """You help a household in Malaysia get more use out of a pantry, \
medicine cabinet, or cosmetics item before it goes to waste.

Item: {name}
Category: {category}
Days remaining until its use-by date (negative means already past it): {days_remaining}

Give 2 to 3 short, practical, safe suggestions for what to do with this item \
right now — a recipe idea for food, a repurposing tip for a near-expiry \
cosmetic, a reminder to use up medicine or supplements as directed. Each \
suggestion must be one plain sentence — no headings, no markdown, no \
disclaimers. Never suggest consuming or applying anything already unsafe \
(e.g. an expired medicine or an expired perishable food) — in that case, \
only suggest disposal or consulting a pharmacist.

Respond with ONLY a JSON array of 2-3 strings, nothing else. Example:
["Suggestion one.", "Suggestion two."]"""


async def get_usage_suggestions(*, name: str, category: str | None, days_remaining: int) -> list[str]:
    prompt = _PROMPT.format(name=name, category=category or "uncategorised", days_remaining=days_remaining)

    try:
        raw = await generate_json(prompt)
        parsed = json.loads(raw)
    except (GeminiUnavailable, json.JSONDecodeError) as exc:
        logger.warning("suggestions_unavailable", extra={"reason": str(exc)})
        return []

    if not isinstance(parsed, list):
        return []
    return [item.strip() for item in parsed if isinstance(item, str) and item.strip()][:MAX_SUGGESTIONS]
