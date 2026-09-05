"""Deciding when to remind someone.

Every reminder is scheduled against the user's *local* calendar and clock. A
person in Kuala Lumpur must not be told their milk expires tomorrow because a
server in Tokyo has already rolled over, and must not be woken at 3 AM because
the scheduler works in UTC.

Reminders hang off `effective_expiry_date`, so an opened cosmetic past its
period-after-opening is reminded on time even though the printed date is years
away.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from app.services.priority import resolve_timezone

#: Local hour we aim to send at. Late enough not to wake anyone, early enough
#: that "use it today" is still actionable.
PREFERRED_HOUR = 9

#: Lead time in days -> reminder kind. Anything else the user configures is
#: mapped to the nearest supported kind.
KIND_BY_LEAD: dict[int, str] = {7: "advance_7d", 3: "advance_3d", 1: "advance_1d", 0: "day_of"}

EXPIRED_KIND = "expired"

#: How long after expiry to send the "it has lapsed, here is how to dispose of
#: it" nudge.
EXPIRED_DELAY_DAYS = 1


@dataclass(frozen=True)
class PlannedReminder:
    kind: str
    scheduled_for: datetime  # timezone-aware, UTC
    local_date: date


def _in_quiet_hours(moment: time, start: time, end: time) -> bool:
    """Quiet hours usually wrap midnight, e.g. 22:00 to 08:00."""
    if start == end:
        return False
    if start < end:
        return start <= moment < end
    return moment >= start or moment < end


def _send_at(day: date, timezone_name: str, quiet_start: time, quiet_end: time) -> datetime:
    """The UTC instant to fire on a given local day."""
    zone = resolve_timezone(timezone_name)
    hour = time(PREFERRED_HOUR, 0)

    # If the preferred hour falls inside the quiet window, wait until it ends.
    if _in_quiet_hours(hour, quiet_start, quiet_end):
        hour = quiet_end

    local = datetime.combine(day, hour, tzinfo=zone)
    return local.astimezone(timezone.utc)


def plan(
    *,
    effective_expiry: date,
    timezone_name: str,
    lead_days: list[int],
    quiet_start: time,
    quiet_end: time,
    now: datetime | None = None,
) -> list[PlannedReminder]:
    """Reminders worth creating for one item.

    Anything whose send time has already passed is skipped rather than fired
    late — a notification saying "expires in 7 days" about something that
    expired yesterday is worse than silence.
    """
    now = now or datetime.now(timezone.utc)
    planned: list[PlannedReminder] = []
    seen: set[str] = set()

    for lead in sorted({max(0, int(d)) for d in lead_days}, reverse=True):
        kind = KIND_BY_LEAD.get(lead)
        if kind is None:
            continue
        target = effective_expiry - timedelta(days=lead)
        when = _send_at(target, timezone_name, quiet_start, quiet_end)
        if when <= now or kind in seen:
            continue
        seen.add(kind)
        planned.append(PlannedReminder(kind=kind, scheduled_for=when, local_date=target))

    # And one after it lapses, which is where disposal guidance matters.
    expired_day = effective_expiry + timedelta(days=EXPIRED_DELAY_DAYS)
    when = _send_at(expired_day, timezone_name, quiet_start, quiet_end)
    if when > now:
        planned.append(
            PlannedReminder(kind=EXPIRED_KIND, scheduled_for=when, local_date=expired_day)
        )

    return planned


def notification_text(item: dict, kind: str, days_remaining: int) -> tuple[str, str]:
    """Title and body for one reminder.

    Specific rather than generic: the name and the timeframe, so the
    notification is actionable from the lock screen without opening the app.
    """
    name = item.get("name") or "An item"
    brand = item.get("brand")
    label = f"{brand} {name}" if brand and brand.lower() not in name.lower() else name

    if kind == EXPIRED_KIND:
        return (
            "Expired — check before using",
            f"{label} has passed its date. Tap for safe disposal advice.",
        )
    if kind == "day_of":
        return ("Expires today", f"{label} — use it today or it goes to waste.")
    if kind == "advance_1d":
        return ("Expires tomorrow", f"{label} — last chance to use it.")

    plural = "s" if days_remaining != 1 else ""
    return (
        f"Expiring in {days_remaining} day{plural}",
        f"{label} — plan to use it before then.",
    )
