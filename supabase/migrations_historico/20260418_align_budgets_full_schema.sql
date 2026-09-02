-- One-shot migration that fully aligns the `budgets` table with the
-- application code. After this runs, every INSERT / UPDATE / SELECT
-- that the current codebase performs on `public.budgets` must succeed
-- without "column not found" errors from PostgREST's schema cache.
--
-- Background:
--   We had a recurring schema-drift problem: each save of a budget
--   surfaced a new missing column (client_email → client_name → ... →
--   iva_percent). Earlier migrations patched columns one at a time.
--   This migration ends that loop by adding *every* column the code
--   currently references in a single idempotent statement.
--
-- Source of truth (audited 2026-04-18):
--   - app/dashboard/budgets/new/page.tsx           (INSERT)
--   - app/dashboard/budgets/generate/page.tsx      (INSERT)
--   - app/dashboard/budgets/[id]/page.tsx          (SELECT *, UPDATE,
--                                                   INSERT for "duplicar")
--   - app/dashboard/budgets/page.tsx               (SELECT *, UPDATE)
--   - app/dashboard/projects/[id]/page.tsx         (SELECT, UPDATE viewed_at)
--   - app/portal/[token]/page.tsx                  (SELECT)
--   - app/api/search/route.ts                      (SELECT)
--
-- Idempotency:
--   Every column uses `add column if not exists`, so this migration is
--   safe to re-run and is also safe even if any of the previous
--   budgets-related migrations (20260417_add_client_email_to_budgets,
--   20260418_align_budgets_client_snapshot) already applied a subset.
--
--   Foreign-key constraints on user_id / client_id / project_id are
--   intentionally NOT added here: if the table already had them they
--   are preserved by `add column if not exists` (it's a no-op for an
--   existing column), and adding them on a freshly-added column would
--   fail under partial-state scenarios. Constraint hygiene belongs in
--   its own migration.

alter table public.budgets
  -- Ownership / relations -------------------------------------------------
  add column if not exists user_id        uuid,
  add column if not exists client_id      uuid,
  add column if not exists project_id     uuid,

  -- Identity --------------------------------------------------------------
  add column if not exists budget_number  text,
  add column if not exists title          text,

  -- Client snapshot (denormalized — survives client edits/deletes) -------
  add column if not exists client_name    text,
  add column if not exists client_email   text,
  add column if not exists client_phone   text,
  add column if not exists client_address text,
  add column if not exists client_nif     text,

  -- Classification --------------------------------------------------------
  add column if not exists service_type   text,
  add column if not exists status         text,

  -- Financials ------------------------------------------------------------
  add column if not exists subtotal       numeric(12,2) default 0,
  add column if not exists iva_percent    numeric(5,2)  default 21,
  add column if not exists iva_amount     numeric(12,2) default 0,
  add column if not exists total          numeric(12,2) default 0,

  -- Free-form -------------------------------------------------------------
  add column if not exists notes          text,

  -- Lifecycle / timestamps ------------------------------------------------
  add column if not exists valid_until    date,
  add column if not exists created_at     timestamptz   default now(),
  add column if not exists updated_at     timestamptz   default now(),
  add column if not exists viewed_at      timestamptz,
  add column if not exists accepted_at    timestamptz,
  add column if not exists rejected_at    timestamptz;

-- Documentation for the columns whose semantics aren't obvious from the
-- name alone. (Snapshot columns are already documented by the
-- 20260418_align_budgets_client_snapshot migration; we don't repeat them.)
comment on column public.budgets.iva_percent is
  'VAT rate applied to this budget, in whole percentage points '
  '(e.g. 21 means 21%). Stored alongside `iva_amount` so historical '
  'budgets keep the rate that was in force when they were issued.';
comment on column public.budgets.iva_amount is
  'VAT amount in EUR computed from subtotal * iva_percent / 100 at '
  'creation time. Persisted (not derived on read) so the rendered '
  'PDF / portal view always matches what the customer originally saw.';
comment on column public.budgets.subtotal is
  'Sum of all budget_items.subtotal in EUR, before VAT.';
comment on column public.budgets.total is
  'Final amount in EUR (subtotal + iva_amount). Persisted for the '
  'same historical-fidelity reason as iva_amount.';
comment on column public.budgets.status is
  'Lifecycle state. Values used by the app are a mix of Spanish '
  '(pendiente/aceptado/rechazado) and English (pending/sent/accepted/'
  'rejected). The column is plain text on purpose so that ongoing '
  'normalization work can happen without further schema migrations.';
comment on column public.budgets.viewed_at is
  'Timestamp of the first time the linked client opened the budget '
  'in the portal. Set by app/dashboard/projects/[id]/page.tsx and '
  'app/portal/[token]/page.tsx.';
comment on column public.budgets.accepted_at is
  'Timestamp of the budget being marked as accepted (set when status '
  'transitions to accepted/aceptado).';
comment on column public.budgets.rejected_at is
  'Timestamp of the budget being marked as rejected (set when status '
  'transitions to rejected/rechazado).';

-- Tell PostgREST / Supabase to reload its schema cache immediately so
-- the new columns become visible to the REST API without waiting for
-- the next automatic refresh.
notify pgrst, 'reload schema';
