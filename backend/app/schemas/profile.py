"""Profile and reminder-preference models."""

from __future__ import annotations

from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.priority import is_known_timezone


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    display_name: str | None = None
    timezone: str
    reminder_lead_days: list[int]
    quiet_hours_start: time
    quiet_hours_end: time
    push_enabled: bool
    locale: str
    created_at: datetime
    updated_at: datetime


class PreferencesUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    timezone: str | None = None
    reminder_lead_days: list[int] | None = Field(default=None, min_length=1, max_length=5)
    quiet_hours_start: time | None = None
    quiet_hours_end: time | None = None
    push_enabled: bool | None = None
    locale: str | None = Field(default=None, max_length=10)

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, value: str | None) -> str | None:
        """Reject unknown zones here rather than silently defaulting later.

        A user who sets 'Asia/KL' and is quietly given Kuala Lumpur anyway would
        never learn their reminders are on the wrong clock.
        """
        if value is None:
            return None
        if not is_known_timezone(value):
            raise ValueError(f"Unknown IANA timezone: {value!r}")
        return value

    @field_validator("reminder_lead_days")
    @classmethod
    def _sane_lead_days(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return None
        if any(d < 0 or d > 365 for d in value):
            raise ValueError("reminder_lead_days must each be between 0 and 365")
        # Descending and de-duplicated, so the sweep can rely on the ordering.
        return sorted(set(value), reverse=True)
