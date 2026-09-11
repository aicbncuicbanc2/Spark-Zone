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
    result = identify_product(image)

    assert result.brand == row["expected_brand"]
    assert result.brand_confidence is not None and result.brand_confidence >= 0.5
    assert result.raw_text  # the same photo's OCR text is still returned alongside
    # A real logo hit must come with a real, sane box: inside the photo,
    # non-zero size - not just "some value happened to be truthy".
    assert result.brand_box is not None
    box = result.brand_box
    assert 0.0 <= box.x <= 1.0 and 0.0 <= box.y <= 1.0
    assert 0.0 < box.width <= 1.0 and 0.0 < box.height <= 1.0
    assert box.x + box.width <= 1.0 + 1e-6
    assert box.y + box.height <= 1.0 + 1e-6
    # Real Label Detection on this fixture: Food 0.907, Chocolate 0.731,
    # Junk food 0.671 - all comfortably over the 0.6 bar, so this is a real
    # assertion, not a rubber stamp.
    if row["filename"] == "kopiko-coffee-candy.jpg":
        assert result.category_id == "food"
        assert result.category_confidence is not None and result.category_confidence >= 0.6


def test_no_client_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing/misconfigured Vision must degrade to an empty result, not
    raise - a caller with no way to identify a product must still work."""
    from app.services.ocr import vision_engine

    monkeypatch.setattr(vision_engine, "_load", lambda: None)
    result = vision_engine.identify_product(b"not a real image")
    assert result == vision_engine.ProductIdentification()


@pytest.mark.parametrize(
    "labels,expected_category",
    [
        ([("Food", 0.9), ("Chocolate", 0.7)], "food"),
        ([("Sunscreen", 0.8)], "skincare"),
        ([("Aerosol spray", 0.75)], "aerosol"),
        ([("Packaging and labeling", 0.9), ("Logo", 0.8)], None),  # no real signal
        ([("Food", 0.4)], None),  # below the confidence bar
        ([], None),
    ],
)
def test_guess_category_from_labels(labels: list[tuple[str, float]], expected_category: str | None) -> None:
    from app.services.ocr.vision_engine import _guess_category

    category_id, _confidence = _guess_category(labels)
    assert category_id == expected_category


class _FakeVertex:
    def __init__(self, x: int, y: int) -> None:
        self.x = x
        self.y = y


def test_bounding_box_converts_pixels_to_fractions() -> None:
    """A logo box at pixels (100,200)-(300,400) in a 1000x800 image must
    become fractions the client can apply to a displayed image of any
    size - not the original pixel values, which are meaningless without
    knowing the exact resolution Vision analyzed."""
    from app.services.ocr.vision_engine import _bounding_box

    vertices = [_FakeVertex(100, 200), _FakeVertex(300, 200), _FakeVertex(300, 400), _FakeVertex(100, 400)]
    box = _bounding_box(vertices, image_width=1000, image_height=800)

    assert box is not None
    assert box.x == pytest.approx(0.1)
    assert box.y == pytest.approx(0.25)
    assert box.width == pytest.approx(0.2)
    assert box.height == pytest.approx(0.25)


def test_bounding_box_handles_missing_dimensions() -> None:
    """A caller must never divide by zero if image dimensions couldn't be
    read - degrade to no box, not a crash."""
    from app.services.ocr.vision_engine import _bounding_box

    vertices = [_FakeVertex(10, 10), _FakeVertex(20, 20)]
    assert _bounding_box(vertices, image_width=0, image_height=0) is None
    assert _bounding_box([], image_width=1000, image_height=800) is None
