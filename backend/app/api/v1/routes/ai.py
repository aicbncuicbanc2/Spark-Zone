"""AI-assisted features — short, advisory suggestions grounded in an item's
own data. Never used for anything safety-critical; see services/guidance.py
for why disposal advice stays curated instead of model-generated.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.db.repositories import items as items_repo
from app.db.repositories import profiles as profiles_repo
from app.deps import CurrentUserDep, UserDbDep
from app.services import suggestions as suggestions_service
from app.services.item_view import to_item_out
from app.services.priority import today_for_user

router = APIRouter()


class SuggestionsOut(BaseModel):
    suggestions: list[str]


def _category_label(db, category_id: str | None) -> str | None:
    if not category_id:
        return None
    result = db.table("categories").select("label_en").eq("id", category_id).maybe_single().execute()
    return (result.data or {}).get("label_en")


@router.get(
    "/items/{item_id}/suggestions",
    response_model=SuggestionsOut,
    summary='"What should I use this for?" suggestions',
)
async def item_suggestions(item_id: str, user: CurrentUserDep, db: UserDbDep) -> SuggestionsOut:
    """2-3 short usage ideas for one item, from its name/category/days-left.

    Empty list means "not available right now" (no key configured, a
    network hiccup, an unparsable response) — never an error the frontend
    has to handle specially; it just hides the suggestions.
    """
    row = items_repo.get_item(db, user.id, item_id)
    today = today_for_user(profiles_repo.get_timezone(db, user.id))
    item = to_item_out(row, today)

    suggestions = await suggestions_service.get_usage_suggestions(
        name=item.name,
        category=_category_label(db, item.category_id),
        days_remaining=item.days_remaining,
    )
    return SuggestionsOut(suggestions=suggestions)
