-- b11 · PENDIENTE DE APROBAR por Daniil. No está en supabase/migrations a
-- propósito: nada lo aplica solo. Lanzarlo a mano (SQL editor o MCP) cuando
-- se apruebe. Solo toca presupuestos de cuentas internas
-- (subscriptions.is_internal = true); si alguno ya no lo es, aborta.
--
-- 1. Borra las filas «Material sugerido» que el asistente guardaba como
--    partidas (6 presupuestos, 208 filas el 2026-10-17). La cesta sigue en
--    budgets.wizard_state. Iban al final, así que sort_order queda contiguo.
-- 2. Quita el rejected_at sobrante de PRE-2026-53806 (estado aceptado).
-- Los 4 presupuestos sin partidas y con subtotal NO se tocan: ver el final.

begin;

do $$
declare
  ids uuid[] := array[
    '03d6b1b0-64e1-4c40-a30a-1617d654df6e', -- PRE-2026-18088
    '55082c1b-ebd4-464d-a24a-049845f73734', -- PRE-2026-98502
    '318dc62a-b519-4637-a361-d87ca63aa628', -- PRE-2026-47770
    'c9639fdd-db52-4694-a8bb-68d82e4f7864', -- PRE-2026-21547
    '7ec2e6c5-8397-41c5-8f17-9047689654c3', -- PRE-2026-71515
    '9e8cdda5-b399-4471-aa53-028b5fbade47'  -- PRE-2026-75742 (14 oct, antes del arreglo)
  ]::uuid[];
  externos int;
  borradas int;
begin
  select count(*) into externos
  from budgets b
  where (b.id = any(ids) or b.id = 'dbebca28-2614-4c16-859d-0ea0b25c87a0')
    and not exists (select 1 from subscriptions s
                    where s.user_id = b.user_id and s.is_internal);
  if externos > 0 then
    raise exception 'b11: % presupuestos no son de cuentas internas; no se toca nada', externos;
  end if;

  delete from budget_items
  where budget_id = any(ids)
    and description = 'Material sugerido'
    and category = 'material';
  get diagnostics borradas = row_count;
  raise notice 'b11: % filas «Material sugerido» borradas', borradas;

  update budgets
  set rejected_at = null
  where id = 'dbebca28-2614-4c16-859d-0ea0b25c87a0' -- PRE-2026-53806
    and status = 'aceptado'
    and rejected_at is not null;
end $$;

-- Comprobación: tiene que salir 0.
select count(*) as filas_cesta_restantes
from budget_items
where description = 'Material sugerido' and category = 'material';

commit;

-- Sin partidas y con subtotal (no se tocan; decide Daniil si borrarlos):
--   PRE-2026-53806 aceptado 333,00 € · PRE-2026-32309 borrador 2.448,00 €
--   PRE-2026-19087 aceptado 2.448,00 € · PRE-2026-63983 borrador 2.448,00 €
