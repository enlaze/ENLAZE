-- Corrective migration for the Codex review of
-- 20260806_03_account_deletion_write_lock.sql. Fixes 3 P1 findings that
-- need SQL changes (a 4th SQL-adjacent P1 — the price broadcast lease — and
-- the P2/P3 findings are pure application-code fixes, see the accompanying
-- commit). All functions below are `create or replace`, safe to apply
-- whether or not the original migration already ran.

begin;

-- ── 1. Serialize authenticated writes with account deletion ─────────────
--
-- The trigger's authenticated-write branch only re-checked the tombstone
-- table without ever taking the per-user advisory lock that
-- lock_account_for_deletion() takes before inserting it. That left a race:
-- a write already past the tombstone check, but not yet committed, could
-- still land after lock_account_for_deletion() had returned (and cleanup
-- had begun), because nothing serialized "check tombstone" against "insert
-- tombstone" for the same user. Taking the same advisory lock here closes
-- that window: either the write's lock acquisition happens first (so it
-- sees no tombstone yet, and lock_account_for_deletion() then blocks until
-- this write's transaction commits or rolls back before deletion can
-- proceed), or lock_account_for_deletion() takes the lock first (so the
-- tombstone is already visible by the time this write gets to check it).
create or replace function public.reject_writes_during_account_deletion()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  if public.current_account_deletion_locked() then
    raise exception 'No se admiten cambios: la cuenta está en proceso de eliminación.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.reject_writes_during_account_deletion() from public, anon, authenticated;

-- ── 2. Restrict signature image saves to pending signatures ─────────────
--
-- The public route's `status === "pending"` precheck ran as a separate
-- SELECT before calling this RPC, so it wasn't atomic with the RPC's own
-- UPDATE: a completed signature's image could still be overwritten if OTP
-- verification (mark_signature_signed_locked, which flips status to
-- 'signed') raced between the precheck and this call. Conditioning the
-- UPDATE itself on status = 'pending' — the same pattern already used by
-- mark_signature_signed_locked — makes the check and the write atomic, and
-- lets the caller distinguish "already signed" from "not found"/"locked".
create or replace function public.save_signature_image_locked(
  p_signature_id uuid, p_signature_image text, p_ip_address text, p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
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
revoke all on function public.save_signature_image_locked(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.save_signature_image_locked(uuid,text,text,text) to service_role;

-- ── 3. Rotate the public signing token for an existing signature ────────
--
-- Needed so an owner can re-fetch/rotate a working `/firmar/{token}` link
-- for a pending signature after the token was only shown once at creation
-- time (SignaturePanel's "copiar enlace" was building the link from the
-- guessable row id instead, which the public route correctly refuses to
-- accept as authorization). Same advisory-lock + tombstone-check pattern as
-- every other *_locked RPC; only issues a new token for signatures still
-- 'pending', and re-verifies p_user_id against the row's real owner so an
-- authenticated caller can never rotate someone else's signature token.
create or replace function public.rotate_signature_public_token_locked(
  p_signature_id uuid, p_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_status text;
  v_token text;
  v_token_hash text;
  v_row public.digital_signatures;
begin
  select user_id, status into v_owner, v_status
    from public.digital_signatures where id = p_signature_id;

  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'signature_not_found');
  end if;
  if v_owner <> p_user_id then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  if exists (select 1 from public.account_deletion_locks where user_id = v_owner) then
    return jsonb_build_object('ok', false, 'reason', 'account_locked');
  end if;

  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_token_hash := md5(v_token);

  update public.digital_signatures
     set public_token_hash = v_token_hash,
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

-- ── 4. Reconcile invoice edits and supplier totals in one transaction ───
--
-- app/dashboard/suppliers/invoices/page.tsx previously ran the invoice
-- UPDATE and the reconcile_supplier_invoiced() follow-up as two separate
-- calls: the invoice correction committed first, and if the reconcile call
-- then failed, the code only logged it and moved on — suppliers.total_invoiced
-- was left stale with no retry path, since a later retry re-reads the
-- already-corrected invoice and computes a zero delta. Concurrent retries
-- on the same invoice could also each read a stale "old total" and double-
-- apply the same delta. This RPC does both in one statement/transaction:
-- it re-reads the invoice's pre-edit supplier/total itself (under a row
-- lock), so the delta is always computed from the true current DB state at
-- the moment of the write, not from a value the client read earlier.
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
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_old_supplier_id uuid;
  v_old_total numeric;
  v_row public.received_invoices;
begin
  select user_id, supplier_id, total
    into v_owner, v_old_supplier_id, v_old_total
    from public.received_invoices
   where id = p_invoice_id
   for update;

  if v_owner is null then
    raise exception 'Factura no encontrada' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'No autorizado sobre esta factura' using errcode = '42501';
  end if;

  if p_supplier_id is not null
     and not exists (
       select 1 from public.suppliers where id = p_supplier_id and user_id = auth.uid()
     )
  then
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

  if v_old_supplier_id is not distinct from p_supplier_id then
    if v_old_supplier_id is not null and v_old_total is distinct from p_total then
      update public.suppliers
         set total_invoiced = greatest(0, coalesce(total_invoiced, 0) + (p_total - coalesce(v_old_total, 0)))
       where id = p_supplier_id;
    end if;
  else
    if v_old_supplier_id is not null then
      update public.suppliers
         set total_invoiced = greatest(0, coalesce(total_invoiced, 0) - coalesce(v_old_total, 0))
       where id = v_old_supplier_id;
    end if;
    if p_supplier_id is not null then
      update public.suppliers
         set total_invoiced = coalesce(total_invoiced, 0) + p_total
       where id = p_supplier_id;
    end if;
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_received_invoice_and_reconcile(
  uuid, text, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric, text, text
) from public, anon;
grant execute on function public.update_received_invoice_and_reconcile(
  uuid, text, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric, text, text
) to authenticated;

commit;

notify pgrst, 'reload schema';
