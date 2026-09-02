-- FASE 2D-5 — `update_budget_with_items` canonical-safe
--
-- QUÉ CAMBIA: el INSERT final de `budget_items` pasa de listar 9 columnas
-- económicas a listar esas mismas 9 MÁS las siete canónicas, leyéndolas de cada
-- elemento de `p_items`. Nada más.
--
-- QUÉ NO CAMBIA: la firma, el tipo de retorno, el modelo de seguridad, el
-- search_path, las validaciones de entrada, el snapshot previo al reset de ciclo
-- de vida, el cálculo de subtotal/descuento/IVA/total, el UPDATE de `budgets`, el
-- DELETE de `budget_items` y las nueve columnas económicas del INSERT. Ni una
-- cifra se calcula distinto.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- AVISO IMPORTANTE — ESTE CUERPO SALE DE PRODUCCIÓN, NO DEL REPOSITORIO
-- ─────────────────────────────────────────────────────────────────────────────
-- La función desplegada está POR DELANTE del repositorio. La última migración
-- del repo que la define (20260807_budget_presupix_fields.sql) NO contiene el
-- bloque de descuentos (discount_type / discount_percent / discount_amount), ni
-- `payment_schedule`, ni la base imponible `v_taxable_base` sobre la que
-- producción calcula hoy el IVA y el total. No existe ninguna migración en el
-- repositorio que introduzca eso: llegó por otra vía.
--
-- Por tanto esta migración se ha construido a partir de
-- `pg_get_functiondef()` leído de producción, y NO a partir del fichero del
-- repo. Regenerarla desde el repo habría REVERTIDO los descuentos y el
-- calendario de pagos, cambiando importes reales de presupuestos vivos.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS: DECLARADOS DE FORMA ABSOLUTA (FASE 2D-5a)
-- ─────────────────────────────────────────────────────────────────────────────
-- `CREATE OR REPLACE FUNCTION` CONSERVA la ACL existente, y por eso NO basta con
-- callarse: una base creada desde cero no tendría de dónde heredarla. Producción
-- tenía hoy `{postgres, anon, authenticated, service_role}` y una instalación
-- limpia habría terminado sólo con `{authenticated}`. Divergían.
--
-- El bloque final de este fichero fija la ACL en términos absolutos, no
-- incrementales: revoca de PUBLIC, de `anon` y de `service_role`, y concede
-- únicamente a `authenticated`. Escrito así, el resultado NO depende del estado
-- previo, que es justo la propiedad que faltaba.
--
-- Por qué ese objetivo y no otro: el único llamador real es el formulario de
-- edición, que va con el JWT del usuario y por tanto como `authenticated`. Ni
-- `anon` ni `service_role` llevan JWT de usuario, así que `auth.uid()` les sale
-- NULL y la función aborta en su primera línea con 'Authentication required'.
-- Revocarles EXECUTE no rompe ninguna llamada que hoy funcione: sólo retira
-- superficie sobre una función SECURITY DEFINER propiedad de `postgres`.
--
-- Los REVOKE sobre roles que no tienen el permiso son no-ops, así que el bloque
-- es idempotente y sirve igual en producción y en una base nueva.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ATOMICIDAD
-- ─────────────────────────────────────────────────────────────────────────────
-- El DELETE y el INSERT de `budget_items` viven dentro del MISMO cuerpo plpgsql.
-- Esto es transaccional de verdad, y no es la misma deuda que el DELETE + INSERT
-- que `saveDraft` hace desde el cliente:
--   · es una FUNCTION (`prokind = 'f'`), no un PROCEDURE, así que PostgreSQL no
--     le permite emitir COMMIT ni ROLLBACK aunque quisiera;
--   · el cuerpo no contiene COMMIT, ROLLBACK ni SET TRANSACTION;
--   · no hay dblink ni pg_background instalados, así que no hay ninguna vía de
--     transacción autónoma que pudiera escapar de la transacción exterior;
--   · el único bloque `exception` es el reintento por `unique_violation` del
--     snapshot, que es una SUBtransacción acotada a ese INSERT y no envuelve al
--     DELETE ni al INSERT de `budget_items`.
-- Consecuencia: si el INSERT nuevo viola un constraint canónico, la excepción
-- sube hasta arriba, la llamada entera falla y el DELETE se revierte con ella.
-- Las filas viejas siguen ahí. No hace falta —ni conviene— añadir una
-- transacción manual.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- COMPATIBILIDAD CUANDO NO VIENEN LAS CLAVES
-- ─────────────────────────────────────────────────────────────────────────────
-- Los constraints ya existentes siguen siendo la autoridad; aquí no se añade
-- ninguna regla canónica nueva ni ningún default nuevo:
--   · `canonical_status` es NOT NULL con default 'unmatched'. Como el INSERT
--     ahora la nombra explícitamente, el default de la columna ya no aplica, así
--     que se replica con `coalesce(..., 'unmatched')`. Sin ese coalesce, un
--     `p_items` sin la clave insertaría NULL y rompería el NOT NULL: es decir,
--     rompería el flujo antiguo.
--   · las otras seis son nullable y salen NULL si no vienen.
--   · un `p_items` con SÓLO las columnas económicas —exactamente lo que enviaba
--     el formulario antes de 2D-5— produce por tanto (NULL, 'unmatched', NULL,
--     NULL, NULL, NULL, NULL), que es lo mismo que insertaba la versión
--     anterior por defecto. El comportamiento antiguo se conserva byte a byte.
--   · `ck_canonical_coherence`, `ck_origin_source_ref` y los CHECK de dominio se
--     evalúan como siempre. Si el cliente manda una combinación incoherente, la
--     fila se rechaza y —por lo dicho arriba— la edición entera se revierte. Eso
--     es correcto: un descuadre canónico real de DB sí debe bloquear.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ ESTE FICHERO NO LLEVA `begin;` NI `commit;` — NO LOS AÑADAS
-- ─────────────────────────────────────────────────────────────────────────────
-- El runner del CLI de Supabase (2.115.0) agrupa por defecto TODOS los statements
-- del fichero en un único lote y mete en ESE MISMO lote el INSERT en
-- `supabase_migrations.schema_migrations`. Eso ya da una transacción implícita:
-- o entra el cambio de esquema y queda registrado, o no entra nada.
--
-- Pero si CUALQUIER statement del fichero es control de transacción —`BEGIN`,
-- `START TRANSACTION`, `COMMIT`, `END`, `ABORT`, `ROLLBACK`— el runner cae a la
-- ruta serie: ejecuta los statements uno a uno y hace el INSERT del historial
-- DESPUÉS, ya fuera del `commit;` del fichero. Poner `begin;`/`commit;` aquí no
-- añade atomicidad: la QUITA, porque separa el cambio de esquema de su registro
-- en el historial. Si el proceso muere entre ambos, producción se queda con la
-- función nueva y sin fila en `schema_migrations`.
--
-- Por eso el fichero es una secuencia de statements sueltos y `notify pgrst,
-- 'reload schema';` es el último statement normal. Los `begin` / `end` que verás
-- más abajo están DENTRO del cuerpo `$$ ... $$` de la función: son bloques
-- plpgsql, no control de transacción, y el parser los ve como parte de un único
-- statement.
--
-- Este fichero tampoco lleva `-- pg-delta: transaction=false` como primera línea:
-- esa directiva desactivaría el modo transaccional, que es justo lo que aquí
-- interesa conservar.
--
-- Vigilado por `__tests__/migration-transaction-control.test.mjs`.

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

  -- ÚNICO CAMBIO FUNCIONAL DE ESTA MIGRACIÓN.
  --
  -- Las nueve columnas económicas se copian EXACTAMENTE igual que antes. Debajo
  -- de ellas se añade el transporte de las siete canónicas.
  --
  -- Antes de 2D-5 esta lista tenía nueve columnas y ninguna canónica, así que
  -- cada edición desde el formulario clásico borraba la clasificación y la
  -- procedencia de todas las partidas del presupuesto y las volvía a insertar
  -- con el default 'unmatched'. Ése es el agujero que se cierra aquí.
  insert into public.budget_items (
    budget_id,
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
    price_type
  )
  select p_budget_id,
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
         nullif(item->>'price_type', '')
    from jsonb_array_elements(p_items) as item;

  return to_jsonb(v_budget);
end;
$$;

-- ACL determinista. Estado final, no incremental: se enumera lo que se quita y lo
-- que se pone, de modo que una producción actualizada y una instalación limpia
-- acaben con exactamente los mismos privilegios.
--
-- Resultado garantizado, venga de donde venga la base:
--   owner        postgres  (implícito por propiedad, no se toca)
--   authenticated  EXECUTE
--   anon           sin EXECUTE
--   service_role   sin EXECUTE
--   PUBLIC         sin EXECUTE
revoke all on function public.update_budget_with_items(uuid, jsonb, jsonb)
  from public;
revoke all on function public.update_budget_with_items(uuid, jsonb, jsonb)
  from anon;
revoke all on function public.update_budget_with_items(uuid, jsonb, jsonb)
  from service_role;
grant execute on function public.update_budget_with_items(uuid, jsonb, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
