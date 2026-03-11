alter table if exists public.competitor_prices
  add constraint competitor_prices_product_competitor_unique
  unique (product_id, competitor_name, competitor_url);
