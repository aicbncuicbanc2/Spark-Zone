"""Per-user rate limiting for endpoints that trigger billed external API
calls (Google Vision).

Deliberately simple and in-memory: it protects against the realistic risk
for an app this size - a single client, script, or leaked token hammering
an endpoint in a loop - not a distributed, multi-source attack. It is also
per Cloud Run instance, not shared across the up to 3 instances this
service can scale to, so a determined caller spread across instances could
still exceed the stated limit overall. That's a real limitation worth
stating plainly rather than overclaiming a guarantee this doesn't provide -
but it's a genuine, meaningful improvement over having nothing at all, and
it costs no new dependency or deploy risk.

The limit itself is deliberately generous (20 calls/minute) so it can never
interfere with legitimate rapid use - a judge trying several products back
to back during a live demo - while still blocking a script that would
otherwise fire hundreds of requests a minute against a billed API.
"""

from __future__ import annotations

import time
from collections import defaultdict

from app.core.errors import TooManyRequestsError

WINDOW_SECONDS = 60.0
MAX_REQUESTS_PER_WINDOW = 20

_recent_calls: dict[str, list[float]] = defaultdict(list)


def enforce(
    key: str,
    *,
    limit: int = MAX_REQUESTS_PER_WINDOW,
    window: float = WINDOW_SECONDS,
) -> None:
    """Raise TooManyRequestsError if `key` has made `limit`+ calls in the
    trailing `window` seconds. Safe to call from an async request handler:
    every operation here is synchronous with no `await` in between, so
    there is no race between the check and the append within one process.
    """
    now = time.monotonic()
    calls = _recent_calls[key]
    cutoff = now - window
    while calls and calls[0] < cutoff:
        calls.pop(0)
    if len(calls) >= limit:
        raise TooManyRequestsError(
            f"Too many requests - limit is {limit} per {int(window)} seconds. "
            "Please wait a moment and try again.",
            details={"limit": limit, "window_seconds": int(window)},
        )
    calls.append(now)
