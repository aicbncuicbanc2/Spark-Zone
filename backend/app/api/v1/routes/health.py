"""Liveness and readiness.

/health must stay dependency-free and always return 200 — Cloud Run uses it to
decide whether to keep the container alive. If it ever touches Supabase and
Supabase blips, Cloud Run will kill a perfectly healthy revision.

/health/ready is the one that tells the truth about configuration and upstreams.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time

import httpx
from fastapi import APIRouter, Response

from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])

STARTED_AT = time.time()


@router.get("/health", summary="Liveness probe")
async def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "service": "expiry-guardian-api",
        "environment": settings.environment,
        "revision": os.getenv("K_REVISION", "local"),
        "uptime_seconds": round(time.time() - STARTED_AT, 1),
    }


async def _probe_supabase(url: str, key: str, timeout: float = 3.0) -> dict:
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(
                f"{url.rstrip('/')}/auth/v1/health", headers={"apikey": key}
            )
        return {
            "status": "ok" if resp.status_code < 500 else "degraded",
            "http_status": resp.status_code,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        }
    except Exception as exc:  # noqa: BLE001 - readiness must never raise
        return {"status": "unreachable", "error": type(exc).__name__, "detail": str(exc)[:200]}


@router.get("/health/ready", summary="Readiness probe")
async def ready(response: Response) -> dict:
    settings = get_settings()
    missing = settings.missing_required()

    checks: dict[str, dict] = {
        "config": {
            "status": "ok" if not missing else "misconfigured",
            "missing_env": missing,
        },
        "optional_integrations": {
            "cloudinary": bool(settings.cloudinary_cloud_name and settings.cloudinary_api_key),
            "google_vision": bool(settings.google_application_credentials)
            and settings.vision_enabled,
            "fcm": bool(settings.fcm_service_account_json) and settings.fcm_enabled,
        },
    }

    if settings.supabase_url and settings.supabase_anon_key:
        checks["supabase"] = await asyncio.shield(
            _probe_supabase(settings.supabase_url, settings.supabase_anon_key)
        )
    else:
        checks["supabase"] = {"status": "skipped", "reason": "credentials not configured"}

    healthy = not missing and checks["supabase"].get("status") in {"ok", "skipped"}
    if not healthy:
        response.status_code = 503

    return {"status": "ready" if healthy else "not_ready", "checks": checks}
