-- Corrective migration for review-msds3yvm-150hxk.
--
-- Replaces update_budget_with_items without changing the historical migration.
-- A sent/accepted/rejected budget is snapshotted transactionally BEFORE its
-- header or line items are replaced, so the signed/accepted revision remains
-- reconstructable from budget_snapshots.

begin;

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

  -- This INSERT intentionally precedes both the budget UPDATE and item DELETE.
  -- Any later failure rolls the whole RPC back, including this snapshot.
  if v_reset_lifecycle then
    -- budget_snapshots.items_data is consumed as BudgetItemV2[]. The editable
    -- budget_items table uses a smaller, legacy schema, so map every row to the
    -- snapshot contract instead of serializing the database row verbatim.
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', item_row.id,
          'chapter', coalesce(nullif(item_row.category, ''), 'otros'),
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

    -- Concurrent snapshot creation can take the same next version. Retry the
    -- small insert on the unique constraint without losing the outer RPC.
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
          -- total_cost and total_sale both use the pre-tax subtotal:
          -- budget_items has one price per line (no cost/sale split), and
          -- budgets.subtotal is documented as that sum "before VAT". Storing
          -- v_budget.total here instead made diffSnapshots report a
          -- spurious sale_delta whenever iva_percent was nonzero.
          coalesce(v_budget.subtotal, 0),
          coalesce(v_budget.subtotal, 0)
        );
        exit;
      exception when unique_violation then
        -- Re-read max(version) and retry.
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
  select p_budget_id,
         btrim(item->>'concept'),
         coalesce(item->>'description', ''),
         (item->>'quantity')::numeric,
         coalesce(nullif(item->>'unit', ''), 'ud'),
         coalesce(nullif(item->>'category', ''), 'otros'),
         (item->>'unit_price')::numeric,
         round((item->>'quantity')::numeric * (item->>'unit_price')::numeric, 2)
    from jsonb_array_elements(p_items) as item;

  return to_jsonb(v_budget);
end;
$$;

revoke all on function public.update_budget_with_items(uuid, jsonb, jsonb)
  from public;
grant execute on function public.update_budget_with_items(uuid, jsonb, jsonb)
  to authenticated;

commit;

notify pgrst, 'reload schema';

-- Manual verification after applying the migration in an authorized
-- environment (do not run as part of this repository change):
--   1. Accept a budget and record its header/items.
--   2. Call update_budget_with_items.
--   3. Confirm the newest budget_snapshots row contains the old header under
--      metadata.budget_data and the old lines under items_data.
