"""Google Places API (New) — "which nearby stores plausibly sell this item"
suggestions. Advisory only, same spirit as gemini_client.py: never a stock
check, never a promise the item is actually there, just "here's a real,
nearby place of the right kind."
"""

from __future__ import annotations

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
_TEXT_URL = "https://places.googleapis.com/v1/places:searchText"
_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location,places.types"

# Built-in category id -> Places API (New) "included types" (Table A). Not
# exhaustive or perfectly precise — a best-effort guess at what kind of shop
# carries this kind of item, same as default_pao_months is a best-effort
# typical value rather than a guarantee.
_CATEGORY_STORE_TYPES: dict[str, list[str]] = {
    "medicine": ["pharmacy", "drugstore"],
    "supplement": ["pharmacy", "drugstore", "supermarket"],
    "skincare": ["pharmacy", "drugstore"],
    "cosmetic": ["drugstore", "pharmacy"],
    "food": ["supermarket", "grocery_store", "convenience_store"],
    "aerosol": ["supermarket", "hardware_store"],
    "household": ["supermarket", "hardware_store", "home_goods_store"],
}


class PlacesUnavailable(Exception):
    """No key configured, a network failure, or a non-2xx response. Callers
    must degrade (empty list) rather than let this become a 500."""


def _parse_places(data: dict) -> list[dict]:
    stores = []
    for place in data.get("places", []):
        location = place.get("location") or {}
        stores.append(
            {
                "place_id": place.get("id", ""),
                "name": (place.get("displayName") or {}).get("text", ""),
                "address": place.get("formattedAddress", ""),
                "lat": location.get("latitude", 0.0),
                "lng": location.get("longitude", 0.0),
                "types": place.get("types", []),
            }
        )
    return stores


async def _post(url: str, body: dict) -> dict:
    settings = get_settings()
    if not settings.places_api_key:
        raise PlacesUnavailable("PLACES_API_KEY is not configured")

    headers = {
        "X-Goog-Api-Key": settings.places_api_key,
        "X-Goog-FieldMask": _FIELD_MASK,
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(url, headers=headers, json=body)
        response.raise_for_status()
        return response.json()
    except Exception as exc:  # noqa: BLE001 - any failure here must degrade, not crash
        logger.warning("places_call_failed", extra={"reason": str(exc)})
        raise PlacesUnavailable(str(exc)) from exc


async def nearby_stores(
    *, lat: float, lng: float, radius_m: float, category_id: str | None, category_label: str | None
) -> list[dict]:
    """Stores of a plausible type for category_id within radius_m of
    (lat, lng). Falls back to a free-text search on category_label for a
    category with no known type mapping (a custom, user-created one) -
    letting Places itself interpret what kind of shop that label means,
    rather than needing every future custom category added to
    _CATEGORY_STORE_TYPES by hand.
    """
    included_types = _CATEGORY_STORE_TYPES.get(category_id or "")

    if included_types:
        body = {
            "includedTypes": included_types,
            "maxResultCount": 10,
            "locationRestriction": {
                "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": radius_m}
            },
        }
        data = await _post(_NEARBY_URL, body)
        return _parse_places(data)

    query = f"{category_label} shop" if category_label else "shop"
    body = {
        "textQuery": query,
        "maxResultCount": 10,
        "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": radius_m}},
    }
    data = await _post(_TEXT_URL, body)
    return _parse_places(data)
