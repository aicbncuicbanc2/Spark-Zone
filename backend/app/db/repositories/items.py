"""Query layer for pantry items.

Every function takes an RLS-scoped client, so Postgres is the thing actually
enforcing ownership. The explicit `user_id` filters here are defence in depth,
not the security boundary — if one were ever omitted, RLS would still hold.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from postgrest.exceptions import APIError

from app.core.errors import BadRequestError, ConflictError, NotFoundError
from app.schemas.item import ItemSort
from supabase import Client

TABLE = "items"

_SORT_COLUMNS: dict[ItemSort, tuple[str, bool]] = {
    # (column, descending)
    ItemSort.EXPIRY: ("effective_expiry_date", False),
    ItemSort.CREATED: ("created_at", True),
    ItemSort.NAME: ("name", False),
}


def _translate(exc: APIError) -> Exception:
    """Turn Postgres error codes into our error envelope.

    Without this the app sees an opaque 500 for things that are really the
    client's fault, like naming a category that does not exist.
    """
    code = getattr(exc, "code", None)
    message = getattr(exc, "message", str(exc))

    if code == "23503":  # foreign_key_violation
        return BadRequestError(
            "A referenced record does not exist (check category_id / product_id / scan_id).",
            code="FOREIGN_KEY_VIOLATION",
            details={"db_message": message},
        )
    if code == "23514":  # check_violation
        return BadRequestError(
            "The values supplied violate a database constraint.",
            code="CHECK_VIOLATION",
            details={"db_message": message},
        )
    if code == "23505":  # unique_violation
        return ConflictError("That record already exists.", details={"db_message": message})
    if code == "42501":  # insufficient_privilege - RLS
        return NotFoundError("Item not found.", code="ITEM_NOT_FOUND")
    return exc


def list_items(
    client: Client,
    user_id: str,
    *,
    status: str | None = "active",
    category_id: str | None = None,
    expiring_within_days: int | None = None,
    today: date | None = None,
    sort: ItemSort = ItemSort.EXPIRY,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    query = client.table(TABLE).select("*", count="exact").eq("user_id", user_id)

    if status:
        query = query.eq("status", status)
    if category_id:
        query = query.eq("category_id", category_id)
    if expiring_within_days is not None:
        # Callers pass the user's local date; UTC is only a safety net.
        anchor = today or datetime.now(timezone.utc).date()
        cutoff = anchor + timedelta(days=expiring_within_days)
        query = query.lte("effective_expiry_date", cutoff.isoformat())

    column, descending = _SORT_COLUMNS[sort]
    query = query.order(column, desc=descending).range(offset, offset + limit - 1)

    try:
        result = query.execute()
    except APIError as exc:
        raise _translate(exc) from exc

    return result.data or [], result.count or 0


def get_item(client: Client, user_id: str, item_id: str) -> dict[str, Any]:
    try:
        result = (
            client.table(TABLE).select("*").eq("id", item_id).eq("user_id", user_id).execute()
        )
    except APIError as exc:
        raise _translate(exc) from exc

    if not result.data:
        # RLS makes another user's item indistinguishable from a missing one,
        # which is exactly what we want to expose.
        raise NotFoundError("Item not found.", code="ITEM_NOT_FOUND")
    return result.data[0]


def create_item(client: Client, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    row = {**payload, "user_id": user_id}
    try:
        result = client.table(TABLE).insert(row).execute()
    except APIError as exc:
        raise _translate(exc) from exc

    if not result.data:
        raise BadRequestError("Item could not be created.", code="ITEM_NOT_CREATED")
    return result.data[0]


def update_item(
    client: Client, user_id: str, item_id: str, changes: dict[str, Any]
) -> dict[str, Any]:
    if not changes:
        return get_item(client, user_id, item_id)

    try:
        result = (
            client.table(TABLE)
            .update(changes)
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
        )
    except APIError as exc:
        raise _translate(exc) from exc

    if not result.data:
        raise NotFoundError("Item not found.", code="ITEM_NOT_FOUND")
    return result.data[0]


def delete_item(client: Client, user_id: str, item_id: str) -> None:
    try:
        result = (
            client.table(TABLE).delete().eq("id", item_id).eq("user_id", user_id).execute()
        )
    except APIError as exc:
        raise _translate(exc) from exc

    if not result.data:
        raise NotFoundError("Item not found.", code="ITEM_NOT_FOUND")


def active_items_for_dashboard(
    client: Client, user_id: str, *, limit: int = 500
) -> list[dict[str, Any]]:
    """All active items, soonest first.

    Bucketing happens in Python rather than as five COUNT queries: one round
    trip to Tokyo beats five, and a household pantry is small enough that the
    limit is a safety valve rather than a real constraint.
    """
    try:
        result = (
            client.table(TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("status", "active")
            .order("effective_expiry_date", desc=False)
            .limit(limit)
            .execute()
        )
    except APIError as exc:
        raise _translate(exc) from exc
    return result.data or []
