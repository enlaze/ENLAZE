-- Corrective migration for review-msgawnqb-0jxc3w / review-msgayf0c-eb70cc.
--
-- supabase/migrations/20260717_price_bank_v2.sql:161-166 created six
-- policies named "Service role full access" with USING (true) WITH CHECK
-- (true) and no `TO service_role` clause. A CREATE POLICY without TO
-- applies to PUBLIC — every role, including authenticated and anon — so
-- these six policies grant unrestricted read/write on pb_providers,
-- pb_price_sources, pb_products, pb_price_observations, pb_price_current
-- and pb_sync_runs to any authenticated user, on top of (and defeating)
-- the correctly-scoped pb_*_select/insert/update/delete policies already
-- defined for `authenticated` in 20260716_price_bank_v2.sql. Verified each
-- of the six tables has its own scoped policy there before dropping this:
-- removing it does not remove the only access path for legitimate
-- authenticated reads/writes.
--
-- service_role keeps full access (it needs it for the sync/webhook/ingest
-- endpoints); authenticated and anon no longer get it through this policy.

begin;

drop policy if exists "Service role full access" on public.pb_providers;
drop policy if exists "Service role full access" on public.pb_price_sources;
drop policy if exists "Service role full access" on public.pb_products;
drop policy if exists "Service role full access" on public.pb_price_observations;
drop policy if exists "Service role full access" on public.pb_price_current;
drop policy if exists "Service role full access" on public.pb_sync_runs;

create policy "Service role full access" on public.pb_providers
  for all to service_role using (true) with check (true);
create policy "Service role full access" on public.pb_price_sources
  for all to service_role using (true) with check (true);
create policy "Service role full access" on public.pb_products
  for all to service_role using (true) with check (true);
create policy "Service role full access" on public.pb_price_observations
  for all to service_role using (true) with check (true);
create policy "Service role full access" on public.pb_price_current
  for all to service_role using (true) with check (true);
create policy "Service role full access" on public.pb_sync_runs
  for all to service_role using (true) with check (true);

commit;

notify pgrst, 'reload schema';
