# Bents Competitor Pricing Tracker

Internal decision-support tool for Bents Buying Team.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `CRON_SECRET` (required for `/api/cron/competitor-check`)
- `CHECK_BATCH_SIZE` (optional, defaults to `10`)
- `DEFAULT_PRICE_TOLERANCE` (optional, defaults to `3`)

## Database

1. Apply the base schema in `supabase/schema.sql`.
2. Apply migrations in `supabase/migrations/*` for incremental updates.

## Competitor check workflow

- Manual refresh endpoint: `POST /api/competitor/refresh`
  - body: `{ "productIds": ["..."] }` for selected rows or omit for all rows.
- Scheduled refresh endpoint: `GET /api/cron/competitor-check`
  - secured by `CRON_SECRET` via `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`
  - runs in production only unless `?force=1` is supplied for manual testing.
- Both flows:
  - execute adapter checks server-side
  - update `competitor_prices`
  - write `price_history`
  - mark failed checks with structured error status
  - preserve prior valid prices on failed checks

## Vercel cron setup

`vercel.json` includes a daily cron:

```json
{
  "crons": [{ "path": "/api/cron/competitor-check", "schedule": "0 4 * * *" }]
}
```

Ensure `CRON_SECRET` is configured in Vercel project environment variables.

## Architecture

- `src/lib/competitor-check/adapters.ts` modular adapter system
  - robust mock adapter
  - generic HTML extractor adapter
  - retailer-specific placeholders
- `src/lib/competitor-check/runner.ts` batch processing, resilience, and persistence
- `src/lib/pricing-logic.ts` pricing status logic and configurable tolerance
- `src/lib/data-service.ts` exception queue categorization
- `src/lib/db/*` Supabase persistence helpers
- `src/app/api/*` route handlers for products/import/check workflows
- `src/components/*` UI (manual refresh, detail diagnostics, exceptions)

## Important guardrail

This app does **not** perform automatic repricing. Competitor pricing is one signal among margin, stock and supplier context, and must be reviewed by users independently.
