/** Runs the REAL npm build + prebuild with no email/AI credentials or external connections. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { planCatalogRows } from "../lib/plans";
const root = new URL("../", import.meta.url);
for (const name of [".env", ".env.local", ".env.production", ".env.production.local", ".env.sentry-build-plugin"]) {
  assert.equal(existsSync(new URL(name, root)), false, `Refuse dotenv file ${name}; credentials must stay absent`);
}
let reads = 0;
const server = createServer((request, response) => {
  if (request.method !== "GET" || new URL(request.url!, "http://127.0.0.1").pathname !== "/rest/v1/plan_catalog") {
    response.writeHead(403); response.end("Only the local read-only build fixture is allowed"); return;
  }
  reads++;
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(planCatalogRows()));
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const env: NodeJS.ProcessEnv = { NODE_ENV: "production", ...Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG"].filter(key => process.env[key] !== undefined)
  .map(key => [key, process.env[key]])) };
Object.assign(env, {
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic_build_anon_not_a_real_key",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic_build_service_not_a_real_key",
  NODE_OPTIONS: `--require=${fileURLToPath(new URL("__tests__/support/build-network.cjs", root))}`,
  NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fileURLToPath(new URL("__tests__/support/build-fonts.cjs", root)),
});
for (const key of ["RESEND_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "STRIPE_SECRET_KEY", "SENTRY_AUTH_TOKEN"]) {
  assert.equal(env[key], undefined, `${key} must be absent, never a dummy credential`);
}
console.log("BUILD ENV: Resend/Anthropic keys ABSENT; read-only local plan catalog; no Stripe key; external sockets refused");
let output = "";
try {
  const child = spawn("npm", ["run", "build", ...process.argv.slice(2)], {
    cwd: fileURLToPath(root), env, stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
    output += chunk.toString(); process.stdout.write(chunk);
  });
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  await mkdir(new URL("informes/evidencias/lazy-service-clients/", root), { recursive: true });
  await writeFile(new URL("informes/evidencias/lazy-service-clients/build.log", root), output);
  assert.ok(reads > 0, "the real prebuild must check the local plan catalog");
  assert.equal(code, 0, "npm run build must pass without Resend/Anthropic credentials");
  console.log("PASS npm run build with service credentials absent (including prebuild)");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
}
