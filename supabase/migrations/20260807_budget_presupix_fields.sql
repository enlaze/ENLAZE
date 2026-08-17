-- Adds the per-budget fields required by the new "Presupix" PDF format
-- (anticipo/deposito, forma de pago + IBAN, garantia, plazo de ejecucion,
-- observaciones, condiciones) plus a real `chapter` column on budget_items
-- so both budget flows (clasico y asistente IA) can be grouped into the
-- same section-based item table used by the new PDF template.
--
-- These fields are intentionally stored per-budget (not as global defaults
-- in company Settings) so every presupuesto can carry its own conditions,
-- deposit percentage, warranty text, etc., and can be edited later without
-- affecting other budgets.
--
-- Also replaces update_budget_with_items (superseding the version created in
-- 20260804_preserve_budget_before_lifecycle_edit.sql) so the edit RPC keeps
-- the pre-edit snapshot behaviour while additionally persisting the new
-- fields and the item `chapter`.

begin;

-- ── budgets: new editable fields ────────────────────────────────────────
alter table public.budgets
  add column if not exists deposit_percent numeric(5,2) not null default 30,
  add column if not exists payment_method text not null default 'Transferencia bancaria',
  add column if not exists payment_iban text not null default '',
  add column if not exists warranty_text text not null default '',
  add column if not exists execution_deadline_text text not null default '',
  add column if not exists observations text not null default '',
  add column if not exists conditions_text text not null default '';

alter table public.budgets
  drop constraint if exists budgets_deposit_percent_range;
alter table public.budgets
  add constraint budgets_deposit_percent_range
  check (deposit_percent >= 0 and deposit_percent <= 100);

comment on column public.budgets.deposit_percent is
  'Porcentaje de anticipo solicitado al cliente al aceptar el presupuesto (0-100).';
comment on column public.budgets.payment_method is
  'Forma de pago mostrada en el PDF (p.ej. "Transferencia bancaria").';
comment on column public.budgets.payment_iban is
  'IBAN mostrado en el PDF para el pago del anticipo/resto. Editable por presupuesto.';
comment on column public.budgets.warranty_text is
  'Texto libre de garantia mostrado en el PDF.';
comment on column public.budgets.execution_deadline_text is
  'Texto libre de plazo de ejecucion mostrado en el PDF.';
comment on column public.budgets.observations is
  'Observaciones libres mostradas en el PDF, independientes de las notas internas.';
comment on column public.budgets.conditions_text is
  'Condiciones legales/comerciales del presupuesto mostradas en el PDF.';

-- ── budget_items: real chapter column ───────────────────────────────────
-- Previously `chapter` was referenced by app/api/budgets/pdf/route.ts
-- (`i.chapter || i.category`) but no such column existed, so it always fell
-- back to `category`. Adding it lets both flows group the PDF item table
-- into sections (one per chapter) instead of always collapsing to a single
-- section.
alter table public.budget_items
  add column if not exists chapter text;

comment on column public.budget_items.chapter is
  'Capitulo/seccion tecnica del item (p.ej. fontaneria, electricidad). Nulo en el flujo clasico, donde todos los items comparten una unica seccion.';

-- ── update_budget_with_items: persist the new fields + item chapter ────
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

  v_deposit_percent := greatest(
    0,
    least(100, coalesce((p_budget_data->>'deposit_percent')::numeric, v_budget.deposit_percent, 30))
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
         deposit_percent = v_deposit_percent,
         payment_method = coalesce(nullif(p_budget_data->>'payment_method', ''), 'Transferencia bancaria'),
         payment_iban = coalesce(p_budget_data->>'payment_iban', ''),
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

  insert into public.budget_items (
    budget_id,
    concept,
    description,
    quantity,
    unit,
    category,
    chapter,
    unit_price,
    subtotal
  )
  select p_budget_id,
         btrim(item->>'concept'),
         coalesce(item->>'description', ''),
         (item->>'quantity')::numeric,
         coalesce(nullif(item->>'unit', ''), 'ud'),
         coalesce(nullif(item->>'category', ''), 'otros'),
         nullif(item->>'chapter', ''),
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
