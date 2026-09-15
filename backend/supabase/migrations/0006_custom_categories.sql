-- =============================================================================
-- 0006_custom_categories.sql
--
-- The frontend's "+ New category" button has always existed, but
-- POST /v1/categories never did - creating one failed with a deliberate
-- "not supported yet" error rather than a silent 404. categories was a
-- single shared, curated taxonomy (no user_id at all) read by every user;
-- adding one here scopes a user-created category to just its creator
-- (built-ins keep user_id null and stay visible to everyone), instead of
-- opening the shared list to unmoderated inserts from anyone.
--
-- APPLIED to project vrdanstqtiuqtdfychcr.
-- =============================================================================

alter table public.categories
  add column user_id uuid references auth.users(id) on delete cascade;

create index categories_user_idx on public.categories (user_id);

drop policy categories_read on public.categories;

create policy categories_read on public.categories
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy categories_insert_own on public.categories
  for insert to authenticated
  with check (user_id = (select auth.uid()));
