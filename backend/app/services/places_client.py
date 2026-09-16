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
_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
_DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"
_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location,places.types"
_DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location,types"

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
    # hardware_store/home_goods_store dropped from both of these - confirmed
    # live against a real item (a detergent, category "household"): those
    # types surfaced a furniture-and-electrical shop and a hardware supplier,
    # neither of which sells laundry detergent, insect spray, or air
    # freshener - the actual common contents of these two categories. Both
    # are everyday supermarket/minimart items in practice, not hardware-store
    # ones, even though "household" and "aerosol" sound hardware-adjacent.
    "aerosol": ["supermarket", "grocery_store", "convenience_store"],
    "household": ["supermarket", "grocery_store", "convenience_store"],
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


def _headers(field_mask: str) -> dict:
    settings = get_settings()
    if not settings.places_api_key:
        raise PlacesUnavailable("PLACES_API_KEY is not configured")
    return {
        "X-Goog-Api-Key": settings.places_api_key,
        "X-Goog-FieldMask": field_mask,
        "Content-Type": "application/json",
    }


async def _post(url: str, body: dict, *, field_mask: str = _FIELD_MASK) -> dict:
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(url, headers=_headers(field_mask), json=body)
        response.raise_for_status()
        return response.json()
    except PlacesUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 - any failure here must degrade, not crash
        logger.warning("places_call_failed", extra={"reason": str(exc)})
        raise PlacesUnavailable(str(exc)) from exc


async def _get(url: str, *, field_mask: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(url, headers=_headers(field_mask))
        response.raise_for_status()
        return response.json()
    except PlacesUnavailable:
        raise
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


async def autocomplete_stores(query: str, *, lat: float | None, lng: float | None) -> list[dict]:
    """Address/place suggestions for a free-text query, the same "type and
    pick from a dropdown" experience as a food-delivery app's address
    search - lets a user find the exact store they bought something from
    by name or address, without depending on the device's (sometimes
    wildly approximate, especially on desktop) GPS fix at all.
    """
    # Hard region restriction, not just a soft bias - the app's whole
    # userbase is Malaysia (see default_timezone), and without this, a
    # short/common query with no location fix yet (the user hasn't pressed
    # "Find nearby stores", or denied permission) returns whatever's most
    # globally prominent - confirmed live: searching "Guardian" with no
    # coordinates surfaced a Portland arcade and an Abu Dhabi tower before
    # the actual Malaysian Guardian pharmacy chain.
    body: dict = {"input": query, "includedRegionCodes": ["my"]}
    if lat is not None and lng is not None:
        # A soft bias on top of the region restriction - a typed search
        # should still surface a well-matching place elsewhere in Malaysia
        # rather than hide it, unlike nearby_stores' hard locationRestriction.
        body["locationBias"] = {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 20000.0}}

    data = await _post(
        _AUTOCOMPLETE_URL,
        body,
        field_mask=(
            "suggestions.placePrediction.placeId,"
            "suggestions.placePrediction.text,"
            "suggestions.placePrediction.structuredFormat"
        ),
    )
    suggestions = []
    for item in data.get("suggestions", []):
        prediction = item.get("placePrediction")
        if not prediction:
            continue
        structured = prediction.get("structuredFormat") or {}
        suggestions.append(
            {
                "place_id": prediction.get("placeId", ""),
                "main_text": (structured.get("mainText") or {}).get("text", ""),
                "secondary_text": (structured.get("secondaryText") or {}).get("text", ""),
            }
        )
    return suggestions


async def store_details(place_id: str) -> dict:
    """Resolves one autocomplete suggestion's place_id into the same shape
    nearby_stores/StoreOut uses (name, address, lat, lng, types) - the
    second step of the type-then-pick flow, called once the user has
    actually picked a suggestion."""
    data = await _get(_DETAILS_URL.format(place_id=place_id), field_mask=_DETAILS_FIELD_MASK)
    location = data.get("location") or {}
    return {
        "place_id": data.get("id", ""),
        "name": (data.get("displayName") or {}).get("text", ""),
        "address": data.get("formattedAddress", ""),
        "lat": location.get("latitude", 0.0),
        "lng": location.get("longitude", 0.0),
        "types": data.get("types", []),
    }
