-- =============================================================================
-- 0003_harden_functions.sql
--
-- Fixes three findings from the Supabase database linter after 0001/0002:
--
--   0011_function_search_path_mutable
--     Neither function pinned search_path. Without it, a caller can prepend a
--     schema of their own and shadow an unqualified object referenced inside
--     the function body. Pinning to '' forces full qualification; pg_catalog is
--     always implicitly searched, so now() and split_part() still resolve.
--
--   0028 / 0029_*_security_definer_function_executable
--     Both functions were reachable at /rest/v1/rpc/<name> by the anon and
--     authenticated roles. They are trigger functions and were never meant to
--     be callable directly.
--
-- Postgres checks EXECUTE permission when a trigger is CREATED, not when it
-- fires, so revoking here does not stop the existing triggers. Verified against
-- the live project with a throwaway table before and after.
--
-- APPLIED to project vrdanstqtiuqtdfychcr.
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $func$
begin
  new.updated_at = now();
  return new;
end;
$func$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
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

revoke all on function public.set_updated_at()  from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Still reported by the linter, deliberately NOT touched:
--
--   public.rls_auto_enable()
--
-- That is Supabase's own platform event trigger, which auto-enables RLS on any
-- new table created in the public schema. It returns `event_trigger`, so it
-- cannot do anything useful if invoked over PostgREST - calling an event
-- trigger function outside event-trigger context errors immediately. It is not
-- ours to modify and disabling it would remove a safety net.
-- -----------------------------------------------------------------------------
