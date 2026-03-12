create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.buyer_departments (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (buyer_id, department_id)
);

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  base_url text not null,
  domain text not null,
  adapter_key text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_buyer_departments_buyer on public.buyer_departments(buyer_id);
create index if not exists idx_buyer_departments_department on public.buyer_departments(department_id);
create index if not exists idx_competitors_enabled on public.competitors(is_enabled);

create or replace function public.set_app_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_buyers_updated_at on public.buyers;
create trigger trg_buyers_updated_at
before update on public.buyers
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_departments_updated_at on public.departments;
create trigger trg_departments_updated_at
before update on public.departments
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_competitors_updated_at on public.competitors;
create trigger trg_competitors_updated_at
before update on public.competitors
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
before update on public.app_settings
for each row execute procedure public.set_app_settings_updated_at();

insert into public.buyers (name, is_active)
values
  ('Tom Millen', true),
  ('Melanie Sykes', true),
  ('Faye Reppion', true),
  ('Laura Seddon', true),
  ('Meghan Blundell', true),
  ('Zack Sargent', true)
on conflict (name) do update set is_active = excluded.is_active;

insert into public.departments (name)
values
  ('Garden Furniture & Access'),
  ('BBQ & Ovens'),
  ('Xmas Decs'),
  ('Xmas Trees & Lighting'),
  ('Cookshop'),
  ('Candles & Room Fragrance'),
  ('Books'),
  ('Greeting Cards'),
  ('Giftware'),
  ('Floristry'),
  ('Toys'),
  ('Tabletop'),
  ('Clothing'),
  ('Jewellery'),
  ('Pets'),
  ('Foodhall'),
  ('Gardening'),
  ('Outdoor'),
  ('Houseplant Accessories')
on conflict (name) do nothing;

insert into public.buyer_departments (buyer_id, department_id)
select b.id, d.id
from (
  values
    ('Tom Millen', 'Garden Furniture & Access'),
    ('Tom Millen', 'BBQ & Ovens'),
    ('Melanie Sykes', 'Xmas Decs'),
    ('Melanie Sykes', 'Xmas Trees & Lighting'),
    ('Faye Reppion', 'Cookshop'),
    ('Faye Reppion', 'Candles & Room Fragrance'),
    ('Faye Reppion', 'Books'),
    ('Faye Reppion', 'Greeting Cards'),
    ('Laura Seddon', 'Giftware'),
    ('Laura Seddon', 'Floristry'),
    ('Laura Seddon', 'Toys'),
    ('Laura Seddon', 'Tabletop'),
    ('Meghan Blundell', 'Clothing'),
    ('Meghan Blundell', 'Jewellery'),
    ('Meghan Blundell', 'Pets'),
    ('Zack Sargent', 'Foodhall'),
    ('Zack Sargent', 'Gardening'),
    ('Zack Sargent', 'Outdoor'),
    ('Zack Sargent', 'Houseplant Accessories')
) as mappings(buyer_name, department_name)
join public.buyers b on b.name = mappings.buyer_name
join public.departments d on d.name = mappings.department_name
on conflict (buyer_id, department_id) do nothing;

insert into public.competitors (name, base_url, domain, adapter_key, is_enabled)
values
  ('Webbs', 'https://www.webbsdirect.co.uk/', 'www.webbsdirect.co.uk', 'generic', true),
  ('Ruxley Manor', 'https://www.ruxley-manor.co.uk/', 'www.ruxley-manor.co.uk', 'generic', true),
  ('Gates', 'https://www.gatesgardencentre.co.uk/', 'www.gatesgardencentre.co.uk', 'generic', true),
  ('British Garden Centres', 'https://www.britishgardencentres.com/shop/', 'www.britishgardencentres.com', 'generic', true),
  ('Scotsdales', 'https://scotsdalegardencentre.co.uk/', 'scotsdalegardencentre.co.uk', 'generic', true),
  ('Squires', 'https://www.squiresgardencentres.co.uk/shop/', 'www.squiresgardencentres.co.uk', 'generic', true),
  ('Yorkshire GCG', 'https://yorkshiregardencentres.co.uk/collections', 'yorkshiregardencentres.co.uk', 'generic', true),
  ('Whitehall', 'https://www.whitehallgardencentre.co.uk', 'www.whitehallgardencentre.co.uk', 'generic', true)
on conflict (name) do update
set base_url = excluded.base_url,
    domain = excluded.domain,
    adapter_key = excluded.adapter_key,
    is_enabled = excluded.is_enabled;

insert into public.app_settings (key, value)
values
  ('scrape_defaults', '{"staleCheckHours":24,"batchSize":50,"defaultRefreshFrequencyHours":24}'::jsonb),
  ('tolerance_settings', '{"inLinePricingTolerancePercent":3,"suspiciousLowPriceThresholdPercent":35,"suspiciousHighPriceThresholdPercent":80}'::jsonb)
on conflict (key) do update set value = excluded.value;
