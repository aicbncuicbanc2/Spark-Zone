-- =============================================================================
-- 0004_fk_covering_indexes.sql
--
-- Covering indexes for the three foreign keys flagged by the Supabase
-- performance linter (0001_unindexed_foreign_keys).
--
-- Without these, Postgres sequentially scans the child table to enforce the
-- constraint whenever a parent row is deleted or its key updated, and joins
-- from the parent side lose an access path. All three are small.
--
-- The linter's remaining "unused index" findings are expected and should be
-- ignored: the project has no query traffic yet, so nothing has been used.
--
-- APPLIED to project vrdanstqtiuqtdfychcr.
-- =============================================================================

create index if not exists items_category_idx on public.items (category_id);
create index if not exists items_product_idx  on public.items (product_id);
create index if not exists scans_product_idx  on public.scans (product_id);
