"""Interactive helper for recording label fixtures.

Finds photos in tests/fixtures/labels/ that are not yet in manifest.csv and
asks about each one, so nobody has to hand-edit a CSV.

    python scripts/add_labels.py

Ctrl-C at any point; everything answered so far is already saved.
"""

from __future__ import annotations

import csv
import sys
from datetime import date
from pathlib import Path

LABELS_DIR = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "labels"
MANIFEST = LABELS_DIR / "manifest.csv"

FIELDS = [
    "filename",
    "date_text",
    "date_type",
    "expected_date",
    "language",
    "category",
    "difficulty",
    "notes",
]

DATE_TYPES = ["expiry", "best_before", "use_by", "manufacture", "pao"]
LANGUAGES = ["en", "ms", "zh", "ko", "ja", "mixed"]
CATEGORIES = [
    "medicine",
    "supplement",
    "skincare",
    "cosmetic",
    "food",
    "aerosol",
    "household",
]
DIFFICULTIES = ["easy", "medium", "hard"]

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def existing_rows() -> list[dict[str, str]]:
    if not MANIFEST.exists():
        return []
    with MANIFEST.open(newline="", encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if any(v.strip() for v in r.values())]


def choose(label: str, options: list[str], default: str | None = None) -> str:
    print(f"\n  {label}")
    for i, option in enumerate(options, 1):
        marker = "  (default)" if option == default else ""
        print(f"    {i}. {option}{marker}")
    while True:
        raw = input("  > ").strip()
        if not raw and default:
            return default
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return options[int(raw) - 1]
        if raw in options:
            return raw
        print("  Pick a number from the list.")


def ask_date(label: str) -> str:
    """Accepts YYYY-MM-DD, or YYYY-MM meaning the last day of that month."""
    print(f"\n  {label}")
    print("    YYYY-MM-DD, or YYYY-MM for a month-only date (EXP 03/25 -> 2025-03)")
    while True:
        raw = input("  > ").strip()
        try:
            if len(raw) == 7:  # YYYY-MM
                year, month = (int(p) for p in raw.split("-"))
                nxt = date(year + (month == 12), (month % 12) + 1, 1)
                resolved = nxt.toordinal() - 1
                return date.fromordinal(resolved).isoformat()
            return date.fromisoformat(raw).isoformat()
        except (ValueError, TypeError):
            print("  Not a date I understand. Try 2026-11-30 or 2026-11.")


def ask_text(label: str, *, required: bool = True) -> str:
    print(f"\n  {label}")
    while True:
        raw = input("  > ").strip()
        if raw or not required:
            return raw
        print("  Required.")


def main() -> int:
    if not LABELS_DIR.exists():
        print(f"Missing folder: {LABELS_DIR}")
        return 1

    rows = existing_rows()
    recorded = {r["filename"] for r in rows}
    images = sorted(p for p in LABELS_DIR.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    pending = [p for p in images if p.name not in recorded]

    print(f"\n{len(images)} photo(s) found, {len(recorded)} already recorded.")

    if not pending:
        print("\nNothing new to record.")
        if not images:
            print(f"Drop some .jpg files into:\n  {LABELS_DIR}")
        return 0

    print(f"{len(pending)} to go. Ctrl-C to stop; answers are saved as you go.\n")

    write_header = not MANIFEST.exists() or not MANIFEST.read_text(encoding="utf-8").strip()

    with MANIFEST.open("a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        if write_header:
            writer.writeheader()

        for index, image in enumerate(pending, 1):
            print("=" * 62)
            print(f"[{index}/{len(pending)}]  {image.name}")
            print("=" * 62)
            print("  Open the photo and read the date off it.")

            try:
                row = {
                    "filename": image.name,
                    "date_text": ask_text("Date EXACTLY as printed (e.g. 'EXP 03/25')"),
                    "date_type": choose("What kind of date is it?", DATE_TYPES, "expiry"),
                    "expected_date": ask_date("The CORRECT date the parser must return"),
                    "language": choose("Language on the label", LANGUAGES, "en"),
                    "category": choose("Product category", CATEGORIES, "food"),
                    "difficulty": choose(
                        "How hard is it to read?", DIFFICULTIES, "medium"
                    ),
                    "notes": ask_text(
                        "Anything odd? (curved, embossed, faded, two dates) - Enter to skip",
                        required=False,
                    ),
                }
            except (KeyboardInterrupt, EOFError):
                print("\n\nStopped. Everything before this is saved.")
                return 0

            writer.writerow(row)
            fh.flush()
            print(f"\n  saved: {row['filename']} -> {row['expected_date']}\n")

    print("=" * 62)
    print("Done. Check it with:  pytest tests/test_label_fixtures.py -v")
    return 0


if __name__ == "__main__":
    sys.exit(main())
