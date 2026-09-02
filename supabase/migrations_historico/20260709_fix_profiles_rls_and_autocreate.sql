-- 20260709_fix_profiles_rls_and_autocreate.sql
--
-- Arregla el error 42501 ("new row violates row-level security policy for
-- table profiles") al guardar el perfil en Settings.
--
-- Causa: la tabla public.profiles tiene RLS activo pero le falta la política
-- de INSERT, y no existe ningún trigger que cree la fila de perfil cuando se
-- registra un usuario. Un usuario nuevo no tiene fila en profiles, el
-- onboarding hace UPDATE sobre 0 filas y el upsert de Settings falla en el
-- INSERT por RLS.
--
-- Esta migración es idempotente (se puede volver a ejecutar sin error).

-- Asegura que RLS está activo (no-op si ya lo estaba).
alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- 1) Políticas RLS basadas en auth.uid() = id
-- ---------------------------------------------------------------------------

drop policy if exists "Profiles select own" on public.profiles;
create policy "Profiles select own"
  on public.profiles
  for select
  using (auth.uid() = id);

-- La política que faltaba: sin ella el INSERT/upsert falla con 42501.
drop policy if exists "Profiles insert own" on public.profiles;
create policy "Profiles insert own"
  on public.profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists "Profiles update own" on public.profiles;
create policy "Profiles update own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 2) Auto-creación de la fila de perfil al registrarse un usuario
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3) Backfill: crea la fila de perfil para los usuarios existentes que no la
--    tengan todavía.
-- ---------------------------------------------------------------------------

insert into public.profiles (id, email, full_name)
select
  u.id,
  u.email,
  u.raw_user_meta_data->>'full_name'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
