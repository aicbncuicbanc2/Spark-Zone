"""Query layer for reminders and devices.

The sweep runs as the service role, because it acts on behalf of every user at
once and RLS would otherwise hide their rows from it.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from postgrest.exceptions import APIError

from app.core.errors import UpstreamError
from app.db.client import service_client
from supabase import Client

logger = logging.getLogger(__name__)

REMINDERS = "reminders"
DEVICES = "devices"


# --- devices ------------------------------------------------------------------


def register_device(client: Client, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Idempotent on the token, so the app can call it on every launch."""
    row = {
        **payload,
        "user_id": user_id,
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
        "revoked_at": None,
    }
    try:
        result = client.table(DEVICES).upsert(row, on_conflict="fcm_token").execute()
    except APIError as exc:
        raise UpstreamError(
            "Could not register this device.", details={"db": str(exc)[:300]}
        ) from exc
    if not result.data:
        raise UpstreamError("Could not register this device.", code="DEVICE_NOT_REGISTERED")
    return result.data[0]


def list_devices(client: Client, user_id: str) -> list[dict[str, Any]]:
    try:
        result = (
            client.table(DEVICES)
            .select("*")
            .eq("user_id", user_id)
            .is_("revoked_at", "null")
            .execute()
        )
    except APIError as exc:
        raise UpstreamError("Could not list devices.", details={"db": str(exc)[:300]}) from exc
    return result.data or []


def revoke_device(client: Client, user_id: str, token: str) -> None:
    try:
        client.table(DEVICES).update(
            {"revoked_at": datetime.now(timezone.utc).isoformat()}
        ).eq("user_id", user_id).eq("fcm_token", token).execute()
    except APIError as exc:
        raise UpstreamError("Could not revoke device.", details={"db": str(exc)[:300]}) from exc


def revoke_token_everywhere(token: str) -> None:
    """Used by the sweep when Expo reports a token as dead."""
    try:
        service_client().table(DEVICES).update(
            {"revoked_at": datetime.now(timezone.utc).isoformat()}
        ).eq("fcm_token", token).execute()
    except Exception as exc:  # noqa: BLE001 - pruning is best-effort
        logger.warning("device_revoke_failed", extra={"reason": str(exc)[:200]})


# --- reminders ----------------------------------------------------------------


def replace_for_item(user_id: str, item_id: str, planned: list[dict[str, Any]]) -> None:
    """Rewrite an item's pending reminders.

    Called whenever an item's effective expiry changes. Only *pending* rows are
    cleared — already-sent reminders stay as history, and the UNIQUE
    (item_id, kind) constraint stops duplicates either way.
    """
    db = service_client()
    try:
        db.table(REMINDERS).delete().eq("item_id", item_id).eq("status", "pending").execute()
        if planned:
            db.table(REMINDERS).upsert(
                [{**row, "user_id": user_id, "item_id": item_id} for row in planned],
                on_conflict="item_id,kind",
            ).execute()
    except Exception as exc:  # noqa: BLE001 - scheduling must not fail the write
        logger.warning(
            "reminder_scheduling_failed",
            extra={"item_id": item_id, "reason": str(exc)[:200]},
        )


def cancel_for_item(item_id: str) -> None:
    """Stop pending reminders once an item is consumed, discarded or deleted."""
    try:
        service_client().table(REMINDERS).update({"status": "cancelled"}).eq(
            "item_id", item_id
        ).eq("status", "pending").execute()
    except Exception as exc:  # noqa: BLE001 - cancelling is best-effort
        logger.warning(
            "reminder_cancel_failed", extra={"item_id": item_id, "reason": str(exc)[:200]}
        )


def list_for_user(
    client: Client, user_id: str, *, limit: int = 50
) -> list[dict[str, Any]]:
    """Upcoming schedule, so the app can say "we'll remind you on Friday"."""
    try:
        result = (
            client.table(REMINDERS)
            .select("*, items(name, brand, effective_expiry_date, status)")
            .eq("user_id", user_id)
            .eq("status", "pending")
            .order("scheduled_for")
            .limit(limit)
            .execute()
        )
    except APIError as exc:
        raise UpstreamError("Could not list reminders.", details={"db": str(exc)[:300]}) from exc
    return result.data or []


def due_now(*, limit: int = 200) -> list[dict[str, Any]]:
    """Pending reminders whose time has come, across every user.

    Service role: the sweep acts for all users, so RLS must not apply.
    """
    now = datetime.now(timezone.utc).isoformat()
    try:
        result = (
            service_client()
            .table(REMINDERS)
            .select("*, items(id, name, brand, status, effective_expiry_date, category_id)")
            .eq("status", "pending")
            .lte("scheduled_for", now)
            .order("scheduled_for")
            .limit(limit)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001 - an empty sweep beats a crashed one
        logger.warning("reminder_due_query_failed", extra={"reason": str(exc)[:200]})
        return []
    return result.data or []


def mark_sent(reminder_id: str, receipt_id: str | None) -> None:
    _update(reminder_id, {
        "status": "sent",
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "fcm_message_id": receipt_id,
    })


def mark_failed(reminder_id: str, error: str, attempts: int) -> None:
    # Three strikes, then stop retrying rather than looping forever.
    status = "failed" if attempts >= 3 else "pending"
    _update(reminder_id, {
        "status": status,
        "attempt_count": attempts,
        "last_error": error[:500],
    })


def mark_suppressed(reminder_id: str, reason: str) -> None:
    """No longer worth sending — the item was resolved, or push is off."""
    _update(reminder_id, {"status": "suppressed", "last_error": reason[:500]})


def _update(reminder_id: str, changes: dict[str, Any]) -> None:
    try:
        service_client().table(REMINDERS).update(changes).eq("id", reminder_id).execute()
    except Exception as exc:  # noqa: BLE001 - bookkeeping must not break the sweep
        logger.warning(
            "reminder_update_failed",
            extra={"reminder_id": reminder_id, "reason": str(exc)[:200]},
        )


def active_tokens_by_user(user_ids: list[str]) -> dict[str, list[str]]:
    if not user_ids:
        return {}
    try:
        result = (
            service_client()
            .table(DEVICES)
            .select("user_id, fcm_token")
            .in_("user_id", list(set(user_ids)))
            .is_("revoked_at", "null")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("device_token_query_failed", extra={"reason": str(exc)[:200]})
        return {}

    grouped: dict[str, list[str]] = {}
    for row in result.data or []:
        grouped.setdefault(row["user_id"], []).append(row["fcm_token"])
    return grouped


def push_preferences(user_ids: list[str]) -> dict[str, bool]:
    if not user_ids:
        return {}
    try:
        result = (
            service_client()
            .table("profiles")
            .select("id, push_enabled")
            .in_("id", list(set(user_ids)))
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("push_preference_query_failed", extra={"reason": str(exc)[:200]})
        return {}
    return {row["id"]: bool(row.get("push_enabled", True)) for row in result.data or []}
