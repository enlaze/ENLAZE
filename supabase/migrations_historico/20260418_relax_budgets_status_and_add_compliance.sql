-- Removes the restrictive `budgets_status_check` constraint and adds
-- the remaining "Compliance Phase 2" columns the application code
-- already references on `public.budgets`.
--
-- Background — status constraint:
--   The CHECK constraint was rejecting INSERTs with the error
--     'new row for relation "budgets" violates check constraint
--      "budgets_status_check"'
--   because the application uses a *mix* of values, currently:
--     • Spanish (write path): pendiente, enviado, aceptado, rechazado
--         - app/dashboard/budgets/new/page.tsx           (INSERT "pendiente")
--         - app/dashboard/budgets/generate/page.tsx      (INSERT "pendiente")
--         - app/dashboard/budgets/[id]/page.tsx          (INSERT/UPDATE)
--     • English (read & list-page write path): pending, sent, accepted, rejected
--         - app/dashboard/budgets/page.tsx               (UPDATE buttons)
--         - app/portal/[token]/page.tsx                  (UPDATE accepted/rejected)
--         - app/api/search/route.ts                      (SELECT, no constraint)
--   Re-introducing a CHECK with a permissive whitelist would just kick
--   the can down the road: every future state addition or rename would
--   need a fresh migration. Normalizing the values is code work, not
--   schema work, so this migration deliberately leaves the column
--   constraint-free for now. When the application has been normalized
--   to a single canonical set of statuses, a follow-up migration can
--   re-add a CHECK with that set.
--
-- Background — compliance columns:
--   `app/dashboard/budgets/[id]/page.tsx` declares (and reads via
--   `select("*")`) four columns marked "Compliance Phase 2":
--       version, sent_at, accepted_by_name, accepted_ip
--   `sent_at` is also written when transitioning status to "enviado".
--   Without these columns the next budget save / status transition
--   would surface the same "column not found" loop we just closed.
--
-- Idempotency:
--   * The constraint drop uses `IF EXISTS` so it's safe whether or not
--     the constraint is present (Supabase projects created at different
--     times may or may not have it).
--   * Each new column uses `ADD COLUMN IF NOT EXISTS`.

-- ---------------------------------------------------------------------
-- 1. Drop the restrictive status check.
-- ---------------------------------------------------------------------
alter table public.budgets
  drop constraint if exists budgets_status_check;

-- ---------------------------------------------------------------------
-- 2. Add the remaining compliance / lifecycle columns the code uses.
-- ---------------------------------------------------------------------
alter table public.budgets
  add column if not exists sent_at          timestamptz,
  add column if not exists accepted_by_name text,
  add column if not exists accepted_ip      text,
  add column if not exists version          integer default 1;

-- ---------------------------------------------------------------------
-- 3. Document the columns + the deliberate lack of CHECK on `status`.
-- ---------------------------------------------------------------------
comment on column public.budgets.status is
  'Lifecycle state. Currently un-constrained because the app mixes '
  'Spanish (pendiente/enviado/aceptado/rechazado) and English (pending/'
  'sent/accepted/rejected) values across pages. Once the codebase is '
  'normalized to a single canonical set, a follow-up migration should '
  're-introduce a CHECK constraint with that set.';
comment on column public.budgets.sent_at is
  'Timestamp of the budget being marked as sent (set when status '
  'transitions to enviado/sent). Read by the AcceptanceTimeline.';
comment on column public.budgets.accepted_by_name is
  'Name typed by the client when accepting the budget through the '
  'portal. Part of the Phase 2 compliance / audit trail.';
comment on column public.budgets.accepted_ip is
  'IP address recorded at portal acceptance time. Part of the Phase 2 '
  'compliance / audit trail.';
comment on column public.budgets.version is
  'Monotonic version of the budget content. Bumped when a new revision '
  'is generated so older signed/accepted versions remain identifiable.';

-- ---------------------------------------------------------------------
-- 4. Tell PostgREST to refresh its schema cache so the dropped
--    constraint and new columns become visible to the REST API
--    immediately.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
