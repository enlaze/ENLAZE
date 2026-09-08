-- El asistente calcula el coste real de cada partida (`subtotal_cost`) y de ahí
-- deriva el precio de cliente aplicando el margen. Ese coste nunca llegaba a la
-- base de datos: `replace_budget_items` no nombraba `unit_price_cost` ni
-- `subtotal_cost` en su INSERT, así que se descartaban en silencio y las
-- columnas se quedaban con su default 0 (812 de 812 filas a cero).
--
-- Consecuencia: el PDF interno no podía leer el coste de `budget_items` y tenía
-- que rescatarlo del JSON `wizard_state` emparejando por nombre de concepto
-- normalizado. Si el nombre no casaba, usaba el precio de venta como coste y
-- mostraba margen 0% y beneficio 0 EUR sin avisar.
--
-- Esta migración solo añade el transporte de las dos columnas de coste. No
-- cambia la validación, ni la autorización, ni el orden, ni el resto del
-- contrato de la función.

create or replace function public.replace_budget_items(p_budget_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id  uuid;
  v_budget   uuid;
  v_item     jsonb;
  v_pos      bigint;
  v_numero   numeric;
  v_insertadas integer;
begin
  if p_budget_id is null then
    raise exception 'replace_budget_items: p_budget_id es obligatorio'
      using errcode = '22004';
  end if;

  if p_items is null then
    raise exception 'replace_budget_items: p_items es obligatorio'
      using errcode = '22004';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'replace_budget_items: p_items debe ser un array JSON (recibido: %)',
      jsonb_typeof(p_items)
      using errcode = '22023';
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'replace_budget_items: no hay sesión autenticada'
      using errcode = '42501';
  end if;

  select b.id
    into v_budget
    from public.budgets as b
   where b.id = p_budget_id
     and b.user_id = v_user_id
     and b.deleted_at is null
     for update;

  if not found then
    raise exception 'replace_budget_items: el presupuesto no está disponible'
      using errcode = '42501';
  end if;

  for v_item, v_pos in
    select t.item, t.ordinality
      from jsonb_array_elements(p_items) with ordinality as t(item, ordinality)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'replace_budget_items: el elemento % debe ser un objeto JSON (recibido: %)',
        v_pos - 1, jsonb_typeof(v_item)
        using errcode = '22023';
    end if;

    if nullif(btrim(coalesce(v_item->>'concept', '')), '') is null then
      raise exception 'replace_budget_items: el elemento % no tiene concept',
        v_pos - 1
        using errcode = '22023';
    end if;

    if v_item->>'quantity' is null then
      raise exception 'replace_budget_items: el elemento % no tiene quantity',
        v_pos - 1
        using errcode = '22023';
    end if;
    begin
      v_numero := (v_item->>'quantity')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'replace_budget_items: el elemento % tiene un quantity no numérico',
          v_pos - 1
          using errcode = '22023';
    end;
    if v_numero = 'NaN'::numeric then
      raise exception 'replace_budget_items: el elemento % tiene quantity = NaN',
        v_pos - 1
        using errcode = '22023';
    end if;

    if v_item->>'unit_price' is null then
      raise exception 'replace_budget_items: el elemento % no tiene unit_price',
        v_pos - 1
        using errcode = '22023';
    end if;
    begin
      v_numero := (v_item->>'unit_price')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'replace_budget_items: el elemento % tiene un unit_price no numérico',
          v_pos - 1
          using errcode = '22023';
    end;
    if v_numero = 'NaN'::numeric then
      raise exception 'replace_budget_items: el elemento % tiene unit_price = NaN',
        v_pos - 1
        using errcode = '22023';
    end if;

    if nullif(v_item->>'subtotal_cost', '') is not null then
      begin
        v_numero := (v_item->>'subtotal_cost')::numeric;
      exception
        when invalid_text_representation then
          raise exception 'replace_budget_items: el elemento % tiene un subtotal_cost no numérico',
            v_pos - 1
            using errcode = '22023';
      end;
      if v_numero = 'NaN'::numeric then
        raise exception 'replace_budget_items: el elemento % tiene subtotal_cost = NaN',
          v_pos - 1
          using errcode = '22023';
      end if;
    end if;

    if nullif(v_item->>'unit_price_cost', '') is not null then
      begin
        v_numero := (v_item->>'unit_price_cost')::numeric;
      exception
        when invalid_text_representation then
          raise exception 'replace_budget_items: el elemento % tiene un unit_price_cost no numérico',
            v_pos - 1
            using errcode = '22023';
      end;
      if v_numero = 'NaN'::numeric then
        raise exception 'replace_budget_items: el elemento % tiene unit_price_cost = NaN',
          v_pos - 1
          using errcode = '22023';
      end if;
    end if;
  end loop;

  delete from public.budget_items
   where budget_id = p_budget_id;

  insert into public.budget_items (
    budget_id,
    sort_order,
    concept,
    description,
    quantity,
    unit,
    category,
    chapter,
    unit_price,
    subtotal,
    unit_price_cost,
    subtotal_cost,
    canonical_id,
    canonical_status,
    canonical_confidence,
    canonical_source,
    canonical_origin,
    canonical_source_ref,
    price_type
  )
  select p_budget_id,
         (t.ordinality - 1)::integer,
         btrim(t.item->>'concept'),
         coalesce(t.item->>'description', ''),
         (t.item->>'quantity')::numeric,
         coalesce(nullif(t.item->>'unit', ''), 'ud'),
         coalesce(nullif(t.item->>'category', ''), 'otros'),
         nullif(t.item->>'chapter', ''),
         (t.item->>'unit_price')::numeric,
         coalesce(
           (nullif(t.item->>'subtotal', ''))::numeric,
           round((t.item->>'quantity')::numeric * (t.item->>'unit_price')::numeric, 2)
         ),
         coalesce((nullif(t.item->>'unit_price_cost', ''))::numeric, 0),
         coalesce(
           (nullif(t.item->>'subtotal_cost', ''))::numeric,
           round(
             (t.item->>'quantity')::numeric
               * coalesce((nullif(t.item->>'unit_price_cost', ''))::numeric, 0),
             2
           )
         ),
         nullif(t.item->>'canonical_id', ''),
         coalesce(nullif(t.item->>'canonical_status', ''), 'unmatched'),
         (nullif(t.item->>'canonical_confidence', ''))::numeric,
         nullif(t.item->>'canonical_source', ''),
         nullif(t.item->>'canonical_origin', ''),
         nullif(t.item->>'canonical_source_ref', ''),
         nullif(t.item->>'price_type', '')
    from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  get diagnostics v_insertadas = row_count;

  return v_insertadas;
end;
$function$;
