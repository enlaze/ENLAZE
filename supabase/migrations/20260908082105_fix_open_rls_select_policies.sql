-- Seguridad: elimina políticas RLS de lectura abiertas (USING (true)) sobre datos
-- privados de usuario. Cualquiera con la anon key (que viaja en el navegador)
-- podía leer facturas, líneas, albaranes, pedidos y credenciales de TODOS los usuarios.
--
-- Cada tabla afectada YA tiene su política de propietario (<tabla>_select_own con
-- auth.uid()), por lo que basta con eliminar la política abierta: no se pierde
-- ningún acceso legítimo del dueño.
--
-- NO se tocan catálogos compartidos legítimos (sector_config, sector_data,
-- canonical_*, pb_*, technical_*, software_versions, subprocessors,
-- processing_activities): son datos de referencia, no datos privados de usuario.

-- 1. Facturas emitidas (fallo confirmado) y sus líneas
drop policy if exists "Public read issued_invoices"      on public.issued_invoices;
drop policy if exists "Public read issued_invoice_lines" on public.issued_invoice_lines;

-- 2. Albaranes y sus líneas
drop policy if exists "Public read delivery_notes"      on public.delivery_notes;
drop policy if exists "Public read delivery_note_lines" on public.delivery_note_lines;

-- 3. Pedidos y sus líneas
drop policy if exists "Public read orders"      on public.orders;
drop policy if exists "Public read order_lines" on public.order_lines;

-- 4. Datos de obra/proyecto
drop policy if exists "Public read project_changes by project"    on public.project_changes;
drop policy if exists "Public read project_milestones by project" on public.project_milestones;
drop policy if exists "Public read project_suppliers by project"  on public.project_suppliers;

-- 5. agent_connections: contenía credentials_ref (referencias a credenciales OAuth)
--    con una única política ALL USING (true) para el rol public -> lectura Y escritura
--    anónima. Se sustituye por políticas de propietario.
--    El rol service_role ignora RLS, así que las rutas de servidor que usan
--    SUPABASE_SERVICE_ROLE_KEY siguen funcionando igual.
drop policy if exists "agent_connections_service" on public.agent_connections;

create policy "agent_connections_select_own" on public.agent_connections
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "agent_connections_insert_own" on public.agent_connections
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "agent_connections_update_own" on public.agent_connections
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "agent_connections_delete_own" on public.agent_connections
  for delete to authenticated using ((select auth.uid()) = user_id);
