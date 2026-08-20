-- ============================================================================
-- Envíos programados de WhatsApp y Email (pestaña "Programados")
--
-- Hasta ahora la cola de programados era estado local del navegador: se perdía
-- al recargar y nada la disparaba. Esta tabla la hace real y persistente, y es
-- la que consulta el dispatcher (app/api/cron/dispatch-scheduled/route.ts).
--
-- Claves del diseño:
--
--   * `audience` es jsonb con dos modos. En 'manual' se guarda la foto de los
--     client_ids elegidos; en 'filter' se guarda SOLO el criterio y los
--     destinatarios se recalculan en cada disparo — que es lo que permite
--     "cada lunes a quien tenga una factura vencida".
--
--   * `next_run_at` es el campo caliente: el dispatcher busca por él y el
--     índice parcial de abajo hace que esa consulta no toque las filas
--     pausadas, hechas ni fallidas.
--
--   * `status` incluye un estado interno 'sending'. El dispatcher marca la
--     fila así ANTES de enviar (compare-and-swap contra 'active'), de modo que
--     dos ticks solapados del cron no la disparen dos veces. Si el proceso
--     muere a media tanda la fila se queda en 'sending' y el propio dispatcher
--     la rescata en el siguiente tick (ver el "reaper" de la ruta).
--
--   * `days_of_week` va con LUNES = 0 … DOMINGO = 6, igual que el selector
--     de días del Scheduler (DAYS = L M X J V S D en components/messaging).
--     OJO: no coincide con el `dow` de Postgres (domingo = 0).
--
--   * Todas las horas se interpretan en Europe/Madrid; `next_run_at` se
--     guarda ya convertido a UTC por lib/scheduled-messages.ts.
--
-- Aditiva e idempotente: se puede reejecutar sin romper nada. Ejecutar en el
-- SQL Editor de Supabase.
-- ============================================================================

create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,
  title text,
  audience jsonb not null default '{"mode":"manual","client_ids":[]}'::jsonb,
  subject text,
  body text not null,
  schedule_type text not null,
  send_time time not null default '09:00',
  days_of_week integer[] not null default '{}',
  day_of_month integer,
  start_date date not null default current_date,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reejecutable sobre una tabla ya creada a medias (o creada a mano en el
-- dashboard): añade lo que falte sin tocar lo que ya está.
alter table public.scheduled_messages
  add column if not exists channel       text,
  add column if not exists title         text,
  add column if not exists audience      jsonb not null default '{"mode":"manual","client_ids":[]}'::jsonb,
  add column if not exists subject       text,
  add column if not exists body          text,
  add column if not exists schedule_type text,
  add column if not exists send_time     time not null default '09:00',
  add column if not exists days_of_week  integer[] not null default '{}',
  add column if not exists day_of_month  integer,
  add column if not exists start_date    date not null default current_date,
  add column if not exists next_run_at   timestamptz,
  add column if not exists last_run_at   timestamptz,
  add column if not exists last_error    text,
  add column if not exists status        text not null default 'active',
  add column if not exists created_at    timestamptz not null default now(),
  add column if not exists updated_at    timestamptz not null default now();

-- ── user_id: la columna que no puede quedarse a medias ─────────────────────
-- Va aparte de la lista de arriba a propósito. Un `add column if not exists
-- user_id uuid` la habría añadido como uuid suelto: sin NOT NULL y sin la FK
-- a auth.users, es decir, sin el borrado en cascada del que depende la
-- limpieza de cuentas y sin nada que impida una fila huérfana. Sobre la tabla
-- ya creada esto es un no-op; solo actúa si alguien la creó a medias.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'scheduled_messages'
      and column_name  = 'user_id'
  ) then
    alter table public.scheduled_messages add column user_id uuid;
  end if;

  -- La FK se busca por columna, no por nombre: una tabla hecha a mano en el
  -- dashboard puede tenerla con otro nombre y no queremos duplicarla.
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum   = any (c.conkey)
    where c.conrelid = 'public.scheduled_messages'::regclass
      and c.contype  = 'f'
      and a.attname  = 'user_id'
  ) then
    alter table public.scheduled_messages
      add constraint scheduled_messages_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  -- El NOT NULL solo si ninguna fila lo violaría. Si las hay preferimos avisar
  -- a abortar la migración entera o a borrar datos del usuario por nuestra
  -- cuenta: se arreglan a mano y se reejecuta, que para eso es idempotente.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'scheduled_messages'
      and column_name  = 'user_id'
      and is_nullable  = 'YES'
  ) then
    if exists (select 1 from public.scheduled_messages where user_id is null) then
      raise warning
        'scheduled_messages.user_id sigue siendo nullable: hay filas con user_id null. Asignalas o borralas y reejecuta esta migracion.';
    else
      alter table public.scheduled_messages alter column user_id set not null;
    end if;
  end if;
end
$$;

-- ── Restricciones de dominio ────────────────────────────────────────────────
-- En bloques guardados porque `add constraint` no admite `if not exists`.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scheduled_messages_channel_check') then
    alter table public.scheduled_messages
      add constraint scheduled_messages_channel_check
      check (channel in ('whatsapp', 'email'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'scheduled_messages_schedule_type_check') then
    alter table public.scheduled_messages
      add constraint scheduled_messages_schedule_type_check
      check (schedule_type in ('once', 'daily', 'weekly', 'monthly', 'yearly'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'scheduled_messages_status_check') then
    alter table public.scheduled_messages
      add constraint scheduled_messages_status_check
      check (status in ('active', 'paused', 'sending', 'done', 'failed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'scheduled_messages_day_of_month_check') then
    alter table public.scheduled_messages
      add constraint scheduled_messages_day_of_month_check
      check (day_of_month is null or day_of_month between 1 and 28);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'scheduled_messages_audience_check') then
    alter table public.scheduled_messages
      add constraint scheduled_messages_audience_check
      check (
        jsonb_typeof(audience) = 'object'
        and audience->>'mode' in ('manual', 'filter')
        and (
          audience->>'mode' <> 'filter'
          or audience->>'filter' in ('all', 'pending_budget', 'overdue_invoice', 'active')
        )
      );
  end if;
end
$$;

-- ── Índices ─────────────────────────────────────────────────────────────────

-- La consulta del dispatcher: status='active' and next_run_at <= now().
-- Parcial para que las pausadas / hechas / fallidas ni se miren.
create index if not exists scheduled_messages_due_idx
  on public.scheduled_messages (next_run_at)
  where status = 'active';

-- El listado de la pestaña "Programados", por canal.
create index if not exists scheduled_messages_owner_idx
  on public.scheduled_messages (user_id, channel, created_at desc);

-- ── RLS: cada usuario solo ve y toca lo suyo ────────────────────────────────
-- El dispatcher entra con la service role key, que salta RLS por diseño.

alter table public.scheduled_messages enable row level security;

drop policy if exists "Scheduled messages select own" on public.scheduled_messages;
create policy "Scheduled messages select own"
on public.scheduled_messages for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Scheduled messages insert own" on public.scheduled_messages;
create policy "Scheduled messages insert own"
on public.scheduled_messages for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Scheduled messages update own" on public.scheduled_messages;
create policy "Scheduled messages update own"
on public.scheduled_messages for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Scheduled messages delete own" on public.scheduled_messages;
create policy "Scheduled messages delete own"
on public.scheduled_messages for delete
to authenticated
using (auth.uid() = user_id);

-- ── Documentación de columnas ───────────────────────────────────────────────

comment on table public.scheduled_messages is
  'Envíos de WhatsApp/Email programados por el usuario. El dispatcher (/api/cron/dispatch-scheduled) recorre las filas active con next_run_at vencido, envía y recalcula la siguiente ocurrencia. Horas en Europe/Madrid.';

comment on column public.scheduled_messages.audience is
  'Destinatarios. {"mode":"manual","client_ids":[uuid,...]} congela la selección; {"mode":"filter","filter":"all|pending_budget|overdue_invoice|active"} la recalcula en cada disparo.';

comment on column public.scheduled_messages.body is
  'Cuerpo del mensaje con variables {nombre}, {importe} y {empresa}, resueltas por cliente en el momento del envío.';

comment on column public.scheduled_messages.subject is
  'Asunto del email (admite las mismas variables). NULL en el canal whatsapp.';

comment on column public.scheduled_messages.days_of_week is
  'Solo para schedule_type=weekly. LUNES = 0 … DOMINGO = 6, igual que el selector del Scheduler. No es el dow de Postgres.';

comment on column public.scheduled_messages.day_of_month is
  'Solo para schedule_type=monthly. 1-28, para que el envío exista en todos los meses.';

comment on column public.scheduled_messages.start_date is
  'Fecha a partir de la cual empieza a contar la recurrencia. En once es la fecha del envío; en yearly fija el día y el mes.';

comment on column public.scheduled_messages.next_run_at is
  'Instante UTC del próximo disparo. NULL cuando ya no queda ninguno (done/failed). Es el campo por el que busca el dispatcher.';

comment on column public.scheduled_messages.status is
  'active (en cola), paused (parado por el usuario), sending (reservada por el dispatcher mientras envía), done (terminada), failed (error que necesita intervención: canal desconectado, etc).';

comment on column public.scheduled_messages.last_error is
  'Último error del dispatcher, en texto para el usuario. Se limpia en cada disparo correcto.';

-- PostgREST necesita releer el esquema para exponer la tabla nueva.
notify pgrst, 'reload schema';
