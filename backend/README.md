# Expiry Guardian — Backend

FastAPI service for the Pantry & Cosmetics Expiry Guardian. Owns OCR, the pantry
database, and expiry reminders. The React Native app talks to it over the contract
in [`../docs/api.md`](../docs/api.md).

## Stack

| Concern | Choice |
|---|---|
| API | FastAPI (Python 3.11) |
| Database + Auth | Supabase (Postgres, RLS, Supabase Auth) |
| Primary OCR | PaddleOCR — handles Malay/Chinese label text |
| Fallback OCR | Google Cloud Vision |
| Image storage | Cloudinary |
| Push | Firebase Cloud Messaging |
| Hosting | Google Cloud Run + Cloud Scheduler |

## Local setup

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt      # core only — fast
Copy-Item .env.example .env              # then fill in the Supabase values
uvicorn app.main:app --reload --port 8080
```

Open http://localhost:8080/docs.

`requirements-ml.txt` (PaddleOCR, Vision, OpenCV) is installed in the Docker image
only. Install it locally just once, when you start work on the OCR pipeline —
it pulls roughly 1.5 GB.

### Verify

```powershell
pytest -q                                 # 16 tests, incl. live Supabase integration
curl http://localhost:8080/health
curl http://localhost:8080/health/ready   # 200 "ready" once .env is populated
```

`tests/test_supabase_integration.py` hits the live project and skips automatically
if `.env` is not populated. It covers the auth path — JWKS verification, RLS
scoping, service-role bypass, cross-user isolation, and the PAO calculation.
Run it before any deploy; those are the failures that are silent otherwise.

`/health` is deliberately dependency-free and always returns 200 — Cloud Run uses it
for liveness, and if it touched Supabase a brief outage there would kill healthy
revisions. `/health/ready` is the endpoint that tells the truth about configuration.

## Database

**Already applied** to project `vrdanstqtiuqtdfychcr` (region `ap-northeast-1`,
Postgres 17.6). These files are the source of truth if it ever needs rebuilding —
run them in order:

1. `supabase/migrations/0001_init.sql` — tables, enums, triggers, indexes
2. `supabase/migrations/0002_rls.sql` — Row Level Security policies
3. `supabase/migrations/0003_harden_functions.sql` — linter fixes
4. `supabase/seed/001_categories.sql` — 7 categories
5. `supabase/seed/002_disposal_guidance.sql` — 15 guidance rows

Both seeds are idempotent (`on conflict do update`), so re-running them is safe.

Auth uses **ES256 asymmetric signing** (verified via the project's JWKS endpoint),
so `SUPABASE_JWT_SECRET` is not needed.

### Verified against the live project

Anonymous access:
- Reads of `categories` and `items` return `[]`.
- Insert into `items` rejected with `42501`.

Authenticated isolation, using two real users signed in through GoTrue (ES256 tokens):
- A sees only A's items; B sees only B's. Same for `profiles`.
- A updating B's row by name affects **0 rows**.
- A deleting B's row affects **0 rows**.
- A inserting a row with `user_id = B` rejected with `42501`.
- B's data intact after all three attacks.
- Reference data (`categories`) readable once signed in — 7 rows.

Schema behaviour:
- `handle_new_user` auto-provisions a `profiles` row with `display_name` taken from
  signup metadata and correct defaults (`Asia/Kuala_Lumpur`, `{7,3,1}`, quiet hours).
- `effective_expiry_date` verified end to end through PostgREST: an item with
  `expiry_date 2027-12-01`, `opened_at 2026-06-15`, `pao_months 6` returned
  `effective_expiry_date 2026-12-15`.

Linters: no security findings owned by this project. Performance findings resolved
in `0004`, except "unused index" notices, which are expected with no traffic yet.

### Dev accounts

Two pre-confirmed accounts exist for local testing, created directly in `auth.users`
because email confirmation is enabled and the built-in SMTP is rate-limited:

- `rlstest.a@sparkzone.app`
- `rlstest.b@sparkzone.app`

Both share one password. **This repository is public, so the password is not
written here** — it lives in `TEST_USER_PASSWORD` in your local `.env`. Ask a
teammate for it, or reset it from the Supabase dashboard.

> These are shared-credential accounts. Fine for a dev project holding no real
> data; delete them before the project ever holds anything real:
> `delete from auth.users where email like 'rlstest.%@sparkzone.app';`
> (cascades to `profiles`, `items`, `scans`, `reminders`, `devices`.)

### ⚠️ Auth email is rate-limited

Email confirmation is **on**, and Supabase's built-in SMTP allows only a couple of
messages per hour on the free tier — signup returns `over_email_send_rate_limit`
once you exceed it. This will block your teammate from creating accounts in the app,
and it will break a live signup demo. Before Day 14, either turn off email
confirmation for the project or configure a custom SMTP provider.

### Schema notes

**`items.effective_expiry_date`** is a stored generated column:
`LEAST(expiry_date, opened_at + pao_months)`. Every sort, reminder and dashboard
bucket reads it — never `expiry_date` directly. `LEAST` ignores NULLs, so an unopened
item falls back to its printed date automatically.

> If Postgres rejects the generated column for immutability, replace it with a plain
> `date` column plus a `BEFORE INSERT OR UPDATE` trigger that computes the same
> expression. Nothing else in the codebase needs to change.

**`reminders` has `UNIQUE (item_id, kind)`.** This is what makes the sweep idempotent.
Without it a Cloud Scheduler retry re-sends notifications and the app gets uninstalled.

**`scans` is separate from `items` on purpose.** OCR misreads, users retry, and
low-confidence results need review before becoming pantry entries. `engines_attempted`
also records that PaddleOCR ran before Google Vision — useful evidence for judging.

## Deploy to Cloud Run

```powershell
gcloud run deploy expiry-guardian-api `
  --source . `
  --region asia-northeast1 `
  --allow-unauthenticated `
  --memory 2Gi `
  --cpu 2 `
  --timeout 300 `
  --set-env-vars "ENVIRONMENT=production" `
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=supabase-service-role:latest"
```

**Region: `asia-northeast1` (Tokyo), to match the Supabase project's
`ap-northeast-1`.** A single API request makes several database round trips, so
co-locating the API with the database matters more than putting it near the phone.
Do not deploy to `asia-southeast1` while the database is in Tokyo — that puts a
~70 ms hop on every individual query.

**On demo day**, pin a warm instance so nobody watches a cold start:

```powershell
gcloud run services update expiry-guardian-api --min-instances=1
```

Set it back to 0 afterwards to avoid burning credit.

## Layout

```
app/
  main.py              app factory, middleware, exception handlers
  config.py            settings; never hard-fails so /health survives a bad deploy
  deps.py              get_current_user, get_user_db, require_internal_caller
  core/
    security.py        Supabase JWT verification (JWKS + legacy HS256)
    errors.py          the single error envelope
    logging.py         structured JSON for Cloud Logging
  api/v1/routes/       one module per resource
  services/
    ocr/               base.py protocol + paddle_engine + vision_engine + pipeline
    date_parser.py     the hard part — EXP/BB/MFG across formats and languages
    barcode.py         decode + Open Food Facts lookup
    storage.py         Cloudinary
    guidance.py        curated advice lookup
    priority.py        urgency scoring
    notifications.py   FCM
  db/
    client.py          user_client (RLS) vs service_client (bypasses RLS)
    repositories/      query layer
  workers/
    reminder_sweep.py  invoked over HTTP by Cloud Scheduler
```

**Why the sweep is an HTTP endpoint, not an in-process scheduler:** Cloud Run scales
to zero, so APScheduler inside the app simply never fires. Cloud Scheduler calls
`POST /v1/internal/reminders/sweep` every 15 minutes with an OIDC token.

## Build order

| Days | Milestone | State |
|---|---|---|
| 1–2 | Scaffold, schema, RLS, seeds, auth verified end to end | ✅ done |
| 1–2 | `/health` deployed to Cloud Run | ⬜ blocked on gcloud + Docker install |
| 3–4 | JWT auth, items CRUD, `/v1/dashboard` | ⬜ |
| 5–7 | Cloudinary + PaddleOCR + `date_parser` (highest risk) | ⬜ |
| 8–9 | Google Vision fallback, barcode + Open Food Facts | ⬜ |
| 10–11 | FCM, devices, reminder sweep, Cloud Scheduler | ⬜ |
| 12–13 | Guidance, stats, hardening | ⬜ |
| 14–15 | Integration freeze with the app | ⬜ |
| 16–17 | Demo dry runs, warm instances, backup video | ⬜ |
| 18 | Buffer + submission materials | ⬜ |
