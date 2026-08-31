-- Add discount support and dynamic payment schedule to budgets
ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_schedule jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.budgets
  DROP CONSTRAINT IF EXISTS budgets_discount_type_check;
ALTER TABLE public.budgets
  ADD CONSTRAINT budgets_discount_type_check CHECK (discount_type IN ('percent', 'amount'));

-- Add IBAN to company fiscal settings (default source for budget payment_iban)
ALTER TABLE public.fiscal_settings
  ADD COLUMN IF NOT EXISTS iban text NOT NULL DEFAULT '';
