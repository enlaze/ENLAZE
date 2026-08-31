
-- ═══════════════════════════════════════════════════════
-- PHASE 9: Suppliers & Received Invoices
-- ═══════════════════════════════════════════════════════

-- 1. Expense categories
CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text DEFAULT '#6b7280',
  icon text DEFAULT '📁',
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own expense_categories"
    ON expense_categories FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  trade_name text,
  nif text,
  email text,
  phone text,
  address text,
  city text,
  postal_code text,
  province text,
  country text DEFAULT 'ES',
  contact_person text,
  payment_method text DEFAULT 'transferencia',
  payment_terms_days int DEFAULT 30,
  iban text,
  notes text,
  category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blocked')),
  total_invoiced numeric(12,2) DEFAULT 0,
  total_paid numeric(12,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own suppliers"
    ON suppliers FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Received invoices (facturas recibidas)
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

ALTER TABLE received_invoices ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own received_invoices"
    ON received_invoices FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Supplier payments (pagos a proveedores)
CREATE TABLE IF NOT EXISTS supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  received_invoice_id uuid REFERENCES received_invoices(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text DEFAULT 'transferencia',
  reference text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own supplier_payments"
    ON supplier_payments FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_suppliers_user ON suppliers(user_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(user_id, status);
CREATE INDEX IF NOT EXISTS idx_received_invoices_user ON received_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_received_invoices_supplier ON received_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_received_invoices_status ON received_invoices(user_id, status);
CREATE INDEX IF NOT EXISTS idx_received_invoices_due ON received_invoices(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_invoice ON supplier_payments(received_invoice_id);
CREATE INDEX IF NOT EXISTS idx_expense_categories_user ON expense_categories(user_id);

-- 6. Function to get expense summary
CREATE OR REPLACE FUNCTION get_expense_summary(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'total_pending', COALESCE((SELECT SUM(total - amount_paid) FROM received_invoices WHERE user_id = p_user_id AND payment_status != 'paid'), 0),
    'total_paid_month', COALESCE((SELECT SUM(amount_paid) FROM received_invoices WHERE user_id = p_user_id AND payment_date >= date_trunc('month', CURRENT_DATE)), 0),
    'total_overdue', COALESCE((SELECT SUM(total - amount_paid) FROM received_invoices WHERE user_id = p_user_id AND due_date < CURRENT_DATE AND payment_status != 'paid'), 0),
    'invoices_pending', (SELECT COUNT(*) FROM received_invoices WHERE user_id = p_user_id AND payment_status != 'paid'),
    'invoices_overdue', (SELECT COUNT(*) FROM received_invoices WHERE user_id = p_user_id AND due_date < CURRENT_DATE AND payment_status != 'paid'),
    'suppliers_active', (SELECT COUNT(*) FROM suppliers WHERE user_id = p_user_id AND status = 'active')
  ) INTO result;
  RETURN result;
END;
$$;
