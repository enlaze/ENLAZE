
-- Tabla de cambios / extras de obra
CREATE TABLE public.project_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  title text NOT NULL,
  description text DEFAULT '',
  economic_impact numeric NOT NULL DEFAULT 0,
  time_impact_days integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected', 'executed')),
  client_approved boolean NOT NULL DEFAULT false,
  approved_date date,
  notes text DEFAULT '',
  image_urls text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project changes"
  ON public.project_changes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own project changes"
  ON public.project_changes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own project changes"
  ON public.project_changes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own project changes"
  ON public.project_changes FOR DELETE
  USING (auth.uid() = user_id);
