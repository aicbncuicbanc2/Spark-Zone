"""Shared FastAPI dependencies."""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header

from app.config import Settings, get_settings
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.security import CurrentUser, user_from_token
from app.db.client import user_client
from app.services import rate_limit
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
    x_internal_secret: Annotated[str | None, Header()] = None,
) -> None:
    """Guards /v1/internal/* routes.

    Cloud Scheduler is configured to send X-Internal-Secret directly (see the
    job's httpTarget.headers) - this is the only real check. An earlier
    version of this function also trusted a request carrying an
    "x-goog-authenticated-user-email" header, reasoning that Cloud Run
    attaches it after verifying an OIDC token. That reasoning only holds for
    a service that requires authentication at the Cloud Run/IAM layer; this
    one is deployed with `--allow-unauthenticated` (roles/run.invoker granted
    to allUsers), so every request reaches this code directly from the
    internet with no Google-verified identity in front of it - meaning that
    header was never actually verified by anything and any external caller
    could set it themselves to skip the secret check entirely. Removed
    rather than fixed differently, since Cloud Scheduler doesn't rely on it.
    """
    settings = get_settings()

    if not settings.internal_sweep_secret:
        raise ForbiddenError(
            "INTERNAL_SWEEP_SECRET is not configured; refusing internal call.",
            code="INTERNAL_NOT_CONFIGURED",
        )
    if not x_internal_secret or not hmac.compare_digest(
        x_internal_secret, settings.internal_sweep_secret
    ):
        raise ForbiddenError("Invalid internal secret.", code="INTERNAL_FORBIDDEN")


async def enforce_vision_rate_limit(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> None:
    """Guards every endpoint that calls Google Vision (a billed API):
    POST /v1/scans, its retry, and /v1/products/identify-photo. Keyed by
    user id, not IP - this is an authenticated API, and IP-keying would
    unfairly throttle multiple real users behind the same NAT/campus wifi.
    """
    rate_limit.enforce(f"vision:{current_user.id}")


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
UserDbDep = Annotated[Client, Depends(get_user_db)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
VisionRateLimitDep = Annotated[None, Depends(enforce_vision_rate_limit)]
