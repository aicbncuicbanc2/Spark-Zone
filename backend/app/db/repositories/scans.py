"""Query layer for scans."""

from __future__ import annotations

from typing import Any

from postgrest.exceptions import APIError

from app.core.errors import NotFoundError, UpstreamError
from supabase import Client

TABLE = "scans"


def create_scan(client: Client, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    row = {**payload, "user_id": user_id}
    try:
        result = client.table(TABLE).insert(row).execute()
    except APIError as exc:
        raise UpstreamError(
            "Could not record the scan.", details={"db": str(exc)[:300]}
        ) from exc

    if not result.data:
        raise UpstreamError("Could not record the scan.", code="SCAN_NOT_CREATED")
    return result.data[0]


def get_scan(client: Client, user_id: str, scan_id: str) -> dict[str, Any]:
    try:
        result = (
            client.table(TABLE).select("*").eq("id", scan_id).eq("user_id", user_id).execute()
        )
    except APIError as exc:
        raise UpstreamError("Could not load the scan.", details={"db": str(exc)[:300]}) from exc

    if not result.data:
        raise NotFoundError("Scan not found.", code="SCAN_NOT_FOUND")
    return result.data[0]


def update_scan(
    client: Client, user_id: str, scan_id: str, changes: dict[str, Any]
) -> dict[str, Any]:
    try:
        result = (
            client.table(TABLE)
            .update(changes)
            .eq("id", scan_id)
            .eq("user_id", user_id)
            .execute()
        )
    except APIError as exc:
        raise UpstreamError("Could not update the scan.", details={"db": str(exc)[:300]}) from exc

    if not result.data:
        raise NotFoundError("Scan not found.", code="SCAN_NOT_FOUND")
    return result.data[0]


def list_scans(
    client: Client, user_id: str, *, limit: int = 20, offset: int = 0
) -> tuple[list[dict[str, Any]], int]:
    try:
        result = (
            client.table(TABLE)
            .select("*", count="exact")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
    except APIError as exc:
        raise UpstreamError("Could not list scans.", details={"db": str(exc)[:300]}) from exc
    return result.data or [], result.count or 0


def delete_scan(client: Client, user_id: str, scan_id: str) -> None:
    try:
        result = (
            client.table(TABLE).delete().eq("id", scan_id).eq("user_id", user_id).execute()
        )
    except APIError as exc:
        raise UpstreamError("Could not delete the scan.", details={"db": str(exc)[:300]}) from exc

    if not result.data:
        raise NotFoundError("Scan not found.", code="SCAN_NOT_FOUND")
