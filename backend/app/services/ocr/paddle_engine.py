"""PaddleOCR — the primary engine.

Chosen because it handles the Malay and Chinese text common on Malaysian
packaging. Loaded lazily: importing paddle costs several seconds and pulls in
~1.5 GB of dependencies, so the API must be able to boot without it.
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from app.services.ocr.base import OcrEngine, OcrResult, TextBlock
from app.services.ocr.preprocess import prepare

logger = logging.getLogger(__name__)

# PaddlePaddle 3.x on Windows CPU raises
#   NotImplementedError: ConvertPirAttribute2RuntimeAttribute not support
# from its oneDNN path, so oneDNN has to be turned off there.
#
# ONLY on Windows. oneDNN is a large speed win on Linux, which is where the
# container actually runs - disabling it everywhere would slow production down
# to work around a local development problem.
_IS_WINDOWS = os.name == "nt"
if _IS_WINDOWS:
    os.environ.setdefault("FLAGS_use_mkldnn", "0")

_engine: Any | None = None
_load_failed = False


def _load() -> Any | None:
    """Build the PaddleOCR instance once, on first use."""
    global _engine, _load_failed

    if _engine is not None or _load_failed:
        return _engine

    try:
        from paddleocr import PaddleOCR

        started = time.perf_counter()
        _engine = PaddleOCR(
            lang="en",
            enable_mkldnn=not _IS_WINDOWS,
            # Each of these loads another model and adds seconds per scan. The
            # detector already copes with the rotations in our fixtures.
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
        logger.info(
            "paddleocr_loaded",
            extra={"seconds": round(time.perf_counter() - started, 1)},
        )
    except Exception as exc:  # noqa: BLE001 - absence must degrade, not crash
        _load_failed = True
        logger.warning("paddleocr_unavailable", extra={"reason": str(exc)})

    return _engine


def _to_blocks(prediction: dict[str, Any]) -> list[TextBlock]:
    texts = prediction.get("rec_texts") or []
    scores = prediction.get("rec_scores") or []
    polygons = prediction.get("dt_polys") or []

    blocks: list[TextBlock] = []
    for index, text in enumerate(texts):
        if not text or not text.strip():
            continue
        score = float(scores[index]) if index < len(scores) else 0.0

        box = (0.0, 0.0, 0.0, 0.0)
        if index < len(polygons):
            points = polygons[index]
            try:
                xs = [float(p[0]) for p in points]
                ys = [float(p[1]) for p in points]
                box = (min(xs), min(ys), max(xs), max(ys))
            except (TypeError, IndexError, ValueError):
                pass

        blocks.append(TextBlock(text=text.strip(), confidence=score, box=box))
    return blocks


class PaddleEngine:
    name = OcrEngine.PADDLEOCR

    def is_available(self) -> bool:
        return _load() is not None

    def read(self, image: bytes) -> OcrResult:
        started = time.perf_counter()

        engine = _load()
        if engine is None:
            return OcrResult(
                engine=self.name,
                error="PaddleOCR is not installed or failed to load.",
                duration_ms=int((time.perf_counter() - started) * 1000),
            )

        # Large phone photos are ~7x slower AND read worse - the date fragments
        # across several detections and comes back out of order.
        prepared = prepare(image)

        # PaddleOCR wants a path, not bytes.
        handle, path = tempfile.mkstemp(suffix=".jpg")
        try:
            with os.fdopen(handle, "wb") as fh:
                fh.write(prepared)

            predictions = engine.predict(path)
            blocks: list[TextBlock] = []
            for prediction in predictions or []:
                blocks.extend(_to_blocks(prediction))

            return OcrResult(
                engine=self.name,
                blocks=blocks,
                duration_ms=int((time.perf_counter() - started) * 1000),
            )

        except Exception as exc:
            logger.exception("paddleocr_failed")
            return OcrResult(
                engine=self.name,
                error=str(exc),
                duration_ms=int((time.perf_counter() - started) * 1000),
            )
        finally:
            Path(path).unlink(missing_ok=True)
