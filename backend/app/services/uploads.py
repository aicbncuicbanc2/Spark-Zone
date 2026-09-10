"""Shared validation for any endpoint that accepts an image upload."""

from __future__ import annotations

from fastapi import UploadFile

from app.config import get_settings
from app.core.errors import BadRequestError, PayloadTooLargeError

ALLOWED_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"}


async def read_image_upload(image: UploadFile) -> bytes:
    settings = get_settings()

    if image.content_type and image.content_type.lower() not in ALLOWED_TYPES:
        raise BadRequestError(
            f"Unsupported image type: {image.content_type}. Send JPEG, PNG or WebP.",
            code="UNSUPPORTED_IMAGE_TYPE",
        )

    data = await image.read()
    if not data:
        raise BadRequestError("The uploaded file was empty.", code="EMPTY_UPLOAD")
    if len(data) > settings.ocr_max_image_bytes:
        raise PayloadTooLargeError(
            f"Image is {len(data) // 1024} KB; the limit is "
            f"{settings.ocr_max_image_bytes // 1024} KB.",
            details={"bytes": len(data), "limit": settings.ocr_max_image_bytes},
        )
    return data
