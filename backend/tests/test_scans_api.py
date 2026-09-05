"""The scan endpoint.

The OCR pipeline is stubbed so these stay fast — real-model coverage lives in
test_ocr.py behind the `slow` marker. What is exercised here is the endpoint's
own behaviour: validation, status mapping, storage degradation and persistence.
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


# --- status mapping -----------------------------------------------------------


def test_confident_expiry_returns_succeeded(client, auth, monkeypatch, _cleanup) -> None:
    _stub(monkeypatch, value=date(2027, 12, 22))
    resp = client.post("/v1/scans", headers=auth, files={"image": ("l.jpg", _jpeg(), "image/jpeg")})
    assert resp.status_code == 201
    body = resp.json()
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
    resp = client.post("/v1/scans", headers=auth, files={"image": ("l.jpg", _jpeg(), "image/jpeg")})
    body = resp.json()
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
    resp = client.post("/v1/scans", headers=auth, files={"image": ("l.jpg", _jpeg(), "image/jpeg")})
    body = resp.json()
    _cleanup.append(body["scan_id"])

    assert body["status"] == "needs_review"
    assert body["extracted_expiry_date"] == "2027-08-21"
    assert "more than one way" in body["review_reason"]


def test_ocr_failure_is_reported_not_raised(client, auth, monkeypatch, _cleanup) -> None:
    _stub(monkeypatch, value=None, ocr_error="engine exploded")
    resp = client.post("/v1/scans", headers=auth, files={"image": ("l.jpg", _jpeg(), "image/jpeg")})
    assert resp.status_code == 201
    body = resp.json()
    _cleanup.append(body["scan_id"])

    assert body["status"] == "failed"
    assert body["error_code"] == "OCR_FAILED"


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

    resp = client.post("/v1/scans", headers=auth, files={"image": ("l.jpg", _jpeg(), "image/jpeg")})
    body = resp.json()
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
    resp = client.post("/v1/scans", headers=auth, files={"image": ("l.jpg", _jpeg(), "image/jpeg")})
    body = resp.json()
    _cleanup.append(body["scan_id"])

    assert body["status"] == "succeeded"
    assert body["image_url"] is None


# --- persistence and isolation ------------------------------------------------


def test_scan_is_retrievable_afterwards(client, auth, monkeypatch, _cleanup) -> None:
    _stub(monkeypatch, value=date(2027, 12, 22))
    created = client.post(
        "/v1/scans", headers=auth, files={"image": ("l.jpg", _jpeg(), "image/jpeg")}
    ).json()
    _cleanup.append(created["scan_id"])

    fetched = client.get(f"/v1/scans/{created['scan_id']}", headers=auth)
    assert fetched.status_code == 200
    assert fetched.json()["extracted_expiry_date"] == "2027-12-22"


def test_missing_scan_is_404(client: TestClient, auth: dict[str, str]) -> None:
    resp = client.get("/v1/scans/00000000-0000-4000-8000-000000000000", headers=auth)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "SCAN_NOT_FOUND"


def test_retry_without_a_stored_image_is_rejected(client, auth, monkeypatch, _cleanup) -> None:
    _stub(monkeypatch, value=date(2027, 12, 22))
    monkeypatch.setattr(storage, "is_configured", lambda: False)
    monkeypatch.setattr(
        storage,
        "upload_scan_image",
        lambda *a, **k: storage.StoredImage(None, None, error="Cloudinary is not configured."),
    )
    created = client.post(
        "/v1/scans", headers=auth, files={"image": ("l.jpg", _jpeg(), "image/jpeg")}
    ).json()
    _cleanup.append(created["scan_id"])

    resp = client.post(f"/v1/scans/{created['scan_id']}/retry", headers=auth)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "SCAN_IMAGE_MISSING"
