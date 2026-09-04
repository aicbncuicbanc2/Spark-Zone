"""Day 1-2 smoke tests: the app boots, probes behave, errors are shaped."""

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from app.core.errors import NotFoundError
from app.deps import CurrentUserDep
from app.main import create_app


@pytest.fixture(scope="module")
def client() -> TestClient:
    app = create_app()

    # Routes that only exist for these tests, exercising auth + the envelope.
    probe = APIRouter()

    @probe.get("/_test/protected")
    async def protected(user: CurrentUserDep) -> dict:
        return {"user_id": user.id}

    @probe.get("/_test/not-found")
    async def not_found() -> dict:
        raise NotFoundError("No such item.", code="ITEM_NOT_FOUND")

    app.include_router(probe)
    return TestClient(app)


def test_health_is_always_ok(client: TestClient) -> None:
    """Liveness must not depend on config, or Cloud Run kills healthy revisions."""
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_readiness_reports_missing_config(client: TestClient) -> None:
    resp = client.get("/health/ready")
    body = resp.json()
    assert resp.status_code in (200, 503)
    assert "config" in body["checks"]
    assert "supabase" in body["checks"]


def test_request_id_header_is_returned(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.headers.get("X-Request-ID")


def test_request_id_is_echoed_when_supplied(client: TestClient) -> None:
    resp = client.get("/health", headers={"X-Request-ID": "abc123"})
    assert resp.headers["X-Request-ID"] == "abc123"


def test_error_envelope_shape(client: TestClient) -> None:
    resp = client.get("/_test/not-found")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "ITEM_NOT_FOUND"
    assert body["error"]["message"]
    assert "request_id" in body


def test_protected_route_rejects_missing_auth(client: TestClient) -> None:
    resp = client.get("/_test/protected")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AUTH_MISSING"


def test_protected_route_rejects_wrong_scheme(client: TestClient) -> None:
    resp = client.get("/_test/protected", headers={"Authorization": "Basic zzz"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AUTH_SCHEME"


def test_protected_route_rejects_garbage_token(client: TestClient) -> None:
    resp = client.get("/_test/protected", headers={"Authorization": "Bearer not-a-jwt"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "TOKEN_MALFORMED"
