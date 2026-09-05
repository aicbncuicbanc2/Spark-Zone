"""Product identity lookup by barcode."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.core.errors import NotFoundError
from app.db.repositories import products as products_repo
from app.deps import CurrentUserDep, UserDbDep
from app.services import barcode as barcode_service

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
