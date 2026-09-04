"""FastAPI application factory for the Pantry & Cosmetics Expiry Guardian API."""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.api.v1.routes import health
from app.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging

logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    missing = settings.missing_required()
    logger.info(
        "api_starting",
        extra={"environment": settings.environment, "missing_env": missing},
    )
    if missing:
        # A warning, not a crash: the container must still boot so /health works
        # and you can diagnose a bad deploy from the Cloud Run console.
        logger.warning("incomplete_configuration", extra={"missing_env": missing})
    yield
    logger.info("api_stopping")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Pantry & Cosmetics Expiry Guardian API",
        description=(
            "Backend for scanning product labels, extracting expiry dates via OCR, "
            "and delivering prioritised expiry reminders."
        ),
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url=None,
        openapi_url="/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request.state.request_id = request_id
        started = time.perf_counter()

        response = await call_next(request)

        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers["X-Request-ID"] = request_id
        if request.url.path not in ("/health", "/health/ready"):
            logger.info(
                "request_completed",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                },
            )
        return response

    register_exception_handlers(app)

    # Health lives at the root, outside /v1, so probes never version-skew.
    app.include_router(health.router)
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {
            "service": "expiry-guardian-api",
            "version": app.version,
            "docs": "/docs",
            "health": "/health",
        }

    return app


app = create_app()
