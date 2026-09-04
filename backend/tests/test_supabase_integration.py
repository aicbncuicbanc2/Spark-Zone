"""Integration tests against the live Supabase project.

These hit the network and need a populated .env, so they skip automatically when
credentials or the seeded dev accounts are unavailable. Run them before any
deploy — they cover the auth path, which is the part that fails silently.

    pytest tests/test_supabase_integration.py -v
"""

from __future__ import annotations

import os

import httpx
import pytest

from app.config import get_settings
from app.core.errors import UnauthorizedError
from app.core.security import user_from_token
from app.db.client import service_client, user_client

TEST_USER_A = "rlstest.a@sparkzone.app"
TEST_USER_B = "rlstest.b@sparkzone.app"
USER_A_ID = "11111111-1111-4111-8111-111111111111"

# This repository is public, so the dev-account password lives in .env, never here.
TEST_PASSWORD = os.getenv("TEST_USER_PASSWORD", "")

settings = get_settings()

pytestmark = pytest.mark.skipif(
    bool(settings.missing_required()) or not TEST_PASSWORD,
    reason="Supabase not configured, or TEST_USER_PASSWORD not set in .env",
)


def _sign_in(email: str) -> str:
    resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        headers={"apikey": settings.supabase_anon_key},
        json={"email": email, "password": TEST_PASSWORD},
        timeout=20,
    )
    body = resp.json()
    if "access_token" not in body:
        pytest.skip(f"Seeded dev account {email} unavailable: {body.get('error_code')}")
    return body["access_token"]


@pytest.fixture(scope="module")
def token_a() -> str:
    return _sign_in(TEST_USER_A)


@pytest.fixture(scope="module")
def token_b() -> str:
    return _sign_in(TEST_USER_B)


def test_verifier_accepts_a_real_supabase_token(token_a: str) -> None:
    """Our JWKS/ES256 verification path against a genuinely issued token."""
    user = user_from_token(token_a)
    assert user.id == USER_A_ID
    assert user.email == TEST_USER_A
    assert user.role == "authenticated"


def test_verifier_rejects_a_tampered_token(token_a: str) -> None:
    header, payload, signature = token_a.split(".")
    tampered = f"{header}.{payload}.{signature[:-4]}AAAA"
    with pytest.raises(UnauthorizedError):
        user_from_token(tampered)


def test_user_client_is_rls_scoped(token_a: str) -> None:
    names = [
        row["display_name"]
        for row in user_client(token_a).table("profiles").select("display_name").execute().data
    ]
    assert names == ["RLS Test A"], "user_client must see only its own profile"


def test_service_client_bypasses_rls() -> None:
    names = {
        row["display_name"]
        for row in service_client().table("profiles").select("display_name").execute().data
    }
    assert {"RLS Test A", "RLS Test B"} <= names, "service role must see every profile"


def test_users_cannot_see_each_others_items(token_a: str, token_b: str) -> None:
    """The isolation guarantee the whole product rests on."""
    a_client = user_client(token_a)
    created = (
        a_client.table("items")
        .insert(
            {
                "user_id": USER_A_ID,
                "name": "pytest isolation probe",
                "expiry_date": "2027-01-01",
            }
        )
        .execute()
    )
    item_id = created.data[0]["id"]
    try:
        b_sees = user_client(token_b).table("items").select("id").eq("id", item_id).execute()
        assert b_sees.data == [], "user B must not see user A's item"
    finally:
        a_client.table("items").delete().eq("id", item_id).execute()


def test_reference_data_is_readable_when_signed_in(token_a: str) -> None:
    client = user_client(token_a)
    assert len(client.table("categories").select("id").execute().data) == 7
    assert len(client.table("disposal_guidance").select("id").execute().data) == 15


def test_period_after_opening_shortens_effective_expiry(token_a: str) -> None:
    """An opened sunscreen expires when its PAO runs out, not when the label says."""
    client = user_client(token_a)
    created = (
        client.table("items")
        .insert(
            {
                "user_id": USER_A_ID,
                "name": "pytest PAO probe",
                "category_id": "skincare",
                "expiry_date": "2027-12-01",
                "opened_at": "2026-06-15",
                "pao_months": 6,
            }
        )
        .execute()
    )
    row = created.data[0]
    try:
        assert row["effective_expiry_date"] == "2026-12-15"
    finally:
        client.table("items").delete().eq("id", row["id"]).execute()


def test_empty_token_raises_our_error_not_a_valueerror() -> None:
    with pytest.raises(UnauthorizedError):
        user_client("")
