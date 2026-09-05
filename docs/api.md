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
`NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `UPSTREAM_ERROR`, `INTERNAL_ERROR`.

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
      "expiry_date": "2027-03-01",
      "opened_at": "2026-06-15",
      "pao_months": 12,
      "effective_expiry_date": "2027-03-01",
      "days_remaining": 178,
      "urgency": "ok",
      "status": "active",
      "date_source": "ocr",
      "image_url": "https://res.cloudinary.com/...",
      "created_at": "2026-09-04T10:00:00Z"
    }
  ],
  "page": { "total": 23, "limit": 50, "offset": 0 }
}
```

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

### `POST /v1/scans`
`multipart/form-data`, field name `image`. Max 8 MB, JPEG or PNG.

The response is **always** shaped with `status` so that if we later move OCR to a
background job, polling `GET /v1/scans/{id}` is the only change — this contract
does not break.

```json
{
  "scan_id": "uuid",
  "status": "succeeded",
  "image_url": "https://res.cloudinary.com/...",
  "extracted_expiry_date": "2026-11-30",
  "date_confidence": 0.91,
  "detected_barcode": "9556001234567",
  "product": { "id": "uuid", "name": "Panadol Extra", "brand": "Haleon", "category_id": "medicine" },
  "engine_used": "paddleocr",
  "raw_text": "EXP 30 NOV 2026 ...",
  "suggested_item": { "name": "Panadol Extra", "category_id": "medicine", "expiry_date": "2026-11-30" }
}
```

`status` values:

| status | meaning | what the app should do |
|---|---|---|
| `succeeded` | confident expiry date | prefill the form, still let the user edit |
| `needs_review` | read something, but confirm it | **prefill and require confirmation** — `review_reason` says why |
| `failed` | OCR could not read the image | offer manual entry |

`needs_review` fires for two real situations: an ambiguous date (six digits with
no separator can be DDMMYY *or* YYMMDD), and a pack that only prints a
manufacture date. In the second case `extracted_expiry_date` is `null` even
though a date was found — reporting a manufacture date as an expiry would tell
the user their item expired months ago.

When there is a genuine choice, `alternatives[]` carries the other readings with
their confidence and an explanation, so the app can offer options instead of a
guess.

`DELETE /v1/scans/{id}` removes a scan and its stored image. Items created from
it survive.

> Always let the user correct the date before it becomes an item. OCR will be
> wrong sometimes, and an app that can't be corrected dies on the one bottle a
> judge hands you.

### `GET /v1/scans/{id}` · `POST /v1/scans/{id}/retry`
`retry` accepts `?engine=google_vision` to force the fallback engine.

---

## ⬜ Reminders & devices (Day 10–11)

### `POST /v1/devices`
Register the Expo push token so reminders can reach the phone.

```json
{ "fcm_token": "...", "platform": "android", "device_name": "Pixel 7", "app_version": "1.0.0" }
```

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

## ⬜ Guidance, products, stats (Day 12–13)

- `GET /v1/items/{id}/guidance` — usage tip or disposal steps, chosen by category
  and whether the item has expired. Returns `severity` (`info` \| `caution` \|
  `hazard`) — **render `hazard` prominently**, it covers medicine and aerosols.
- ✅ `GET /v1/products/lookup?barcode=` — identity only; 404 `PRODUCT_NOT_FOUND` when
  unknown, which is normal for cosmetics and medicine. Returns `country` from the
  GS1 prefix and `cached` so you can tell a fresh lookup from a cached one.
- ✅ `GET /v1/categories` — populate pickers. Includes `label_ms` and `label_zh`, plus
  `default_pao_months` to prefill period-after-opening.
- `GET /v1/stats` — items saved vs. wasted, for the impact screen.

---

## Note on barcodes

Retail barcodes (EAN-13/UPC) **do not contain expiry dates**. The barcode gives us
product identity (name, brand, category); the expiry date always comes from OCR of
the printed text. Design the scan UI so both are captured in one photo where possible,
and never promise "scan the barcode, get the expiry".
