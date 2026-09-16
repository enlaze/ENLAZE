-- Validate a presented portal link without making every active link enumerable.
-- This migration precedes 20260915160000_budget_revision_rpcs.sql.
begin;
set local lock_timeout = '5s';

drop policy if exists "Public portal token read" on public.portal_tokens;
drop policy if exists portal_tokens_anon_read on public.portal_tokens;
drop policy if exists "Public update budget status" on public.budgets;
drop policy if exists "Public update change approval" on public.project_changes;

create function public.portal_read_snapshot(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token uuid;
  v_link public.portal_tokens%rowtype;
  v_project public.projects%rowtype;
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
       or (v_link.expires_at is not null and v_link.expires_at <= now()) then
      return null;
    end if;
    select * into v_project from public.projects
      where id = v_link.project_id and deleted_at is null;
  else
    -- Links created before portal_tokens existed remain usable. A revoked
    -- portal_tokens row never falls through to this legacy path.
    select * into v_project from public.projects
      where access_token = v_token and deleted_at is null;
  end if;
  if not found then return null; end if;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id',v_project.id, 'name',v_project.name, 'address',v_project.address,
      'description',v_project.description, 'status',v_project.status,
      'start_date',v_project.start_date, 'end_date',v_project.end_date,
      'budget_amount',v_project.budget_amount, 'notes',v_project.notes,
      'created_at',v_project.created_at, 'client_id',v_project.client_id),
    'client', (select jsonb_build_object(
      'id',c.id,'name',c.name,'email',c.email,'phone',c.phone,'company',c.company)
      from public.clients c where c.id=v_project.client_id and c.user_id=v_project.user_id),
    'budgets', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',b.id,'budget_number',b.budget_number,'title',b.title,
      'service_type',b.service_type,'status',b.status,'subtotal',b.subtotal,
      'iva_amount',b.iva_amount,'total',b.total,'created_at',b.created_at)
      order by b.created_at desc,b.id),'[]'::jsonb)
      from public.budgets b where b.user_id=v_project.user_id and b.deleted_at is null
      and (b.project_id=v_project.id or
        (v_project.client_id is not null and b.project_id is null and b.client_id=v_project.client_id))),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,'invoice_number',i.invoice_number,'invoice_date',i.invoice_date,
      'base_amount',i.base_amount,'iva_amount',i.iva_amount,
      'total_amount',i.total_amount,'category',i.category,
      'payment_status',i.payment_status)
      order by i.invoice_date desc,i.id),'[]'::jsonb)
      from public.invoices i where i.user_id=v_project.user_id and i.deleted_at is null
      and (i.project_id=v_project.id or
        (v_project.client_id is not null and i.project_id is null and i.client_id=v_project.client_id))),
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

-- A portal visitor may answer only a proposed change in the project named by
-- a currently valid link. No client-supplied status or arbitrary fields enter
-- this update. This replaces the historical FOR UPDATE USING (true) policy.
create function public.portal_respond_to_change(
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
    if not (v_link.permissions @> '["approve_changes"]'::jsonb) then
      return null;
    end if;
    select * into v_project from public.projects
      where id=v_link.project_id and deleted_at is null for share;
  else
    select * into v_project from public.projects
      where access_token=v_token and deleted_at is null for share;
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

revoke all on function public.portal_read_snapshot(text) from public,anon,authenticated,service_role;
grant execute on function public.portal_read_snapshot(text) to anon,authenticated;
revoke all on function public.portal_respond_to_change(text,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.portal_respond_to_change(text,uuid,boolean) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
