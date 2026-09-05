"""Usage and disposal advice.

Curated rows from the disposal_guidance table, chosen by category and by whether
the item has actually expired. Deterministic on purpose: no language model sits
between a user and instructions about medicine or household chemicals, and every
string is one a person wrote and can be held to.

Falls back along two axes so a request always gets something useful:
  locale    requested -> English
  category  requested -> a generic entry for the expiry state
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Any

from postgrest.exceptions import APIError

from supabase import Client

logger = logging.getLogger(__name__)

TABLE = "disposal_guidance"

BEFORE_EXPIRY = "before_expiry"
AFTER_EXPIRY = "after_expiry"

DEFAULT_LOCALE = "en"


@dataclass(frozen=True)
class Guidance:
    category_id: str | None
    condition: str
    locale: str
    title: str
    body: str
    steps: list[str]
    severity: str
    source_url: str | None
    #: True when the exact category had no entry and a generic one was used.
    is_fallback: bool = False


def condition_for(effective_expiry: date, today: date) -> str:
    """Advice flips at the moment of expiry, not before."""
    return AFTER_EXPIRY if effective_expiry < today else BEFORE_EXPIRY


_GENERIC: dict[str, Guidance] = {
    BEFORE_EXPIRY: Guidance(
        category_id=None,
        condition=BEFORE_EXPIRY,
        locale=DEFAULT_LOCALE,
        title="Use it before the date passes",
        body=(
            "This item is still within date. Move it to the front of the shelf so "
            "you see it, and plan to use it up rather than letting it lapse."
        ),
        steps=[
            "Store it as the packaging directs.",
            "Use whatever expires soonest first.",
        ],
        severity="info",
        source_url=None,
        is_fallback=True,
    ),
    AFTER_EXPIRY: Guidance(
        category_id=None,
        condition=AFTER_EXPIRY,
        locale=DEFAULT_LOCALE,
        title="Past its date — check before using or discarding",
        body=(
            "This item has passed its date. Inspect it before deciding, and when in "
            "doubt dispose of it rather than using it."
        ),
        steps=[
            "Do not use it if it looks, smells or feels wrong.",
            "Check whether your area has a collection point for this kind of waste.",
        ],
        severity="caution",
        source_url=None,
        is_fallback=True,
    ),
}


def _row_to_guidance(row: dict[str, Any], *, is_fallback: bool = False) -> Guidance:
    return Guidance(
        category_id=row.get("category_id"),
        condition=row["condition"],
        locale=row.get("locale", DEFAULT_LOCALE),
        title=row["title"],
        body=row["body"],
        steps=list(row.get("steps") or []),
        severity=row.get("severity", "info"),
        source_url=row.get("source_url"),
        is_fallback=is_fallback,
    )


def lookup(
    client: Client,
    *,
    category_id: str | None,
    condition: str,
    locale: str = DEFAULT_LOCALE,
) -> Guidance:
    """Best available advice. Always returns something."""
    if not category_id:
        return _GENERIC[condition]

    try:
        result = (
            client.table(TABLE)
            .select("*")
            .eq("category_id", category_id)
            .eq("condition", condition)
            .execute()
        )
    except APIError as exc:
        logger.warning("guidance_lookup_failed", extra={"reason": str(exc)[:200]})
        return _GENERIC[condition]

    rows = result.data or []
    if not rows:
        return _GENERIC[condition]

    # Requested locale, else English, else whatever exists.
    by_locale = {row.get("locale", DEFAULT_LOCALE): row for row in rows}
    row = by_locale.get(locale) or by_locale.get(DEFAULT_LOCALE) or rows[0]
    return _row_to_guidance(row)
