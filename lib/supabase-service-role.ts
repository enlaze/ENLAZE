import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Lazily creates (and caches) the service-role Supabase client. Env vars are
 * only read and validated when a request actually calls this — never at
 * module-evaluation time. A module-level `createClient(url, key!)` throws
 * during Next.js's build-time "collect page data" step in any environment
 * missing SUPABASE_SERVICE_ROLE_KEY (e.g. local dev without that secret),
 * failing the whole build even though the route works fine at runtime
 * wherever the secret is actually configured.
 *
 * Returns null when the config is missing, instead of throwing, so callers
 * decide how to fail (log + 503) without ever needing to touch the actual
 * key value.
 */
export function getServiceRoleClient(): SupabaseClient | null {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
