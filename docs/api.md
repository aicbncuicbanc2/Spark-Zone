# Expiry Guardian — API Contract

**Status legend:** ✅ live · 🟡 in progress · ⬜ planned

Base URL (local): `http://localhost:8080`
Base URL (deployed): _pending — Cloud Run deploy is blocked on gcloud auth_

Interactive docs: `GET /docs` (Swagger UI, generated from the live server)

---

## Conventions

**Auth.** Every endpoint under `/v1` except where noted requires a Supabase access token:

```
Authorization: Bearer <supabase_access_token>
```

Get it in the app from `supabase.auth.getSession()` → `data.session.access_token`. The
backend verifies it against the project's public keys; there is no separate backend login.

**Dates.** Calendar dates are `YYYY-MM-DD`. Timestamps are ISO-8601 UTC (`2026-09-22T11:00:00Z`).

**Errors.** Every failure has the same shape. Branch on `error.code`, never on the message.

```json
{
  "error": {
    "code": "ITEM_NOT_FOUND",
    "message": "No such item.",
    "details": {}
  },
  "request_id": "9f2c1a4b8d3e5f60"
}
```

Common codes: `AUTH_MISSING`, `AUTH_SCHEME`, `TOKEN_EXPIRED` (refresh and retry),
`TOKEN_INVALID`, `VALIDATION_ERROR` (`details.fields` lists the offenders),
`NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `UPSTREAM_ERROR`, `INTERNAL_ERROR`, `RATE_LIMITED`
(429 — `POST /v1/scans`, its retry, and `POST /v1/products/identify-photo` only, since
those are the endpoints that call billed Google Vision APIs; `details.limit` and
`details.window_seconds` say the actual threshold. Wait a moment and retry.).

**Request tracing.** Every response carries `X-Request-ID`. Send one and we echo it;
include it when reporting a bug and it can be found in the server logs.

---

## ✅ Health — no auth

### `GET /health`
Liveness. Always 200 while the process is up.

```json
{ "status": "ok", "service": "expiry-guardian-api", "environment": "production",
  "revision": "expiry-api-00004-xyz", "uptime_seconds": 1820.4 }
```

### `GET /health/ready`
Readiness. `200` when configured and Supabase is reachable, `503` otherwise.
Useful for confirming a deploy is actually wired up.

---

## ✅ Items — the pantry

### `GET /v1/items`
| Query param | Type | Notes |
|---|---|---|
| `status` | `active` \| `consumed` \| `discarded` \| `expired` | default `active` |
| `category` | category id | e.g. `medicine` |
| `expiring_within_days` | int | filter to the urgent tail |
| `sort` | `expiry` \| `created` \| `name` | default `expiry` |
| `limit` / `offset` | int | default 50 / 0 |

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Anessa Perfect UV Sunscreen",
      "brand": "Shiseido",
      "category_id": "skincare",

      "expiry_date": "2028-01-01",
      "opened_at": "2026-06-15",
      "pao_months": 6,
      "effective_expiry_date": "2026-12-15",
      "days_remaining": -12,
      "urgency": "expired",

      "quantity": 1,
      "unit": "bottle",
      "storage_location": "Bathroom shelf",
      "notes": null,

      "scan_id": "uuid or null",
      "product_id": "uuid or null",
      "image_url": "https://res.cloudinary.com/... or null",
      "date_source": "ocr",

      "status": "active",
      "resolved_at": null,
      "created_at": "2026-09-04T10:00:00Z",
      "updated_at": "2026-09-04T10:00:00Z"
    }
  ],
  "page": { "total": 23, "limit": 50, "offset": 0 }
}
```

`image_url` is the photo of the label the item was scanned from, resolved
through `scan_id`. It is `null` for a manually entered item, and `null` if the
scan's image was never stored. Deleting the scan clears it; the item survives.

`urgency` is computed server-side from `effective_expiry_date` so the app never
recalculates it: `expired` (< 0 days) · `critical` (0–1) · `soon` (2–3) ·
`upcoming` (4–7) · `ok` (> 7).

> **`effective_expiry_date` is the field to sort and display on.** It is
> `LEAST(expiry_date, opened_at + pao_months)` — for an opened sunscreen the
> period-after-opening can land well before the printed date.

### `POST /v1/items`
Create from a scan, from a corrected scan, or fully manually.

```json
{
  "name": "Panadol Extra",
  "brand": "Haleon",
  "category_id": "medicine",
  "expiry_date": "2026-11-30",
  "scan_id": "uuid or null",
  "product_id": "uuid or null",
  "opened_at": null,
  "pao_months": null,
  "quantity": 1,
  "storage_location": "Bathroom cabinet",
  "date_source": "user"
}
```

Only `name` and `expiry_date` are required. **Send `date_source: "user"` whenever the
user edited the OCR result** — it is how we measure OCR accuracy for the demo.

### `GET /v1/items/{id}` · `PATCH /v1/items/{id}` · `DELETE /v1/items/{id}`
`PATCH` accepts any subset of the create fields. Setting `opened_at` recalculates
`effective_expiry_date` and reschedules that item's reminders.

### ✅ `GET /v1/dashboard`
One call for the home screen — counts plus the urgent tail. Use this instead of
fetching all items and bucketing on the client.

```json
{
  "counts": { "expired": 2, "critical": 1, "soon": 3, "upcoming": 5, "ok": 12, "total_active": 23 },
  "expiring_soon": [ { "...item objects, soonest first, default 10 (?expiring_limit=)..." } ],
  "generated_at": "2026-09-04T10:00:00Z",
  "timezone": "Asia/Kuala_Lumpur"
}
```

The five buckets always sum to `total_active`, so you can render a stacked bar
straight from `counts` without reconciling anything.

---

## ✅ Scans — OCR

### `POST /v1/scans` — **asynchronous: poll for the result**

`multipart/form-data`, field name `image`. Max 8 MB, JPEG or PNG.

> **This used to be synchronous and no longer is — read this section even if
> you already integrated it.** OCR takes anywhere from 2 to 40+ seconds
> depending on server load. Holding one HTTP request open that long turned out
> to be genuinely unreliable on real devices: mobile OS timeouts and the
> tunnel itself cancel a connection held open that long, even though the
> backend was still working correctly. `POST` now returns **immediately**
> (`202 Accepted`) with `status: "processing"`, and you poll
> `GET /v1/scans/{id}` every 1-2 seconds until `status` changes. No individual
> request is ever open for more than a few seconds, so nothing has time to be
> cancelled.

**Immediately after POST:**

```json
{
  "scan_id": "uuid",
  "status": "processing",
  "extracted_expiry_date": null,
  "image_url": null,
  "engine_used": null,
  "engines_attempted": []
}
```

**Poll `GET /v1/scans/{id}` until `status` is no longer `"processing"`:**

```json
{
  "scan_id": "uuid",
  "status": "succeeded",
  "image_url": "https://res.cloudinary.com/...",
  "extracted_expiry_date": "2026-11-30",
  "date_confidence": 0.91,
  "detected_barcode": "9556001234567",
  "suggested_item": { "name": "Panadol Extra", "category_id": "medicine", "expiry_date": "2026-11-30" },
  "engine_used": "paddleocr",
  "raw_text": "EXP 30 NOV 2026 ..."
}
```

`status` values:

| status | meaning | what the app should do |
|---|---|---|
| `processing` | still working | keep polling — don't show an error yet |
| `succeeded` | confident expiry date | prefill the form, still let the user edit |
| `needs_review` | read something, but confirm it | **prefill and require confirmation** — `review_reason` says why |
| `failed` | OCR could not read the image | offer manual entry |

A reasonable poll loop: every 1.5-2 seconds, stop polling (and show a manual
entry option) if it's still `processing` after ~60 seconds — that would mean
something has actually gone wrong, not just a slow but working scan.

`needs_review` fires for two real situations: an ambiguous date (six digits with
no separator can be DDMMYY *or* YYMMDD), and a pack that only prints a
manufacture date. In the second case `extracted_expiry_date` is `null` even
though a date was found — reporting a manufacture date as an expiry would tell
the user their item expired months ago.

When there is a genuine choice, `alternatives[]` carries the other readings with
their confidence and an explanation, so the app can offer options instead of a
guess. This is only ever populated once `status` has left `processing` — poll
first, then read it.

`DELETE /v1/scans/{id}` removes a scan and its stored image. Items created from
it survive.

> Always let the user correct the date before it becomes an item. OCR will be
> wrong sometimes, and an app that can't be corrected dies on the one bottle a
> judge hands you.

### `GET /v1/scans/{id}` · `POST /v1/scans/{id}/retry`

`GET` is what you poll — see above. `retry` follows the exact same
create-then-poll shape (`202` immediately, poll `GET` for the result) and
accepts `?engine=google_vision` to force the fallback engine.

---

## ✅ Reminders & devices

### `POST /v1/devices`
Register the Expo push token so reminders can reach the phone.

```json
{ "fcm_token": "ExponentPushToken[...]", "platform": "android",
  "device_name": "Pixel 7", "app_version": "1.0.0" }
```

> **Send an Expo push token, not a raw FCM token.** Use
> `Notifications.getExpoPushTokenAsync()`. The field is named `fcm_token` for
> historical reasons, but a raw FCM token is rejected with a 422 explaining why —
> stored silently it would fail on every send and just look like "push is broken".

`DELETE /v1/devices?token=...` on sign-out, so the next person using that phone
gets nothing.

Call this after every login and whenever the token refreshes. Re-posting the same
token is safe (idempotent).

### `GET /v1/reminders`
Upcoming schedule, so the app can show "we'll remind you on Friday".

### ✅ `GET /v1/me` and `PATCH /v1/me/preferences`
```json
{ "timezone": "Asia/Kuala_Lumpur", "reminder_lead_days": [7, 3, 1],
  "quiet_hours_start": "22:00", "quiet_hours_end": "08:00", "push_enabled": true }
```

**Push notification payload** (what arrives on the device):
```json
{ "notification": { "title": "Expiring in 3 days", "body": "Anessa Sunscreen — use it before Sunday" },
  "data": { "item_id": "uuid", "kind": "advance_3d", "deep_link": "expiryguardian://items/uuid" } }
```

---

## ✅ Guidance and stats

- ✅ `GET /v1/guidance/items/{item_id}` — usage advice while in date, disposal
  steps once expired. The switch is made on `effective_expiry_date`, so an
  opened cosmetic past its period-after-opening gets disposal advice even when
  the printed date is years away. Returns `severity` (`info` | `caution` |
  `hazard`) — **render `hazard` prominently**, it covers medicine and aerosols.
  `locale` follows the user's profile; pass `?locale=ms` to override. Falls back
  to English, then to generic advice, so it never 404s.
- ✅ `GET /v1/guidance?category=medicine&expired=true` — same, without an item.
- ✅ `GET /v1/products/lookup?barcode=` — identity only; 404 `PRODUCT_NOT_FOUND` when
  unknown, which is normal for cosmetics and medicine. Returns `country` from the
  GS1 prefix and `cached` so you can tell a fresh lookup from a cached one.
- ✅ `POST /v1/products/identify-photo` — for when there's no barcode, or `/lookup`
  missed: identifies the **brand** and **category** from a photo of the product's
  own front/branding (multipart `image`, same as `/v1/scans`). Synchronous, not
  async like scans — it only calls Vision, no local PaddleOCR, so it's
  consistently fast (~1-2s), never the 2-40s+ that motivated scans being async.
  Returns `{brand, brand_confidence, raw_text, category_id, category_confidence}`.
  `brand` uses Logo Detection: precise when it hits (verified at 1.00 confidence
  on a real product) but inconsistent (a comparably well-known brand on a
  different real product returned nothing). `category_id` is one of the ids from
  `GET /v1/categories`, guessed from Label Detection — a real, different signal
  from the brand/OCR path, verified on a real product photo (`Food`/`Chocolate`/
  `Junk food` all over 0.6 confidence, correctly mapped to `food`). Both are
  `null` on a miss, which happens for either independently.
  **`raw_text` is deliberately never parsed into a suggested product name** — on
  the one real test photo, the most prominent text block was a misread brand
  (`"KOPIRO"` for `"KOPIKO"`) and the second-most-prominent was unrelated
  background text (a laptop sticker in the shot), so guessing a name from OCR
  text would silently offer a wrong or nonsense value. **Never treat a brand or
  category miss as an error** — always let the user type/confirm the name,
  brand, and category regardless of what comes back.
- ✅ `GET /v1/categories` — populate pickers. Includes `label_ms` and `label_zh`, plus
  `default_pao_months` to prefill period-after-opening.
- ✅ `GET /v1/stats` — the impact screen. `used_in_time` vs `thrown_away` and a
  `save_rate`, plus `by_category` counts and an `ocr` block reporting how often
  the extracted date was accepted without correction.

---

## Note on barcodes

Retail barcodes (EAN-13/UPC) **do not contain expiry dates**. The barcode gives us
product identity (name, brand, category); the expiry date always comes from OCR of
the printed text. Design the scan UI so both are captured in one photo where possible,
and never promise "scan the barcode, get the expiry".
