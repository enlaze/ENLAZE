-- FASE 2F-2 / E1: expansión aditiva, todavía sin control de concurrencia.
-- lock_version es la revisión técnica; NO sustituye a budgets.version.
-- No cambia estados, importes, permisos, funciones ni filas de budget_items.
-- El runner aplica el fichero dentro de una transacción. No añadir BEGIN/COMMIT.
-- Sin IF NOT EXISTS: una columna preexistente inesperada debe abortar el lote.
set local lock_timeout = '5s';

alter table public.budgets
  add column lock_version integer not null default 1
  constraint ck_budgets_lock_version_positive check (lock_version >= 1);

comment on column public.budgets.lock_version is
  'Revision tecnica para control optimista; independiente de version documental. E1 solo inicializa, no incrementa ni detecta conflictos.';

notify pgrst, 'reload schema';
