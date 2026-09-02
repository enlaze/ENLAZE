-- ============================================================
-- Gestor de Obras: Capítulos, Partidas, Avance y Documentos
-- ============================================================

-- 1) Capítulos del presupuesto de obra
CREATE TABLE IF NOT EXISTS project_chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  code TEXT DEFAULT '',            -- C01, C02...
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Partidas dentro de cada capítulo
CREATE TABLE IF NOT EXISTS project_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES project_chapters(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  code TEXT DEFAULT '',            -- 01.01, 01.02...
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  unit TEXT DEFAULT 'ud',          -- ud, m2, m3, ml, kg, h, pa, %
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Avance / ejecución
  executed_qty NUMERIC(12,3) DEFAULT 0,
  progress_pct INT DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3) Certificaciones mensuales
CREATE TABLE IF NOT EXISTS project_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  cert_number INT NOT NULL DEFAULT 1,
  period TEXT NOT NULL DEFAULT '',   -- "2026-07", "Julio 2026"
  cert_date DATE DEFAULT CURRENT_DATE,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',       -- draft, sent, approved, paid
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4) Líneas de cada certificación (snapshot de avance por partida)
CREATE TABLE IF NOT EXISTS project_certification_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL REFERENCES project_certifications(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES project_items(id) ON DELETE CASCADE,
  prev_qty NUMERIC(12,3) DEFAULT 0,      -- cantidad certificada anteriormente
  current_qty NUMERIC(12,3) DEFAULT 0,    -- cantidad certificada este periodo
  unit_price NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5) Documentos y fotos de obra
CREATE TABLE IF NOT EXISTS project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  doc_type TEXT DEFAULT 'documento',  -- documento, foto, plano, acta, parte, contrato, licencia
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  file_url TEXT NOT NULL,
  file_size INT DEFAULT 0,
  mime_type TEXT DEFAULT '',
  chapter_id UUID REFERENCES project_chapters(id) ON DELETE SET NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_project_chapters_project ON project_chapters(project_id);
CREATE INDEX IF NOT EXISTS idx_project_items_chapter ON project_items(chapter_id);
CREATE INDEX IF NOT EXISTS idx_project_items_project ON project_items(project_id);
CREATE INDEX IF NOT EXISTS idx_project_certifications_project ON project_certifications(project_id);
CREATE INDEX IF NOT EXISTS idx_project_cert_lines_cert ON project_certification_lines(certification_id);
CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_project_documents_type ON project_documents(doc_type);

-- RLS
ALTER TABLE project_chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_certification_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chapters_user_all') THEN
    CREATE POLICY chapters_user_all ON project_chapters FOR ALL
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'items_user_all') THEN
    CREATE POLICY items_user_all ON project_items FOR ALL
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'certifications_user_all') THEN
    CREATE POLICY certifications_user_all ON project_certifications FOR ALL
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'cert_lines_user_all') THEN
    CREATE POLICY cert_lines_user_all ON project_certification_lines FOR ALL
      USING (
        certification_id IN (SELECT id FROM project_certifications WHERE user_id = auth.uid())
      ) WITH CHECK (
        certification_id IN (SELECT id FROM project_certifications WHERE user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'documents_user_all') THEN
    CREATE POLICY documents_user_all ON project_documents FOR ALL
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
