
-- ============================================================
-- COMPLIANCE PHASE 2: portal_tokens + document_versions + cols
-- ============================================================

-- 1. portal_tokens — replaces the single access_token on projects
CREATE TABLE IF NOT EXISTS portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  label TEXT,
  permissions JSONB DEFAULT '["read"]',
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their portal tokens" ON portal_tokens;
CREATE POLICY "Users manage their portal tokens" ON portal_tokens
  FOR ALL USING (
    created_by = auth.uid()
    OR project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- Allow anonymous reads for portal access (public visitors with valid token)
DROP POLICY IF EXISTS "Public portal token read" ON portal_tokens;
CREATE POLICY "Public portal token read" ON portal_tokens
  FOR SELECT USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- 2. document_versions — snapshot versioning for budgets, changes, etc.
CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  change_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_type, entity_id, version)
);

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their document versions" ON document_versions;
CREATE POLICY "Users manage their document versions" ON document_versions
  FOR ALL USING (
    changed_by = auth.uid()
  );

-- 3. New columns on budgets (acceptance timeline + versioning)
DO $$ BEGIN
  ALTER TABLE budgets ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE budgets ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE budgets ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE budgets ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE budgets ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE budgets ADD COLUMN IF NOT EXISTS accepted_by_name TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE budgets ADD COLUMN IF NOT EXISTS accepted_ip INET;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 4. New columns on project_changes (acceptance timeline + versioning)
DO $$ BEGIN
  ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS sent_to_client_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS approved_by_name TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS impact_sale_amount NUMERIC(12,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS impact_cost_amount NUMERIC(12,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS related_issued_invoice_id UUID REFERENCES issued_invoices(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 5. Migrate existing access_token data from projects into portal_tokens
INSERT INTO portal_tokens (project_id, token, label, permissions, is_active, created_by, created_at)
SELECT
  p.id,
  p.access_token,
  'Token original (migrado)',
  '["read","approve_budget","approve_change"]'::jsonb,
  true,
  p.user_id,
  p.created_at
FROM projects p
WHERE p.access_token IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM portal_tokens pt WHERE pt.token = p.access_token
  );

-- Index for fast portal lookups
CREATE INDEX IF NOT EXISTS idx_portal_tokens_token ON portal_tokens(token) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_document_versions_entity ON document_versions(entity_type, entity_id);
