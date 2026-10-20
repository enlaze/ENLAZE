-- Gracia de impago. PENDIENTE: no aplicar sin PRECHECK y despliegue coordinado.
-- El ejecutor de migraciones aporta la transacción (sin BEGIN/COMMIT aquí).
-- Sin DEFAULT, backfill ni cron: past_due con NULL conserva el corte inmediato.
-- La duración vive exclusivamente en BILLING_GRACE_DAYS (lib/plans.ts).
-- El webhook envía la fecha candidata; el trigger conserva la primera bajo
-- el bloqueo de fila. La recuperación activa y la baja explícita la limpian.

-- Dos cuerpos base conocidos: solo difieren en un comentario tras read_only.
do $guard$
begin
  if to_regclass('public.subscriptions') is null or not (exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='billing_internal' and p.proname='access_level' and p.proargtypes='2950'::oidvector
      and md5(p.prosrc) in ('a73facb21af70ce1ad9ba56e0c175a5c','b7e6d58a7ee948cde947fd2a712e91a5') and p.prosecdef and p.provolatile='s'
      and p.proconfig=array['search_path=""']::text[]
      and not has_function_privilege('anon',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')))
     or not (not exists (select 1 from pg_catalog.pg_attribute where attrelid=to_regclass('public.subscriptions') and attname='past_due_grace_ends_at' and not attisdropped)) or not (not exists (select 1 from pg_catalog.pg_trigger where tgrelid=to_regclass('public.subscriptions') and tgname='trg_preserve_past_due_grace')) or not (to_regprocedure('billing_internal.preserve_past_due_grace()') is null) then
    raise exception 'BILLING_GRACE precheck incompatible; revisar CHECK_BILLING_GRACE_PRECHECK antes de aplicar';
  end if;
end $guard$;

alter table public.subscriptions add column past_due_grace_ends_at timestamptz;
comment on column public.subscriptions.past_due_grace_ends_at is
  'Primer impago + BILLING_GRACE_DAYS; los reintentos no prolongan. NULL = sin gracia. Acceso completo únicamente antes del límite, nunca en igualdad.';

create function billing_internal.preserve_past_due_grace()
returns trigger language plpgsql set search_path = ''
as $$
begin
  -- Solo la primera fecha cuenta. UPDATE toma el bloqueo de la fila: incluso
  -- dos eventos distintos concurrentes conservan la fecha que llegó primero.
  if new.status = 'past_due' and old.past_due_grace_ends_at is not null then
    new.past_due_grace_ends_at := old.past_due_grace_ends_at;
  end if;
  return new;
end;
$$;
revoke all on function billing_internal.preserve_past_due_grace() from public, anon, authenticated;
create trigger trg_preserve_past_due_grace
before update of status, past_due_grace_ends_at on public.subscriptions
for each row execute function billing_internal.preserve_past_due_grace();

create or replace function billing_internal.access_level(p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when s.status = 'active' then 'full'
    when s.status = 'trialing' and s.trial_ends_at > now() then 'full'
    when s.status = 'past_due' and s.past_due_grace_ends_at > now() then 'full'
    else 'read_only'   -- gracia NULL/caducada, prueba caducada, cancelado o sin fila
  end
  from (select 1) as one
  left join public.subscriptions s on s.user_id = p_user;
$$;

notify pgrst, 'reload schema';
