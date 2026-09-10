"""Identifying a product's brand from a photo of its own front/branding.

A separate concern from reading an expiry date: no keyword like "EXP" exists
to anchor on, so plain OCR cannot tell "this is the product name" from "this
is marketing copy" or background clutter. Marked slow like the other real
Vision/PaddleOCR tests - this hits the live Vision API, not a stub.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

PRODUCTS = Path(__file__).parent / "fixtures" / "products"
MANIFEST = PRODUCTS / "manifest.csv"


def _rows() -> list[dict[str, str]]:
    if not MANIFEST.exists():
        return []
    with MANIFEST.open(newline="", encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if any(v.strip() for v in r.values())]


ROWS = _rows()


@pytest.mark.slow
@pytest.mark.skipif(not ROWS, reason="no product fixtures recorded")
@pytest.mark.parametrize("row", ROWS, ids=[r["filename"] for r in ROWS])
def test_real_photo_identifies_the_brand(row: dict[str, str]) -> None:
    from app.services.ocr.vision_engine import identify_product

    image = (PRODUCTS / row["filename"]).read_bytes()
    brand, confidence, raw_text = identify_product(image)

    assert brand == row["expected_brand"]
    assert confidence is not None and confidence >= 0.5
    assert raw_text  # the same photo's OCR text is still returned alongside


def test_no_client_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing/misconfigured Vision must degrade to (None, None, None), not
    raise - a caller with no way to identify a brand must still work."""
    from app.services.ocr import vision_engine

    monkeypatch.setattr(vision_engine, "_load", lambda: None)
    assert vision_engine.identify_product(b"not a real image") == (None, None, None)
