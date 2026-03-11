create extension if not exists "pgcrypto";

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  brand text,
  department text,
  buyer text,
  supplier text,
  cost_price numeric(12,2),
  bents_price numeric(12,2) not null,
  margin_percent numeric(8,2),
  product_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competitor_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  competitor_name text not null,
  competitor_url text,
  competitor_current_price numeric(12,2),
  competitor_promo_price numeric(12,2),
  competitor_was_price numeric(12,2),
  competitor_stock_status text,
  last_checked_at timestamptz not null default now(),
  price_difference_gbp numeric(12,2),
  price_difference_percent numeric(8,2),
  pricing_status text,
  last_check_status text not null default 'pending',
  check_error_message text,
  raw_price_text text,
  extraction_source text,
  suspicious_change_flag boolean not null default false
);

alter table if exists public.competitor_prices
  add constraint competitor_prices_product_competitor_unique
  unique (product_id, competitor_name, competitor_url);

create table if not exists public.product_notes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  note text not null,
  owner text,
  workflow_status text,
  created_at timestamptz not null default now()
);

create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  competitor_name text not null,
  price numeric(12,2),
  checked_at timestamptz not null default now()
);

create index if not exists idx_products_department on public.products(department);
create index if not exists idx_competitor_prices_product_id on public.competitor_prices(product_id);
create index if not exists idx_product_notes_product_id on public.product_notes(product_id);
create index if not exists idx_price_history_product_id on public.price_history(product_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute procedure public.set_updated_at();
