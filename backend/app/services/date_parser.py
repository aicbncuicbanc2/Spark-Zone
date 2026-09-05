"""Turning OCR text into an expiry date.

This is the hard part of the project. OCR hands us a string; deciding what date
it contains — and whether it is even an expiry date — is where the work is.

Everything here was driven by real packaging in tests/fixtures/labels/. The
awkward cases are all real:

    EXP:210827 KJ234              six digits, no separators, batch code alongside
    M6EXPM 25 03 27  21:35        space-separated, machine code, and a TIME
    PRD DATE:23/06/2026           a second date that must NOT win
    EXP DATE:22/12/2027
    EXP 2028.06.02까지            Korean suffix meaning "until"
    MFG 05/26 10:39 041           manufacture only; no expiry exists at all

Three principles:

1. Never silently guess. An ambiguous read is reported as ambiguous so the app
   can ask the user, because a confidently wrong expiry date is worse than no
   date at all.
2. A manufacture date is never returned as an expiry. Doing so would tell
   someone their item expired months ago.
3. Times and batch codes are actively excluded. `18:22` and `10:39` both parse
   as plausible day/month pairs.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from enum import Enum

# --- Vocabulary ---------------------------------------------------------------


class DateType(str, Enum):
    EXPIRY = "expiry"
    BEST_BEFORE = "best_before"
    USE_BY = "use_by"
    MANUFACTURE = "manufacture"
    UNKNOWN = "unknown"


#: Which date types actually mean "unusable after this".
EXPIRY_LIKE = {DateType.EXPIRY, DateType.USE_BY, DateType.BEST_BEFORE}

#: Keyword -> meaning. Longest match wins, so multi-word phrases come first.
KEYWORDS: tuple[tuple[str, DateType], ...] = (
    # English
    ("BEST BEFORE END", DateType.BEST_BEFORE),
    ("BEST BEFORE", DateType.BEST_BEFORE),
    ("BEST BY", DateType.BEST_BEFORE),
    ("USE BY", DateType.USE_BY),
    ("USE BEFORE", DateType.USE_BY),
    ("CONSUME BEFORE", DateType.USE_BY),
    ("EXPIRY DATE", DateType.EXPIRY),
    ("EXPIRY", DateType.EXPIRY),
    ("EXPIRES", DateType.EXPIRY),
    ("EXP DATE", DateType.EXPIRY),
    ("EXP", DateType.EXPIRY),
    ("BBE", DateType.BEST_BEFORE),
    ("BB", DateType.BEST_BEFORE),
    ("ED", DateType.EXPIRY),
    # Manufacture - must be recognised so it is never mistaken for an expiry
    ("MANUFACTURED ON", DateType.MANUFACTURE),
    ("MANUFACTURING DATE", DateType.MANUFACTURE),
    ("DATE OF MANUFACTURE", DateType.MANUFACTURE),
    ("PRODUCTION DATE", DateType.MANUFACTURE),
    ("PRD DATE", DateType.MANUFACTURE),
    ("PROD DATE", DateType.MANUFACTURE),
    ("MFG DATE", DateType.MANUFACTURE),
    ("MFG", DateType.MANUFACTURE),
    ("MFD", DateType.MANUFACTURE),
    ("PRD", DateType.MANUFACTURE),
    ("PKD", DateType.MANUFACTURE),
    # Malay
    ("TAMAT TEMPOH", DateType.EXPIRY),
    ("TARIKH LUPUT", DateType.EXPIRY),
    ("LUPUT", DateType.EXPIRY),
    ("BAIK SEBELUM", DateType.BEST_BEFORE),
    ("ELOK SEBELUM", DateType.BEST_BEFORE),
    ("DIPERBUAT PADA", DateType.MANUFACTURE),
    ("TARIKH PENGELUARAN", DateType.MANUFACTURE),
    # Chinese
    ("保质期", DateType.EXPIRY),
    ("有效期至", DateType.EXPIRY),
    ("有效期", DateType.EXPIRY),
    ("生产日期", DateType.MANUFACTURE),
    # Korean / Japanese
    ("유통기한", DateType.EXPIRY),
    ("賞味期限", DateType.BEST_BEFORE),
    ("消費期限", DateType.USE_BY),
)

MONTHS: dict[str, int] = {
    # English
    "JAN": 1, "JANUARY": 1, "FEB": 2, "FEBRUARY": 2, "MAR": 3, "MARCH": 3,
    "APR": 4, "APRIL": 4, "MAY": 5, "JUN": 6, "JUNE": 6, "JUL": 7, "JULY": 7,
    "AUG": 8, "AUGUST": 8, "SEP": 9, "SEPT": 9, "SEPTEMBER": 9,
    "OCT": 10, "OCTOBER": 10, "NOV": 11, "NOVEMBER": 11, "DEC": 12, "DECEMBER": 12,
    # Malay - MAC, MEI, OGOS, OKT and DIS differ from English and are easy to miss
    "MAC": 3, "MEI": 5, "OGO": 8, "OGOS": 8, "OKT": 10, "DIS": 12,
    "JANUARI": 1, "FEBRUARI": 2, "JULAI": 7, "OKTOBER": 10, "DISEMBER": 12,
}

#: Trailing markers that are not part of the date. The Korean 까지 ("until")
#: appears immediately after the digits with no space.
TRAILING_NOISE = ("까지", "まで", "前", "迄")

#: Words that mark a nearby number as a batch/lot code rather than a date.
BATCH_MARKERS = ("LOT", "BATCH", "NO.", "BN", "L/N", "CODE")

# --- Patterns -----------------------------------------------------------------

_TIME = re.compile(r"\b\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?\b")
_YMD = re.compile(r"\b(\d{4})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{1,2})\b")
_DMY = re.compile(r"\b(\d{1,2})\s?[./\-\s]\s?(\d{1,2})\s?[./\-\s]\s?(\d{2,4})\b")
#: Built from the month table so only real month words can match. With a bare
#: [A-Z]{3,9} the phrase "BEST BEFORE 25 MAR 2027" matches "BEFORE 25" first,
#: swallowing the day and leaving "MAR 2027" to resolve to the 31st.
_MONTH_ALTERNATION = "|".join(sorted(MONTHS, key=len, reverse=True))
_TEXT_MONTH = re.compile(
    r"\b(\d{1,2})?\s*(" + _MONTH_ALTERNATION + r")\s*[.\-/ ]?\s*(\d{2,4})\b"
)
_MONTH_YEAR = re.compile(r"\b(\d{1,2})\s*[./\-]\s*(\d{4}|\d{2})\b")
_SIX = re.compile(r"\b(\d{6})\b")
_EIGHT = re.compile(r"\b(\d{8})\b")

#: Two-digit years at or below this map to 20xx; above it, to 19xx.
_CENTURY_PIVOT = 79


@dataclass(frozen=True)
class DateCandidate:
    value: date
    date_type: DateType
    confidence: float
    raw: str
    start: int
    end: int
    notes: tuple[str, ...] = ()

    @property
    def is_expiry_like(self) -> bool:
        return self.date_type in EXPIRY_LIKE


@dataclass
class ParseResult:
    """What the scan endpoint reports back."""

    best: DateCandidate | None = None
    candidates: list[DateCandidate] = field(default_factory=list)
    needs_review: bool = False
    review_reason: str | None = None

    @property
    def expiry_date(self) -> date | None:
        """Only ever an expiry-like date. A manufacture date returns None."""
        if self.best and self.best.is_expiry_like:
            return self.best.value
        return None

    @property
    def confidence(self) -> float:
        return self.best.confidence if self.best else 0.0


# --- Helpers ------------------------------------------------------------------


def _expand_year(value: int) -> int:
    if value >= 1000:
        return value
    return 2000 + value if value <= _CENTURY_PIVOT else 1900 + value


def _last_day(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def normalise(text: str) -> str:
    """Uppercase, tidy separators, and strip trailing-marker noise."""
    cleaned = text.upper()
    for marker in TRAILING_NOISE:
        cleaned = cleaned.replace(marker.upper(), " ")
    cleaned = cleaned.replace("：", ":")
    return re.sub(r"[ \t]+", " ", cleaned)


#: Stands in for a removed time. Deliberately not whitespace: blanking a time
#: with spaces lets a date pattern reach straight across the gap, so
#: "MFG 05/26 10:39 041" collapses to "05/26     041" and parses as 2041-05-26.
TIME_SENTINEL = "\0"


def mask_times(text: str) -> str:
    """Replace clock times with a sentinel, preserving offsets.

    `18:22`, `21:35` and `10:39` all read as plausible day/month pairs. Without
    this they silently become dates.
    """
    return _TIME.sub(lambda m: TIME_SENTINEL * len(m.group(0)), text)


def _near_batch_marker(text: str, start: int, window: int = 12) -> bool:
    prefix = text[max(0, start - window) : start]
    return any(marker in prefix for marker in BATCH_MARKERS)


#: Separators that may sit between a keyword and its date.
_STRICT_GAP = re.compile(r"[\s:.\-/#]*")
#: Real labels interleave machine codes, e.g. "M6EXPM 25 03 27" - the trailing
#: "M" belongs to the printer code, not to the word EXP. Tolerate a short run.
_LOOSE_GAP = re.compile(r"[\s:.\-/#]*[A-Z0-9]{0,3}[\s:.\-/#]*")


def _label_before(
    text: str, position: int, window: int = 28
) -> tuple[DateType, int, bool] | None:
    """The nearest keyword preceding `position`, if any.

    Returns (meaning, distance, strict). `strict` is False when a short machine
    code had to be stepped over, which lowers the confidence we report.
    """
    prefix = text[max(0, position - window) : position]
    best: tuple[DateType, int, bool] | None = None

    for word, kind in KEYWORDS:
        index = prefix.rfind(word)
        if index == -1:
            continue
        distance = len(prefix) - index - len(word)
        between = prefix[index + len(word) :]

        if _STRICT_GAP.fullmatch(between):
            strict = True
        elif _LOOSE_GAP.fullmatch(between):
            strict = False
        else:
            continue

        # Prefer a strict match, then a closer one.
        if best is None or (strict, -distance) > (best[2], -best[1]):
            best = (kind, distance, strict)
    return best


# --- Extraction ---------------------------------------------------------------


def _extract(text: str) -> list[DateCandidate]:
    found: list[DateCandidate] = []
    consumed: list[tuple[int, int]] = []

    def overlaps(start: int, end: int) -> bool:
        return any(start < e and end > s for s, e in consumed)

    def add(
        value: date | None,
        raw: str,
        start: int,
        end: int,
        base_confidence: float,
        notes: tuple[str, ...] = (),
    ) -> None:
        if value is None or overlaps(start, end):
            return
        label = _label_before(text, start)
        kind = label[0] if label else DateType.UNKNOWN
        if label is None:
            confidence = base_confidence
            notes = (*notes, "no keyword found near this date")
        elif label[2]:
            confidence = base_confidence + 0.15
        else:
            confidence = base_confidence + 0.08
            notes = (*notes, "keyword found, but a machine code sits between it and the date")
        consumed.append((start, end))
        found.append(
            DateCandidate(
                value=value,
                date_type=kind,
                confidence=min(confidence, 0.99),
                raw=raw,
                start=start,
                end=end,
                notes=notes,
            )
        )

    # 1. YYYY-MM-DD - unambiguous, so it goes first and claims its span.
    for match in _YMD.finditer(text):
        year, month, day = (int(g) for g in match.groups())
        add(_safe_date(year, month, day), match.group(0), *match.span(), 0.80)

    # 2. YYYYMMDD / DDMMYYYY, eight digits.
    for match in _EIGHT.finditer(text):
        digits = match.group(1)
        if _near_batch_marker(text, match.start()):
            continue
        as_ymd = _safe_date(int(digits[:4]), int(digits[4:6]), int(digits[6:]))
        as_dmy = _safe_date(int(digits[4:]), int(digits[2:4]), int(digits[:2]))
        if as_ymd and 2000 <= as_ymd.year <= 2049:
            add(as_ymd, match.group(0), *match.span(), 0.70, ("read as YYYYMMDD",))
        elif as_dmy:
            add(as_dmy, match.group(0), *match.span(), 0.60, ("read as DDMMYYYY",))

    # 3. Textual month, e.g. 25 MAR 2026 or MAC 2026.
    for match in _TEXT_MONTH.finditer(text):
        day_raw, word, year_raw = match.groups()
        month = MONTHS.get(word)
        if month is None:
            continue
        year = _expand_year(int(year_raw))
        if day_raw:
            add(_safe_date(year, month, int(day_raw)), match.group(0), *match.span(), 0.80)
        else:
            add(
                _safe_date(year, month, _last_day(year, month)),
                match.group(0),
                *match.span(),
                0.70,
                ("month and year only; resolved to last day of month",),
            )

    # 4. DD/MM/YY(YY) - the dominant Malaysian convention.
    for match in _DMY.finditer(text):
        first, second, year_raw = (int(g) for g in match.groups())
        year = _expand_year(year_raw)
        notes: tuple[str, ...] = ()
        day, month = first, second
        if first > 12 and second <= 12:
            pass  # unambiguous: first must be the day
        elif second > 12 and first <= 12:
            day, month = second, first
            notes = ("read as MM/DD; the second field exceeds 12",)
        elif first <= 12 and second <= 12:
            notes = ("day and month both <= 12; assumed DD/MM",)
        add(_safe_date(year, month, day), match.group(0), *match.span(), 0.75, notes)

    # 5. Six digits, no separators. Genuinely ambiguous - both readings occur.
    for match in _SIX.finditer(text):
        digits = match.group(1)
        if _near_batch_marker(text, match.start()):
            continue
        ddmmyy = _safe_date(
            _expand_year(int(digits[4:])), int(digits[2:4]), int(digits[:2])
        )
        yymmdd = _safe_date(
            _expand_year(int(digits[:2])), int(digits[2:4]), int(digits[4:])
        )
        if ddmmyy and yymmdd and ddmmyy != yymmdd:
            add(
                ddmmyy,
                match.group(0),
                *match.span(),
                0.45,
                (
                    "six digits with no separator: ambiguous",
                    f"read as DDMMYY -> {ddmmyy.isoformat()}",
                    f"could also be YYMMDD -> {yymmdd.isoformat()}",
                ),
            )
        else:
            add(ddmmyy or yymmdd, match.group(0), *match.span(), 0.55)

    # 6. MM/YY or MM/YYYY, last so it cannot steal digits from a fuller date.
    for match in _MONTH_YEAR.finditer(text):
        month, year_raw = (int(g) for g in match.groups())
        if not 1 <= month <= 12:
            continue
        year = _expand_year(year_raw)
        label = _label_before(text, match.start())
        is_manufacture = label is not None and label[0] is DateType.MANUFACTURE
        # A month-only EXPIRY runs to the end of the month; a month-only
        # MANUFACTURE is taken as the first, so anything derived from it lands
        # earlier and errs toward warning the user sooner.
        day = 1 if is_manufacture else _last_day(year, month)
        add(
            _safe_date(year, month, day),
            match.group(0),
            *match.span(),
            0.60,
            (
                "month and year only; resolved to "
                + ("first" if is_manufacture else "last")
                + " day of month",
            ),
        )

    return sorted(found, key=lambda c: c.start)


# --- Selection ----------------------------------------------------------------


def _score(candidate: DateCandidate, today: date) -> float:
    """Rank candidates. Higher wins."""
    score = candidate.confidence

    if candidate.date_type in EXPIRY_LIKE:
        score += 0.40
    elif candidate.date_type is DateType.MANUFACTURE:
        score -= 0.50  # never outrank a real expiry
    if candidate.value >= today:
        score += 0.15  # an expiry in the future is the common case
    elif candidate.value < today.replace(year=today.year - 10):
        score -= 0.30  # implausibly old; probably a misread
    return score


def parse(text: str, *, today: date | None = None) -> ParseResult:
    """Extract the most likely expiry date from OCR output."""
    if not text or not text.strip():
        return ParseResult(needs_review=True, review_reason="No text was recognised.")

    # Callers pass the user's local date; UTC is only a safety net.
    today = today or datetime.now(timezone.utc).date()
    prepared = mask_times(normalise(text))
    candidates = _extract(prepared)

    if not candidates:
        return ParseResult(
            candidates=[],
            needs_review=True,
            review_reason="No date could be found in the label text.",
        )

    best = max(candidates, key=lambda c: _score(c, today))
    result = ParseResult(best=best, candidates=candidates)

    # Manufacture-only: report it, but never as an expiry.
    if not best.is_expiry_like:
        result.needs_review = True
        if best.date_type is DateType.MANUFACTURE:
            result.review_reason = (
                "Only a manufacture date was found, not an expiry date. "
                "Please enter the expiry date."
            )
        else:
            result.review_reason = (
                "A date was found but it is not labelled as an expiry date. "
                "Please confirm it."
            )
        return result

    if any("ambiguous" in note for note in best.notes):
        result.needs_review = True
        result.review_reason = (
            "This date could be read more than one way. Please confirm it."
        )
    elif best.confidence < 0.65:
        result.needs_review = True
        result.review_reason = "The date was read with low confidence. Please confirm it."

    return result
