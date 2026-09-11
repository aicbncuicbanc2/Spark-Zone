"""Product identity lookup - by barcode, or by a photo of the product itself."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Query, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.core.errors import NotFoundError
from app.db.repositories import products as products_repo
from app.deps import CurrentUserDep, UserDbDep, VisionRateLimitDep
from app.services import barcode as barcode_service
from app.services.ocr import vision_engine
from app.services.uploads import read_image_upload

router = APIRouter()


class ProductOut(BaseModel):
    id: str | None = None
    barcode: str
    name: str | None = None
    brand: str | None = None
    category_id: str | None = None
    image_url: str | None = None
    source: str | None = None
    #: Issuing country from the GS1 prefix — where the code was registered,
    #: not necessarily where the product was made.
    country: str | None = None
    checksum_valid: bool = True
    cached: bool = False


@router.get("/lookup", response_model=ProductOut, summary="Look up a product by barcode")
async def lookup(
    user: CurrentUserDep,
    db: UserDbDep,
    barcode: Annotated[str, Query(min_length=8, max_length=14, pattern=r"^\d+$")],
) -> ProductOut:
    """Identity only — a barcode never contains an expiry date.

    Checks the shared cache first, then Open Food Facts. Coverage there is good
    for food and thin for cosmetics and medicine, so a miss is normal and simply
    means the user types the name in.
    """
    valid = barcode_service.check_digit_valid(barcode)
    country = barcode_service.issuing_country(barcode)

    cached = await run_in_threadpool(products_repo.get_by_barcode, db, barcode)
    if cached:
        return ProductOut(
            **{k: cached.get(k) for k in ("id", "name", "brand", "category_id", "image_url", "source")},
            barcode=barcode,
            country=country,
            checksum_valid=valid,
            cached=True,
        )

    info = await barcode_service.lookup_open_food_facts(barcode)
    if info is None:
        raise NotFoundError(
            "That barcode is not in the product database. Enter the details manually.",
            code="PRODUCT_NOT_FOUND",
            details={"barcode": barcode, "checksum_valid": valid, "country": country},
        )

    stored = await run_in_threadpool(
        products_repo.upsert,
        {
            "barcode": info.barcode,
            "name": info.name,
            "brand": info.brand,
            "category_id": info.category_id,
            "image_url": info.image_url,
            "source": info.source,
            "raw": info.raw,
        },
    )

    return ProductOut(
        id=(stored or {}).get("id"),
        barcode=info.barcode,
        name=info.name,
        brand=info.brand,
        category_id=info.category_id,
        image_url=info.image_url,
        source=info.source,
        country=country,
        checksum_valid=valid,
        cached=False,
    )


class ProductPhotoResult(BaseModel):
    brand: str | None = None
    brand_confidence: float | None = None
    #: Raw OCR text from the same photo, for the client to show or let the
    #: user pick a product name from - never parsed or guessed at here.
    raw_text: str | None = None
    #: Best-effort guess at one of the app's fixed category ids (see
    #: GET /v1/categories), from Vision's Label Detection - a different,
    #: more reliable signal for this narrower job than the raw OCR text.
    #: Null whenever no label clears the confidence bar; never a hard fail.
    category_id: str | None = None
    category_confidence: float | None = None


@router.post(
    "/identify-photo",
    response_model=ProductPhotoResult,
    summary="Identify a product's brand and category from a photo of its own front/branding",
)
async def identify_photo(
    user: CurrentUserDep,
    _rate_limit: VisionRateLimitDep,
    image: Annotated[UploadFile, File(description="Photo of the product's front/branding")],
) -> ProductPhotoResult:
    """Best-effort only - for when there is no barcode, or /lookup missed.

    Brand uses Google Vision's Logo Detection, not OCR: verified on a real
    product photo at 1.00 confidence, correctly naming the brand where plain
    OCR on the same photo both misread it and picked up unrelated background
    text with no way to tell that wasn't part of the product. But it is
    genuinely inconsistent - a comparably well-known brand on a different
    real product returned no logo at all. Category uses Label Detection,
    mapped onto this app's fixed category ids - see
    `vision_engine.identify_product`'s docstring for why that signal is used
    for category but deliberately not for guessing a product name. This
    never fails the request either way; a miss just comes back null, and the
    client must always let the user type or confirm the name/brand/category
    regardless of what comes back.
    """
    data = await read_image_upload(image)
    brand, brand_confidence, raw_text, category_id, category_confidence = await run_in_threadpool(
        vision_engine.identify_product, data
    )
    return ProductPhotoResult(
        brand=brand,
        brand_confidence=brand_confidence,
        raw_text=raw_text,
        category_id=category_id,
        category_confidence=category_confidence,
    )
