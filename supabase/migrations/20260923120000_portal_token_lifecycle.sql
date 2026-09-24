-- E4 lote 1: ciclo de vida de portal_tokens. Aditiva y posterior a 20260915160000.
--
-- 20260915140000 dejó la tabla sin DML directo para anon ni authenticated y con
-- un trigger que exige que created_by sea el dueño del proyecto. Faltaba la vía
-- legítima para crear esas filas: estas tres RPC son ahora el único camino.
-- El llamante nunca elige token, created_by, is_active, access_count,
-- last_accessed_at ni revoked_at; el servidor los fija.
--
-- Reglas de producto que este lote hace cumplir:
--   · todo enlace moderno caduca: 90 días por defecto, 365 como máximo;
--   · como mucho 5 enlaces vigentes por proyecto.
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
-- Caducidad obligatoria
-- ─────────────────────────────────────────────────────────────────────────────
-- Un único origen para los dos plazos: los consumen el DEFAULT de la columna,
-- el CHECK de la tabla y las RPC. Si divergieran, la emisión produciría filas
-- que el propio CHECK rechaza.
create function public.portal_token_default_lifetime()
returns interval language sql immutable set search_path = ''
as $fn$ select interval '90 days' $fn$;

create function public.portal_token_max_lifetime()
returns interval language sql immutable set search_path = ''
as $fn$ select interval '365 days' $fn$;

-- No se inventan fechas para filas existentes. Si hubiera alguna sin fecha o
-- fuera de la ventana, esto para el despliegue con un mensaje legible en vez de
-- dejar que reviente un NOT NULL a secas o de rellenarla en silencio.
do $guard$
declare v_bad integer;
begin
  select count(*) into v_bad from public.portal_tokens
    where created_at is null or expires_at is null;
  if v_bad > 0 then
    raise exception
      'There are % modern portal links without created_at or expires_at: review them by hand, this migration does not invent dates', v_bad;
  end if;
  select count(*) into v_bad from public.portal_tokens
    where expires_at <= created_at
       or expires_at > created_at + public.portal_token_max_lifetime();
  if v_bad > 0 then
    raise exception
      'There are % modern portal links outside the allowed expiry window: review them by hand', v_bad;
  end if;
end $guard$;

-- El CHECK se apoya en created_at, no en now(): así es inmutable y una fila
-- válida al insertarse no se vuelve inválida con el paso del tiempo. Que la
-- fecha esté además en el futuro lo comprueban las RPC, que sí conocen now().
alter table public.portal_tokens
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column expires_at set default now() + public.portal_token_default_lifetime(),
  alter column expires_at set not null,
  add constraint portal_tokens_expiry_window_check
    check (expires_at > created_at
       and expires_at <= created_at + public.portal_token_max_lifetime());

-- ─────────────────────────────────────────────────────────────────────────────
-- Auxiliares privados
-- ─────────────────────────────────────────────────────────────────────────────
create schema portal_token_internal authorization postgres;
revoke all on schema portal_token_internal from public, anon, authenticated, service_role;

-- Un proyecto ajeno y uno inexistente devuelven lo mismo: nada que permita
-- deducir que existe.
--
-- El bloqueo es FOR UPDATE, no FOR SHARE: es lo que serializa las emisiones
-- concurrentes sobre un mismo proyecto. Dos sesiones no pueden contar enlaces
-- vigentes a la vez y colarse ambas por debajo del tope.
create function portal_token_internal.owned_project(p_project_id uuid, p_owner uuid)
returns void language plpgsql security invoker set search_path = ''
as $fn$
begin
  if p_owner is null or p_project_id is null then
    raise exception 'Portal link is not available' using errcode = '42501';
  end if;
  perform 1 from public.projects
    where id = p_project_id and user_id = p_owner and deleted_at is null for update;
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

-- Omitir la fecha no significa "sin caducidad", significa el plazo por defecto.
-- La columna es NOT NULL, así que aquí siempre sale una fecha concreta.
create function portal_token_internal.resolve_expiry(p_expires_at timestamptz)
returns timestamptz language plpgsql security invoker set search_path = ''
as $fn$
declare v_now timestamptz := now();
begin
  if p_expires_at is null then
    return v_now + public.portal_token_default_lifetime();
  end if;
  if p_expires_at <= v_now then
    raise exception 'expires_at must be in the future' using errcode = '22023';
  end if;
  if p_expires_at > v_now + public.portal_token_max_lifetime() then
    raise exception 'expires_at must be at most % from now', public.portal_token_max_lifetime()
      using errcode = '22023';
  end if;
  return p_expires_at;
end $fn$;

-- Vigente = activo, sin revocar y sin caducar. La plaza se libera sola cuando el
-- enlace caduca: no hace falta ningún proceso de limpieza.
--
-- Se llama SIEMPRE después de insertar y con el bloqueo FOR UPDATE del proyecto
-- ya tomado. Contar sin ese bloqueo no bastaría: dos emisiones simultáneas
-- verían ambas cuatro enlaces y dejarían seis.
create function portal_token_internal.assert_live_link_cap(p_project_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $fn$
declare v_live integer;
begin
  select count(*) into v_live from public.portal_tokens
    where project_id = p_project_id
      and is_active
      and revoked_at is null
      and expires_at > now();
  if v_live > 5 then
    raise exception 'Project already has the maximum of 5 live portal links'
      using errcode = 'PT409';
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
declare
  v_owner uuid := auth.uid();
  v_row public.portal_tokens%rowtype;
  v_expires timestamptz;
begin
  -- Toma el bloqueo del proyecto antes de nada: a partir de aquí, ninguna otra
  -- emisión ni rotación de este proyecto avanza hasta que esta confirme.
  perform portal_token_internal.owned_project(p_project_id, v_owner);
  perform portal_token_internal.validate_permissions(p_permissions);
  v_expires := portal_token_internal.resolve_expiry(p_expires_at);
  -- gen_random_uuid() usa el CSPRNG del servidor; el valor nunca llega del cliente.
  insert into public.portal_tokens
    (project_id, token, permissions, is_active, expires_at, created_by, label)
    values (p_project_id, gen_random_uuid(), p_permissions, true, v_expires,
      v_owner, nullif(btrim(p_label), ''))
    returning * into v_row;
  perform portal_token_internal.assert_live_link_cap(p_project_id);
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
  -- El bloqueo del proyecto se toma después del de la fila, y nunca al revés,
  -- así que no hay ciclo posible con una emisión concurrente.
  perform portal_token_internal.owned_project(v_old.project_id, v_owner);
  -- Rotar da un plazo nuevo completo; no se hereda el tiempo que le quedara al
  -- anterior, que es justo lo que se quiere renovar.
  v_expires := portal_token_internal.resolve_expiry(p_expires_at);
  -- Rotar al tope de plazas no falla porque su saldo neto es cero y el tope se
  -- comprueba una sola vez, al final: dentro de la transacción da igual en qué
  -- orden vayan el update y el insert. Se revoca primero solo porque se lee
  -- mejor. Lo que sostiene el tope es el bloqueo del proyecto de más arriba.
  update public.portal_tokens
    set is_active = false, revoked_at = now()
    where id = v_old.id returning * into v_revoked;
  insert into public.portal_tokens
    (project_id, token, permissions, is_active, expires_at, created_by, label)
    values (v_old.project_id, gen_random_uuid(), v_old.permissions, true, v_expires,
      v_owner, v_old.label)
    returning * into v_new;
  perform portal_token_internal.assert_live_link_cap(v_old.project_id);
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
