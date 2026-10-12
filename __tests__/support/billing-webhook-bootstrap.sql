-- Only prerequisites of the real billing migration. Business document tables
-- are minimal because this bench exercises subscriptions/events and access_level.
-- It does not claim to test business documents, Supabase Auth or Storage.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'
$$;
create table public.clients(id uuid primary key, user_id uuid references auth.users);
create table public.budgets(id uuid primary key, user_id uuid references auth.users);
create table public.issued_invoices(id uuid primary key, user_id uuid references auth.users);
create table public.invoices(id uuid primary key, user_id uuid references auth.users);
create table public.messages(id uuid primary key, user_id uuid references auth.users);
create table public.scheduled_messages(id uuid primary key, user_id uuid references auth.users);
create table public.price_alerts(id uuid primary key, user_id uuid references auth.users);
