import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Real Postgres/Supabase concurrency test for the advisory-lock race
 * between lock_account_for_deletion and begin_account_write_lease
 * (hallazgo 2 / v5.1). This cannot be simulated with a JS mock — a mock
 * would only prove the calling TypeScript handles two responses correctly,
 * not that pg_advisory_xact_lock actually serializes the two RPCs inside
 * Postgres. It is therefore SKIPPED — not asserted as passing — unless
 * explicitly opted into, since none of the migrations under
 * supabase/migrations/20260806_*.sql have been applied anywhere yet.
 *
 * To actually run this (pending, not done in this session):
 *   1. Apply supabase/migrations/20260806_01_align_agent_connections.sql,
 *      20260806_02_fix_price_bank_service_role_policies.sql,
 *      20260806_03_account_deletion_write_lock.sql and
 *      20260806_04_reconcile_supplier_invoiced.sql to a local/test
 *      Supabase project (e.g. via `supabase db push` against a throwaway
 *      project, never against production).
 *   2. RUN_ACCOUNT_LOCK_INTEGRATION_TESTS=1 \
 *      NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *      node --import tsx --test __tests__/account-deletion-lock.integration.test.mjs
 */

const shouldRun =
  process.env.RUN_ACCOUNT_LOCK_INTEGRATION_TESTS === "1" &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

test(
  "lock_account_for_deletion and begin_account_write_lease serialize via the shared advisory lock (PENDING — requires a real Postgres/Supabase instance with the migration applied)",
  async (t) => {
    if (!shouldRun) {
      t.skip(
        "Pendiente de ejecución: requiere aplicar supabase/migrations/20260806_03_account_deletion_write_lock.sql " +
          "(y las migraciones previas de esta serie) en una instancia Supabase real, y exportar " +
          "RUN_ACCOUNT_LOCK_INTEGRATION_TESTS=1, NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. " +
          "No se ha ejecutado ni verificado en este entorno — no se afirma que pase."
      );
      return;
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // Random test uuid — does not correspond to any real user.
    const testUserId = randomUUID();

    try {
      // Case A: the lease wins the race — acquired before the account is
      // locked, so lock_account_for_deletion must count it as active.
      const { data: leaseId, error: leaseError } = await admin.rpc(
        "begin_account_write_lease",
        { p_user_id: testUserId, p_ttl_seconds: 60 }
      );
      assert.equal(leaseError, null);
      assert.ok(leaseId);

      const { data: activeLeases, error: lockError } = await admin.rpc(
        "lock_account_for_deletion",
        { p_user_id: testUserId }
      );
      assert.equal(lockError, null);
      assert.equal(
        activeLeases,
        1,
        "lock_account_for_deletion debe contar el lease todavía activo para este usuario"
      );

      await admin.rpc("end_account_write_lease", { p_lease_id: leaseId });

      // Case B: the deletion lock already exists — a later
      // begin_account_write_lease for the SAME user must be rejected.
      const { error: begunAfterLockError } = await admin.rpc(
        "begin_account_write_lease",
        { p_user_id: testUserId, p_ttl_seconds: 60 }
      );
      assert.ok(
        begunAfterLockError,
        "begin_account_write_lease debe fallar una vez existe el tombstone de borrado"
      );
    } finally {
      // Best-effort cleanup of the throwaway test row.
      await admin.from("account_deletion_locks").delete().eq("user_id", testUserId);
    }
  }
);
