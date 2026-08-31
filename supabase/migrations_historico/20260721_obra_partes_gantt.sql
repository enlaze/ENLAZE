-- ============================================================
-- Partes de trabajo diarios + Planificación Gantt
-- ============================================================

-- 1) Partes de trabajo (daily work reports)
CREATE TABLE IF NOT EXISTS work_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  weather TEXT DEFAULT 'soleado', -- soleado, nublado, lluvia, frio, viento
  general_notes TEXT DEFAULT '',
  incidents TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, report_date)
);

-- Trabajadores en cada parte
CREATE TABLE IF NOT EXISTS work_report_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_report_id UUID NOT NULL REFERENCES work_reports(id) ON DELETE CASCADE,
  worker_name TEXT NOT NULL,
  trade TEXT DEFAULT '', -- albanil, fontanero, electricista, pintor, etc.
  hours NUMERIC(5,2) NOT NULL DEFAULT 8,
  hourly_rate NUMERIC(8,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Materiales usados cada dia
CREATE TABLE IF NOT EXISTS work_report_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_report_id UUID NOT NULL REFERENCES work_reports(id) ON DELETE CASCADE,
  material_name TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'ud', -- ud, m2, m3, ml, kg, l, saco, palet
  unit_cost NUMERIC(10,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fotos del parte
CREATE TABLE IF NOT EXISTS work_report_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_report_id UUID NOT NULL REFERENCES work_reports(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Planificacion Gantt - Fases y Tareas
CREATE TABLE IF NOT EXISTS project_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#22c55e', -- hex color for gantt bar
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id UUID REFERENCES project_phases(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  assigned_to TEXT DEFAULT '', -- nombre del responsable
  start_date DATE,
  end_date DATE,
  progress INT DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  depends_on UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending', -- pending, in_progress, completed, cancelled
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_work_reports_project ON work_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_work_reports_date ON work_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_work_report_workers_report ON work_report_workers(work_report_id);
CREATE INDEX IF NOT EXISTS idx_work_report_materials_report ON work_report_materials(work_report_id);
CREATE INDEX IF NOT EXISTS idx_project_phases_project ON project_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_phase ON project_tasks(phase_id);

-- RLS
ALTER TABLE work_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_report_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_report_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_report_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;

-- Policies (user can manage their own)
DO $$ BEGIN
  -- work_reports
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'work_reports_user_all') THEN
    CREATE POLICY work_reports_user_all ON work_reports FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
  -- work_report_workers
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'wrw_user_all') THEN
    CREATE POLICY wrw_user_all ON work_report_workers FOR ALL USING (
      work_report_id IN (SELECT id FROM work_reports WHERE user_id = auth.uid())
    ) WITH CHECK (
      work_report_id IN (SELECT id FROM work_reports WHERE user_id = auth.uid())
    );
  END IF;
  -- work_report_materials
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'wrm_user_all') THEN
    CREATE POLICY wrm_user_all ON work_report_materials FOR ALL USING (
      work_report_id IN (SELECT id FROM work_reports WHERE user_id = auth.uid())
    ) WITH CHECK (
      work_report_id IN (SELECT id FROM work_reports WHERE user_id = auth.uid())
    );
  END IF;
  -- work_report_photos
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'wrp_user_all') THEN
    CREATE POLICY wrp_user_all ON work_report_photos FOR ALL USING (
      work_report_id IN (SELECT id FROM work_reports WHERE user_id = auth.uid())
    ) WITH CHECK (
      work_report_id IN (SELECT id FROM work_reports WHERE user_id = auth.uid())
    );
  END IF;
  -- project_phases
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'phases_user_all') THEN
    CREATE POLICY phases_user_all ON project_phases FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
  -- project_tasks
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tasks_user_all') THEN
    CREATE POLICY tasks_user_all ON project_tasks FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
