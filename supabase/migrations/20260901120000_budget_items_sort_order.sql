-- FASE 2E-2 — ORDEN DETERMINISTA DE `budget_items`
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL DEFECTO QUE SE CIERRA
-- ─────────────────────────────────────────────────────────────────────────────
-- `budget_items.sort_order` existe desde la creación de la tabla y NADIE la ha
-- escrito nunca: las 807 filas de producción están a 0. El orden de las partidas
-- lo decidían cuatro lectores con `order by created_at asc` y sin desempate.
--
-- Pero las filas de un presupuesto se escriben TODAS en el mismo INSERT, con un
-- solo `now()`. En 12 de los 12 presupuestos con partidas, `created_at` es
-- constante dentro del presupuesto. Ordenar por una columna constante no ordena:
-- devuelve lo que el plan de ejecución tenga a mano. Que hasta hoy saliera bien
-- casi siempre fue un accidente del montón, no una garantía.
--
-- Esta migración convierte `sort_order` en la fuente de verdad del orden.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ LAS TRES PARTES VAN EN EL MISMO FICHERO
-- ─────────────────────────────────────────────────────────────────────────────
-- La RPC, el backfill y las constraints NO son separables. La edición clásica
-- (`update_budget_with_items`) borra todas las partidas del presupuesto y las
-- reinserta. Si la UNIQUE entrase sin arreglar antes la RPC, la primera edición
-- de cualquier presupuesto con más de una partida reinsertaría todas sus filas
-- al `default 0` y VIOLARÍA la constraint: la edición clásica quedaría rota en
-- producción. Y si el backfill entrase sin la UNIQUE, nada impediría que el
-- orden se volviese a perder mañana.
--
-- Por eso el orden de los statements es: RPC primero (el contrato), backfill
-- después (los datos), verificación, y sólo entonces las constraints.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- INVARIANTE ABSOLUTA
-- ─────────────────────────────────────────────────────────────────────────────
-- Esta migración sólo puede modificar `budget_items.sort_order` y la definición
-- y constraints asociadas a esa columna. Ni un valor de ninguna otra columna.
--
-- No se confía en que eso sea evidente leyendo el UPDATE: el bloque de backfill
-- calcula una huella md5 del contenido de las 807 filas EXCLUYENDO `sort_order`
-- antes y después de escribir, y ABORTA la migración entera si difieren.
-- Comprueba además el recuento de filas y el conjunto exacto de ids.
--
-- La huella se construye con `to_jsonb(bi) - 'sort_order'`, NO con una lista de
-- columnas escrita a mano. Una lista enumerada cubría 17 de las 22 columnas
-- reales de la tabla y dejaba fuera `name`, `created_at`, `unit_price_cost` y
-- `subtotal_cost`: una prueba con agujeros, que además envejece en silencio en
-- cuanto alguien añade una columna. `to_jsonb` de la fila entera cubre todas las
-- que hay hoy y todas las que se añadan mañana. El orden de claves que produce
-- `jsonb` es determinista, así que la huella es comparable consigo misma.
--
-- Referencia medida en producción (sólo SELECT, 2026-09-01):
--   filas                                        807
--   Σ(quantity × unit_price)             978511.3000
--   Σ(subtotal)                            978511.61
--   md5 de los ids                edb8e516ceb157ee061d19b063fd888c
--   md5 del contenido sin sort_order
--                                 6de4f522e8b6943bf81ff6064405aa94
--
-- ─────────────────────────────────────────────────────────────────────────────
-- FUENTES DEL BACKFILL, Y LAS QUE SE DESCARTARON
-- ─────────────────────────────────────────────────────────────────────────────
-- SE USA `wizard_state`. Es el único registro que conserva el orden que el
-- usuario vio. El recuento de filas se descompone exactamente como
-- `partidas + materials` en los 11 presupuestos que lo tienen (104=59+45,
-- 88=58+30, 71=0+71, 71=47+24, 18=9+9, 15=9+6), las partidas se emparejan por
-- `concept` y los materiales por `name`, y esas claves son únicas dentro de cada
-- presupuesto. Emparejan 806 de las 807 filas.
--
-- NO se usa `created_at`: está demostrado constante dentro del presupuesto, no
-- contiene información de orden.
--
-- NO se usa `ctid` ni el orden físico. `ctid` coincidía con el orden del
-- asistente en 8 de 9 presupuestos y parecía una fuente perfecta, pero en
-- `97fe070f` no acierta NI UNA de sus 58 posiciones: es una permutación
-- completa, casi con seguridad por reutilización de páginas tras cientos de
-- miles de borrados. Una fuente que falla en silencio en uno de cada nueve
-- casos no es una fuente.
--
-- LO QUE NO APAREZCA en `wizard_state` va detrás, ordenado por `id`. No es una
-- reconstrucción histórica y no pretende serlo: es la admisión de que ahí el
-- orden no se puede saber, y lo único que se hace es volverlo ESTABLE. No se
-- inventa una verdad histórica que no existe.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCIA
-- ─────────────────────────────────────────────────────────────────────────────
-- El backfill sólo actúa sobre presupuestos cuyo histórico AÚN NO está ordenado,
-- entendiendo por ordenado que sus filas ya forman exactamente 0..N-1 sin nulos
-- ni repetidos. Después de esta migración todos lo cumplen, así que volver a
-- ejecutar la lógica no toca ni una fila. Y, sobre todo: no puede pisar las
-- posiciones que los writers de la FASE 2E-1 ya estén escribiendo desde la
-- aplicación.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ ESTE FICHERO NO LLEVA `begin;` NI `commit;` — NO LOS AÑADAS
-- ─────────────────────────────────────────────────────────────────────────────
-- El runner del CLI de Supabase agrupa por defecto TODOS los statements del
-- fichero en un único lote y mete en ESE MISMO lote el INSERT en
-- `supabase_migrations.schema_migrations`. Eso ya da la transacción implícita
-- que aquí se necesita: la RPC nueva, el backfill y las constraints entran como
-- un solo cambio, o no entra nada.
--
-- Si CUALQUIER statement del fichero fuese control de transacción —`BEGIN`,
-- `START TRANSACTION`, `COMMIT`, `END`, `ABORT`, `ROLLBACK`— el runner caería a
-- la ruta serie: ejecutaría los statements uno a uno y registraría el historial
-- DESPUÉS, ya fuera del `commit;` del fichero. Poner `begin;`/`commit;` aquí no
-- añadiría atomicidad: la QUITARÍA. Los `begin` / `end` que se ven más abajo
-- están DENTRO de cuerpos `$$ ... $$`: son bloques plpgsql, no control de
-- transacción.
--
-- Tampoco lleva `-- pg-delta: transaction=false` como primera línea: esa
-- directiva desactivaría el modo transaccional, que es justo lo que interesa
-- conservar.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. LA RPC — EL CONTRATO
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Este cuerpo es el de 20260826103500_update_budget_with_items_canonical.sql con
-- TRES cambios, todos en el INSERT final, y ninguno más:
--
--   a) `from jsonb_array_elements(p_items) as item`
--      pasa a
--      `from jsonb_array_elements(p_items) with ordinality as t(item, ordinality)`
--
--   b) la lista de columnas gana `sort_order`;
--
--   c) la lista de valores gana `(ordinality - 1)::integer`.
--
-- La posición la define la POSICIÓN DEL ELEMENTO DENTRO DE `p_items`, no un
-- `sort_order` que venga en el JSON. Es deliberado: el array es el contrato, y
-- un campo enviado por el cliente podría llegar repetido, con huecos o
-- desalineado con el array que lo transporta, y la UNIQUE lo rechazaría con un
-- error que el usuario no podría entender. `with ordinality` no puede repetirse
-- ni saltarse: Postgres lo genera.
--
-- `ordinality` es base 1; el contrato es base 0. De ahí el `- 1`.
--
-- Todo lo demás se conserva: firma, tipo de retorno, `security definer`,
-- `search_path = public, pg_temp`, validaciones de entrada, snapshot previo al
-- reset de ciclo de vida, descuentos, base imponible, IVA, total, UPDATE de
-- `budgets`, DELETE de `budget_items`, las nueve columnas económicas y las siete
-- canónicas. Ni una cifra se calcula distinto.
--
-- Verificado por `__tests__/budget-items-sort-order-migration.test.mjs`, que
-- deshace mecánicamente los tres cambios y exige que el cuerpo resultante sea
-- idéntico al desplegado.

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
    price_type
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
         nullif(item->>'price_type', '')
    from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  return to_jsonb(v_budget);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. BACKFILL HISTÓRICO
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Va en un bloque plpgsql porque necesita RAISE: la migración tiene que poder
-- ABORTARSE si no consigue construir una asignación completa y única, en lugar
-- de improvisar posiciones y dejar que la UNIQUE falle después con un mensaje
-- que no explicaría nada.
--
-- La asignación se materializa en una tabla temporal ANTES de tocar una sola
-- fila, precisamente para poder auditarla antes de escribir.

do $backfill$
declare
  v_filas_antes bigint;
  v_ids_antes text;
  v_huella_antes text;
  v_filas_despues bigint;
  v_ids_despues text;
  v_huella_despues text;
  v_presupuestos_elegibles bigint;
  v_filas_asignadas bigint;
  v_actualizadas bigint;
  v_anomalias bigint;
begin
  -- ── Huella del contenido ANTES ────────────────────────────────────────────
  -- TODAS las columnas de la fila menos `sort_order`, sin enumerar ninguna: la
  -- fila entera pasa por `to_jsonb` y se le quita esa única clave. Es la prueba
  -- ejecutable de la invariante absoluta —si al final esta huella no coincide, la
  -- migración ha tocado algo que no le corresponde y se aborta— y es la forma que
  -- no puede quedarse corta: una lista escrita a mano se olvidaría de `name`,
  -- `created_at`, `unit_price_cost` y `subtotal_cost`, y volvería a olvidarse de
  -- la siguiente columna que alguien añada.
  select count(*),
         md5(coalesce(string_agg(x.i, '|' order by x.i), '')),
         md5(coalesce(string_agg(x.h, '|' order by x.h), ''))
    into v_filas_antes, v_ids_antes, v_huella_antes
    from (
      select bi.id::text as i,
             md5((to_jsonb(bi) - 'sort_order')::text) as h
        from public.budget_items bi
    ) x;

  -- ── La asignación, materializada y todavía sin aplicar ────────────────────
  create temp table tmp_2e_asignacion on commit drop as
  with elegibles as (
    -- Un presupuesto está YA ORDENADO si sus filas forman exactamente 0..N-1 sin
    -- nulos ni repetidos. Sólo se toca lo que NO lo cumple. Esto es lo que hace
    -- el backfill idempotente y lo que impide que pise las posiciones que los
    -- writers de la aplicación (FASE 2E-1) ya estén escribiendo.
    select bi.budget_id
      from public.budget_items bi
     group by bi.budget_id
    having not (
      count(*) filter (where bi.sort_order is null) = 0
      and min(coalesce(bi.sort_order, -1)) = 0
      and max(coalesce(bi.sort_order, -1)) = count(*) - 1
      and count(distinct coalesce(bi.sort_order, -1)) = count(*)
    )
  ),
  posiciones as (
    -- Las partidas primero, los materiales después: es la estructura histórica
    -- verificada en los 11 presupuestos con wizard_state, donde el número de
    -- filas se descompone exactamente como partidas + materials.
    --
    -- `min(posicion)` por clave: si dos filas compartiesen nombre —hoy no ocurre
    -- en ninguno de los 12 presupuestos— serían indistinguibles y el desempate
    -- por `id` las ordenaría de forma estable. No se inventa cuál iba primero.
    select w.budget_id, w.clave, min(w.posicion) as posicion
      from (
        select b.id as budget_id,
               btrim(p.elem->>'concept') as clave,
               (p.ord - 1)::int as posicion
          from public.budgets b,
               jsonb_array_elements(coalesce(b.wizard_state->'partidas', '[]'::jsonb))
                 with ordinality as p(elem, ord)
         where jsonb_typeof(b.wizard_state->'partidas') = 'array'
        union all
        select b.id,
               btrim(m.elem->>'name'),
               coalesce(jsonb_array_length(b.wizard_state->'partidas'), 0) + (m.ord - 1)::int
          from public.budgets b,
               jsonb_array_elements(coalesce(b.wizard_state->'materials', '[]'::jsonb))
                 with ordinality as m(elem, ord)
         where jsonb_typeof(b.wizard_state->'materials') = 'array'
      ) w
     where w.clave is not null
     group by w.budget_id, w.clave
  )
  select bi.id,
         bi.budget_id,
         -- `nulls last`: lo que no aparece en wizard_state va detrás, ordenado
         -- por `id`. `row_number()` sobre una clave total —(posicion, id), y `id`
         -- es la PK, así que nunca empata— produce 1..N por construcción, de
         -- donde sale 0..N-1 completo y único sin que haya que confiar en nada.
         (row_number() over (
            partition by bi.budget_id
            order by pos.posicion nulls last, bi.id
         ) - 1)::integer as nuevo_sort_order
    from public.budget_items bi
    join elegibles e on e.budget_id = bi.budget_id
    left join posiciones pos
      on pos.budget_id = bi.budget_id
     and pos.clave = btrim(bi.concept);

  select count(distinct budget_id), count(*)
    into v_presupuestos_elegibles, v_filas_asignadas
    from tmp_2e_asignacion;

  raise notice 'FASE 2E-2 backfill: % presupuestos elegibles, % filas a reordenar (de % totales)',
    v_presupuestos_elegibles, v_filas_asignadas, v_filas_antes;

  -- ── GUARDA 1. Antes de actualizar una sola fila ───────────────────────────
  -- Para cada presupuesto de la asignación: sin nulos, sin negativos, min = 0,
  -- max = count - 1 y count(distinct) = count. Si no se puede garantizar, la
  -- migración entera falla aquí y no llega a aplicar ninguna constraint.
  select count(*)
    into v_anomalias
    from (
      select budget_id,
             count(*) as n,
             count(*) filter (where nuevo_sort_order is null) as nulos,
             count(*) filter (where nuevo_sort_order < 0) as negativos,
             min(nuevo_sort_order) as mn,
             max(nuevo_sort_order) as mx,
             count(distinct nuevo_sort_order) as distintos
        from tmp_2e_asignacion
       group by budget_id
    ) g
   where g.nulos <> 0
      or g.negativos <> 0
      or g.mn <> 0
      or g.mx <> g.n - 1
      or g.distintos <> g.n;

  if v_anomalias > 0 then
    raise exception
      'FASE 2E-2 abortada: % presupuestos sin una asignacion 0..N-1 completa y unica. No se ha modificado ninguna fila.',
      v_anomalias;
  end if;

  -- ── La única escritura de esta migración ──────────────────────────────────
  -- Un solo SET, sobre una sola columna.
  update public.budget_items bi
     set sort_order = a.nuevo_sort_order
    from tmp_2e_asignacion a
   where a.id = bi.id
     and bi.sort_order is distinct from a.nuevo_sort_order;

  get diagnostics v_actualizadas = row_count;
  raise notice 'FASE 2E-2 backfill: % filas actualizadas', v_actualizadas;

  -- ── GUARDA 2. La invariante absoluta, demostrada ──────────────────────────
  select count(*),
         md5(coalesce(string_agg(x.i, '|' order by x.i), '')),
         md5(coalesce(string_agg(x.h, '|' order by x.h), ''))
    into v_filas_despues, v_ids_despues, v_huella_despues
    from (
      select bi.id::text as i,
             md5((to_jsonb(bi) - 'sort_order')::text) as h
        from public.budget_items bi
    ) x;

  if v_filas_despues <> v_filas_antes then
    raise exception 'FASE 2E-2 abortada: el numero de filas cambio de % a %',
      v_filas_antes, v_filas_despues;
  end if;

  if v_ids_despues <> v_ids_antes then
    raise exception 'FASE 2E-2 abortada: el conjunto de ids de budget_items ha cambiado';
  end if;

  if v_huella_despues <> v_huella_antes then
    raise exception
      'FASE 2E-2 abortada: se ha modificado alguna columna distinta de sort_order (huella % -> %)',
      v_huella_antes, v_huella_despues;
  end if;
end;
$backfill$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. VERIFICACIÓN PREVIA A LAS CONSTRAINTS
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Bloque aparte y a propósito. El de arriba comprueba la asignación que él mismo
-- calculó; éste comprueba la TABLA ENTERA, incluidos los presupuestos que el
-- backfill decidió no tocar por estar ya ordenados. Es lo que demuestra que la
-- UNIQUE puede añadirse sin que falle, y falla con un mensaje legible si no.

do $verificacion$
declare
  v_nulos bigint;
  v_negativos bigint;
  v_duplicados bigint;
  v_presupuestos_malos bigint;
  v_total bigint;
begin
  select count(*) into v_total from public.budget_items;

  select count(*) into v_nulos
    from public.budget_items where sort_order is null;

  select count(*) into v_negativos
    from public.budget_items where sort_order < 0;

  select count(*) into v_duplicados
    from (
      select budget_id, sort_order
        from public.budget_items
       group by budget_id, sort_order
      having count(*) > 1
    ) d;

  select count(*) into v_presupuestos_malos
    from (
      select budget_id,
             count(*) as n,
             min(sort_order) as mn,
             max(sort_order) as mx,
             count(distinct sort_order) as distintos
        from public.budget_items
       group by budget_id
    ) g
   where g.mn <> 0
      or g.mx <> g.n - 1
      or g.distintos <> g.n;

  raise notice 'FASE 2E-2 verificacion: % filas, % nulos, % negativos, % duplicados, % presupuestos no contiguos',
    v_total, v_nulos, v_negativos, v_duplicados, v_presupuestos_malos;

  if v_nulos <> 0 then
    raise exception 'FASE 2E-2 abortada: % filas con sort_order NULL', v_nulos;
  end if;

  if v_negativos <> 0 then
    raise exception 'FASE 2E-2 abortada: % filas con sort_order negativo', v_negativos;
  end if;

  if v_duplicados <> 0 then
    raise exception
      'FASE 2E-2 abortada: % pares (budget_id, sort_order) duplicados. La UNIQUE fallaria.',
      v_duplicados;
  end if;

  if v_presupuestos_malos <> 0 then
    raise exception
      'FASE 2E-2 abortada: % presupuestos donde sort_order no es 0..N-1 completo (min=0, max=count-1, distinct=count)',
      v_presupuestos_malos;
  end if;
end;
$verificacion$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. CONSTRAINTS DE INTEGRIDAD
-- ═════════════════════════════════════════════════════════════════════════════
--
-- El DEFAULT 0 se CONSERVA. Se reafirma en términos absolutos para que una base
-- creada desde cero acabe con exactamente el mismo estado que producción, igual
-- que se hace con la ACL de la RPC.
--
-- Un 0 es una primera posición válida en base 0, así que el default sigue siendo
-- coherente con el contrato: una fila insertada sin posición explícita aterriza
-- en la primera. Lo que impide que se acumulen ceros es la UNIQUE.
alter table public.budget_items
  alter column sort_order set default 0;

alter table public.budget_items
  alter column sort_order set not null;

-- Los dos constraints se añaden bajo guarda `if not exists` porque
-- `add constraint` no la admite en línea y un reintento de la migración fallaría
-- con `duplicate_object` en vez de ser un no-op.
do $ck$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.budget_items'::regclass
       and conname = 'ck_budget_items_sort_order_non_negative'
  ) then
    alter table public.budget_items
      add constraint ck_budget_items_sort_order_non_negative
      check (sort_order >= 0);
  end if;
end;
$ck$;

-- La UNIQUE crea por debajo un índice btree sobre `(budget_id, sort_order)`, que
-- es exactamente el que necesita el `order by sort_order` de los lectores. Por
-- eso NO se crea un segundo índice: sería el mismo índice dos veces, con su
-- coste de escritura duplicado y sin ninguna ganancia de lectura.
do $uq$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.budget_items'::regclass
       and conname = 'uq_budget_items_budget_id_sort_order'
  ) then
    alter table public.budget_items
      add constraint uq_budget_items_budget_id_sort_order
      unique (budget_id, sort_order);
  end if;
end;
$uq$;

comment on column public.budget_items.sort_order is
  'Posicion de la partida dentro del presupuesto. Entero base 0, contiguo y unico '
  'por budget_id. La asigna el writer desde el indice del array que persiste; los '
  'lectores ordenan por (sort_order asc, id asc). No derivar nunca de created_at: '
  'todas las filas de un presupuesto comparten instante de insercion. FASE 2E.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. ACL DE LA RPC — ESTADO ABSOLUTO
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `create or replace function` CONSERVA la ACL existente, así que callarse aquí
-- haría que producción y una instalación limpia divergiesen. Se repite el mismo
-- bloque absoluto de 20260826103500, sin cambios:
--   owner          postgres  (implícito por propiedad, no se toca)
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
