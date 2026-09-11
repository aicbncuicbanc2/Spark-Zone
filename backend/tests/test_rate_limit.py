"""Per-user rate limiting for the endpoints that call billed Google Vision
APIs. Pure unit tests against the limiter itself - no HTTP, no real Vision
calls, so this stays fast.
"""

from __future__ import annotations

import pytest

from app.core.errors import TooManyRequestsError
from app.services import rate_limit


@pytest.fixture(autouse=True)
def _clean_state():
    """Each test gets its own key namespace so they can't see each other's
    call history - the module-level dict otherwise persists for the whole
    test process."""
    yield
    rate_limit._recent_calls.clear()


def test_allows_calls_under_the_limit() -> None:
    for _ in range(5):
        rate_limit.enforce("user-a", limit=5, window=60)


def test_blocks_the_call_that_crosses_the_limit() -> None:
    for _ in range(3):
        rate_limit.enforce("user-b", limit=3, window=60)
    with pytest.raises(TooManyRequestsError) as exc_info:
        rate_limit.enforce("user-b", limit=3, window=60)
    assert exc_info.value.status_code == 429
    assert exc_info.value.code == "RATE_LIMITED"


def test_limit_is_per_key_not_global() -> None:
    """One user hitting their limit must never block a different user."""
    for _ in range(3):
        rate_limit.enforce("user-c", limit=3, window=60)
    with pytest.raises(TooManyRequestsError):
        rate_limit.enforce("user-c", limit=3, window=60)

    # A different key is unaffected.
    rate_limit.enforce("user-d", limit=3, window=60)


def test_old_calls_age_out_of_the_window() -> None:
    """A call older than the window must not count against the limit -
    otherwise a legitimate user would be permanently locked out after one
    burst, rather than just having to wait."""
    for _ in range(3):
        rate_limit.enforce("user-e", limit=3, window=0.05)
    with pytest.raises(TooManyRequestsError):
        rate_limit.enforce("user-e", limit=3, window=0.05)

    import time

    time.sleep(0.1)
    rate_limit.enforce("user-e", limit=3, window=0.05)
