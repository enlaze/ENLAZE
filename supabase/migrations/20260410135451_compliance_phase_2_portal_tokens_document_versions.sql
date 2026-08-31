
-- ============================================================
-- COMPLIANCE PHASE 2: portal_tokens + document_versions + cols
-- ============================================================

-- 1) portal_tokens
CREATE TABLE IF NOT EXISTS portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  label TEXT,
  permissions JSONB DEFAULT '["read"]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "portal_tokens_user" ON portal_tokens;
CREATE POLICY "portal_tokens_user" ON portal_tokens
  FOR ALL USING (
    created_by = auth.uid()
    OR project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- Index for fast lookup by token
CREATE INDEX IF NOT EXISTS idx_portal_tokens_token ON portal_tokens(token);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_project ON portal_tokens(project_id);

-- 2) document_versions
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
DROP POLICY IF EXISTS "document_versions_user" ON document_versions;
CREATE POLICY "document_versions_user" ON document_versions
  FOR ALL USING (
    changed_by = auth.uid()
  );

CREATE INDEX IF NOT EXISTS idx_document_versions_entity ON document_versions(entity_type, entity_id);

-- 3) New columns on budgets
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS accepted_by_name TEXT;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS accepted_ip INET;

-- 4) New columns on project_changes
ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS sent_to_client_at TIMESTAMPTZ;
ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS approved_by_name TEXT;
ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS impact_sale_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS impact_cost_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS related_issued_invoice_id UUID REFERENCES issued_invoices(id);

-- 5) Anon access to portal_tokens for public portal
DROP POLICY IF EXISTS "portal_tokens_anon_read" ON portal_tokens;
CREATE POLICY "portal_tokens_anon_read" ON portal_tokens
  FOR SELECT USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));
