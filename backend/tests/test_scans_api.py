"""The scan endpoint.

The OCR pipeline is stubbed so these stay fast — real-model coverage lives in
test_ocr.py behind the `slow` marker. What is exercised here is the endpoint's
own behaviour: validation, the async processing/poll contract, status
mapping, storage degradation and persistence.

Scanning is asynchronous: POST returns 202 with status="processing"
immediately, and the actual work happens in a background task. FastAPI's
TestClient runs background tasks to completion before client.post() returns
control (verified directly, not assumed), so every test here follows the same
two-step shape: POST and check it reports "processing", then GET the same
scan_id and check the real, finished result — exactly what polling would
observe in the real app, just without needing an actual sleep loop.
"""

from __future__ import annotations

import io
import os
from datetime import date

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import get_settings
from app.main import app
from app.services import storage
from app.services.date_parser import DateCandidate, DateType, ParseResult
from app.services.ocr import pipeline
from app.services.ocr.base import OcrEngine, OcrResult, TextBlock

TEST_USER_A = "rlstest.a@sparkzone.app"
TEST_PASSWORD = os.getenv("TEST_USER_PASSWORD", "")

settings = get_settings()

pytestmark = pytest.mark.skipif(
    bool(settings.missing_required()) or not TEST_PASSWORD,
    reason="Supabase not configured, or TEST_USER_PASSWORD not set in .env",
)


def _jpeg() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (600, 400), (240, 240, 240)).save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="module")
def auth(auth_headers_a: dict[str, str]) -> dict[str, str]:
    """Delegates to the session-scoped token in conftest.

    Signing in per module meant several password grants per run, which
    Supabase rate-limits; the suite then failed intermittently.
    """
    return auth_headers_a


def _stub(monkeypatch, *, value: date | None, date_type=DateType.EXPIRY, needs_review=False,
          reason: str | None = None, ocr_error: str | None = None) -> None:
    """Replace the OCR pipeline with a deterministic result."""
    best = (
        DateCandidate(
            value=value, date_type=date_type, confidence=0.9,
            raw="stub", start=0, end=5,
        )
        if value
        else None
    )
    ocr = OcrResult(
        engine=OcrEngine.PADDLEOCR,
        blocks=[] if ocr_error else [TextBlock("EXP 22/12/2027", 0.95, (0, 0, 10, 10))],
        duration_ms=12,
        error=ocr_error,
    )
    result = pipeline.PipelineResult(
        ocr=ocr,
        parsed=ParseResult(
            best=best,
            candidates=[best] if best else [],
            needs_review=needs_review,
            review_reason=reason,
        ),
        attempts=[
            pipeline.Attempt(
                engine=OcrEngine.PADDLEOCR,
                succeeded=ocr_error is None,
                ocr_confidence=0.95,
                date_found=best is not None,
                duration_ms=12,
                error=ocr_error,
            )
        ],
    )
    monkeypatch.setattr(pipeline, "run", lambda *a, **k: result)


def _scan(client: TestClient, auth: dict[str, str]) -> dict:
    """POST a scan and return the finished row, fetched via GET.

    Encapsulates the create-then-poll shape every test needs: the POST
    response is always {"status": "processing"} by design, so the assertions
    that matter belong on what GET reports once the background task (already
    run by the time POST returned, under TestClient) has finished.
    """
    created = client.post(
        "/v1/scans", headers=auth, files={"image": ("l.jpg", _jpeg(), "image/jpeg")}
    )
    assert created.status_code == 202
    assert created.json()["status"] == "processing"
    scan_id = created.json()["scan_id"]

    finished = client.get(f"/v1/scans/{scan_id}", headers=auth)
    assert finished.status_code == 200
    return finished.json()


@pytest.fixture(autouse=True)
def _cleanup(client: TestClient, auth: dict[str, str]):
    """Remove scans this module creates, whatever happens."""
    created: list[str] = []
    yield created
    for scan_id in created:
        # Cleanup must never mask a real test failure.
        client.request("DELETE", f"/v1/scans/{scan_id}", headers=auth)


# --- validation ---------------------------------------------------------------


def test_scan_requires_auth(client: TestClient) -> None:
    resp = client.post("/v1/scans", files={"image": ("x.jpg", _jpeg(), "image/jpeg")})
    assert resp.status_code == 401


def test_empty_upload_is_rejected(client: TestClient, auth: dict[str, str]) -> None:
    resp = client.post("/v1/scans", headers=auth, files={"image": ("x.jpg", b"", "image/jpeg")})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "EMPTY_UPLOAD"


def test_wrong_content_type_is_rejected(client: TestClient, auth: dict[str, str]) -> None:
    resp = client.post(
        "/v1/scans", headers=auth, files={"image": ("x.pdf", b"%PDF-1.4", "application/pdf")}
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "UNSUPPORTED_IMAGE_TYPE"


def test_oversized_upload_is_rejected(client: TestClient, auth: dict[str, str]) -> None:
    huge = b"\xff\xd8\xff" + b"0" * (settings.ocr_max_image_bytes + 1024)
    resp = client.post("/v1/scans", headers=auth, files={"image": ("big.jpg", huge, "image/jpeg")})
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


# --- the async contract itself --------------------------------------------------


def test_create_returns_202_and_processing_immediately(client, auth, monkeypatch, _cleanup) -> None:
    """This is the entire point of the change: the create call never blocks."""
    _stub(monkeypatch, value=date(2027, 12, 22))
    resp = client.post("/v1/scans", headers=auth, files={"image": ("l.jpg", _jpeg(), "image/jpeg")})
    body = resp.json()
    _cleanup.append(body["scan_id"])

    assert resp.status_code == 202
    assert body["status"] == "processing"
    assert body["extracted_expiry_date"] is None
    assert body["scan_id"]


def test_get_reflects_the_finished_result(client, auth, monkeypatch, _cleanup) -> None:
    _stub(monkeypatch, value=date(2027, 12, 22))
    row = _scan(client, auth)
    _cleanup.append(row["scan_id"])
    assert row["status"] == "succeeded"
    assert row["extracted_expiry_date"] == "2027-12-22"


# --- status mapping -----------------------------------------------------------


def test_confident_expiry_returns_succeeded(client, auth, monkeypatch, _cleanup) -> None:
    _stub(monkeypatch, value=date(2027, 12, 22))
    body = _scan(client, auth)
    _cleanup.append(body["scan_id"])

    assert body["status"] == "succeeded"
    assert body["extracted_expiry_date"] == "2027-12-22"
    assert body["needs_review"] is False
    assert body["engine_used"] == "paddleocr"
    assert body["engines_attempted"]


def test_manufacture_only_returns_needs_review_and_no_expiry(
    client, auth, monkeypatch, _cleanup
) -> None:
    """The scan must not hand the app a manufacture date as if it were expiry."""
    _stub(
        monkeypatch,
        value=date(2026, 5, 1),
        date_type=DateType.MANUFACTURE,
        needs_review=True,
        reason="Only a manufacture date was found, not an expiry date.",
    )
    body = _scan(client, auth)
    _cleanup.append(body["scan_id"])

    assert body["status"] == "needs_review"
    assert body["extracted_expiry_date"] is None
    assert body["needs_review"] is True
    assert "manufacture" in body["review_reason"].lower()


def test_ambiguous_date_returns_alternatives(client, auth, monkeypatch, _cleanup) -> None:
    _stub(
        monkeypatch,
        value=date(2027, 8, 21),
        needs_review=True,
        reason="This date could be read more than one way. Please confirm it.",
    )
    body = _scan(client, auth)
    _cleanup.append(body["scan_id"])

    assert body["status"] == "needs_review"
    assert body["extracted_expiry_date"] == "2027-08-21"
    assert "more than one way" in body["review_reason"]


def test_ocr_failure_is_reported_not_raised(client, auth, monkeypatch, _cleanup) -> None:
    _stub(monkeypatch, value=None, ocr_error="engine exploded")
    body = _scan(client, auth)
    _cleanup.append(body["scan_id"])

    assert body["status"] == "failed"
    assert body["error_code"] == "OCR_FAILED"


def test_an_unexpected_exception_still_ends_in_failed_not_stuck_processing(
    client, auth, monkeypatch, _cleanup
) -> None:
    """Regression: an unhandled exception in the background task has nowhere
    to raise to. Without a catch-all it would leave the row at "processing"
    forever, and a real client would poll it indefinitely.
    """

    def _boom(*args, **kwargs):
        raise RuntimeError("simulated crash inside the background task")

    monkeypatch.setattr(pipeline, "run", _boom)
    body = _scan(client, auth)
    _cleanup.append(body["scan_id"])

    assert body["status"] == "failed"
    assert body["error_code"] == "INTERNAL_ERROR"


# --- storage degradation ------------------------------------------------------


def test_scan_still_works_when_cloudinary_is_unconfigured(
    client, auth, monkeypatch, _cleanup
) -> None:
    """Losing the photo must not cost the user the date."""
    _stub(monkeypatch, value=date(2027, 12, 22))
    monkeypatch.setattr(storage, "is_configured", lambda: False)
    monkeypatch.setattr(
        storage,
        "upload_scan_image",
        lambda *a, **k: storage.StoredImage(None, None, error="Cloudinary is not configured."),
    )

    body = _scan(client, auth)
    _cleanup.append(body["scan_id"])

    assert body["status"] == "succeeded"
    assert body["extracted_expiry_date"] == "2027-12-22"
    assert body["image_url"] is None


def test_scan_survives_a_cloudinary_outage(client, auth, monkeypatch, _cleanup) -> None:
    _stub(monkeypatch, value=date(2027, 12, 22))
    monkeypatch.setattr(storage, "is_configured", lambda: True)
    monkeypatch.setattr(
        storage,
        "upload_scan_image",
        lambda *a, **k: storage.StoredImage(None, None, error="connection refused"),
    )
    body = _scan(client, auth)
    _cleanup.append(body["scan_id"])

    assert body["status"] == "succeeded"
    assert body["image_url"] is None


# --- persistence and isolation ------------------------------------------------


def test_scan_is_retrievable_afterwards(client, auth, monkeypatch, _cleanup) -> None:
    _stub(monkeypatch, value=date(2027, 12, 22))
    row = _scan(client, auth)
    _cleanup.append(row["scan_id"])

    fetched = client.get(f"/v1/scans/{row['scan_id']}", headers=auth)
    assert fetched.status_code == 200
    assert fetched.json()["extracted_expiry_date"] == "2027-12-22"


def test_missing_scan_is_404(client: TestClient, auth: dict[str, str]) -> None:
    resp = client.get("/v1/scans/00000000-0000-4000-8000-000000000000", headers=auth)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "SCAN_NOT_FOUND"


# --- retry ----------------------------------------------------------------------


def test_retry_without_a_stored_image_is_rejected(client, auth, monkeypatch, _cleanup) -> None:
    _stub(monkeypatch, value=date(2027, 12, 22))
    monkeypatch.setattr(storage, "is_configured", lambda: False)
    monkeypatch.setattr(
        storage,
        "upload_scan_image",
        lambda *a, **k: storage.StoredImage(None, None, error="Cloudinary is not configured."),
    )
    created = _scan(client, auth)
    _cleanup.append(created["scan_id"])

    resp = client.post(f"/v1/scans/{created['scan_id']}/retry", headers=auth)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "SCAN_IMAGE_MISSING"


def test_retry_also_returns_202_processing_immediately(
    client, auth, monkeypatch, _cleanup
) -> None:
    """Retry had exactly the same long-connection problem as create; same fix."""
    _stub(monkeypatch, value=date(2027, 12, 22))
    monkeypatch.setattr(storage, "is_configured", lambda: True)
    monkeypatch.setattr(
        storage,
        "upload_scan_image",
        lambda *a, **k: storage.StoredImage(
            "https://res.cloudinary.com/demo/image/upload/x.jpg", "demo/x"
        ),
    )
    created = _scan(client, auth)
    _cleanup.append(created["scan_id"])
    assert created["image_url"], "retry needs a stored image to fetch"

    # retry re-downloads the stored image over a real httpx.AsyncClient before
    # re-running OCR; stub that fetch rather than hit a fake Cloudinary URL.
    import httpx as httpx_module

    class _FakeResponse:
        content = _jpeg()

        def raise_for_status(self) -> None:
            return None

    async def _fake_get(self, url, *a, **k):
        return _FakeResponse()

    monkeypatch.setattr(httpx_module.AsyncClient, "get", _fake_get)

    resp = client.post(f"/v1/scans/{created['scan_id']}/retry", headers=auth)
    assert resp.status_code == 202
    assert resp.json()["status"] == "processing"
