-- Add service_type and start_date to public.projects.
--
-- These two columns were added by hand in the Supabase SQL Editor while
-- debugging the budget wizard and were never captured in a migration, so a
-- fresh clone of the database (a teammate's, or CI) lacks them. The budget
-- wizard's "Crear obra" flow inserts both columns, so their absence makes
-- the insert fail:
--   'Could not find the 'service_type' column of 'projects' in the schema cache'
--
-- See app/dashboard/budgets/generate/_components/steps/ScopeStep.tsx
-- (handleCreateProject), which inserts:
--   { name, client_id, user_id, service_type, start_date }
--
-- Both columns are intentionally nullable and un-constrained: service_type is
-- free-form and varies by sector, mirroring the reasoning in
-- 20260519_drop_service_type_check.sql for budgets.service_type.
--
-- Idempotent: safe to re-run, and safe on a database where the columns were
-- already created by hand.

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS service_type text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS start_date date;

COMMENT ON COLUMN public.projects.service_type IS
  'Free-form service type set by the budget wizard (reforma, fontaneria, '
  'electricidad, comercio_local, general, ...). Un-constrained on purpose; '
  'see 20260519_drop_service_type_check.sql.';

COMMENT ON COLUMN public.projects.start_date IS
  'Optional project start date captured by the budget wizard. Nullable.';

NOTIFY pgrst, 'reload schema';
