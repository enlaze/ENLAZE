
-- ============================================================
-- COMPLIANCE PHASE 3: software_versions + fiscal_events + cols
-- ============================================================

-- 1. software_versions — registro de versiones del software
CREATE TABLE IF NOT EXISTS software_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  release_date TIMESTAMPTZ DEFAULT now(),
  changelog TEXT,
  verifactu_certified BOOLEAN DEFAULT false,
  is_current BOOLEAN DEFAULT false
);

ALTER TABLE software_versions ENABLE ROW LEVEL SECURITY;

-- Public read (anyone can see software versions)
DROP POLICY IF EXISTS "Public read software_versions" ON software_versions;
CREATE POLICY "Public read software_versions" ON software_versions
  FOR SELECT USING (true);

-- Seed initial version
INSERT INTO software_versions (version, changelog, verifactu_certified, is_current)
VALUES ('v1.0.0', 'Versión inicial de ENLAZE con compliance core, Verifactu, Facturae 3.2.2, multi-sector.', true, true)
ON CONFLICT (version) DO NOTHING;

-- 2. fiscal_events — eventos fiscales de facturas
CREATE TABLE IF NOT EXISTS fiscal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES issued_invoices(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  software_version_id UUID REFERENCES software_versions(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE fiscal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their fiscal events" ON fiscal_events;
CREATE POLICY "Users manage their fiscal events" ON fiscal_events
  FOR ALL USING (
    invoice_id IN (SELECT id FROM issued_invoices WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_fiscal_events_invoice ON fiscal_events(invoice_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_events_type ON fiscal_events(event_type);

-- 3. New columns on issued_invoices
DO $$ BEGIN
  ALTER TABLE issued_invoices ADD COLUMN IF NOT EXISTS xml_version TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE issued_invoices ADD COLUMN IF NOT EXISTS software_version_id UUID REFERENCES software_versions(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE issued_invoices ADD COLUMN IF NOT EXISTS correction_of_invoice_id UUID REFERENCES issued_invoices(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE issued_invoices ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 4. New columns on payments
DO $$ BEGIN
  ALTER TABLE payments ADD COLUMN IF NOT EXISTS due_date DATE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE payments ADD COLUMN IF NOT EXISTS proof_file_path TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 5. Link existing issued_invoices to current software version
UPDATE issued_invoices
SET software_version_id = (SELECT id FROM software_versions WHERE is_current = true LIMIT 1)
WHERE software_version_id IS NULL;
