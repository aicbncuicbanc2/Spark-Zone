"""Guidance and impact statistics."""

from __future__ import annotations

import os
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.services.guidance import AFTER_EXPIRY, BEFORE_EXPIRY, condition_for
from app.services.priority import today_for_user

TEST_USER_A = "rlstest.a@sparkzone.app"
TEST_PASSWORD = os.getenv("TEST_USER_PASSWORD", "")

settings = get_settings()

pytestmark = pytest.mark.skipif(
    bool(settings.missing_required()) or not TEST_PASSWORD,
    reason="Supabase not configured, or TEST_USER_PASSWORD not set in .env",
)


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


@pytest.fixture(scope="module")
def user_today(client: TestClient, auth: dict[str, str]):
    return today_for_user(client.get("/v1/me", headers=auth).json()["timezone"])


@pytest.fixture
def item_factory(client: TestClient, auth: dict[str, str]):
    """Create throwaway items, removed afterwards."""
    created: list[str] = []

    def _make(**fields) -> dict:
        payload = {"name": "pytest guidance probe", **fields}
        resp = client.post("/v1/items", headers=auth, json=payload)
        assert resp.status_code == 201, resp.text
        row = resp.json()
        created.append(row["id"])
        return row

    yield _make
    for item_id in created:
        client.request("DELETE", f"/v1/items/{item_id}", headers=auth)


# --- condition switching ------------------------------------------------------


def test_condition_flips_on_the_day_of_expiry() -> None:
    today = date(2026, 9, 5)
    assert condition_for(date(2026, 9, 6), today) == BEFORE_EXPIRY
    assert condition_for(today, today) == BEFORE_EXPIRY  # still usable today
    assert condition_for(date(2026, 9, 4), today) == AFTER_EXPIRY


# --- guidance -----------------------------------------------------------------


def test_in_date_item_gets_usage_advice(client, auth, item_factory, user_today) -> None:
    item = item_factory(
        category_id="food", expiry_date=(user_today + timedelta(days=30)).isoformat()
    )
    body = client.get(f"/v1/guidance/items/{item['id']}", headers=auth).json()
    assert body["condition"] == "before_expiry"
    assert body["severity"] == "info"


def test_expired_medicine_is_flagged_hazard(client, auth, item_factory, user_today) -> None:
    """The highest-stakes path: never advise flushing medicine."""
    item = item_factory(
        category_id="medicine", expiry_date=(user_today - timedelta(days=5)).isoformat()
    )
    body = client.get(f"/v1/guidance/items/{item['id']}", headers=auth).json()

    assert body["condition"] == "after_expiry"
    assert body["severity"] == "hazard"
    assert body["steps"]
    joined = " ".join(body["steps"]).lower()
    assert "flush" in joined or "pharmacy" in joined


def test_period_after_opening_drives_the_advice(client, auth, item_factory, user_today) -> None:
    """A cosmetic printed years ahead but opened long ago needs disposal advice.

    Reading the printed date instead of effective_expiry_date would tell the
    user to carry on using it.
    """
    item = item_factory(
        category_id="skincare",
        expiry_date="2030-01-01",
        opened_at=(user_today - timedelta(days=400)).isoformat(),
        pao_months=6,
    )
    assert item["urgency"] == "expired"

    body = client.get(f"/v1/guidance/items/{item['id']}", headers=auth).json()
    assert body["condition"] == "after_expiry"


def test_uncategorised_item_falls_back_rather_than_404(
    client, auth, item_factory, user_today
) -> None:
    item = item_factory(expiry_date=(user_today + timedelta(days=10)).isoformat())
    body = client.get(f"/v1/guidance/items/{item['id']}", headers=auth).json()
    assert body["is_fallback"] is True
    assert body["title"]


def test_malay_locale_is_served_when_it_exists(client, auth) -> None:
    body = client.get(
        "/v1/guidance?category=medicine&expired=true&locale=ms", headers=auth
    ).json()
    assert body["locale"] == "ms"
    # The Malay wording appears across title, body and steps, so check the lot.
    combined = " ".join([body["title"], body["body"], *body["steps"]]).lower()
    assert "farmasi" in combined
    assert "ubat" in combined


def test_unknown_locale_falls_back_to_english(client, auth) -> None:
    body = client.get(
        "/v1/guidance?category=medicine&expired=true&locale=fr", headers=auth
    ).json()
    assert body["locale"] == "en"


def test_guidance_requires_auth(client: TestClient) -> None:
    assert client.get("/v1/guidance?category=food").status_code == 401


# --- stats --------------------------------------------------------------------


def test_stats_shape(client, auth) -> None:
    body = client.get("/v1/stats", headers=auth).json()
    for key in (
        "total_tracked",
        "active",
        "used_in_time",
        "thrown_away",
        "expiring_this_week",
        "expired_and_unresolved",
        "by_category",
        "ocr",
    ):
        assert key in body


def test_consuming_an_item_moves_the_save_rate(client, auth, item_factory, user_today) -> None:
    """The SDG number: items used in time versus thrown away."""
    before = client.get("/v1/stats", headers=auth).json()

    item = item_factory(
        category_id="food", expiry_date=(user_today + timedelta(days=3)).isoformat()
    )
    client.post(f"/v1/items/{item['id']}/consume", headers=auth)

    after = client.get("/v1/stats", headers=auth).json()
    assert after["used_in_time"] == before["used_in_time"] + 1
    assert after["active"] == before["active"]  # created then immediately resolved


def test_category_counts_sum_to_total(client, auth) -> None:
    body = client.get("/v1/stats", headers=auth).json()
    assert sum(body["by_category"].values()) == body["total_tracked"]


def test_stats_requires_auth(client: TestClient) -> None:
    assert client.get("/v1/stats").status_code == 401
