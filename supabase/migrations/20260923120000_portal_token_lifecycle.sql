-- E4 lote 1: ciclo de vida de portal_tokens. Aditiva y posterior a 20260915160000.
--
-- 20260915140000 dejó la tabla sin DML directo para anon ni authenticated y con
-- un trigger que exige que created_by sea el dueño del proyecto. Faltaba la vía
-- legítima para crear esas filas: estas tres RPC son ahora el único camino.
-- El llamante nunca elige token, created_by, is_active, access_count,
-- last_accessed_at ni revoked_at; el servidor los fija.
--
-- No toca projects.access_token: los enlaces heredados siguen intactos y este
-- lote no los migra, ni los revoca, ni les concede permiso alguno.
set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Vocabulario canónico, el mismo que consume 20260915150000
-- ─────────────────────────────────────────────────────────────────────────────
-- Un CHECK no admite subconsultas, así que la validación vive en una función
-- inmutable y pura. No lee ninguna tabla: se deja ejecutable para que cualquier
-- escritor legítimo (incluido service_role) pueda insertar.
create function public.portal_token_permissions_valid(p_permissions jsonb)
returns boolean language sql immutable set search_path = ''
as $fn$
  select p_permissions is not null
    and jsonb_typeof(p_permissions) = 'array'
    and p_permissions @> '["read"]'::jsonb
    and not exists (
      select 1 from jsonb_array_elements(p_permissions) e where jsonb_typeof(e) <> 'string')
    and not exists (
      select 1 from jsonb_array_elements_text(p_permissions) e
      where e not in ('read', 'approve_changes', 'approve_budgets'))
    and (select count(*) from jsonb_array_elements_text(p_permissions))
      = (select count(distinct e) from jsonb_array_elements_text(p_permissions) e);
$fn$;

-- Comprobado antes de aplicar: 0 filas modernas en producción, así que ninguna
-- queda fuera. Si alguna lo estuviera, esta sentencia falla y hay que revisarla
-- a mano en vez de corregirla en silencio.
alter table public.portal_tokens
  add constraint portal_tokens_permissions_check
  check (public.portal_token_permissions_valid(permissions));

-- ─────────────────────────────────────────────────────────────────────────────
-- Auxiliares privados
-- ─────────────────────────────────────────────────────────────────────────────
create schema portal_token_internal authorization postgres;
revoke all on schema portal_token_internal from public, anon, authenticated, service_role;

-- Un proyecto ajeno y uno inexistente devuelven lo mismo: nada que permita
-- deducir que existe.
create function portal_token_internal.owned_project(p_project_id uuid, p_owner uuid)
returns void language plpgsql security invoker set search_path = ''
as $fn$
begin
  if p_owner is null or p_project_id is null then
    raise exception 'Portal link is not available' using errcode = '42501';
  end if;
  perform 1 from public.projects
    where id = p_project_id and user_id = p_owner and deleted_at is null for share;
  if not found then
    raise exception 'Portal link is not available' using errcode = '42501';
  end if;
end $fn$;

create function portal_token_internal.validate_permissions(p_permissions jsonb)
returns void language plpgsql security invoker set search_path = ''
as $fn$
begin
  if p_permissions is null or jsonb_typeof(p_permissions) is distinct from 'array' then
    raise exception 'permissions must be a JSON array' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_permissions) e where jsonb_typeof(e) <> 'string') then
    raise exception 'permissions must contain only strings' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_permissions) e
      where e not in ('read', 'approve_changes', 'approve_budgets')) then
    raise exception 'Unknown portal permission' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements_text(p_permissions))
    <> (select count(distinct e) from jsonb_array_elements_text(p_permissions) e) then
    raise exception 'permissions must not repeat a value' using errcode = '22023';
  end if;
  if not (p_permissions @> '["read"]'::jsonb) then
    raise exception 'permissions must always include read' using errcode = '22023';
  end if;
end $fn$;

create function portal_token_internal.validate_expiry(p_expires_at timestamptz)
returns void language plpgsql security invoker set search_path = ''
as $fn$
begin
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expires_at must be in the future' using errcode = '22023';
  end if;
end $fn$;

-- El secreto solo se devuelve al emitirlo o rotarlo, que es cuando la interfaz
-- tiene que copiarlo. Nunca al revocar ni al consultar el estado.
create function portal_token_internal.issued(t public.portal_tokens)
returns jsonb language sql immutable set search_path = ''
as $fn$
  select jsonb_build_object(
    'id', t.id, 'project_id', t.project_id, 'token', t.token,
    'permissions', t.permissions, 'label', t.label,
    'expires_at', t.expires_at, 'created_at', t.created_at,
    'is_active', t.is_active, 'revoked_at', t.revoked_at);
$fn$;

create function portal_token_internal.status(t public.portal_tokens)
returns jsonb language sql immutable set search_path = ''
as $fn$
  select jsonb_build_object(
    'id', t.id, 'project_id', t.project_id,
    'permissions', t.permissions, 'label', t.label,
    'expires_at', t.expires_at, 'created_at', t.created_at,
    'is_active', t.is_active, 'revoked_at', t.revoked_at);
$fn$;

-- Bloquea la fila y la devuelve solo si el proyecto es del llamante. El FOR
-- UPDATE es lo que serializa dos rotaciones simultáneas del mismo enlace.
create function portal_token_internal.lock_own_token(p_token_id uuid, p_owner uuid)
returns public.portal_tokens language plpgsql security invoker set search_path = ''
as $fn$
declare t public.portal_tokens%rowtype;
begin
  if p_owner is null or p_token_id is null then
    raise exception 'Portal link is not available' using errcode = '42501';
  end if;
  select pt.* into t from public.portal_tokens pt
    join public.projects p on p.id = pt.project_id
    where pt.id = p_token_id and p.user_id = p_owner and p.deleted_at is null
    for update of pt;
  if not found then
    raise exception 'Portal link is not available' using errcode = '42501';
  end if;
  return t;
end $fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC públicas
-- ─────────────────────────────────────────────────────────────────────────────
create function public.portal_issue_token(
  p_project_id uuid,
  p_permissions jsonb default '["read"]'::jsonb,
  p_expires_at timestamptz default null,
  p_label text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare v_owner uuid := auth.uid(); v_row public.portal_tokens%rowtype;
begin
  perform portal_token_internal.owned_project(p_project_id, v_owner);
  perform portal_token_internal.validate_permissions(p_permissions);
  perform portal_token_internal.validate_expiry(p_expires_at);
  -- gen_random_uuid() usa el CSPRNG del servidor; el valor nunca llega del cliente.
  insert into public.portal_tokens
    (project_id, token, permissions, is_active, expires_at, created_by, label)
    values (p_project_id, gen_random_uuid(), p_permissions, true, p_expires_at,
      v_owner, nullif(btrim(p_label), ''))
    returning * into v_row;
  return portal_token_internal.issued(v_row);
end $fn$;

-- Sustituto y revocación del anterior ocurren en la misma transacción: o hay un
-- enlace nuevo y el viejo queda revocado, o no cambia nada.
create function public.portal_rotate_token(
  p_token_id uuid,
  p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
  v_owner uuid := auth.uid();
  v_old public.portal_tokens%rowtype;
  v_revoked public.portal_tokens%rowtype;
  v_new public.portal_tokens%rowtype;
  v_expires timestamptz;
begin
  v_old := portal_token_internal.lock_own_token(p_token_id, v_owner);
  -- Ya con el bloqueo: si otra rotación llegó primero, esta no emite un segundo
  -- sustituto sobre un enlace que ya no está vigente.
  if v_old.revoked_at is not null or coalesce(v_old.is_active, false) is not true then
    raise exception 'Portal link is no longer active' using errcode = 'PT409';
  end if;
  v_expires := coalesce(p_expires_at, v_old.expires_at);
  -- Heredar una caducidad ya vencida crearía un enlace muerto.
  perform portal_token_internal.validate_expiry(v_expires);
  insert into public.portal_tokens
    (project_id, token, permissions, is_active, expires_at, created_by, label)
    values (v_old.project_id, gen_random_uuid(), v_old.permissions, true, v_expires,
      v_owner, v_old.label)
    returning * into v_new;
  update public.portal_tokens
    set is_active = false, revoked_at = now()
    where id = v_old.id returning * into v_revoked;
  return jsonb_build_object(
    'issued', portal_token_internal.issued(v_new),
    'revoked', portal_token_internal.status(v_revoked));
end $fn$;

-- Idempotente: revocar un enlace ya revocado no es un error, devuelve su estado
-- sin tocar revoked_at. Así un doble clic o un reintento no cambian la fecha.
create function public.portal_revoke_token(p_token_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare v_owner uuid := auth.uid(); v_row public.portal_tokens%rowtype;
begin
  v_row := portal_token_internal.lock_own_token(p_token_id, v_owner);
  if v_row.revoked_at is null and coalesce(v_row.is_active, false) is true then
    update public.portal_tokens
      set is_active = false, revoked_at = now()
      where id = v_row.id returning * into v_row;
  end if;
  return portal_token_internal.status(v_row);
end $fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ACL
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on all functions in schema portal_token_internal from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema portal_token_internal revoke execute on functions from public;
revoke all on function
  public.portal_issue_token(uuid, jsonb, timestamptz, text),
  public.portal_rotate_token(uuid, timestamptz),
  public.portal_revoke_token(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.portal_issue_token(uuid, jsonb, timestamptz, text),
  public.portal_rotate_token(uuid, timestamptz),
  public.portal_revoke_token(uuid)
  to authenticated;

notify pgrst, 'reload schema';
