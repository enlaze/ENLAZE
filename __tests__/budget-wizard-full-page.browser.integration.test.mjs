// The real Next page, browser auth, PostgREST and PostgreSQL all run on loopback.
// This is intentionally separate from the provider-only browser regression.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { Client } from "pg";
import puppeteer from "puppeteer";
import { config, guard, setup } from "./lib/budget-revision-rpcs-bench.mjs";

const root = new URL("../", import.meta.url);
const restOrigin = "http://127.0.0.1:53002";
const gatewayOrigin = "http://127.0.0.1:53003";
const appOrigin = "http://127.0.0.1:53004";
const owner = "11111111-1111-4111-8111-111111111111";
const env = process.env;

// Refuse even to launch Next if this is not the same marked disposable cluster
// used by the SQL/HTTP integration suite. A checkout with env files could
// silently override synthetic public variables, so reject it too.
assert.equal(env.RUN_REVISION_RPCS_INTEGRATION_TESTS, "1");
assert.equal(env.E2_REST_URL, restOrigin);
assert.ok(typeof env.E2_JWT_SECRET === "string" && env.E2_JWT_SECRET.length >= 32);
for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
  assert.equal(existsSync(new URL(name, root)), false, `${name} must not be present in the E2E checkout`);
}
const db = new Client(config(env));
await db.connect();
await guard(db);

const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(role, sub) {
  const value = `${part({ alg: "HS256", typ: "JWT" })}.${part({ role, sub, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${value}.${createHmac("sha256", env.E2_JWT_SECRET).update(value).digest("base64url")}`;
}
const accessToken = token("authenticated", owner);
const anonToken = token("anon");
const user = {
  id: owner, aud: "authenticated", role: "authenticated", email: "wizard-e2e@example.invalid",
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
  created_at: "2026-01-01T00:00:00Z", confirmed_at: "2026-01-01T00:00:00Z",
};
const session = {
  access_token: accessToken, refresh_token: "disposable-refresh-never-used",
  token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
};

let gateway;
let next;
let browser;
let nextLog = "";
const requests = [];
const pages = [];
function reply(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json", "access-control-allow-origin": appOrigin,
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile",
    ...headers,
  });
  response.end(JSON.stringify(body));
}
async function waitFor(predicate, label, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await predicate()) return; } catch { /* server still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error(`Timed out waiting for ${label}. Next output:\n${nextLog.slice(-5000)}`);
}
async function openWizard(budgetId, expectedTitle = "Base E2E") {
  const page = await browser.newPage();
  pages.push(page);
  // Production CSP deliberately allows hosted Supabase rather than this
  // disposable loopback origin. Bypass only CSP in this synthetic browser;
  // the request interceptor below still refuses every non-loopback origin.
  await page.setBypassCSP(true);
  const pageErrors = [];
  const networkErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") networkErrors.push(message.text().slice(0, 300));
  });
  page.on("requestfailed", (request) => {
    networkErrors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`);
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const origin = new URL(request.url()).origin;
    if ([appOrigin, gatewayOrigin, "data:"].includes(origin)) request.continue();
    else request.abort();
  });
  await page.setCookie({
    name: "sb-127-auth-token",
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    url: appOrigin,
    httpOnly: false,
  });
  const response = await page.goto(`${appOrigin}/dashboard/budgets/generate?budgetId=${budgetId}`, {
    waitUntil: "domcontentloaded", timeout: 90000,
  });
  assert.equal(response.status(), 200, `wizard response: ${await page.content()}`);
  try {
    await page.waitForSelector('input[placeholder="Ej: Reforma baño completo"]', { timeout: 30000 });
  } catch (error) {
    const visibleText = await page.evaluate(() => document.body?.innerText?.slice(0, 1600) ?? "");
    throw Error(`Wizard did not render. URL=${page.url()} text=${JSON.stringify(visibleText)} ` +
      `pageErrors=${JSON.stringify(pageErrors)} requests=${JSON.stringify(requests.slice(-20))} ` +
      `networkErrors=${JSON.stringify(networkErrors.slice(-10))} ` +
      `Next=${JSON.stringify(nextLog.slice(-3000))}`, { cause: error });
  }
  await waitFor(async () => page.$eval('input[placeholder="Ej: Reforma baño completo"]', (node) => node.value) === expectedTitle, "wizard hydration");
  assert.deepEqual(pageErrors, [], "page must not throw during hydration");
  return { page, pageErrors };
}

try {
  await setup(db);
  await db.query("insert into auth.users values($1)", [owner]);
  await db.query("notify pgrst, 'reload schema'");

  gateway = createServer(async (request, response) => {
    const url = new URL(request.url, gatewayOrigin);
    if (request.method === "OPTIONS") { reply(response, 200, {}); return; }
    if (url.pathname === "/auth/v1/user") {
      requests.push({ method: request.method, path: url.pathname });
      if (request.headers.authorization !== `Bearer ${accessToken}`) {
        reply(response, 401, { error: "invalid synthetic session" }); return;
      }
      reply(response, 200, user); return;
    }
    if (!url.pathname.startsWith("/rest/v1/")) {
      reply(response, 404, { error: "gateway route denied" }); return;
    }
    // All database traffic is forwarded to the already-guarded local PostgREST.
    const target = new URL(url.pathname.slice("/rest/v1".length) + url.search, restOrigin);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, path: target.pathname });
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers: Object.fromEntries(Object.entries(request.headers).filter(([name]) =>
          !["host", "connection", "content-length", "origin", "referer"].includes(name))),
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const headers = Object.fromEntries([...upstream.headers].filter(([name]) =>
        !["content-length", "content-encoding", "transfer-encoding", "connection"].includes(name)));
      response.writeHead(upstream.status, { ...headers, "access-control-allow-origin": appOrigin });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { reply(response, 502, { error: String(error) }); }
  });
  await new Promise((resolve) => gateway.listen(53003, "127.0.0.1", resolve));

  await waitFor(async () => {
    const response = await fetch(`${restOrigin}/`, { headers: { Authorization: `Bearer ${accessToken}` } });
    return response.ok && Boolean((await response.json()).paths?.["/rpc/create_budget_with_items"]);
  }, "PostgREST schema");
  const seed = await fetch(`${restOrigin}/rpc/create_budget_with_items`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ p_budget_data: { title: "Base E2E", budget_number: "WIZARD-E2E", total: 12 },
      p_items: [{ concept: "Partida E2E", quantity: 1, unit_price: 12, subtotal: 12 }] }),
  });
  if (seed.status !== 200) throw Error(`Synthetic budget seed failed: ${seed.status} ${await seed.text()}`);
  const { budget_id: budgetId } = await seed.json();
  await db.query("update public.budgets set wizard_state=$2 where id=$1", [budgetId, JSON.stringify({
    title: "Base E2E",
    partidas: [{ id: "synthetic-item", concept: "Partida E2E", description: "", quantity: 1,
      unit: "ud", category: "otros", unit_price: 1000, subtotal_cost: 1000,
      unit_price_client: 1300, subtotal_client: 1300, status: "incluida" }],
  })]);
  const snapshot = async () => (await db.query("select title, lock_version from public.budgets where id=$1", [budgetId])).rows[0];
  const baseline = await snapshot();
  assert.equal(baseline.lock_version, 1);

  // Do not inherit arbitrary account/production credentials into Next.
  next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "53004"], {
    cwd: new URL(".", root),
    env: {
      PATH: env.PATH, HOME: env.HOME, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: gatewayOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [next.stdout, next.stderr]) stream.on("data", (chunk) => { nextLog += chunk.toString(); });
  await waitFor(async () => (await fetch(appOrigin)).status < 500, "Next dev server");

  browser = await puppeteer.launch({ headless: true, args: [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-background-networking",
    "--disable-extensions", "--disable-sync", "--no-first-run",
  ] });
  const first = await openWizard(budgetId);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.deepEqual(await snapshot(), baseline, "opening an existing budget must not autosave it");
  const second = await openWizard(budgetId);
  await first.page.type('input[placeholder="Ej: Reforma baño completo"]', " editado");
  await waitFor(async () => (await snapshot()).lock_version === 2, "first real autosave", 15000);
  assert.equal((await snapshot()).title, "Base E2E editado");
  await second.page.type('input[placeholder="Ej: Reforma baño completo"]', " obsoleto");
  await waitFor(async () => (await second.page.content()).includes("Error:"), "stale revision error", 15000);
  assert.equal((await snapshot()).title, "Base E2E editado", "conflicting tab must not overwrite winner");
  assert.equal((await snapshot()).lock_version, 2);
  assert.ok(requests.some((entry) => entry.path === "/rpc/save_budget"), "real UI must reach real RPC");
  const final = await openWizard(budgetId, "Base E2E editado");
  await final.page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Finalizar presupuesto"));
    if (!button || button.disabled) throw Error("Finalization button unavailable");
    button.click();
  });
  await waitFor(async () => (await final.page.content()).includes("¡Presupuesto Finalizado!"), "full-page finalization", 15000);
  const finalized = (await db.query("select status, lock_version from public.budgets where id=$1", [budgetId])).rows[0];
  assert.equal(finalized.status, "pendiente");
  assert.equal(finalized.lock_version, 3);
  assert.ok(requests.some((entry) => entry.path === "/rpc/finalize_budget"), "real UI must call the finalization RPC");
  assert.deepEqual(first.pageErrors, []);
  assert.deepEqual(second.pageErrors, []);
  assert.deepEqual(final.pageErrors, []);
  console.log("PASS: full Next wizard hydrates without writing, autosaves, rejects a stale browser tab and finalizes through PostgREST");
} finally {
  for (const page of pages) await page.close().catch(() => {});
  await browser?.close();
  if (next && next.exitCode === null) {
    const exited = new Promise((resolve) => next.once("exit", resolve));
    next.kill("SIGTERM");
    await exited;
  }
  if (gateway) await new Promise((resolve) => gateway.close(resolve));
  await db.end();
}
