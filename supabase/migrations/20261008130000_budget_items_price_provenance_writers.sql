-- G3 lote 1b: transportar procedencia sin cambiar importes ni versiones.
-- Los cuerpos proceden literalmente de 20260908111706, 20260901120000
-- y 20260915160000; la funcion interna conserva firma y dependencias.
-- Solo cambian las tres columnas y expresiones de sus INSERT.
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
    price_type,
    price_source_type,
    price_confidence,
    price_checked_at
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
         nullif(t.item->>'price_type', ''),
         nullif(t.item->>'price_source_type', ''),
         nullif(t.item->>'price_confidence', '')::numeric,
         nullif(t.item->>'price_checked_at', '')::timestamptz
    from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  get diagnostics v_insertadas = row_count;

  return v_insertadas;
end;
$function$;

create or replace function public.update_budget_with_items(
  p_budget_id uuid,
  p_budget_data jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_budget public.budgets%rowtype;
  v_current_status text;
  v_subtotal numeric(12,2);
  v_iva_percent numeric(5,2);
  v_deposit_percent numeric(5,2);
  v_discount_type text;
  v_discount_percent numeric(5,2);
  v_discount_amount_input numeric(12,2);
  v_discount_amount numeric(12,2);
  v_taxable_base numeric(12,2);
  v_payment_schedule jsonb;
  v_reset_lifecycle boolean;
  v_previous_items jsonb := '[]'::jsonb;
  v_snapshot_version integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(p_budget_data) <> 'object' then
    raise exception 'Invalid budget data';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one budget item is required';
  end if;

  if nullif(btrim(p_budget_data->>'title'), '') is null then
    raise exception 'Budget title is required';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_items) as item
     where nullif(btrim(item->>'concept'), '') is null
        or coalesce((item->>'quantity')::numeric, 0) <= 0
        or coalesce((item->>'unit_price')::numeric, 0) <= 0
  ) then
    raise exception 'Every item needs a concept, quantity and valid price';
  end if;

  select *
    into v_budget
    from public.budgets
   where id = p_budget_id
     and user_id = v_user_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'Budget not found';
  end if;

  v_current_status := v_budget.status;
  v_reset_lifecycle := v_current_status in (
    'enviado', 'sent', 'aceptado', 'accepted', 'rechazado', 'rejected'
  );

  -- Este INSERT precede a propósito tanto al UPDATE del presupuesto como al
  -- DELETE de las partidas. Cualquier fallo posterior revierte la RPC entera,
  -- incluido este snapshot.
  if v_reset_lifecycle then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', item_row.id,
          'chapter', coalesce(nullif(item_row.chapter, ''), nullif(item_row.category, ''), 'otros'),
          'code', '',
          'name', coalesce(item_row.concept, ''),
          'description', coalesce(item_row.description, ''),
          'unit', coalesce(nullif(item_row.unit, ''), 'ud'),
          'quantity', coalesce(item_row.quantity, 0),
          'quantity_calculation', '',
          'trade', 'subcontrata',
          'estimated_hours', 0,
          'priority', 'obligatoria',
          'dependencies', '[]'::jsonb,
          'material_cost_per_unit', 0,
          'labor_cost_per_unit', 0,
          'labor_hours_per_unit', 0,
          'machinery_cost_per_unit', 0,
          'unit_cost', coalesce(item_row.unit_price, 0),
          'unit_price_sale', coalesce(item_row.unit_price, 0),
          'subtotal_cost', coalesce(item_row.subtotal, 0),
          'subtotal_sale', coalesce(item_row.subtotal, 0),
          'margin_percent', 0,
          'confidence_score', 0,
          'price_source', 'estimated',
          'price_source_detail', 'Preservado desde budget_items',
          'supplier', null,
          'materials', '[]'::jsonb
        )
        order by item_row.created_at, item_row.id
      ),
      '[]'::jsonb
    )
      into v_previous_items
      from public.budget_items as item_row
     where item_row.budget_id = p_budget_id;

    loop
      begin
        select coalesce(max(snapshot.version), 0) + 1
          into v_snapshot_version
          from public.budget_snapshots as snapshot
         where snapshot.budget_id = p_budget_id;

        insert into public.budget_snapshots (
          budget_id,
          user_id,
          version,
          snapshot_type,
          label,
          items_data,
          summary_data,
          metadata,
          total_items,
          total_cost,
          total_sale
        ) values (
          p_budget_id,
          v_user_id,
          v_snapshot_version,
          'edited',
          format(
            'Preservado antes de editar %s (v%s)',
            coalesce(v_budget.status, 'sin estado'),
            coalesce(v_budget.version, 1)
          ),
          v_previous_items,
          jsonb_build_object(
            'subtotal', v_budget.subtotal,
            'iva_percent', v_budget.iva_percent,
            'iva_amount', v_budget.iva_amount,
            'total', v_budget.total
          ),
          jsonb_build_object(
            'preserved_before_lifecycle_edit', true,
            'budget_version', coalesce(v_budget.version, 1),
            'budget_status', v_budget.status,
            'budget_data', to_jsonb(v_budget)
          ),
          jsonb_array_length(v_previous_items),
          coalesce(v_budget.subtotal, 0),
          coalesce(v_budget.subtotal, 0)
        );
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;
  end if;

  select round(
    coalesce(
      sum((item->>'quantity')::numeric * (item->>'unit_price')::numeric),
      0
    ),
    2
  )
    into v_subtotal
    from jsonb_array_elements(p_items) as item;

  v_iva_percent := greatest(
    0,
    least(100, coalesce((p_budget_data->>'iva_percent')::numeric, 21))
  );

  v_deposit_percent := greatest(
    0,
    least(100, coalesce((p_budget_data->>'deposit_percent')::numeric, v_budget.deposit_percent, 30))
  );

  v_discount_type := case
    when p_budget_data->>'discount_type' in ('percent', 'amount') then p_budget_data->>'discount_type'
    else coalesce(nullif(v_budget.discount_type, ''), 'percent')
  end;

  v_discount_percent := greatest(
    0,
    least(100, coalesce((p_budget_data->>'discount_percent')::numeric, v_budget.discount_percent, 0))
  );

  v_discount_amount_input := greatest(
    0,
    coalesce((p_budget_data->>'discount_amount')::numeric, v_budget.discount_amount, 0)
  );

  if v_discount_type = 'amount' then
    v_discount_amount := least(v_subtotal, v_discount_amount_input);
  else
    v_discount_amount := round(v_subtotal * v_discount_percent / 100, 2);
  end if;

  v_taxable_base := greatest(0, v_subtotal - v_discount_amount);

  v_payment_schedule := case
    when jsonb_typeof(p_budget_data->'payment_schedule') = 'array' then p_budget_data->'payment_schedule'
    else coalesce(v_budget.payment_schedule, '[]'::jsonb)
  end;

  update public.budgets
     set client_id = nullif(p_budget_data->>'client_id', '')::uuid,
         project_id = nullif(p_budget_data->>'project_id', '')::uuid,
         title = btrim(p_budget_data->>'title'),
         client_name = coalesce(p_budget_data->>'client_name', ''),
         client_email = coalesce(p_budget_data->>'client_email', ''),
         client_phone = coalesce(p_budget_data->>'client_phone', ''),
         client_address = coalesce(p_budget_data->>'client_address', ''),
         service_type = coalesce(nullif(p_budget_data->>'service_type', ''), 'general'),
         subtotal = v_subtotal,
         iva_percent = v_iva_percent,
         discount_type = v_discount_type,
         discount_percent = v_discount_percent,
         discount_amount = v_discount_amount,
         iva_amount = round(v_taxable_base * v_iva_percent / 100, 2),
         total = round(v_taxable_base + (v_taxable_base * v_iva_percent / 100), 2),
         notes = coalesce(p_budget_data->>'notes', ''),
         valid_until = nullif(p_budget_data->>'valid_until', '')::date,
         deposit_percent = v_deposit_percent,
         payment_method = coalesce(nullif(p_budget_data->>'payment_method', ''), 'Transferencia bancaria'),
         payment_iban = coalesce(p_budget_data->>'payment_iban', ''),
         payment_schedule = v_payment_schedule,
         warranty_text = coalesce(p_budget_data->>'warranty_text', ''),
         execution_deadline_text = coalesce(p_budget_data->>'execution_deadline_text', ''),
         observations = coalesce(p_budget_data->>'observations', ''),
         conditions_text = coalesce(p_budget_data->>'conditions_text', ''),
         status = case when v_reset_lifecycle then 'pendiente' else v_current_status end,
         sent_at = case when v_reset_lifecycle then null else sent_at end,
         viewed_at = case when v_reset_lifecycle then null else viewed_at end,
         accepted_at = case when v_reset_lifecycle then null else accepted_at end,
         rejected_at = case when v_reset_lifecycle then null else rejected_at end,
         accepted_by_name = case when v_reset_lifecycle then null else accepted_by_name end,
         accepted_ip = case when v_reset_lifecycle then null else accepted_ip end,
         version = coalesce(version, 1) + 1,
         updated_at = now()
   where id = p_budget_id
     and user_id = v_user_id
  returning * into v_budget;

  delete from public.budget_items
   where budget_id = p_budget_id;

  -- ÚNICO CAMBIO FUNCIONAL DE ESTA MIGRACIÓN SOBRE LA RPC.
  --
  -- Las nueve columnas económicas y las siete canónicas se copian EXACTAMENTE
  -- igual que antes. Lo único que se añade es `sort_order`, tomado de la
  -- posición del elemento dentro de `p_items`.
  --
  -- Antes de este cambio la RPC no nombraba la columna, así que cada edición
  -- desde el formulario clásico devolvía TODAS las partidas del presupuesto al
  -- `default 0` y destruía el orden. Ése es el agujero que se cierra aquí, y es
  -- la razón por la que la UNIQUE no podía entrar sin este INSERT.
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
    canonical_id,
    canonical_status,
    canonical_confidence,
    canonical_source,
    canonical_origin,
    canonical_source_ref,
    price_type,
    price_source_type,
    price_confidence,
    price_checked_at
  )
  select p_budget_id,
         -- `ordinality` es base 1 y la genera Postgres a partir de la posición
         -- real del elemento en el array. No se lee `item->>'sort_order'`: un
         -- valor enviado por el cliente podría venir repetido o con huecos, y la
         -- UNIQUE lo rechazaría con un error incomprensible para el usuario.
         (ordinality - 1)::integer,
         btrim(item->>'concept'),
         coalesce(item->>'description', ''),
         (item->>'quantity')::numeric,
         coalesce(nullif(item->>'unit', ''), 'ud'),
         coalesce(nullif(item->>'category', ''), 'otros'),
         nullif(item->>'chapter', ''),
         (item->>'unit_price')::numeric,
         round((item->>'quantity')::numeric * (item->>'unit_price')::numeric, 2),
         -- Transporte literal: lo que decida el clasificador es lo que se guarda.
         -- Esta función NO clasifica, no deduce y no corrige. Un segundo sistema
         -- de clasificación dentro de SQL sería justo lo que 2D-3 y 2D-4 se
         -- ocuparon de no tener.
         nullif(item->>'canonical_id', ''),
         -- Réplica explícita del default de la columna: al nombrarla en el
         -- INSERT, el default deja de aplicarse. Ver la nota de compatibilidad.
         coalesce(nullif(item->>'canonical_status', ''), 'unmatched'),
         (nullif(item->>'canonical_confidence', ''))::numeric,
         nullif(item->>'canonical_source', ''),
         nullif(item->>'canonical_origin', ''),
         nullif(item->>'canonical_source_ref', ''),
         nullif(item->>'price_type', ''),
         nullif(item->>'price_source_type', ''),
         nullif(item->>'price_confidence', '')::numeric,
         nullif(item->>'price_checked_at', '')::timestamptz
    from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  return to_jsonb(v_budget);
end;
$$;

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

create or replace function public.duplicate_budget(p_budget_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare b public.budgets%rowtype; v_id uuid; v_owner uuid := auth.uid(); v_number text;
begin
  perform budget_internal.lock_owner(v_owner);
  select * into b from public.budgets where id = p_budget_id and user_id = v_owner and deleted_at is null for update;
  if not found then raise exception 'Budget is not available' using errcode = '42501'; end if;
  v_number := 'PRE-' || to_char(current_date, 'YYYY') || '-' || (10000 + floor(random() * 90000))::integer::text;
  if b.client_id is not null then
    perform 1 from public.clients where id = b.client_id and user_id = v_owner for share;
    if not found then raise exception 'Client is not available' using errcode = '42501'; end if;
  end if;
  if b.project_id is not null then
    perform 1 from public.projects where id = b.project_id and user_id = v_owner for share;
    if not found then raise exception 'Project is not available' using errcode = '42501'; end if;
  end if;
  insert into public.budgets(user_id, title, budget_number, status, version, lock_version)
    values (v_owner, b.title || ' (copia)', v_number, 'borrador', 1, 1) returning id into v_id;
  update public.budgets set
    client_id = b.client_id,
    project_id = b.project_id,
    client_name = b.client_name,
    client_email = b.client_email,
    client_phone = b.client_phone,
    client_address = b.client_address,
    client_nif = b.client_nif,
    service_type = b.service_type,
    subtotal = b.subtotal,
    iva_percent = b.iva_percent,
    iva_amount = b.iva_amount,
    total = b.total,
    notes = b.notes,
    valid_until = b.valid_until,
    deposit_percent = b.deposit_percent,
    payment_method = b.payment_method,
    payment_iban = b.payment_iban,
    discount_type = b.discount_type,
    discount_percent = b.discount_percent,
    discount_amount = b.discount_amount,
    payment_schedule = b.payment_schedule,
    warranty_text = b.warranty_text,
    execution_deadline_text = b.execution_deadline_text,
    observations = b.observations,
    conditions_text = b.conditions_text,
    wizard_state = case when jsonb_typeof(b.wizard_state) = 'object'
      then jsonb_set(b.wizard_state, '{draftId}', to_jsonb(v_id::text), true) else b.wizard_state end
    where id = v_id;
  insert into public.budget_items(
    budget_id, sort_order, concept, description, quantity, unit, category, chapter,
    unit_price, subtotal, unit_price_cost, subtotal_cost, canonical_id, canonical_status,
    canonical_confidence, canonical_source, canonical_origin, canonical_source_ref, price_type,
    price_source_type, price_confidence, price_checked_at)
  select v_id, (row_number() over(order by i.sort_order, i.id) - 1)::integer,
    i.concept, i.description, i.quantity, i.unit, i.category, i.chapter, i.unit_price,
    i.subtotal, i.unit_price_cost, i.subtotal_cost, i.canonical_id, i.canonical_status,
    i.canonical_confidence, i.canonical_source, i.canonical_origin, i.canonical_source_ref, i.price_type,
    i.price_source_type, i.price_confidence, i.price_checked_at
    from public.budget_items i where budget_id = p_budget_id;
  return budget_internal.result(v_id, null);
end $fn$;

comment on column public.budget_items.price_source_type is
  'G3. Nivel que eligio el resolutor para el precio, o user_edited si la persona cambio el importe. Valores esperados: manual_locked, private_tariff, negotiated, historical_approved, preferred_supplier, provider_updated, private_bc3, technical_bank, enlaze_base, market_estimate, estimated, user_edited. NULL = partida anterior a G3; no significa que careciera de fuente.';
notify pgrst, 'reload schema';
