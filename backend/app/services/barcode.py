"""Barcode decoding and product identity lookup.

A barcode gives us *what the product is*. It does not give us when it expires —
retail EAN-13 and UPC encode a product identifier and nothing else. The expiry
date always comes from OCR of the printed text. The two paths merge in the scan
endpoint.

Verified against the real fixtures in tests/fixtures/barcodes/, which turned up
two cases worth designing for:

  * one photo contains a QR code *and* an EAN-13; the EAN is the product
  * one contains a CODE128 reading `110308`, which is an internal code, not a
    retail barcode - and six digits like that would parse as a date
"""

from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

#: Symbologies that actually identify a retail product, best first. Anything
#: else (QR, CODE128, CODE39, ITF) is a URL, an internal code or a batch number.
RETAIL_SYMBOLOGIES: tuple[str, ...] = ("EAN13", "UPCA", "EAN8", "UPCE")

OPEN_FOOD_FACTS_URL = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"

#: GS1 prefix ranges -> issuing country. Not where the product was made, but
#: useful context and a nice detail to surface in the UI.
_GS1_RANGES: tuple[tuple[int, int, str], ...] = (
    (0, 19, "USA / Canada"),
    (30, 39, "USA"),
    (300, 379, "France"),
    (400, 440, "Germany"),
    (450, 459, "Japan"),
    (460, 469, "Russia"),
    (471, 471, "Taiwan"),
    (480, 480, "Philippines"),
    (489, 489, "Hong Kong"),
    (500, 509, "United Kingdom"),
    (690, 699, "China"),
    (760, 769, "Switzerland"),
    (800, 839, "Italy"),
    (840, 849, "Spain"),
    (880, 880, "South Korea"),
    (884, 884, "Cambodia"),
    (885, 885, "Thailand"),
    (888, 888, "Singapore"),
    (890, 890, "India"),
    (893, 893, "Vietnam"),
    (899, 899, "Indonesia"),
    (930, 939, "Australia"),
    (955, 955, "Malaysia"),
    (958, 958, "Macau"),
)


@dataclass(frozen=True)
class DecodedBarcode:
    value: str
    symbology: str

    @property
    def is_retail(self) -> bool:
        return self.symbology in RETAIL_SYMBOLOGIES

    @property
    def country(self) -> str | None:
        return issuing_country(self.value)


def check_digit_valid(barcode: str) -> bool:
    """EAN-8/13 and UPC-A checksum.

    Guards against a misread. The last digit is chosen so the weighted sum of
    the others is divisible by ten.
    """
    if not barcode.isdigit() or len(barcode) not in (8, 12, 13):
        return False

    digits = [int(c) for c in barcode]
    body, check = digits[:-1], digits[-1]

    # Weights alternate 3,1,... from the right of the body.
    total = sum(d * (3 if (len(body) - index) % 2 == 1 else 1) for index, d in enumerate(body))
    return (10 - total % 10) % 10 == check


def issuing_country(barcode: str) -> str | None:
    if not barcode.isdigit() or len(barcode) < 8:
        return None
    prefix = int(barcode[:3])
    for low, high, name in _GS1_RANGES:
        if low <= prefix <= high:
            return name
    return None


def decode(image: bytes) -> list[DecodedBarcode]:
    """Every barcode found, retail symbologies first. Never raises."""
    try:
        from PIL import Image
        from pyzbar import pyzbar
    except ImportError:
        logger.warning("pyzbar_unavailable")
        return []

    try:
        with Image.open(io.BytesIO(image)) as picture:
            found = pyzbar.decode(picture)
    except Exception as exc:  # noqa: BLE001 - a failed decode is not a failed scan
        logger.warning("barcode_decode_failed", extra={"reason": str(exc)})
        return []

    results: list[DecodedBarcode] = []
    for item in found:
        try:
            value = item.data.decode("utf-8").strip()
        except (UnicodeDecodeError, AttributeError):
            continue
        if value:
            results.append(DecodedBarcode(value=value, symbology=item.type))

    # A photo can hold a QR code and an EAN at once; the EAN is the product.
    results.sort(key=lambda b: (not b.is_retail, b.symbology))
    return results


def best_product_code(image: bytes) -> DecodedBarcode | None:
    """The one barcode worth treating as a product identifier, if any.

    Deliberately strict. A CODE128 reading `110308` is an internal code, and
    accepting it would both fabricate a product identity and hand the date
    parser six digits that look exactly like a date.
    """
    for candidate in decode(image):
        if candidate.is_retail and check_digit_valid(candidate.value):
            return candidate
    return None


@dataclass(frozen=True)
class ProductInfo:
    barcode: str
    name: str | None
    brand: str | None
    category_id: str | None
    image_url: str | None
    source: str
    raw: dict | None = None


#: Open Food Facts category keywords -> our seeded category ids.
_CATEGORY_HINTS: tuple[tuple[str, str], ...] = (
    ("beverage", "food"),
    ("drink", "food"),
    ("food", "food"),
    ("snack", "food"),
    ("dairy", "food"),
    ("supplement", "supplement"),
    ("vitamin", "supplement"),
    ("medicine", "medicine"),
    ("pharmac", "medicine"),
    ("sunscreen", "skincare"),
    ("skin", "skincare"),
    ("cream", "skincare"),
    ("lotion", "skincare"),
    ("shampoo", "household"),
    ("cosmetic", "cosmetic"),
    ("makeup", "cosmetic"),
    ("deodorant", "aerosol"),
    ("spray", "aerosol"),
    ("cleaning", "household"),
    ("detergent", "household"),
)


def _guess_category(payload: dict) -> str | None:
    text = " ".join(
        str(payload.get(key, "")) for key in ("categories", "categories_tags", "product_name")
    ).lower()
    for keyword, category in _CATEGORY_HINTS:
        if keyword in text:
            return category
    return None


async def lookup_open_food_facts(barcode: str, *, timeout: float = 6.0) -> ProductInfo | None:
    """Ask Open Food Facts what this barcode is. Free, no key, best-effort.

    Coverage is strongest for food and thin for cosmetics and medicine, so a
    miss is normal and simply means the user types the name themselves.
    """
    if not barcode or not re.fullmatch(r"\d{8,14}", barcode):
        return None

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(
                OPEN_FOOD_FACTS_URL.format(barcode=barcode),
                headers={"User-Agent": "ExpiryGuardian/0.1 (hackathon project)"},
            )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001 - upstream failure must not fail a scan
        logger.warning(
            "open_food_facts_failed", extra={"barcode": barcode, "reason": str(exc)[:200]}
        )
        return None

    if payload.get("status") != 1:
        return None

    product = payload.get("product") or {}
    name = (
        product.get("product_name")
        or product.get("product_name_en")
        or product.get("generic_name")
        or None
    )
    if not name:
        return None

    return ProductInfo(
        barcode=barcode,
        name=name.strip()[:200],
        brand=(product.get("brands") or "").split(",")[0].strip()[:200] or None,
        category_id=_guess_category(product),
        image_url=product.get("image_front_url") or product.get("image_url"),
        source="openfoodfacts",
        raw={
            "categories": product.get("categories"),
            "quantity": product.get("quantity"),
            "countries": product.get("countries"),
        },
    )
