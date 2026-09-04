"""The signed-in user's profile and reminder preferences."""

from __future__ import annotations

from fastapi import APIRouter

from app.db.repositories import profiles as profiles_repo
from app.deps import CurrentUserDep, UserDbDep
from app.schemas.profile import PreferencesUpdate, ProfileOut

router = APIRouter()


@router.get("", response_model=ProfileOut, summary="Get my profile")
async def get_me(user: CurrentUserDep, db: UserDbDep) -> ProfileOut:
    return ProfileOut(**profiles_repo.get_profile(db, user.id))


@router.patch("/preferences", response_model=ProfileOut, summary="Update my preferences")
async def update_preferences(
    payload: PreferencesUpdate, user: CurrentUserDep, db: UserDbDep
) -> ProfileOut:
    """Timezone, reminder lead days, quiet hours.

    Timezone matters more than it looks: every reminder is scheduled against the
    user's local date, so a wrong zone means notifications at 3 AM.
    """
    changes = payload.model_dump(mode="json", exclude_unset=True)
    return ProfileOut(**profiles_repo.update_profile(db, user.id, changes))
