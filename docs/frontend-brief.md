# Frontend brief

**For the Claude Code session working on the mobile app.** Read this first, then
[`api.md`](api.md) for the full endpoint reference.

---

## What this project is

**Pantry & Cosmetics Expiry Guardian** — a hackathon entry for MUMTEC x GDGoC MUM
x Averis (theme: *Practical AI Solutions for Real-World Impact*, UN SDGs).
Preliminary submission is **22 September 2026, 7:00 PM**.

Households throw out expired toiletries, medicine and packaged food because
tracking expiry dates by hand is tedious. The app lets someone photograph a
product label, extracts the expiry date via OCR, and sends reminders prioritised
by what expires soonest — plus usage suggestions and safe disposal instructions.

**Two people, split cleanly.** One owns the backend (FastAPI, Supabase, OCR,
notifications). You own the **frontend only**: React Native + Expo. Do not modify
anything under `backend/`. The API contract in `api.md` is the interface between
you.

---

## The backend already works

Every endpoint below is live and tested — nothing is blocked. `api.md` is the
full contract; this table is just an index into it.

| Screen | Endpoint | State |
|---|---|---|
| Login / signup | `supabase-js` directly | ready |
| Home / dashboard | `GET /v1/dashboard` | ready |
| Pantry list + filters | `GET /v1/items` | ready |
| Item detail | `GET /v1/items/{id}` | ready |
| Add manually | `POST /v1/items` | ready |
| Edit / mark opened | `PATCH /v1/items/{id}` | ready |
| Used it / binned it | `POST /v1/items/{id}/consume` · `/discard` | ready |
| Category picker | `GET /v1/categories` | ready |
| Settings | `GET /v1/me` · `PATCH /v1/me/preferences` | ready |
| Scan a brand photo | `POST /v1/products/identify-photo` | ready |
| Scan an expiry-date photo | `POST /v1/scans` (async, poll) | ready |
| Disposal/usage guidance | `GET /v1/guidance/...` | ready — curated, not AI |
| "What should I use this for?" | `GET /v1/ai/items/{id}/suggestions` | ready — AI, non-critical |
| "Ask Thyme" chat | `POST /v1/ai/ask` | ready — AI, non-critical |
| Add to calendar | client-side `.ics` / native calendar write (`lib/ics.ts`) | ready, no endpoint needed |

The scan flow is **two photos, not one**: first the product's brand/name
(`identify-photo`), then its expiry date (`/v1/scans`) — see `scan-product.tsx`
for the existing flow before building anything new here.

---

## Auth

**Supabase Auth, not Firebase.** If any Firebase Auth wiring exists, remove it.
Firebase remains in the project for push notifications only.

```
SUPABASE_URL      = https://vrdanstqtiuqtdfychcr.supabase.co
SUPABASE_ANON_KEY = sb_publishable_KHO1yoGo9V9JLV8FSbWuqg_vCe85yyF
```

That key is safe to ship in the app — it is the publishable key, and every table
is protected by row-level security. Cross-user isolation has been tested: users
cannot read, update or delete each other's rows.

Send the session token on every backend call:

```ts
const { data } = await supabase.auth.getSession();
const token = data.session?.access_token;
// headers: { Authorization: `Bearer ${token}` }
```

### Do not create new accounts

Email confirmation is enabled and Supabase's free SMTP allows roughly two
messages per hour. Signup will fail with `over_email_send_rate_limit`.

Two working accounts exist:

- `rlstest.a@sparkzone.app` — seeded with 12 realistic items covering every
  urgency state, including an expired one, items due today and tomorrow, and a
  sunscreen whose period-after-opening has lapsed
- `rlstest.b@sparkzone.app` — empty, for testing empty states

**Ask your teammate for the password** — it is deliberately not in this
repository, which is public.

---

## Getting the repository

It is public, so no access setup is needed:

```bash
git clone https://github.com/aicbncuicbanc2/Spark-Zone.git
cd Spark-Zone
```

If you already have it, `git pull` instead.

## Backend base URL

The backend moved off "runs on a laptop through a tunnel" — it's now a real,
always-on deployment:

```
https://expiry-guardian-api-113730041447.asia-northeast1.run.app
```

Check it before debugging anything else:

```bash
curl https://expiry-guardian-api-113730041447.asia-northeast1.run.app/health
```

It's Google Cloud Run, so it's up whether or not the backend developer's
laptop is — no more "only up while their machine is awake" caveat, and the URL
does not change on redeploy. `frontend/lib/config.ts` / `.env` should point
`EXPO_PUBLIC_API_BASE_URL` at this.

**The live web build of the whole app** (not just the API) is on GitHub Pages —
ask the backend developer for the current link if you need to see the latest
deployed frontend rather than running it locally; it redeploys automatically
on every push to `main` that touches `frontend/**` (see
`.github/workflows/deploy-pages.yml`).

### Running the backend yourself (optional)

Only needed if you want to work fully offline. Requires the real `.env`
values, which are deliberately not in the repository:

```bash
cd backend
python -m venv venv
source venv/bin/activate      # venv\Scripts\activate on Windows
pip install -r requirements-dev.txt
cp .env.example .env          # then fill in the Supabase + Gemini values from a teammate
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Skip `requirements-ml.txt` unless you need the camera endpoints working locally
— it pulls roughly 1.5 GB of OCR dependencies.

Interactive API docs, once running: `http://localhost:8080/docs`

---

## Five things that will bite you

### 1. Never recalculate dates on the client

The API returns `effective_expiry_date`, `days_remaining` and `urgency`
already computed, in the user's own timezone. **Display and sort on those.**

If you compute "days left" from `expiry_date` in JavaScript, you lose the entire
product differentiator. An opened sunscreen printed `2028-01-01` with a 6-month
period-after-opening genuinely expires *now* — `effective_expiry_date` knows
that, `expiry_date` does not.

`urgency` is one of `expired` · `critical` (0–1 days) · `soon` (2–3) ·
`upcoming` (4–7) · `ok` (>7). The five dashboard bucket counts always sum to
`total_active`, so a stacked bar needs no reconciliation.

### 2. Scanning is async — POST returns instantly, then you poll

**This changed after real testing found a real bug, so read this even if you
already wired up the scan screen.** `POST /v1/scans` used to hold the
connection open for the whole OCR run (2 to 40+ seconds depending on server
load) and return the full result in one response. On a real device that
failed: the connection got cancelled mid-request before the response ever
arrived, and the app showed a generic "scan failed" even though the backend
was still working correctly and finished successfully moments later.

The fix: `POST /v1/scans` now returns **immediately** —
`202 Accepted`, `{"status": "processing", "scan_id": "...", ...}` — and you
poll `GET /v1/scans/{scan_id}` every 1-2 seconds until `status` is no longer
`"processing"`. Every individual request is now short, so nothing has time to
be cancelled, however slow the actual OCR run turns out to be.

```
POST /v1/scans          -> 202 { status: "processing", scan_id: "..." }
GET /v1/scans/{id}       -> { status: "processing", ... }   (poll)
GET /v1/scans/{id}       -> { status: "processing", ... }   (poll)
GET /v1/scans/{id}       -> { status: "succeeded", extracted_expiry_date: "...", ... }
```

Stop polling and offer manual entry if it's still `processing` after roughly a
minute — at that point something has genuinely gone wrong, not just a slow
scan. `docs/api-samples/scan-processing.json` shows the initial response shape;
the existing `scan-succeeded.json` / `scan-needs-review.json` samples show what
polling eventually returns.

OCR gets dates wrong even when it succeeds. Once `status` resolves,
`needs_review` and `review_reason` tell you when to make the user confirm
rather than trust the read — for example a genuinely ambiguous six-digit date,
or a pack that only prints a manufacture date.

Prefill the form, never auto-save. When the user edits the date, send
`date_source: "user"` — that is how OCR accuracy gets measured.

A screen that cannot be corrected dies on the one bottle a judge hands over.

### 3. Push notifications need a development build

Remote push does **not** work in Expo Go on Android. You need
`expo-dev-client` + EAS. Find this out now, not on the day notifications get
wired up.

There is also an open decision — see below.

### 4. Errors have one shape

```json
{ "error": { "code": "ITEM_NOT_FOUND", "message": "...", "details": {} },
  "request_id": "9f2c1a4b" }
```

Branch on `error.code`, never on the message text. `TOKEN_EXPIRED` means refresh
the session and retry, not log the user out. Every response carries an
`X-Request-ID` header — quote it when reporting a backend bug.

### 5. The repository is public

Never commit `.env`, API keys, or the test account password.

---

## Build without the backend running

`docs/api-samples/` holds **real captured responses** for every endpoint. Use
them as mock data and you can build every screen before the backend is
reachable — the shapes are exactly what the API returns.

Read `docs/api-samples/README.md` first; it points out the four things most
likely to trip you up.

## Suggested build order

This was the original bootstrap order and items 1-7 are long done. Still
useful as a map of what exists and roughly the order it landed in:

1. **Login** — Supabase email/password, session persistence, sign out
2. **Dashboard** — `GET /v1/dashboard`, urgency buckets, the expiring-soon list
3. **Pantry list** — `GET /v1/items` with status and category filters
4. **Item detail** — including "mark as opened", which sets `opened_at` and
   `pao_months` and visibly shortens the effective expiry
5. **Manual add** — `POST /v1/items` with the category picker
6. **Consume / discard** actions
7. **Settings** — timezone, reminder lead days, quiet hours
8. **Two-photo scan flow** — brand/name photo (`identify-photo`, with a
   confirmable frame over the detected logo), then expiry-date photo
   (`/v1/scans`); `scan.tsx` is just two buttons that route into
   `scan-product.tsx`, which runs both steps
9. **Calendar export** (`lib/ics.ts`) — "Add to Calendar" on Item Detail and
   on Home's "Expiring soon" section
10. **AI features** — item suggestions (Item Detail) and "Ask Thyme" chat
    (floating button on Home) — see `api.md`'s AI section for what's
    deliberately curated vs. model-generated

Item 5 is not throwaway work: manual entry is the fallback when OCR misreads
during the demo.

---

## Decisions that have since been made

1. **Push notifications: Expo's push service** — `POST /v1/devices`'s
   `fcm_token` field is named for history but must actually be an
   `ExponentPushToken[...]`; the backend rejects a raw FCM token with 422.
2. **Deep link scheme: `expiryguardian://`** — set in `app.json`'s `scheme`.
3. **Expo Go vs. a development build — still worth confirming with whoever
   last tested push/calendar on a real device.** It matters more now than it
   did originally: `expo-calendar` and other config-plugin native modules
   were added for the calendar export feature, and those require a dev
   client/EAS build to actually run — Expo Go can't load them. The app's web
   build (GitHub Pages) doesn't exercise this at all, so native push and the
   direct-calendar-write path are both effectively untested on a real device
   as of this writing.

---

## Working agreement

- Stay out of `backend/`. If an endpoint is wrong or missing, say so and let the
  backend developer change it — do not work around it in the client.
- `api.md` is the contract. If the API does not behave as documented, that is a
  backend bug worth reporting, not something to patch over.
- Commit to a branch and open a pull request rather than pushing to `main`.
