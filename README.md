# Thyme

*Pantry & Cosmetics Expiry Guardian — MUMTEC x GDGoC MUM x Averis Hackathon,
"Practical AI Solutions for Real-World Impact"*

Households throw out expired food, cosmetics and medicine because tracking
expiry dates by hand is tedious. Thyme lets someone photograph a product
label; the backend extracts the expiry date via OCR, prioritises reminders by
what's expiring soonest, and gives usage or safe-disposal guidance —
addressing **SDG 12 (Responsible Consumption)** and **SDG 3 (Good Health)**.

The one detail most expiry-tracker apps miss: an opened cosmetic can expire
*before* its printed date, once its period-after-opening (PAO) is accounted
for. Thyme tracks that automatically.

## Repository layout

```
backend/    FastAPI + Supabase + PaddleOCR — see backend/README.md
frontend/   React Native (Expo) app
docs/       Architecture, the frontend/backend API contract, and captured
            sample responses the frontend was built against
```

## Where to start

- **Backend**: setup, local dev, tests, deploy — [`backend/README.md`](backend/README.md)
- **Architecture**: the full system, real measured numbers, what's tested — [`docs/architecture.md`](docs/architecture.md)
- **API contract**: every endpoint, request/response shapes — [`docs/api.md`](docs/api.md)
- **Frontend**: from `frontend/`, `npm install` then `npx expo start` (needs
  `frontend/.env` — copy `.env.example`, which already has real, safe-to-ship
  values for the deployed backend and Supabase anon key, no teammate needed)

## Stack at a glance

FastAPI · Supabase (Postgres + Auth + RLS) · PaddleOCR (primary OCR) ·
Google Cloud Vision (fallback) · Cloudinary · React Native / Expo ·
Expo push notifications
