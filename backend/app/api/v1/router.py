"""Aggregates every /v1 route module.

Routers are added here as they land. Day 3-4 brings items/me, day 5-7 scans,
day 8-9 products, day 10-11 devices/reminders/internal, day 12-13 guidance/stats.
"""

from fastapi import APIRouter

api_router = APIRouter()

# --- Wired up as each milestone lands -----------------------------------------
# from app.api.v1.routes import items, me, scans, devices, reminders, guidance, stats, internal
# api_router.include_router(items.router,     prefix="/items",     tags=["items"])
# api_router.include_router(me.router,        prefix="/me",        tags=["me"])
# api_router.include_router(scans.router,     prefix="/scans",     tags=["scans"])
# api_router.include_router(devices.router,   prefix="/devices",   tags=["devices"])
# api_router.include_router(reminders.router, prefix="/reminders", tags=["reminders"])
# api_router.include_router(guidance.router,  prefix="/guidance",  tags=["guidance"])
# api_router.include_router(stats.router,     prefix="/stats",     tags=["stats"])
# api_router.include_router(internal.router,  prefix="/internal",  tags=["internal"])
