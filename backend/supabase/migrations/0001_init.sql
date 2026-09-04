-- =============================================================================
-- 0001_init.sql - Pantry & Cosmetics Expiry Guardian
-- Core schema: profiles, categories, products, scans, items, reminders,
--              devices, disposal_guidance.
-- Run this FIRST, then 0002_rls.sql, then the files in supabase/seed/.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.scan_status        as enum ('pending','processing','succeeded','failed','needs_review');
create type public.ocr_engine         as enum ('paddleocr','google_vision');
create type public.item_status        as enum ('active','consumed','discarded','expired');
create type public.date_source        as enum ('ocr','user','product_db','barcode_gs1');
create type public.product_source     as enum ('openfoodfacts','manual','other');
create type public.reminder_kind      as enum ('advance_7d','advance_3d','advance_1d','day_of','expired');
create type public.reminder_status    as enum ('pending','sent','failed','cancelled','suppressed');
create type public.guidance_condition as enum ('before_expiry','after_expiry');
create type public.guidance_severity  as enum ('info','caution','hazard');
create type public.device_platform    as enum ('ios','android','web');

-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $func$
begin
  new.updated_at = now();
  return new;
end;
$func$;

-- -----------------------------------------------------------------------------
-- profiles - one row per auth.users row, created automatically on signup
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text,
  -- Reminders are scheduled in the user's local time. A 3 AM push is worse than
  -- no push, so this must never be hardcoded server-side.
  timezone            text        not null default 'Asia/Kuala_Lumpur',
  -- Days before expiry to notify, e.g. {7,3,1}
  reminder_lead_days  smallint[]  not null default '{7,3,1}',
  quiet_hours_start   time        not null default '22:00',
  quiet_hours_end     time        not null default '08:00',
  push_enabled        boolean     not null default true,
  locale              text        not null default 'en',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint profiles_lead_days_sane
    check (array_length(reminder_lead_days, 1) between 1 and 5)
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-provision a profile whenever Supabase Auth creates a user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(coalesce(new.email, 'there@'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$func$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- categories - seeded lookup (a table, not an enum, so it stays extensible)
-- -----------------------------------------------------------------------------
create table public.categories (
  id                  text primary key,          -- 'medicine', 'cosmetic', ...
  label_en            text not null,
  label_ms            text,
  label_zh            text,
  -- Typical period-after-opening for this category, used to prefill items.
  default_pao_months  smallint,
  icon                text,
  sort_order          smallint not null default 100
);

-- -----------------------------------------------------------------------------
-- products - barcode cache, SHARED across all users
-- The second person to scan the same bottle gets an instant hit and we spend
-- one fewer call on the external product database.
-- -----------------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  barcode      text not null unique,
  name         text not null,
  brand        text,
  category_id  text references public.categories(id) on delete set null,
  image_url    text,
  source       public.product_source not null default 'openfoodfacts',
  raw          jsonb,
  fetched_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index products_category_idx on public.products (category_id);

-- -----------------------------------------------------------------------------
-- scans - the capture event and OCR audit trail
--
-- Deliberately NOT the same table as items. OCR gets dates wrong, users retry,
-- and low-confidence reads need review before they become pantry entries.
-- engines_attempted is also what lets you prove on stage that PaddleOCR ran
-- first and Google Vision rescued the read.
-- -----------------------------------------------------------------------------
create table public.scans (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  image_url              text,
  image_public_id        text,                    -- Cloudinary handle, for deletion
  status                 public.scan_status not null default 'pending',
  engine_used            public.ocr_engine,
  engines_attempted      jsonb not null default '[]'::jsonb,
  raw_text               text,
  ocr_confidence         numeric(4,3) check (ocr_confidence between 0 and 1),
  detected_barcode       text,
  product_id             uuid references public.products(id) on delete set null,
  extracted_expiry_date  date,
  date_confidence        numeric(4,3) check (date_confidence between 0 and 1),
  error_code             text,
  error_detail           text,
  processing_ms          integer,
  created_at             timestamptz not null default now(),
  completed_at           timestamptz
);

create index scans_user_created_idx on public.scans (user_id, created_at desc);
create index scans_status_idx       on public.scans (status) where status in ('pending','processing');

-- -----------------------------------------------------------------------------
-- items - the pantry itself
-- -----------------------------------------------------------------------------
create table public.items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  scan_id       uuid references public.scans(id)    on delete set null,  -- null = manual entry
  product_id    uuid references public.products(id) on delete set null,
  name          text not null,
  brand         text,
  category_id   text references public.categories(id) on delete set null,

  expiry_date   date not null,

  -- Period-after-opening: the little open-jar "12M" symbol on cosmetics.
  -- A sunscreen printed 2027 is genuinely unsafe six months after opening.
  opened_at     date,
  pao_months    smallint check (pao_months between 1 and 60),

  -- Every reminder, sort and dashboard bucket reads THIS column, never
  -- expiry_date directly. LEAST() ignores NULLs, so an unopened item simply
  -- falls back to its printed expiry date.
  effective_expiry_date date
    generated always as (
      least(
        expiry_date,
        (opened_at + make_interval(months => pao_months))::date
      )
    ) stored,

  quantity          numeric(10,2) not null default 1 check (quantity > 0),
  unit              text,
  storage_location  text,
  notes             text,
  date_source       public.date_source not null default 'ocr',
  status            public.item_status not null default 'active',
  resolved_at       timestamptz,                  -- when consumed/discarded
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint items_pao_requires_opened
    check (pao_months is null or opened_at is not null)
);

create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- The dashboard query. Partial index because consumed/discarded rows are cold.
create index items_user_expiry_idx
  on public.items (user_id, effective_expiry_date)
  where status = 'active';

create index items_user_status_idx on public.items (user_id, status);
create index items_scan_idx        on public.items (scan_id);

-- -----------------------------------------------------------------------------
-- reminders - one row per planned notification
-- -----------------------------------------------------------------------------
create table public.reminders (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.items(id) on delete cascade,
  user_id         uuid not null references auth.users(id)   on delete cascade,
  kind            public.reminder_kind   not null,
  scheduled_for   timestamptz            not null,
  status          public.reminder_status not null default 'pending',
  sent_at         timestamptz,
  fcm_message_id  text,
  attempt_count   smallint not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),

  -- NOT OPTIONAL. Without this, a Cloud Scheduler retry after a partial failure
  -- re-sends the same reminder and the notification spammer gets uninstalled.
  constraint reminders_unique_per_item_kind unique (item_id, kind)
);

-- The sweep query, running every 15 minutes forever.
create index reminders_due_idx
  on public.reminders (scheduled_for)
  where status = 'pending';

create index reminders_user_idx on public.reminders (user_id, scheduled_for);

-- -----------------------------------------------------------------------------
-- devices - FCM registration tokens
-- -----------------------------------------------------------------------------
create table public.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  fcm_token     text not null unique,
  platform      public.device_platform not null,
  device_name   text,
  app_version   text,
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,                       -- set on FCM 'UNREGISTERED'
  created_at    timestamptz not null default now()
);

create index devices_user_active_idx
  on public.devices (user_id)
  where revoked_at is null;

-- -----------------------------------------------------------------------------
-- disposal_guidance - curated advice, keyed by category and expiry state
--
-- locale is here from day one even though we seed English first: adding Malay
-- guidance later becomes a data task rather than a migration.
-- source_url matters - citing a real guideline reads as credible; unsourced
-- medical advice reads as a liability.
-- -----------------------------------------------------------------------------
create table public.disposal_guidance (
  id           uuid primary key default gen_random_uuid(),
  category_id  text not null references public.categories(id) on delete cascade,
  condition    public.guidance_condition not null,
  locale       text not null default 'en',
  title        text not null,
  body         text not null,
  steps        text[] not null default '{}',
  severity     public.guidance_severity not null default 'info',
  source_url   text,
  created_at   timestamptz not null default now(),

  constraint guidance_unique_per_key unique (category_id, condition, locale)
);

create index guidance_lookup_idx
  on public.disposal_guidance (category_id, condition, locale);
