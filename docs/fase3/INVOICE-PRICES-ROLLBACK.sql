-- ROLLBACK_INVOICE_PRICES. DESTRUCTIVO si ya hay líneas o usos: se bloquea.
-- Orden obligatorio: 1 disparador; 2 funciones; 3 eventos; 4 líneas.
-- Cliente: BEGIN; ejecutar bloque completo; revisar; COMMIT o ROLLBACK.
-- Sin CASCADE, sin borrar facturas/precios/presupuestos ni alterar el registro
-- de migraciones. Álvaro gestiona el registro aparte tras verificar el deshacer.
-- Soporta aplicación parcial siempre que no haya datos. Desplegar primero la
-- aplicación anterior: no dejar lectores/escritores dependientes del nuevo SQL.
-- BEGIN ROLLBACK_INVOICE_PRICES
DO $guard$
declare obj text; n bigint;
begin
  -- Fence budget saves first, then line writers and telemetry, before counting.
  -- Locks live until the client commits or rolls back the whole block.
  lock table public.budget_items in access exclusive mode;
  foreach obj in array array['public.received_invoice_lines','public.invoice_price_usage_events'] loop
    if to_regclass(obj) is not null then
      execute format('lock table %s in access exclusive mode',to_regclass(obj));
      if pg_catalog.row_security_active(to_regclass(obj)) then
        raise exception 'ABORTAR: rollback exige lectura completa sin RLS';
      end if;
      execute format('select count(*) from %s',to_regclass(obj)) into n;
      if n<>0 then raise exception 'ABORTAR: rollback DESTRUCTIVO; % tiene % filas',obj,n; end if;
    end if;
  end loop;
end $guard$;
drop trigger if exists record_invoice_price_reuse on public.budget_items;
drop function if exists budget_internal.record_invoice_price_reuse();
drop function if exists public.save_received_invoice_lines(uuid,jsonb);
drop function if exists public.get_invoice_price_stats(timestamptz);
drop table if exists public.invoice_price_usage_events;
drop table if exists public.received_invoice_lines;
comment on column public.budget_items.price_item_id is
  'Historical price_items identity for an adopted own price. Deleting a bank price must not change budget provenance. Reuse metrics validate owner, unit and adopted amount against the bank.';
comment on column public.budget_items.price_source_type is
  'G3. Procedencia del precio guardado: nivel elegido por el resolutor, ai_estimate si lo propone la IA sin fuente tecnica (confianza 0.20), user_supplied si la persona aporta su propio precio (confianza 0.95), o user_edited si cambia solo el importe. Valores esperados: manual_locked, private_tariff, negotiated, historical_approved, preferred_supplier, provider_updated, private_bc3, technical_bank, enlaze_base, market_estimate, estimated, user_edited, ai_estimate, user_supplied. NULL en una partida antigua = anterior a G3; no significa que careciera de fuente. NULL en una partida nueva = fallo.';
-- END ROLLBACK_INVOICE_PRICES
