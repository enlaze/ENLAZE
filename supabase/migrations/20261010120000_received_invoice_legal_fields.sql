-- Datos de factura exigidos para deducir el IVA soportado.
--
-- Hasta ahora una factura recibida guardaba número, proveedor, NIF, fecha de
-- emisión y un único tipo de IVA. El contenido obligatorio de la factura (art.
-- 6 del Reglamento de facturación, RD 1619/2012, y el capítulo de obligaciones
-- formales del manual de IVA de la AEAT) exige además:
--
--   · número Y SERIE, correlativos dentro de cada serie;
--   · fecha de la operación cuando es distinta de la de expedición;
--   · domicilio fiscal del expedidor;
--   · descripción de la operación con los datos para determinar la base;
--   · el tipo O TIPOS impositivos aplicados, con la cuota repercutida
--     consignada por separado.
--
-- Lo que falta no es un detalle estético: sin esos datos el IVA soportado no es
-- deducible, así que el registro tiene que poder guardarlos. Nada pasa a ser
-- obligatorio en la base: las facturas ya registradas siguen siendo válidas y
-- la app avisa de las incompletas en lugar de rechazarlas.
--
-- El runner aplica todo atómicamente; sin control de transacción en el fichero.
set local lock_timeout = '5s';

-- 1. Serie, fecha de operación, domicilio del expedidor y descripción.
--    `notes` se queda como nota interna libre; la descripción de la operación
--    es un dato con valor legal y no debe competir con ella.
ALTER TABLE public.received_invoices
  ADD COLUMN IF NOT EXISTS invoice_series text,
  ADD COLUMN IF NOT EXISTS operation_date date,
  ADD COLUMN IF NOT EXISTS supplier_address text,
  ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN public.received_invoices.invoice_series IS
  'Serie de la factura del proveedor. El número correlativo va en invoice_number.';
COMMENT ON COLUMN public.received_invoices.operation_date IS
  'Fecha de la operación cuando difiere de issue_date (o fecha del pago anticipado).';
COMMENT ON COLUMN public.received_invoices.supplier_address IS
  'Domicilio fiscal del expedidor, obligatorio en la factura completa.';
COMMENT ON COLUMN public.received_invoices.description IS
  'Descripción de la operación facturada. Nota interna aparte, en notes.';

-- 1b. Recuperar el domicilio que ya estaba anotado en la tabla heredada.
--
--     `invoices` guardaba `supplier_address`, pero la unificación no lo
--     trasladó porque en `received_invoices` no existía esa columna todavía.
--     Al validar con datos reales se vio que una de las facturas trasladadas
--     llevaba domicilio y lo perdía de vista. La unificación conserva el `id`,
--     así que se recupera por ahí. Solo rellena lo que está a null, de modo que
--     no pisa nada escrito después y la reejecución no deshace correcciones.
UPDATE public.received_invoices ri
   SET supplier_address = nullif(btrim(i.supplier_address), '')
  FROM public.invoices i
 WHERE i.id = ri.id
   AND ri.supplier_address IS NULL
   AND nullif(btrim(i.supplier_address), '') IS NOT NULL;

-- 2. Desglose por tipos de IVA.
--
--    Una factura con varios tipos (21 % de material y 10 % de mano de obra, por
--    ejemplo) no cabe en un solo `iva_percent`. Se guarda como lista de líneas
--    {base, rate, quota} y SOLO cuando hay más de un tipo: con un tipo único,
--    las columnas de siempre siguen siendo la fuente y esto queda a null, así
--    que ninguna lectura existente cambia de comportamiento.
ALTER TABLE public.received_invoices
  ADD COLUMN IF NOT EXISTS vat_breakdown jsonb;

COMMENT ON COLUMN public.received_invoices.vat_breakdown IS
  'Desglose por tipos de IVA: [{base, rate, quota}]. Null = tipo único en iva_percent/iva_amount.';

-- Forma del desglose. Es una función IMMUTABLE para poder usarla en un CHECK:
-- una fila con un desglose mal formado no debe poder guardarse, porque de ahí
-- salen los importes del resumen fiscal.
CREATE OR REPLACE FUNCTION public.received_invoice_vat_breakdown_is_valid(p_breakdown jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_breakdown IS NULL
      OR (
        jsonb_typeof(p_breakdown) = 'array'
        AND jsonb_array_length(p_breakdown) BETWEEN 1 AND 20
        AND NOT EXISTS (
          SELECT 1
            FROM jsonb_array_elements(p_breakdown) AS t(line)
           WHERE jsonb_typeof(t.line) <> 'object'
              OR jsonb_typeof(t.line -> 'base') IS DISTINCT FROM 'number'
              OR jsonb_typeof(t.line -> 'rate') IS DISTINCT FROM 'number'
              OR jsonb_typeof(t.line -> 'quota') IS DISTINCT FROM 'number'
              OR (t.line ->> 'base')::numeric < 0
              OR (t.line ->> 'rate')::numeric < 0
              OR (t.line ->> 'rate')::numeric > 100
              OR (t.line ->> 'quota')::numeric < 0
        )
      );
$fn$;

-- Suma de un campo del desglose, para contrastarlo con las columnas de totales.
CREATE OR REPLACE FUNCTION public.received_invoice_vat_breakdown_sum(p_breakdown jsonb, p_field text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT coalesce(
    (SELECT sum(round((t.line ->> p_field)::numeric, 2))
       FROM jsonb_array_elements(p_breakdown) AS t(line)),
    0
  );
$fn$;

-- Forma válida y, si hay desglose, cuadre con base imponible y cuota de IVA.
-- Sin esto, el desglose podría contar una historia distinta de la que suman
-- Contabilidad y el informe fiscal, que leen subtotal e iva_amount.
DO $$ BEGIN
  ALTER TABLE public.received_invoices
    ADD CONSTRAINT received_invoices_vat_breakdown_check
    CHECK (
      public.received_invoice_vat_breakdown_is_valid(vat_breakdown)
      AND (
        vat_breakdown IS NULL
        OR (
          abs(coalesce(subtotal, 0)
              - public.received_invoice_vat_breakdown_sum(vat_breakdown, 'base')) <= 0.01
          AND abs(coalesce(iva_amount, 0)
                  - public.received_invoice_vat_breakdown_sum(vat_breakdown, 'quota')) <= 0.01
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Editar una factura recibida, ahora con clasificación y datos legales.
--
--    La edición ya existía, pero solo la alcanzaba el reintento del OCR y no
--    cubría cliente, obra ni categoría: eso se guardaba en un UPDATE aparte que
--    podía fallar por su cuenta y dejar la factura a medio corregir. Un solo
--    RPC, una sola transacción, un solo bloqueo de fila.
--
--    Hay que soltar la firma anterior: añadir parámetros crea una sobrecarga y
--    PostgREST no sabría a cuál de las dos llamar.
DROP FUNCTION IF EXISTS public.update_received_invoice_and_reconcile(
  uuid, text, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric, text, text
);

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
  p_notes text,
  p_client_id uuid,
  p_project_id uuid,
  p_category text,
  p_invoice_series text,
  p_operation_date date,
  p_supplier_address text,
  p_description text,
  p_vat_breakdown jsonb
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

  -- Bloqueo de fila: dos correcciones simultáneas de la misma factura se
  -- aplican una detrás de otra, nunca mezcladas.
  select user_id into v_owner
    from public.received_invoices
   where id = p_invoice_id
     and deleted_at is null
   for update;
  if v_owner is null or v_owner <> v_caller then
    -- Misma respuesta para "no existe", "no es tuya" y "está en la papelera":
    -- no se revela nada. Una factura en la papelera se restaura primero.
    raise exception 'Factura no encontrada' using errcode = 'P0002';
  end if;

  if p_supplier_id is not null
     and not exists (select 1 from public.suppliers where id = p_supplier_id and user_id = v_caller) then
    raise exception 'No autorizado sobre el proveedor de destino' using errcode = '42501';
  end if;

  -- Cliente y obra se comprueban igual que el proveedor. Esta función es
  -- SECURITY DEFINER, así que las políticas RLS no filtran por sí solas y
  -- `deleted_at` hay que mirarlo a mano.
  if p_client_id is not null
     and not exists (select 1 from public.clients where id = p_client_id and user_id = v_caller) then
    raise exception 'No autorizado sobre el cliente de destino' using errcode = '42501';
  end if;

  if p_project_id is not null
     and not exists (
       select 1 from public.projects
        where id = p_project_id and user_id = v_caller and deleted_at is null
     ) then
    raise exception 'No autorizado sobre la obra de destino' using errcode = '42501';
  end if;

  update public.received_invoices
     set invoice_number = p_invoice_number,
         invoice_series = p_invoice_series,
         supplier_id = p_supplier_id,
         supplier_name = p_supplier_name,
         supplier_nif = p_supplier_nif,
         supplier_address = p_supplier_address,
         client_id = p_client_id,
         project_id = p_project_id,
         category = p_category,
         issue_date = p_issue_date,
         operation_date = p_operation_date,
         due_date = p_due_date,
         description = p_description,
         subtotal = p_subtotal,
         iva_percent = p_iva_percent,
         iva_amount = p_iva_amount,
         irpf_percent = p_irpf_percent,
         irpf_amount = p_irpf_amount,
         total = p_total,
         vat_breakdown = p_vat_breakdown,
         payment_method = p_payment_method,
         notes = p_notes,
         updated_at = now()
   where id = p_invoice_id
  returning * into v_row;

  return v_row;
end;
$fn$;

REVOKE ALL ON FUNCTION public.update_received_invoice_and_reconcile(
  uuid, text, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, uuid, uuid, text, text, date, text, text, jsonb
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_received_invoice_and_reconcile(
  uuid, text, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, uuid, uuid, text, text, date, text, text, jsonb
) TO authenticated;

REVOKE ALL ON FUNCTION public.received_invoice_vat_breakdown_is_valid(jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.received_invoice_vat_breakdown_sum(jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.received_invoice_vat_breakdown_is_valid(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.received_invoice_vat_breakdown_sum(jsonb, text) TO authenticated;
