-- =============================================================================
-- 0002_rls.sql - Row Level Security
--
-- Every user-owned table is locked to the calling user. The service-role key
-- bypasses RLS entirely, which is why app/db/client.py keeps it out of request
-- handlers.
--
-- Note the (select auth.uid()) wrapping rather than a bare auth.uid(). Postgres
-- evaluates the subquery once per statement as an InitPlan instead of once per
-- row, which is a large difference on a list query. Supabase recommends it and
-- the behaviour is identical.
--
-- APPLIED to project vrdanstqtiuqtdfychcr.
-- =============================================================================

alter table public.profiles          enable row level security;
alter table public.scans             enable row level security;
alter table public.items             enable row level security;
alter table public.reminders         enable row level security;
alter table public.devices           enable row level security;
alter table public.categories        enable row level security;
alter table public.products          enable row level security;
alter table public.disposal_guidance enable row level security;

-- -----------------------------------------------------------------------------
-- profiles - a user reads and edits only their own row.
-- No INSERT policy: rows are created by handle_new_user(), which is
-- SECURITY DEFINER and therefore not subject to these policies.
-- -----------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- -----------------------------------------------------------------------------
-- scans
-- -----------------------------------------------------------------------------
create policy scans_select_own on public.scans
  for select to authenticated using ((select auth.uid()) = user_id);

create policy scans_insert_own on public.scans
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy scans_update_own on public.scans
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy scans_delete_own on public.scans
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- items
-- -----------------------------------------------------------------------------
create policy items_select_own on public.items
  for select to authenticated using ((select auth.uid()) = user_id);

create policy items_insert_own on public.items
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy items_update_own on public.items
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy items_delete_own on public.items
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- reminders
-- The app reads its own schedule; only the sweep worker (service role) writes.
-- -----------------------------------------------------------------------------
create policy reminders_select_own on public.reminders
  for select to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- devices
-- -----------------------------------------------------------------------------
create policy devices_select_own on public.devices
  for select to authenticated using ((select auth.uid()) = user_id);

create policy devices_insert_own on public.devices
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy devices_update_own on public.devices
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy devices_delete_own on public.devices
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Reference data: readable by any signed-in user, written only by service role.
-- Note these are 'to authenticated', so a signed-out client sees nothing -
-- verified against the live project with an anon key.
-- -----------------------------------------------------------------------------
create policy categories_read on public.categories
  for select to authenticated using (true);

create policy products_read on public.products
  for select to authenticated using (true);

create policy guidance_read on public.disposal_guidance
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- Sanity check - run this manually as two different users:
--
--   select count(*) from public.items;
--
-- User A must never see User B's rows. If both see everything, RLS is not on
-- or your client is using the service-role key by mistake.
-- -----------------------------------------------------------------------------
