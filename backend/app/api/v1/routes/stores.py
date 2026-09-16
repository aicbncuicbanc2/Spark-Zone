"""Nearby-store suggestions — "which real, nearby shops plausibly sell this
kind of item," never a stock check. See services/places_client.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.core.errors import NotFoundError
from app.deps import CurrentUserDep, PlacesRateLimitDep, UserDbDep
from app.services.places_client import (
    PlacesUnavailable,
    autocomplete_stores,
    nearby_stores,
    store_details,
)

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


class StoreSuggestionOut(BaseModel):
    place_id: str
    main_text: str
    secondary_text: str


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


@router.get(
    "/search",
    response_model=list[StoreSuggestionOut],
    summary="Address/store search suggestions (type-ahead)",
)
async def search_stores(
    user: CurrentUserDep,
    _rate_limit: PlacesRateLimitDep,
    query: str = Query(..., min_length=1),
    lat: float | None = Query(None),
    lng: float | None = Query(None),
) -> list[StoreSuggestionOut]:
    """The type-and-pick-a-suggestion half of the manual store search (the
    other half is GET /v1/stores/{place_id}) - the same UX as a food
    delivery app's address search, for when GPS is unavailable or too
    imprecise (notably, most desktop browsers). Empty list degrades
    quietly, same contract as /nearby.
    """
    try:
        return [
            StoreSuggestionOut(**s) for s in await autocomplete_stores(query, lat=lat, lng=lng)
        ]
    except PlacesUnavailable:
        return []


@router.get("/{place_id}", response_model=StoreOut, summary="Resolve one store search suggestion")
async def get_store_details(
    place_id: str, user: CurrentUserDep, _rate_limit: PlacesRateLimitDep
) -> StoreOut:
    """Called once the user taps a /search suggestion, to get its real
    address/coordinates. A miss (bad place_id, Places unavailable) degrades
    to a 404 rather than a 500 - the frontend already has to handle "this
    store no longer resolves" as a normal case, same as any stale id."""
    try:
        store = await store_details(place_id)
    except PlacesUnavailable as exc:
        raise NotFoundError("Could not resolve that store right now.", code="STORE_NOT_FOUND") from exc
    return StoreOut(**store)
