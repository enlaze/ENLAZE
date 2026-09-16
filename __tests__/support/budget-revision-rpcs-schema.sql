-- E2 fixture extension, ONLY after the disposable-cluster guards and shared
-- bootstrap. This is a model of relevant catalog fields, not a production dump.
create table public.clients (id uuid primary key, user_id uuid not null references auth.users);
create table public.projects (id uuid primary key, user_id uuid not null references auth.users, client_id uuid references public.clients);
create table public.account_deletion_locks (user_id uuid primary key references auth.users, locked_at timestamptz default now());
alter table public.budgets
  alter column status drop not null, alter column status set default 'pending',
  add column version integer default 1,
  add column budget_number text,
  add column client_id uuid references public.clients,
  add column project_id uuid references public.projects,
  add column client_name text, add column client_email text, add column client_phone text,
  add column client_address text, add column client_nif text, add column service_type text,
  add column subtotal numeric(12,2) default 0, add column iva_percent numeric(5,2) default 21,
  add column iva_amount numeric(12,2) default 0, add column total numeric(12,2) default 0,
  add column notes text, add column valid_until date,
  add column deposit_percent numeric(5,2) not null default 30,
  add column payment_method text not null default 'Transferencia bancaria',
  add column payment_iban text not null default '',
  add column discount_type text not null default 'percent' check(discount_type in ('percent','amount')),
  add column discount_percent numeric(5,2) not null default 0,
  add column discount_amount numeric(12,2) not null default 0,
  add column payment_schedule jsonb not null default '[]',
  add column warranty_text text not null default '',
  add column execution_deadline_text text not null default '',
  add column observations text not null default '', add column conditions_text text not null default '',
  add column wizard_state jsonb default '{}',
  add column sent_at timestamptz, add column viewed_at timestamptz,
  add column accepted_at timestamptz, add column rejected_at timestamptz,
  add column accepted_by_name text, add column accepted_ip inet;
create table public.document_versions(
  id uuid primary key default gen_random_uuid(), entity_type text not null,
  entity_id uuid not null, version integer not null, snapshot jsonb not null,
  changed_by uuid references auth.users, change_summary text, created_at timestamptz default now(),
  unique(entity_type,entity_id,version));
create table public.portal_tokens(
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects,
  token uuid unique not null default gen_random_uuid(), permissions jsonb default '["read"]',
  is_active boolean default true, expires_at timestamptz, revoked_at timestamptz);
-- Modern PostgREST sets request.jwt.claims, direct tests set the legacy sub GUC.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
$$;
alter table public.document_versions enable row level security;
create policy document_versions_owner on public.document_versions using(changed_by=auth.uid());
grant select,insert,update,delete on public.document_versions to authenticated,service_role;
