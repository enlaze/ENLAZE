-- VUELTA ATRÁS de la unificación de facturas recibidas.
--
--   20261009120000_unify_received_invoices.sql
--   20261010120000_received_invoice_legal_fields.sql
--
-- NO es una migración: no se pone en supabase/migrations ni se aplica sola. Es
-- el guion que ejecutar a mano si hay que deshacer el despliegue. Sigue el
-- mismo patrón que docs/fase2/ROLLBACK.sql.
--
-- Hay DOS niveles. El 1 es el que se necesita casi siempre; el 2 solo si hay
-- que devolver el esquema al estado exacto de antes.
--
-- Probado sobre el proyecto de pruebas ya migrado: el nivel 2 devuelve el
-- esquema a su forma previa y las dos migraciones se vuelven a aplicar encima
-- sin tocar nada a mano.

-- ════════════════════════════════════════════════════════════════════════════
-- NIVEL 1 — Volver al código anterior dejando el esquema donde está
-- ════════════════════════════════════════════════════════════════════════════
--
-- Para cuando el problema está en el código y se revierte el despliegue, pero
-- la base se queda como está. Dos cosas hacen falta, y ninguna pierde datos:
--
--   a) El código anterior llama a update_received_invoice_and_reconcile con 15
--      parámetros, y la migración la dejó con 23. Hay que devolver la firma
--      vieja, y para eso hay que soltar la nueva: dos sobrecargas harían que
--      PostgREST no sepa a cuál llamar.
--   b) El código anterior escribe en `invoices` desde el navegador, y la
--      unificación le quitó las políticas y los permisos de escritura.
--
-- Lo que el nivel 1 NO deshace: las columnas nuevas, las filas trasladadas y
-- la FK de albaranes se quedan. Son añadidos que el código viejo ignora. Eso sí,
-- las dos facturas trasladadas volverán a verse por duplicado —en el hub y en
-- la pantalla de obras—, que es justo la duplicidad que había antes.

set local lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.update_received_invoice_and_reconcile(
  uuid, text, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, uuid, uuid, text, text, date, text, text, jsonb
);

-- La firma de 15 parámetros, tal y como la creó
-- 20260924150745_fix_p1_signature_invoice_deletion_races.sql.
CREATE OR REPLACE FUNCTION public.update_received_invoice_and_reconcile(
  p_invoice_id uuid,
  p_invoice_number text,
  p_supplier_id uuid,
  p_supplier_name text,
  p_supplier_nif text,
  p_issue_date date,
  p_due_date date,
  p_subtotal numeric,
  p_iva_percent numeric,
  p_iva_amount numeric,
  p_irpf_percent numeric,
  p_irpf_amount numeric,
  p_total numeric,
  p_payment_method text,
  p_notes text
) RETURNS public.received_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
declare
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_row public.received_invoices;
begin
  if v_caller is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select user_id into v_owner
    from public.received_invoices
   where id = p_invoice_id
   for update;
  if v_owner is null or v_owner <> v_caller then
    raise exception 'Factura no encontrada' using errcode = 'P0002';
  end if;

  if p_supplier_id is not null
     and not exists (select 1 from public.suppliers where id = p_supplier_id and user_id = v_caller) then
    raise exception 'No autorizado sobre el proveedor de destino' using errcode = '42501';
  end if;

  update public.received_invoices
     set invoice_number = p_invoice_number,
         supplier_id = p_supplier_id,
         supplier_name = p_supplier_name,
         supplier_nif = p_supplier_nif,
         issue_date = p_issue_date,
         due_date = p_due_date,
         subtotal = p_subtotal,
         iva_percent = p_iva_percent,
         iva_amount = p_iva_amount,
         irpf_percent = p_irpf_percent,
         irpf_amount = p_irpf_amount,
         total = p_total,
         payment_method = p_payment_method,
         notes = p_notes,
         updated_at = now()
   where id = p_invoice_id
  returning * into v_row;

  return v_row;
end;
$fn$;

REVOKE ALL ON FUNCTION public.update_received_invoice_and_reconcile(
  uuid, text, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric, text, text
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_received_invoice_and_reconcile(
  uuid, text, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric, text, text
) TO authenticated;

-- Devolver la escritura de la tabla heredada a los roles del navegador.
-- `anon` se queda fuera a propósito: lo perdió en 20261004180000 y eso no se
-- toca aquí.
GRANT INSERT, UPDATE ON public.invoices, public.invoice_items TO authenticated;

-- Las tres que quitó la migración, con su definición original. La restrictiva
-- invoices_hide_trashed y las de SELECT y DELETE no se tocaron, así que siguen.
DROP POLICY IF EXISTS "Users manage own invoices" ON public.invoices;
CREATE POLICY "Users manage own invoices" ON public.invoices
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS invoices_insert_own ON public.invoices;
CREATE POLICY invoices_insert_own ON public.invoices
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS invoices_update_own ON public.invoices;
CREATE POLICY invoices_update_own ON public.invoices
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.invoices IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- NIVEL 2 — Devolver el esquema al estado anterior
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠ ESTO SÍ PIERDE DATOS. Lo que se haya escrito después del despliegue en
--   serie, fecha de operación, descripción, desglose de IVA, cliente o
--   categoría de una factura recibida desaparece, porque se van las columnas.
--   El domicilio no se pierde del todo: sigue en invoices.supplier_address.
--
--   Antes de ejecutarlo, guarda lo que vayas a necesitar:
--
--     create table respaldo_recibidas_rollback as
--       select id, client_id, category, invoice_series, operation_date,
--              supplier_address, description, vat_breakdown
--         from public.received_invoices;
--
--   Ejecuta el NIVEL 1 primero: deja la RPC y los permisos como los espera el
--   código anterior.

set local lock_timeout = '5s';

-- 1. Deshacer los datos legales (20261010120000).
ALTER TABLE public.received_invoices
  DROP CONSTRAINT IF EXISTS received_invoices_vat_breakdown_check;

ALTER TABLE public.received_invoices
  DROP COLUMN IF EXISTS invoice_series,
  DROP COLUMN IF EXISTS operation_date,
  DROP COLUMN IF EXISTS supplier_address,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS vat_breakdown;

DROP FUNCTION IF EXISTS public.received_invoice_vat_breakdown_is_valid(jsonb);
DROP FUNCTION IF EXISTS public.received_invoice_vat_breakdown_sum(jsonb, text);

-- 2. Soltar los albaranes antes de devolver su FK, o la constraint no entra.
--    Un albarán que apunte a una factura que solo existe en el hub se queda
--    sin factura: en invoices no hay ninguna fila con ese id.
UPDATE public.delivery_notes dn SET invoice_id = NULL
 WHERE dn.invoice_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = dn.invoice_id);

ALTER TABLE public.delivery_notes DROP CONSTRAINT IF EXISTS delivery_notes_invoice_id_fkey;
ALTER TABLE public.delivery_notes
  ADD CONSTRAINT delivery_notes_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;

-- 3. Retirar del hub las facturas que vinieron de la tabla heredada.
--    Se borran por id: la unificación lo conservó, así que una fila del hub
--    cuyo id también está en `invoices` es exactamente una trasladada. Las
--    nativas del hub no se tocan. Los pagos que se les hayan registrado
--    después se van con ellas.
DELETE FROM public.supplier_payments sp
 WHERE EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = sp.received_invoice_id);

DELETE FROM public.received_invoices ri
 WHERE EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = ri.id);

-- 4. Deshacer la clasificación (20261009120000, pasos 1 a 3).
DROP INDEX IF EXISTS public.idx_received_invoices_project;
DROP INDEX IF EXISTS public.idx_received_invoices_client;
DROP INDEX IF EXISTS public.idx_received_invoices_issue_date;

ALTER TABLE public.received_invoices
  DROP CONSTRAINT IF EXISTS received_invoices_category_check;
ALTER TABLE public.received_invoices
  DROP CONSTRAINT IF EXISTS received_invoices_project_id_fkey;
ALTER TABLE public.received_invoices
  DROP CONSTRAINT IF EXISTS received_invoices_client_id_fkey;

ALTER TABLE public.received_invoices
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS client_id;

-- 5. Devolver portal_read_snapshot a la versión anterior.
--
--    No se copia aquí para que no haya dos versiones del mismo cuerpo que se
--    puedan desincronizar. Se reaplican las líneas 72–213 de
--    supabase/migrations/20260929100000_portal_rpcs_drop_legacy_token.sql, que
--    son la función sin la guarda de esa migración (la guarda exige
--    projects.access_token, columna ya retirada):
--
--      sed -n '72,213p' supabase/migrations/20260929100000_portal_rpcs_drop_legacy_token.sql \
--        | psql "$URL_DE_LA_BASE"
--
--    Comprobación de que quedó la de siempre, la misma huella que exige la
--    guarda de la unificación:
--
--      select md5(prosrc) = '41960f0bd6850ba24e8c944117831287'
--        from pg_proc where oid = 'public.portal_read_snapshot(text)'::regprocedure;

-- 6. Borrar el registro de las dos migraciones, o `supabase db push` las dará
--    por aplicadas y no volverá a ejecutarlas.
DELETE FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261009120000', '20261010120000');
