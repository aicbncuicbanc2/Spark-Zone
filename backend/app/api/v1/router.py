"""Aggregates every /v1 route module.

Routers are added here as each milestone lands.
"""

from fastapi import APIRouter

from app.api.v1.routes import categories, dashboard, items, me, products, scans

api_router = APIRouter()

api_router.include_router(items.router, prefix="/items", tags=["items"])
api_router.include_router(scans.router, prefix="/scans", tags=["scans"])
api_router.include_router(products.router, prefix="/products", tags=["products"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(me.router, prefix="/me", tags=["me"])
api_router.include_router(categories.router, prefix="/categories", tags=["reference"])

# --- Still to come -----------------------------------------------------------
# Day 10-11: devices, reminders, internal (FCM + sweep worker)
# Day 12-13: guidance, stats
