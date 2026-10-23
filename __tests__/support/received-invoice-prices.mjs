// Header DDL from the existing migration, plus additive deployed fields.
// Auth, RLS, all new DDL, PostgREST and price/budget writes are real.
import { read } from '../lib/budget-revision-rpcs-bench.mjs';
export async function prepareReceivedInvoices(db) {
  await db.query(`create table public.suppliers(id uuid primary key);
    create table public.expense_categories(id uuid primary key);
CREATE TABLE IF NOT EXISTS received_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  project_id uuid,
  category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,

  invoice_number text NOT NULL,
  supplier_name text NOT NULL,
  supplier_nif text,

  issue_date date NOT NULL,
  reception_date date DEFAULT CURRENT_DATE,
  due_date date,

  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  iva_percent numeric(5,2) DEFAULT 21,
  iva_amount numeric(12,2) DEFAULT 0,
  irpf_percent numeric(5,2) DEFAULT 0,
  irpf_amount numeric(12,2) DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,

  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'partial', 'rejected', 'overdue')),
  payment_status text DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  amount_paid numeric(12,2) DEFAULT 0,
  payment_date date,
  payment_method text,

  document_url text,
  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
    alter table public.received_invoices add column deleted_at timestamptz,
      add column deleted_by uuid, add column client_id uuid,
      add column category text default 'general', add column invoice_series text,
      add column operation_date date, add column supplier_address text,
      add column description text, add column vat_breakdown jsonb;
    alter table public.received_invoices enable row level security;
    create policy received_owner on public.received_invoices for all to authenticated
      using(user_id=auth.uid() and deleted_at is null)
      with check(user_id=auth.uid() and deleted_at is null);
    grant select,insert,update on public.received_invoices to authenticated;
  `);
}
export async function applyInvoicePriceMigration(db) {
  await db.query(read('supabase/migrations/20261021120000_received_invoice_prices.sql'));
}
