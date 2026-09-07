"""Label scanning: photo in, expiry date out.

Asynchronous by design. Earlier this held the connection open for the whole
OCR duration (2-40+ seconds depending on server load) and returned the full
result in one response. Real usage showed that fails in practice: a mobile
client or the tunnel in between cancels a request held open that long
("Incoming request ended abruptly: context canceled" in the tunnel log) even
though the backend was still working correctly - the client just gave up
waiting. No amount of speeding up OCR fully fixes that, because the failure
mode is about connection lifetime, not processing time.

So POST /v1/scans now returns immediately with status="processing" and a
scan_id, and the actual work runs after the response is sent. The client polls
GET /v1/scans/{id} every second or two until the status changes. Every
individual request is now short, so nothing has time to be cancelled.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    Query,
    Response,
    UploadFile,
    status,
)
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.core.errors import BadRequestError, PayloadTooLargeError
from app.db.repositories import products as products_repo
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
from app.services import barcode as barcode_service
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


async def _resolve_product(db, image: bytes) -> tuple[str | None, dict | None]:
    """Decode a barcode and identify the product.

    A barcode gives identity, never an expiry date - retail EAN-13 encodes a
    product identifier and nothing else. Runs alongside OCR rather than after
    it, since an Open Food Facts lookup costs about a second.
    """
    found = await run_in_threadpool(barcode_service.best_product_code, image)
    if found is None:
        return None, None

    code = found.value

    cached = await run_in_threadpool(products_repo.get_by_barcode, db, code)
    if cached:
        return code, cached

    info = await barcode_service.lookup_open_food_facts(code)
    if info is None:
        # Still report the barcode; the user can name the product themselves.
        return code, None

    stored = await run_in_threadpool(
        products_repo.upsert,
        {
            "barcode": info.barcode,
            "name": info.name,
            "brand": info.brand,
            "category_id": info.category_id,
            "image_url": info.image_url,
            "source": info.source,
            "raw": info.raw,
        },
    )
    return code, stored


async def _run_pipeline_and_persist(
    db,
    user_id: str,
    scan_id: str,
    data: bytes,
    *,
    force: OcrEngine | None = None,
) -> None:
    """The actual OCR/barcode/upload work, run after the response is sent.

    Shared by the initial scan and by retry, since both have exactly the same
    long-running work and exactly the same reason not to hold a connection
    open for it.

    Must never let an exception escape: this runs as a background task with no
    HTTP response to carry a failure back to, so an unhandled exception here
    would leave the scan stuck at status="processing" forever with the client
    polling a row that will never change. Every path ends in a status update.
    """
    started = time.perf_counter()
    try:
        stored = await run_in_threadpool(storage.upload_scan_image, data, user_id=user_id)
        if stored.error and storage.is_configured():
            logger.warning("scan_image_not_stored", extra={"reason": stored.error})

        today = today_for_user(profiles_repo.get_timezone(db, user_id))
        result, (detected_barcode, product) = await asyncio.gather(
            run_in_threadpool(pipeline.run, data, today=today, force=force),
            _resolve_product(db, data),
        )

        parsed = result.parsed
        ocr_failed = result.ocr is None or not result.ocr.succeeded

        if ocr_failed:
            scan_status = ScanStatus.FAILED
        elif parsed and parsed.best and not parsed.needs_review:
            scan_status = ScanStatus.SUCCEEDED
        else:
            scan_status = ScanStatus.NEEDS_REVIEW

        review_reason = parsed.review_reason if parsed else None
        date_type = parsed.best.date_type.value if parsed and parsed.best else None

        alternatives: list[dict] = []
        if parsed and parsed.needs_review and len(parsed.candidates) > 1:
            # Only worth persisting when there is a real choice to show -
            # otherwise every scan would carry a redundant one-item list.
            alternatives = [
                {
                    "value": c.value.isoformat(),
                    "date_type": c.date_type.value,
                    "confidence": round(c.confidence, 3),
                    "raw": c.raw,
                    "notes": list(c.notes),
                }
                for c in sorted(parsed.candidates, key=lambda c: -c.confidence)[:4]
            ]

        changes = {
            "image_url": stored.url,
            "image_public_id": stored.public_id,
            "detected_barcode": detected_barcode,
            "product_id": (product or {}).get("id"),
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
            # These three exist only because GET is now the sole way a client
            # ever sees the final result - the old synchronous response could
            # get away with computing them on the fly and handing them back
            # once, but that path no longer exists.
            "review_reason": review_reason,
            "date_type": date_type,
            "alternatives": alternatives,
            "error_code": "OCR_FAILED" if ocr_failed else None,
            "error_detail": (result.ocr.error if result.ocr else "No OCR engine available."),
            "processing_ms": int((time.perf_counter() - started) * 1000),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        scans_repo.update_scan(db, user_id, scan_id, changes)

        logger.info(
            "scan_completed",
            extra={
                "scan_id": scan_id,
                "status": scan_status.value,
                "engine": result.engine_used.value if result.engine_used else None,
                "fell_back": result.fell_back,
                "ms": changes["processing_ms"],
            },
        )

    except Exception as exc:
        logger.exception("scan_background_task_failed", extra={"scan_id": scan_id})
        try:
            scans_repo.update_scan(
                db,
                user_id,
                scan_id,
                {
                    "status": ScanStatus.FAILED.value,
                    "error_code": "INTERNAL_ERROR",
                    "error_detail": str(exc)[:300],
                    "processing_ms": int((time.perf_counter() - started) * 1000),
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception:
            logger.exception("scan_failure_could_not_be_recorded", extra={"scan_id": scan_id})


def _to_response(row: dict) -> ScanOut:
    """Shape a stored scan row for the app.

    Everything comes from the row now, nothing from in-memory pipeline state.
    That is a deliberate consequence of the async contract: since a background
    task persists the result and the client only ever reads it back via GET
    (immediately after create, and on every poll), any field the client needs
    has to actually be in the database - there is no second channel to smuggle
    it through in one response the way the old synchronous flow could.
    """
    alternatives = [
        DateCandidateOut(
            value=a["value"],
            date_type=a["date_type"],
            confidence=a["confidence"],
            raw=a["raw"],
            notes=a.get("notes") or [],
        )
        for a in (row.get("alternatives") or [])
    ]

    # PostgREST returns the embedded product as a nested object (or null when
    # no barcode resolved). Flatten it so the client sees plain fields.
    row = dict(row)
    product = row.pop("products", None) or {}
    suggested = SuggestedItem(
        name=product.get("name"),
        brand=product.get("brand"),
        category_id=product.get("category_id"),
        expiry_date=row.get("extracted_expiry_date"),
    )

    return ScanOut(
        scan_id=row["id"],
        status=ScanStatus(row["status"]),
        image_url=row.get("image_url"),
        extracted_expiry_date=row.get("extracted_expiry_date"),
        date_confidence=row.get("date_confidence"),
        date_type=row.get("date_type"),
        detected_barcode=row.get("detected_barcode"),
        engine_used=(
            OcrEngineName(row["engine_used"]) if row.get("engine_used") else None
        ),
        engines_attempted=row.get("engines_attempted") or [],
        raw_text=row.get("raw_text"),
        ocr_confidence=row.get("ocr_confidence"),
        needs_review=row["status"] == ScanStatus.NEEDS_REVIEW.value,
        review_reason=row.get("review_reason"),
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
    status_code=status.HTTP_202_ACCEPTED,
    summary="Start scanning a product label",
)
async def create_scan(
    user: CurrentUserDep,
    db: UserDbDep,
    background_tasks: BackgroundTasks,
    image: Annotated[UploadFile, File(description="Photo of the label")],
) -> ScanOut:
    """Accepts a label photo and starts OCR in the background.

    Returns immediately with `status: "processing"` and a `scan_id`. Poll
    `GET /v1/scans/{scan_id}` every second or two until `status` becomes
    `succeeded`, `needs_review` or `failed` - typically a few seconds, longer
    under load, but this endpoint itself never blocks on that.

    Always let the user confirm the date before saving it as an item. Check
    `needs_review` on the polled result — it is set for ambiguous reads and for
    packs that only print a manufacture date.
    """
    data = await _read_upload(image)

    # Created before any slow work starts, so the client has a scan_id to poll
    # within milliseconds of uploading.
    row = scans_repo.create_scan(db, user.id, {"status": ScanStatus.PROCESSING.value})

    background_tasks.add_task(_run_pipeline_and_persist, db, user.id, row["id"], data)

    return _to_response(row)


@router.get("/{scan_id}", response_model=ScanOut, summary="Fetch a scan result")
async def get_scan(scan_id: str, user: CurrentUserDep, db: UserDbDep) -> ScanOut:
    """Poll this until `status` leaves `processing`."""
    return _to_response(scans_repo.get_scan(db, user.id, scan_id))


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
    status_code=status.HTTP_202_ACCEPTED,
    summary="Re-run OCR in the background, optionally forcing an engine",
)
async def retry_scan(
    scan_id: str,
    user: CurrentUserDep,
    db: UserDbDep,
    background_tasks: BackgroundTasks,
    engine: Annotated[
        OcrEngineName | None,
        Query(description="Force a specific engine, e.g. google_vision"),
    ] = None,
) -> ScanOut:
    """Re-run a stored scan in the background — same polling contract as create.

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

    forced = OcrEngine(engine.value) if engine else None
    processing_row = scans_repo.update_scan(
        db, user.id, scan_id, {"status": ScanStatus.PROCESSING.value}
    )

    background_tasks.add_task(
        _run_pipeline_and_persist, db, user.id, scan_id, data, force=forced
    )

    return _to_response(processing_row)
