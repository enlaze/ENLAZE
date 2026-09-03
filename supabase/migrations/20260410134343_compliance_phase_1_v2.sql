
-- Phase 1 (skip activity_log if exists)
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activity_log_own" ON activity_log;
CREATE POLICY "activity_log_own" ON activity_log FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  document_type TEXT NOT NULL,
  document_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ DEFAULT now(),
  ip_address INET,
  user_agent TEXT
);
ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "legal_acceptances_own" ON legal_acceptances;
CREATE POLICY "legal_acceptances_own" ON legal_acceptances FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user ON legal_acceptances(user_id);
-- Add unique constraint if not exists (safe with DO block)
DO $$ BEGIN
  ALTER TABLE legal_acceptances ADD CONSTRAINT legal_acceptances_unique UNIQUE(user_id, document_type, document_version);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS marketing_consents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  client_id UUID REFERENCES clients(id),
  consent_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'granted',
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE marketing_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "marketing_consents_own" ON marketing_consents;
CREATE POLICY "marketing_consents_own" ON marketing_consents FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_marketing_consents_user ON marketing_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_marketing_consents_client ON marketing_consents(client_id);

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS marketing_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_source TEXT,
  ADD COLUMN IF NOT EXISTS privacy_notice_version TEXT,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_ip INET,
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
