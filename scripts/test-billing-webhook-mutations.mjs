// Mutate copies, never lib/billing-webhook.ts itself. Every killed mutant must
// fail its named behavioral assertion, not just fail to boot the local bench.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("lib/billing-webhook.ts", root), "utf8");
const mutants = [
  ["duplicate-short-circuit", "1 duplicate:",
    '  if (claim === "duplicate") return { status: 200, body: { received: true, duplicate: true } };', ""],
  ["store-processed-check", "1 duplicate:",
    '      if (data.processed_at) return "duplicate";', ""],
  ["no-reclamation", "2 stale:",
    '      const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();',
    '      return "in_progress";\n      const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();'],
  ["no-age-predicate", "3 concurrent:", '.lt("received_at", staleBefore)', ""],
  ["no-unprocessed-predicate", "2 processed during read:", '.is("processed_at", null)\n        .lt', ".lt"],
  ["in-progress-short-circuit", "2 recent:",
    '  if (claim === "in_progress") {\n    // Otra entrega del mismo evento está en curso: que Stripe reintente luego.\n    return { status: 409, body: { error: "Evento en proceso" } };\n  }', ""],
  ["no-mark-processed", "1 duplicate:", '    await deps.store.markProcessed(event.id);', ""],
  ["ignore-deletion", "4 deleted:",
    '    case "customer.subscription.deleted": {', '    case "customer.subscription.deleted": { return "ignored";'],
  ["ignore-payment-failure", "4 payment_failed:",
    '    case "invoice.payment_failed": {', '    case "invoice.payment_failed": { return "ignored";'],
];

const evidence = new URL("informes/evidencias-billing-webhook-regression/", root);
await mkdir(evidence, { recursive: true });
const summary = [];
function run(name, expectedFailure) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap",
    "__tests__/billing-webhook-store.integration.test.mjs"], {
    cwd: root, env: { ...process.env, ...(name === "baseline" ? {} : { BILLING_WEBHOOK_MUTANT: name }) },
    encoding: "utf8", timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${name}: test process must finish normally`);
  const output = result.stdout + result.stderr;
  const failures = output.split("\n").filter(line => /^\s*not ok \d+ - /.test(line));
  const line = `${name}: exit=${result.status}; ${failures.length ? failures.map(line => line.trim()).join(" | ") : "all integration assertions pass"}`;
  summary.push(line);
  console.log(line);
  if (expectedFailure) {
    assert.notEqual(result.status, 0, `${name}: mutant survived`);
    assert.ok(failures.some(line => line.includes(expectedFailure)), `${name}: missing targeted assertion failure ${expectedFailure}`);
  } else {
    assert.equal(result.status, 0, output);
    assert.match(output, /# skipped 0\b/, "Baseline must actually run, not skip the integration suite");
  }
  return output;
}

assert.equal(process.env.BILLING_WEBHOOK_MUTANT, undefined, "Do not inherit a candidate into the baseline");
await writeFile(new URL("baseline.tap", evidence), run("baseline"));
try {
  for (const [name, expectedFailure, before, after] of mutants) {
    assert.equal(source.split(before).length, 2, `${name}: mutation must match exactly once`);
    const directory = new URL(`.test-out/billing-webhook-mutants/${name}/lib/`, root);
    await mkdir(directory, { recursive: true });
    for (const dependency of ["plans.ts", "stripe-prices.ts"]) {
      await writeFile(new URL(dependency, directory), await readFile(new URL(`lib/${dependency}`, root)));
    }
    await writeFile(new URL("billing-webhook.ts", directory), source.replace(before, after));
    await writeFile(new URL(`${name}.tap`, evidence), run(name, expectedFailure));
  }
} finally {
  await rm(new URL(".test-out/billing-webhook-mutants/", root), { recursive: true, force: true });
}
assert.equal(await readFile(new URL("lib/billing-webhook.ts", root), "utf8"), source,
  "Mutation runner must leave the production source untouched");
console.log(`MUTATIONS: ${mutants.length}/${mutants.length} killed by their behavioral assertions; original source unchanged`);
summary.push(`MUTATIONS: ${mutants.length}/${mutants.length} killed by their behavioral assertions; original source unchanged`);
await writeFile(new URL("resumen.txt", evidence), summary.join("\n") + "\n");
