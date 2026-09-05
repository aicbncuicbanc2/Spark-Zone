"""Push token registration."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel, Field, field_validator

from app.core.errors import BadRequestError
from app.db.repositories import reminders as reminders_repo
from app.deps import CurrentUserDep, UserDbDep
from app.services.notifications import looks_like_expo_token

router = APIRouter()


class Platform(str, Enum):
    IOS = "ios"
    ANDROID = "android"
    WEB = "web"


class DeviceIn(BaseModel):
    #: An Expo push token, `ExponentPushToken[...]`. The app uses Expo's push
    #: service, which forwards to FCM and APNs, so this is not a raw FCM token.
    fcm_token: str = Field(min_length=10, max_length=500)
    platform: Platform
    device_name: str | None = Field(default=None, max_length=100)
    app_version: str | None = Field(default=None, max_length=30)

    @field_validator("fcm_token")
    @classmethod
    def _looks_right(cls, value: str) -> str:
        """Reject a raw FCM token early.

        Stored silently, it would fail on every send and only surface as
        "notifications don't work", which is a miserable thing to debug.
        """
        token = value.strip()
        if not looks_like_expo_token(token):
            raise ValueError(
                "Expected an Expo push token of the form ExponentPushToken[...]. "
                "Use Notifications.getExpoPushTokenAsync(), not a raw FCM token."
            )
        return token


class DeviceOut(BaseModel):
    id: str
    fcm_token: str
    platform: Platform
    device_name: str | None = None
    app_version: str | None = None
    last_seen_at: datetime
    created_at: datetime


@router.post(
    "",
    response_model=DeviceOut,
    status_code=status.HTTP_201_CREATED,
    summary="Register this device for push notifications",
)
async def register_device(
    payload: DeviceIn, user: CurrentUserDep, db: UserDbDep
) -> DeviceOut:
    """Idempotent — safe to call on every app launch and on token refresh.

    Re-registering the same token updates `last_seen_at` and un-revokes it,
    which is what happens when someone reinstalls the app.
    """
    row = reminders_repo.register_device(db, user.id, payload.model_dump(mode="json"))
    return DeviceOut(**row)


@router.get("", response_model=list[DeviceOut], summary="List my registered devices")
async def list_devices(user: CurrentUserDep, db: UserDbDep) -> list[DeviceOut]:
    return [DeviceOut(**row) for row in reminders_repo.list_devices(db, user.id)]


@router.delete(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Stop sending to a device",
)
async def revoke_device(
    user: CurrentUserDep,
    db: UserDbDep,
    token: Annotated[str, Query(min_length=10, max_length=500)],
) -> Response:
    """Call on sign-out so the next person on that phone gets nothing."""
    if not token.strip():
        raise BadRequestError("A token is required.", code="TOKEN_REQUIRED")
    reminders_repo.revoke_device(db, user.id, token.strip())
    return Response(status_code=status.HTTP_204_NO_CONTENT)
