-- E2: additive RPCs. Amounts are transported; legacy writers stay unchanged.
set local lock_timeout = '5s';
create schema budget_internal authorization postgres;
revoke all on schema budget_internal from public, anon, authenticated, service_role;

-- Same transaction lock key as lock_account_for_deletion.
create function budget_internal.lock_owner(p_owner uuid)
returns void language plpgsql security invoker set search_path = '' as $fn$
begin
  if p_owner is null then raise exception 'Budget is not available' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text, 0));
  if exists (select 1 from public.account_deletion_locks where user_id = p_owner) then
    raise exception 'Account deletion in progress' using errcode = '42501';
  end if;
end $fn$;

create function budget_internal.owned_budget(p_id uuid, p_expected integer)
returns public.budgets language plpgsql security invoker set search_path = '' as $fn$
declare b public.budgets%rowtype; v_owner uuid := auth.uid();
begin
  perform budget_internal.lock_owner(v_owner);
  select * into b from public.budgets
    where id = p_id and user_id = v_owner and deleted_at is null for update;
  if not found then raise exception 'Budget is not available' using errcode = '42501'; end if;
  if p_expected is null or p_expected < 1 then
    raise exception 'expected_lock_version must be positive' using errcode = '22023';
  end if;
  if b.lock_version is distinct from p_expected then
    raise exception 'Budget revision conflict' using errcode = 'PT409';
  end if;
  return b;
end $fn$;

create function budget_internal.validate_payload(p_data jsonb, p_create boolean)
returns void language plpgsql security invoker set search_path = '' as $fn$
declare k text; v jsonb; n numeric;
begin
  if jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'budget_data must be an object' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_data) loop
    if not (k = any(array['title','client_id','project_id','client_name','client_email','client_phone','client_address','client_nif','service_type','subtotal','iva_percent','iva_amount','total','notes','valid_until','deposit_percent','payment_method','payment_iban','discount_type','discount_percent','discount_amount','payment_schedule','warranty_text','execution_deadline_text','observations','conditions_text','wizard_state'])
            or (p_create and k = 'budget_number')) then
      raise exception 'Unknown or server-owned budget field: %', k using errcode = '22023';
    end if;
    if k = any(array['subtotal','iva_percent','iva_amount','total','deposit_percent','discount_percent','discount_amount']) then
      if jsonb_typeof(v) not in ('number','string') then
        raise exception '% must be numeric', k using errcode = '22023';
      end if;
      begin n := (v #>> '{}')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception '% must be numeric', k using errcode = '22023';
      end;
      if n::text in ('NaN','Infinity','-Infinity') then
        raise exception '% must be finite', k using errcode = '22023';
      end if;
      if k = any(array['iva_percent','deposit_percent','discount_percent']) and (n < 0 or n > 100) then
        raise exception '% outside 0..100: %', k, n using errcode = '22023';
      end if;
    elsif k = 'payment_schedule' then
      if jsonb_typeof(v) <> 'array' then raise exception 'payment_schedule must be an array' using errcode = '22023'; end if;
    elsif k = 'wizard_state' then
      if jsonb_typeof(v) <> 'object' then raise exception 'wizard_state must be an object' using errcode = '22023'; end if;
    elsif k = any(array['client_id','project_id','valid_until']) then
      if jsonb_typeof(v) not in ('null','string') then raise exception '% must be text or null', k using errcode = '22023'; end if;
    elsif jsonb_typeof(v) <> 'string' then raise exception '% must be text', k using errcode = '22023';
    end if;
  end loop;
  if nullif(btrim(p_data->>'title'), '') is null then raise exception 'title is required' using errcode = '22023'; end if;
  if p_create and nullif(btrim(p_data->>'budget_number'), '') is null then
    raise exception 'budget_number is required' using errcode = '22023';
  end if;
  if p_data ? 'discount_type' and p_data->>'discount_type' not in ('percent','amount') then
    raise exception 'Invalid discount_type' using errcode = '22023';
  end if;
end $fn$;

-- Explicit list prevents future columns from silently becoming client-writable.
-- Missing keys preserve values; explicit null clears nullable associations.
create function budget_internal.apply_header(p_id uuid, p_data jsonb)
returns public.budgets language plpgsql security invoker set search_path = '' as $fn$
declare b public.budgets%rowtype; v public.budgets%rowtype; d jsonb := p_data; k text;
begin
  select * into strict b from public.budgets where id = p_id;
  foreach k in array array['client_id','project_id','valid_until'] loop
    if d->>k = '' then d := jsonb_set(d, array[k], 'null'::jsonb); end if;
  end loop;
  select * into v from jsonb_populate_record(b, d);
  if v.client_id is not null then
    perform 1 from public.clients where id = v.client_id and user_id = b.user_id for share;
    if not found then raise exception 'Client is not available' using errcode = '42501'; end if;
  end if;
  if v.project_id is not null then
    perform 1 from public.projects where id = v.project_id and user_id = b.user_id for share;
    if not found then raise exception 'Project is not available' using errcode = '42501'; end if;
  end if;
  v.title := btrim(v.title);
  if d ? 'wizard_state' then
    v.wizard_state := jsonb_set(v.wizard_state, '{draftId}', to_jsonb(p_id::text), true);
  end if;
  update public.budgets set
    title = v.title,
    client_id = v.client_id,
    project_id = v.project_id,
    client_name = v.client_name,
    client_email = v.client_email,
    client_phone = v.client_phone,
    client_address = v.client_address,
    client_nif = v.client_nif,
    service_type = v.service_type,
    subtotal = v.subtotal,
    iva_percent = v.iva_percent,
    iva_amount = v.iva_amount,
    total = v.total,
    notes = v.notes,
    valid_until = v.valid_until,
    deposit_percent = v.deposit_percent,
    payment_method = v.payment_method,
    payment_iban = v.payment_iban,
    discount_type = v.discount_type,
    discount_percent = v.discount_percent,
    discount_amount = v.discount_amount,
    payment_schedule = v.payment_schedule,
    warranty_text = v.warranty_text,
    execution_deadline_text = v.execution_deadline_text,
    observations = v.observations,
    conditions_text = v.conditions_text,
    wizard_state = v.wizard_state
    where id = p_id returning * into b;
  return b;
end $fn$;

create function budget_internal.replace_items(p_id uuid, p_items jsonb)
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
    canonical_source_ref, price_type)
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
    nullif(t.item->>'canonical_source_ref', ''), nullif(t.item->>'price_type', '')
  from jsonb_array_elements(p_items) with ordinality t(item, ordinality);
  get diagnostics v_count = row_count;
  return v_count;
end $fn$;

create function budget_internal.document_version(p_id uuid, p_actor uuid)
returns integer language plpgsql security invoker set search_path = '' as $fn$
declare v_next integer; b public.budgets%rowtype; v_items jsonb;
begin
  -- Callers hold the parent lock; snapshot contains the rows actually persisted.
  select coalesce(max(version), 0) + 1 into v_next
    from public.document_versions where entity_type = 'budget' and entity_id = p_id;
  update public.budgets set version = v_next where id = p_id returning * into b;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order, i.id), '[]'::jsonb)
    into v_items from public.budget_items i where budget_id = p_id;
  insert into public.document_versions(entity_type, entity_id, version, snapshot, changed_by, change_summary)
    values ('budget', p_id, v_next, to_jsonb(b) || jsonb_build_object('items', v_items), p_actor, 'Atomic budget revision');
  return v_next;
end $fn$;

create function budget_internal.result(p_id uuid, p_previous text)
returns jsonb language sql security invoker set search_path = '' as $fn$
  select jsonb_build_object('budget_id', b.id, 'lock_version', b.lock_version,
    'version', b.version, 'status', b.status, 'previous_status', p_previous,
    'items_count', (select count(*) from public.budget_items where budget_id = b.id))
  from public.budgets b where b.id = p_id;
$fn$;

create function budget_internal.save_core(p_id uuid, p_expected integer, p_data jsonb, p_items jsonb, p_finalize boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $fn$
declare b public.budgets%rowtype; v_previous text;
begin
  b := budget_internal.owned_budget(p_id, p_expected);
  v_previous := b.status;
  if b.status is null or b.status not in ('borrador','draft','pendiente','pending') then
    raise exception 'Use the contractual revision flow for this budget' using errcode = '22023';
  end if;
  perform budget_internal.validate_payload(p_data, false);
  b := budget_internal.apply_header(p_id, p_data);
  perform budget_internal.replace_items(p_id, p_items);
  if (p_finalize or b.status in ('pendiente','pending')) and b.total > 0 and jsonb_array_length(p_items) = 0 then
    raise exception 'A contractual budget with positive total requires items' using errcode = '22023';
  end if;
  update public.budgets set status = case when p_finalize then 'pendiente' else status end,
    lock_version = lock_version + 1, updated_at = clock_timestamp() where id = p_id;
  if p_finalize or b.status in ('pendiente','pending') then
    perform budget_internal.document_version(p_id, b.user_id);
  end if;
  return budget_internal.result(p_id, v_previous);
end $fn$;

create function public.create_budget_with_items(p_budget_data jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid; v_owner uuid := auth.uid();
begin
  perform budget_internal.lock_owner(v_owner);
  perform budget_internal.validate_payload(p_budget_data, true);
  insert into public.budgets(user_id, title, budget_number, status, version, lock_version)
    values (v_owner, btrim(p_budget_data->>'title'), btrim(p_budget_data->>'budget_number'), 'borrador', 1, 1)
    returning id into v_id;
  perform budget_internal.apply_header(v_id, p_budget_data - 'budget_number');
  perform budget_internal.replace_items(v_id, p_items);
  return budget_internal.result(v_id, null);
end $fn$;

create function public.save_budget(p_budget_id uuid, p_expected_lock_version integer, p_budget_data jsonb, p_items jsonb)
returns jsonb language sql security definer set search_path = '' as $fn$
  select budget_internal.save_core(p_budget_id, p_expected_lock_version, p_budget_data, p_items, false);
$fn$;
create function public.finalize_budget(p_budget_id uuid, p_expected_lock_version integer, p_budget_data jsonb, p_items jsonb)
returns jsonb language sql security definer set search_path = '' as $fn$
  select budget_internal.save_core(p_budget_id, p_expected_lock_version, p_budget_data, p_items, true);
$fn$;

create function public.change_budget_status(p_budget_id uuid, p_expected_lock_version integer, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare b public.budgets%rowtype;
begin
  b := budget_internal.owned_budget(p_budget_id, p_expected_lock_version);
  if p_status is null or b.status is null or not (
    (b.status in ('pendiente','pending') and p_status = 'enviado')
    or (b.status in ('enviado','sent') and p_status in ('aceptado','rechazado'))
  ) then raise exception 'Invalid budget status transition' using errcode = '22023'; end if;
  if not exists (select 1 from public.document_versions where entity_type = 'budget' and entity_id = b.id and version = b.version) then
    raise exception 'Finalize the budget before changing its status' using errcode = '22023';
  end if;
  update public.budgets set status = p_status, lock_version = lock_version + 1,
    updated_at = clock_timestamp(),
    sent_at = case when p_status = 'enviado' then clock_timestamp() else sent_at end,
    accepted_at = case when p_status = 'aceptado' then clock_timestamp() else null end,
    rejected_at = case when p_status = 'rechazado' then clock_timestamp() else null end,
    accepted_by_name = null, accepted_ip = null where id = b.id;
  return budget_internal.result(b.id, b.status);
end $fn$;

create function public.duplicate_budget(p_budget_id uuid)
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
    canonical_confidence, canonical_source, canonical_origin, canonical_source_ref, price_type)
  select v_id, (row_number() over(order by i.sort_order, i.id) - 1)::integer,
    i.concept, i.description, i.quantity, i.unit, i.category, i.chapter, i.unit_price,
    i.subtotal, i.unit_price_cost, i.subtotal_cost, i.canonical_id, i.canonical_status,
    i.canonical_confidence, i.canonical_source, i.canonical_origin, i.canonical_source_ref, i.price_type
    from public.budget_items i where budget_id = p_budget_id;
  return budget_internal.result(v_id, null);
end $fn$;

-- Explicit target: project links can show several budgets. Read-only tokens
-- remain read-only; E4 must explicitly issue the approve_budgets capability.
create function public.portal_respond_to_budget(p_token text, p_budget_id uuid, p_decision text, p_accepted_by_name text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare t public.portal_tokens%rowtype; b public.budgets%rowtype;
  v_token uuid; v_owner uuid; v_status text;
begin
  begin v_token := p_token::uuid;
  exception when invalid_text_representation then
    raise exception 'Portal link is not available' using errcode = '42501';
  end;
  select pt.* into t from public.portal_tokens pt where pt.token = v_token;
  if not found then raise exception 'Portal link is not available' using errcode = '42501'; end if;
  select user_id into v_owner from public.projects where id = t.project_id;
  perform budget_internal.lock_owner(v_owner);
  select pt.* into t from public.portal_tokens pt where pt.token = v_token for share;
  if not found or not coalesce(t.is_active, false) or t.revoked_at is not null
    or (t.expires_at is not null and t.expires_at <= clock_timestamp())
    or jsonb_typeof(t.permissions) is distinct from 'array'
    or not (t.permissions @> '["approve_budgets"]'::jsonb) then
    raise exception 'Portal link is not available' using errcode = '42501';
  end if;
  perform 1 from public.projects where id = t.project_id and user_id = v_owner for share;
  if not found then raise exception 'Portal link is not available' using errcode = '42501'; end if;
  select * into b from public.budgets where id = p_budget_id and project_id = t.project_id
    and user_id = v_owner and deleted_at is null for update;
  if not found then raise exception 'Budget is not available' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('aceptado','rechazado','accepted','rejected') then
    raise exception 'Invalid portal decision' using errcode = '22023';
  end if;
  if b.status is null or b.status not in ('enviado','sent') then
    raise exception 'Budget is no longer awaiting a response' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.document_versions where entity_type = 'budget' and entity_id = b.id and version = b.version) then
    raise exception 'Budget has no finalized document' using errcode = '22023';
  end if;
  v_status := case when p_decision in ('accepted','aceptado') then 'aceptado' else 'rechazado' end;
  update public.budgets set status = v_status, lock_version = lock_version + 1, updated_at = clock_timestamp(),
    accepted_at = case when v_status = 'aceptado' then clock_timestamp() else null end,
    rejected_at = case when v_status = 'rechazado' then clock_timestamp() else null end,
    accepted_by_name = case when v_status = 'aceptado' then nullif(btrim(p_accepted_by_name), '') else null end,
    accepted_ip = null where id = b.id;
  return budget_internal.result(b.id, b.status);
end $fn$;

revoke all on all functions in schema budget_internal from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema budget_internal revoke execute on functions from public;
revoke all on function public.create_budget_with_items(jsonb,jsonb),
  public.save_budget(uuid,integer,jsonb,jsonb), public.finalize_budget(uuid,integer,jsonb,jsonb),
  public.change_budget_status(uuid,integer,text), public.duplicate_budget(uuid),
  public.portal_respond_to_budget(text,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.create_budget_with_items(jsonb,jsonb),
  public.save_budget(uuid,integer,jsonb,jsonb), public.finalize_budget(uuid,integer,jsonb,jsonb),
  public.change_budget_status(uuid,integer,text), public.duplicate_budget(uuid) to authenticated;
grant execute on function public.portal_respond_to_budget(text,uuid,text,text) to anon, authenticated;
notify pgrst, 'reload schema';
