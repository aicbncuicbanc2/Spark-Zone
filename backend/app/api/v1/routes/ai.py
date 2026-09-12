"""AI-assisted features — short, advisory suggestions grounded in an item's
own data. Never used for anything safety-critical; see services/guidance.py
for why disposal advice stays curated instead of model-generated.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.errors import UpstreamError
from app.db.repositories import items as items_repo
from app.db.repositories import profiles as profiles_repo
from app.deps import CurrentUserDep, UserDbDep
from app.services import ask as ask_service
from app.services import suggestions as suggestions_service
from app.services.gemini_client import GeminiUnavailable
from app.services.item_view import to_item_list, to_item_out
from app.services.priority import today_for_user

router = APIRouter()


class SuggestionsOut(BaseModel):
    suggestions: list[str]


def _category_label(db, category_id: str | None) -> str | None:
    if not category_id:
        return None
    result = db.table("categories").select("label_en").eq("id", category_id).maybe_single().execute()
    return (result.data or {}).get("label_en")


def _category_labels(db) -> dict[str, str]:
    result = db.table("categories").select("id, label_en").execute()
    return {row["id"]: row["label_en"] for row in (result.data or [])}


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


class AskMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: Annotated[str, Field(max_length=2000)]


class AskRequest(BaseModel):
    question: Annotated[str, Field(min_length=1, max_length=1000)]
    #: Prior turns, oldest first — lets the chat feel continuous even though
    #: each call is otherwise stateless and rebuilds pantry context fresh.
    history: Annotated[list[AskMessage], Field(default_factory=list, max_length=20)]


class AskOut(BaseModel):
    answer: str


@router.post("/ask", response_model=AskOut, summary='"Ask Thyme" — free-text Q&A over the pantry')
async def ask_thyme(payload: AskRequest, user: CurrentUserDep, db: UserDbDep) -> AskOut:
    """Feature C. Grounded in the user's own current pantry (and, for
    urgent/expired items, the same curated guidance /v1/guidance uses) —
    never a separate fact source from A/B, just a conversational surface
    over them.

    Unlike /suggestions, a Gemini failure here is a real error (503
    AI_UNAVAILABLE), not a silent empty result — a blank chat answer to a
    direct question would look broken.
    """
    today = today_for_user(profiles_repo.get_timezone(db, user.id))
    rows, _total = items_repo.list_items(db, user.id, status="active", today=today, limit=100)
    items = to_item_list(rows, today)

    pantry_context = ask_service.build_pantry_context(items, _category_labels(db))
    guidance_context = ask_service.build_guidance_context(db, items, today)
    history = [ask_service.ChatTurn(role=m.role, text=m.text) for m in payload.history]

    try:
        answer = await ask_service.ask(
            question=payload.question,
            history=history,
            pantry_context=pantry_context,
            guidance_context=guidance_context,
        )
    except GeminiUnavailable as exc:
        raise UpstreamError(
            "Ask Thyme is unavailable right now — try again in a moment.", code="AI_UNAVAILABLE"
        ) from exc

    return AskOut(answer=answer)
