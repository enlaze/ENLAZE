import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const out = new URL(".test-out/service-client-mutants/", root);
const logs = new URL("informes/evidencias/lazy-service-clients/", root);
const targets = [
  ["notification", "lib/notification-service.ts", "resend"],
  ["send-otp", "app/api/signatures/send-otp/route.ts", "resend"],
  ["budget-generate", "app/api/agent/budgets/generate/route.ts", "anthropic"],
  ["market-analysis", "app/api/agent/market/analysis/route.ts", "anthropic"],
  ["invoice-ocr", "app/api/invoices/ocr/route.ts", "anthropic"],
  ["generate-budget", "app/api/generate-budget/route.ts", "anthropic"],
];
const run = mutation => spawnSync(process.execPath,
  ["--test", "--test-reporter=tap", "__tests__/service-clients-import.test.mjs"],
  { cwd: fileURLToPath(root), encoding: "utf8", timeout: 90000,
    env: { ...process.env, ...(mutation ? { SERVICE_CLIENT_MUTANT_ROOT: fileURLToPath(mutation) } : {}) } });
await mkdir(logs, { recursive: true });
const baseline = run();
await writeFile(new URL("baseline.tap", logs), baseline.stdout + baseline.stderr);
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
const summary = ["BASELINE 7/7 PASS: six imports with keys deleted + real lazy/memoized getters"];
console.log(summary[0]);
try {
  for (const [name, path, sdk] of targets) {
    const dir = new URL(`${name}/`, out);
    await mkdir(new URL("lib/", dir), { recursive: true });
    await cp(new URL("lib/", root), new URL("lib/", dir), { recursive: true });
    // The two agent routes import their sibling auth helper relatively.
    await mkdir(new URL("app/api/agent/", dir), { recursive: true });
    await cp(new URL("app/api/agent/_lib/", root), new URL("app/api/agent/_lib/", dir), { recursive: true });
    const file = new URL(path, dir);
    await mkdir(new URL("./", file), { recursive: true });
    const original = await readFile(new URL(path, root), "utf8");
    const eager = sdk === "resend"
      ? 'import { Resend as EagerResend } from "resend";\nconst eagerClient = new EagerResend(process.env.RESEND_API_KEY);\n'
      : 'import EagerAnthropic from "@anthropic-ai/sdk";\nconst eagerClient = new EagerAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });\n';
    await writeFile(file, eager + original);
    const result = run(dir), output = result.stdout + result.stderr;
    await writeFile(new URL(`${name}.tap`, logs), output);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, `${name} must fail its import assertion`);
    assert.ok(output.split("\n").some(line => line.includes("not ok") && line.includes(path)), `${name} failed another test\n${output}`);
    assert.match(output, sdk === "resend" ? /module import must not require runtime credentials/ : /IMPORT MUST NOT CONSTRUCT SERVICE CLIENTS/);
    assert.equal(await readFile(new URL(path, root), "utf8"), original);
    summary.push(`KILLED ${name}: eager ${sdk} at module scope detected in ${path}`);
    console.log(summary.at(-1));
  }
  summary.push("6/6 mutants killed; real source unchanged; no email or AI requests.");
  console.log(summary.at(-1));
} finally {
  await rm(out, { recursive: true, force: true });
  await writeFile(new URL("resumen.txt", logs), summary.join("\n") + "\n");
}
