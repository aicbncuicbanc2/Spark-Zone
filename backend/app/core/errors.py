"""One error envelope for the whole API.

Every failure the frontend sees looks like:

    {"error": {"code": "ITEM_NOT_FOUND", "message": "...", "details": {}},
     "request_id": "..."}

Your teammate can branch on `error.code` and never has to parse prose.
"""

import json
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    status_code: int = 500
    code: str = "INTERNAL_ERROR"
    message: str = "Something went wrong."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.status_code = status_code or self.status_code
        self.details = details or {}
        super().__init__(self.message)


class BadRequestError(AppError):
    status_code, code, message = 400, "BAD_REQUEST", "The request was malformed."


class UnauthorizedError(AppError):
    status_code, code, message = 401, "UNAUTHORIZED", "Missing or invalid credentials."


class ForbiddenError(AppError):
    status_code, code, message = 403, "FORBIDDEN", "You cannot access this resource."


class NotFoundError(AppError):
    status_code, code, message = 404, "NOT_FOUND", "Resource not found."


class ConflictError(AppError):
    status_code, code, message = 409, "CONFLICT", "Resource already exists."


class PayloadTooLargeError(AppError):
    status_code, code, message = 413, "PAYLOAD_TOO_LARGE", "The uploaded file is too large."


class UnprocessableError(AppError):
    status_code, code, message = 422, "UNPROCESSABLE", "The request could not be processed."


class UpstreamError(AppError):
    """A third party (Cloudinary, Vision, FCM, Open Food Facts) failed us."""

    status_code, code, message = 502, "UPSTREAM_ERROR", "An upstream service failed."


class ServiceUnavailableError(AppError):
    status_code, code, message = 503, "SERVICE_UNAVAILABLE", "The service is not ready."


def _envelope(request: Request, code: str, message: str, details: dict[str, Any]) -> dict:
    return {
        "error": {"code": code, "message": message, "details": details},
        "request_id": getattr(request.state, "request_id", None),
    }


def _jsonable_errors(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Make pydantic's error list safe to serialise.

    When a custom @field_validator or @model_validator raises ValueError,
    pydantic v2 puts the *exception object itself* into `ctx['error']`, and
    `input` can be any object at all. Serialising those raises TypeError inside
    the handler, which turns every such validation failure into an opaque 500.
    """
    cleaned: list[dict[str, Any]] = []
    for error in raw:
        item = dict(error)
        item.pop("url", None)  # link to pydantic docs; noise for our clients

        if isinstance(item.get("ctx"), dict):
            item["ctx"] = {k: str(v) for k, v in item["ctx"].items()}

        if "input" in item:
            try:
                json.dumps(item["input"])
            except (TypeError, ValueError):
                item["input"] = str(item["input"])

        if "loc" in item:
            item["loc"] = [str(part) for part in item["loc"]]

        cleaned.append(item)
    return cleaned


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(request, exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_envelope(
                request,
                "VALIDATION_ERROR",
                "One or more fields failed validation.",
                {"fields": _jsonable_errors(exc.errors())},
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(request, f"HTTP_{exc.status_code}", str(exc.detail), {}),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Never leak internals to the client; the stack trace goes to Cloud Logging.
        import logging

        logging.getLogger("app").exception("unhandled_exception")
        return JSONResponse(
            status_code=500,
            content=_envelope(request, "INTERNAL_ERROR", "Something went wrong.", {}),
        )
