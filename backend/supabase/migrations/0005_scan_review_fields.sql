-- =============================================================================
-- 0005_scan_review_fields.sql
--
-- The scan endpoint moved from synchronous (one response carrying everything)
-- to async (GET is the only way the client ever sees the final result). That
-- exposed a real gap: review_reason, date_type and the alternative date
-- readings for an ambiguous scan were never persisted - they only ever
-- existed in memory, in the one response computed right after OCR ran. A
-- client polling GET would always get review_reason: null and
-- alternatives: [], even for a scan flagged needs_review, because nothing had
-- ever been written to the database for them.
--
-- APPLIED to project vrdanstqtiuqtdfychcr.
-- =============================================================================

alter table public.scans
  add column review_reason text,
  add column date_type text,
  add column alternatives jsonb not null default '[]'::jsonb;
