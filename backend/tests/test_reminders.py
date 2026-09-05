"""Reminder scheduling, device registration and the sweep.

Scheduling is pure and tested directly. The API tests hit the live project but
never send a real push — the sweep tests use a token Expo will reject, which is
also how the dead-token pruning path gets exercised.
"""

from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.services.notifications import PushMessage, looks_like_expo_token
from app.services.reminders import (
    _in_quiet_hours,
    _send_at,
    notification_text,
    plan,
)

KL = ZoneInfo("Asia/Kuala_Lumpur")
NOW = datetime(2026, 9, 5, 2, 0, tzinfo=timezone.utc)  # 10:00 in Kuala Lumpur

TEST_USER_A = "rlstest.a@sparkzone.app"
TEST_PASSWORD = os.getenv("TEST_USER_PASSWORD", "")
settings = get_settings()


# --- quiet hours --------------------------------------------------------------


@pytest.mark.parametrize(
    ("moment", "expected"),
    [("07:00", True), ("02:00", True), ("23:00", True), ("09:00", False), ("21:59", False)],
)
def test_quiet_hours_wrap_midnight(moment: str, expected: bool) -> None:
    hour, minute = (int(p) for p in moment.split(":"))
    assert _in_quiet_hours(time(hour, minute), time(22, 0), time(8, 0)) is expected


def test_quiet_hours_that_do_not_wrap() -> None:
    assert _in_quiet_hours(time(8, 0), time(6, 0), time(11, 0)) is True
    assert _in_quiet_hours(time(12, 0), time(6, 0), time(11, 0)) is False


def test_equal_quiet_hours_means_no_quiet_period() -> None:
    assert _in_quiet_hours(time(3, 0), time(22, 0), time(22, 0)) is False


# --- send time ----------------------------------------------------------------


def test_sends_at_nine_local_not_nine_utc() -> None:
    """The bug this prevents: a 09:00 UTC send is 17:00 in Kuala Lumpur."""
    when = _send_at(date(2026, 9, 20), "Asia/Kuala_Lumpur", time(22, 0), time(8, 0))
    assert when.astimezone(KL).hour == 9
    assert when.hour == 1  # 01:00 UTC


def test_send_time_shifts_out_of_a_quiet_window() -> None:
    when = _send_at(date(2026, 9, 20), "Asia/Kuala_Lumpur", time(6, 0), time(11, 0))
    assert when.astimezone(KL).hour == 11


def test_send_time_respects_a_different_timezone() -> None:
    when = _send_at(date(2026, 9, 20), "Europe/London", time(22, 0), time(8, 0))
    assert when.astimezone(ZoneInfo("Europe/London")).hour == 9


def test_unknown_timezone_still_produces_a_time() -> None:
    assert _send_at(date(2026, 9, 20), "Not/AZone", time(22, 0), time(8, 0)) is not None


# --- planning -----------------------------------------------------------------


def _plan(expiry: date, leads=(7, 3, 1), now=NOW):
    return plan(
        effective_expiry=expiry,
        timezone_name="Asia/Kuala_Lumpur",
        lead_days=list(leads),
        quiet_start=time(22, 0),
        quiet_end=time(8, 0),
        now=now,
    )


def test_plans_one_reminder_per_lead_plus_an_expired_nudge() -> None:
    kinds = [p.kind for p in _plan(date(2026, 9, 20))]
    assert kinds == ["advance_7d", "advance_3d", "advance_1d", "expired"]


def test_reminders_land_on_the_right_local_days() -> None:
    by_kind = {p.kind: p.local_date for p in _plan(date(2026, 9, 20))}
    assert by_kind["advance_7d"] == date(2026, 9, 13)
    assert by_kind["advance_1d"] == date(2026, 9, 19)
    assert by_kind["expired"] == date(2026, 9, 21)


def test_past_reminders_are_skipped_not_fired_late() -> None:
    """"Expires in 7 days" about something already expired is worse than silence."""
    kinds = [p.kind for p in _plan(date(2026, 9, 6))]
    assert "advance_7d" not in kinds
    assert "advance_3d" not in kinds


def test_an_already_expired_item_plans_nothing_but_the_nudge() -> None:
    kinds = [p.kind for p in _plan(date(2026, 9, 1))]
    assert kinds == []  # even the expired nudge is in the past


def test_custom_lead_days_are_honoured() -> None:
    kinds = [p.kind for p in _plan(date(2026, 10, 30), leads=(1,))]
    assert kinds == ["advance_1d", "expired"]


def test_duplicate_leads_do_not_duplicate_reminders() -> None:
    """UNIQUE (item_id, kind) would reject these anyway; catch it earlier."""
    kinds = [p.kind for p in _plan(date(2026, 10, 30), leads=(7, 7, 3, 3))]
    assert len(kinds) == len(set(kinds))


def test_scheduled_times_are_timezone_aware_utc() -> None:
    for planned in _plan(date(2026, 10, 30)):
        assert planned.scheduled_for.tzinfo is not None
        assert planned.scheduled_for.utcoffset() == timedelta(0)


# --- notification copy --------------------------------------------------------


def test_copy_names_the_item() -> None:
    title, body = notification_text({"name": "Fresh Milk", "brand": "Dutch Lady"}, "advance_3d", 3)
    assert "3 days" in title
    assert "Dutch Lady Fresh Milk" in body


def test_copy_does_not_repeat_a_brand_already_in_the_name() -> None:
    _, body = notification_text({"name": "Nivea Cream", "brand": "Nivea"}, "day_of", 0)
    assert body.count("Nivea") == 1


def test_expired_copy_points_at_disposal() -> None:
    title, body = notification_text({"name": "Panadol"}, "expired", -1)
    assert "Expired" in title
    assert "disposal" in body.lower()


def test_singular_day() -> None:
    title, _ = notification_text({"name": "x"}, "advance_1d", 1)
    assert title == "Expires tomorrow"


# --- token shape --------------------------------------------------------------


@pytest.mark.parametrize(
    ("token", "valid"),
    [
        ("ExponentPushToken[abcDEF123]", True),
        ("ExpoPushToken[abcDEF123]", True),
        ("dGhpc19pc19hX2Zha2VfZmNtX3Rva2Vu", False),  # a raw FCM token
        ("", False),
        ("ExponentPushToken[", False),
    ],
)
def test_expo_token_shape(token: str, valid: bool) -> None:
    assert looks_like_expo_token(token) is valid


def test_push_payload_carries_a_deep_link() -> None:
    payload = PushMessage(
        token="ExponentPushToken[x]",
        title="t",
        body="b",
        data={"deep_link": "expiryguardian://items/abc"},
    ).as_payload()
    assert payload["to"] == "ExponentPushToken[x]"
    assert payload["data"]["deep_link"].startswith("expiryguardian://")


# --- API ----------------------------------------------------------------------

api = pytest.mark.skipif(
    bool(settings.missing_required()) or not TEST_PASSWORD,
    reason="Supabase not configured, or TEST_USER_PASSWORD not set in .env",
)

PROBE_TOKEN = "ExponentPushToken[pytest-reminder-probe]"


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


@api
def test_raw_fcm_token_is_rejected_with_guidance(client, auth) -> None:
    """Stored silently it would fail on every send and look like "push is broken"."""
    resp = client.post(
        "/v1/devices",
        headers=auth,
        json={"fcm_token": "dGhpc19pc19hX2Zha2VfZmNtX3Rva2Vu", "platform": "android"},
    )
    assert resp.status_code == 422
    assert "ExponentPushToken" in str(resp.json()["error"]["details"])


@api
def test_device_registration_is_idempotent(client, auth) -> None:
    payloads = {"fcm_token": PROBE_TOKEN, "platform": "android", "device_name": "Probe"}
    try:
        first = client.post("/v1/devices", headers=auth, json=payloads).json()
        second = client.post("/v1/devices", headers=auth, json=payloads).json()
        assert first["id"] == second["id"], "re-registering must not create a duplicate"
    finally:
        client.request("DELETE", f"/v1/devices?token={PROBE_TOKEN}", headers=auth)


@api
def test_creating_an_item_schedules_reminders(client, auth) -> None:
    item = client.post(
        "/v1/items",
        headers=auth,
        json={
            "name": "pytest reminder probe",
            "category_id": "food",
            "expiry_date": (datetime.now(timezone.utc).date() + timedelta(days=10)).isoformat(),
        },
    ).json()
    try:
        mine = [
            r
            for r in client.get("/v1/reminders", headers=auth).json()
            if r["item_id"] == item["id"]
        ]
        assert {r["kind"] for r in mine} >= {"advance_7d", "advance_3d", "advance_1d"}
    finally:
        client.request("DELETE", f"/v1/items/{item['id']}", headers=auth)


@api
def test_consuming_an_item_cancels_its_reminders(client, auth) -> None:
    """A notification about something already used is pure annoyance."""
    item = client.post(
        "/v1/items",
        headers=auth,
        json={
            "name": "pytest reminder probe",
            "category_id": "food",
            "expiry_date": (datetime.now(timezone.utc).date() + timedelta(days=10)).isoformat(),
        },
    ).json()
    try:
        client.post(f"/v1/items/{item['id']}/consume", headers=auth)
        remaining = [
            r
            for r in client.get("/v1/reminders", headers=auth).json()
            if r["item_id"] == item["id"]
        ]
        assert remaining == []
    finally:
        client.request("DELETE", f"/v1/items/{item['id']}", headers=auth)


@api
def test_sweep_requires_the_internal_secret(client) -> None:
    assert client.post("/v1/internal/reminders/sweep").status_code == 403
    assert (
        client.post(
            "/v1/internal/reminders/sweep", headers={"X-Internal-Secret": "wrong"}
        ).status_code
        == 403
    )


@api
def test_sweep_runs_and_reports(client) -> None:
    if not settings.internal_sweep_secret:
        pytest.skip("INTERNAL_SWEEP_SECRET not configured")
    resp = client.post(
        "/v1/internal/reminders/sweep",
        headers={"X-Internal-Secret": settings.internal_sweep_secret},
    )
    assert resp.status_code == 200
    body = resp.json()
    for key in ("considered", "sent", "failed", "suppressed", "tokens_revoked"):
        assert key in body
