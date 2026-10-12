// Mutate throwaway copies, never the checked-out application or a hosted DB.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertNoProductionEnvironment } from "../__tests__/lib/disposable-target-guard.mjs";
assertNoProductionEnvironment(process.env);
const ROOT = new URL("../", import.meta.url);
const OUT = new URL(".test-out/billing-grace-mutants/", ROOT);
const LOGS = new URL("informes/evidencias/billing-payment-grace/", ROOT);
const webhookPath = "lib/billing-webhook.ts";
const migrationPath = "supabase/migrations/20261012170000_billing_payment_grace.sql";
const webhook = await readFile(new URL(webhookPath, ROOT), "utf8");
const sql = await readFile(new URL(migrationPath, ROOT), "utf8");
const first = "first failure opens exactly five days; five retries never move the deadline";
const boundary = "boundary: full minus 1ms, read_only at equality and plus 1ms";
const mutants = [
  ["retry-extends-deadline", migrationPath,
    "  if new.status = 'past_due' and old.past_due_grace_ends_at is not null then\n    new.past_due_grace_ends_at := old.past_due_grace_ends_at;\n  end if;\n", "", first],
  ["no-opening-grace", webhookPath,
    "          past_due_grace_ends_at: new Date((deps.now ?? Date.now)() + BILLING_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString(),\n", "", first],
  ["inclusive-boundary", migrationPath,
    "s.past_due_grace_ends_at > now()", "s.past_due_grace_ends_at >= now()", boundary],
  ["early-boundary", migrationPath,
    "s.past_due_grace_ends_at > now()", "s.past_due_grace_ends_at > now() + interval '1 millisecond'", boundary],
  ["no-recovery-reset", webhookPath,
    '  if (status === "active" || status === "canceled") patch.past_due_grace_ends_at = null;\n', "",
    "active recovery clears deadline and restores full access"],
  ["deleted-keeps-access", webhookPath,
    '{ status: "canceled", cancel_at_period_end: false, stripe_subscription_id: sub.id, past_due_grace_ends_at: null }',
    '{ status: "active", cancel_at_period_end: false, stripe_subscription_id: sub.id, past_due_grace_ends_at: null }',
    "deleted subscription cuts immediately even inside grace"],
  ["null-grants-access", migrationPath,
    "s.past_due_grace_ends_at > now()", "(s.past_due_grace_ends_at is null or s.past_due_grace_ends_at > now())",
    "legacy past_due with NULL has no grace and remains read_only"],
];
const run = name => spawnSync(process.execPath,
  ["--conditions=react-server", "--import", "tsx", "--test", "--test-reporter=tap", "__tests__/billing-grace.integration.test.mjs"],
  { cwd: fileURLToPath(ROOT), encoding: "utf8", timeout: 120000,
    env: { ...process.env, ...(name ? { BILLING_GRACE_MUTANT: name } : {}) } });
const output = result => `${result.stdout ?? ""}${result.stderr ?? ""}`;
await mkdir(LOGS, { recursive: true });
const baseline = run();
await writeFile(new URL("baseline.tap", LOGS), output(baseline));
assert.equal(baseline.status, 0, output(baseline));
console.log("BASELINE: 11/11 PASS (PostgreSQL 17, fixed clock, real store and RPC)");
const summary = ["BASELINE: 11/11 PASS"];
try {
  for (const [name, path, anchor, replacement, expected] of mutants) {
    const original = path === webhookPath ? webhook : sql;
    assert.equal(original.split(anchor).length, 2, `Unique source anchor required: ${name}`);
    const dir = new URL(`${name}/`, OUT);
    for (const folder of ["lib/", "supabase/migrations/"]) await mkdir(new URL(folder, dir), { recursive: true });
    for (const filename of ["lib/plans.ts", "lib/stripe-prices.ts"]) await copyFile(new URL(filename, ROOT), new URL(filename, dir));
    await writeFile(new URL(webhookPath, dir), path === webhookPath ? original.replace(anchor, replacement) : webhook);
    await writeFile(new URL(migrationPath, dir), path === migrationPath ? original.replace(anchor, replacement) : sql);
    const result = run(name), text = output(result);
    await writeFile(new URL(`${name}.tap`, LOGS), text);
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 1, `Mutant must fail tests, not boot/crash: ${name}\n${text}`);
    const failed = text.split("\n").some(line => line.includes("not ok") && line.includes(expected));
    assert.ok(failed, `${name} must be killed by its behavioral assertion: ${expected}\n${text}`);
    console.log(`KILLED ${name}: ${expected}`);
    summary.push(`KILLED ${name}: ${expected}`);
  }
  assert.equal(await readFile(new URL(webhookPath, ROOT), "utf8"), webhook, "Application source unchanged");
  assert.equal(await readFile(new URL(migrationPath, ROOT), "utf8"), sql, "Migration source unchanged");
  summary.push(`${mutants.length}/${mutants.length} mutants killed; application/migration unchanged; clusters destroyed.`);
  console.log(summary.at(-1));
} finally {
  await rm(OUT, { recursive: true, force: true });
  await writeFile(new URL("resumen.txt", LOGS), summary.join("\n") + "\n");
}
