import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { bearerMatchesToken } from "../lib/price-sync-auth.ts";

const root = process.cwd();
const routePath = "app/api/internal/anon-privileges-check/route.ts";
const migration = readFileSync(join(root,
  "supabase/migrations/20261005120000_anon_privileges_sentinel.sql"), "utf8");
const checks = readFileSync(join(root, "docs/fase2/CHECKS.sql"), "utf8");

test("la función ejecuta exactamente el SELECT canónico de CHECK_E5_CENTINELA", () => {
  const block = checks.match(/-- BEGIN CHECK_E5_CENTINELA\n([\s\S]*?)-- END CHECK_E5_CENTINELA/);
  const body = migration.match(/as \$sentinel\$\n([\s\S]*?)\n\$sentinel\$;/);
  assert.ok(block && body, "faltan el bloque canónico o el cuerpo de la función");
  assert.equal(body[1].trim(), block[1].trim());
  assert.match(migration, /security invoker/i);
  assert.match(migration, /revoke all on function public\.anon_privileges_sentinel\(\) from public, anon, authenticated;/i);
  assert.match(migration, /grant execute on function public\.anon_privileges_sentinel\(\) to service_role;/i);
});

test("el bearer del centinela tiene un solo uso y falla cerrado", () => {
  const tokens = ["e5-dedicado"];
  assert.equal(bearerMatchesToken("Bearer e5-dedicado", tokens), true);
  for (const header of ["", "Bearer ", "Bearer otro", "Bearer agent-api-key",
    "Bearer webhook-secret", "Bearer price-sync-token"]) {
    assert.equal(bearerMatchesToken(header, tokens), false, header);
  }
  assert.equal(bearerMatchesToken("Bearer e5-dedicado", [undefined]), false);

  const route = readFileSync(join(root, routePath), "utf8");
  assert.match(route, /\[process\.env\.ANON_PRIVILEGES_CHECK_TOKEN\]/);
  assert.doesNotMatch(route, /AGENT_API_KEY|WEBHOOK_SECRET|PRICE_SYNC_TOKEN/);
  assert.match(route, /\.rpc\("anon_privileges_sentinel"\)/);
  assert.match(route, /status: 401/);
});

test("ninguna otra ruta API acepta ANON_PRIVILEGES_CHECK_TOKEN", () => {
  const offenders = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name === "route.ts") {
        const repoPath = relative(root, path);
        if (repoPath !== routePath
            && readFileSync(path, "utf8").includes("ANON_PRIVILEGES_CHECK_TOKEN")) {
          offenders.push(repoPath);
        }
      }
    }
  }
  visit(join(root, "app/api"));
  assert.deepEqual(offenders, []);
});

test("workflow y ejemplo de entorno mantienen el secreto dedicado", () => {
  const workflow = readFileSync(join(root, ".github/workflows/anon-privileges-check.yml"), "utf8");
  const example = readFileSync(join(root, ".env.example"), "utf8");
  assert.match(workflow, /cron: "23 \*\/6 \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /secrets\.ANON_PRIVILEGES_CHECK_TOKEN/);
  assert.match(workflow, /https:\/\/enlaze\.vercel\.app\/api\/internal\/anon-privileges-check/);
  assert.doesNotMatch(workflow, /api\.supabase\.com|SUPABASE_ACCESS_TOKEN/);
  assert.match(example, /^ANON_PRIVILEGES_CHECK_TOKEN=$/m);
});
