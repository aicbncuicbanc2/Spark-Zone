"""Query layer for the shared product cache.

`products` is not per-user. The second person to scan the same bottle gets an
instant hit and we spend one fewer call on Open Food Facts, whose lookups take
roughly a second.

Writes go through the service-role client because the table is read-only to
signed-in users under RLS — a cache entry is reference data, not user data.
"""

from __future__ import annotations

from typing import Any

from postgrest.exceptions import APIError

from app.db.client import service_client
from supabase import Client

TABLE = "products"


def get_by_barcode(client: Client, barcode: str) -> dict[str, Any] | None:
    if not barcode:
        return None
    try:
        result = client.table(TABLE).select("*").eq("barcode", barcode).limit(1).execute()
    except APIError:
        return None
    return result.data[0] if result.data else None


def upsert(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Cache a looked-up product. Never raises — caching is best-effort."""
    barcode = payload.get("barcode")
    if not barcode:
        return None

    try:
        result = (
            service_client()
            .table(TABLE)
            .upsert(payload, on_conflict="barcode")
            .execute()
        )
    except Exception:  # noqa: BLE001 - a cache miss is not a failure
        return None
    return result.data[0] if result.data else None
