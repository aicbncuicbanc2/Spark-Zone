"""Google Cloud Vision — the fallback engine.

Runs only when PaddleOCR reads poorly or fails outright. Vision is generally
stronger on low-contrast dot-matrix printing and awkward angles, which is
exactly where the primary struggles.

Implements the same OcrBackend protocol as PaddleOCR, so `pipeline.py` swaps
between them without either knowing the other exists.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from app.config import get_settings
from app.services.ocr.base import OcrEngine, OcrResult, TextBlock
from app.services.ocr.preprocess import prepare

logger = logging.getLogger(__name__)

_client: Any | None = None
_load_failed = False


def _load() -> Any | None:
    global _client, _load_failed

    if _client is not None or _load_failed:
        return _client

    settings = get_settings()
    if not settings.vision_enabled:
        _load_failed = True
        return None

    try:
        from google.cloud import vision

        # On Cloud Run the runtime service account is picked up automatically;
        # locally it comes from GOOGLE_APPLICATION_CREDENTIALS.
        _client = vision.ImageAnnotatorClient()
        logger.info("vision_client_loaded")
    except Exception as exc:  # noqa: BLE001 - absence must degrade, not crash
        _load_failed = True
        logger.warning("vision_unavailable", extra={"reason": str(exc)})

    return _client


class VisionEngine:
    name = OcrEngine.GOOGLE_VISION

    def is_available(self) -> bool:
        return _load() is not None

    def read(self, image: bytes) -> OcrResult:
        started = time.perf_counter()

        client = _load()
        if client is None:
            return OcrResult(
                engine=self.name,
                error="Google Vision is not configured.",
                duration_ms=int((time.perf_counter() - started) * 1000),
            )

        try:
            from google.cloud import vision

            request_image = vision.Image(content=prepare(image))
            # DOCUMENT_TEXT_DETECTION handles dense, small print better than
            # plain TEXT_DETECTION, which suits packaging.
            response = client.document_text_detection(image=request_image)

            if response.error.message:
                return OcrResult(
                    engine=self.name,
                    error=response.error.message,
                    duration_ms=int((time.perf_counter() - started) * 1000),
                )

            blocks: list[TextBlock] = []
            for page in response.full_text_annotation.pages:
                for block in page.blocks:
                    for paragraph in block.paragraphs:
                        words = [
                            "".join(symbol.text for symbol in word.symbols)
                            for word in paragraph.words
                        ]
                        text = " ".join(words).strip()
                        if not text:
                            continue

                        vertices = paragraph.bounding_box.vertices
                        xs = [v.x for v in vertices] or [0]
                        ys = [v.y for v in vertices] or [0]
                        blocks.append(
                            TextBlock(
                                text=text,
                                confidence=float(paragraph.confidence or 0.0),
                                box=(min(xs), min(ys), max(xs), max(ys)),
                            )
                        )

            return OcrResult(
                engine=self.name,
                blocks=blocks,
                duration_ms=int((time.perf_counter() - started) * 1000),
            )

        except Exception as exc:
            logger.exception("vision_failed")
            return OcrResult(
                engine=self.name,
                error=str(exc),
                duration_ms=int((time.perf_counter() - started) * 1000),
            )


def identify_product(image: bytes) -> tuple[str | None, float | None, str | None]:
    """Best-effort brand identification from a photo of a product's own
    front/branding - a separate concern from reading an expiry date.

    Logo Detection is precise when it hits: verified on a real product photo
    at 1.00 confidence, correctly naming the brand where plain OCR on the
    same photo both misread it and picked up unrelated background text (a
    laptop sticker) with no way to tell that wasn't part of the product.
    But it is genuinely inconsistent - a comparably well-known brand on a
    different real product returned no logo at all. Never block on this:
    the caller must always let the user confirm or type the brand/name
    themselves regardless of what comes back here.
    """
    client = _load()
    if client is None:
        return None, None, None

    try:
        from google.cloud import vision

        request_image = vision.Image(content=prepare(image))

        logo_response = client.logo_detection(image=request_image)
        brand: str | None = None
        brand_confidence: float | None = None
        if logo_response.logo_annotations:
            top = logo_response.logo_annotations[0]
            brand = top.description
            brand_confidence = float(top.score)

        text_response = client.document_text_detection(image=request_image)
        raw_text = (text_response.full_text_annotation.text or "").strip() or None

        return brand, brand_confidence, raw_text

    except Exception:
        logger.exception("vision_identify_product_failed")
        return None, None, None
