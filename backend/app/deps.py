"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, Request

from app.config import Settings, get_settings
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.security import CurrentUser, user_from_token
from app.db.client import user_client
from supabase import Client


def settings_dep() -> Settings:
    return get_settings()


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    if not authorization:
        raise UnauthorizedError("Authorization header is missing.", code="AUTH_MISSING")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise UnauthorizedError(
            "Authorization header must be 'Bearer <token>'.", code="AUTH_SCHEME"
        )

    return user_from_token(token.strip())


async def get_user_db(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> Client:
    """An RLS-scoped Supabase client for the calling user."""
    return user_client(current_user.access_token)


async def require_internal_caller(
    request: Request,
    x_internal_secret: Annotated[str | None, Header()] = None,
) -> None:
    """Guards /v1/internal/* routes.

    In production these are called by Cloud Scheduler with an OIDC token, which
    Cloud Run verifies before the request ever reaches us. The shared secret is a
    second belt for local testing and for any non-GCP caller.
    """
    settings = get_settings()

    # Cloud Run puts the verified OIDC identity here after it validates the token.
    if request.headers.get("x-goog-authenticated-user-email"):
        return

    if not settings.internal_sweep_secret:
        raise ForbiddenError(
            "INTERNAL_SWEEP_SECRET is not configured; refusing internal call.",
            code="INTERNAL_NOT_CONFIGURED",
        )
    if x_internal_secret != settings.internal_sweep_secret:
        raise ForbiddenError("Invalid internal secret.", code="INTERNAL_FORBIDDEN")


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
UserDbDep = Annotated[Client, Depends(get_user_db)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
