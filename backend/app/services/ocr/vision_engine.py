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
