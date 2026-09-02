-- 20260728_account_deletion_retention.sql
--
-- Hace posible el borrado de cuenta (/api/account/delete) conservando lo que
-- la ley obliga a guardar.
--
-- PROBLEMA
-- issued_invoices, received_invoices y legal_acceptances tienen user_id NOT
-- NULL con FK a auth.users SIN regla ON DELETE (es decir, NO ACTION). Eso deja
-- el borrado de cuenta en un callejón sin salida:
--   · No se puede desvincular la fila: user_id no admite null y cualquier otro
--     uuid viola la FK (error 23503).
--   · No se puede borrar el usuario: la FK lo impide mientras existan facturas
--     ("Database error deleting user").
--   · Borrar las facturas tampoco vale: el art. 30 del Código de Comercio y la
--     LGT obligan a conservarlas ~4 años.
--
-- SOLUCIÓN
-- user_id pasa a admitir null y la FK a ON DELETE SET NULL. Así la factura
-- sobrevive al borrado de la cuenta, desvinculada de su titular, que es
-- justamente lo que pide el art. 17.3.b RGPD: la obligación legal de
-- conservación prevalece, pero el dato deja de estar asociado a la persona.
--
-- Efecto secundario deseable: las políticas RLS comparan auth.uid() = user_id,
-- así que una fila con user_id null no es visible para ningún usuario. Los
-- registros conservados quedan fuera de la aplicación, accesibles solo con
-- service role para cumplir un requerimiento fiscal.
--
-- Idempotente: se puede volver a ejecutar sin error.

begin;

do $$
declare
  t text;
begin
  foreach t in array array['issued_invoices', 'received_invoices', 'legal_acceptances']
  loop
    -- 1) user_id debe admitir null para poder desvincular la fila.
    execute format('alter table public.%I alter column user_id drop not null', t);

    -- 2) La FK a auth.users pasa a ON DELETE SET NULL.
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_user_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references auth.users(id) on delete set null',
      t, t || '_user_id_fkey'
    );
  end loop;
end $$;

commit;

-- Comprobación (debe devolver 3 filas con is_nullable = YES y delete_rule = SET NULL):
--
--   select c.table_name, c.is_nullable, rc.delete_rule
--     from information_schema.columns c
--     join information_schema.key_column_usage kcu
--       on kcu.table_name = c.table_name and kcu.column_name = c.column_name
--     join information_schema.referential_constraints rc
--       on rc.constraint_name = kcu.constraint_name
--    where c.table_schema = 'public'
--      and c.column_name = 'user_id'
--      and c.table_name in ('issued_invoices', 'received_invoices', 'legal_acceptances');
