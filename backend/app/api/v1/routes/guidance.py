"""Usage and disposal guidance."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.db.repositories import items as items_repo
from app.db.repositories import profiles as profiles_repo
from app.deps import CurrentUserDep, UserDbDep
from app.services import guidance as guidance_service
from app.services.item_view import as_date
from app.services.priority import today_for_user

router = APIRouter()


class GuidanceOut(BaseModel):
    category_id: str | None = None
    condition: str
    locale: str
    title: str
    body: str
    steps: list[str]
    #: info | caution | hazard. Render `hazard` prominently — it covers
    #: medicine and pressurised aerosols.
    severity: str
    source_url: str | None = None
    #: True when no advice existed for this category and a generic entry was used.
    is_fallback: bool = False


def _to_out(g: guidance_service.Guidance) -> GuidanceOut:
    return GuidanceOut(
        category_id=g.category_id,
        condition=g.condition,
        locale=g.locale,
        title=g.title,
        body=g.body,
        steps=g.steps,
        severity=g.severity,
        source_url=g.source_url,
        is_fallback=g.is_fallback,
    )


@router.get(
    "/items/{item_id}",
    response_model=GuidanceOut,
    summary="Advice for one pantry item",
)
async def guidance_for_item(
    item_id: str,
    user: CurrentUserDep,
    db: UserDbDep,
    locale: Annotated[str | None, Query(max_length=10)] = None,
) -> GuidanceOut:
    """Usage advice while in date, disposal instructions once expired.

    The switch is made against `effective_expiry_date`, so an opened cosmetic
    whose period-after-opening has lapsed gets disposal advice even though the
    printed date is years away.
    """
    item = items_repo.get_item(db, user.id, item_id)
    profile_locale = locale
    if profile_locale is None:
        try:
            profile_locale = profiles_repo.get_profile(db, user.id).get("locale")
        except Exception:  # noqa: BLE001 - locale is a preference, not a blocker
            profile_locale = guidance_service.DEFAULT_LOCALE

    today = today_for_user(profiles_repo.get_timezone(db, user.id))
    condition = guidance_service.condition_for(
        as_date(item["effective_expiry_date"]), today
    )

    return _to_out(
        guidance_service.lookup(
            db,
            category_id=item.get("category_id"),
            condition=condition,
            locale=profile_locale or guidance_service.DEFAULT_LOCALE,
        )
    )


@router.get("", response_model=GuidanceOut, summary="Advice by category")
async def guidance_by_category(
    user: CurrentUserDep,
    db: UserDbDep,
    category: Annotated[str, Query(max_length=50)],
    expired: Annotated[bool, Query(description="Advice for an expired item")] = False,
    locale: Annotated[str, Query(max_length=10)] = guidance_service.DEFAULT_LOCALE,
) -> GuidanceOut:
    """Look up advice without an item — useful before one has been saved."""
    condition = (
        guidance_service.AFTER_EXPIRY if expired else guidance_service.BEFORE_EXPIRY
    )
    return _to_out(
        guidance_service.lookup(
            db, category_id=category, condition=condition, locale=locale
        )
    )
