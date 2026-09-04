"""Verification of Supabase-issued JWTs.

Supabase projects come in two flavours and we support both, because which one you
have depends on when the project was created:

  * New projects sign asymmetrically (ES256/RS256). We fetch the public key from
    the project's JWKS endpoint. No secret needs to live on this server.
  * Legacy projects sign with a shared HS256 secret (SUPABASE_JWT_SECRET).

Either way the verified `sub` claim is the user's UUID, which is exactly what
Postgres RLS compares against via auth.uid().
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

import jwt
from jwt import PyJWKClient

from app.config import get_settings
from app.core.errors import UnauthorizedError

logger = logging.getLogger(__name__)

_ASYMMETRIC_PREFIXES = ("RS", "ES", "PS", "Ed")


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    role: str
    access_token: str


@lru_cache
def _jwk_client() -> PyJWKClient:
    settings = get_settings()
    if not settings.supabase_url:
        raise UnauthorizedError(
            "SUPABASE_URL is not configured; cannot verify tokens.",
            code="AUTH_NOT_CONFIGURED",
        )
    # PyJWKClient caches keys in-process, so this is one network call per cold start.
    return PyJWKClient(settings.supabase_jwks_url, cache_keys=True, lifespan=3600)


def decode_token(token: str) -> dict:
    settings = get_settings()

    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("Malformed token.", code="TOKEN_MALFORMED") from exc

    options = {"verify_aud": bool(settings.supabase_jwt_aud)}

    try:
        if alg.startswith(_ASYMMETRIC_PREFIXES):
            signing_key = _jwk_client().get_signing_key_from_jwt(token).key
            return jwt.decode(
                token,
                signing_key,
                algorithms=[alg],
                audience=settings.supabase_jwt_aud or None,
                options=options,
            )

        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise UnauthorizedError(
                    "This project issues HS256 tokens but SUPABASE_JWT_SECRET is unset.",
                    code="AUTH_NOT_CONFIGURED",
                )
            return jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience=settings.supabase_jwt_aud or None,
                options=options,
            )

        raise UnauthorizedError(f"Unsupported token algorithm: {alg}", code="TOKEN_ALG")

    except jwt.ExpiredSignatureError as exc:
        # Distinct code so the app knows to refresh rather than log the user out.
        raise UnauthorizedError("Token has expired.", code="TOKEN_EXPIRED") from exc
    except jwt.InvalidAudienceError as exc:
        raise UnauthorizedError("Token audience mismatch.", code="TOKEN_AUDIENCE") from exc
    except jwt.PyJWTError as exc:
        logger.warning("jwt_verification_failed", extra={"reason": str(exc)})
        raise UnauthorizedError("Token verification failed.", code="TOKEN_INVALID") from exc


def user_from_token(token: str) -> CurrentUser:
    claims = decode_token(token)
    subject = claims.get("sub")
    if not subject:
        raise UnauthorizedError("Token is missing a subject claim.", code="TOKEN_INVALID")
    return CurrentUser(
        id=subject,
        email=claims.get("email"),
        role=claims.get("role", "authenticated"),
        access_token=token,
    )
