-- Atomic, owner-scoped editing of a budget and all of its line items.
-- Editing a budget that was already sent/accepted creates a new pending
-- version so a previously accepted document is never silently overwritten.

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
  v_reset_lifecycle boolean;
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

  select status
    into v_current_status
  from public.budgets
  where id = p_budget_id
    and user_id = v_user_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Budget not found';
  end if;

  select round(
    coalesce(
      sum(
        (item->>'quantity')::numeric *
        (item->>'unit_price')::numeric
      ),
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
  v_reset_lifecycle := v_current_status in (
    'enviado', 'sent', 'aceptado', 'accepted', 'rechazado', 'rejected'
  );

  update public.budgets
  set
    client_id = nullif(p_budget_data->>'client_id', '')::uuid,
    project_id = nullif(p_budget_data->>'project_id', '')::uuid,
    title = btrim(p_budget_data->>'title'),
    client_name = coalesce(p_budget_data->>'client_name', ''),
    client_email = coalesce(p_budget_data->>'client_email', ''),
    client_phone = coalesce(p_budget_data->>'client_phone', ''),
    client_address = coalesce(p_budget_data->>'client_address', ''),
    service_type = coalesce(nullif(p_budget_data->>'service_type', ''), 'general'),
    subtotal = v_subtotal,
    iva_percent = v_iva_percent,
    iva_amount = round(v_subtotal * v_iva_percent / 100, 2),
    total = round(v_subtotal + (v_subtotal * v_iva_percent / 100), 2),
    notes = coalesce(p_budget_data->>'notes', ''),
    valid_until = nullif(p_budget_data->>'valid_until', '')::date,
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

  insert into public.budget_items (
    budget_id,
    concept,
    description,
    quantity,
    unit,
    category,
    unit_price,
    subtotal
  )
  select
    p_budget_id,
    btrim(item->>'concept'),
    coalesce(item->>'description', ''),
    (item->>'quantity')::numeric,
    coalesce(nullif(item->>'unit', ''), 'ud'),
    coalesce(nullif(item->>'category', ''), 'otros'),
    (item->>'unit_price')::numeric,
    round(
      (item->>'quantity')::numeric *
      (item->>'unit_price')::numeric,
      2
    )
  from jsonb_array_elements(p_items) as item;

  return to_jsonb(v_budget);
end;
$$;

revoke all on function public.update_budget_with_items(uuid, jsonb, jsonb)
  from public;
grant execute on function public.update_budget_with_items(uuid, jsonb, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
