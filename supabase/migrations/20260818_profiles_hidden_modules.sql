-- ============================================================================
-- Ajustes → Personalización: secciones del menú lateral ocultas por usuario
--
-- `profiles` gana `hidden_modules`: los hrefs de las secciones que el usuario
-- ha decidido no ver en el sidebar (p.ej. '{/dashboard/prices}').
--
-- Es una preferencia PERSONAL que se aplica ENCIMA del filtrado por sector
-- (sector_config.sidebar_modules): ocultar una sección solo la quita del menú,
-- nunca bloquea la ruta — entrando por URL directa la página sigue accesible.
--
-- Aditiva e idempotente. Las políticas RLS de `profiles` ("Profiles select own"
-- / "Profiles update own", 20260709_fix_profiles_rls_and_autocreate.sql) ya
-- permiten al usuario leer y escribir su propia fila, así que no hace falta
-- tocar nada más. Ejecutar en el SQL Editor de Supabase.
-- ============================================================================

alter table public.profiles
  add column if not exists hidden_modules text[] not null default '{}';

comment on column public.profiles.hidden_modules is
  'Hrefs del sidebar que el usuario ha ocultado a mano desde Ajustes → Personalización (p.ej. "/dashboard/prices"). Solo afecta al menú lateral: las rutas siguen accesibles. /dashboard y /dashboard/settings nunca se guardan aquí.';
