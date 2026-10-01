import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { bearerMatchesToken } from "../lib/price-sync-auth.ts";

const syncTokens = ["price-sync-only", "webhook-secret", "agent-api-key"];

test("the dedicated PRICE_SYNC_TOKEN authorizes only the price sync bearer path", () => {
  assert.equal(bearerMatchesToken("Bearer price-sync-only", syncTokens), true);
  assert.equal(bearerMatchesToken("bearer price-sync-only", syncTokens), true);
});

test("an unknown bearer matches none of the three credentials and stays unauthorized", () => {
  assert.equal(bearerMatchesToken("Bearer wrong-token", syncTokens), false);
  assert.equal(bearerMatchesToken("", syncTokens), false);
  assert.equal(bearerMatchesToken("Bearer ", syncTokens), false);
});

test("PRICE_SYNC_TOKEN is not accepted by any other API route", async () => {
  const apiRoot = join(process.cwd(), "app", "api");
  const allowedRoute = "app/api/pb/sync/run/route.ts";
  const offenders = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.name === "route.ts") {
        const repoPath = relative(process.cwd(), path);
        const source = await readFile(path, "utf8");
        if (repoPath !== allowedRoute && source.includes("PRICE_SYNC_TOKEN")) {
          offenders.push(repoPath);
        }
      }
    }
  }

  await visit(apiRoot);
  assert.deepEqual(offenders, []);

  const syncRoute = await readFile(join(process.cwd(), allowedRoute), "utf8");
  assert.match(syncRoute, /process\.env\.PRICE_SYNC_TOKEN/);
  assert.match(syncRoute, /error: "No autorizado"[\s\S]*status: 401/);
});

test("the sync route and workflow carry a bounded resume cursor until completion", async () => {
  const route = await readFile(join(process.cwd(), "app/api/pb/sync/run/route.ts"), "utf8");
  const workflow = await readFile(
    join(process.cwd(), ".github/workflows/price-bank-sync.yml"),
    "utf8",
  );

  assert.match(route, /body\.resume_after_id/);
  assert.match(route, /body\.time_budget_ms/);
  assert.match(workflow, /while true/);
  assert.match(workflow, /time_budget_ms: 240000/);
  assert.match(workflow, /body\.resume_after_id = process\.env\.RESUME_AFTER_ID/);
  assert.match(workflow, /\["partial", "completed"\]/);
  assert.match(workflow, /Partial price sync did not advance resume_after_id/);
});
