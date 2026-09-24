-- Cierra n8n_updates y sector_data a la anon key.
--
-- Estado encontrado (2026-09-24), las dos tablas con:
--   · SELECT para PUBLIC con `true`  → cualquiera las leía sin sesión.
--   · INSERT y UPDATE para anon y authenticated con `true` → cualquiera podía
--     escribirlas (comprobado en transacción revertida). Se crearon para que
--     /api/webhook funcionara con la anon key.
--
-- Orden seguido: /api/webhook pasó antes a service_role y se comprobó que
-- update_prices / update_regulations / update_news siguen guardando. El resto
-- de escritores (webhooks/construccion, webhooks/comercio-local,
-- prices/n8n-sync, account/delete) ya usaban service_role, que no depende de
-- estas policies.
--
-- Decisión:
--   · n8n_updates: solo sistema. Lleva ids de usuario en requested_by.
--   · sector_data: datos de mercado por los que pagamos. Sin lectura anónima;
--     los usuarios con sesión la siguen leyendo porque la usan los
--     generadores de presupuestos (generate-v2, generate-budget, reprice,
--     prices/sync, prices/resolve) con la sesión del usuario.

begin;

drop policy if exists "Anyone can read n8n updates" on public.n8n_updates;
drop policy if exists "Allow insert for anon and authenticated" on public.n8n_updates;
drop policy if exists "Allow update for anon and authenticated" on public.n8n_updates;

drop policy if exists "Anyone can read sector data" on public.sector_data;
drop policy if exists "Allow insert for anon and authenticated" on public.sector_data;
drop policy if exists "Allow update for anon and authenticated" on public.sector_data;
create policy sector_data_read_authenticated on public.sector_data
  for select to authenticated using (true);

-- RLS activo en ambas (sin policies para anon = sin acceso).
alter table public.n8n_updates enable row level security;
alter table public.sector_data enable row level security;

commit;

notify pgrst, 'reload schema';
