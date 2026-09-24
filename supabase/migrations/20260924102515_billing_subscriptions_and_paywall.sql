-- Pasarela de pago (Stripe, modo prueba) y muro de pago en base de datos.
--
-- Por qué en base de datos: crear clientes, presupuestos y facturas se hace
-- desde el navegador directamente contra Supabase (ClientForm, RPC
-- create_budget_with_items, EmitidasTab…), sin pasar por rutas de API. Un
-- 402 solo en las rutas sería un muro de adorno. Mismo enfoque que
-- trg_block_writes_during_account_deletion.
--
-- Los NÚMEROS (límites, días de prueba, funciones por plan) NO viven aquí:
-- la fuente de verdad es lib/plans.ts, que se copia a public.plan_catalog con
-- `npm run plans:sync`. `npm run build` falla (prebuild → plans:check) si la
-- tabla no coincide con el fichero. Esta migración deja plan_catalog vacía:
-- tras aplicarla hay que ejecutar `npm run plans:sync` o el alta de usuarios
-- nuevos falla a propósito (no hay días de prueba que asignar).
--
-- Errores del muro: SQLSTATE 'PT402'. PostgREST traduce PTxyz a HTTP xyz, así
-- que una escritura bloqueada desde el navegador responde 402 de verdad.

begin;

create schema if not exists billing_internal;
revoke all on schema billing_internal from public, anon, authenticated;

-- ── Catálogo de planes (copia de lib/plans.ts) ──────────────────────────

create table public.plan_catalog (
  plan text primary key check (plan in ('prueba', 'basico', 'profesional', 'empresa')),
  trial_days integer check (trial_days is null or trial_days > 0),
  -- { "<recurso>": { "max": <int|null>, "period": "stock"|"month"|"trial" } }
  limits jsonb not null,
  features text[] not null,
  synced_at timestamptz not null default now()
);
comment on table public.plan_catalog is
  'Copia de lib/plans.ts (fuente de verdad). Solo la escribe `npm run plans:sync` '
  'con service_role; `npm run build` falla si no coincide.';

-- ── Suscripciones ───────────────────────────────────────────────────────

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('prueba', 'basico', 'profesional', 'empresa')),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled')),
  billing_interval text check (billing_interval in ('month', 'year')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  -- Cuentas del equipo / de prueba: fuera de cualquier métrica de clientes reales.
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_trial_is_prueba check ((status = 'trialing') = (plan = 'prueba'))
);
comment on table public.subscriptions is
  'Una fila por usuario. El dueño solo puede LEERLA; solo service_role escribe '
  '(webhook de Stripe, checkout, trigger de alta).';

-- ── Libro de uso (contadores por ventana) ───────────────────────────────
-- Cada presupuesto, factura, WhatsApp, email o generación con IA deja una
-- fila. Borrar el documento NO devuelve cupo. amount < 0 = devolución (un
-- envío que falló después de reservar cupo).

create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  resource text not null,
  amount integer not null check (amount <> 0),
  source text,
  created_at timestamptz not null default now()
);
create index usage_events_user_resource_created_idx
  on public.usage_events (user_id, resource, created_at);

-- ── Eventos de Stripe ya vistos ─────────────────────────────────────────

create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
comment on table public.stripe_events is
  'Deduplicación del webhook de Stripe. processed_at null = en curso o fallido '
  '(se reintenta); no null = ya aplicado, se descarta.';

-- ── RLS: el dueño lee su fila; NADIE escribe salvo service_role ─────────

alter table public.plan_catalog enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_events enable row level security;
alter table public.stripe_events enable row level security;

create policy plan_catalog_read on public.plan_catalog
  for select to anon, authenticated using (true);
create policy subscriptions_owner_read on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy usage_events_owner_read on public.usage_events
  for select to authenticated using (user_id = (select auth.uid()));
-- stripe_events: sin policies.

-- Doble cinturón: aunque alguien añada mañana una policy de escritura por
-- error, sin GRANT la anon key sigue sin poder escribir.
revoke insert, update, delete, truncate on
  public.plan_catalog, public.subscriptions, public.usage_events, public.stripe_events
  from anon, authenticated;
revoke all on public.stripe_events from anon, authenticated;

-- ── Núcleo del cálculo (un único sitio: lo usan triggers y API) ─────────

create or replace function billing_internal.access_level(p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when s.status = 'active' then 'full'
    when s.status = 'trialing' and s.trial_ends_at > now() then 'full'
    else 'read_only'   -- prueba caducada, impago, cancelado o sin fila
  end
  from (select 1) as one
  left join public.subscriptions s on s.user_id = p_user;
$$;

create or replace function billing_internal.window_start(p_user uuid, p_period text)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select case p_period
    when 'month' then date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid'
    when 'trial' then (select coalesce(s.trial_started_at, s.created_at)
                         from public.subscriptions s where s.user_id = p_user)
    else null
  end;
$$;

create or replace function billing_internal.current_usage(p_user uuid, p_resource text, p_period text)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_used bigint;
begin
  if p_period = 'stock' then
    if p_resource = 'clientes' then
      select count(*) into v_used from public.clients where user_id = p_user;
    else
      raise exception 'billing: recurso de stock desconocido %', p_resource;
    end if;
  else
    select coalesce(sum(amount), 0) into v_used
      from public.usage_events
     where user_id = p_user
       and resource = p_resource
       and created_at >= billing_internal.window_start(p_user, p_period);
  end if;
  return v_used;
end;
$$;

-- Evalúa (y opcionalmente registra) una operación. Devuelve:
-- { ok, reason: null|'read_only'|'feature'|'limit', access_level, plan, status,
--   resource, feature, used, limit, period, message }
create or replace function billing_internal.evaluate(
  p_user uuid,
  p_resource text,
  p_amount integer,
  p_feature text,
  p_record boolean,
  p_source text
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  s public.subscriptions%rowtype;
  c public.plan_catalog%rowtype;
  v_access text := billing_internal.access_level(p_user);
  v_limit jsonb;
  v_max bigint;
  v_period text;
  v_used bigint := null;
  v_base jsonb;
begin
  select * into s from public.subscriptions where user_id = p_user;
  select * into c from public.plan_catalog where plan = s.plan;

  v_base := jsonb_build_object(
    'access_level', v_access, 'plan', s.plan, 'status', s.status,
    'resource', p_resource, 'feature', p_feature);

  if v_access <> 'full' then
    return v_base || jsonb_build_object('ok', false, 'reason', 'read_only',
      'message', 'Tu cuenta está en modo solo lectura (la prueba ha terminado o la suscripción no está activa). '
              || 'Puedes consultar y exportar tus datos, pero no crear ni modificar.');
  end if;

  if c.plan is null then
    raise exception 'billing: plan_catalog sin sincronizar para el plan % (ejecuta npm run plans:sync)', s.plan;
  end if;

  if p_feature is not null and not (c.features @> array[p_feature]) then
    return v_base || jsonb_build_object('ok', false, 'reason', 'feature',
      'message', format('Tu plan no incluye esta función (%s).', p_feature));
  end if;

  if p_resource is null then
    return v_base || jsonb_build_object('ok', true, 'reason', null);
  end if;

  v_limit := c.limits -> p_resource;
  if v_limit is null then
    raise exception 'billing: el plan % no define el recurso %', s.plan, p_resource;
  end if;
  v_period := v_limit ->> 'period';
  v_max := (v_limit ->> 'max')::bigint;   -- null = sin límite

  -- Serializa las comprobaciones del mismo usuario y recurso: dos peticiones
  -- simultáneas no pueden colarse las dos con el último hueco.
  perform pg_advisory_xact_lock(hashtextextended('billing:' || p_user::text || ':' || p_resource, 0));

  v_used := billing_internal.current_usage(p_user, p_resource, v_period);
  v_base := v_base || jsonb_build_object('used', v_used, 'limit', v_max, 'period', v_period);

  if v_max is not null and v_used + p_amount > v_max then
    return v_base || jsonb_build_object('ok', false, 'reason', 'limit',
      'message', format('Has alcanzado el límite de tu plan: %s de %s %s%s.',
        v_used, v_max, p_resource,
        case v_period when 'month' then ' este mes' when 'trial' then ' durante la prueba' else '' end));
  end if;

  if p_record and v_period <> 'stock' then
    insert into public.usage_events (user_id, resource, amount, source)
    values (p_user, p_resource, p_amount, p_source);
  end if;

  return v_base || jsonb_build_object('ok', true, 'reason', null);
end;
$$;

revoke all on all functions in schema billing_internal from public, anon, authenticated;

-- ── RPC para el servidor (solo service_role) ────────────────────────────

create or replace function public.billing_check(
  p_user_id uuid, p_resource text default null, p_amount integer default 1, p_feature text default null)
returns jsonb
language sql volatile security definer set search_path = ''
as $$ select billing_internal.evaluate(p_user_id, p_resource, p_amount, p_feature, false, null); $$;

create or replace function public.billing_consume(
  p_user_id uuid, p_resource text, p_amount integer default 1,
  p_feature text default null, p_source text default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'billing_consume: amount debe ser positivo';
  end if;
  return billing_internal.evaluate(p_user_id, p_resource, p_amount, p_feature, true, p_source);
end;
$$;

-- Devuelve cupo de envíos reservados que finalmente fallaron.
create or replace function public.billing_release(
  p_user_id uuid, p_resource text, p_amount integer, p_source text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then return; end if;
  insert into public.usage_events (user_id, resource, amount, source)
  values (p_user_id, p_resource, -p_amount, coalesce(p_source, 'release'));
end;
$$;

revoke all on function public.billing_check(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.billing_consume(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.billing_release(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.billing_check(uuid, text, integer, text) to service_role;
grant execute on function public.billing_consume(uuid, text, integer, text, text) to service_role;
grant execute on function public.billing_release(uuid, text, integer, text) to service_role;

-- ── Trigger del muro sobre las tablas que se escriben desde el navegador ─
-- tg_argv[0] = recurso con límite ('' = ninguno)
-- tg_argv[1] = función de plan exigida ('' = ninguna)
--
-- Solo actúa sobre peticiones de un usuario autenticado. service_role
-- (webhooks de n8n, cron) y anon (portal y firma del cliente final) pasan:
-- la lista C acordada. Aun así, lo que crea el sistema se anota en el libro
-- de uso para que cuente.

create or replace function billing_internal.guard_write()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_resource text := nullif(tg_argv[0], '');
  v_feature text := nullif(tg_argv[1], '');
  v_owner uuid := coalesce(new.user_id, auth.uid());
  v_result jsonb;
  v_ignored text[] := array['deleted_at', 'deleted_by', 'updated_at'];
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    if tg_op = 'INSERT' and v_resource is not null and v_owner is not null
       and exists (select 1 from public.subscriptions s
                     join public.plan_catalog c on c.plan = s.plan
                    where s.user_id = v_owner
                      and c.limits -> v_resource ->> 'period' <> 'stock') then
      insert into public.usage_events (user_id, resource, amount, source)
      values (v_owner, v_resource, 1, 'system:' || tg_table_name);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Mover a la papelera o restaurar siempre se permite: el cliente nunca
    -- pierde el control de sus datos.
    if (to_jsonb(new) - v_ignored) = (to_jsonb(old) - v_ignored) then
      return new;
    end if;
    v_result := billing_internal.evaluate(v_owner, null, 0, null, false, null);
  else
    v_result := billing_internal.evaluate(v_owner, v_resource, 1, v_feature, true, 'db:' || tg_table_name);
  end if;

  if not (v_result ->> 'ok')::boolean then
    raise exception '%', v_result ->> 'message'
      using errcode = 'PT402', detail = v_result::text;
  end if;
  return new;
end;
$$;
revoke all on function billing_internal.guard_write() from public, anon, authenticated;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('clients',            'clientes',     'clientes'),
      ('budgets',            'presupuestos', 'presupuestos'),
      ('issued_invoices',    'facturas',     'facturas'),
      ('invoices',           '',             'facturas'),
      ('messages',           '',             ''),
      ('scheduled_messages', '',             'programacion_envios'),
      ('price_alerts',       '',             'seguimiento_precios')
    ) as v(table_name, resource, feature)
  loop
    execute format('drop trigger if exists trg_billing_guard_write on public.%I', t.table_name);
    execute format(
      'create trigger trg_billing_guard_write before insert or update on public.%I '
        || 'for each row execute function billing_internal.guard_write(%L, %L)',
      t.table_name, t.resource, t.feature);
  end loop;
end $$;

-- ── Alta: prueba gratuita automática ────────────────────────────────────
-- Trigger y no código en app/register: el registro llama a
-- supabase.auth.signUp desde el navegador (no hay servidor donde engancharse)
-- y el alta con Google tampoco pasa por ese formulario. Mismo patrón que
-- on_auth_user_created → handle_new_user.

create or replace function billing_internal.start_trial()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_days integer;
begin
  select trial_days into v_days from public.plan_catalog where plan = 'prueba';
  if v_days is null then
    raise exception 'billing: plan_catalog sin sincronizar (ejecuta npm run plans:sync)';
  end if;
  insert into public.subscriptions (user_id, plan, status, trial_started_at, trial_ends_at)
  values (new.id, 'prueba', 'trialing', now(), now() + make_interval(days => v_days))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function billing_internal.start_trial() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_start_trial on auth.users;
create trigger on_auth_user_created_start_trial
  after insert on auth.users
  for each row execute function billing_internal.start_trial();

-- ── Usuarios que ya existían: cuentas internas, activas ─────────────────
-- Son del equipo: no se les corta nada y quedan marcadas is_internal para
-- que nunca cuenten como clientes reales.

insert into public.subscriptions (user_id, plan, status, is_internal)
select u.id, 'empresa', 'active', true
  from auth.users u
on conflict (user_id) do nothing;

commit;
