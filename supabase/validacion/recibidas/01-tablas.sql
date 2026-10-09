-- DDL extraído del catálogo de producción (dsgnymebkxxkslyeotee), tal cual.
create table public.budgets (
  id uuid default gen_random_uuid() not null, user_id uuid not null, client_id uuid,
  budget_number text not null, title text not null, description text,
  service_type text default 'general'::text, subtotal numeric(12,2) default 0,
  iva_percentage numeric(5,2) default 21, iva_amount numeric(12,2) default 0,
  total numeric(12,2) default 0, status text default 'pending'::text, notes text,
  valid_until date, created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(), margin_percent numeric(5,2) default 0,
  subtotal_cost numeric(12,2) default 0, total_cost numeric(12,2) default 0,
  client_address text default ''::text, project_id uuid, version integer default 1,
  sent_at timestamp with time zone, viewed_at timestamp with time zone,
  accepted_at timestamp with time zone, rejected_at timestamp with time zone,
  accepted_by_name text, accepted_ip inet, client_email text, client_name text,
  client_phone text, client_nif text, iva_percent numeric(5,2) default 21,
  wizard_state jsonb default '{}'::jsonb not null, analysis jsonb, economics jsonb,
  timeline jsonb, validation jsonb, quality_tier text default 'media'::text, scope_data jsonb,
  deleted_at timestamp with time zone, deleted_by uuid,
  deposit_percent numeric(5,2) default 30 not null,
  payment_method text default 'Transferencia bancaria'::text not null,
  payment_iban text default ''::text not null, warranty_text text default ''::text not null,
  execution_deadline_text text default ''::text not null, observations text default ''::text not null,
  conditions_text text default ''::text not null, discount_type text default 'percent'::text not null,
  discount_percent numeric(5,2) default 0 not null, discount_amount numeric(12,2) default 0 not null,
  payment_schedule jsonb default '[]'::jsonb not null, lock_version integer default 1 not null
);

create table public.clients (
  id uuid default gen_random_uuid() not null, user_id uuid not null, name text not null,
  email text, phone text, company text, notes text, status text default 'active'::text,
  created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(),
  marketing_status text default 'none'::text, marketing_opt_in_at timestamp with time zone,
  marketing_opt_out_at timestamp with time zone, marketing_source text,
  privacy_notice_version text, last_contacted_at timestamp with time zone,
  tags text[] default '{}'::text[] not null
);

create table public.delivery_notes (
  id uuid default gen_random_uuid() not null, user_id uuid not null, project_id uuid,
  supplier_id uuid, order_id uuid, invoice_id uuid, note_number text default ''::text not null,
  status text default 'pending'::text not null, reception_date date default CURRENT_DATE not null,
  subtotal numeric(12,2) default 0 not null, iva_percent numeric(5,2) default 21 not null,
  iva_amount numeric(12,2) default 0 not null, total numeric(12,2) default 0 not null,
  notes text default ''::text, image_url text default ''::text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.document_versions (
  id uuid default gen_random_uuid() not null, entity_type text not null, entity_id uuid not null,
  version integer not null, snapshot jsonb not null, changed_by uuid, change_summary text,
  created_at timestamp with time zone default now()
);

create table public.expense_categories (
  id uuid default gen_random_uuid() not null, user_id uuid not null, name text not null,
  color text default '#6b7280'::text, icon text default '📁'::text,
  is_default boolean default false, created_at timestamp with time zone default now()
);

create table public.invoice_items (
  id uuid default gen_random_uuid() not null, invoice_id uuid not null, description text not null,
  quantity numeric(10,2) default 1, unit_price numeric(12,2) default 0,
  iva_percentage numeric(5,2) default 21, subtotal numeric(12,2) default 0,
  sort_order integer default 0
);

create table public.invoices (
  id uuid default gen_random_uuid() not null, user_id uuid not null,
  supplier_name text default ''::text not null, supplier_nif text default ''::text,
  supplier_address text default ''::text, invoice_number text default ''::text,
  invoice_date date, due_date date, base_amount numeric(12,2) default 0,
  iva_percentage numeric(5,2) default 21, iva_amount numeric(12,2) default 0,
  irpf_percentage numeric(5,2) default 0, irpf_amount numeric(12,2) default 0,
  total_amount numeric(12,2) default 0, category text default 'general'::text,
  subcategory text default ''::text, payment_status text default 'pending'::text,
  payment_method text default ''::text, image_url text default ''::text,
  ocr_raw_data jsonb default '{}'::jsonb, ocr_confidence numeric(5,2) default 0,
  manually_verified boolean default false, notes text default ''::text,
  tags text[] default '{}'::text[], quarter text default ''::text, fiscal_year integer,
  created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(),
  client_id uuid, project_id uuid, supplier_id uuid,
  deleted_at timestamp with time zone, deleted_by uuid
);

create table public.payments (
  id uuid default gen_random_uuid() not null, user_id uuid not null, project_id uuid,
  client_id uuid, budget_id uuid, amount numeric default 0 not null,
  payment_date date default CURRENT_DATE not null,
  payment_method text default 'transferencia'::text not null, concept text default ''::text not null,
  notes text default ''::text, created_at timestamp with time zone default now() not null,
  due_date date, reference text, proof_file_path text, invoice_id uuid,
  status text default 'completed'::text not null, type text default 'income'::text not null
);

create table public.portal_tokens (
  id uuid default gen_random_uuid() not null, project_id uuid not null,
  token uuid default gen_random_uuid() not null, label text,
  permissions jsonb default '["read"]'::jsonb, is_active boolean default true,
  expires_at timestamp with time zone default (now() + portal_token_default_lifetime()) not null,
  last_accessed_at timestamp with time zone, access_count integer default 0,
  created_by uuid, created_at timestamp with time zone default now() not null,
  revoked_at timestamp with time zone
);

create table public.project_changes (
  id uuid default gen_random_uuid() not null, project_id uuid not null, user_id uuid not null,
  title text not null, description text default ''::text,
  economic_impact numeric default 0 not null, time_impact_days integer default 0 not null,
  status text default 'proposed'::text not null, client_approved boolean default false not null,
  approved_date date, notes text default ''::text, image_urls text[] default '{}'::text[],
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null, version integer default 1,
  sent_to_client_at timestamp with time zone, approved_by_name text,
  impact_sale_amount numeric(12,2) default 0, impact_cost_amount numeric(12,2) default 0,
  related_issued_invoice_id uuid
);

create table public.project_milestones (
  id uuid default gen_random_uuid() not null, project_id uuid not null, title text not null,
  planned_date date, actual_date date, status text default 'pending'::text not null,
  sort_order integer default 0 not null, notes text default ''::text,
  created_at timestamp with time zone default now() not null
);

create table public.projects (
  id uuid default gen_random_uuid() not null, user_id uuid not null, client_id uuid,
  name text not null, address text default ''::text, description text default ''::text,
  status text default 'planning'::text not null, start_date date, end_date date,
  budget_amount numeric(12,2) default 0, actual_cost numeric(12,2) default 0,
  notes text default ''::text, created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null, started_at timestamp with time zone,
  completed_at timestamp with time zone, archived_at timestamp with time zone,
  risk_level text default 'low'::text, service_type text,
  deleted_at timestamp with time zone, deleted_by uuid
);

create table public.received_invoices (
  id uuid default gen_random_uuid() not null, user_id uuid, supplier_id uuid, project_id uuid,
  category_id uuid, invoice_number text not null, supplier_name text not null, supplier_nif text,
  issue_date date not null, reception_date date default CURRENT_DATE, due_date date,
  subtotal numeric(12,2) default 0 not null, iva_percent numeric(5,2) default 21,
  iva_amount numeric(12,2) default 0, irpf_percent numeric(5,2) default 0,
  irpf_amount numeric(12,2) default 0, total numeric(12,2) default 0 not null,
  status text default 'pending'::text, payment_status text default 'unpaid'::text,
  amount_paid numeric(12,2) default 0, payment_date date, payment_method text,
  document_url text, notes text, created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(), deleted_at timestamp with time zone,
  deleted_by uuid
);

create table public.suppliers (
  id uuid default gen_random_uuid() not null, user_id uuid not null, name text not null,
  nif text default ''::text, email text default ''::text, phone text default ''::text,
  address text default ''::text, contact_person text default ''::text, trade text default ''::text,
  specialty text default ''::text, notes text default ''::text,
  status text default 'active'::text not null, rating integer default 0,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  type text default 'proveedor'::text not null, hourly_rate numeric default 0
);
