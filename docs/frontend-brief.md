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

Ten endpoints are live and tested. You are not blocked on anything except the
camera screen.

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
| **Camera / scan** | `POST /v1/scans` | **not yet — build a placeholder** |

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

## Backend base URL

Nothing is deployed yet. Until it is, run it locally:

```powershell
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Then point the app at `http://<the backend machine's LAN IP>:8080` — not
`localhost`, which on a phone means the phone itself. Both devices must be on the
same wifi. A Cloud Run URL will replace this; keep the base URL in one config
constant so swapping it is a one-line change.

Interactive API docs: `http://localhost:8080/docs`

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

### 2. The scan result must always be editable

OCR gets dates wrong. `POST /v1/scans` returns `status: "needs_review"` and a
`review_reason` when it is unsure — for example a genuinely ambiguous six-digit
date, or a pack that only prints a manufacture date.

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

## Suggested build order

1. **Login** — Supabase email/password, session persistence, sign out
2. **Dashboard** — `GET /v1/dashboard`, urgency buckets, the expiring-soon list
3. **Pantry list** — `GET /v1/items` with status and category filters
4. **Item detail** — including "mark as opened", which sets `opened_at` and
   `pao_months` and visibly shortens the effective expiry
5. **Manual add** — `POST /v1/items` with the category picker
6. **Consume / discard** actions
7. **Settings** — timezone, reminder lead days, quiet hours
8. **Camera placeholder** — a button that routes nowhere yet

Item 5 is not throwaway work: manual entry is the fallback when OCR misreads
during the demo.

---

## Three decisions the backend is waiting on

Ask the human to answer these and pass them back to the backend developer. The
first blocks work that starts around day 10.

1. **Push notifications: Expo's push service, or raw FCM tokens?** This changes
   the backend's `devices` table and its sending code. It cannot be built until
   this is decided.
2. **Expo Go, or a development build?** Remote push requires the latter on
   Android.
3. **Is `expiryguardian://items/{id}` an acceptable deep link scheme?** That is
   what the notification payload currently assumes.

---

## Working agreement

- Stay out of `backend/`. If an endpoint is wrong or missing, say so and let the
  backend developer change it — do not work around it in the client.
- `api.md` is the contract. If the API does not behave as documented, that is a
  backend bug worth reporting, not something to patch over.
- Commit to a branch and open a pull request rather than pushing to `main`.
