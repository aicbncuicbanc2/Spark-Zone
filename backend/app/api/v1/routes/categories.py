"""Category reference data — populates the frontend pickers."""

from __future__ import annotations

from fastapi import APIRouter
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


@router.get("", response_model=list[CategoryOut], summary="List product categories")
async def list_categories(user: CurrentUserDep, db: UserDbDep) -> list[CategoryOut]:
    """Includes Malay and Chinese labels so the app can localise its pickers.

    `default_pao_months` prefills period-after-opening when someone marks a
    cosmetic or skincare product as opened.
    """
    result = db.table("categories").select("*").order("sort_order").execute()
    return [CategoryOut(**row) for row in (result.data or [])]
