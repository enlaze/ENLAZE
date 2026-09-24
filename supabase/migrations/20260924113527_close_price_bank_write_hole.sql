-- Cierra el agujero del banco de precios y el EXECUTE público de dos RPC.
--
-- Contexto: 20260806_02_fix_price_bank_service_role_policies.sql nunca se
-- aplicó; el commit 7135c48 ("reconcile Supabase migration history") la borró
-- del repo en vez de aplicarla. Las policies "Service role full access" se
-- crearon SIN `TO service_role`, así que valían para PUBLIC: comprobado el
-- 2026-09-24 con la anon key (sin sesión) → se podían modificar los 42.221
-- productos, borrar los precios actuales e insertar proveedores (prueba hecha
-- dentro de una transacción revertida).
--
-- La migración vieja NO se aplica tal cual: afirmaba que `authenticated` ya
-- tenía sus propias policies de escritura y en la base real no es así (solo
-- lectura). Aplicarla habría roto la pantalla de precios. Aquí se añaden las
-- escrituras legítimas, acotadas al dueño:
--   · pb_providers: el usuario crea/edita/borra solo los suyos
--     (company_id = auth.uid(); por defecto, auth.uid()).
--   · pb_products: puede añadir productos a un proveedor suyo o del catálogo
--     global (lo que hace hoy "Añadir precio" → "Referencia mercado ES"),
--     pero solo edita/borra los de SUS proveedores.
--   · pb_price_current / pb_price_observations: solo de productos de sus
--     proveedores (importaciones propias).
--   · pb_price_sources: solo las suyas.
--   · pb_sync_runs: lectura para usuarios con sesión; escritura solo sistema.
--   · El catálogo global solo lo escribe service_role (webhooks, ingesta, sync).

begin;

-- ── 1. Las policies abiertas pasan a ser de verdad solo de service_role ──

do $$
declare t text;
begin
  foreach t in array array['pb_providers','pb_price_sources','pb_products',
                           'pb_price_observations','pb_price_current','pb_sync_runs']
  loop
    execute format('drop policy if exists "Service role full access" on public.%I', t);
    execute format('create policy "Service role full access" on public.%I '
                   || 'for all to service_role using (true) with check (true)', t);
  end loop;
end $$;

-- ── 2. Escrituras legítimas de usuarios, acotadas al dueño ───────────────

alter table public.pb_providers alter column company_id set default auth.uid();

create policy pb_providers_insert_own on public.pb_providers
  for insert to authenticated with check (company_id = (select auth.uid()));
create policy pb_providers_update_own on public.pb_providers
  for update to authenticated
  using (company_id = (select auth.uid())) with check (company_id = (select auth.uid()));
create policy pb_providers_delete_own on public.pb_providers
  for delete to authenticated using (company_id = (select auth.uid()));

create policy pb_products_insert_own_or_catalog on public.pb_products
  for insert to authenticated with check (exists (
    select 1 from public.pb_providers v
     where v.id = pb_products.provider_id
       and (v.company_id is null or v.company_id = (select auth.uid()))));
create policy pb_products_update_own on public.pb_products
  for update to authenticated
  using (exists (select 1 from public.pb_providers v
                  where v.id = pb_products.provider_id and v.company_id = (select auth.uid())))
  with check (exists (select 1 from public.pb_providers v
                  where v.id = pb_products.provider_id and v.company_id = (select auth.uid())));
create policy pb_products_delete_own on public.pb_products
  for delete to authenticated
  using (exists (select 1 from public.pb_providers v
                  where v.id = pb_products.provider_id and v.company_id = (select auth.uid())));

create policy pb_price_current_write_own on public.pb_price_current
  for insert to authenticated with check (exists (
    select 1 from public.pb_products p join public.pb_providers v on v.id = p.provider_id
     where p.id = pb_price_current.product_id and v.company_id = (select auth.uid())));
create policy pb_price_current_update_own on public.pb_price_current
  for update to authenticated
  using (exists (select 1 from public.pb_products p join public.pb_providers v on v.id = p.provider_id
                  where p.id = pb_price_current.product_id and v.company_id = (select auth.uid())))
  with check (exists (select 1 from public.pb_products p join public.pb_providers v on v.id = p.provider_id
                  where p.id = pb_price_current.product_id and v.company_id = (select auth.uid())));

create policy pb_price_observations_insert_own on public.pb_price_observations
  for insert to authenticated with check (exists (
    select 1 from public.pb_products p join public.pb_providers v on v.id = p.provider_id
     where p.id = pb_price_observations.product_id and v.company_id = (select auth.uid())));

create policy pb_price_sources_select_own on public.pb_price_sources
  for select to authenticated using (company_id = (select auth.uid()));
create policy pb_price_sources_insert_own on public.pb_price_sources
  for insert to authenticated with check (company_id = (select auth.uid()));
create policy pb_price_sources_update_own on public.pb_price_sources
  for update to authenticated
  using (company_id = (select auth.uid())) with check (company_id = (select auth.uid()));

create policy pb_sync_runs_read_authenticated on public.pb_sync_runs
  for select to authenticated using (true);

-- ── 3. RPC financieras: sin EXECUTE para PUBLIC ──────────────────────────
-- 20260908082410 revocó a `anon`, pero el permiso le seguía llegando por
-- PUBLIC. El cuerpo ya rechazaba a quien no es el dueño (comprobado: anon
-- recibe 42501); esto cierra también el permiso.

revoke execute on function public.get_expense_summary(uuid) from public, anon;
grant execute on function public.get_expense_summary(uuid) to authenticated, service_role;
revoke execute on function public.get_treasury_summary(uuid) from public, anon;
grant execute on function public.get_treasury_summary(uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
