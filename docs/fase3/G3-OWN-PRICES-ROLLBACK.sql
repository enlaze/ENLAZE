-- BEGIN ROLLBACK_G3_OWN
-- Compensa 20261021090000_user_supplied_prices. SOLO ejecución manual por Álvaro.
-- Revertir primero la aplicación a una versión que no escriba las columnas nuevas.
-- Ejecutar el bloque entero en una transacción del cliente, sin BEGIN/COMMIT aquí.
-- ORDEN OBLIGATORIO para respetar dependencias:
--   1. Los dos disparadores.
--   2. Las dos funciones de disparador (y la RPC auxiliar; restaurar el escritor).
--   3. La tabla user_price_collection_events.
--   4. Las dos columnas.
-- DESTRUCTIVO en cuanto haya eventos recogidos: perdería historial y referencias.
-- El guard lo BLOQUEA si hay eventos; exportar y revisar antes de plantear deshacer.
-- No elimina precios ni partidas. No usa CASCADE ni modifica schema_migrations.
do $guard$
begin
  if exists(select 1 from public.user_price_collection_events) then
    raise exception 'Export and review own-price instrumentation before rollback';
  end if;
end $guard$;
-- 1. Disparadores: ninguna función se suelta mientras un disparador la usa.
drop trigger record_own_price_reuse on public.budget_items;
drop trigger record_collected_price on public.price_items;
-- 2. Funciones y restauración literal del escritor anterior.
drop function budget_internal.record_own_price_reuse();
drop function budget_internal.record_collected_price();
drop function public.get_user_price_collection_stats(timestamptz);
create or replace function budget_internal.replace_items(p_id uuid, p_items jsonb)
returns integer language plpgsql security invoker set search_path = '' as $fn$
declare x jsonb; k text; n numeric; v_count integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'items must be an array' using errcode = '22023'; end if;
  for x in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(x) <> 'object' or nullif(btrim(x->>'concept'), '') is null then
      raise exception 'Each item needs concept' using errcode = '22023';
    end if;
    foreach k in array array['quantity','unit_price','subtotal','unit_price_cost','subtotal_cost','canonical_confidence'] loop
      if k in ('quantity','unit_price') and nullif(x->>k, '') is null then
        raise exception 'Item requires %', k using errcode = '22023';
      end if;
      if nullif(x->>k, '') is not null then
        begin n := (x->>k)::numeric;
        exception when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'Invalid item %', k using errcode = '22023';
        end;
        if n::text in ('NaN','Infinity','-Infinity') then raise exception 'Item % must be finite', k using errcode = '22023'; end if;
      end if;
    end loop;
  end loop;
  delete from public.budget_items where budget_id = p_id;
  insert into public.budget_items (
    budget_id, sort_order, concept, description, quantity, unit, category, chapter,
    unit_price, subtotal, unit_price_cost, subtotal_cost, canonical_id,
    canonical_status, canonical_confidence, canonical_source, canonical_origin,
    canonical_source_ref, price_type, price_source_type,
    price_confidence, price_checked_at)
  select p_id, (t.ordinality - 1)::integer, btrim(t.item->>'concept'),
    coalesce(t.item->>'description', ''), (t.item->>'quantity')::numeric,
    coalesce(nullif(t.item->>'unit', ''), 'ud'),
    coalesce(nullif(t.item->>'category', ''), 'otros'), nullif(t.item->>'chapter', ''),
    (t.item->>'unit_price')::numeric,
    coalesce(nullif(t.item->>'subtotal', '')::numeric,
      round((t.item->>'quantity')::numeric * (t.item->>'unit_price')::numeric, 2)),
    coalesce(nullif(t.item->>'unit_price_cost', '')::numeric, 0),
    coalesce(nullif(t.item->>'subtotal_cost', '')::numeric,
      round((t.item->>'quantity')::numeric * coalesce(nullif(t.item->>'unit_price_cost', '')::numeric, 0), 2)),
    nullif(t.item->>'canonical_id', ''),
    coalesce(nullif(t.item->>'canonical_status', ''), 'unmatched'),
    nullif(t.item->>'canonical_confidence', '')::numeric,
    nullif(t.item->>'canonical_source', ''), nullif(t.item->>'canonical_origin', ''),
    nullif(t.item->>'canonical_source_ref', ''), nullif(t.item->>'price_type', ''),
    nullif(t.item->>'price_source_type', ''),
    nullif(t.item->>'price_confidence', '')::numeric,
    nullif(t.item->>'price_checked_at', '')::timestamptz
  from jsonb_array_elements(p_items) with ordinality t(item, ordinality);
  get diagnostics v_count = row_count;
  return v_count;
end $fn$;
-- 3. Tabla de eventos.
drop table public.user_price_collection_events;
-- 4. Columnas.
alter table public.budget_items drop column price_item_id;
alter table public.price_items drop column collection_budget_id;
comment on column public.budget_items.price_source_type is
  'G3. Procedencia del precio guardado: nivel elegido por el resolutor, ai_estimate si lo propone la IA sin fuente tecnica (confianza 0.20), o user_edited si la persona cambia el importe. Valores esperados: manual_locked, private_tariff, negotiated, historical_approved, preferred_supplier, provider_updated, private_bc3, technical_bank, enlaze_base, market_estimate, estimated, user_edited, ai_estimate. NULL en una partida antigua = anterior a G3; no significa que careciera de fuente. NULL en una partida nueva = fallo.';

notify pgrst, 'reload schema';
-- END ROLLBACK_G3_OWN
