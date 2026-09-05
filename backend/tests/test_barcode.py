"""Barcode decoding and product identity.

Decoding runs against the real photographs — pyzbar is small and fast, so
unlike OCR there is no reason to hide these behind a marker. Network lookups
are stubbed; the live Open Food Facts check is marked `slow`.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from app.services.barcode import (
    RETAIL_SYMBOLOGIES,
    check_digit_valid,
    decode,
    issuing_country,
)
from app.services.ocr.preprocess import prepare

BARCODES = Path(__file__).parent / "fixtures" / "barcodes"
MANIFEST = BARCODES / "manifest.csv"


def _rows() -> list[dict[str, str]]:
    if not MANIFEST.exists():
        return []
    with MANIFEST.open(newline="", encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if any(v.strip() for v in r.values())]


ROWS = _rows()
pytest.importorskip("pyzbar", reason="pyzbar not installed")


# --- checksum -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("9555723801829", True),   # Bad Lab, Malaysia
        ("4005808301843", True),   # Nivea, Germany
        ("9556183960880", True),   # Captain Oats, Malaysia
        ("9555723801828", False),  # last digit altered
        ("110308", False),         # CODE128 internal code, not a retail barcode
        ("abcdefghijklm", False),
        ("", False),
    ],
)
def test_check_digit(code: str, expected: bool) -> None:
    assert check_digit_valid(code) is expected


def test_issuing_country() -> None:
    assert issuing_country("9555723801829") == "Malaysia"
    assert issuing_country("4005808301843") == "Germany"
    assert issuing_country("3607349937812") == "France"
    assert issuing_country("8850029038117") == "Thailand"
    assert issuing_country("110308") is None


# --- decoding real photographs ------------------------------------------------


@pytest.mark.skipif(not ROWS, reason="no barcode fixtures recorded")
@pytest.mark.parametrize("row", ROWS, ids=[r["filename"] for r in ROWS])
def test_real_photo_decodes_to_the_recorded_digits(row: dict[str, str]) -> None:
    image = (BARCODES / row["filename"]).read_bytes()
    values = {code.value for code in decode(image)}
    assert row["barcode_digits"] in values, (
        f"{row['filename']}: decoded {values}, expected {row['barcode_digits']}"
    )


def test_retail_code_is_preferred_over_a_qr_code() -> None:
    """One fixture holds a QR code and an EAN-13. The EAN is the product."""
    from app.services.barcode import best_product_code

    image = (BARCODES / "barcode6.jpg").read_bytes()
    codes = decode(image)
    assert len(codes) >= 2
    assert codes[0].symbology in RETAIL_SYMBOLOGIES  # sorted retail-first

    best = best_product_code(image)
    assert best is not None
    assert best.value == "9556183960880"


def test_non_retail_symbology_is_not_treated_as_a_product() -> None:
    """CODE128 '110308' is an internal code.

    Accepting it would invent a product identity, and hand the date parser six
    digits that look exactly like a date.
    """
    from app.services.barcode import best_product_code

    image = (BARCODES / "barcode1.jpg").read_bytes()
    assert decode(image), "the code should still be decoded"
    assert best_product_code(image) is None, "but must not count as a product"


def test_downscaling_does_not_break_decoding() -> None:
    """The scan endpoint downscales before OCR; the same bytes feed the decoder."""
    for name in ("barcode2.jpeg", "barcode5.jpeg", "barcodeandlabel.jpg"):
        raw = (BARCODES / name).read_bytes()
        full = {c.value for c in decode(raw)}
        small = {c.value for c in decode(prepare(raw))}
        assert full == small, f"{name}: {full} at full size, {small} after resizing"


def test_junk_input_returns_nothing_rather_than_raising() -> None:
    assert decode(b"not an image") == []
    assert decode(b"") == []


# --- live lookup --------------------------------------------------------------


@pytest.mark.slow
@pytest.mark.asyncio
async def test_open_food_facts_lookup_is_live() -> None:
    """Hits the real API. Coverage is ~4/6 on our fixtures, so misses are normal."""
    from app.services.barcode import lookup_open_food_facts

    info = await lookup_open_food_facts("9556183960880")
    if info is None:
        pytest.skip("Open Food Facts unreachable or entry removed")
    assert info.barcode == "9556183960880"
    assert info.name


@pytest.mark.asyncio
async def test_malformed_barcode_is_not_looked_up() -> None:
    from app.services.barcode import lookup_open_food_facts

    assert await lookup_open_food_facts("nonsense") is None
    assert await lookup_open_food_facts("") is None
