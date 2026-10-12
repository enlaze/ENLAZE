-- auto/b10-facturae-sin-firma. Aprobada por Daniil y aplicada el 2026-10-12 (versión 20261012113120).
--
-- Decidido por Daniil el 2026-10-12: verifactu_enabled deja de estar activado
-- por defecto. Enlaze no envía nada a la AEAT, así que no hay nada que activar.
--
-- Solo cambia el valor por defecto de las filas NUEVAS. No toca ninguna fila
-- existente: hoy hay 4 ajustes, los 4 a true, y se quedan como están. Las 10
-- facturas ya marcadas las corrige la migración siguiente (20261012113121).
--
-- Idempotente: se puede lanzar más de una vez.

alter table public.fiscal_settings
  alter column verifactu_enabled set default false;
