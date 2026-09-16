-- Disposable model of the production columns used by portal_read_snapshot.
-- Apply only after bootstrap-budget-schema.sql in a guarded test transaction.
create table public.clients (
  id uuid primary key, user_id uuid not null references auth.users(id),
  name text, email text, phone text, company text);
create table public.projects (
  id uuid primary key, user_id uuid not null references auth.users(id),
  client_id uuid references public.clients(id), access_token uuid unique default gen_random_uuid(),
  deleted_at timestamptz, name text, address text, description text, status text,
  start_date date, end_date date, budget_amount numeric, notes text,
  created_at timestamptz default now());
alter table public.budgets add column project_id uuid references public.projects(id),
  add column client_id uuid references public.clients(id),
  add column budget_number text,
  add column service_type text, add column subtotal numeric,
  add column iva_amount numeric, add column total numeric,
  add column viewed_at timestamptz,
  add column version integer not null default 1;
-- can_respond repeats the finalized-document check portal_respond_to_budget makes.
create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null, entity_id uuid not null, version integer not null,
  snapshot jsonb, changed_by uuid references auth.users(id), change_summary text);
create table public.invoices (
  id uuid primary key, user_id uuid not null references auth.users(id),
  project_id uuid references public.projects(id),client_id uuid references public.clients(id),
  deleted_at timestamptz, invoice_number text, invoice_date date,
  base_amount numeric,iva_amount numeric,total_amount numeric,
  category text,payment_status text);
create table public.payments (
  id uuid primary key, user_id uuid not null references auth.users(id),
  project_id uuid references public.projects(id), amount numeric,
  payment_date date,payment_method text,concept text);
create table public.project_changes (
  id uuid primary key, user_id uuid not null references auth.users(id),
  project_id uuid references public.projects(id),title text,description text,
  economic_impact numeric,time_impact_days integer,status text,
  client_approved boolean,approved_date date,notes text,
  created_at timestamptz default now(),updated_at timestamptz default now());
create table public.project_milestones (
  id uuid primary key, project_id uuid references public.projects(id),
  title text,planned_date date,actual_date date,status text,
  sort_order integer,notes text);
create table public.portal_tokens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  token uuid unique not null default gen_random_uuid(),
  permissions jsonb default '["read"]'::jsonb,
  is_active boolean default true, revoked_at timestamptz,
  expires_at timestamptz, created_by uuid references auth.users(id),
  last_accessed_at timestamptz, access_count integer default 0);
alter table public.portal_tokens enable row level security;
alter table public.projects enable row level security;
alter table public.project_changes enable row level security;
create policy "Users manage their portal tokens" on public.portal_tokens
  for all using(created_by=auth.uid() or project_id in
    (select id from public.projects where user_id=auth.uid()));
create policy portal_tokens_user on public.portal_tokens
  for all using(created_by=auth.uid() or project_id in
    (select id from public.projects where user_id=auth.uid()));
create policy "Public portal token read" on public.portal_tokens
  for select using(is_active=true and (expires_at is null or expires_at>now()));
create policy portal_tokens_anon_read on public.portal_tokens
  for select using(is_active=true and (expires_at is null or expires_at>now()));
create policy projects_select_own on public.projects
  for select using(user_id=auth.uid());
create policy "Public update change approval" on public.project_changes
  for update using(true) with check(true);
create policy "Public update budget status" on public.budgets
  for update using(true) with check(true);
grant select on public.portal_tokens,public.projects to anon,authenticated;
grant select,update on public.project_changes to anon,authenticated;
-- Production grants anon these table privileges, so RLS is the only thing that
-- stops a portal write. Without the grant the direct-write assertions would
-- pass for the wrong reason: a missing privilege instead of a missing policy.
grant select,update on public.budgets to anon;
