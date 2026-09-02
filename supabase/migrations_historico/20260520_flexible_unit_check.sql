-- Drop the old restrictive unit check and replace with a flexible one
-- that accepts all real construction units.

ALTER TABLE public.budget_items
  DROP CONSTRAINT IF EXISTS budget_items_unit_check;

ALTER TABLE public.budget_items
  ADD CONSTRAINT budget_items_unit_check
  CHECK (unit IS NULL OR lower(trim(unit)) IN (
    'm2', 'm²', 'ml', 'm3', 'm³',
    'ud', 'uds', 'pa',
    'h', 'jornada',
    'kg', 'l', 'lote',
    'punto', 'estancia',
    'sacos', 'rollos', 'cubos', 'kit',
    'global', 'partida',
    'm', 'tn', 'cm'
  ));

COMMENT ON CONSTRAINT budget_items_unit_check ON public.budget_items IS
  'Flexible unit whitelist covering standard construction units. '
  'Add new values here as sectors expand.';

NOTIFY pgrst, 'reload schema';
