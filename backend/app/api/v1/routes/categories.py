"""Category reference data — populates the frontend pickers."""

from __future__ import annotations

import re
import secrets

from fastapi import APIRouter, status
from pydantic import BaseModel

from app.deps import CurrentUserDep, UserDbDep

router = APIRouter()


class CategoryOut(BaseModel):
    id: str
    label_en: str
    label_ms: str | None = None
    label_zh: str | None = None
    default_pao_months: int | None = None
    icon: str | None = None
    sort_order: int


class CategoryCreate(BaseModel):
    label_en: str
    icon: str | None = None


@router.get("", response_model=list[CategoryOut], summary="List product categories")
async def list_categories(user: CurrentUserDep, db: UserDbDep) -> list[CategoryOut]:
    """Includes Malay and Chinese labels so the app can localise its pickers.

    `default_pao_months` prefills period-after-opening when someone marks a
    cosmetic or skincare product as opened. RLS already limits this to the
    shared built-ins (user_id is null) plus this caller's own custom ones -
    no filtering needed here.
    """
    result = db.table("categories").select("*").order("sort_order").execute()
    return [CategoryOut(**row) for row in (result.data or [])]


def _slugify(label: str) -> str:
    """A random suffix keeps two users' "Drinks" from colliding on the same
    primary key - categories.id is a single global namespace even though
    RLS scopes who can *see* a given row."""
    slug = re.sub(r"[^a-z0-9]+", "-", label.strip().lower()).strip("-")
    return f"{slug or 'category'}-{secrets.token_hex(4)}"


@router.post(
    "",
    response_model=CategoryOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a custom category",
)
async def create_category(
    body: CategoryCreate, user: CurrentUserDep, db: UserDbDep
) -> CategoryOut:
    """Scoped to the calling user - the RLS insert policy only allows
    user_id = auth.uid(), so this can never create a shared/global category,
    and the select policy means only its creator ever sees it again."""
    row = {
        "id": _slugify(body.label_en),
        "label_en": body.label_en.strip(),
        "icon": body.icon,
        "user_id": user.id,
    }
    result = db.table("categories").insert(row).execute()
    return CategoryOut(**result.data[0])
