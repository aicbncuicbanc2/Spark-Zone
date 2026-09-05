"""Endpoints called by infrastructure, not by the app."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.deps import require_internal_caller
from app.workers import reminder_sweep

router = APIRouter(dependencies=[Depends(require_internal_caller)])


@router.post("/reminders/sweep", summary="Send every reminder that is due")
async def sweep(limit: Annotated[int, Query(ge=1, le=500)] = 200) -> dict:
    """Called by Cloud Scheduler every fifteen minutes.

    An HTTP endpoint rather than an in-process scheduler because Cloud Run
    scales to zero, so a background job inside the app would never fire.

    Safe to retry: reminders are claimed by status and UNIQUE (item_id, kind)
    prevents a duplicate send.
    """
    result = await reminder_sweep.run(limit=limit)
    return {"status": "ok", **result.as_dict()}
