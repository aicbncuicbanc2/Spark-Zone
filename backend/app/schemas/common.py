"""Shared response pieces."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Urgency(str, Enum):
    """How close an item is to being unusable.

    Computed server-side from effective_expiry_date so the app never has to
    recalculate it — and so the buckets can never drift between the two
    codebases.
    """

    EXPIRED = "expired"
    CRITICAL = "critical"
    SOON = "soon"
    UPCOMING = "upcoming"
    OK = "ok"


class Page(BaseModel):
    total: int = Field(description="Total rows matching the filter, ignoring pagination")
    limit: int
    offset: int


class Message(BaseModel):
    message: str
