"""Items CRUD and dashboard, exercised through the real API against Supabase.

Skips without credentials. Every test cleans up after itself so the project is
left as it was found.
"""

from __future__ import annotations

import os
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.services.priority import today_for_user

TEST_USER_A = "rlstest.a@sparkzone.app"
TEST_USER_B = "rlstest.b@sparkzone.app"
TEST_PASSWORD = os.getenv("TEST_USER_PASSWORD", "")

settings = get_settings()

pytestmark = pytest.mark.skipif(
    bool(settings.missing_required()) or not TEST_PASSWORD,
    reason="Supabase not configured, or TEST_USER_PASSWORD not set in .env",
)


def _token(email: str) -> str:
    resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        headers={"apikey": settings.supabase_anon_key},
        json={"email": email, "password": TEST_PASSWORD},
        timeout=20,
    )
    body = resp.json()
    if "access_token" not in body:
        pytest.skip(f"dev account {email} unavailable: {body.get('error_code')}")
    return body["access_token"]


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


# Every fixture name starts with this, so a failed run can be swept up.
PROBE_PREFIX = "pytest "


@pytest.fixture(scope="module", autouse=True)
def sweep_probe_items(client: TestClient, auth_a: dict[str, str]):
    """Delete any leftover probe items, before and after the module.

    Per-test cleanup does not run when a test errors during setup, and this
    suite writes to the real project — without this, a single failing run
    leaves rows behind and quietly skews the dashboard counts of every run
    afterwards.
    """

    def _sweep() -> int:
        removed = 0
        for status in ("active", "consumed", "discarded", "expired"):
            listing = client.get(
                f"/v1/items?status={status}&limit=200", headers=auth_a
            ).json()
            for row in listing.get("items", []):
                if row["name"].startswith(PROBE_PREFIX):
                    client.delete(f"/v1/items/{row['id']}", headers=auth_a)
                    removed += 1
        return removed

    _sweep()
    yield
    _sweep()


@pytest.fixture(scope="module")
def auth_a() -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(TEST_USER_A)}"}


@pytest.fixture(scope="module")
def auth_b() -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(TEST_USER_B)}"}


@pytest.fixture(scope="module")
def user_today(client: TestClient, auth_a: dict[str, str]):
    """Today in the user's own timezone.

    The API computes days_remaining against the profile timezone, so a test
    that builds dates in UTC is off by a day for most of the KL day.
    """
    profile = client.get("/v1/me", headers=auth_a).json()
    return today_for_user(profile["timezone"])


@pytest.fixture
def item(client: TestClient, auth_a: dict[str, str], user_today):
    """A throwaway item owned by user A, removed afterwards."""
    resp = client.post(
        "/v1/items",
        headers=auth_a,
        json={
            "name": "pytest probe",
            "category_id": "food",
            "expiry_date": (user_today + timedelta(days=5)).isoformat(),
        },
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    yield created
    client.delete(f"/v1/items/{created['id']}", headers=auth_a)


# --- auth ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    ["/v1/items", "/v1/dashboard", "/v1/me", "/v1/categories"],
)
def test_endpoints_require_auth(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 401


# --- create / read ------------------------------------------------------------


def test_create_returns_derived_fields(item: dict) -> None:
    assert item["effective_expiry_date"] == item["expiry_date"]
    assert item["days_remaining"] == 5
    assert item["urgency"] == "upcoming"
    assert item["status"] == "active"


def test_get_one(client: TestClient, auth_a: dict[str, str], item: dict) -> None:
    resp = client.get(f"/v1/items/{item['id']}", headers=auth_a)
    assert resp.status_code == 200
    assert resp.json()["name"] == "pytest probe"


def test_list_includes_the_item_and_a_page_block(
    client: TestClient, auth_a: dict[str, str], item: dict
) -> None:
    body = client.get("/v1/items", headers=auth_a).json()
    assert any(row["id"] == item["id"] for row in body["items"])
    assert body["page"]["total"] >= 1


def test_missing_item_is_404_with_our_error_code(
    client: TestClient, auth_a: dict[str, str]
) -> None:
    resp = client.get(
        "/v1/items/00000000-0000-4000-8000-000000000000", headers=auth_a
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "ITEM_NOT_FOUND"


# --- isolation ----------------------------------------------------------------


def test_user_b_cannot_read_user_a_item(
    client: TestClient, auth_b: dict[str, str], item: dict
) -> None:
    """Through the API this time, not just raw PostgREST."""
    resp = client.get(f"/v1/items/{item['id']}", headers=auth_b)
    assert resp.status_code == 404


def test_user_b_cannot_delete_user_a_item(
    client: TestClient, auth_a: dict[str, str], auth_b: dict[str, str], item: dict
) -> None:
    assert client.delete(f"/v1/items/{item['id']}", headers=auth_b).status_code == 404
    # ...and it is still there afterwards.
    assert client.get(f"/v1/items/{item['id']}", headers=auth_a).status_code == 200


# --- update -------------------------------------------------------------------


def test_patch_expiry_recomputes_urgency(
    client: TestClient, auth_a: dict[str, str], item: dict, user_today
) -> None:
    resp = client.patch(
        f"/v1/items/{item['id']}",
        headers=auth_a,
        json={"expiry_date": (user_today + timedelta(days=1)).isoformat()},
    )
    assert resp.status_code == 200
    assert resp.json()["urgency"] == "critical"


def test_marking_opened_applies_period_after_opening(
    client: TestClient, auth_a: dict[str, str], auth_b: dict[str, str]
) -> None:
    """The product differentiator, through the public API."""
    created = client.post(
        "/v1/items",
        headers=auth_a,
        json={
            "name": "pytest sunscreen",
            "category_id": "skincare",
            "expiry_date": "2027-12-01",
        },
    ).json()
    try:
        assert created["effective_expiry_date"] == "2027-12-01"

        opened = client.patch(
            f"/v1/items/{created['id']}",
            headers=auth_a,
            json={"opened_at": "2026-06-15", "pao_months": 6},
        ).json()
        assert opened["effective_expiry_date"] == "2026-12-15"
    finally:
        client.delete(f"/v1/items/{created['id']}", headers=auth_a)


def test_pao_without_opened_at_is_rejected_cleanly(
    client: TestClient, auth_a: dict[str, str]
) -> None:
    """Should be a 422 naming the field, not a raw Postgres constraint error."""
    resp = client.post(
        "/v1/items",
        headers=auth_a,
        json={"name": "bad", "expiry_date": "2027-01-01", "pao_months": 6},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_unknown_category_is_a_400_not_a_500(
    client: TestClient, auth_a: dict[str, str]
) -> None:
    resp = client.post(
        "/v1/items",
        headers=auth_a,
        json={"name": "bad", "expiry_date": "2027-01-01", "category_id": "nonsense"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "FOREIGN_KEY_VIOLATION"


# --- lifecycle ----------------------------------------------------------------


def test_consume_sets_status_and_resolved_at(
    client: TestClient, auth_a: dict[str, str], item: dict
) -> None:
    body = client.post(f"/v1/items/{item['id']}/consume", headers=auth_a).json()
    assert body["status"] == "consumed"
    assert body["resolved_at"] is not None


def test_consumed_items_leave_the_default_list(
    client: TestClient, auth_a: dict[str, str], item: dict
) -> None:
    client.post(f"/v1/items/{item['id']}/consume", headers=auth_a)
    active = client.get("/v1/items", headers=auth_a).json()
    assert all(row["id"] != item["id"] for row in active["items"])

    consumed = client.get("/v1/items?status=consumed", headers=auth_a).json()
    assert any(row["id"] == item["id"] for row in consumed["items"])


# --- dashboard and reference --------------------------------------------------


def test_dashboard_counts_the_item(
    client: TestClient, auth_a: dict[str, str], item: dict
) -> None:
    body = client.get("/v1/dashboard", headers=auth_a).json()
    assert body["counts"]["total_active"] >= 1
    assert body["counts"]["upcoming"] >= 1
    assert body["timezone"]


def test_dashboard_buckets_sum_to_total(
    client: TestClient, auth_a: dict[str, str], item: dict
) -> None:
    counts = client.get("/v1/dashboard", headers=auth_a).json()["counts"]
    buckets = sum(
        counts[k] for k in ("expired", "critical", "soon", "upcoming", "ok")
    )
    assert buckets == counts["total_active"]


def test_categories_are_returned_sorted(
    client: TestClient, auth_a: dict[str, str]
) -> None:
    rows = client.get("/v1/categories", headers=auth_a).json()
    assert len(rows) == 7
    assert [r["sort_order"] for r in rows] == sorted(r["sort_order"] for r in rows)
    assert any(r["label_ms"] for r in rows), "Malay labels should be present"


def test_me_returns_profile_defaults(client: TestClient, auth_a: dict[str, str]) -> None:
    body = client.get("/v1/me", headers=auth_a).json()
    assert body["timezone"]
    assert body["reminder_lead_days"]


def test_preferences_round_trip(client: TestClient, auth_a: dict[str, str]) -> None:
    original = client.get("/v1/me", headers=auth_a).json()
    try:
        updated = client.patch(
            "/v1/me/preferences",
            headers=auth_a,
            json={"timezone": "Asia/Tokyo", "reminder_lead_days": [1, 14, 14, 3]},
        )
        assert updated.status_code == 200
        body = updated.json()
        assert body["timezone"] == "Asia/Tokyo"
        # de-duplicated and sorted descending by the validator
        assert body["reminder_lead_days"] == [14, 3, 1]
    finally:
        client.patch(
            "/v1/me/preferences",
            headers=auth_a,
            json={
                "timezone": original["timezone"],
                "reminder_lead_days": original["reminder_lead_days"],
            },
        )


def test_bad_timezone_is_rejected(client: TestClient, auth_a: dict[str, str]) -> None:
    resp = client.patch(
        "/v1/me/preferences", headers=auth_a, json={"timezone": "Asia/KL"}
    )
    assert resp.status_code == 422
