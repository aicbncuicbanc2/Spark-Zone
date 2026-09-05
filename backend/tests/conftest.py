"""Shared pytest configuration.

pydantic-settings reads .env into the Settings object, but not into os.environ.
The integration tests need one value that deliberately lives outside the app
config — the dev-account password — so load .env into the process environment
here. This repository is public; that password must never be committed.

Access tokens are fetched **once per session** and shared. Each test module
used to sign in separately, which meant six-plus password grants per run;
Supabase rate-limits those, and the suite failed intermittently with an
unrelated-looking 401 or KeyError. One grant per account per session removes
the flakiness and shaves time off every run.
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)

from app.config import get_settings

TEST_USER_A = "rlstest.a@sparkzone.app"
TEST_USER_B = "rlstest.b@sparkzone.app"


def _sign_in(email: str) -> str | None:
    settings = get_settings()
    password = os.getenv("TEST_USER_PASSWORD", "")
    if settings.missing_required() or not password:
        return None
    try:
        response = httpx.post(
            f"{settings.supabase_url}/auth/v1/token?grant_type=password",
            headers={"apikey": settings.supabase_anon_key},
            json={"email": email, "password": password},
            timeout=20,
        )
        return response.json().get("access_token")
    except Exception:  # noqa: BLE001 - absence just skips the integration tests
        return None


@pytest.fixture(scope="session")
def access_token_a() -> str:
    token = _sign_in(TEST_USER_A)
    if not token:
        pytest.skip(f"could not sign in as {TEST_USER_A}")
    return token


@pytest.fixture(scope="session")
def access_token_b() -> str:
    token = _sign_in(TEST_USER_B)
    if not token:
        pytest.skip(f"could not sign in as {TEST_USER_B}")
    return token


@pytest.fixture(scope="session")
def auth_headers_a(access_token_a: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token_a}"}


@pytest.fixture(scope="session")
def auth_headers_b(access_token_b: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token_b}"}
