-- Única fuente de facturas recibidas. El runner aplica todo atómicamente.
set local lock_timeout = '5s';

-- No sobrescribir cambios ajenos en esta RPC SECURITY DEFINER. Huellas del
-- cuerpo exacto de 20260929100000 y de esta migración (permite reejecución).
do $guard$
declare
  v_def text;
  v_hash text;
begin
  if to_regprocedure('public.portal_read_snapshot(text)') is null then
    raise exception 'missing function public.portal_read_snapshot(text)';
  end if;
  select pg_get_functiondef(oid), md5(prosrc) into v_def, v_hash
    from pg_proc where oid = 'public.portal_read_snapshot(text)'::regprocedure;
  if v_def not like '%S3.3(b)%'
     or v_hash not in ('41960f0bd6850ba24e8c944117831287', '787714dede14e83224e7ee0a6c2b86b5') then
    raise exception 'portal_read_snapshot was modified outside this series; review before replacing';
  end if;
end $guard$;

-- 1. Vínculo a cliente y obra
ALTER TABLE public.received_invoices ADD COLUMN IF NOT EXISTS client_id uuid;

DO $$ BEGIN
  ALTER TABLE public.received_invoices
    ADD CONSTRAINT received_invoices_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- `project_id` ya existía pero SIN FK: una obra borrada dejaba facturas
-- apuntando a un uuid inexistente.
DO $$ BEGIN
  ALTER TABLE public.received_invoices
    ADD CONSTRAINT received_invoices_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Categoría de gasto: mismo vocabulario que invoices.category.
--    `category_id` → expense_categories se queda intacta (vacía, sin uso).
ALTER TABLE public.received_invoices
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general';

DO $$ BEGIN
  ALTER TABLE public.received_invoices
    ADD CONSTRAINT received_invoices_category_check
    CHECK (category IN ('material','servicio','suministro','alquiler',
                        'subcontrata','profesional','transporte','seguro','general'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Índices para los filtros nuevos
CREATE INDEX IF NOT EXISTS idx_received_invoices_project
  ON public.received_invoices (user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_received_invoices_client
  ON public.received_invoices (user_id, client_id);
CREATE INDEX IF NOT EXISTS idx_received_invoices_issue_date
  ON public.received_invoices (user_id, issue_date DESC);

-- 4. Traslado de las filas de la tabla antigua.
--    Se conserva el `id` para que los enlaces y documentos ya guardados sigan
--    resolviendo. `invoice_number` y `issue_date` son NOT NULL en destino, así
--    que la fila basura recibe un marcador explícito en vez de perderse.
INSERT INTO public.received_invoices (
  id, user_id, supplier_id, project_id, client_id,
  invoice_number, supplier_name, supplier_nif, issue_date, due_date,
  subtotal, iva_percent, iva_amount, irpf_percent, irpf_amount, total,
  status, payment_status, amount_paid,
  payment_method, document_url, notes, category,
  created_at, updated_at, deleted_at, deleted_by
)
SELECT
  i.id, i.user_id, i.supplier_id, i.project_id, i.client_id,
  COALESCE(NULLIF(btrim(i.invoice_number), ''), 'SIN-NUMERO-' || left(i.id::text, 8)),
  COALESCE(NULLIF(btrim(i.supplier_name), ''), 'Proveedor sin nombre'),
  NULLIF(btrim(i.supplier_nif), ''),
  COALESCE(i.invoice_date, i.created_at::date),
  i.due_date,
  COALESCE(i.base_amount, 0), COALESCE(i.iva_percentage, 21), COALESCE(i.iva_amount, 0),
  COALESCE(i.irpf_percentage, 0), COALESCE(i.irpf_amount, 0), COALESCE(i.total_amount, 0),
  -- invoices.payment_status era pending/paid/overdue/cancelled;
  -- received_invoices separa tramitación (status) de cobro (payment_status).
  CASE i.payment_status
    WHEN 'paid' THEN 'paid' WHEN 'overdue' THEN 'overdue'
    WHEN 'cancelled' THEN 'rejected' ELSE 'pending' END,
  CASE WHEN i.payment_status = 'paid' THEN 'paid' ELSE 'unpaid' END,
  CASE WHEN i.payment_status = 'paid' THEN COALESCE(i.total_amount, 0) ELSE 0 END,
  NULLIF(btrim(i.payment_method), ''),
  NULLIF(btrim(i.image_url), ''),
  NULLIF(btrim(i.notes), ''),
  CASE WHEN i.category IN ('material','servicio','suministro','alquiler',
                           'subcontrata','profesional','transporte','seguro','general')
       THEN i.category ELSE 'general' END,
  i.created_at, i.updated_at, i.deleted_at, i.deleted_by
FROM public.invoices i
WHERE NOT EXISTS (SELECT 1 FROM public.received_invoices ri WHERE ri.id = i.id);

-- 5. Albaranes: repuntar la FK. Las filas trasladadas conservan su id, así que
--    los invoice_id existentes siguen valiendo; los que no resuelvan se limpian
--    antes o la constraint falla. (Hoy hay 0 albaranes con factura.)
UPDATE public.delivery_notes dn SET invoice_id = NULL
 WHERE dn.invoice_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.received_invoices ri WHERE ri.id = dn.invoice_id);

ALTER TABLE public.delivery_notes DROP CONSTRAINT IF EXISTS delivery_notes_invoice_id_fkey;
ALTER TABLE public.delivery_notes
  ADD CONSTRAINT delivery_notes_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.received_invoices(id) ON DELETE SET NULL;

-- 6. Sellar la tabla antigua. NO se borra: dependen de ella invoice_items,
--    move_to_trash y el borrado de cuenta. Se le quitan las políticas de
--    ESCRITURA para que ninguna ruta olvidada siga metiendo facturas que luego
--    no aparecen en ningún informe. La lectura se mantiene (papelera, borrado
--    de cuenta). Todas las funciones que la tocan son SECURITY DEFINER, así que
--    esto no les afecta.
DROP POLICY IF EXISTS "Users manage own invoices" ON public.invoices;
DROP POLICY IF EXISTS invoices_insert_own ON public.invoices;
DROP POLICY IF EXISTS invoices_update_own ON public.invoices;

COMMENT ON TABLE public.invoices IS
  'OBSOLETA desde 20261009: facturas recibidas unificadas en received_invoices. '
  'Se conserva solo por invoice_items, move_to_trash y el borrado de cuenta. '
  'No insertar ni actualizar aquí.';

-- Cerrar también los escritores de líneas heredadas. SELECT y los borrados
-- administrativos se conservan; las RPC SECURITY DEFINER no se ven afectadas.
REVOKE INSERT, UPDATE ON public.invoices, public.invoice_items FROM anon, authenticated;

-- 7. Portal: mismas claves, permisos, aislamiento y regla v_client_single.
create or replace function public.portal_read_snapshot(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
-- Facturas unificadas 20261007; contrato JSON y visibilidad de S3.3(b) intactos.
declare
  v_token uuid;
  v_link public.portal_tokens%rowtype;
  v_project public.projects%rowtype;
  v_now timestamptz := now();
  v_can_changes boolean;
  v_can_budgets boolean;
  v_client_single boolean;
begin
  -- A malformed or unknown link must have the same externally visible result.
  begin
    v_token := p_token::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  if v_token is null then return null; end if;

  select * into v_link from public.portal_tokens where token = v_token;
  if found then
    if v_link.is_active is distinct from true or v_link.revoked_at is not null
       or (v_link.expires_at is not null and v_link.expires_at <= v_now) then
      return null;
    end if;
    select * into v_project from public.projects
      where id = v_link.project_id and deleted_at is null;
  else
    -- S3.3(b): los enlaces anteriores a portal_tokens ya no existen. Un token
    -- desconocido es ahora indistinguible de uno revocado, que es el objetivo.
    return null;
  end if;
  if not found then return null; end if;

  -- A budget with no project reaches a portal only by sharing the link's client.
  -- When that client has one project the link can only mean that project; when it
  -- has several there is nothing in the data that says which, and showing it in
  -- all of them attributes the budget to projects it may have nothing to do with.
  -- So it is shown only in the unambiguous case. Approved 2026-09-16; the effect
  -- is measured in docs/fase2/CIERRE-DECISIONES-PR14.md. Once such a budget gets
  -- a project_id it is visible again through the direct branch.
  v_client_single := v_project.client_id is not null
    and (select count(*) from public.projects q
      where q.client_id = v_project.client_id
        and q.user_id = v_project.user_id
        and q.deleted_at is null) = 1;

  -- Capabilities are reported so the portal never offers an action the database
  -- would refuse. Every caller now carries a portal_tokens row, so both flags
  -- come from its permissions and nothing is granted by default.
  v_can_changes := case
    when jsonb_typeof(v_link.permissions) is distinct from 'array' then false
    else v_link.permissions @> '["approve_changes"]'::jsonb end;
  v_can_budgets := jsonb_typeof(v_link.permissions) is not distinct from 'array'
    and v_link.permissions @> '["approve_budgets"]'::jsonb
    and to_regprocedure('public.portal_respond_to_budget(text,uuid,text,text)') is not null;

  -- Access accounting the reader used to perform through open RLS policies.
  update public.portal_tokens
    set last_accessed_at = v_now, access_count = coalesce(access_count, 0) + 1
    where id = v_link.id;
  -- "Visualizado" in the acceptance timeline means the client opened a budget we
  -- had already sent; a draft must never be stamped.
  update public.budgets set viewed_at = v_now
    where user_id = v_project.user_id and deleted_at is null and viewed_at is null
      and status in ('enviado','sent')
      -- Same visibility rule as the list below: stamping a budget the client was
      -- never shown would put a false "Visualizado" on the acceptance timeline.
      and (project_id = v_project.id or
        (v_client_single and project_id is null and client_id = v_project.client_id));

  return jsonb_build_object(
    'capabilities', jsonb_build_object(
      'respond_budgets', v_can_budgets, 'respond_changes', v_can_changes),
    'project', jsonb_build_object(
      'id',v_project.id, 'name',v_project.name, 'address',v_project.address,
      'description',v_project.description, 'status',v_project.status,
      'start_date',v_project.start_date, 'end_date',v_project.end_date,
      'budget_amount',v_project.budget_amount, 'notes',v_project.notes,
      'created_at',v_project.created_at, 'client_id',v_project.client_id),
    'client', (select jsonb_build_object(
      'id',c.id,'name',c.name,'email',c.email,'phone',c.phone,'company',c.company)
      from public.clients c where c.id=v_project.client_id and c.user_id=v_project.user_id),
    -- can_respond mirrors every condition portal_respond_to_budget enforces.
    -- The reader also lists budgets linked only by client, which that writer
    -- refuses, so a link-wide capability alone would still offer dead buttons.
    'budgets', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',b.id,'budget_number',b.budget_number,'title',b.title,
      'service_type',b.service_type,'status',b.status,'subtotal',b.subtotal,
      'iva_amount',b.iva_amount,'total',b.total,'created_at',b.created_at,
      'can_respond', v_can_budgets
        -- is not distinct from: a client-linked budget has a null project_id,
        -- and "=" would make the whole flag null instead of false.
        and b.project_id is not distinct from v_project.id
        and b.status in ('enviado','sent')
        and exists (select 1 from public.document_versions dv
          where dv.entity_type='budget' and dv.entity_id=b.id and dv.version=b.version))
      order by b.created_at desc,b.id),'[]'::jsonb)
      from public.budgets b where b.user_id=v_project.user_id and b.deleted_at is null
      -- Client-facing states only. An allowlist, not "except borrador": status is
      -- nullable and a future state must not reach a client by default.
      and b.status in ('pendiente','pending','enviado','sent',
        'aceptado','accepted','rechazado','rejected')
      and (b.project_id=v_project.id or
        (v_client_single and b.project_id is null and b.client_id=v_project.client_id))),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,'invoice_number',i.invoice_number,'invoice_date',i.issue_date,
      'base_amount',i.subtotal,'iva_amount',i.iva_amount,
      'total_amount',i.total,'category',i.category,
      'payment_status',i.status)
      order by i.issue_date desc,i.id),'[]'::jsonb)
      -- Same rule as the budgets above, approved for invoices on 2026-09-16: an
      -- invoice carrying a project belongs to that project alone, and one without
      -- is attributed to the link's project only when the client leaves no doubt.
      from public.received_invoices i where i.user_id=v_project.user_id and i.deleted_at is null
      and (i.project_id=v_project.id or
        (v_client_single and i.project_id is null and i.client_id=v_project.client_id))),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',pay.id,'amount',pay.amount,'payment_date',pay.payment_date,
      'payment_method',pay.payment_method,'concept',pay.concept)
      order by pay.payment_date desc,pay.id),'[]'::jsonb)
      from public.payments pay where pay.project_id=v_project.id
      and pay.user_id=v_project.user_id),
    'changes', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',ch.id,'title',ch.title,'description',ch.description,
      'economic_impact',ch.economic_impact,'time_impact_days',ch.time_impact_days,
      'status',ch.status,'client_approved',ch.client_approved,
      'notes',ch.notes,'created_at',ch.created_at)
      order by ch.created_at desc,ch.id),'[]'::jsonb)
      from public.project_changes ch where ch.project_id=v_project.id
      and ch.user_id=v_project.user_id),
    'milestones', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',m.id,'title',m.title,'planned_date',m.planned_date,
      'actual_date',m.actual_date,'status',m.status,
      'sort_order',m.sort_order,'notes',m.notes)
      order by m.sort_order,m.id),'[]'::jsonb)
      from public.project_milestones m where m.project_id=v_project.id)
  );
end;
$$;

notify pgrst, 'reload schema';
