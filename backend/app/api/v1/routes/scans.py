"""Label scanning: photo in, expiry date out."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, File, Query, Response, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.core.errors import BadRequestError, PayloadTooLargeError
from app.db.repositories import profiles as profiles_repo
from app.db.repositories import scans as scans_repo
from app.deps import CurrentUserDep, UserDbDep
from app.schemas.scan import (
    DateCandidateOut,
    OcrEngineName,
    ScanOut,
    ScanStatus,
    SuggestedItem,
)
from app.services import storage
from app.services.ocr import pipeline
from app.services.ocr.base import OcrEngine
from app.services.priority import today_for_user

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"}


async def _read_upload(image: UploadFile) -> bytes:
    settings = get_settings()

    if image.content_type and image.content_type.lower() not in ALLOWED_TYPES:
        raise BadRequestError(
            f"Unsupported image type: {image.content_type}. Send JPEG, PNG or WebP.",
            code="UNSUPPORTED_IMAGE_TYPE",
        )

    data = await image.read()
    if not data:
        raise BadRequestError("The uploaded file was empty.", code="EMPTY_UPLOAD")
    if len(data) > settings.ocr_max_image_bytes:
        raise PayloadTooLargeError(
            f"Image is {len(data) // 1024} KB; the limit is "
            f"{settings.ocr_max_image_bytes // 1024} KB.",
            details={"bytes": len(data), "limit": settings.ocr_max_image_bytes},
        )
    return data


def _to_response(row: dict, result: pipeline.PipelineResult | None) -> ScanOut:
    """Shape a stored scan row, plus its in-memory result, for the app."""
    alternatives: list[DateCandidateOut] = []
    review_reason: str | None = None
    needs_review = row["status"] == ScanStatus.NEEDS_REVIEW.value
    date_type = None

    if result and result.parsed:
        parsed = result.parsed
        review_reason = parsed.review_reason
        needs_review = parsed.needs_review
        if parsed.best:
            date_type = parsed.best.date_type.value
        # Only worth showing alternatives when there is a real choice to make.
        if parsed.needs_review and len(parsed.candidates) > 1:
            alternatives = [
                DateCandidateOut(
                    value=c.value,
                    date_type=c.date_type.value,
                    confidence=round(c.confidence, 3),
                    raw=c.raw,
                    notes=list(c.notes),
                )
                for c in sorted(parsed.candidates, key=lambda c: -c.confidence)[:4]
            ]

    suggested = SuggestedItem(expiry_date=row.get("extracted_expiry_date"))

    return ScanOut(
        scan_id=row["id"],
        status=ScanStatus(row["status"]),
        image_url=row.get("image_url"),
        extracted_expiry_date=row.get("extracted_expiry_date"),
        date_confidence=row.get("date_confidence"),
        date_type=date_type,
        detected_barcode=row.get("detected_barcode"),
        engine_used=(
            OcrEngineName(row["engine_used"]) if row.get("engine_used") else None
        ),
        engines_attempted=row.get("engines_attempted") or [],
        raw_text=row.get("raw_text"),
        ocr_confidence=row.get("ocr_confidence"),
        needs_review=needs_review,
        review_reason=review_reason,
        alternatives=alternatives,
        suggested_item=suggested,
        error_code=row.get("error_code"),
        error_detail=row.get("error_detail"),
        processing_ms=row.get("processing_ms"),
        created_at=row.get("created_at"),
    )


@router.post(
    "",
    response_model=ScanOut,
    status_code=status.HTTP_201_CREATED,
    summary="Scan a product label",
)
async def create_scan(
    user: CurrentUserDep,
    db: UserDbDep,
    image: Annotated[UploadFile, File(description="Photo of the label")],
) -> ScanOut:
    """Upload a label photo, run OCR, and extract the expiry date.

    Synchronous today, but the response is shaped as if it were not: it always
    carries `scan_id` and `status`, so moving OCR to a background job later
    means the app polls GET /v1/scans/{id} and nothing else changes.

    Always let the user confirm the date before saving it as an item. Check
    `needs_review` — it is set for ambiguous reads and for packs that only print
    a manufacture date.
    """
    started = time.perf_counter()
    data = await _read_upload(image)

    # Storing the photo is best-effort. Losing it is a small loss; losing the
    # scan because it could not be filed is a large one.
    stored = await run_in_threadpool(storage.upload_scan_image, data, user_id=user.id)
    if stored.error and storage.is_configured():
        logger.warning("scan_image_not_stored", extra={"reason": stored.error})

    today = today_for_user(profiles_repo.get_timezone(db, user.id))
    # OCR is CPU-bound and takes seconds. Run it off the event loop, or a
    # single scan freezes every other request for its whole duration.
    result = await run_in_threadpool(pipeline.run, data, today=today)

    parsed = result.parsed
    ocr_failed = result.ocr is None or not result.ocr.succeeded

    if ocr_failed:
        scan_status = ScanStatus.FAILED
    elif parsed and parsed.best and not parsed.needs_review:
        scan_status = ScanStatus.SUCCEEDED
    else:
        scan_status = ScanStatus.NEEDS_REVIEW

    row = scans_repo.create_scan(
        db,
        user.id,
        {
            "image_url": stored.url,
            "image_public_id": stored.public_id,
            "status": scan_status.value,
            "engine_used": result.engine_used.value if result.engine_used else None,
            "engines_attempted": [a.as_dict() for a in result.attempts],
            "raw_text": result.text or None,
            "ocr_confidence": round(result.ocr.confidence, 3) if result.ocr else None,
            "extracted_expiry_date": (
                parsed.expiry_date.isoformat() if parsed and parsed.expiry_date else None
            ),
            "date_confidence": (
                round(parsed.confidence, 3) if parsed and parsed.best else None
            ),
            "error_code": "OCR_FAILED" if ocr_failed else None,
            "error_detail": (result.ocr.error if result.ocr else "No OCR engine available."),
            "processing_ms": int((time.perf_counter() - started) * 1000),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        },
    )

    logger.info(
        "scan_completed",
        extra={
            "scan_id": row["id"],
            "status": scan_status.value,
            "engine": result.engine_used.value if result.engine_used else None,
            "fell_back": result.fell_back,
            "ms": row.get("processing_ms"),
        },
    )
    return _to_response(row, result)


@router.get("/{scan_id}", response_model=ScanOut, summary="Fetch a scan result")
async def get_scan(scan_id: str, user: CurrentUserDep, db: UserDbDep) -> ScanOut:
    return _to_response(scans_repo.get_scan(db, user.id, scan_id), None)


@router.delete(
    "/{scan_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a scan and its stored image",
)
async def delete_scan(scan_id: str, user: CurrentUserDep, db: UserDbDep) -> Response:
    """Removes the audit row, and the Cloudinary image with it.

    Items created from the scan are unaffected: items.scan_id is ON DELETE SET
    NULL, so a pantry entry survives its scan being cleared.
    """
    row = scans_repo.get_scan(db, user.id, scan_id)

    public_id = row.get("image_public_id")
    if public_id:
        # Best-effort: a stranded image is better than a failed delete.
        await run_in_threadpool(storage.delete_scan_image, public_id)

    scans_repo.delete_scan(db, user.id, scan_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{scan_id}/retry",
    response_model=ScanOut,
    summary="Re-run OCR, optionally forcing an engine",
)
async def retry_scan(
    scan_id: str,
    user: CurrentUserDep,
    db: UserDbDep,
    engine: Annotated[
        OcrEngineName | None,
        Query(description="Force a specific engine, e.g. google_vision"),
    ] = None,
) -> ScanOut:
    """Re-run a stored scan.

    Requires the original image, so it only works when Cloudinary storage
    succeeded. Forcing `google_vision` is also the clearest way to demonstrate
    the fallback path.
    """
    row = scans_repo.get_scan(db, user.id, scan_id)
    if not row.get("image_url"):
        raise BadRequestError(
            "This scan has no stored image, so it cannot be re-run.",
            code="SCAN_IMAGE_MISSING",
        )

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(row["image_url"])
        response.raise_for_status()
        data = response.content
    except Exception as exc:
        raise BadRequestError(
            "The stored image could not be retrieved.",
            code="SCAN_IMAGE_UNREACHABLE",
            details={"reason": str(exc)[:200]},
        ) from exc

    started = time.perf_counter()
    today = today_for_user(profiles_repo.get_timezone(db, user.id))
    forced = OcrEngine(engine.value) if engine else None
    result = await run_in_threadpool(pipeline.run, data, today=today, force=forced)

    parsed = result.parsed
    ocr_failed = result.ocr is None or not result.ocr.succeeded
    if ocr_failed:
        scan_status = ScanStatus.FAILED
    elif parsed and parsed.best and not parsed.needs_review:
        scan_status = ScanStatus.SUCCEEDED
    else:
        scan_status = ScanStatus.NEEDS_REVIEW

    updated = scans_repo.update_scan(
        db,
        user.id,
        scan_id,
        {
            "status": scan_status.value,
            "engine_used": result.engine_used.value if result.engine_used else None,
            "engines_attempted": [a.as_dict() for a in result.attempts],
            "raw_text": result.text or None,
            "ocr_confidence": round(result.ocr.confidence, 3) if result.ocr else None,
            "extracted_expiry_date": (
                parsed.expiry_date.isoformat() if parsed and parsed.expiry_date else None
            ),
            "date_confidence": (
                round(parsed.confidence, 3) if parsed and parsed.best else None
            ),
            "processing_ms": int((time.perf_counter() - started) * 1000),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return _to_response(updated, result)
