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


def test_no_escalation_when_a_confident_read_finds_no_expiry_keyword() -> None:
    """Real case: a dishwashing-liquid bottle's only printed code was a
    manufacture batch stamp ("120726 2335 15:54"), no "EXP" anywhere on the
    label. All three real engines read it confidently (0.93-0.96) and all
    three correctly found nothing - escalating cost 93 extra seconds for the
    same unavoidable answer. A different engine cannot make a keyword exist
    that the product simply never printed, so a confident read finding
    numbers but no keyword must stop the pipeline, not escalate further.
    """
    from app.services.ocr.pipeline import _no_expiry_keyword_present

    text = "Sunlight Extra Nature Mineral Salt Aloe Vera\n120726 2335 15:54\n0% No Dye"
    parsed = parse(text, today=TODAY)
    ocr = OcrResult(engine=OcrEngine.PADDLEOCR, blocks=[TextBlock(text, 0.95)])

    assert parsed.best.date_type.value == "unknown"  # sanity: no keyword found
    assert _no_expiry_keyword_present(ocr, parsed, threshold=0.65) is True


def test_ambiguous_expiry_keyword_still_escalates() -> None:
    """label1.jpg's real case: EXP:210827 is genuinely ambiguous (DDMMYY vs
    YYMMDD), so parsed.confidence is capped low - but a real "EXP" keyword
    IS present, so this must still escalate rather than being caught by the
    no-keyword short-circuit above."""
    from app.services.ocr.pipeline import _no_expiry_keyword_present

    text = "LOT.5F0301\nEXP:210827"
    parsed = parse(text, today=TODAY)
    ocr = OcrResult(engine=OcrEngine.PADDLEOCR, blocks=[TextBlock(text, 0.95)])

    assert parsed.best.date_type.value == "expiry"  # sanity: real keyword found
    assert _no_expiry_keyword_present(ocr, parsed, threshold=0.65) is False


def test_no_expiry_keyword_check_requires_a_confident_read() -> None:
    """A low-confidence read finding no keyword must NOT short-circuit - the
    keyword might simply have been missed or misread, not genuinely absent
    from the label, and only a confident read can rule that out."""
    from app.services.ocr.pipeline import _no_expiry_keyword_present

    text = "blurry 120726 unclear text"
    parsed = parse(text, today=TODAY)
    ocr = OcrResult(engine=OcrEngine.PADDLEOCR, blocks=[TextBlock(text, 0.3)])

    assert _no_expiry_keyword_present(ocr, parsed, threshold=0.65) is False


def test_pipeline_actually_stops_escalating_when_no_keyword_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Integration-level proof, not just the unit check above: the second
    engine must never even be called."""
    from app.services.ocr import pipeline

    text = "Sunlight Extra Nature Mineral Salt Aloe Vera\n120726 2335 15:54\n0% No Dye"

    class _FakeFastEngine:
        name = OcrEngine.PADDLEOCR
        variant = "fast"

        def is_available(self) -> bool:
            return True

        def read(self, image: bytes) -> OcrResult:
            return OcrResult(engine=OcrEngine.PADDLEOCR, blocks=[TextBlock(text, 0.95)])

    class _MustNotBeCalledEngine:
        name = OcrEngine.GOOGLE_VISION

        def is_available(self) -> bool:
            return True

        def read(self, image: bytes) -> OcrResult:
            raise AssertionError("must not escalate when a confident read found no keyword")

    monkeypatch.setattr(pipeline, "_engines", lambda: [_FakeFastEngine(), _MustNotBeCalledEngine()])
    result = pipeline.run(b"fake image bytes", today=TODAY)

    assert len(result.attempts) == 1
    assert result.parsed.best.date_type.value == "unknown"


def test_vision_runs_before_the_slow_accurate_tier() -> None:
    """Vision is a ~1-2s cloud call; the accurate tier is a local model that
    ran 100s+ under real memory pressure. Verified against all 7 real label
    fixtures that trying Vision first never costs accuracy - the pipeline
    always keeps the best-scoring result across every engine actually tried,
    not just whichever ran first - so this only ever saves time.
    """
    from app.services.ocr.paddle_engine import ACCURATE, FAST, PaddleEngine
    from app.services.ocr.pipeline import _engines
    from app.services.ocr.vision_engine import VisionEngine

    names = [
        (e.name, getattr(e, "variant", None))
        for e in _engines()
        if isinstance(e, (PaddleEngine, VisionEngine))
    ]
    assert names.index((OcrEngine.PADDLEOCR, FAST)) == 0
    assert names.index((OcrEngine.GOOGLE_VISION, None)) < names.index(
        (OcrEngine.PADDLEOCR, ACCURATE)
    )


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
def paddle_available():
    from app.services.ocr.paddle_engine import PaddleEngine

    if not PaddleEngine().is_available():
        pytest.skip("PaddleOCR failed to load on this machine")


def _known_gap(row: dict[str, str]) -> str:
    return (row.get("known_ocr_gap") or "").strip()


@pytest.mark.slow
@pytest.mark.skipif(not ROWS, reason="no label fixtures recorded")
@pytest.mark.parametrize("row", ROWS, ids=[r["filename"] for r in ROWS])
def test_real_photo_to_correct_date(paddle_available, row: dict[str, str]) -> None:
    """Photograph in, correct date out - through the real production pipeline:
    fast PaddleOCR, escalating to the accurate tier and then Vision exactly as
    /v1/scans does. A single-tier engine would understate what the fallback
    chain actually recovers.
    """
    from app.services.ocr import pipeline

    gap = _known_gap(row)

    image = (LABELS / row["filename"]).read_bytes()
    result = pipeline.run(image, today=TODAY)

    if gap:
        # Documented, not hidden: this exact real-world case is known to beat
        # the current OCR layer. xfail (not skip) so the moment OCR improves
        # enough to read it, the suite says so instead of staying silently
        # green forever.
        if result.parsed and result.parsed.best and result.parsed.best.value == date.fromisoformat(row["expected_date"]):
            pytest.fail(
                f"{row['filename']}: expected to still fail ({gap}), but OCR read it "
                f"correctly now - update known_ocr_gap in manifest.csv"
            )
        pytest.xfail(f"{row['filename']}: known OCR limitation - {gap}")

    assert result.ocr is not None and result.ocr.succeeded, (
        f"{row['filename']}: OCR failed - {result.ocr.error if result.ocr else 'no engine ran'}"
    )

    parsed = result.parsed
    expected = date.fromisoformat(row["expected_date"])

    assert parsed is not None and parsed.best is not None, (
        f"{row['filename']}: no date found in OCR text {result.text!r}"
    )
    assert parsed.best.value == expected, (
        f"{row['filename']}: OCR read {result.text!r} -> "
        f"{parsed.best.value}, expected {expected}"
    )

    if row["date_type"] == "manufacture":
        assert parsed.expiry_date is None
