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


# Maps Vision's generic Label Detection vocabulary onto this app's fixed
# category ids (see the `categories` table). Deliberately keyword-based
# rather than a model: these seven buckets are the entire target space, so a
# small lookup is both simpler and more auditable than anything fancier.
# Checked in this order because a photo can trip several at once (e.g. a
# sunscreen photo can say "Skin" and "Bottle") - more specific buckets are
# listed before the more general "food" catch-all.
_CATEGORY_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("medicine", ("medicine", "pill", "tablet", "capsule", "pharmaceutical drug", "syrup", "medication")),
    ("supplement", ("dietary supplement", "vitamin", "nutritional supplement", "protein powder")),
    ("aerosol", ("aerosol spray", "aerosol", "spray", "air freshener", "deodorant spray")),
    ("skincare", ("skin care", "sunscreen", "moisturizer", "lotion", "serum", "toner", "cleanser", "skin")),
    ("cosmetic", ("cosmetics", "make-up", "makeup", "lipstick", "foundation", "mascara", "nail polish", "perfume", "fragrance")),
    ("household", ("detergent", "cleaning", "household supply", "disinfectant", "dish soap", "laundry")),
    ("food", ("food", "chocolate", "candy", "snack", "junk food", "confectionery", "baked goods",
              "beverage", "drink", "bread", "fruit", "vegetable", "meat", "dairy", "cheese",
              "ingredient", "sauce", "seasoning", "cereal", "noodle", "rice", "coffee", "tea")),
]
# Below this, a label is treated as too weak to act on - left for the user
# to pick a category themselves rather than risk a wrong-looking guess.
_CATEGORY_MIN_SCORE = 0.6


def _guess_category(labels: list[tuple[str, float]]) -> tuple[str | None, float | None]:
    for description, score in labels:
        if score < _CATEGORY_MIN_SCORE:
            continue
        lowered = description.lower()
        for category_id, keywords in _CATEGORY_KEYWORDS:
            if any(keyword in lowered for keyword in keywords):
                return category_id, score
    return None, None


def identify_product(
    image: bytes,
) -> tuple[str | None, float | None, str | None, str | None, float | None]:
    """Best-effort brand + category identification from a photo of a
    product's own front/branding - a separate concern from reading an
    expiry date. Returns (brand, brand_confidence, raw_text, category_id,
    category_confidence).

    Logo Detection is precise when it hits: verified on a real product photo
    at 1.00 confidence, correctly naming the brand where plain OCR on the
    same photo both misread it (a different real photo misread "KOPIKO" as
    "KOPIRO") and picked up unrelated background text (a laptop, an "ASUS
    SUPPORT" sticker, in one real test shot) with no way to tell that wasn't
    part of the product. That inconsistency is why `raw_text`'s largest text
    block is deliberately NOT used to guess a product name here - it would
    silently offer a misread brand or background noise as if it were the
    name. Category, by contrast, comes from Label Detection, which is a
    genuinely different and more reliable signal for this narrower job: on
    the one real product photo tested, it correctly scored "Food"/
    "Chocolate"/"Junk food" all above 0.6 confidence. Logo Detection is also
    genuinely inconsistent brand-to-brand - a comparably well-known brand on
    a different real product returned no logo at all. Never block on any of
    this: the caller must always let the user confirm or type the name,
    brand, and category themselves regardless of what comes back here.
    """
    client = _load()
    if client is None:
        return None, None, None, None, None

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

        label_response = client.label_detection(image=request_image)
        labels = [(label.description, float(label.score)) for label in label_response.label_annotations]
        category_id, category_confidence = _guess_category(labels)

        return brand, brand_confidence, raw_text, category_id, category_confidence

    except Exception:
        logger.exception("vision_identify_product_failed")
        return None, None, None, None, None
