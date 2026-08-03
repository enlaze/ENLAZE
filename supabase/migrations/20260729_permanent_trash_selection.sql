-- Borrado definitivo por selección dentro de la papelera.
-- Solo permite presupuestos y obras. Las facturas quedan excluidas porque
-- existe obligación fiscal y mercantil de conservación.

begin;

drop function if exists public.permanently_delete_trash_items(jsonb, text);
create function public.permanently_delete_trash_items(
  p_items jsonb,
  p_confirmation text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  item_type text;
  item_id uuid;
  affected integer := 0;
  deleted_count integer := 0;
  child_table text;
  reference_table text;
  related_table text;
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado' using errcode = '42501';
  end if;

  if p_confirmation is distinct from 'ELIMINAR' then
    raise exception 'Confirmación incorrecta' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La selección está vacía' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 100 then
    raise exception 'Solo se pueden eliminar 100 elementos cada vez'
      using errcode = '22023';
  end if;

  for item in select distinct value from jsonb_array_elements(p_items)
  loop
    item_type := item ->> 'entity_type';
    begin
      item_id := (item ->> 'entity_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Identificador no válido' using errcode = '22023';
    end;

    if item_type not in ('budget', 'project') then
      raise exception 'Las facturas están protegidas por conservación fiscal'
        using errcode = '22023';
    end if;

    if item_type = 'budget' then
      if not exists (
        select 1
          from public.budgets b
         where b.id = item_id
           and b.user_id = auth.uid()
           and b.deleted_at is not null
      ) then
        continue;
      end if;

      -- Firmas, versiones y líneas que no siempre tienen FK con cascade.
      if to_regclass('public.digital_signatures') is not null then
        execute
          'delete from public.digital_signatures
            where user_id = $2 and entity_type = ''budget'' and entity_id = $1'
          using item_id, auth.uid();
      end if;

      foreach child_table in array array[
        'budget_items',
        'budget_snapshots',
        'budget_lines'
      ]
      loop
        if to_regclass(format('public.%I', child_table)) is not null
           and exists (
             select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = child_table
                and column_name = 'budget_id'
           ) then
          execute format(
            'delete from public.%I where budget_id = $1',
            child_table
          ) using item_id;
        end if;
      end loop;

      -- Una factura emitida se conserva, pero deja de apuntar al presupuesto.
      if to_regclass('public.issued_invoices') is not null then
        update public.issued_invoices
           set budget_id = null
         where budget_id = item_id
           and user_id = auth.uid();
      end if;

      delete from public.budgets
       where id = item_id
         and user_id = auth.uid()
         and deleted_at is not null;
      get diagnostics affected = row_count;
      deleted_count := deleted_count + affected;
    else
      if not exists (
        select 1
          from public.projects p
         where p.id = item_id
           and p.user_id = auth.uid()
           and p.deleted_at is not null
      ) then
        continue;
      end if;

      -- Elimina las firmas de documentos que pertenecen a la obra.
      if to_regclass('public.digital_signatures') is not null then
        execute
          'delete from public.digital_signatures
            where user_id = $2 and entity_type = ''project'' and entity_id = $1'
          using item_id, auth.uid();

        foreach related_table in array array[
          'project_acts',
          'project_certifications',
          'work_reports'
        ]
        loop
          if to_regclass(format('public.%I', related_table)) is not null then
            execute format(
              'delete from public.digital_signatures
                where user_id = $2
                  and entity_id in (
                    select id from public.%I where project_id = $1
                  )',
              related_table
            ) using item_id, auth.uid();
          end if;
        end loop;
      end if;

      -- Conserva documentos independientes y facturas, quitando su enlace.
      foreach reference_table in array array[
        'issued_invoices',
        'received_invoices',
        'budgets',
        'invoices',
        'orders',
        'delivery_notes',
        'payments'
      ]
      loop
        if to_regclass(format('public.%I', reference_table)) is not null
           and exists (
             select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = reference_table
                and column_name = 'project_id'
           )
           and exists (
             select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = reference_table
                and column_name = 'user_id'
           ) then
          execute format(
            'update public.%I
                set project_id = null
              where project_id = $1 and user_id = $2',
            reference_table
          ) using item_id, auth.uid();
        end if;
      end loop;

      -- Estas tablas son propiedad exclusiva de la obra. Las relaciones más
      -- nuevas usan ON DELETE CASCADE; el borrado explícito cubre esquemas viejos.
      foreach child_table in array array[
        'project_certifications',
        'project_items',
        'project_chapters',
        'project_documents',
        'project_acts',
        'project_changes',
        'project_suppliers',
        'project_milestones',
        'portal_tokens',
        'work_reports',
        'project_tasks',
        'project_phases'
      ]
      loop
        if to_regclass(format('public.%I', child_table)) is not null
           and exists (
             select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = child_table
                and column_name = 'project_id'
           ) then
          execute format(
            'delete from public.%I where project_id = $1',
            child_table
          ) using item_id;
        end if;
      end loop;

      delete from public.projects
       where id = item_id
         and user_id = auth.uid()
         and deleted_at is not null;
      get diagnostics affected = row_count;
      deleted_count := deleted_count + affected;
    end if;
  end loop;

  return deleted_count;
end;
$$;

revoke all on function public.permanently_delete_trash_items(jsonb, text)
  from public, anon;
grant execute on function public.permanently_delete_trash_items(jsonb, text)
  to authenticated;

commit;

comment on function public.permanently_delete_trash_items(jsonb, text)
  is 'Elimina definitivamente presupuestos u obras propios ya movidos a la papelera.';
