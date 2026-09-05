"""Impact statistics.

The numbers that turn a pantry tracker into an SDG 12 story: how much was used
in time versus thrown away. Cheap to compute and the most quotable output the
backend produces.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from app.db.repositories import items as items_repo
from app.db.repositories import profiles as profiles_repo
from app.deps import CurrentUserDep, UserDbDep
from app.schemas.common import Urgency
from app.services.item_view import as_date
from app.services.priority import describe, today_for_user

router = APIRouter()


class OcrStats(BaseModel):
    """How often OCR was trusted without correction.

    A proxy for real-world accuracy: `corrected_by_user` counts items whose
    date_source is 'user', meaning someone edited what OCR produced.
    """

    accepted_from_ocr: int = 0
    corrected_by_user: int = 0
    entered_manually: int = 0
    acceptance_rate: float | None = None


class StatsOut(BaseModel):
    total_tracked: int
    active: int
    used_in_time: int
    thrown_away: int
    #: used_in_time / (used_in_time + thrown_away). None until something resolves.
    save_rate: float | None = None

    expiring_this_week: int
    expired_and_unresolved: int

    by_category: dict[str, int]
    ocr: OcrStats
    generated_at: datetime


@router.get("", response_model=StatsOut, summary="Waste-avoided and OCR statistics")
async def get_stats(user: CurrentUserDep, db: UserDbDep) -> StatsOut:
    """One pass over the user's items rather than a query per number.

    A household pantry is small, and the database is a round trip away in Tokyo;
    eight COUNT queries would cost far more than fetching the rows once.
    """
    today = today_for_user(profiles_repo.get_timezone(db, user.id))

    rows: list[dict] = []
    offset = 0
    while True:
        page, total = items_repo.list_items(
            db, user.id, status=None, limit=200, offset=offset
        )
        rows.extend(page)
        offset += len(page)
        if not page or offset >= total:
            break

    used = sum(1 for r in rows if r["status"] == "consumed")
    binned = sum(1 for r in rows if r["status"] == "discarded")
    active_rows = [r for r in rows if r["status"] == "active"]

    resolved = used + binned
    save_rate = round(used / resolved, 3) if resolved else None

    expiring_week = 0
    expired_unresolved = 0
    for row in active_rows:
        days, urgency = describe(as_date(row["effective_expiry_date"]), today)
        if urgency is Urgency.EXPIRED:
            expired_unresolved += 1
        elif days <= 7:
            expiring_week += 1

    by_category: dict[str, int] = {}
    for row in rows:
        key = row.get("category_id") or "uncategorised"
        by_category[key] = by_category.get(key, 0) + 1

    accepted = sum(1 for r in rows if r.get("date_source") == "ocr")
    corrected = sum(1 for r in rows if r.get("date_source") == "user" and r.get("scan_id"))
    manual = sum(1 for r in rows if r.get("date_source") == "user" and not r.get("scan_id"))
    scanned = accepted + corrected

    return StatsOut(
        total_tracked=len(rows),
        active=len(active_rows),
        used_in_time=used,
        thrown_away=binned,
        save_rate=save_rate,
        expiring_this_week=expiring_week,
        expired_and_unresolved=expired_unresolved,
        by_category=dict(sorted(by_category.items(), key=lambda kv: -kv[1])),
        ocr=OcrStats(
            accepted_from_ocr=accepted,
            corrected_by_user=corrected,
            entered_manually=manual,
            acceptance_rate=round(accepted / scanned, 3) if scanned else None,
        ),
        generated_at=datetime.now(timezone.utc),
    )
