"""Pantry item CRUD."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.db.repositories import items as items_repo
from app.db.repositories import profiles as profiles_repo
from app.deps import CurrentUserDep, UserDbDep
from app.schemas.common import Page
from app.schemas.item import (
    ItemCreate,
    ItemListResponse,
    ItemOut,
    ItemSort,
    ItemStatus,
    ItemUpdate,
)
from app.services.item_view import to_item_list, to_item_out
from app.services.priority import today_for_user

router = APIRouter()


@router.get("", response_model=ItemListResponse, summary="List pantry items")
async def list_items(
    user: CurrentUserDep,
    db: UserDbDep,
    status_filter: Annotated[
        ItemStatus | None,
        Query(alias="status", description="Defaults to active; pass 'all' via omitting"),
    ] = ItemStatus.ACTIVE,
    category: Annotated[str | None, Query(max_length=50)] = None,
    expiring_within_days: Annotated[int | None, Query(ge=0, le=3650)] = None,
    sort: ItemSort = ItemSort.EXPIRY,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ItemListResponse:
    today = today_for_user(profiles_repo.get_timezone(db, user.id))

    rows, total = items_repo.list_items(
        db,
        user.id,
        status=status_filter.value if status_filter else None,
        category_id=category,
        expiring_within_days=expiring_within_days,
        today=today,
        sort=sort,
        limit=limit,
        offset=offset,
    )

    return ItemListResponse(
        items=to_item_list(rows, today),
        page=Page(total=total, limit=limit, offset=offset),
    )


@router.post(
    "",
    response_model=ItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create an item",
)
async def create_item(payload: ItemCreate, user: CurrentUserDep, db: UserDbDep) -> ItemOut:
    """Create from a scan, from a corrected scan, or fully manually.

    Send date_source='user' whenever the person edited what OCR produced — it is
    how we measure real-world OCR accuracy.
    """
    row = items_repo.create_item(db, user.id, payload.model_dump(mode="json"))
    today = today_for_user(profiles_repo.get_timezone(db, user.id))
    return to_item_out(row, today)


@router.get("/{item_id}", response_model=ItemOut, summary="Get one item")
async def get_item(item_id: str, user: CurrentUserDep, db: UserDbDep) -> ItemOut:
    row = items_repo.get_item(db, user.id, item_id)
    today = today_for_user(profiles_repo.get_timezone(db, user.id))
    return to_item_out(row, today)


@router.patch("/{item_id}", response_model=ItemOut, summary="Update an item")
async def update_item(
    item_id: str, payload: ItemUpdate, user: CurrentUserDep, db: UserDbDep
) -> ItemOut:
    """Correct the expiry date, record that a product was opened, rename it.

    exclude_unset matters here: it is the only way to tell "set opened_at to
    null" apart from "did not mention opened_at".
    """
    changes = payload.model_dump(mode="json", exclude_unset=True)

    # Setting a terminal status through PATCH should stamp resolved_at too,
    # so the field means the same thing however the item got there.
    if changes.get("status") in {ItemStatus.CONSUMED.value, ItemStatus.DISCARDED.value}:
        changes.setdefault("resolved_at", datetime.now(timezone.utc).isoformat())
    elif changes.get("status") == ItemStatus.ACTIVE.value:
        changes.setdefault("resolved_at", None)

    row = items_repo.update_item(db, user.id, item_id, changes)
    today = today_for_user(profiles_repo.get_timezone(db, user.id))
    return to_item_out(row, today)


@router.delete(
    "/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an item permanently",
)
async def delete_item(item_id: str, user: CurrentUserDep, db: UserDbDep) -> Response:
    """Hard delete. Prefer /consume or /discard — those keep the item for stats."""
    items_repo.delete_item(db, user.id, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _resolve(item_id: str, user_id: str, db, new_status: ItemStatus) -> ItemOut:
    row = items_repo.update_item(
        db,
        user_id,
        item_id,
        {
            "status": new_status.value,
            "resolved_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return to_item_out(row, today_for_user(profiles_repo.get_timezone(db, user_id)))


@router.post("/{item_id}/consume", response_model=ItemOut, summary="Mark as used up")
async def consume_item(item_id: str, user: CurrentUserDep, db: UserDbDep) -> ItemOut:
    """The good outcome — this is what /v1/stats will count as waste avoided."""
    return await _resolve(item_id, user.id, db, ItemStatus.CONSUMED)


@router.post("/{item_id}/discard", response_model=ItemOut, summary="Mark as thrown away")
async def discard_item(item_id: str, user: CurrentUserDep, db: UserDbDep) -> ItemOut:
    return await _resolve(item_id, user.id, db, ItemStatus.DISCARDED)
