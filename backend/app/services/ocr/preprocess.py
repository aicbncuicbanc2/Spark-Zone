"""Image preparation before OCR.

Downscaling is not an optimisation, it is the difference between a usable scan
and an unusable one. Measured on real fixtures:

    1080 x 1440  (0.6 MB)  ->  ~13 s
    3072 x 4096  (2.4 MB)  ->  ~95 s

Seven times slower, and the large image also produced *worse* text: it
fragmented the date across several detections and returned them out of order.
Phone cameras produce the second kind by default.
"""

from __future__ import annotations

import io
import logging

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

#: Longest edge, in pixels. Roughly the size that read cleanly and quickly on
#: the real fixtures; well above what the text detector needs.
MAX_EDGE = 1600

#: JPEG quality for the re-encoded image. High enough not to soften dot-matrix
#: printing, which is already low-contrast.
JPEG_QUALITY = 90


def prepare(data: bytes, *, max_edge: int = MAX_EDGE) -> bytes:
    """Normalise an uploaded photo for OCR.

    Applies EXIF rotation, downscales the long edge, and flattens to RGB. Any
    failure returns the original bytes — a preprocessing problem must never
    prevent a scan from being attempted.
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            # Phones record rotation in EXIF rather than rotating the pixels.
            # Without this, a portrait photo reaches the detector sideways.
            image = ImageOps.exif_transpose(image)

            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")

            width, height = image.size
            longest = max(width, height)
            if longest > max_edge:
                scale = max_edge / longest
                image = image.resize(
                    (max(int(width * scale), 1), max(int(height * scale), 1)),
                    Image.LANCZOS,
                )

            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
            return buffer.getvalue()

    except Exception as exc:  # noqa: BLE001 - never block a scan on preprocessing
        logger.warning("image_preprocess_failed", extra={"reason": str(exc)})
        return data


def describe(data: bytes) -> dict[str, int | str]:
    """Cheap metadata for logging and the scan audit trail."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            return {
                "width": image.width,
                "height": image.height,
                "bytes": len(data),
                "format": image.format or "unknown",
            }
    except Exception:  # noqa: BLE001
        return {"bytes": len(data), "format": "unreadable"}
