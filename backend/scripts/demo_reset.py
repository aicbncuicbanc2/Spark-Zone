"""Reset the demo account to a known, good-looking state.

Run this before a rehearsal or the real thing. Live demos go wrong because the
data is wrong — an empty dashboard, everything expired, nothing in the bucket
you wanted to point at. This makes the pantry deterministic.

    python scripts/demo_reset.py                 # reset and reseed
    python scripts/demo_reset.py --reminder-in 60 # ...and fire a push in 60s
    python scripts/demo_reset.py --clear          # wipe, leave it empty

What it produces: every urgency bucket populated, a resolved item on each side
so the impact stats are non-zero, and — the one to point at — a sunscreen
printed for 2028 that is already expired because its period-after-opening
lapsed.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

from app.db.client import service_client

DEMO_USER_ID = "11111111-1111-4111-8111-111111111111"
DEMO_EMAIL = "rlstest.a@sparkzone.app"
MARKER = "[demo seed]"


DEMO_TZ = ZoneInfo("Asia/Kuala_Lumpur")


def _today() -> date:
    """The demo account's local date, which is what urgency is computed against."""
    return datetime.now(DEMO_TZ).date()


def _d(offset: int) -> str:
    return (_today() + timedelta(days=offset)).isoformat()


#: (name, brand, category, days_from_today, opened_days_ago, pao_months, qty, unit, place)
PANTRY: list[tuple] = [
    # --- expired -------------------------------------------------------------
    ("Fresh Milk 1L", "Dutch Lady", "food", -16, None, None, 1, "bottle", "Fridge"),
    ("Amoxicillin 500mg", "Duopharma", "medicine", -4, None, None, 12, "capsule", "Medicine box"),
    # The one to point at: printed 2028, but opened 190 days ago with a 6-month
    # period-after-opening, so it is expired today.
    ("Anessa Perfect UV Sunscreen", "Shiseido", "skincare", 480, 190, 6, 1, "bottle", "Bathroom shelf"),
    # --- critical (0-1 days) -------------------------------------------------
    ("Wholemeal Bread", "Gardenia", "food", 0, None, None, 1, "loaf", "Kitchen counter"),
    ("Greek Yogurt 500g", "Farm Fresh", "food", 1, None, None, 1, "tub", "Fridge"),
    # --- soon (2-3) ----------------------------------------------------------
    ("Maybelline Great Lash Mascara", "Maybelline", "cosmetic", 2, None, None, 1, "tube", "Dressing table"),
    ("Chicken Breast 500g", "Ayamas", "food", 3, None, None, 1, "pack", "Freezer"),
    # --- upcoming (4-7) ------------------------------------------------------
    ("Panadol Extra", "Haleon", "medicine", 5, None, None, 16, "tablet", "Medicine box"),
    ("Vitamin C 1000mg", "Blackmores", "supplement", 7, None, None, 30, "tablet", "Kitchen cabinet"),
    # --- ok ------------------------------------------------------------------
    ("Dettol Antiseptic 500ml", "Dettol", "household", 95, None, None, 1, "bottle", "Bathroom cabinet"),
    ("Nivea Deodorant Spray", "Nivea", "aerosol", 250, None, None, 1, "can", "Bathroom shelf"),
    ("Milo 1kg", "Nestle", "food", 400, None, None, 1, "tin", "Kitchen cabinet"),
]

#: Resolved items, so /v1/stats has a real save rate rather than zeroes.
RESOLVED: list[tuple] = [
    ("Eggs (10s)", "Nutriplus", "food", -2, "consumed"),
    ("Expired Cough Syrup", "Woods", "medicine", -30, "discarded"),
]


def clear(db) -> None:
    scans = db.table("scans").delete().eq("user_id", DEMO_USER_ID).execute()
    items = db.table("items").delete().eq("user_id", DEMO_USER_ID).execute()
    print(f"  cleared {len(items.data or [])} items, {len(scans.data or [])} scans")


def seed(db) -> list[dict]:
    rows = []
    for name, brand, cat, days, opened, pao, qty, unit, place in PANTRY:
        row = {
            "user_id": DEMO_USER_ID,
            "name": name,
            "brand": brand,
            "category_id": cat,
            "expiry_date": _d(days),
            "quantity": qty,
            "unit": unit,
            "storage_location": place,
            "date_source": "ocr",
            "status": "active",
            "notes": MARKER,
        }
        row["opened_at"] = _d(-opened) if opened is not None else None
        row["pao_months"] = pao if opened is not None else None
        row["resolved_at"] = None
        rows.append(row)

    for name, brand, cat, days, status in RESOLVED:
        rows.append({
            "user_id": DEMO_USER_ID,
            "name": name,
            "brand": brand,
            "category_id": cat,
            "expiry_date": _d(days),
            # quantity must be set explicitly. In a batch insert PostgREST sends
            # the union of all keys and fills the gaps with NULL, so a missing
            # key does NOT fall back to the column default — it violates the
            # NOT NULL constraint instead.
            "quantity": 1,
            "unit": None,
            "storage_location": None,
            "opened_at": None,
            "pao_months": None,
            "date_source": "ocr",
            "status": status,
            "resolved_at": datetime.now(timezone.utc).isoformat(),
            "notes": MARKER,
        })

    created = db.table("items").insert(rows).execute().data or []
    print(f"  seeded {len(created)} items")
    return created


def schedule_demo_push(db, items: list[dict], seconds: int) -> None:
    """Put one reminder just far enough out to demo it live.

    The sweep runs every 15 minutes, which is far too long to stand on a stage
    waiting for. This drops a row due in `seconds`, so the next sweep — or a
    manual trigger — sends it.
    """
    target = next(
        (i for i in items if i["name"].startswith("Anessa")),
        items[0] if items else None,
    )
    if target is None:
        print("  no item to attach a reminder to")
        return

    when = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    db.table("reminders").upsert(
        {
            "user_id": DEMO_USER_ID,
            "item_id": target["id"],
            "kind": "expired",
            "scheduled_for": when.isoformat(),
            "status": "pending",
        },
        on_conflict="item_id,kind",
    ).execute()
    print(f"  reminder for {target['name']!r} due in {seconds}s ({when:%H:%M:%S} UTC)")
    print("  it needs a registered device, and the sweep to run:")
    print("    curl -X POST <url>/v1/internal/reminders/sweep -H \"X-Internal-Secret: ...\"")


def summarise(db) -> None:
    rows = (
        db.table("items")
        .select("name,expiry_date,effective_expiry_date,status")
        .eq("user_id", DEMO_USER_ID)
        .order("effective_expiry_date")
        .execute()
        .data
        or []
    )
    today = _today()
    print(f"\n  {'item':32} {'printed':11} {'effective':11} days")
    print("  " + "-" * 62)
    for r in rows:
        if r["status"] != "active":
            continue
        eff = date.fromisoformat(r["effective_expiry_date"])
        flag = "  <-- PAO" if r["expiry_date"] != r["effective_expiry_date"] else ""
        print(f"  {r['name'][:32]:32} {r['expiry_date']} {r['effective_expiry_date']} {(eff - today).days:>4}{flag}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clear", action="store_true", help="wipe and stop")
    parser.add_argument(
        "--reminder-in", type=int, metavar="SECONDS",
        help="schedule one reminder this many seconds from now",
    )
    args = parser.parse_args()

    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY") and not (BACKEND / ".env").exists():
        print("No .env found; cannot reach Supabase.")
        return 1

    db = service_client()
    print(f"\nDemo account: {DEMO_EMAIL}")

    print("\n=== clearing ===")
    clear(db)
    if args.clear:
        print("\nDone — account is empty.\n")
        return 0

    print("\n=== seeding ===")
    items = seed(db)

    if args.reminder_in:
        print("\n=== demo push ===")
        schedule_demo_push(db, items, args.reminder_in)

    summarise(db)
    print("\nReady.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
