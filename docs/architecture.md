# Architecture — Pantry & Cosmetics Expiry Guardian

*MUMTEC x GDGoC MUM x Averis Hackathon — Practical AI Solutions for Real-World Impact*

Households throw out expired toiletries, medicine and food because tracking
expiry dates by hand is tedious. This app lets someone photograph a product
label; the backend extracts the expiry date via OCR, prioritises reminders by
what's expiring soonest, and gives usage or safe-disposal guidance —
addressing **SDG 12 (Responsible Consumption)** and **SDG 3 (Good Health)**.

This document covers the **backend** (FastAPI + Supabase + PaddleOCR). The
mobile frontend (React Native + Expo) is a separate codebase built by a
teammate against the contract in [`docs/api.md`](api.md).

---

## System overview

```mermaid
flowchart LR
    subgraph Phone["📱 Expo App"]
        UI[React Native UI]
    end

    subgraph Backend["FastAPI — 21 endpoints"]
        API[REST API]
        OCR["OCR Pipeline<br/>PaddleOCR fast → Vision → accurate"]
        Parser["Date Parser<br/>pure Python, no ML"]
        Sweep["Reminder Sweep<br/>every 15 min"]
    end

    subgraph External["External Services"]
        Supa[("Supabase<br/>Postgres + Auth + RLS")]
        Cloud[("Cloudinary<br/>image storage")]
        OFF[("Open Food Facts<br/>product lookup")]
        Expo[("Expo Push<br/>→ FCM / APNs")]
    end

    UI -- "HTTPS + JWT" --> API
    API -- "RLS-scoped queries" --> Supa
    API --> OCR --> Parser
    API -- "photo" --> Cloud
    API -- "barcode" --> OFF
    Sweep -- "due reminders" --> Expo --> UI
    UI -. "Supabase Auth login" .-> Supa
```

The app never talks to Supabase for pantry data directly — only for
authentication. Every read and write of `items`, `scans`, and `reminders`
goes through the backend, which holds the service-role key, the OCR models,
and the reminder-scheduling logic the client never sees.

---

## Why this stack

| Choice | Why |
|---|---|
| **FastAPI (Python)** | PaddleOCR is Python-native; async I/O suits many small Supabase round trips |
| **Supabase (Postgres)** | Row-Level Security enforces per-user isolation *in the database*, not just in application code — verified with real attack tests (below) |
| **PaddleOCR, tiered** | Handles Malay/Chinese label text; a fast/accurate two-tier chain cuts typical scan time from ~14s to ~3s (see *OCR pipeline*) |
| **Google Cloud Vision** | Fallback engine behind the same interface as PaddleOCR — live and verified; 5/7 correct alone on the real fixtures (weaker than PaddleOCR on one low-contrast, reflective label), so it stays a fallback rather than primary, but the full pipeline with it included still reads 6/7 with zero regression |
| **Cloudinary** | Label photo storage; scans still succeed if it's unreachable (best-effort) |
| **Expo Push → FCM/APNs** | Frontend's choice; backend never touches raw FCM tokens |

---

## The product's core differentiator: effective expiry

The printed date on a cosmetic is not always the date it becomes unsafe.
Sunscreens, in particular, carry a **period-after-opening** (PAO) symbol —
"12M" means unsafe 12 months after opening, regardless of the printed date.

```sql
effective_expiry_date date generated always as (
  least(expiry_date, (opened_at + make_interval(months => pao_months))::date)
) stored
```

Every sort, urgency bucket, reminder, and piece of disposal guidance reads
`effective_expiry_date`, never the printed date. A sunscreen printed for
**2028** that was opened seven months ago is correctly shown as **expired
today** — the single detail no simple "expiry tracker" app gets right.

---

## OCR pipeline: measured, not assumed

Every claim below was benchmarked against real, photographed product labels
in `backend/tests/fixtures/labels/` — not synthetic text.

```
fast PaddleOCR (mobile detector)   →  4/5 real labels,  ~3.5s
      │ escalates only on low confidence or no date found
      ▼
Google Vision (cloud, ~1-2s)       →  5/7 real labels, alone
      │ escalates only if still unresolved
      ▼
accurate PaddleOCR (server detector) → 5/5,            ~14s
```

Chaining fast-then-accurate keeps the common case fast (most scans resolve on
the first tier in 2–4s) while still recovering the hard cases. Vision runs
before the accurate tier, not after: both are only reached when fast tier
isn't good enough, and Vision is a ~1-2s cloud call against the accurate
tier's own local detector, measured at 14s under normal load and well over
100s under real memory pressure. Verified against all 7 real fixtures that
this ordering never costs accuracy — the pipeline always keeps the best-
scoring result across every engine actually tried, not just whichever ran
first, so a fast engine trying (and failing) before a slow one only ever
saves time. Every scan records `engines_attempted` — which tier ran, its
confidence, whether it found a date — so the escalation is auditable
per-request, not asserted.

**Real accuracy claims, both true and both worth stating precisely:**
- **7/7** at the parser level (clean printed text → correct date)
- **6/7** through the full OCR pipeline on real photos — one fixture (an
  embossed, no-ink toothpaste-tube date) is a documented, currently-unsolved
  OCR limitation, kept as an `xfail` rather than hidden or excluded

The ~3.5s fast-tier figure above is a local Windows-dev-machine measurement.
PaddlePaddle's oneDNN path turned out to be broken on Linux too, not just
Windows as first assumed — verified live on Cloud Run, every real scan hit
`(Unimplemented) ConvertPirAttribute2RuntimeAttribute not support` on both
tiers and silently fell back to Vision every time. Disabling oneDNN fixed
it (confirmed: fast tier now genuinely succeeds in production), but costs
real speed — measured at ~17s on Cloud Run for the same fixture that took
~3.5s locally. A tier that works at 17s is still strictly better than one
that always failed in 250ms and contributed nothing.

**The parser never guesses.** A six-digit date with no separator
(`EXP:210827`) is genuinely ambiguous between DD-MM-YY and YY-MM-DD — both
conventions exist in the wild — so it's returned with both readings and
flagged for the user to confirm. A pack printing only a *manufacture* date
returns `expiry_date: null`, however confident the read: reporting it as an
expiry would tell someone their item expired months ago.

**Barcodes carry identity, not dates.** Retail EAN-13/UPC codes encode a
product identifier only; the expiry always comes from OCR of printed text.
The two paths run concurrently (`asyncio.gather`) and merge in one scan
response. 7/7 real barcode photos decode correctly, including correctly
rejecting a non-retail CODE128 code and preferring an EAN-13 over a QR code
photographed in the same frame.

---

## Security

- **Every user table has Row-Level Security.** Verified with two real
  accounts, not just policy inspection: cross-user reads, writes, updates and
  deletes were attempted and confirmed blocked (`42501`) at the database
  layer.
- **JWT verified via Supabase's JWKS** (ES256), not a shared secret.
- **The service-role key never reaches a user-facing route** — reserved for
  the reminder sweep and reference-data writes, enforced by code review
  convention (`app/db/client.py`).
- Disposal guidance for medicine and chemicals is **curated, not
  LLM-generated** — every `hazard`-severity row cites a real published
  source (Malaysia's MOH Return Your Medicines Programme; US EPA guidance),
  because "where does this come from?" is a question a judge can ask.

### Privacy / PDPA stance

Thyme collects the minimum needed to function: a login email, the product
photos and item details a user chooses to scan or enter, and a
push-notification token for reminders. Data isn't sold or shared with third
parties. The Row-Level Security guarantee above is what actually enforces
per-user isolation, not just an access-control policy on paper.

Two things worth being upfront about, not glossing over:

- **Cross-border storage.** Supabase (`ap-northeast-1`) and Cloud Run
  (`asia-northeast1`) are both hosted in Tokyo, not Malaysia — a normal
  choice for a student project, but the honest answer if asked "where's the
  data stored" is "Google/Supabase infrastructure in Japan," not Malaysia.
- **No self-service account deletion yet.** Individual scans and items can
  be deleted today (`DELETE /v1/scans/{id}`, `DELETE /v1/items/{id}`), but a
  full "delete my account and all my data" flow isn't built — a real gap,
  tracked as future work rather than hidden.

---

## Data model

8 tables, 4 migrations, RLS on every user-owned one:

`profiles` · `categories` · `products` (shared barcode cache) · `scans`
(OCR audit trail, separate from items) · `items` · `reminders` ·
`devices` · `disposal_guidance` (15 seeded rows, English + Malay)

`scans` is deliberately not merged into `items`: OCR misreads, users retry,
and a low-confidence read shouldn't become a pantry entry without
confirmation. `reminders` carries `UNIQUE(item_id, kind)` so a retried sweep
can never send the same notification twice.

---

## API

21 endpoints under `/v1`, documented in [`docs/api.md`](api.md) — the
contract the frontend was built against, with real captured response
samples in `docs/api-samples/` so the app could be built before the
backend was reachable.

Every error shares one envelope (`{"error": {"code", "message", "details"}}`),
so the client branches on a stable code, never on message text.

---

## Reminders

Scheduled against **the user's own timezone and quiet hours**, not the
server's clock — a reminder fires at 09:00 local, not 09:00 UTC (which in
Kuala Lumpur is five in the afternoon). Quiet hours correctly wrap midnight.
Reminders hang off `effective_expiry_date`, so the PAO-lapsed sunscreen
above gets reminded on time despite its printed date being years out.

The sweep is an HTTP endpoint (`POST /v1/internal/reminders/sweep`), called
every 15 minutes by an external scheduler — Cloud Run scales to zero, so an
in-process timer would simply never fire. Verified against the real Expo
push API, including the failure path: a dead token correctly returns
`DeviceNotRegistered` and is pruned automatically rather than retried forever.

### Why someone opens Thyme on day 30, not just day 1

Retention isn't a separate feature bolted on — it comes from two things
already built above. Reminders pull the user back **passively**, at exactly
the moment something needs attention, so re-engagement doesn't depend on
remembering the app exists. `GET /v1/stats` (see *Guidance and stats* in
[`docs/api.md`](api.md)) turns that into something with a visible score:
`used_in_time` vs. `thrown_away` and a running `save_rate`, the same
mechanic that keeps people opening fitness or habit-tracking apps —
returning becomes about watching that number improve, not just scanning
something new. Structurally, the app also has recurring utility for free:
every new grocery or cosmetic purchase is a fresh reason to open it, not a
single onboarding event.

---

## Testing

**197 tests passing** in the default run, against the live Supabase project,
not mocks — RLS isolation, the OCR pipeline, barcode decoding, and reminder
scheduling are all exercised end-to-end. A further 8 tests, marked `slow`
because they invoke the real PaddleOCR models directly, run separately (7
passing, 1 honestly `xfail`ed — the documented embossed-date limitation
above). Fixture-driven: every recorded label and barcode becomes a test case
automatically, so adding a new photo adds coverage with no code change.

---

## Deployment — the honest version

Live on **Cloud Run** at a permanent URL
(`https://expiry-guardian-api-joepgih4la-an.a.run.app`), not a dev-machine
tunnel — `backend/scripts/deploy.ps1` moves secrets into Secret Manager and
runs this. Getting here surfaced two real production bugs, both fixed and
verified against live traffic, not just assumed fixed: a missing
`.gcloudignore` was silently uploading the local 3.3GB `venv/` as build
source on every earlier deploy attempt, and Cloud Run's default CPU
throttling (freezing CPU the instant an HTTP response is sent) meant
background OCR tasks never ran at all until `--no-cpu-throttling` was set.
The service runs at 4GiB memory / concurrency 1 — bumped up from an initial
2GiB / concurrency 4 after a real scan got OOM-killed and stuck retrying
mid-request, confirmed fixed by rerunning the same kind of scan afterward
with zero memory errors.

**Google Cloud touchpoints, all live:** Cloud Run (the API itself), Cloud
Scheduler (`expiry-guardian-api-sweep`, every 15 minutes, hitting
`POST /v1/internal/reminders/sweep` — no local loop involved), Cloud Vision
(see the OCR pipeline section above), Firebase Cloud Messaging (via Expo's
push service).

---

## What's next

The two-photo product identification flow (photo of the product's front for
brand + category, then a photo of the expiry date) has a functional starting
point on the frontend (`feat/product-photo-identify`, not yet merged) —
plain styling, no camera-preview polish, meant to be redesigned rather than
shipped as-is. Every backend endpoint it needs is already live and tested.

### Offline resilience — a stated design intent, not yet built

Today Thyme genuinely requires a network connection: a scan with no
connectivity fails outright, the same as any request to a backend that can't
be reached. There's no local queue-and-sync built — worth being upfront
about rather than implying otherwise.

The intended design, for when this gets built: label photos taken while
offline are queued in local device storage rather than dropped, with a
placeholder pantry entry ("scanned, not yet processed") so the user's action
still feels acknowledged; the queue drains automatically the moment
connectivity returns, running each photo through the same
`POST /v1/scans` flow it would have hit immediately online. Reads (the
dashboard, the pantry list) would similarly serve the last-fetched data from
local cache rather than an error screen, clearly marked as possibly stale.
This is deliberately scoped as a stated intent for now, not a commitment to
build before the hackathon deadline — it's honest roadmap, not a hidden gap.
