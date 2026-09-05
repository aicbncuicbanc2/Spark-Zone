"""Scan request/response models.

The response is shaped as though scanning were asynchronous even though it runs
inline today: it always carries `scan_id` and `status`. If OCR ever has to move
to a background job, the app switches to polling GET /v1/scans/{id} and this
contract does not change.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict


class ScanStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    #: A date was read, but the user should confirm it before it becomes an item.
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"


class OcrEngineName(str, Enum):
    PADDLEOCR = "paddleocr"
    GOOGLE_VISION = "google_vision"


class DateTypeName(str, Enum):
    EXPIRY = "expiry"
    BEST_BEFORE = "best_before"
    USE_BY = "use_by"
    MANUFACTURE = "manufacture"
    UNKNOWN = "unknown"


class DateCandidateOut(BaseModel):
    """An alternative reading, so the app can offer a choice rather than a guess."""

    value: date
    date_type: DateTypeName
    confidence: float
    raw: str
    notes: list[str] = []


class SuggestedItem(BaseModel):
    """Prefill for the add-item form. Never saved without the user confirming."""

    name: str | None = None
    brand: str | None = None
    category_id: str | None = None
    expiry_date: date | None = None
    pao_months: int | None = None


class ScanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    scan_id: str
    status: ScanStatus

    image_url: str | None = None

    extracted_expiry_date: date | None = None
    date_confidence: float | None = None
    date_type: DateTypeName | None = None

    detected_barcode: str | None = None

    engine_used: OcrEngineName | None = None
    engines_attempted: list[dict] = []
    raw_text: str | None = None
    ocr_confidence: float | None = None

    #: Set whenever the user must confirm or supply the date themselves.
    needs_review: bool = False
    review_reason: str | None = None

    #: Other plausible readings, best first. Populated for ambiguous dates.
    alternatives: list[DateCandidateOut] = []

    suggested_item: SuggestedItem | None = None

    error_code: str | None = None
    error_detail: str | None = None
    processing_ms: int | None = None
    created_at: datetime | None = None
