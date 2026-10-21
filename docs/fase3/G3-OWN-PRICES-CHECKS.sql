-- Read-only review gates. Not executed against any hosted environment by this task.
-- Capture counts before/after a separately authorized deployment. No price or
-- budget backfill is part of this migration.
select count(*) as bank_prices, count(*) filter(where is_manual_override) as manual_prices
from public.price_items;
select count(*) as budget_lines, sum(subtotal) as sale_amount, sum(subtotal_cost) as cost_amount
from public.budget_items;

-- AFTER ONLY: schema, private instrumentation, unchanged RPC boundary.
select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and (table_name,column_name) in
  (('price_items','collection_budget_id'),('budget_items','price_item_id'));
select relrowsecurity from pg_class where oid='public.user_price_collection_events'::regclass;
select role_name,
  has_table_privilege(role_name,'public.user_price_collection_events','SELECT') as can_read_with_rls,
  has_table_privilege(role_name,'public.user_price_collection_events','INSERT') as can_insert,
  has_table_privilege(role_name,'public.user_price_collection_events','UPDATE') as can_update,
  has_table_privilege(role_name,'public.user_price_collection_events','DELETE') as can_delete
from (values ('anon'),('authenticated')) r(role_name);
-- Expected: authenticated SELECT subject to owner RLS, no INSERT/UPDATE/DELETE;
-- anon no privileges. Trigger helpers remain inaccessible directly.
select role_name,
  has_function_privilege(role_name,'budget_internal.record_collected_price()','EXECUTE') as can_collect_directly,
  has_function_privilege(role_name,'budget_internal.record_own_price_reuse()','EXECUTE') as can_reuse_directly
from (values ('anon'),('authenticated')) r(role_name);
select price_source_type,count(*) as lines from public.budget_items group by price_source_type;
select count(*) as invalid_own_evidence from public.budget_items
where price_source_type='user_supplied' and
  (price_confidence is distinct from 0.95 or price_checked_at is null);
-- Aggregate identifiers/events only, no second bank of prices.
select event_kind,count(*) as events from public.user_price_collection_events group by event_kind;
-- Per-user and per-period stats use get_user_price_collection_stats(p_since)
-- with the caller's authenticated session, never a user ID supplied by clients.
