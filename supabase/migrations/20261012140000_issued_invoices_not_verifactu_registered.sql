-- auto/b10-facturae-sin-firma. Aprobada por Daniil el 2026-10-12.
--
-- Las facturas emitidas salían con verifactu_registered = true porque copiaban
-- fiscal_settings.verifactu_enabled, pero Enlaze no envía nada a la AEAT: el
-- dato es falso. A 12 de octubre son 10 facturas de 2 cuentas, las dos
-- internas (subscriptions.is_internal = true).
--
-- Solo toca esa columna. Idempotente: se puede lanzar más de una vez.

update public.issued_invoices
   set verifactu_registered = false
 where verifactu_registered;
