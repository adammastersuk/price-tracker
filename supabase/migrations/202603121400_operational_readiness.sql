alter table if exists public.products
  add column if not exists refresh_tier text not null default 'default',
  add column if not exists refresh_frequency_hours integer;

alter table if exists public.products
  drop constraint if exists products_refresh_tier_check;

alter table if exists public.products
  add constraint products_refresh_tier_check check (refresh_tier in ('default','priority'));

alter table if exists public.price_history
  add column if not exists competitor_price_id uuid references public.competitor_prices(id) on delete set null,
  add column if not exists competitor_url text,
  add column if not exists current_price numeric(12,2),
  add column if not exists promo_price numeric(12,2),
  add column if not exists was_price numeric(12,2),
  add column if not exists captured_at timestamptz,
  add column if not exists last_check_status text,
  add column if not exists suspicious_change_flag boolean not null default false,
  add column if not exists extraction_source text,
  add column if not exists extraction_metadata jsonb;

update public.price_history
set captured_at = coalesce(captured_at, checked_at),
    current_price = coalesce(current_price, price)
where captured_at is null or current_price is null;

alter table if exists public.price_history
  alter column captured_at set default now();

create table if not exists public.refresh_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null,
  schedule_mode text not null,
  total integer not null default 0,
  processed integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  suspicious integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb
);

create table if not exists public.refresh_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.refresh_runs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  competitor_price_id uuid references public.competitor_prices(id) on delete set null,
  competitor_name text,
  competitor_url text,
  status text not null,
  suspicious boolean not null default false,
  duration_ms integer,
  error_message text,
  extraction_source text,
  checked_at timestamptz not null default now(),
  metadata jsonb
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  product_id uuid references public.products(id) on delete cascade,
  competitor_name text,
  reason text not null,
  gap_amount_gbp numeric(12,2),
  context jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table if exists public.alerts
  drop constraint if exists alerts_status_check;

alter table if exists public.alerts
  add constraint alerts_status_check check (status in ('new','acknowledged','resolved'));

create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  page text not null default 'products',
  scope_type text not null default 'global',
  scope_id text,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- uniqueness enforced by functional index below
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_price_history_product_captured on public.price_history(product_id, captured_at desc);
create index if not exists idx_price_history_competitor_capture on public.price_history(competitor_price_id, captured_at desc);
create index if not exists idx_refresh_run_items_competitor on public.refresh_run_items(competitor_name, checked_at desc);
create index if not exists idx_refresh_run_items_status on public.refresh_run_items(status, checked_at desc);
create index if not exists idx_alerts_status_created on public.alerts(status, created_at desc);
create index if not exists idx_saved_views_scope_page on public.saved_views(scope_type, scope_id, page, created_at desc);
create index if not exists idx_activity_log_created on public.activity_log(created_at desc);
create index if not exists idx_activity_log_entity on public.activity_log(entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at_generic()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_alerts_updated_at on public.alerts;
create trigger trg_alerts_updated_at
before update on public.alerts
for each row execute procedure public.set_updated_at_generic();

drop trigger if exists trg_saved_views_updated_at on public.saved_views;
create trigger trg_saved_views_updated_at
before update on public.saved_views
for each row execute procedure public.set_updated_at_generic();

create unique index if not exists idx_saved_views_unique_name on public.saved_views(page, scope_type, coalesce(scope_id, ''), name);
