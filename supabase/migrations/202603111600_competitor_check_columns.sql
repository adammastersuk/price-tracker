alter table public.competitor_prices
  add column if not exists last_check_status text not null default 'pending',
  add column if not exists check_error_message text,
  add column if not exists raw_price_text text,
  add column if not exists extraction_source text,
  add column if not exists suspicious_change_flag boolean not null default false;
