-- Drop the restrictive service_type check constraint on budgets.
--
-- The CHECK constraint rejects INSERTs from the budget wizard with:
--   'new row for relation "budgets" violates check constraint
--    "budgets_service_type_check"'
-- because the application uses free-form service types that vary by
-- sector (e.g. "reforma", "fontaneria", "electricidad", "construccion",
-- "comercio_local", "general"). Restricting them at the DB level causes
-- breakage whenever a new sector or service type is added.
--
-- This mirrors the approach taken in 20260418 for budgets_status_check.
-- Once canonical service types are stabilized, a follow-up migration
-- can re-add a CHECK with the final whitelist.

ALTER TABLE public.budgets
  DROP CONSTRAINT IF EXISTS budgets_service_type_check;

COMMENT ON COLUMN public.budgets.service_type IS
  'Free-form service type set by the budget wizard or manual form. '
  'Currently un-constrained because the app uses dynamic sector-based '
  'service types (reforma, fontaneria, electricidad, etc.). A CHECK '
  'constraint can be re-added once canonical values are stabilized.';

NOTIFY pgrst, 'reload schema';
