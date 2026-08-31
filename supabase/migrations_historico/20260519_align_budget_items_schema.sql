-- Align budget_items table with all columns the application code uses.
--
-- The app writes to budget_items from three places:
--   - app/dashboard/budgets/new/page.tsx           (INSERT per partida)
--   - app/dashboard/budgets/[id]/page.tsx          (INSERT on duplicate)
--   - app/dashboard/budgets/generate/BudgetGenerateProvider.tsx (batch INSERT)
--
-- All three use the same columns:
--   budget_id, concept, description, quantity, unit, category, unit_price, subtotal
--
-- This migration ensures all required columns exist regardless of the
-- table's original schema. Uses ADD COLUMN IF NOT EXISTS for idempotency.

-- Create the table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS public.budget_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   uuid REFERENCES public.budgets(id) ON DELETE CASCADE,
  concept     text,
  description text,
  quantity    numeric(12,2) DEFAULT 1,
  unit        text DEFAULT 'ud',
  category    text,
  unit_price  numeric(12,2) DEFAULT 0,
  subtotal    numeric(12,2) DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- If the table already exists, add any missing columns
ALTER TABLE public.budget_items
  ADD COLUMN IF NOT EXISTS budget_id   uuid,
  ADD COLUMN IF NOT EXISTS concept     text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS quantity    numeric(12,2) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit        text DEFAULT 'ud',
  ADD COLUMN IF NOT EXISTS category    text,
  ADD COLUMN IF NOT EXISTS unit_price  numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal    numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz DEFAULT now();

-- Enable RLS (match the pattern used by other tables)
ALTER TABLE public.budget_items ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to manage their own budget items
-- (through the budget ownership chain)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'budget_items' AND policyname = 'budget_items_user_policy'
  ) THEN
    CREATE POLICY budget_items_user_policy ON public.budget_items
      FOR ALL
      USING (
        budget_id IN (SELECT id FROM public.budgets WHERE user_id = auth.uid())
      )
      WITH CHECK (
        budget_id IN (SELECT id FROM public.budgets WHERE user_id = auth.uid())
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
