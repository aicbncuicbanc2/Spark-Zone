"""OCR layer.

Reading-order and preprocessing tests run everywhere. The tests that actually
invoke PaddleOCR skip unless it is installed, since it is a ~1.5 GB dependency
kept out of the default development install.

    pip install -r requirements-ml.txt    # to enable the slow ones
"""

from __future__ import annotations

import csv
import io
from datetime import date
from pathlib import Path

import pytest
from PIL import Image

from app.services.date_parser import parse
from app.services.ocr.base import OcrEngine, OcrResult, TextBlock
from app.services.ocr.preprocess import MAX_EDGE, describe, prepare

LABELS = Path(__file__).parent / "fixtures" / "labels"
MANIFEST = LABELS / "manifest.csv"
TODAY = date(2026, 9, 5)


def _png(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (200, 200, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


# --- Reading order ------------------------------------------------------------


def test_blocks_are_joined_in_reading_order() -> None:
    """OCR returns detection order, not reading order.

    A real fixture came back as ['LOT.5F0301', '2028.06.02', 'EXP'] - the label
    after the date it labels. Sorting by position is what fixes it.
    """
    result = OcrResult(
        engine=OcrEngine.PADDLEOCR,
        blocks=[
            TextBlock("LOT.5F0301", 0.9, (10, 10, 200, 40)),
            TextBlock("2028.06.02", 0.9, (60, 60, 240, 90)),
            TextBlock("EXP", 0.9, (10, 60, 55, 90)),
        ],
    )
    assert result.text == "LOT.5F0301\nEXP 2028.06.02"


def test_blocks_on_the_same_line_are_merged_left_to_right() -> None:
    result = OcrResult(
        engine=OcrEngine.PADDLEOCR,
        blocks=[
            TextBlock("22/12/2027", 0.9, (300, 100, 460, 130)),
            TextBlock("EXP DATE:", 0.9, (100, 102, 290, 132)),
        ],
    )
    assert result.text == "EXP DATE: 22/12/2027"


def test_reading_order_survives_the_parser() -> None:
    result = OcrResult(
        engine=OcrEngine.PADDLEOCR,
        blocks=[
            TextBlock("LOT.5F0301", 0.9, (10, 10, 200, 40)),
            TextBlock("2028.06.02", 0.9, (60, 60, 240, 90)),
            TextBlock("EXP", 0.9, (10, 60, 55, 90)),
        ],
    )
    assert parse(result.text, today=TODAY).expiry_date == date(2028, 6, 2)


def test_empty_result_is_reported_not_crashed() -> None:
    result = OcrResult(engine=OcrEngine.PADDLEOCR, blocks=[])
    assert result.text == ""
    assert not result.succeeded
    assert result.confidence == 0.0


def test_confidence_is_the_block_mean() -> None:
    result = OcrResult(
        engine=OcrEngine.PADDLEOCR,
        blocks=[TextBlock("a", 1.0), TextBlock("b", 0.5)],
    )
    assert result.confidence == pytest.approx(0.75)


# --- Preprocessing ------------------------------------------------------------


def test_oversized_images_are_downscaled() -> None:
    """A 3072x4096 phone photo took 95s and read worse; 1600px took 16s."""
    out = prepare(_png(3072, 4096))
    with Image.open(io.BytesIO(out)) as image:
        assert max(image.size) == MAX_EDGE


def test_small_images_are_not_upscaled() -> None:
    out = prepare(_png(400, 300))
    with Image.open(io.BytesIO(out)) as image:
        assert image.size == (400, 300)


def test_aspect_ratio_is_preserved() -> None:
    out = prepare(_png(4000, 2000))
    with Image.open(io.BytesIO(out)) as image:
        assert image.width == MAX_EDGE
        assert image.height == MAX_EDGE // 2


def test_corrupt_input_returns_the_original_bytes() -> None:
    """Preprocessing must never be the reason a scan fails."""
    junk = b"this is not an image"
    assert prepare(junk) == junk


def test_describe_handles_junk() -> None:
    assert describe(b"nope")["format"] == "unreadable"


# --- The real thing -----------------------------------------------------------

paddle = pytest.importorskip(
    "paddleocr", reason="PaddleOCR not installed (pip install -r requirements-ml.txt)"
)


def _rows() -> list[dict[str, str]]:
    if not MANIFEST.exists():
        return []
    with MANIFEST.open(newline="", encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if any(v.strip() for v in r.values())]


ROWS = _rows()


@pytest.fixture(scope="module")
def engine():
    from app.services.ocr.paddle_engine import PaddleEngine

    instance = PaddleEngine()
    if not instance.is_available():
        pytest.skip("PaddleOCR failed to load on this machine")
    return instance


@pytest.mark.slow
@pytest.mark.skipif(not ROWS, reason="no label fixtures recorded")
@pytest.mark.parametrize("row", ROWS, ids=[r["filename"] for r in ROWS])
def test_real_photo_to_correct_date(engine, row: dict[str, str]) -> None:
    """Photograph in, correct date out. The whole pipeline, no mocks."""
    image = (LABELS / row["filename"]).read_bytes()
    result = engine.read(image)

    assert result.succeeded, f"{row['filename']}: OCR failed - {result.error}"

    parsed = parse(result.text, today=TODAY)
    expected = date.fromisoformat(row["expected_date"])

    assert parsed.best is not None, (
        f"{row['filename']}: no date found in OCR text {result.text!r}"
    )
    assert parsed.best.value == expected, (
        f"{row['filename']}: OCR read {result.text!r} -> "
        f"{parsed.best.value}, expected {expected}"
    )

    if row["date_type"] == "manufacture":
        assert parsed.expiry_date is None
