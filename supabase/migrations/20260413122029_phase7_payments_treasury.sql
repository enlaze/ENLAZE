
-- ============================================================
-- Phase 7: Payments & Treasury System
-- ============================================================

-- 1. Extend payments table: link to invoices, make project_id optional
ALTER TABLE payments ALTER COLUMN project_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE payments ADD COLUMN invoice_id UUID REFERENCES issued_invoices(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE payments ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE payments ADD COLUMN type TEXT NOT NULL DEFAULT 'income' CHECK (type IN ('income', 'expense'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_date ON payments(user_id, payment_date DESC);

-- 2. Add amount_paid tracking to issued_invoices
DO $$ BEGIN
  ALTER TABLE issued_invoices ADD COLUMN amount_paid NUMERIC DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE issued_invoices ADD COLUMN invoice_date DATE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 3. Payment reminders table
CREATE TABLE IF NOT EXISTS payment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES issued_invoices(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('upcoming', 'due_today', 'overdue', 'custom')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'both')),
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminders_user_pending
  ON payment_reminders(user_id, scheduled_at)
  WHERE sent_at IS NULL;

ALTER TABLE payment_reminders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_reminders' AND policyname = 'Users manage own reminders') THEN
    CREATE POLICY "Users manage own reminders" ON payment_reminders
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 4. Treasury summary view (materialized-like, but as a function for flexibility)
-- This gives us: total income, total expenses, outstanding, overdue for a user
CREATE OR REPLACE FUNCTION get_treasury_summary(p_user_id UUID)
RETURNS TABLE(
  total_income NUMERIC,
  total_expenses NUMERIC,
  net_balance NUMERIC,
  total_invoiced NUMERIC,
  total_collected NUMERIC,
  outstanding NUMERIC,
  overdue_count BIGINT,
  overdue_amount NUMERIC
) LANGUAGE SQL STABLE AS $$
  SELECT
    COALESCE((SELECT SUM(amount) FROM payments WHERE user_id = p_user_id AND type = 'income' AND status = 'completed'), 0) AS total_income,
    COALESCE((SELECT SUM(amount) FROM payments WHERE user_id = p_user_id AND type = 'expense' AND status = 'completed'), 0) AS total_expenses,
    COALESCE((SELECT SUM(amount) FROM payments WHERE user_id = p_user_id AND type = 'income' AND status = 'completed'), 0)
    - COALESCE((SELECT SUM(amount) FROM payments WHERE user_id = p_user_id AND type = 'expense' AND status = 'completed'), 0) AS net_balance,
    COALESCE((SELECT SUM(total) FROM issued_invoices WHERE user_id = p_user_id AND status != 'cancelled'), 0) AS total_invoiced,
    COALESCE((SELECT SUM(amount_paid) FROM issued_invoices WHERE user_id = p_user_id AND status != 'cancelled'), 0) AS total_collected,
    COALESCE((SELECT SUM(total - COALESCE(amount_paid, 0)) FROM issued_invoices WHERE user_id = p_user_id AND status != 'cancelled' AND payment_status != 'paid'), 0) AS outstanding,
    (SELECT COUNT(*) FROM issued_invoices WHERE user_id = p_user_id AND status != 'cancelled' AND payment_status != 'paid' AND due_date < CURRENT_DATE) AS overdue_count,
    COALESCE((SELECT SUM(total - COALESCE(amount_paid, 0)) FROM issued_invoices WHERE user_id = p_user_id AND status != 'cancelled' AND payment_status != 'paid' AND due_date < CURRENT_DATE), 0) AS overdue_amount;
$$;
