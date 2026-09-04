"""Request/response models for pantry items.

These models ARE the API contract — docs/api.md describes them in prose, but
this is what the frontend actually receives.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import Page, Urgency


class ItemStatus(str, Enum):
    ACTIVE = "active"
    CONSUMED = "consumed"
    DISCARDED = "discarded"
    EXPIRED = "expired"


class DateSource(str, Enum):
    OCR = "ocr"
    USER = "user"
    PRODUCT_DB = "product_db"
    BARCODE_GS1 = "barcode_gs1"


class ItemSort(str, Enum):
    EXPIRY = "expiry"
    CREATED = "created"
    NAME = "name"


class ItemBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=200)
    category_id: str | None = Field(default=None, max_length=50)
    expiry_date: date
    opened_at: date | None = None
    pao_months: int | None = Field(default=None, ge=1, le=60)
    quantity: float = Field(default=1, gt=0)
    unit: str | None = Field(default=None, max_length=30)
    storage_location: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _pao_requires_opened_at(self):
        """Mirrors the items_pao_requires_opened CHECK constraint.

        Catching it here turns a raw Postgres 23514 into a clean 422 that names
        the field, which is a much better experience for the app.
        """
        if self.pao_months is not None and self.opened_at is None:
            raise ValueError("opened_at is required when pao_months is set")
        return self


class ItemCreate(ItemBase):
    scan_id: str | None = None
    product_id: str | None = None
    date_source: DateSource = DateSource.USER


class ItemUpdate(BaseModel):
    """Every field optional — PATCH semantics.

    Note the sentinel problem: `opened_at: None` in JSON is indistinguishable
    from "not supplied" unless we check which keys were actually set, which is
    what exclude_unset gives us at the call site.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=200)
    category_id: str | None = Field(default=None, max_length=50)
    expiry_date: date | None = None
    opened_at: date | None = None
    pao_months: int | None = Field(default=None, ge=1, le=60)
    quantity: float | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, max_length=30)
    storage_location: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)
    status: ItemStatus | None = None
    date_source: DateSource | None = None


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    brand: str | None = None
    category_id: str | None = None

    expiry_date: date
    opened_at: date | None = None
    pao_months: int | None = None
    effective_expiry_date: date

    # Derived server-side, relative to the user's own timezone.
    days_remaining: int
    urgency: Urgency

    quantity: float
    unit: str | None = None
    storage_location: str | None = None
    notes: str | None = None

    scan_id: str | None = None
    product_id: str | None = None
    date_source: DateSource
    status: ItemStatus
    resolved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ItemListResponse(BaseModel):
    items: list[ItemOut]
    page: Page


class UrgencyCounts(BaseModel):
    expired: int = 0
    critical: int = 0
    soon: int = 0
    upcoming: int = 0
    ok: int = 0
    total_active: int = 0


class DashboardResponse(BaseModel):
    """Everything the home screen needs, in one request."""

    counts: UrgencyCounts
    expiring_soon: list[ItemOut]
    generated_at: datetime
    timezone: str
