alter table if exists public.competitor_prices
  add column if not exists extraction_metadata jsonb;
