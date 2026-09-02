-- Corrective migration for review-msgawnqb-0jxc3w / review-msgayf0c-eb70cc.
--
-- Blocks new writes (INSERT/UPDATE/DELETE) to a user's own data — public
-- tables and their Storage objects — for the duration of account deletion,
-- without touching Auth session validity: revoking sessions would make
-- retrying /api/account/delete itself impossible for a user whose deletion
-- partially failed, and banning doesn't invalidate an access token already
-- live in another tab anyway (JWTs are verified statelessly).
--
-- A lock row is inserted by the service role as the very first step of
-- deletion and is never deleted by this migration's own logic — it has no
-- FK to auth.users, so it survives the user being deleted and becomes a
-- permanent tombstone (that uuid can never authenticate again, so the lock
-- can never legitimately need to be lifted).
--
-- Multi-step service_role operations acting on behalf of a specific user
-- (OCR Storage uploads, background agent ingestion) use short-lived
-- "leases" instead of trusting the trigger's blanket service_role
-- exemption: begin_account_write_lease races lock_account_for_deletion for
-- the same advisory-lock key, so exactly one of "the write starts first"
-- or "the deletion starts first" wins, never both.
--
-- Single-shot service_role writes with no session available at all
-- (external signer OTP flow, Google OAuth callback) go through dedicated
-- SECURITY DEFINER RPCs that take the same advisory lock, check the
-- tombstone, and write in one atomic call instead of a lease.

begin;

-- ── Tombstone y leases ──────────────────────────────────────────────────

create table if not exists public.account_deletion_locks (
  user_id uuid primary key,
  locked_at timestamptz not null default now(),
  auth_deleted_at timestamptz
);
comment on table public.account_deletion_locks is
  'Tombstone permanente insertado por /api/account/delete antes de cualquier '
  'limpieza destructiva. Sin FK a auth.users a propósito: debe sobrevivir al '
  'borrado del usuario. Nunca se borra.';
alter table public.account_deletion_locks enable row level security;

create table if not exists public.account_write_leases (
  lease_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists account_write_leases_user_id_idx
  on public.account_write_leases (user_id);
create index if not exists account_write_leases_expires_at_idx
  on public.account_write_leases (expires_at);
alter table public.account_write_leases enable row level security;
-- Ninguna de las dos tablas tiene policies: solo las funciones
-- SECURITY DEFINER de abajo (propiedad de un rol privilegiado) las leen o
-- escriben; ni authenticated ni anon acceden nunca directamente.

-- ── Función segura para consultar el propio bloqueo ─────────────────────

create or replace function public.current_account_deletion_locked()
returns boolean
language sql security definer stable set search_path = public, pg_temp
as $$
  select exists (select 1 from public.account_deletion_locks where user_id = auth.uid());
$$;
revoke all on function public.current_account_deletion_locked() from public, anon, authenticated;
grant execute on function public.current_account_deletion_locked() to authenticated;

-- ── Trigger universal sobre tablas públicas mutables ─────────────────────

create or replace function public.reject_writes_during_account_deletion()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
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

do $$
declare
  t record;
  v_missing text[] := '{}';
begin
  for t in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'  -- solo tablas base, no vistas ni tablas particionadas hijas
       and c.relname not in ('account_deletion_locks', 'account_write_leases')
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_class'::regclass
            and d.objid = c.oid
            and d.deptype = 'e'  -- perteneciente a una extensión
       )
  loop
    execute format(
      'drop trigger if exists trg_block_writes_during_account_deletion on public.%I',
      t.table_name
    );
    execute format(
      'create trigger trg_block_writes_during_account_deletion '
        || 'before insert or update or delete on public.%I '
        || 'for each row execute function public.reject_writes_during_account_deletion()',
      t.table_name
    );
  end loop;

  -- Comprobación final: cualquier tabla mutable propia que se haya quedado
  -- sin el trigger (por ejemplo porque el bucle anterior falló a mitad)
  -- hace fallar la migración entera en vez de dejar una tabla sin proteger
  -- en silencio.
  select coalesce(array_agg(c.relname), '{}')
    into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname not in ('account_deletion_locks', 'account_write_leases')
     and not exists (
       select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
     )
     and not exists (
       select 1 from pg_trigger tg
        where tg.tgrelid = c.oid
          and tg.tgname = 'trg_block_writes_during_account_deletion'
     );

  if array_length(v_missing, 1) > 0 then
    raise exception
      'account_deletion_write_lock: % tabla(s) mutable(s) sin trigger: %',
      array_length(v_missing, 1), array_to_string(v_missing, ', ');
  end if;
end $$;

-- ── Storage: políticas RESTRICTIVE ──────────────────────────────────────
-- Buckets de usuario confirmados en el código (STORAGE_BUCKETS /
-- RETAINED_INVOICE_BUCKET en app/api/account/delete/route.ts, más
-- company-branding y project-docs referenciados en sus respectivas rutas):
-- invoices, company-branding, project-docs, received-invoice-documents.
do $$
declare
  v_missing text[];
begin
  select coalesce(array_agg(expected.id), '{}') into v_missing
    from (values
      ('invoices'), ('company-branding'), ('project-docs'), ('received-invoice-documents')
    ) as expected(id)
   where not exists (select 1 from storage.buckets sb where sb.id = expected.id);

  if array_length(v_missing, 1) > 0 then
    raise exception
      'account_deletion_write_lock: bucket(s) esperado(s) no encontrado(s): %. '
      'Revisa STORAGE_BUCKETS/RETAINED_INVOICE_BUCKET antes de aplicar.',
      array_to_string(v_missing, ', ');
  end if;
end $$;

drop policy if exists account_deletion_lock_blocks_storage_insert on storage.objects;
create policy account_deletion_lock_blocks_storage_insert
  on storage.objects as restrictive for insert to authenticated
  with check (
    bucket_id not in ('invoices','company-branding','project-docs','received-invoice-documents')
    or not public.current_account_deletion_locked()
  );

drop policy if exists account_deletion_lock_blocks_storage_update on storage.objects;
create policy account_deletion_lock_blocks_storage_update
  on storage.objects as restrictive for update to authenticated
  using (
    bucket_id not in ('invoices','company-branding','project-docs','received-invoice-documents')
    or not public.current_account_deletion_locked()
  )
  with check (
    bucket_id not in ('invoices','company-branding','project-docs','received-invoice-documents')
    or not public.current_account_deletion_locked()
  );

drop policy if exists account_deletion_lock_blocks_storage_delete on storage.objects;
create policy account_deletion_lock_blocks_storage_delete
  on storage.objects as restrictive for delete to authenticated
  using (
    bucket_id not in ('invoices','company-branding','project-docs','received-invoice-documents')
    or not public.current_account_deletion_locked()
  );

-- ── Leases: begin/end/lock ───────────────────────────────────────────────

create or replace function public.begin_account_write_lease(
  p_user_id uuid,
  p_ttl_seconds integer default 180
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_lease_id uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds <= 0 or p_ttl_seconds > 900 then
    raise exception 'TTL de lease inválido: % (debe estar entre 1 y 900 segundos)', p_ttl_seconds
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  delete from public.account_write_leases where expires_at < now();

  if exists (select 1 from public.account_deletion_locks where user_id = p_user_id) then
    raise exception 'No se admiten cambios: la cuenta está en proceso de eliminación.'
      using errcode = 'P0001';
  end if;

  insert into public.account_write_leases (user_id, expires_at)
  values (p_user_id, now() + make_interval(secs => p_ttl_seconds))
  returning lease_id into v_lease_id;

  return v_lease_id;
end;
$$;

create or replace function public.end_account_write_lease(p_lease_id uuid)
returns void
language sql security definer set search_path = public, pg_temp
as $$
  delete from public.account_write_leases where lease_id = p_lease_id;
$$;

create or replace function public.lock_account_for_deletion(p_user_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_active_leases integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  insert into public.account_deletion_locks (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  delete from public.account_write_leases
   where user_id = p_user_id and expires_at < now();

  select count(*) into v_active_leases
    from public.account_write_leases where user_id = p_user_id;

  return v_active_leases;
end;
$$;

revoke all on function public.begin_account_write_lease(uuid, integer) from public, anon, authenticated;
revoke all on function public.end_account_write_lease(uuid) from public, anon, authenticated;
revoke all on function public.lock_account_for_deletion(uuid) from public, anon, authenticated;
grant execute on function public.begin_account_write_lease(uuid, integer) to service_role;
grant execute on function public.end_account_write_lease(uuid) to service_role;
grant execute on function public.lock_account_for_deletion(uuid) to service_role;

-- ── n8n_updates: sin columna user_id, propietario en data->>'requested_by' ─

create or replace function public.create_n8n_update_locked(
  p_sector text, p_update_type text, p_status text,
  p_requested_by uuid, p_data jsonb
) returns public.n8n_updates
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row public.n8n_updates;
  v_data jsonb;
begin
  if p_requested_by is null then
    raise exception 'p_requested_by es obligatorio' using errcode = '22004';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_requested_by::text, 0));

  if exists (select 1 from public.account_deletion_locks where user_id = p_requested_by) then
    raise exception 'No se admiten cambios: la cuenta está en proceso de eliminación.'
      using errcode = 'P0001';
  end if;

  -- requested_by en el jsonb SIEMPRE se fuerza al parámetro autenticado; el
  -- body nunca puede suplantar a otro propietario.
  v_data := coalesce(p_data, '{}'::jsonb) || jsonb_build_object('requested_by', p_requested_by::text);

  insert into public.n8n_updates (sector, update_type, status, data)
  values (p_sector, p_update_type, p_status, v_data)
  returning * into v_row;

  return v_row;
end;
$$;

-- Solo actualiza filas que YA tienen un requested_by resuelto: esta RPC es
-- para el ciclo de vida normal de una solicitud creada por
-- create_n8n_update_locked, no para filas huérfanas/malformadas, que deben
-- tratarse aparte y nunca a través de esta vía "de usuario".
create or replace function public.write_n8n_update_locked(
  p_id uuid, p_expected_status text, p_status text,
  p_data jsonb, p_processed_at timestamptz default null
) returns public.n8n_updates
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_owner_after_lock uuid;
  v_data jsonb;
  v_row public.n8n_updates;
begin
  select nullif(data->>'requested_by', '')::uuid into v_owner
    from public.n8n_updates where id = p_id;

  if v_owner is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));

  -- Vuelve a leer la fila YA con el advisory lock tomado: si desapareció o
  -- su propietario cambió entre la lectura inicial y aquí, no se escribe.
  select nullif(data->>'requested_by', '')::uuid into v_owner_after_lock
    from public.n8n_updates where id = p_id for update;

  if v_owner_after_lock is null or v_owner_after_lock <> v_owner then
    return null;
  end if;

  if exists (select 1 from public.account_deletion_locks where user_id = v_owner) then
    return null; -- se omite esta fila, no se aborta el lote
  end if;

  -- requested_by nunca cambia en una actualización: se preserva el valor
  -- real aunque p_data no lo incluya o intente sobrescribirlo.
  v_data := coalesce(p_data, '{}'::jsonb) || jsonb_build_object('requested_by', v_owner::text);

  update public.n8n_updates
     set status = p_status,
         data = v_data,
         processed_at = coalesce(p_processed_at, processed_at)
   where id = p_id
     and (p_expected_status is null or status = p_expected_status)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_n8n_update_locked(text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.write_n8n_update_locked(uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.create_n8n_update_locked(text, text, text, uuid, jsonb) to service_role;
grant execute on function public.write_n8n_update_locked(uuid, text, text, jsonb, timestamptz) to service_role;

-- ── Firmas: token público en vez de UUID como autorización ─────────────
-- El signature_id es adivinable/enumerable; el token es aleatorio de alta
-- entropía (dos gen_random_uuid() concatenados = 256 bits), se entrega en
-- claro UNA vez al crear la firma y solo se almacena su hash. md5() (no
-- pgcrypto) para no depender de en qué esquema esté instalada esa
-- extensión en cada proyecto — la resistencia a preimagen de md5 es más
-- que suficiente frente a un token de esta entropía, no se está hasheando
-- una contraseña de baja entropía.
alter table public.digital_signatures
  add column if not exists public_token_hash text,
  add column if not exists public_token_created_at timestamptz;
create unique index if not exists digital_signatures_public_token_hash_idx
  on public.digital_signatures (public_token_hash) where public_token_hash is not null;

create or replace function public.create_digital_signature_locked(
  p_user_id uuid, p_entity_type text, p_entity_id uuid,
  p_signer_name text, p_signer_email text, p_signer_phone text,
  p_signer_nif text, p_signer_role text,
  p_ip_address text, p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row public.digital_signatures;
  v_token text;
  v_token_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if exists (select 1 from public.account_deletion_locks where user_id = p_user_id) then
    raise exception 'La cuenta está en proceso de eliminación.' using errcode = 'P0001';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_token_hash := md5(v_token);

  insert into public.digital_signatures (
    user_id, entity_type, entity_id, signer_name, signer_email, signer_phone,
    signer_nif, signer_role, signature_image, ip_address, user_agent, status,
    public_token_hash, public_token_created_at
  ) values (
    p_user_id, p_entity_type, p_entity_id, p_signer_name, p_signer_email, p_signer_phone,
    p_signer_nif, p_signer_role, '', p_ip_address, p_user_agent, 'pending',
    v_token_hash, now()
  ) returning * into v_row;

  return jsonb_build_object('ok', true, 'signature', to_jsonb(v_row), 'public_token', v_token);
end;
$$;

create or replace function public.create_signature_otp_locked(
  p_signature_id uuid, p_code text, p_email text, p_expires_at timestamptz
) returns public.signature_otps
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_row public.signature_otps;
begin
  select user_id into v_owner from public.digital_signatures where id = p_signature_id;
  if v_owner is null then
    raise exception 'Firma no encontrada' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  if exists (select 1 from public.account_deletion_locks where user_id = v_owner) then
    raise exception 'La cuenta está en proceso de eliminación.' using errcode = 'P0001';
  end if;

  insert into public.signature_otps (signature_id, code, email, expires_at)
  values (p_signature_id, p_code, p_email, p_expires_at)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.record_signature_otp_attempt_locked(
  p_otp_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_otp public.signature_otps;
begin
  select ds.user_id into v_owner
    from public.signature_otps so
    join public.digital_signatures ds on ds.id = so.signature_id
   where so.id = p_otp_id;

  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));

  if exists (select 1 from public.account_deletion_locks where user_id = v_owner) then
    return jsonb_build_object('ok', false, 'reason', 'account_locked');
  end if;

  select * into v_otp from public.signature_otps where id = p_otp_id for update;

  if v_otp.used then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  if v_otp.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_otp.attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  update public.signature_otps set attempts = attempts + 1
   where id = p_otp_id
  returning * into v_otp;

  return jsonb_build_object('ok', true, 'otp', to_jsonb(v_otp));
end;
$$;

-- Solo firma si un UPDATE condicionado sobre signature_otps confirma, en la
-- misma sentencia, que el otp pertenece a la firma indicada, no está usado,
-- sigue vigente y no ha superado el límite de intentos. Si ese UPDATE no
-- devuelve fila, digital_signatures no se toca.
create or replace function public.mark_signature_signed_locked(
  p_otp_id uuid, p_signature_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_now timestamptz := now();
  v_otp public.signature_otps;
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

  update public.signature_otps
     set used = true, used_at = v_now
   where id = p_otp_id
     and signature_id = p_signature_id
     and used = false
     and expires_at >= v_now
     and attempts <= 5
  returning * into v_otp;

  if v_otp.id is null then
    return jsonb_build_object('ok', false, 'reason', 'otp_invalid');
  end if;

  -- Revoke the public token in the same UPDATE that marks the signature
  -- signed: once completed, the token that authorized the public flow must
  -- stop resolving anything, so no further modification is possible even
  -- if the link leaks afterwards. The `status = 'pending'` predicate makes
  -- this idempotent against a duplicate/racing completion call.
  update public.digital_signatures
     set otp_verified = true, otp_verified_at = v_now,
         status = 'signed', signed_at = v_now, updated_at = v_now,
         public_token_hash = null
   where id = p_signature_id
     and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'already_signed');
  end if;

  return jsonb_build_object('ok', true, 'signed_at', v_now, 'signature', to_jsonb(v_row));
end;
$$;

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
  returning * into v_row;

  return jsonb_build_object('ok', true, 'signature', to_jsonb(v_row));
end;
$$;

revoke all on function public.create_digital_signature_locked(uuid,text,uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.create_signature_otp_locked(uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.record_signature_otp_attempt_locked(uuid) from public, anon, authenticated;
revoke all on function public.mark_signature_signed_locked(uuid,uuid) from public, anon, authenticated;
revoke all on function public.save_signature_image_locked(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.create_digital_signature_locked(uuid,text,uuid,text,text,text,text,text,text,text) to service_role;
grant execute on function public.create_signature_otp_locked(uuid,text,text,timestamptz) to service_role;
grant execute on function public.record_signature_otp_attempt_locked(uuid) to service_role;
grant execute on function public.mark_signature_signed_locked(uuid,uuid) to service_role;
grant execute on function public.save_signature_image_locked(uuid,text,text,text) to service_role;

-- ── Google OAuth callback: agent_connections ────────────────────────────
-- Requiere 20260806_01_align_agent_connections.sql aplicada antes (añade
-- connected/credentials_ref/error_message). unique(user_id, module) ya
-- existe desde 20260422_agent_connections.sql.
create or replace function public.upsert_agent_connection_locked(
  p_user_id uuid, p_module text, p_connected boolean, p_status text,
  p_credentials_ref text, p_error_message text
) returns public.agent_connections
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row public.agent_connections;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if exists (select 1 from public.account_deletion_locks where user_id = p_user_id) then
    raise exception 'La cuenta está en proceso de eliminación.' using errcode = 'P0001';
  end if;

  insert into public.agent_connections (
    user_id, module, connected, status, credentials_ref, error_message, updated_at
  ) values (
    p_user_id, p_module, p_connected, p_status, p_credentials_ref, p_error_message, now()
  )
  on conflict (user_id, module) do update set
    connected = excluded.connected,
    status = excluded.status,
    credentials_ref = excluded.credentials_ref,
    error_message = excluded.error_message,
    updated_at = excluded.updated_at
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_agent_connection_locked(uuid,text,boolean,text,text,text) from public, anon, authenticated;
grant execute on function public.upsert_agent_connection_locked(uuid,text,boolean,text,text,text) to service_role;

commit;

notify pgrst, 'reload schema';
