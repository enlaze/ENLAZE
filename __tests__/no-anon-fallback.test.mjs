import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// b2-sin-anon-fallback: a route that needs the service role fails with 500
// and a clear log line when SUPABASE_SERVICE_ROLE_KEY is missing. It never
// falls back to the public anon key, and no secret has a literal default.

const ROOTS = ["app", "lib", "components", "scripts"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      out.push(...sourceFiles(full));
    } else if (EXTENSIONS.has(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

const files = ROOTS.flatMap((root) => {
  try { return sourceFiles(root); } catch { return []; }
}).map((file) => ({ file, source: readFileSync(file, "utf8") }));

test("no file falls back from the service role key to the anon key", () => {
  const offenders = files
    .filter(({ source }) =>
      /SUPABASE_SERVICE_ROLE_KEY\s*(\|\||\?\?)/.test(source)
      || /serviceRoleKey\s*(\|\||\?\?)\s*process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY/.test(source))
    .map(({ file }) => file);
  assert.deepEqual(offenders, []);
});

test("no route builds a client from a non-null-asserted service role key", () => {
  const offenders = files
    .filter(({ file }) => file.startsWith("app/"))
    .filter(({ source }) => /SUPABASE_SERVICE_ROLE_KEY!/.test(source))
    .map(({ file }) => file);
  assert.deepEqual(offenders, []);
});

test("no secret-like env var has a literal default value", () => {
  const offenders = files
    .filter(({ source }) =>
      /process\.env\.[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*(\|\||\?\?)\s*(['"`])[^'"`\s]+\3/.test(source))
    .map(({ file }) => file);
  assert.deepEqual(offenders, []);
});

test("the routes that used to fall back now fail through serviceRoleUnavailable", () => {
  for (const file of [
    "app/api/agent/_lib/auth.ts",
    "app/api/agent/config/route.ts",
    "app/api/agent/news/route.ts",
    "app/api/agent/users/route.ts",
    "app/api/agent/ingest/route.ts",
    "app/api/webhooks/comercio-local/route.ts",
    "app/api/webhooks/construccion/route.ts",
    "app/api/pb/webhook/route.ts",
    "app/api/pb/ingest/route.ts",
    "app/api/pb/sync/run/route.ts",
    "app/api/invoices/ocr/route.ts",
    "app/api/prices/weekly-report/send/route.ts",
    "app/api/prices/process-alerts/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /getServiceRoleClient\(\)/, file);
    assert.match(source, /serviceRoleUnavailable\(/, file);
    assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_ANON_KEY!?\s*\)/, file);
  }
});

test("serviceRoleUnavailable answers 500 and logs which route is disabled", () => {
  const helper = readFileSync("lib/supabase-service-role.ts", "utf8");
  assert.match(helper, /console\.error\(`\[\$\{route\}\] falta SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(helper, /\{ status: 500 \}/);
});

test("shared-secret webhooks compare the bearer with requireBearer (constant time)", () => {
  for (const file of [
    "app/api/pb/webhook/route.ts",
    "app/api/webhooks/construccion/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /requireBearer\(request, "WEBHOOK_SECRET"/, file);
    assert.doesNotMatch(source, /authHeader !== `Bearer/, file);
    assert.doesNotMatch(source, /validTokens\.includes\(token\)/, file);
  }
});
