"""Sending push notifications through Expo.

The frontend uses Expo's push service, so the tokens we store are Expo push
tokens (`ExponentPushToken[...]`), not raw FCM tokens. Expo forwards to FCM and
APNs itself, which is why no Firebase credentials appear here.

Two things this module is careful about:

  * It reports per-token outcomes rather than a single success flag. Expo
    accepts a batch and returns a receipt per message, and the common failure -
    `DeviceNotRegistered`, meaning the app was uninstalled - applies to one
    token, not the batch.
  * It never raises. A push that cannot be sent must not break the sweep or
    leave a reminder stuck; it is recorded and retried.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

#: Expo accepts at most 100 messages per request.
MAX_BATCH = 100

_TOKEN_PATTERN = re.compile(r"^Expo(nent)?PushToken\[[^\]]+\]$")

#: Expo error codes that mean the token is dead and should be stopped.
DEAD_TOKEN_ERRORS = {"DeviceNotRegistered", "InvalidCredentials"}


def looks_like_expo_token(token: str) -> bool:
    """Cheap shape check.

    Worth doing at registration: a raw FCM token stored by mistake would be
    accepted silently and then fail on every send, which is a confusing thing
    to debug on demo day.
    """
    return bool(token) and bool(_TOKEN_PATTERN.match(token.strip()))


@dataclass
class PushMessage:
    token: str
    title: str
    body: str
    data: dict = field(default_factory=dict)

    def as_payload(self) -> dict:
        return {
            "to": self.token,
            "title": self.title,
            "body": self.body,
            "data": self.data,
            "sound": "default",
            "priority": "high",
            # Collapse repeats for the same item rather than stacking them.
            "channelId": "expiry-reminders",
        }


@dataclass
class PushOutcome:
    token: str
    ok: bool
    receipt_id: str | None = None
    error: str | None = None

    @property
    def token_is_dead(self) -> bool:
        return self.error in DEAD_TOKEN_ERRORS


async def send(messages: list[PushMessage], *, timeout: float = 15.0) -> list[PushOutcome]:
    """Deliver a batch. Never raises; every message gets an outcome."""
    if not messages:
        return []

    outcomes: list[PushOutcome] = []

    for start in range(0, len(messages), MAX_BATCH):
        chunk = messages[start : start + MAX_BATCH]
        payload = [m.as_payload() for m in chunk]

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    EXPO_PUSH_URL,
                    json=payload,
                    headers={
                        "accept": "application/json",
                        "content-type": "application/json",
                    },
                )
            response.raise_for_status()
            tickets = (response.json() or {}).get("data") or []
        except Exception as exc:  # noqa: BLE001 - a failed send is retried, not raised
            logger.warning("expo_push_failed", extra={"reason": str(exc)[:200]})
            outcomes.extend(
                PushOutcome(token=m.token, ok=False, error=str(exc)[:200]) for m in chunk
            )
            continue

        # Expo returns one ticket per message, in order.
        for message, ticket in zip(chunk, tickets, strict=False):
            if ticket.get("status") == "ok":
                outcomes.append(
                    PushOutcome(token=message.token, ok=True, receipt_id=ticket.get("id"))
                )
            else:
                details = ticket.get("details") or {}
                outcomes.append(
                    PushOutcome(
                        token=message.token,
                        ok=False,
                        error=details.get("error") or ticket.get("message", "unknown"),
                    )
                )

        # A short batch means Expo returned fewer tickets than we sent.
        if len(tickets) < len(chunk):
            for message in chunk[len(tickets) :]:
                outcomes.append(
                    PushOutcome(token=message.token, ok=False, error="no ticket returned")
                )

    return outcomes
