-- =============================================================================
-- 0007_item_purchase_location.sql
--
-- "Where did you buy this from?" (the nearby-store suggestions feature) now
-- lets the user pick a real store to attach to the item, rather than only
-- tapping through to Maps - needs somewhere to actually save that choice.
-- Plain text (store name), not a place_id/lat-lng - this is a label the
-- user picked or typed, not something the app needs to look back up later.
--
-- APPLIED to project vrdanstqtiuqtdfychcr.
-- =============================================================================

alter table public.items
  add column purchase_location text;
