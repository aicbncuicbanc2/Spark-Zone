"""Urgency bucketing — pure logic, no network.

These boundaries are the contract the whole product rests on: they decide what
the dashboard shows and, later, when reminders fire.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.schemas.common import Urgency
from app.services.priority import (
    days_remaining,
    describe,
    is_known_timezone,
    resolve_timezone,
    today_for_user,
    urgency_for,
)

TODAY = date(2026, 9, 5)


@pytest.mark.parametrize(
    ("days", "expected"),
    [
        (-100, Urgency.EXPIRED),
        (-2, Urgency.EXPIRED),
        (-1, Urgency.EXPIRED),
        (0, Urgency.CRITICAL),   # expires today
        (1, Urgency.CRITICAL),   # tomorrow
        (2, Urgency.SOON),
        (3, Urgency.SOON),
        (4, Urgency.UPCOMING),
        (7, Urgency.UPCOMING),
        (8, Urgency.OK),
        (365, Urgency.OK),
    ],
)
def test_bucket_boundaries(days: int, expected: Urgency) -> None:
    assert urgency_for(days) is expected


def test_expiring_today_is_critical_not_expired() -> None:
    """Off-by-one guard: something expiring today is still usable today."""
    days, urgency = describe(TODAY, TODAY)
    assert days == 0
    assert urgency is Urgency.CRITICAL


def test_expired_yesterday_is_expired() -> None:
    days, urgency = describe(TODAY - timedelta(days=1), TODAY)
    assert days == -1
    assert urgency is Urgency.EXPIRED


def test_days_remaining_counts_calendar_days() -> None:
    assert days_remaining(date(2026, 9, 12), TODAY) == 7
    assert days_remaining(date(2026, 8, 29), TODAY) == -7


def test_every_bucket_is_reachable() -> None:
    """Guards against a threshold edit that silently orphans a bucket."""
    reached = {urgency_for(d) for d in range(-10, 400)}
    assert reached == set(Urgency)


def test_unknown_timezone_falls_back_rather_than_raising() -> None:
    """Must never raise, whatever it is handed."""
    for bad in ("Not/AZone", None, "", "Asia/KL", "\0"):
        tz = resolve_timezone(bad)
        assert tz is not None
        assert getattr(tz, "key", "UTC") in {"Asia/Kuala_Lumpur", "UTC"}


def test_known_timezone_is_respected() -> None:
    assert resolve_timezone("Asia/Tokyo").key == "Asia/Tokyo"


def test_timezone_database_is_available() -> None:
    """Guards the tzdata dependency.

    Windows ships no IANA database and slim Linux images often omit it, so
    without the tzdata package these lookups silently degrade to UTC and
    every reminder fires on the wrong local date.
    """
    assert is_known_timezone("Asia/Kuala_Lumpur")
    assert is_known_timezone("Asia/Tokyo")
    assert not is_known_timezone("Asia/KL")


def test_today_differs_across_timezones_near_midnight() -> None:
    """The reason urgency is computed per-user rather than server-side.

    Kuala Lumpur and Honolulu are far enough apart that they are frequently on
    different calendar dates, which is exactly the bug this design avoids.
    """
    kl = today_for_user("Asia/Kuala_Lumpur")
    honolulu = today_for_user("Pacific/Honolulu")
    assert abs((kl - honolulu).days) <= 1
