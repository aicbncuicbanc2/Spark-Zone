"""Validates the label fixture manifest.

Runs every time you add a photo, so mistakes surface as you go instead of on the
day the parser gets built. Skips entirely while the manifest is still empty.

    pytest tests/test_label_fixtures.py -v
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

import pytest

LABELS_DIR = Path(__file__).parent / "fixtures" / "labels"
MANIFEST = LABELS_DIR / "manifest.csv"

VALID_DATE_TYPES = {"expiry", "best_before", "use_by", "manufacture", "pao"}
VALID_LANGUAGES = {"en", "ms", "zh", "ko", "ja", "mixed"}
VALID_CATEGORIES = {
    "medicine",
    "supplement",
    "skincare",
    "cosmetic",
    "food",
    "aerosol",
    "household",
}
VALID_DIFFICULTIES = {"easy", "medium", "hard"}

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def _rows() -> list[dict[str, str]]:
    if not MANIFEST.exists():
        return []
    with MANIFEST.open(newline="", encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if any(v.strip() for v in r.values())]


rows = _rows()

pytestmark = pytest.mark.skipif(
    not rows, reason="No label fixtures recorded yet — see fixtures/labels/README.md"
)


def test_every_manifest_row_has_its_image() -> None:
    missing = [r["filename"] for r in rows if not (LABELS_DIR / r["filename"]).is_file()]
    assert not missing, f"manifest lists files that do not exist: {missing}"


def test_every_image_is_in_the_manifest() -> None:
    """An unlisted photo is invisible to the parser suite, so catch it here."""
    listed = {r["filename"] for r in rows}
    on_disk = {p.name for p in LABELS_DIR.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES}
    unlisted = on_disk - listed
    assert not unlisted, f"images present but not in manifest.csv: {sorted(unlisted)}"


@pytest.mark.parametrize("row", rows, ids=[r["filename"] for r in rows])
def test_row_is_well_formed(row: dict[str, str]) -> None:
    assert row["date_text"].strip(), "date_text must quote the label verbatim"

    assert row["date_type"] in VALID_DATE_TYPES, f"bad date_type: {row['date_type']!r}"
    assert row["language"] in VALID_LANGUAGES, f"bad language: {row['language']!r}"
    assert row["category"] in VALID_CATEGORIES, f"bad category: {row['category']!r}"
    assert row["difficulty"] in VALID_DIFFICULTIES, f"bad difficulty: {row['difficulty']!r}"

    try:
        parsed = date.fromisoformat(row["expected_date"])
    except ValueError:
        pytest.fail(f"expected_date must be YYYY-MM-DD, got {row['expected_date']!r}")

    assert date(2000, 1, 1) <= parsed <= date(2040, 1, 1), (
        f"expected_date {parsed} is outside a plausible range — typo?"
    )


def test_fixture_set_is_varied_enough() -> None:
    """Twenty easy English labels would prove nothing. Warn once we have a set."""
    if len(rows) < 10:
        pytest.skip(f"only {len(rows)} fixtures so far; aiming for 15-20")

    languages = {r["language"] for r in rows}
    difficulties = {r["difficulty"] for r in rows}

    assert languages - {"en"}, "no non-English labels — Malay/Chinese handling is untested"
    assert "hard" in difficulties, "no hard fixtures — the parser is not being stressed"
