"""Supabase client construction.

Two clients, and the distinction matters for security:

  * `user_client(token)` carries the caller's JWT, so every query runs under
    Row Level Security. This is the default for anything serving a request.
  * `service_client()` uses the service-role key and BYPASSES RLS entirely.
    Reserve it for the reminder sweep worker and seed scripts — never reach for
    it inside a user-facing route just to make a query easier.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import get_settings
from app.core.errors import ServiceUnavailableError, UnauthorizedError
from supabase import Client, create_client


@lru_cache
def service_client() -> Client:
    settings = get_settings()
    if not (settings.supabase_url and settings.supabase_service_role_key):
        raise ServiceUnavailableError(
            "Supabase service credentials are not configured.",
            code="SUPABASE_NOT_CONFIGURED",
        )
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def user_client(access_token: str) -> Client:
    settings = get_settings()
    if not (settings.supabase_url and settings.supabase_anon_key):
        raise ServiceUnavailableError(
            "Supabase credentials are not configured.",
            code="SUPABASE_NOT_CONFIGURED",
        )

    # postgrest-py raises a bare ValueError on an empty token, which would
    # surface as a 500. get_current_user already rejects empty credentials, so
    # this is belt-and-braces - but it keeps the failure inside our error
    # envelope if a future caller reaches here directly.
    if not access_token or not access_token.strip():
        raise UnauthorizedError("No access token supplied.", code="AUTH_MISSING")

    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    # Attach the caller's JWT so PostgREST evaluates auth.uid() as this user.
    client.postgrest.auth(access_token)
    return client
