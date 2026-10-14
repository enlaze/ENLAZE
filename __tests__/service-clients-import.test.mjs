import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MODULES = [
  "lib/notification-service.ts",
  "app/api/signatures/send-otp/route.ts",
  "app/api/agent/budgets/generate/route.ts",
  "app/api/agent/market/analysis/route.ts",
  "app/api/invoices/ocr/route.ts",
];
for (const target of [...MODULES, "getters"]) {
  test(`service clients: ${target}`, () => {
    const env = Object.fromEntries(["PATH", "HOME", "TMPDIR"].filter(key => process.env[key] !== undefined)
      .map(key => [key, process.env[key]]));
    const mutantRoot = process.env.SERVICE_CLIENT_MUTANT_ROOT;
    if (mutantRoot) assert.ok(resolve(mutantRoot).startsWith(join(ROOT, ".test-out", "service-client-mutants") + "/"));
    const modulePath = mutantRoot && target !== "getters" && existsSync(join(mutantRoot, target))
      ? join(mutantRoot, target) : target;
    const result = spawnSync(process.execPath, ["--conditions=react-server", "--experimental-test-module-mocks",
      "--import", "tsx", "__tests__/support/service-clients-import-probe.mjs", modulePath],
    { cwd: ROOT, env, encoding: "utf8", timeout: 30000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
}
