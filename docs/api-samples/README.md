# Real API responses

Captured from the live backend against the seeded test account. Every file is an
actual response, not a hand-written example — the field names, nesting, nulls and
date formats are exactly what the app will receive.

**Use these as mock data.** You can build every screen against them without the
backend running, then swap in real calls once it is reachable. If a screen works
against these files it will work against the API.

| file | endpoint |
|---|---|
| `dashboard.json` | `GET /v1/dashboard` |
| `items-list.json` | `GET /v1/items` |
| `item-detail.json` | `GET /v1/items/{id}` |
| `categories.json` | `GET /v1/categories` |
| `me.json` | `GET /v1/me` |
| `stats.json` | `GET /v1/stats` |
| `guidance-in-date-food.json` | `GET /v1/guidance?category=food` |
| `guidance-expired-medicine.json` | `GET /v1/guidance?category=medicine&expired=true` |
| `guidance-malay-medicine.json` | the same, `&locale=ms` |
| `product-lookup.json` | `GET /v1/products/lookup?barcode=` |
| `scan-succeeded.json` | `POST /v1/scans` — confident date |
| `scan-needs-review.json` | `POST /v1/scans` — manufacture date only |
| `scan-with-barcode.json` | `POST /v1/scans` — barcode and date in one photo |
| `error-not-found.json` | 404 |
| `error-validation.json` | 422 |
| `error-unauthorised.json` | 401 |

## Four things to notice before you build

**1. `item-detail.json` is the whole product thesis.**

```
expiry_date            2028-01-01
effective_expiry_date  2026-08-26
urgency                expired
```

A sunscreen printed for 2028, opened months ago, with a 6-month
period-after-opening. **Display and sort on `effective_expiry_date`.** Computing
"days left" from `expiry_date` in JavaScript would show this as fine for another
16 months, and the differentiator disappears from the UI.

`days_remaining` and `urgency` are already computed, in the user's timezone.
Do not recalculate them.

**2. `scan-needs-review.json` has `extracted_expiry_date: null`.**

The pack printed only a manufacture date. A date *was* found, and the backend
still refuses to report it as an expiry — otherwise the app would announce that
an item expired months ago. Read `review_reason` and ask the user for the date.

`scan-succeeded.json` is the happy path. Even there, let the user edit the date
before saving, and send `date_source: "user"` if they change it.

**3. `guidance-expired-medicine.json` has `severity: "hazard"`.**

Three severities: `info`, `caution`, `hazard`. Hazard covers medicine and
pressurised aerosols and should be visually prominent — it is the difference
between a tip and a safety instruction.

**4. Errors are all the same shape.**

```json
{ "error": { "code": "...", "message": "...", "details": {} }, "request_id": "..." }
```

Branch on `error.code`, never the message. `TOKEN_EXPIRED` means refresh the
session and retry, not sign the user out.

## Regenerating

These are a snapshot; relative dates in `dashboard.json` and `stats.json` drift.
The backend developer can refresh them from `backend/`. Ask if they look stale.
