-- Reescritura de 20260808_01_fix_p1_deletion_signature_invoice_races.sql, que
-- nunca se aplicó (el commit 7135c48 la borró al reconciliar el historial).
-- Comprobado el 2026-09-24 contra la base real: la base tenía las versiones
-- ANTERIORES a esos arreglos y dos funciones no existían, con fallos visibles
-- para el cliente.
--
-- Orden por prioridad:
--   1. save_signature_image_locked: se podía SOBRESCRIBIR la imagen de una
--      firma ya firmada (el UPDATE no exigía status = 'pending').
--   2. update_received_invoice_and_reconcile: no existía → editar una factura
--      recibida fallaba (components/facturacion/useReceivedInvoices.ts).
--   3. rotate_signature_public_token_locked: no existía → rotar el enlace de
--      firma fallaba (app/api/signatures/rotate-token).
--   4. reject_writes_during_account_deletion: carrera entre una escritura en
--      curso y el borrado de cuenta (no tomaba el bloqueo por usuario).
--
-- Diferencias con la versión de agosto, por premisas que ya no se cumplen:
--   · La nº 2 ya NO toca suppliers.total_invoiced: esa columna no existe y el
--     código calcula el total del proveedor al leer, desde received_invoices
--     (lib/suppliers.ts, getSupplierInvoiceTotals). Queda como edición
--     atómica con bloqueo de fila y control de dueño de factura y proveedor.
--     El nombre se mantiene porque el código ya la llama así. Esto deja sin
--     objeto 20260806_04 (reconcile_supplier_invoiced).
--   · search_path vacío y nombres cualificados, como el resto de funciones
--     SECURITY DEFINER recientes.
--
-- Clave de bloqueo: hashtextextended(<dueño>::text, 0), la misma que usan
-- lock_account_for_deletion y mark_signature_signed_locked (comprobado).

begin;

-- ── 1. No sobrescribir una firma ya firmada ──────────────────────────────
-- El UPDATE se condiciona a status = 'pending': comprobación y escritura son
-- atómicas, así que una verificación OTP que marque la firma como firmada
-- entre la comprobación previa de la ruta y esta llamada ya no se pisa.
create or replace function public.save_signature_image_locked(
  p_signature_id uuid, p_signature_image text, p_ip_address text, p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_row public.digital_signatures;
begin
  select user_id into v_owner from public.digital_signatures where id = p_signature_id;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'signature_not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  if exists (select 1 from public.account_deletion_locks where user_id = v_owner) then
    return jsonb_build_object('ok', false, 'reason', 'account_locked');
  end if;

  update public.digital_signatures
     set signature_image = p_signature_image,
         ip_address = coalesce(p_ip_address, ''),
         user_agent = coalesce(p_user_agent, ''),
         updated_at = now()
   where id = p_signature_id
     and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;
  return jsonb_build_object('ok', true, 'signature', to_jsonb(v_row));
end;
$$;
revoke all on function public.save_signature_image_locked(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.save_signature_image_locked(uuid, text, text, text) to service_role;

-- ── 2. Editar una factura recibida en una sola transacción ───────────────
create or replace function public.update_received_invoice_and_reconcile(
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
) returns public.received_invoices
language plpgsql security definer set search_path = ''
as $$
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
   for update;
  if v_owner is null or v_owner <> v_caller then
    -- Misma respuesta para "no existe" y "no es tuya": no se revela nada.
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
$$;
revoke all on function public.update_received_invoice_and_reconcile(
  uuid, text, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric, text, text
) from public, anon;
grant execute on function public.update_received_invoice_and_reconcile(
  uuid, text, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric, text, text
) to authenticated;

-- ── 3. Rotar el enlace público de firma ──────────────────────────────────
-- Solo firmas pendientes y solo el dueño real (p_user_id se contrasta con la
-- fila). El token se devuelve una única vez; se guarda su md5, que es lo que
-- compara la app (lib/signature-token.ts).
create or replace function public.rotate_signature_public_token_locked(
  p_signature_id uuid, p_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
  v_token text;
  v_row public.digital_signatures;
begin
  select user_id, status into v_owner, v_status
    from public.digital_signatures where id = p_signature_id;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'signature_not_found');
  end if;
  if p_user_id is null or v_owner <> p_user_id then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  if exists (select 1 from public.account_deletion_locks where user_id = v_owner) then
    return jsonb_build_object('ok', false, 'reason', 'account_locked');
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.digital_signatures
     set public_token_hash = md5(v_token),
         public_token_created_at = now(),
         updated_at = now()
   where id = p_signature_id
     and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;
  return jsonb_build_object('ok', true, 'signature', to_jsonb(v_row), 'public_token', v_token);
end;
$$;
revoke all on function public.rotate_signature_public_token_locked(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rotate_signature_public_token_locked(uuid, uuid) to service_role;

-- ── 4. Serializar escrituras con el borrado de cuenta ────────────────────
-- La rama de usuarios autenticados solo miraba la lápida, sin el bloqueo por
-- usuario que toma lock_account_for_deletion(). Con el mismo bloqueo: o la
-- escritura va primero (y el borrado espera a que confirme o revierta), o el
-- borrado va primero (y la escritura ya ve la lápida).
create or replace function public.reject_writes_during_account_deletion()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if auth.uid() is not null then
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  end if;

  if public.current_account_deletion_locked() then
    raise exception 'No se admiten cambios: la cuenta está en proceso de eliminación.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.reject_writes_during_account_deletion() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
