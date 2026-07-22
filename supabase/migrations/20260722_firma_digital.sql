-- ============================================================
-- Firma Digital: firma en pantalla + verificación OTP
-- ============================================================

-- 1) Firmas digitales
CREATE TABLE IF NOT EXISTS digital_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,                    -- propietario del documento

  -- Documento firmado
  entity_type TEXT NOT NULL,                -- budget, certification, work_report, project_act
  entity_id UUID NOT NULL,

  -- Datos del firmante
  signer_name TEXT NOT NULL,
  signer_email TEXT DEFAULT '',
  signer_phone TEXT DEFAULT '',
  signer_nif TEXT DEFAULT '',
  signer_role TEXT DEFAULT 'cliente',       -- cliente, encargado, director_obra, propiedad

  -- Firma visual
  signature_image TEXT DEFAULT '',          -- base64 PNG de la firma dibujada

  -- Verificación OTP
  otp_verified BOOLEAN DEFAULT FALSE,
  otp_verified_at TIMESTAMPTZ,
  otp_method TEXT DEFAULT 'email',          -- email, sms

  -- Metadatos legales
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  geolocation TEXT DEFAULT '',

  -- Estado
  status TEXT DEFAULT 'pending',            -- pending, signed, revoked
  signed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT DEFAULT '',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Códigos OTP temporales
CREATE TABLE IF NOT EXISTS signature_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_id UUID NOT NULL REFERENCES digital_signatures(id) ON DELETE CASCADE,
  code TEXT NOT NULL,                       -- 6 dígitos
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMPTZ,
  attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3) Actas de obra (nuevo tipo de documento firmable)
CREATE TABLE IF NOT EXISTS project_acts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  act_type TEXT NOT NULL DEFAULT 'inicio',  -- inicio, replanteo, recepcion, fin, incidencia
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  act_date DATE DEFAULT CURRENT_DATE,
  attendees TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',              -- draft, pending_signature, signed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_signatures_entity ON digital_signatures(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_signatures_user ON digital_signatures(user_id);
CREATE INDEX IF NOT EXISTS idx_signatures_status ON digital_signatures(status);
CREATE INDEX IF NOT EXISTS idx_signature_otps_signature ON signature_otps(signature_id);
CREATE INDEX IF NOT EXISTS idx_project_acts_project ON project_acts(project_id);

-- RLS
ALTER TABLE digital_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_acts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'signatures_user_all') THEN
    CREATE POLICY signatures_user_all ON digital_signatures FOR ALL
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sig_otps_user_all') THEN
    CREATE POLICY sig_otps_user_all ON signature_otps FOR ALL
      USING (
        signature_id IN (SELECT id FROM digital_signatures WHERE user_id = auth.uid())
      ) WITH CHECK (
        signature_id IN (SELECT id FROM digital_signatures WHERE user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'acts_user_all') THEN
    CREATE POLICY acts_user_all ON project_acts FOR ALL
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
