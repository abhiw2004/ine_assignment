-- ============================================================================
-- INE Product Price Tracker — Supabase (PostgreSQL) schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- All timestamps are stored as timestamptz (UTC).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- tracked_products: one row per (store product + selected option) being tracked
-- ----------------------------------------------------------------------------
create table if not exists public.tracked_products (
  id                 uuid primary key default gen_random_uuid(),
  store_product_id   integer      not null,              -- numeric id from /item/{id} URL
  slug               text,
  name               text         not null,
  brand              text,
  category           text,
  option_axis        text,                               -- e.g. "Set", "Kit", "Storage"
  option_id          text         not null,              -- e.g. "o1"
  option_label       text         not null,              -- e.g. "Single"
  url                text         not null,              -- https://demo.inelabteamdev.com/item/{id}
  active             boolean      not null default true,
  scrape_interval_min integer     not null default 120,   -- configurable per-product frequency (bonus)
  -- denormalised "latest" snapshot for fast dashboard rendering
  last_price         numeric(12,2),
  last_stock         integer,
  last_in_stock      boolean,
  last_scraped_at    timestamptz,
  last_outcome       text,                               -- success | retried | failed
  structure_fp       text,                               -- DOM structural fingerprint (change detection)
  created_at         timestamptz  not null default now(),
  updated_at         timestamptz  not null default now(),
  unique (store_product_id, option_id)                   -- never track the same product+option twice
);

create index if not exists idx_tracked_active on public.tracked_products (active);

-- ----------------------------------------------------------------------------
-- price_history: one row per SUCCESSFUL scrape (valid price+stock captured).
-- Never written on failure — we do not store wrong/empty data.
-- ----------------------------------------------------------------------------
create table if not exists public.price_history (
  id                bigint generated always as identity primary key,
  tracked_product_id uuid        not null references public.tracked_products(id) on delete cascade,
  price             numeric(12,2) not null,
  stock             integer       not null,
  in_stock          boolean       not null default true,
  mrp               numeric(12,2),                        -- original/list price (bonus info)
  badge_pct         integer,                              -- "30% saving"
  seller            text,
  rating            text,                                 -- e.g. "1.1k ratings"
  delivery          text,                                 -- e.g. "Arrives within 7 working days"
  raw_price_text    text,                                 -- exactly what the DOM showed (audit)
  raw_stock_text    text,
  scraped_at        timestamptz   not null default now()
);

create index if not exists idx_history_product_time
  on public.price_history (tracked_product_id, scraped_at desc);

-- ----------------------------------------------------------------------------
-- scrape_logs: one row per scrape ATTEMPT/run (success, retried, or failed).
-- This is the honest log + the source for the CSV export.
-- ----------------------------------------------------------------------------
create table if not exists public.scrape_logs (
  id                bigint generated always as identity primary key,
  tracked_product_id uuid        not null references public.tracked_products(id) on delete cascade,
  outcome           text         not null,                -- success | retried | failed
  attempts          integer      not null default 1,      -- internal tries used
  price             numeric(12,2),                        -- null when failed
  stock             integer,                              -- null when failed
  in_stock          boolean,
  latency_ms        integer,
  error             text,                                 -- reason when failed/retried
  structure_changed boolean      not null default false,  -- DOM fingerprint drifted
  raw_price_text    text,
  raw_stock_text    text,
  scraper_mode      text,                                 -- headless | headed
  created_at        timestamptz  not null default now()
);

create index if not exists idx_logs_product_time
  on public.scrape_logs (tracked_product_id, created_at desc);
create index if not exists idx_logs_outcome on public.scrape_logs (outcome);

-- ----------------------------------------------------------------------------
-- alerts: price-drop / back-in-stock events (bonus)
-- ----------------------------------------------------------------------------
create table if not exists public.alerts (
  id                bigint generated always as identity primary key,
  tracked_product_id uuid        not null references public.tracked_products(id) on delete cascade,
  kind              text         not null,                -- price_drop | price_rise | back_in_stock | out_of_stock | structure_changed
  message           text         not null,
  old_value         numeric(12,2),
  new_value         numeric(12,2),
  emailed           boolean      not null default false,
  created_at        timestamptz  not null default now()
);

create index if not exists idx_alerts_product_time
  on public.alerts (tracked_product_id, created_at desc);

-- ----------------------------------------------------------------------------
-- catalog_cache: optional server-side cache of the store catalog (960 items)
-- ----------------------------------------------------------------------------
create table if not exists public.catalog_cache (
  store_product_id integer primary key,
  payload          jsonb        not null,
  fetched_at       timestamptz  not null default now()
);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_tracked_updated on public.tracked_products;
create trigger trg_tracked_updated
  before update on public.tracked_products
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security: the backend uses the service-role key (bypasses RLS).
-- Enable RLS and allow anonymous READ so a frontend using the anon key can
-- render the dashboard without exposing write access. Writes go through the
-- backend only.
-- ----------------------------------------------------------------------------
alter table public.tracked_products enable row level security;
alter table public.price_history    enable row level security;
alter table public.scrape_logs      enable row level security;
alter table public.alerts           enable row level security;
alter table public.catalog_cache    enable row level security;

drop policy if exists "anon read tracked_products" on public.tracked_products;
create policy "anon read tracked_products" on public.tracked_products for select using (true);
drop policy if exists "anon read price_history" on public.price_history;
create policy "anon read price_history" on public.price_history for select using (true);
drop policy if exists "anon read scrape_logs" on public.scrape_logs;
create policy "anon read scrape_logs" on public.scrape_logs for select using (true);
drop policy if exists "anon read alerts" on public.alerts;
create policy "anon read alerts" on public.alerts for select using (true);
drop policy if exists "anon read catalog_cache" on public.catalog_cache;
create policy "anon read catalog_cache" on public.catalog_cache for select using (true);
