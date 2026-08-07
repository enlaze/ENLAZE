import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Acquires a short-lived lease for a multi-step service_role operation
 * acting on behalf of a specific user (e.g. an OCR Storage upload). Races
 * lock_account_for_deletion for the same advisory-lock key server-side, so
 * exactly one of "the write starts first" or "the deletion starts first"
 * wins — never both. Throws if the account is locked for deletion.
 *
 * ttlSeconds must safely exceed the route's real maximum execution time
 * (see each call site's `maxDuration`) with margin: a lease that expires
 * mid-request stops protecting it.
 */
export async function beginAccountWriteLease(
  admin: SupabaseClient,
  userId: string,
  ttlSeconds = 180
): Promise<string> {
  const { data, error } = await admin.rpc("begin_account_write_lease", {
    p_user_id: userId,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Always call from a `finally` block so a crashed/throwing operation still releases its lease. */
export async function endAccountWriteLease(admin: SupabaseClient, leaseId: string) {
  const { error } = await admin.rpc("end_account_write_lease", { p_lease_id: leaseId });
  if (error) {
    console.error("[account-write-lease] no se pudo liberar el lease:", error);
  }
}
