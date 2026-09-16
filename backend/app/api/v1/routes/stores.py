"""Nearby-store suggestions — "which real, nearby shops plausibly sell this
kind of item," never a stock check. See services/places_client.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.deps import CurrentUserDep, PlacesRateLimitDep, UserDbDep
from app.services.places_client import PlacesUnavailable, nearby_stores

router = APIRouter()

# A single Nearby/Text Search radius - wide enough to be useful in a mall or
# suburban strip, narrow enough that "this is a store you just walked past"
# (the location-watch feature) doesn't match something a 20-minute drive away.
DEFAULT_RADIUS_M = 1500.0


class StoreOut(BaseModel):
    place_id: str
    name: str
    address: str
    lat: float
    lng: float
    types: list[str]


@router.get("/nearby", response_model=list[StoreOut], summary="Nearby stores for a category")
async def get_nearby_stores(
    user: CurrentUserDep,
    db: UserDbDep,
    _rate_limit: PlacesRateLimitDep,
    lat: float = Query(...),
    lng: float = Query(...),
    category_id: str | None = Query(None),
    radius_m: float = Query(DEFAULT_RADIUS_M, gt=0, le=5000),
) -> list[StoreOut]:
    """Empty list means "not available right now" (no key configured, a
    network hiccup) - same degrade-quietly contract as /v1/ai/*items/suggestions,
    never a 500 the frontend has to handle specially.
    """
    category_label = None
    if category_id:
        result = db.table("categories").select("label_en").eq("id", category_id).maybe_single().execute()
        category_label = (result.data or {}).get("label_en")

    try:
        stores = await nearby_stores(
            lat=lat, lng=lng, radius_m=radius_m, category_id=category_id, category_label=category_label
        )
    except PlacesUnavailable:
        return []

    return [StoreOut(**store) for store in stores]
