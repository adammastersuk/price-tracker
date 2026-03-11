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

## Database

Apply the schema in `supabase/schema.sql` to your Supabase Postgres database.

## Architecture

The app keeps the same modular design:

- `src/lib/adapters.ts` for competitor adapter interfaces
- `src/lib/pricing-logic.ts` for pricing and exception logic
- `src/lib/data-service.ts` for filtering/stat aggregation
- `src/lib/db/*` for Supabase persistence queries
- `src/app/api/*` for CRUD route handlers
- `src/components/*` for UI

## Features

- Dashboard KPIs
- Products grid with filtering, search and CSV export
- Exceptions queue
- Product detail panel with history chart
- Settings placeholders
- CSV import persisted to Supabase
- Mock adapter layer for future live integrations

## Important guardrail

This app does **not** perform automatic repricing. Competitor pricing is one signal among margin, stock and supplier context.
