-- S3.3 paso (b): retira de las RPC la compatibilidad con enlaces heredados.
--
-- Solo esquema: no escribe una sola fila. Sustituye portal_read_snapshot y
-- portal_respond_to_change por versiones que exigen una fila en
-- portal_tokens. Hasta hoy, si el token presentado no estaba en esa tabla,
-- ambas lo buscaban en projects.access_token; ese camino ya no lleva a
-- ninguna parte porque el paso (a) dejó la columna a cero.
--
-- Lo que cambia, exactamente:
--   · desaparece la rama `else` que consultaba projects.access_token;
--   · desaparece v_modern, que era el discriminador entre los dos caminos;
--   · un enlace heredado concedía `approve_changes` por defecto, porque era
--     anterior al modelo de permisos. Ahora ambas capacidades salen siempre
--     de permissions, y nada se concede por omisión;
--   · la contabilidad de acceso deja de ser condicional.
--
-- Todo lo demás queda idéntico byte a byte: el cuerpo se generó a partir del
-- texto de 20260915150000 aplicando solo esos cambios. Para un enlace moderno
-- la respuesta no varía, y hay una prueba que lo comprueba por huella.
--
-- Un token desconocido devuelve null, que es lo mismo que devolvía antes un
-- token inválido. Desde fuera no hay forma de distinguir «no existe» de
-- «revocado» ni de «caducado», que es justo lo que se busca.
--
-- Lo que NO hace: no elimina projects.access_token —eso es el paso (c), y su
-- precheck exige que ninguna función la nombre— y no toca privilegios:
-- `create or replace function` conserva la ACL, y la auditoría lo comprueba.
set local lock_timeout = '5s';

do $guard$
declare
  v_restantes integer;
  v_def text;
begin
  if to_regclass('public.projects') is null then
    raise exception 'public.projects is required';
  end if;

  -- El paso (a) tiene que haber terminado. Retirar la compatibilidad mientras
  -- quede un solo enlace heredado dejaría fuera a quien lo tuviera guardado,
  -- sin aviso y sin forma de recuperarlo.
  select count(*) into v_restantes
    from public.projects where access_token is not null;
  if v_restantes > 0 then
    raise exception
      'there are still % legacy links; apply 20260928120000 first', v_restantes;
  end if;

  -- Fallar cerrado si alguien cambió las funciones por otro camino: o están
  -- como las revisamos —con la rama heredada— o ya están migradas. Cualquier
  -- otra cosa significa que esta migración pisaría un cambio ajeno.
  foreach v_def in array array[
    'public.portal_read_snapshot(text)',
    'public.portal_respond_to_change(text,uuid,boolean)'
  ] loop
    if to_regprocedure(v_def) is null then
      raise exception 'missing function %', v_def;
    end if;
  end loop;

  v_def := pg_get_functiondef(to_regprocedure('public.portal_read_snapshot(text)'));
  if v_def not like '%access_token%' and v_def not like '%S3.3(b)%' then
    raise exception 'portal_read_snapshot was modified outside this series; review before replacing';
  end if;

  v_def := pg_get_functiondef(to_regprocedure('public.portal_respond_to_change(text,uuid,boolean)'));
  if v_def not like '%access_token%' and v_def not like '%S3.3(b)%' then
    raise exception 'portal_respond_to_change was modified outside this series; review before replacing';
  end if;
end $guard$;

create or replace function public.portal_read_snapshot(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
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
      'id',i.id,'invoice_number',i.invoice_number,'invoice_date',i.invoice_date,
      'base_amount',i.base_amount,'iva_amount',i.iva_amount,
      'total_amount',i.total_amount,'category',i.category,
      'payment_status',i.payment_status)
      order by i.invoice_date desc,i.id),'[]'::jsonb)
      -- Same rule as the budgets above, approved for invoices on 2026-09-16: an
      -- invoice carrying a project belongs to that project alone, and one without
      -- is attributed to the link's project only when the client leaves no doubt.
      from public.invoices i where i.user_id=v_project.user_id and i.deleted_at is null
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

create or replace function public.portal_respond_to_change(
  p_token text, p_change_id uuid, p_approve boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token uuid;
  v_link public.portal_tokens%rowtype;
  v_project public.projects%rowtype;
  v_change public.project_changes%rowtype;
begin
  if p_change_id is null or p_approve is null then return null; end if;
  begin
    v_token := p_token::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  if v_token is null then return null; end if;

  select * into v_link from public.portal_tokens where token=v_token for share;
  if found then
    if v_link.is_active is distinct from true or v_link.revoked_at is not null
      or (v_link.expires_at is not null and v_link.expires_at <= now()) then
      return null;
    end if;
    if jsonb_typeof(v_link.permissions) is distinct from 'array'
      or not (v_link.permissions @> '["approve_changes"]'::jsonb) then
      return null;
    end if;
    select * into v_project from public.projects
      where id=v_link.project_id and deleted_at is null for share;
  else
    -- S3.3(b): sin fila en portal_tokens no hay a quién responder.
    return null;
  end if;
  if not found then return null; end if;

  select * into v_change from public.project_changes
    where id=p_change_id and project_id=v_project.id and user_id=v_project.user_id
    for update;
  if not found or v_change.status <> 'proposed' then return null; end if;

  update public.project_changes
  set status=case when p_approve then 'approved' else 'rejected' end,
      client_approved=p_approve,
      approved_date=case when p_approve then current_date else null end,
      updated_at=clock_timestamp()
  where id=v_change.id;
  return jsonb_build_object('id',v_change.id,
    'status',case when p_approve then 'approved' else 'rejected' end,
    'client_approved',p_approve);
end;
$$;

notify pgrst, 'reload schema';
