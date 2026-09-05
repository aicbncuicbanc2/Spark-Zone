"""Date parser tests.

Two layers:

  * Unit tests for each format and each distractor.
  * A data-driven pass over tests/fixtures/labels/manifest.csv, so every real
    photograph you add becomes a test automatically.

No OCR is involved. The manifest records what is printed on each label, which
is exactly the parser's input, so this suite runs long before PaddleOCR exists.
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

import pytest

from app.services.date_parser import DateType, parse

TODAY = date(2026, 9, 5)
MANIFEST = Path(__file__).parent / "fixtures" / "labels" / "manifest.csv"


# --- Formats ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("EXP DATE:22/12/2027", date(2027, 12, 22)),
        ("EXP 22-12-2027", date(2027, 12, 22)),
        ("EXP 2028.06.02", date(2028, 6, 2)),
        ("EXP 2028-06-02", date(2028, 6, 2)),
        ("BEST BEFORE 25 MAR 2027", date(2027, 3, 25)),
        ("EXP 25 03 27", date(2027, 3, 25)),
        ("EXP 25/03/27", date(2027, 3, 25)),
        ("USE BY 01/01/2028", date(2028, 1, 1)),
        ("EXP 20271222", date(2027, 12, 22)),
    ],
)
def test_common_formats(text: str, expected: date) -> None:
    assert parse(text, today=TODAY).expiry_date == expected


def test_malay_month_abbreviations() -> None:
    """MAC, MEI, OGOS, OKT and DIS differ from English and are easy to miss."""
    assert parse("TAMAT TEMPOH 25 MAC 2027", today=TODAY).expiry_date == date(2027, 3, 25)
    assert parse("BAIK SEBELUM 10 DIS 2027", today=TODAY).expiry_date == date(2027, 12, 10)
    assert parse("EXP 03 OGOS 2027", today=TODAY).expiry_date == date(2027, 8, 3)


def test_month_only_expiry_runs_to_end_of_month() -> None:
    assert parse("EXP 03/25", today=TODAY).expiry_date == date(2025, 3, 31)
    assert parse("BEST BEFORE 11/2026", today=TODAY).expiry_date == date(2026, 11, 30)


def test_korean_until_suffix_is_stripped() -> None:
    result = parse("EXP 2028.06.02까지", today=TODAY)
    assert result.expiry_date == date(2028, 6, 2)


# --- Distractors --------------------------------------------------------------


def test_times_are_not_parsed_as_dates() -> None:
    """18:22, 21:35 and 10:39 all look like plausible day/month pairs."""
    result = parse("EXP DATE:22/12/2027\n18:22", today=TODAY)
    assert result.expiry_date == date(2027, 12, 22)
    assert all(c.value != date(2022, 6, 18) for c in result.candidates)


def test_time_alone_yields_no_date() -> None:
    assert parse("21:35", today=TODAY).expiry_date is None


def test_batch_codes_are_ignored() -> None:
    result = parse("LOT.5F0301 EXP 2028.06.02", today=TODAY)
    assert result.expiry_date == date(2028, 6, 2)


def test_lot_number_alone_is_not_a_date() -> None:
    assert parse("LOT 250301", today=TODAY).expiry_date is None


def test_machine_codes_do_not_break_parsing() -> None:
    result = parse("M6EXPM 25 03 27 21:35", today=TODAY)
    assert result.expiry_date == date(2027, 3, 25)


# --- Choosing between several dates -------------------------------------------


def test_expiry_wins_over_production_date() -> None:
    """Real label: picking the wrong line gives an expiry 18 months early."""
    text = "PRD DATE:23/06/2026\nEXP DATE:22/12/2027\n42601965-2306AP6B\n18:22"
    result = parse(text, today=TODAY)
    assert result.expiry_date == date(2027, 12, 22)
    assert result.best is not None
    assert result.best.date_type is DateType.EXPIRY


def test_manufacture_only_is_never_returned_as_an_expiry() -> None:
    """The bug this prevents: telling someone their item expired in May 2026."""
    result = parse("MFG 05/26 10:39 041", today=TODAY)
    assert result.expiry_date is None
    assert result.best is not None
    assert result.best.date_type is DateType.MANUFACTURE
    assert result.needs_review
    assert "manufacture" in (result.review_reason or "").lower()


def test_month_only_manufacture_resolves_to_first_of_month() -> None:
    result = parse("MFG 05/26", today=TODAY)
    assert result.best is not None
    assert result.best.value == date(2026, 5, 1)


def test_masked_time_does_not_let_a_date_span_the_gap() -> None:
    """Regression: 'MFG 05/26 10:39 041' once parsed as 2041-05-26.

    Blanking the time with spaces left 'MFG 05/26     041', which the DD/MM/YY
    pattern read straight across as 05/26/041. Times are now replaced with a
    sentinel that patterns cannot cross.
    """
    result = parse("MFG 05/26 10:39 041", today=TODAY)
    assert result.best is not None
    assert result.best.value == date(2026, 5, 1)
    assert result.best.value.year != 2041


def test_trailing_line_code_is_not_absorbed_as_a_year() -> None:
    result = parse("EXP 22/12/2027 18:22 041", today=TODAY)
    assert result.expiry_date == date(2027, 12, 22)


# --- Ambiguity ----------------------------------------------------------------


def test_six_digit_date_is_flagged_ambiguous() -> None:
    """210827 is DDMMYY or YYMMDD. Both occur; guessing silently is unacceptable."""
    result = parse("EXP:210827 KJ234", today=TODAY)
    assert result.expiry_date == date(2027, 8, 21)
    assert result.needs_review
    assert result.best is not None
    assert any("ambiguous" in note for note in result.best.notes)
    assert any("YYMMDD" in note for note in result.best.notes)


def test_ambiguity_is_reported_ahead_of_low_confidence() -> None:
    """Ambiguity tells the user what to check; "low confidence" does not."""
    result = parse("EXP:210827 KJ234", today=TODAY)
    assert result.review_reason is not None
    assert "more than one way" in result.review_reason


def test_unambiguous_date_is_not_flagged() -> None:
    result = parse("EXP DATE:22/12/2027", today=TODAY)
    assert not result.needs_review
    assert result.confidence >= 0.65


def test_day_over_twelve_disambiguates_without_a_flag() -> None:
    result = parse("EXP 25/03/2027", today=TODAY)
    assert result.expiry_date == date(2027, 3, 25)
    assert result.best is not None
    assert not any("assumed" in n for n in result.best.notes)


# --- Failure modes ------------------------------------------------------------


@pytest.mark.parametrize("text", ["", "   ", "NO DATE HERE", "NET WT 250g"])
def test_no_date_asks_for_review(text: str) -> None:
    result = parse(text, today=TODAY)
    assert result.expiry_date is None
    assert result.needs_review
    assert result.review_reason


def test_unlabelled_date_is_returned_but_flagged() -> None:
    """A bare date with no keyword is usable, but the user should confirm it."""
    result = parse("22/12/2027", today=TODAY)
    assert result.needs_review
    assert result.best is not None
    assert result.best.value == date(2027, 12, 22)


# --- Driven by the real fixtures ----------------------------------------------


def _manifest_rows() -> list[dict[str, str]]:
    if not MANIFEST.exists():
        return []
    with MANIFEST.open(newline="", encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if any(v.strip() for v in r.values())]


ROWS = _manifest_rows()


@pytest.mark.skipif(not ROWS, reason="no label fixtures recorded yet")
@pytest.mark.parametrize("row", ROWS, ids=[r["filename"] for r in ROWS])
def test_real_label_text_parses_to_the_recorded_date(row: dict[str, str]) -> None:
    """Every photograph in the manifest is a test case, automatically."""
    result = parse(row["date_text"], today=TODAY)
    expected = date.fromisoformat(row["expected_date"])

    assert result.best is not None, (
        f"{row['filename']}: found no date in {row['date_text']!r}"
    )
    assert result.best.value == expected, (
        f"{row['filename']}: {row['date_text']!r} -> "
        f"{result.best.value} but should be {expected}"
    )

    if row["date_type"] == "manufacture":
        assert result.expiry_date is None, (
            f"{row['filename']}: a manufacture date must never be reported as expiry"
        )
    else:
        assert result.expiry_date == expected


@pytest.mark.skipif(not ROWS, reason="no label fixtures recorded yet")
def test_accuracy_across_the_fixture_set() -> None:
    """The number worth quoting: how many real labels parse correctly."""
    correct = 0
    failures: list[str] = []
    for row in ROWS:
        result = parse(row["date_text"], today=TODAY)
        expected = date.fromisoformat(row["expected_date"])
        if result.best and result.best.value == expected:
            correct += 1
        else:
            got = result.best.value if result.best else None
            failures.append(f"{row['filename']}: got {got}, wanted {expected}")

    print(f"\nreal-label accuracy: {correct}/{len(ROWS)}")
    assert correct == len(ROWS), "failures:\n  " + "\n  ".join(failures)
