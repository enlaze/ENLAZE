-- PENDIENTE DE APROBAR (auto/b10-facturae-sin-firma). No aplicada.
--
-- Decidido por Daniil el 2026-10-12: verifactu_enabled deja de estar activado
-- por defecto. Enlaze no envía nada a la AEAT, así que no hay nada que activar.
--
-- Solo cambia el valor por defecto de las filas NUEVAS. No toca ninguna fila
-- existente: hoy hay 4 ajustes, los 4 a true, y se quedan como están. Las 10
-- facturas ya marcadas verifactu_registered = true tampoco se tocan.
--
-- Idempotente: se puede lanzar más de una vez.

alter table public.fiscal_settings
  alter column verifactu_enabled set default false;
