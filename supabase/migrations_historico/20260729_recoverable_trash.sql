-- Papelera recuperable para los documentos y obras principales de ENLAZE.
-- En lugar de borrar filas, las marca con deleted_at. Las relaciones (partidas,
-- líneas, hitos, etc.) permanecen intactas y reaparecen al restaurar el padre.

begin;

alter table public.budgets
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.projects
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.invoices
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.issued_invoices
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.received_invoices
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists budgets_user_deleted_at_idx
  on public.budgets (user_id, deleted_at);
create index if not exists projects_user_deleted_at_idx
  on public.projects (user_id, deleted_at);
create index if not exists invoices_user_deleted_at_idx
  on public.invoices (user_id, deleted_at);
create index if not exists issued_invoices_user_deleted_at_idx
  on public.issued_invoices (user_id, deleted_at);
create index if not exists received_invoices_user_deleted_at_idx
  on public.received_invoices (user_id, deleted_at);

-- Política restrictiva: las consultas normales de la aplicación solo ven
-- elementos activos. Las funciones SECURITY DEFINER de abajo son el único
-- acceso a filas de la papelera.
drop policy if exists budgets_hide_trashed on public.budgets;
create policy budgets_hide_trashed on public.budgets
  as restrictive for all to authenticated
  using (deleted_at is null)
  with check (deleted_at is null);

drop policy if exists projects_hide_trashed on public.projects;
create policy projects_hide_trashed on public.projects
  as restrictive for all to authenticated
  using (deleted_at is null)
  with check (deleted_at is null);

drop policy if exists invoices_hide_trashed on public.invoices;
create policy invoices_hide_trashed on public.invoices
  as restrictive for all to authenticated
  using (deleted_at is null)
  with check (deleted_at is null);

drop policy if exists issued_invoices_hide_trashed on public.issued_invoices;
create policy issued_invoices_hide_trashed on public.issued_invoices
  as restrictive for all to authenticated
  using (deleted_at is null)
  with check (deleted_at is null);

drop policy if exists received_invoices_hide_trashed on public.received_invoices;
create policy received_invoices_hide_trashed on public.received_invoices
  as restrictive for all to authenticated
  using (deleted_at is null)
  with check (deleted_at is null);

create or replace function public.move_to_trash(
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado' using errcode = '42501';
  end if;

  case p_entity_type
    when 'budget' then
      update public.budgets
         set deleted_at = now(), deleted_by = auth.uid()
       where id = p_entity_id
         and user_id = auth.uid()
         and deleted_at is null;
    when 'project' then
      update public.projects
         set deleted_at = now(), deleted_by = auth.uid()
       where id = p_entity_id
         and user_id = auth.uid()
         and deleted_at is null;
    when 'invoice' then
      update public.invoices
         set deleted_at = now(), deleted_by = auth.uid()
       where id = p_entity_id
         and user_id = auth.uid()
         and deleted_at is null;
    when 'issued_invoice' then
      update public.issued_invoices
         set deleted_at = now(), deleted_by = auth.uid()
       where id = p_entity_id
         and user_id = auth.uid()
         and deleted_at is null;
    when 'received_invoice' then
      update public.received_invoices
         set deleted_at = now(), deleted_by = auth.uid()
       where id = p_entity_id
         and user_id = auth.uid()
         and deleted_at is null;
    else
      raise exception 'Tipo de elemento no permitido: %', p_entity_type
        using errcode = '22023';
  end case;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.restore_trash_item(
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado' using errcode = '42501';
  end if;

  case p_entity_type
    when 'budget' then
      update public.budgets
         set deleted_at = null, deleted_by = null
       where id = p_entity_id
         and user_id = auth.uid()
         and deleted_at is not null;
    when 'project' then
      update public.projects
         set deleted_at = null, deleted_by = null
       where id = p_entity_id
         and user_id = auth.uid()
         and deleted_at is not null;
    when 'invoice' then
      update public.invoices
         set deleted_at = null, deleted_by = null
       where id = p_entity_id
         and user_id = auth.uid()
         and deleted_at is not null;
    when 'issued_invoice' then
      update public.issued_invoices
         set deleted_at = null, deleted_by = null
       where id = p_entity_id
         and user_id = auth.uid()
         and deleted_at is not null;
    when 'received_invoice' then
      update public.received_invoices
         set deleted_at = null, deleted_by = null
       where id = p_entity_id
         and user_id = auth.uid()
         and deleted_at is not null;
    else
      raise exception 'Tipo de elemento no permitido: %', p_entity_type
        using errcode = '22023';
  end case;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

drop function if exists public.list_trash_items();
create function public.list_trash_items()
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  amount numeric,
  deleted_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select trash.entity_type,
         trash.entity_id,
         trash.title,
         trash.subtitle,
         trash.amount,
         trash.deleted_at
    from (
      select 'budget'::text as entity_type,
             b.id as entity_id,
             coalesce(nullif(b.title, ''), 'Presupuesto')::text as title,
             nullif(b.budget_number, '')::text as subtitle,
             b.total::numeric as amount,
             b.deleted_at
        from public.budgets b
       where b.user_id = auth.uid() and b.deleted_at is not null
      union all
      select 'project'::text,
             p.id,
             coalesce(nullif(p.name, ''), 'Obra')::text,
             nullif(p.address, '')::text,
             p.budget_amount::numeric,
             p.deleted_at
        from public.projects p
       where p.user_id = auth.uid() and p.deleted_at is not null
      union all
      select 'invoice'::text,
             i.id,
             coalesce(nullif(i.supplier_name, ''), 'Factura')::text,
             nullif(i.invoice_number, '')::text,
             i.total_amount::numeric,
             i.deleted_at
        from public.invoices i
       where i.user_id = auth.uid() and i.deleted_at is not null
      union all
      select 'issued_invoice'::text,
             ii.id,
             coalesce(nullif(ii.client_name, ''), 'Factura emitida')::text,
             nullif(ii.invoice_number, '')::text,
             ii.total::numeric,
             ii.deleted_at
        from public.issued_invoices ii
       where ii.user_id = auth.uid() and ii.deleted_at is not null
      union all
      select 'received_invoice'::text,
             ri.id,
             coalesce(nullif(ri.supplier_name, ''), 'Factura recibida')::text,
             nullif(ri.invoice_number, '')::text,
             ri.total::numeric,
             ri.deleted_at
        from public.received_invoices ri
       where ri.user_id = auth.uid() and ri.deleted_at is not null
    ) as trash
   order by trash.deleted_at desc;
$$;

revoke all on function public.move_to_trash(text, uuid) from public, anon;
revoke all on function public.restore_trash_item(text, uuid) from public, anon;
revoke all on function public.list_trash_items() from public, anon;

grant execute on function public.move_to_trash(text, uuid) to authenticated;
grant execute on function public.restore_trash_item(text, uuid) to authenticated;
grant execute on function public.list_trash_items() to authenticated;

commit;

comment on function public.move_to_trash(text, uuid)
  is 'Mueve un elemento propio a la papelera sin borrar sus relaciones.';
comment on function public.restore_trash_item(text, uuid)
  is 'Restaura un elemento propio y todas sus relaciones conservadas.';
comment on function public.list_trash_items()
  is 'Lista unificada y segura de la papelera del usuario autenticado.';
