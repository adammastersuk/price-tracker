create table if not exists public.product_cycle_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  run_id uuid references public.refresh_runs(id) on delete set null,
  checked_at timestamptz not null default now(),
  source_count integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  suspicious_count integer not null default 0,
  status text not null default 'pending',
  metadata jsonb
);

create table if not exists public.product_source_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  cycle_id uuid references public.product_cycle_history(id) on delete cascade,
  source_type text not null,
  source_name text not null,
  source_url text,
  checked_at timestamptz not null default now(),
  status text not null default 'pending',
  success boolean not null default false,
  current_price numeric(12,2),
  previous_price numeric(12,2),
  promo_price numeric(12,2),
  was_price numeric(12,2),
  stock_status text,
  extraction_source text,
  notes text,
  metadata jsonb
);

create index if not exists idx_product_cycle_history_product_checked on public.product_cycle_history(product_id, checked_at desc);
create index if not exists idx_product_cycle_history_status on public.product_cycle_history(status, checked_at desc);
create index if not exists idx_product_source_history_product_checked on public.product_source_history(product_id, checked_at desc);
create index if not exists idx_product_source_history_source on public.product_source_history(source_name, checked_at desc);
