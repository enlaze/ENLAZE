
-- ═══════════════════════════════════════════════════
-- CONFIGURACIÓN FISCAL (fiscal_settings)
-- Datos del emisor para Verifactu/Facturae
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fiscal_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  business_name TEXT NOT NULL DEFAULT '',
  trade_name TEXT DEFAULT '',
  nif TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  province TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL DEFAULT 'ES',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  iva_regime TEXT NOT NULL DEFAULT 'general',
  -- general | simplificado | recargo_equivalencia | exento
  default_iva_percent NUMERIC(5,2) NOT NULL DEFAULT 21,
  default_irpf_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  invoice_series TEXT NOT NULL DEFAULT 'F',
  invoice_next_number INT NOT NULL DEFAULT 1,
  verifactu_enabled BOOLEAN NOT NULL DEFAULT true,
  logo_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fiscal_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own fiscal_settings"
  ON fiscal_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════
-- FACTURAS EMITIDAS (issued_invoices)
-- Facturas que el usuario emite a sus clientes
-- Con soporte Verifactu (hash encadenado + QR)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS issued_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  budget_id UUID REFERENCES budgets(id) ON DELETE SET NULL,

  -- Numeración legal
  series TEXT NOT NULL DEFAULT 'F',
  number INT NOT NULL DEFAULT 0,
  invoice_number TEXT NOT NULL DEFAULT '',
  -- ej: F-2026/0001

  -- Datos fiscales emisor (snapshot al momento de emitir)
  issuer_name TEXT NOT NULL DEFAULT '',
  issuer_nif TEXT NOT NULL DEFAULT '',
  issuer_address TEXT NOT NULL DEFAULT '',

  -- Datos fiscales receptor
  client_name TEXT NOT NULL DEFAULT '',
  client_nif TEXT DEFAULT '',
  client_address TEXT DEFAULT '',
  client_email TEXT DEFAULT '',

  -- Fechas
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  operation_date DATE,

  -- Importes
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva_percent NUMERIC(5,2) NOT NULL DEFAULT 21,
  iva_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  irpf_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  irpf_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Estado
  status TEXT NOT NULL DEFAULT 'draft',
  -- draft | issued | sent | paid | overdue | cancelled | rectified
  payment_status TEXT NOT NULL DEFAULT 'pending',
  -- pending | partial | paid
  payment_date DATE,
  payment_method TEXT DEFAULT '',

  -- Verifactu
  verifactu_hash TEXT DEFAULT '',
  verifactu_prev_hash TEXT DEFAULT '',
  verifactu_qr_data TEXT DEFAULT '',
  verifactu_registered BOOLEAN NOT NULL DEFAULT false,

  -- Facturae
  facturae_xml TEXT DEFAULT '',

  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE issued_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own issued_invoices"
  ON issued_invoices FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Public read issued_invoices"
  ON issued_invoices FOR SELECT
  USING (true);

-- ═══════════════════════════════════════════════════
-- LÍNEAS DE FACTURA EMITIDA (issued_invoice_lines)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS issued_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES issued_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'ud',
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE issued_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own issued_invoice_lines"
  ON issued_invoice_lines FOR ALL
  USING (EXISTS (SELECT 1 FROM issued_invoices WHERE issued_invoices.id = issued_invoice_lines.invoice_id AND issued_invoices.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM issued_invoices WHERE issued_invoices.id = issued_invoice_lines.invoice_id AND issued_invoices.user_id = auth.uid()));

CREATE POLICY "Public read issued_invoice_lines"
  ON issued_invoice_lines FOR SELECT
  USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_issued_invoices_user_id ON issued_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_issued_invoices_client_id ON issued_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_issued_invoices_project_id ON issued_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_issued_invoices_budget_id ON issued_invoices(budget_id);
CREATE INDEX IF NOT EXISTS idx_issued_invoices_series_number ON issued_invoices(series, number);
CREATE INDEX IF NOT EXISTS idx_issued_invoice_lines_invoice_id ON issued_invoice_lines(invoice_id);
