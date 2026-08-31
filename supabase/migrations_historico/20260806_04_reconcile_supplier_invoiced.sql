-- Corrective migration for review-msgawnqb-0jxc3w / review-msgayf0c-eb70cc.
--
-- When a promotion-retry submit in app/dashboard/suppliers/invoices/page.tsx
-- changes an invoice's supplier or total after createReceivedInvoice already
-- incremented the original supplier's total_invoiced, two separate
-- read-then-write client calls (subtract old, add new) could race a
-- concurrent write on the same supplier row and leave the balance wrong.
-- This RPC does both adjustments in one statement/transaction.
--
-- SECURITY DEFINER is required to update suppliers.total_invoiced for two
-- different rows atomically, but ownership is re-checked explicitly inside
-- (via auth.uid()) since this bypasses RLS — an authenticated caller may
-- only reconcile suppliers they own.

begin;

create or replace function public.reconcile_supplier_invoiced(
  p_old_supplier_id uuid,
  p_old_amount numeric,
  p_new_supplier_id uuid,
  p_new_amount numeric
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_old_supplier_id is not null
     and not exists (
       select 1 from public.suppliers
        where id = p_old_supplier_id and user_id = auth.uid()
     )
  then
    raise exception 'No autorizado sobre el proveedor de origen' using errcode = '42501';
  end if;
  if p_new_supplier_id is not null
     and not exists (
       select 1 from public.suppliers
        where id = p_new_supplier_id and user_id = auth.uid()
     )
  then
    raise exception 'No autorizado sobre el proveedor de destino' using errcode = '42501';
  end if;

  if p_old_supplier_id is not null and p_old_supplier_id = p_new_supplier_id then
    update public.suppliers
       set total_invoiced = greatest(
         0,
         coalesce(total_invoiced, 0) + (coalesce(p_new_amount, 0) - coalesce(p_old_amount, 0))
       )
     where id = p_new_supplier_id;
    return;
  end if;

  if p_old_supplier_id is not null then
    update public.suppliers
       set total_invoiced = greatest(0, coalesce(total_invoiced, 0) - coalesce(p_old_amount, 0))
     where id = p_old_supplier_id;
  end if;

  if p_new_supplier_id is not null then
    update public.suppliers
       set total_invoiced = coalesce(total_invoiced, 0) + coalesce(p_new_amount, 0)
     where id = p_new_supplier_id;
  end if;
end;
$$;

revoke all on function public.reconcile_supplier_invoiced(uuid, numeric, uuid, numeric)
  from public, anon;
grant execute on function public.reconcile_supplier_invoiced(uuid, numeric, uuid, numeric)
  to authenticated;

commit;

notify pgrst, 'reload schema';
