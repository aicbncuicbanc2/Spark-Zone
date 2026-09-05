"""The user's upcoming reminder schedule."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.db.repositories import reminders as reminders_repo
from app.deps import CurrentUserDep, UserDbDep

router = APIRouter()


class ReminderOut(BaseModel):
    id: str
    item_id: str
    item_name: str | None = None
    kind: str
    scheduled_for: datetime
    status: str


@router.get("", response_model=list[ReminderOut], summary="My upcoming reminders")
async def list_reminders(
    user: CurrentUserDep,
    db: UserDbDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[ReminderOut]:
    """Soonest first.

    Lets the app say "we'll remind you on Friday" rather than leaving the user
    to trust that something will happen.
    """
    rows = reminders_repo.list_for_user(db, user.id, limit=limit)
    return [
        ReminderOut(
            id=row["id"],
            item_id=row["item_id"],
            item_name=(row.get("items") or {}).get("name"),
            kind=row["kind"],
            scheduled_for=row["scheduled_for"],
            status=row["status"],
        )
        for row in rows
    ]
