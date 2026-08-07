import crypto from "crypto";

/**
 * Must match the hashing done by create_digital_signature_locked in
 * supabase/migrations/20260806_03_account_deletion_write_lock.sql (md5,
 * not sha256/pgcrypto, so it doesn't depend on which schema pgcrypto is
 * installed into). The token itself is 256 bits of randomness from two
 * gen_random_uuid() calls, so md5's preimage resistance is more than
 * enough here — this isn't hashing a low-entropy secret.
 */
export function hashSignatureToken(token: string): string {
  return crypto.createHash("md5").update(token).digest("hex");
}
