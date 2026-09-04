"""The home screen, in one request."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Query

from app.db.repositories import items as items_repo
from app.db.repositories import profiles as profiles_repo
from app.deps import CurrentUserDep, UserDbDep
from app.schemas.item import DashboardResponse, UrgencyCounts
from app.services.item_view import as_date, to_item_list
from app.services.priority import describe, today_for_user

router = APIRouter()


@router.get("", response_model=DashboardResponse, summary="Counts plus the urgent tail")
async def get_dashboard(
    user: CurrentUserDep,
    db: UserDbDep,
    expiring_limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> DashboardResponse:
    """One call instead of fetching every item and bucketing on the client.

    Counts come from a single query over active items rather than five COUNT
    round trips — the database is in Tokyo and a household pantry is small.
    """
    user_tz = profiles_repo.get_timezone(db, user.id)
    today = today_for_user(user_tz)

    rows = items_repo.active_items_for_dashboard(db, user.id)

    counts = UrgencyCounts(total_active=len(rows))
    for row in rows:
        _, urgency = describe(as_date(row["effective_expiry_date"]), today)
        setattr(counts, urgency.value, getattr(counts, urgency.value) + 1)

    # rows already arrive ordered soonest-first from the repository.
    return DashboardResponse(
        counts=counts,
        expiring_soon=to_item_list(rows[:expiring_limit], today),
        generated_at=datetime.now(timezone.utc),
        timezone=user_tz,
    )
