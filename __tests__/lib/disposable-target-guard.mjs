// Fail-closed checks that a functional test can only ever reach the disposable
// bench. The Vercel preview shares production's Supabase variables, so nothing
// here may trust configuration it did not verify itself.
import assert from "node:assert/strict";

export const REST_ORIGIN = "http://127.0.0.1:53002";

// A variable with one of these names means a real project is configured in
// this process. The bench never needs them, so their mere presence refuses.
export const FORBIDDEN_VARIABLES = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "DATABASE_URL", "POSTGRES_URL",
]);

// Any hosted Supabase address, whichever project it names.
const HOSTED = /supabase\.(co|com)\b|pooler\.supabase/i;

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

export function assertNoProductionEnvironment(env) {
  const present = FORBIDDEN_VARIABLES.filter((name) => env[name] !== undefined);
  assert.deepEqual(present, [], `Refusing to run with a real Supabase project configured: ${present.join(", ")}`);
  // Names only: a value is never echoed, even on failure.
  const leaking = Object.keys(env).filter((name) => HOSTED.test(String(env[name] ?? "")));
  assert.deepEqual(leaking, [], `Refusing to run: these variables point at a hosted Supabase: ${leaking.join(", ")}`);
}

export function assertDisposableRestTarget(value) {
  assert.equal(typeof value, "string", "E2_REST_URL is required");
  assert.doesNotMatch(value, HOSTED, "A hosted Supabase URL is never a disposable target");
  const url = new URL(value);
  assert.equal(url.protocol, "http:", "The disposable PostgREST speaks plain HTTP on loopback");
  assert.ok(isLoopback(url.hostname), `Not a loopback host: ${url.hostname}`);
  assert.equal(url.origin, REST_ORIGIN, "Only the bench's PostgREST port is allowed");
  return url.origin;
}

// Wraps fetch so that every single request is checked in flight, not just the
// configured base URL: a redirect, a rewritten path or a stray absolute URL
// would otherwise escape the check made at start-up.
export function guardedFetch(origin, { onRequest } = {}) {
  assertDisposableRestTarget(origin);
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    assert.equal(url.origin, origin, `Request left the disposable bench: ${url.origin}`);
    assert.ok(isLoopback(url.hostname), `Request to a non-loopback host: ${url.hostname}`);
    // Local PostgREST serves at the root; supabase-js prefixes /rest/v1.
    url.pathname = url.pathname.replace(/^\/rest\/v1/, "");
    onRequest?.(url);
    return fetch(url, { ...init, redirect: "error", signal: init?.signal ?? AbortSignal.timeout(5000) });
  };
}
