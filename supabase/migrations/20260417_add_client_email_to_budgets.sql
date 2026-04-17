-- Adds the missing `client_email` snapshot column to `budgets`.
--
-- Why:
--   The `budgets` table already stores denormalized client data
--   (`client_name`, `client_phone`, `client_address`) so a budget keeps its
--   historical "To:" block even if the linked `clients` row is later edited
--   or deleted. `client_email` was the only field missing from that snapshot,
--   which broke `INSERT` statements coming from the "new budget" and
--   "generate budget" pages.
--
-- Related tables:
--   `issued_invoices` already has `client_email` (text) and follows the same
--   denormalization pattern. This migration realigns `budgets` with it.
--
-- Safe to re-run: uses IF NOT EXISTS.

alter table public.budgets
  add column if not exists client_email text;

comment on column public.budgets.client_email is
  'Snapshot of the client''s email at the time the budget was created. '
  'Kept for historical / legal accuracy of the generated document.';

-- Ask PostgREST / Supabase to reload the schema cache so the new column is
-- visible to the API immediately (no need to wait for the next cache refresh).
notify pgrst, 'reload schema';
