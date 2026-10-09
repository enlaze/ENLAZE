-- Permisos de partida, tal y como están en producción: authenticated y
-- service_role con todo sobre las tres tablas, anon sin nada (eso ya lo dejó
-- 20261004180000_anon_loses_table_privileges). Sin esto, comprobar que la
-- unificación quita INSERT/UPDATE y conserva SELECT no probaría nada.
grant delete, insert, references, select, trigger, truncate, update
  on public.invoices, public.invoice_items, public.received_invoices
  to authenticated, service_role;
