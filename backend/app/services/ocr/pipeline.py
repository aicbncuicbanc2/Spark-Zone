"""Primary engine, then fallback.

PaddleOCR runs first. If it fails outright, reads with low confidence, or
produces text the parser cannot find a date in, Google Vision gets a turn — and
the better of the two results wins.

`attempts` records every engine tried and what it produced. That is the audit
trail behind the scans table, and it is what lets you show that the fallback
genuinely fired rather than claiming it does.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

from app.config import get_settings
from app.services.date_parser import DateType, ParseResult, parse
from app.services.ocr.base import OcrBackend, OcrEngine, OcrResult
from app.services.ocr.paddle_engine import ACCURATE, FAST, PaddleEngine
from app.services.ocr.vision_engine import VisionEngine

logger = logging.getLogger(__name__)


@dataclass
class Attempt:
    engine: OcrEngine
    succeeded: bool
    ocr_confidence: float
    date_found: bool
    duration_ms: int
    error: str | None = None
    #: Which PaddleOCR tier ran, "fast" or "accurate". None for Vision.
    variant: str | None = None

    def as_dict(self) -> dict:
        return {
            "engine": self.engine.value,
            "variant": self.variant,
            "succeeded": self.succeeded,
            "ocr_confidence": round(self.ocr_confidence, 3),
            "date_found": self.date_found,
            "duration_ms": self.duration_ms,
            "error": self.error,
        }


@dataclass
class PipelineResult:
    ocr: OcrResult | None = None
    parsed: ParseResult | None = None
    attempts: list[Attempt] = field(default_factory=list)

    @property
    def engine_used(self) -> OcrEngine | None:
        return self.ocr.engine if self.ocr else None

    @property
    def text(self) -> str:
        return self.ocr.text if self.ocr else ""

    @property
    def fell_back(self) -> bool:
        return len(self.attempts) > 1


def _engines() -> list[OcrBackend]:
    """The escalation chain, cheapest first - "cheapest" now means something
    different in production than it did when this was first measured.

    On a local dev machine, PaddleOCR's fast tier reads 4/5 real fixtures in
    about 3.5s with oneDNN acceleration enabled - genuinely comparable to
    Vision's own ~1-2s cloud call, which is why PaddleOCR stayed the default
    primary engine (`ocr_primary_engine` defaults to "paddleocr").

    On Cloud Run, that assumption breaks: oneDNN has to be disabled there to
    avoid a real crash (see paddle_engine.py), and the fast tier's actual
    measured cost jumped to 15-30s - 8-15x slower than Vision's ~1-2s, which
    is unaffected. `deploy.ps1` sets OCR_PRIMARY_ENGINE=google_vision
    specifically for that reason: a scan that used to take ~20-70s (one or
    more Paddle tiers before ever reaching Vision) now resolves in a few
    seconds whenever Vision alone is confident enough. Verified this
    reordering costs nothing in accuracy: rerunning all 7 real label fixtures
    with Vision primary still passes 6/7 (the same known embossed-date
    limitation still xfails) - identical to PaddleOCR-primary, because
    _good_enough / _quality below always pick the best-scoring result across
    every engine actually tried, not just whichever ran first. An engine
    trying (and failing) earlier never costs accuracy, only time - which is
    exactly why putting the fast, free-tier-friendly cloud call first on
    Cloud Run specifically is a pure win there, while local dev keeps
    PaddleOCR first since it has no reason to pay for a cloud call it
    doesn't need.
    """
    settings = get_settings()
    if settings.ocr_primary_engine == "google_vision":
        return [VisionEngine(), PaddleEngine(FAST), PaddleEngine(ACCURATE)]
    return [PaddleEngine(FAST), VisionEngine(), PaddleEngine(ACCURATE)]


def _good_enough(ocr: OcrResult, parsed: ParseResult, threshold: float) -> bool:
    """Is this result strong enough not to bother the fallback?"""
    return (
        ocr.succeeded
        and parsed.best is not None
        and ocr.confidence >= threshold
        and parsed.confidence >= threshold
    )


def _no_expiry_keyword_present(ocr: OcrResult, parsed: ParseResult, threshold: float) -> bool:
    """Did a confident, complete read find date-like numbers with no EXP/
    expiry keyword anywhere near any of them?

    Real case that motivated this: a dishwashing-liquid bottle's only
    printed code was a manufacture batch stamp ("120726 2335 15:54"), no
    "EXP" anywhere on the label. All three engines read it fine (0.93-0.96
    confidence) and all three correctly found nothing - `date_type` is only
    ever UNKNOWN when no keyword was found nearby. Escalating to a different
    engine cannot make a keyword exist that the product simply never
    printed, so once a read is confident enough to trust as complete, that
    escalation only spends time (measured: 93s more, for the same answer)
    for no chance of a different result.

    This does NOT weaken the ambiguous-date protection - an ambiguous
    six-digit date next to a real "EXP" keyword still gets `date_type:
    expiry` (just at capped confidence), so it never matches this check
    and still escalates as before.
    """
    return (
        ocr.succeeded
        and ocr.confidence >= threshold
        and parsed.best is not None
        and parsed.best.date_type is DateType.UNKNOWN
    )


def _quality(ocr: OcrResult, parsed: ParseResult) -> tuple[int, float, float]:
    """Sort key for picking between two engines' results. Higher is better."""
    return (
        1 if parsed.best is not None else 0,
        parsed.confidence,
        ocr.confidence,
    )


def run(image: bytes, *, today: date | None = None, force: OcrEngine | None = None) -> PipelineResult:
    """Read an image and extract a date, escalating to the fallback if needed."""
    settings = get_settings()
    threshold = settings.ocr_confidence_threshold

    engines = _engines()
    if force is not None:
        engines = [e for e in engines if e.name is force] or engines[:1]

    result = PipelineResult()
    best: tuple[tuple[int, float, float], OcrResult, ParseResult] | None = None

    for engine in engines:
        if not engine.is_available():
            result.attempts.append(
                Attempt(
                    engine=engine.name,
                    variant=getattr(engine, "variant", None),
                    succeeded=False,
                    ocr_confidence=0.0,
                    date_found=False,
                    duration_ms=0,
                    error="engine unavailable",
                )
            )
            continue

        ocr = engine.read(image)
        parsed = parse(ocr.text, today=today)

        result.attempts.append(
            Attempt(
                engine=engine.name,
                variant=getattr(engine, "variant", None),
                succeeded=ocr.succeeded,
                ocr_confidence=ocr.confidence,
                date_found=parsed.best is not None,
                duration_ms=ocr.duration_ms,
                error=ocr.error,
            )
        )

        score = _quality(ocr, parsed)
        if best is None or score > best[0]:
            best = (score, ocr, parsed)

        if _good_enough(ocr, parsed, threshold):
            break  # no reason to spend the fallback

        if _no_expiry_keyword_present(ocr, parsed, threshold):
            break  # a different engine cannot make a keyword exist that isn't printed

        logger.info(
            "ocr_escalating",
            extra={
                "engine": engine.name.value,
                "ocr_confidence": round(ocr.confidence, 3),
                "date_found": parsed.best is not None,
            },
        )

    if best is not None:
        _, result.ocr, result.parsed = best
    return result
