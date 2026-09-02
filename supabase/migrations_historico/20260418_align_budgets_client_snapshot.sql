-- Aligns the `budgets` table client snapshot with `issued_invoices`.
--
-- Background:
--   The "new budget" and "generate budget" pages INSERT a denormalized
--   snapshot of the client (name / email / phone / address / NIF). This
--   snapshot is what the rendered budget PDF shows under the "To:" block,
--   so it must survive even if the linked `clients` row is later edited
--   or deleted.
--
--   In production the `budgets` table was missing the entire snapshot
--   group, surfacing as "Could not find the 'X' column of 'budgets' in
--   the schema cache" errors one column at a time. The previous migration
--   (20260417_add_client_email_to_budgets.sql) only added `client_email`.
--   This migration fills the rest of the snapshot in a single atomic
--   change so the schema matches the existing application code and the
--   `issued_invoices` table.
--
-- Idempotency:
--   Every column uses `add column if not exists`, so this migration is
--   safe to re-run, and is also safe even if the previous `client_email`
--   migration was already applied.

alter table public.budgets
  add column if not exists client_name    text,
  add column if not exists client_email   text,
  add column if not exists client_phone   text,
  add column if not exists client_address text,
  add column if not exists client_nif     text;

-- Document the intent of each column (overwrites previous comments).
comment on column public.budgets.client_name is
  'Snapshot of the client''s legal/display name at budget creation time. '
  'Kept for historical / legal accuracy of the generated document.';
comment on column public.budgets.client_email is
  'Snapshot of the client''s email at budget creation time.';
comment on column public.budgets.client_phone is
  'Snapshot of the client''s phone at budget creation time.';
comment on column public.budgets.client_address is
  'Snapshot of the client''s postal address at budget creation time.';
comment on column public.budgets.client_nif is
  'Snapshot of the client''s NIF / tax ID at budget creation time. '
  'Mirrors `issued_invoices.client_nif` so future versions of the budget '
  'form can include it without another schema change.';

-- Tell PostgREST / Supabase to reload its schema cache immediately so the
-- new columns are visible to the REST API without waiting for the next
-- automatic refresh.
notify pgrst, 'reload schema';
