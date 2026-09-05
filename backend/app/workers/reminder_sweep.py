"""The reminder sweep.

Cloud Scheduler calls POST /v1/internal/reminders/sweep every fifteen minutes.
It is an HTTP endpoint rather than an in-process scheduler because Cloud Run
scales to zero — an APScheduler job inside the app would simply never fire.

Idempotent by construction: reminders are claimed by status, and the
UNIQUE (item_id, kind) constraint means a retried sweep cannot send twice.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.db.repositories import reminders as reminders_repo
from app.services import notifications
from app.services.priority import today_for_user
from app.services.reminders import notification_text

logger = logging.getLogger(__name__)


@dataclass
class SweepResult:
    considered: int = 0
    sent: int = 0
    failed: int = 0
    suppressed: int = 0
    tokens_revoked: int = 0
    reasons: dict[str, int] = field(default_factory=dict)

    def suppress(self, reason: str) -> None:
        self.suppressed += 1
        self.reasons[reason] = self.reasons.get(reason, 0) + 1

    def as_dict(self) -> dict:
        return {
            "considered": self.considered,
            "sent": self.sent,
            "failed": self.failed,
            "suppressed": self.suppressed,
            "tokens_revoked": self.tokens_revoked,
            "suppressed_reasons": self.reasons,
        }


async def run(*, limit: int = 200) -> SweepResult:
    """Send every reminder that is due. Never raises."""
    result = SweepResult()

    due = reminders_repo.due_now(limit=limit)
    result.considered = len(due)
    if not due:
        return result

    user_ids = [row["user_id"] for row in due]
    tokens_by_user = reminders_repo.active_tokens_by_user(user_ids)
    push_enabled = reminders_repo.push_preferences(user_ids)

    messages: list[notifications.PushMessage] = []
    #: token -> the reminders riding on it, so receipts can be attributed back.
    owners: dict[str, list[str]] = {}

    for row in due:
        reminder_id = row["id"]
        user_id = row["user_id"]
        item = row.get("items") or {}

        # The item may have been used, binned or deleted since scheduling.
        if not item:
            reminders_repo.mark_suppressed(reminder_id, "item no longer exists")
            result.suppress("item_missing")
            continue
        if item.get("status") != "active":
            reminders_repo.mark_suppressed(reminder_id, f"item is {item.get('status')}")
            result.suppress("item_resolved")
            continue
        if not push_enabled.get(user_id, True):
            reminders_repo.mark_suppressed(reminder_id, "push disabled by the user")
            result.suppress("push_disabled")
            continue

        tokens = tokens_by_user.get(user_id) or []
        if not tokens:
            reminders_repo.mark_suppressed(reminder_id, "no registered device")
            result.suppress("no_device")
            continue

        days = 0
        try:
            from app.services.item_view import as_date

            days = (as_date(item["effective_expiry_date"]) - today_for_user(None)).days
        except Exception:  # noqa: BLE001 - copy only, not worth failing over
            days = 0

        title, body = notification_text(item, row["kind"], days)

        for token in tokens:
            messages.append(
                notifications.PushMessage(
                    token=token,
                    title=title,
                    body=body,
                    data={
                        "item_id": item.get("id"),
                        "kind": row["kind"],
                        "deep_link": f"expiryguardian://items/{item.get('id')}",
                    },
                )
            )
            owners.setdefault(token, []).append(reminder_id)

    if not messages:
        return result

    outcomes = await notifications.send(messages)

    #: A reminder counts as sent if it reached at least one of the user's devices.
    delivered: dict[str, str | None] = {}
    errors: dict[str, str] = {}

    for outcome in outcomes:
        for reminder_id in owners.get(outcome.token, []):
            if outcome.ok:
                delivered.setdefault(reminder_id, outcome.receipt_id)
            else:
                errors.setdefault(reminder_id, outcome.error or "unknown")

        if outcome.token_is_dead:
            reminders_repo.revoke_token_everywhere(outcome.token)
            result.tokens_revoked += 1

    for row in due:
        reminder_id = row["id"]
        if reminder_id in delivered:
            reminders_repo.mark_sent(reminder_id, delivered[reminder_id])
            result.sent += 1
        elif reminder_id in errors:
            reminders_repo.mark_failed(
                reminder_id, errors[reminder_id], int(row.get("attempt_count") or 0) + 1
            )
            result.failed += 1

    logger.info("reminder_sweep_completed", extra=result.as_dict())
    return result
