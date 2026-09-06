"""Supabase client construction.

Two clients, and the distinction matters for security:

  * `user_client(token)` carries the caller's JWT, so every query runs under
    Row Level Security. This is the default for anything serving a request.
  * `service_client()` uses the service-role key and BYPASSES RLS entirely.
    Reserve it for the reminder sweep worker and seed scripts — never reach for
    it inside a user-facing route just to make a query easier.

Both share one underlying HTTP connection pool (`_shared_transport`). Without
it, every call to `user_client()` built a brand-new httpx.Client — and paid a
fresh TCP + TLS handshake to Supabase's Tokyo region on every single request,
because it never got the chance to reuse a keep-alive connection. Measured
before this fix: /v1/dashboard took ~2.3-2.8s locally, almost entirely
connection setup rather than query time. Sharing the pool is safe: postgrest-py
merges each client's Authorization header into the request explicitly at call
time (`additional_headers.update(self.headers)` before `session.request(...)`)
rather than mutating the shared session's own headers, so two users' requests
sharing the pool can never see each other's tokens.
"""

from __future__ import annotations

from functools import lru_cache

import httpx

from app.config import get_settings
from app.core.errors import ServiceUnavailableError, UnauthorizedError
from supabase import Client, ClientOptions, create_client


@lru_cache
def _shared_transport() -> httpx.Client:
    """One pooled, keep-alive HTTP client, reused by every Supabase call.

    http2=True matches postgrest-py's own default session, and the higher
    keepalive limit matters here specifically: Cloud Run/uvicorn serve requests
    concurrently, so a pool of 1 would just move the same handshake cost onto
    whichever request loses the race for the single connection.
    """
    return httpx.Client(
        http2=True,
        limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
        timeout=30.0,
    )


@lru_cache
def service_client() -> Client:
    settings = get_settings()
    if not (settings.supabase_url and settings.supabase_service_role_key):
        raise ServiceUnavailableError(
            "Supabase service credentials are not configured.",
            code="SUPABASE_NOT_CONFIGURED",
        )
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
        options=ClientOptions(httpx_client=_shared_transport()),
    )


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

    client = create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
        options=ClientOptions(httpx_client=_shared_transport()),
    )
    # Attach the caller's JWT so PostgREST evaluates auth.uid() as this user.
    # Safe to do on a shared-pool client: postgrest-py attaches this header
    # per-request rather than mutating the pool's own state (see module note).
    client.postgrest.auth(access_token)
    return client
