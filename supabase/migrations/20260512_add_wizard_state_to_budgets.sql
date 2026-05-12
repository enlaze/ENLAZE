-- Add wizard_state column to budgets to store UI draft state
-- The 'status' column is already unconstrained, so 'borrador' is allowed.

ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS wizard_state JSONB;

COMMENT ON COLUMN public.budgets.wizard_state IS 'Stores the raw React state of the budget generator wizard for drafts.';
