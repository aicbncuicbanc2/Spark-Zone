"""Turns a database row into the ItemOut the app receives.

Shared by the list, detail and dashboard routes so `days_remaining` and
`urgency` are computed in exactly one place.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from app.schemas.item import ItemOut
from app.services.priority import describe


def as_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def to_item_out(row: dict[str, Any], today: date) -> ItemOut:
    effective = as_date(row["effective_expiry_date"])
    days, urgency = describe(effective, today)

    # PostgREST returns the embedded scan as a nested object (or null for a
    # manual entry). Flatten it so the client sees a plain image_url.
    row = dict(row)
    scan = row.pop("scans", None)
    row.setdefault("image_url", (scan or {}).get("image_url") if scan else None)

    return ItemOut(**row, days_remaining=days, urgency=urgency)


def to_item_list(rows: list[dict[str, Any]], today: date) -> list[ItemOut]:
    return [to_item_out(row, today) for row in rows]
