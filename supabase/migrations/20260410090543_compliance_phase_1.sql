
-- ═══════════════════════════════════════════════════════════════
-- COMPLIANCE PHASE 1: Trazabilidad base + Legal
-- ═══════════════════════════════════════════════════════════════

-- 1. activity_log — Registro de toda acción relevante
CREATE TABLE activity_log (
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

CREATE INDEX idx_activity_log_user ON activity_log(user_id);
CREATE INDEX idx_activity_log_entity ON activity_log(entity_type, entity_id);
CREATE INDEX idx_activity_log_action ON activity_log(action);
CREATE INDEX idx_activity_log_created ON activity_log(created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_log_user" ON activity_log FOR ALL USING (auth.uid() = user_id);

-- 2. legal_acceptances — Aceptación de documentos legales
CREATE TABLE legal_acceptances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  document_type TEXT NOT NULL,
  document_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ DEFAULT now(),
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX idx_legal_acceptances_user ON legal_acceptances(user_id);
CREATE INDEX idx_legal_acceptances_doc ON legal_acceptances(document_type, document_version);

ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_acceptances_user" ON legal_acceptances FOR ALL USING (auth.uid() = user_id);

-- 3. marketing_consents — Consentimiento comercial
CREATE TABLE marketing_consents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  consent_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'granted',
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_marketing_consents_user ON marketing_consents(user_id);
CREATE INDEX idx_marketing_consents_client ON marketing_consents(client_id);

ALTER TABLE marketing_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "marketing_consents_user" ON marketing_consents FOR ALL USING (auth.uid() = user_id);

-- 4. Columnas nuevas en clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS marketing_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_source TEXT,
  ADD COLUMN IF NOT EXISTS privacy_notice_version TEXT,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

-- 5. Columnas nuevas en profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_ip INET,
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
