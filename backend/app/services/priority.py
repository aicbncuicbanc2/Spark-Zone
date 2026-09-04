"""Urgency scoring.

The single place that decides what "expiring soon" means. Reminders, the
dashboard and the item list all read from here, so the buckets can never drift
apart — and the frontend never recalculates them.

Everything is computed against *the user's own* local date. A person in Kuala
Lumpur must not be told their milk expires tomorrow because a server in Tokyo
has already rolled over to the next day.
"""

from __future__ import annotations

from datetime import date, datetime, timezone, tzinfo
from zoneinfo import ZoneInfo

from app.schemas.common import Urgency

DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur"

# Upper bound of days_remaining for each bucket, in order. First match wins.
_THRESHOLDS: tuple[tuple[int, Urgency], ...] = (
    (-1, Urgency.EXPIRED),   # already past
    (1, Urgency.CRITICAL),   # today or tomorrow
    (3, Urgency.SOON),
    (7, Urgency.UPCOMING),
)


def resolve_timezone(name: str | None) -> tzinfo:
    """Best available zone, and this must never raise.

    Falls back through: requested zone -> Asia/Kuala_Lumpur -> UTC.

    The UTC step is not paranoia. ZoneInfo reads the IANA database from the
    operating system, and Windows ships none at all while slim Linux images
    often omit it. The `tzdata` package in requirements.txt supplies it, but a
    timezone lookup is not worth a 500 if that is ever missing.
    """
    for candidate in (name, DEFAULT_TIMEZONE):
        if not candidate:
            continue
        try:
            return ZoneInfo(candidate)
        except Exception:  # noqa: BLE001, S112 - any failure means "try the next one"
            continue
    return timezone.utc


def is_known_timezone(name: str) -> bool:
    """True only for a zone the system can actually load."""
    try:
        ZoneInfo(name)
    except Exception:  # noqa: BLE001
        return False
    return True


def today_for_user(timezone_name: str | None) -> date:
    return datetime.now(resolve_timezone(timezone_name)).date()


def days_remaining(effective_expiry: date, today: date) -> int:
    """Negative once expired. 0 means it lapses today."""
    return (effective_expiry - today).days


def urgency_for(days: int) -> Urgency:
    for upper, bucket in _THRESHOLDS:
        if days <= upper:
            return bucket
    return Urgency.OK


def describe(effective_expiry: date, today: date) -> tuple[int, Urgency]:
    days = days_remaining(effective_expiry, today)
    return days, urgency_for(days)
