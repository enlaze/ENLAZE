
-- ============================================================
-- COMPLIANCE PHASE 4: ai_runs, security_incidents, subprocessors,
-- processing_activities, data_subject_requests + cols on projects
-- ============================================================

-- 1. ai_runs — registro de ejecuciones de IA
CREATE TABLE IF NOT EXISTS ai_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  run_type TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT,
  input_hash TEXT,
  output_hash TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  duration_ms INTEGER,
  human_reviewed BOOLEAN DEFAULT false,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  entity_type TEXT,
  entity_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their ai_runs" ON ai_runs;
CREATE POLICY "Users manage their ai_runs" ON ai_runs
  FOR ALL USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_ai_runs_user ON ai_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_type ON ai_runs(run_type);

-- 2. security_incidents — registro de incidentes de seguridad
CREATE TABLE IF NOT EXISTS security_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT,
  affected_data TEXT,
  affected_users INTEGER DEFAULT 0,
  detected_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  notified_aepd BOOLEAN DEFAULT false,
  notified_users BOOLEAN DEFAULT false,
  resolution TEXT,
  reported_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE security_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their security_incidents" ON security_incidents;
CREATE POLICY "Users manage their security_incidents" ON security_incidents
  FOR ALL USING (reported_by = auth.uid());

-- 3. subprocessors — registro de encargados del tratamiento
CREATE TABLE IF NOT EXISTS subprocessors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  service TEXT NOT NULL,
  country TEXT NOT NULL,
  privacy_url TEXT,
  dpa_signed BOOLEAN DEFAULT false,
  added_at TIMESTAMPTZ DEFAULT now(),
  removed_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

ALTER TABLE subprocessors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read subprocessors" ON subprocessors;
CREATE POLICY "Public read subprocessors" ON subprocessors
  FOR SELECT USING (true);

-- Seed default subprocessors
INSERT INTO subprocessors (name, service, country, privacy_url, dpa_signed, is_active) VALUES
  ('Supabase Inc.', 'Base de datos y autenticación', 'Estados Unidos (UE)', 'https://supabase.com/privacy', true, true),
  ('Vercel Inc.', 'Hosting y CDN', 'Estados Unidos (UE)', 'https://vercel.com/legal/privacy-policy', true, true),
  ('Anthropic PBC', 'Inteligencia Artificial (Claude)', 'Estados Unidos', 'https://www.anthropic.com/privacy', true, true),
  ('Resend Inc.', 'Envío de emails transaccionales', 'Estados Unidos', 'https://resend.com/legal/privacy-policy', true, true)
ON CONFLICT DO NOTHING;

-- 4. processing_activities — registro de actividades de tratamiento (RGPD Art.30)
CREATE TABLE IF NOT EXISTS processing_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  legal_basis TEXT NOT NULL,
  data_categories TEXT[],
  data_subjects TEXT[],
  retention_period TEXT,
  security_measures TEXT,
  international_transfers TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE processing_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read processing_activities" ON processing_activities;
CREATE POLICY "Public read processing_activities" ON processing_activities
  FOR SELECT USING (true);

-- Seed default processing activities
INSERT INTO processing_activities (activity_name, purpose, legal_basis, data_categories, data_subjects, retention_period, security_measures, international_transfers) VALUES
  ('Gestión de usuarios', 'Autenticación y acceso a la plataforma', 'contract', ARRAY['email','nombre','sector'], ARRAY['usuarios'], '5 años tras baja', 'Cifrado en tránsito y reposo, RLS', 'Supabase (UE-West)'),
  ('Gestión de clientes', 'Facturación y relación comercial', 'contract', ARRAY['nombre','NIF','email','teléfono','dirección'], ARRAY['clientes'], '6 años (fiscal)', 'Cifrado, acceso por user_id', 'Supabase (UE-West)'),
  ('Facturación electrónica', 'Emisión de facturas conforme a Verifactu/Facturae', 'legal_obligation', ARRAY['NIF','nombre','dirección','importes'], ARRAY['clientes','proveedores'], '6 años (fiscal)', 'Hash SHA-256, cadena Verifactu', 'Supabase (UE-West)'),
  ('Generación IA de presupuestos', 'Asistencia en creación de presupuestos con IA', 'consent', ARRAY['descripción proyecto','precios'], ARRAY['usuarios'], '1 año', 'Prompts sin datos personales, logs anonimizados', 'Anthropic (US)'),
  ('Marketing por email', 'Comunicaciones comerciales opt-in', 'consent', ARRAY['email','nombre'], ARRAY['usuarios','clientes'], 'Hasta revocación', 'Opt-in explícito, baja en cada envío', 'Resend (US)')
ON CONFLICT DO NOTHING;

-- 5. data_subject_requests — solicitudes de derechos ARCO+
CREATE TABLE IF NOT EXISTS data_subject_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  request_type TEXT NOT NULL,
  status TEXT DEFAULT 'received',
  description TEXT,
  response TEXT,
  received_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  handled_by UUID REFERENCES auth.users(id)
);

ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage data_subject_requests" ON data_subject_requests;
CREATE POLICY "Users manage data_subject_requests" ON data_subject_requests
  FOR ALL USING (handled_by = auth.uid());

-- 6. New columns on projects
DO $$ BEGIN
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'low';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
