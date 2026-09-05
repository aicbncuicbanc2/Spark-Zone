"""Image storage on Cloudinary.

Deliberately non-fatal. If Cloudinary is unconfigured or unreachable, a scan
still runs OCR and returns a date — it simply has no stored image. Losing the
photo is a small loss; losing the scan because the photo could not be filed is
a large one.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from app.config import get_settings

logger = logging.getLogger(__name__)

_configured = False


@dataclass(frozen=True)
class StoredImage:
    url: str | None
    public_id: str | None
    error: str | None = None

    @property
    def stored(self) -> bool:
        return self.url is not None


def is_configured() -> bool:
    settings = get_settings()
    return bool(
        settings.cloudinary_cloud_name
        and settings.cloudinary_api_key
        and settings.cloudinary_api_secret
    )


def _ensure_configured() -> bool:
    """Configure the SDK once. Returns False when credentials are absent."""
    global _configured

    if _configured:
        return True
    if not is_configured():
        return False

    try:
        import cloudinary

        settings = get_settings()
        cloudinary.config(
            cloud_name=settings.cloudinary_cloud_name,
            api_key=settings.cloudinary_api_key,
            api_secret=settings.cloudinary_api_secret,
            secure=True,
        )
        _configured = True
    except Exception as exc:  # noqa: BLE001
        logger.warning("cloudinary_config_failed", extra={"reason": str(exc)})
        return False

    return _configured


def upload_scan_image(data: bytes, *, user_id: str) -> StoredImage:
    """Store a scan photo. Never raises."""
    if not _ensure_configured():
        return StoredImage(None, None, error="Cloudinary is not configured.")

    settings = get_settings()
    started = time.perf_counter()

    try:
        import cloudinary.uploader

        response = cloudinary.uploader.upload(
            data,
            folder=f"{settings.cloudinary_upload_folder}/{user_id}",
            resource_type="image",
            # The originals are phone-sized; nothing downstream needs them full
            # resolution, and the free tier is finite.
            transformation=[{"width": 1600, "height": 1600, "crop": "limit"}],
            format="jpg",
            quality="auto:good",
        )
        logger.info(
            "cloudinary_upload_ok",
            extra={"ms": int((time.perf_counter() - started) * 1000)},
        )
        return StoredImage(
            url=response.get("secure_url"), public_id=response.get("public_id")
        )

    except Exception as exc:  # noqa: BLE001 - a failed upload must not fail the scan
        logger.warning("cloudinary_upload_failed", extra={"reason": str(exc)})
        return StoredImage(None, None, error=str(exc)[:300])


def delete_scan_image(public_id: str) -> bool:
    """Remove a stored image. Used when a scan is deleted."""
    if not public_id or not _ensure_configured():
        return False
    try:
        import cloudinary.uploader

        result = cloudinary.uploader.destroy(public_id, resource_type="image")
        return result.get("result") == "ok"
    except Exception as exc:  # noqa: BLE001
        logger.warning("cloudinary_delete_failed", extra={"reason": str(exc)})
        return False
