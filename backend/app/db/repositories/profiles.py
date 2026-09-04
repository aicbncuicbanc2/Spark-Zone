"""Query layer for user profiles / preferences."""

from __future__ import annotations

from typing import Any

from postgrest.exceptions import APIError

from app.core.errors import NotFoundError, UpstreamError
from supabase import Client

TABLE = "profiles"


def get_profile(client: Client, user_id: str) -> dict[str, Any]:
    try:
        result = client.table(TABLE).select("*").eq("id", user_id).execute()
    except APIError as exc:
        raise UpstreamError("Could not load your profile.", details={"db": str(exc)}) from exc

    if not result.data:
        # handle_new_user() creates this on signup, so an absence means either a
        # user created before the trigger existed, or the trigger failed.
        raise NotFoundError(
            "Profile not found. It is normally created automatically at signup.",
            code="PROFILE_NOT_FOUND",
        )
    return result.data[0]


def get_timezone(client: Client, user_id: str) -> str:
    """Cheap single-column read — used on every list/dashboard request."""
    try:
        result = client.table(TABLE).select("timezone").eq("id", user_id).execute()
    except APIError:
        return "Asia/Kuala_Lumpur"
    if not result.data:
        return "Asia/Kuala_Lumpur"
    return result.data[0].get("timezone") or "Asia/Kuala_Lumpur"


def update_profile(client: Client, user_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    if not changes:
        return get_profile(client, user_id)

    try:
        result = client.table(TABLE).update(changes).eq("id", user_id).execute()
    except APIError as exc:
        raise UpstreamError("Could not save your preferences.", details={"db": str(exc)}) from exc

    if not result.data:
        raise NotFoundError("Profile not found.", code="PROFILE_NOT_FOUND")
    return result.data[0]
