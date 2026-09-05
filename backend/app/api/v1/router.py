"""Aggregates every /v1 route module.

Routers are added here as each milestone lands.
"""

from fastapi import APIRouter

from app.api.v1.routes import (
    categories,
    dashboard,
    devices,
    guidance,
    internal,
    items,
    me,
    products,
    reminders,
    scans,
    stats,
)

api_router = APIRouter()

api_router.include_router(items.router, prefix="/items", tags=["items"])
api_router.include_router(scans.router, prefix="/scans", tags=["scans"])
api_router.include_router(products.router, prefix="/products", tags=["products"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(me.router, prefix="/me", tags=["me"])
api_router.include_router(categories.router, prefix="/categories", tags=["reference"])
api_router.include_router(guidance.router, prefix="/guidance", tags=["guidance"])
api_router.include_router(stats.router, prefix="/stats", tags=["stats"])
api_router.include_router(devices.router, prefix="/devices", tags=["devices"])
api_router.include_router(reminders.router, prefix="/reminders", tags=["reminders"])
api_router.include_router(internal.router, prefix="/internal", tags=["internal"])

# --- Still to come -----------------------------------------------------------
