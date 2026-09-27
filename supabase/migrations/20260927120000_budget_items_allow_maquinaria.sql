-- `maquinaria` pasa a ser una categoría válida de budget_items.
--
-- El defecto: el prompt del generador vivo
-- (app/api/agent/budget-analysis/route.ts) ofrece al modelo cuatro categorías
-- —mano_obra, material, maquinaria, otros— y el CHECK solo admite tres. Nada
-- las reconcilia por el camino: BudgetGenerateProvider aplica
-- `text(row.category, "otros")`, y ese "otros" es el valor por defecto para
-- cadenas vacías, no una normalización. Una partida clasificada como
-- maquinaria llega intacta al escritor y revienta con 23514.
--
-- Comprobado en producción antes de escribir esto: de 911 partidas, 0 son
-- maquinaria (583 material, 310 mano_obra, 18 otros).
--
-- Decisión de producto: se amplía el vocabulario en vez de quitarla del prompt.
-- El generador de PDF ya la trata como agrupación propia
-- (lib/pdf-generator.ts), así que el resto del sistema ya asume que existe.
--
-- Esto SOLO amplía. No toca ninguna de las 911 filas, no relaja la restricción
-- —cualquier categoría fuera de las cuatro se sigue rechazando— y no cambia
-- ningún otro vocabulario. `maquinaria` como `business_subsector` del banco de
-- precios es otra columna y otra lista; esta migración no la mira.
set local lock_timeout = '5s';

do $guard$
declare
  v_definicion text;
  v_desconocidas integer;
begin
  if to_regclass('public.budget_items') is null then
    raise exception 'public.budget_items is required before widening its category vocabulary';
  end if;

  select pg_get_constraintdef(oid) into v_definicion
    from pg_constraint
   where conrelid = 'public.budget_items'::regclass
     and conname = 'budget_items_category_check';

  if not found then
    raise exception 'budget_items_category_check does not exist; refusing to invent it';
  end if;

  -- Se exige el vocabulario de partida exacto. Si alguien ya lo amplió o lo
  -- cambió, esta migración no es la que corresponde.
  if v_definicion is distinct from
     'CHECK ((category = ANY (ARRAY[''material''::text, ''mano_obra''::text, ''otros''::text])))' then
    raise exception 'unexpected budget_items_category_check definition: %', v_definicion;
  end if;

  -- Ampliar no puede invalidar ninguna fila, pero se comprueba igual: si
  -- hubiera una categoría fuera de las cuatro, el CHECK nuevo fallaría al
  -- crearse y es mejor decir cuántas son que dejar que reviente sin contexto.
  select count(*) into v_desconocidas
    from public.budget_items
   where category is not null
     and category not in ('material', 'mano_obra', 'maquinaria', 'otros');
  if v_desconocidas > 0 then
    raise exception
      'There are % budget_items with a category outside the new vocabulary; review them by hand', v_desconocidas;
  end if;
end $guard$;

alter table public.budget_items
  drop constraint budget_items_category_check;

alter table public.budget_items
  add constraint budget_items_category_check
  check (category = any (array['material'::text, 'mano_obra'::text, 'maquinaria'::text, 'otros'::text]));

comment on constraint budget_items_category_check on public.budget_items is
  'Vocabulario canónico de categorías de partida. maquinaria se añadió el '
  '2026-09-27 porque el generador ya la ofrecía y el PDF ya la agrupaba aparte. '
  'Cualquier valor fuera de la lista se sigue rechazando.';

notify pgrst, 'reload schema';
