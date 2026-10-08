-- Cimientos que Supabase da hechos y aquí no existen.
create schema if not exists auth;
create table auth.users (id uuid primary key);
-- auth.uid() leído de una variable de sesión, como el JWT en Supabase.
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('test.uid', true), '')::uuid $$;
-- Los roles son del clúster, no de la base: al rehacerla ya existen.
do $roles$ begin
  create role anon;
exception when duplicate_object then null; end $roles$;
do $roles$ begin
  create role authenticated;
exception when duplicate_object then null; end $roles$;
do $roles$ begin
  create role service_role;
exception when duplicate_object then null; end $roles$;

CREATE OR REPLACE FUNCTION public.portal_token_default_lifetime()
 RETURNS interval LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$ select interval '90 days' $function$;

CREATE OR REPLACE FUNCTION public.portal_token_max_lifetime()
 RETURNS interval LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$ select interval '365 days' $function$;

CREATE OR REPLACE FUNCTION public.portal_token_permissions_valid(p_permissions jsonb)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
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
$function$;
