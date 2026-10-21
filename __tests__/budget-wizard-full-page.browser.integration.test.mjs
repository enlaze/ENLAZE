// The real Next page, browser auth, PostgREST and PostgreSQL all run on loopback.
// This is intentionally separate from the provider-only browser regression.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prepareWizardProvenance, seedWizardPriceSources, provenanceScope, provenanceClient } from "./support/budget-wizard-provenance.mjs";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { Client } from "pg";
import puppeteer from "puppeteer";
import { assertNoProductionEnvironment } from "./lib/disposable-target-guard.mjs";
import { config, guard, setup } from "./lib/budget-revision-rpcs-bench.mjs";

const root = new URL("../", import.meta.url);
const restOrigin = "http://127.0.0.1:53002";
const gatewayOrigin = "http://127.0.0.1:53003";
const appOrigin = "http://127.0.0.1:53004";
const owner = "11111111-1111-4111-8111-111111111111";
const env = process.env;
const resolverSources = new Set([...await readFile(new URL("lib/price-resolver-v2.ts", root), "utf8")
  .then(text => text.matchAll(/source_type:\s*"([^"]+)"/g))].map(match => match[1]));
assert.ok(resolverSources.size >= 11, "read the actual resolver levels");

// Refuse even to launch Next if this is not the same marked disposable cluster
// used by the SQL/HTTP integration suite. A checkout with env files could
// silently override synthetic public variables, so reject it too.
assertNoProductionEnvironment(env);
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
// Only the external model is deterministic; application routes and budget
// writers run unchanged against real PostgREST/PostgreSQL.
const proposal = {
  summary: "Pintura de 40 m2", confidence_score: 90,
  suggested_items: [...Array.from({ length: 7 }, (_, i) => ({
    concept: `Pintura pared G3 ${i}`, description: "Preparación y acabado",
    quantity: 40, unit: "m2", unit_cost: 9 + i,
    category: "mano_obra", chapter: "pintura", estimated_hours: 4,
  })), { concept: "Sellado técnico soporte G3", description: "Fuente técnica disponible",
    quantity: 40, unit: "m2", unit_cost: 12, category: "mano_obra", chapter: "pintura" }],
  suggested_materials: [],
};
let modelCalls = 0;
let modelEnabled = false;
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
    "access-control-allow-headers": "authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile,x-retry-count",
    ...headers,
  });
  response.end(JSON.stringify(body));
}
/** Las partidas se pintan dentro de inputs, así que innerText no basta. */
const visibleText = (page) => page.evaluate(() => [
  document.body?.innerText ?? "",
  ...[...document.querySelectorAll("input,textarea")].map((node) => node.value ?? ""),
].join("\n"));

const WRITE_RPCS = new Set([
  "/rpc/create_budget_with_items", "/rpc/save_budget", "/rpc/finalize_budget",
  "/rpc/change_budget_status", "/rpc/duplicate_budget",
]);
/** Escrituras realmente cursadas por la pasarela, no una espera por tiempo. */
const writeCalls = () => requests.filter((entry) => WRITE_RPCS.has(entry.path));

async function waitFor(predicate, label, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await predicate()) return; } catch { /* server still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error(`Timed out waiting for ${label}. Next output:\n${nextLog.slice(-5000)}`);
}
async function openWizard(budgetId, expectedTitle = "Base E2E", { step = null, ready = null } = {}) {
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
    path: "/",
    httpOnly: false,
  });
  const stepQuery = step === null ? "" : `&step=${step}`;
  const response = await page.goto(`${appOrigin}/dashboard/budgets/generate?budgetId=${budgetId}${stepQuery}`, {
    waitUntil: "domcontentloaded", timeout: 90000,
  });
  assert.equal(response.status(), 200, `wizard response: ${await page.content()}`);
  if (ready) {
    await waitFor(async () => (await visibleText(page)).includes(ready),
      `wizard step ${step} showing ${ready}`, 30000);
    assert.deepEqual(pageErrors, [], "page must not throw during hydration");
    return { page, pageErrors };
  }
  try {
    await page.waitForSelector('input[placeholder="Ej: Reforma baño completo"]', { timeout: 30000 });
  } catch (error) {
    const visibleText = await page.evaluate(() => document.body?.innerText?.slice(0, 1600) ?? "");
    throw Error(`Wizard did not render. URL=${page.url()} text=${JSON.stringify(visibleText)} ` +
      `pageErrors=${JSON.stringify(pageErrors)} requests=${JSON.stringify(requests.slice(-20))} ` +
      `networkErrors=${JSON.stringify(networkErrors.slice(-10))} ` +
      `Next=${JSON.stringify(nextLog.slice(-3000))}`, { cause: error });
  }
  try {
    await waitFor(async () => (await page.$eval('input[placeholder="Ej: Reforma baño completo"]', (node) => node.value)) === expectedTitle, "wizard hydration", 30000);
  } catch (error) {
    const actualTitle = await page.$eval('input[placeholder="Ej: Reforma baño completo"]', (node) => node.value);
    const visibleText = await page.evaluate(() => document.body?.innerText?.slice(0, 900) ?? "");
    throw Error(`Wizard hydration failed. expected=${expectedTitle} actual=${JSON.stringify(actualTitle)} ` +
      `URL=${page.url()} text=${JSON.stringify(visibleText)} requests=${JSON.stringify(requests.slice(-30))} ` +
      `pageErrors=${JSON.stringify(pageErrors)} networkErrors=${JSON.stringify(networkErrors.slice(-10))}`, { cause: error });
  }
  assert.deepEqual(pageErrors, [], "page must not throw during hydration");
  return { page, pageErrors };
}

try {
  await setup(db);
  await prepareWizardProvenance(db);
  await db.query(await readFile(new URL("supabase/migrations/20261021090000_user_supplied_prices.sql", root), "utf8"));
  await db.query("insert into auth.users values($1)", [owner]);
  await seedWizardPriceSources(db, owner);
  await db.query("notify pgrst, 'reload schema'");

  gateway = createServer(async (request, response) => {
    const url = new URL(request.url, gatewayOrigin);
    if (request.method === "OPTIONS") { reply(response, 200, {}); return; }
    if (url.pathname === "/auth/v1/user") {
      requests.push({ method: request.method, path: url.pathname,
        status: request.headers.authorization === `Bearer ${accessToken}` ? 200 : 401,
        client: request.headers["x-client-info"] });
      if (request.headers.authorization !== `Bearer ${accessToken}`) {
        reply(response, 401, { error: "invalid synthetic session" }); return;
      }
      reply(response, 200, user); return;
    }
    if (url.pathname === "/v1/messages" && request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(input.model, "claude-sonnet-4-6");
      if (modelEnabled) modelCalls++;
      reply(response, 200, { id: "msg_disposable_g3", type: "message", role: "assistant",
        model: input.model, content: [{ type: "text", text: modelEnabled ? JSON.stringify(proposal) : "Model disabled for resolver fixture" }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
      return;
    }
    if (!url.pathname.startsWith("/rest/v1/")) {
      requests.push({ method: request.method, path: url.pathname, status: 404 });
      reply(response, 404, { error: "gateway route denied" }); return;
    }
    // All database traffic is forwarded to the already-guarded local PostgREST.
    const target = new URL(url.pathname.slice("/rest/v1".length) + url.search, restOrigin);
    // Una ruta del tipo /rest/v1//otro-host/x resuelve a ese otro host: el
    // destino se comprueba, no se deduce del origen base.
    if (target.origin !== restOrigin) {
      requests.push({ method: request.method, path: url.pathname, status: 403, error: `target escaped: ${target.origin}` });
      reply(response, 403, { error: "gateway target escaped the disposable bench" }); return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers: Object.fromEntries(Object.entries(request.headers).filter(([name]) =>
          !["host", "connection", "content-length", "origin", "referer"].includes(name))),
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      const headers = Object.fromEntries([...upstream.headers].filter(([name]) =>
        !["content-length", "content-encoding", "transfer-encoding", "connection"].includes(name)));
      const body = Buffer.from(await upstream.arrayBuffer());
      requests.push({ method: request.method, path: target.pathname, status: upstream.status,
        authRole: request.headers.authorization === `Bearer ${accessToken}` ? "authenticated"
          : request.headers.authorization === `Bearer ${anonToken}` ? "anon" : "other",
        error: upstream.ok ? undefined : body.toString().slice(0, 300),
        payload: WRITE_RPCS.has(target.pathname) && chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined });
      response.writeHead(upstream.status, { ...headers, "access-control-allow-origin": appOrigin });
      response.end(body);
    } catch (error) {
      requests.push({ method: request.method, path: target.pathname, status: 502, error: String(error) });
      reply(response, 502, { error: String(error) });
    }
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
  const canRead = await fetch(`${restOrigin}/budgets?id=eq.${budgetId}&select=id`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(canRead.status, 200, `fixture authenticated read: ${await canRead.text()}`);
  const snapshot = async () => (await db.query("select title, lock_version from public.budgets where id=$1", [budgetId])).rows[0];
  const baseline = await snapshot();
  assert.equal(baseline.lock_version, 1);

  // Do not inherit arbitrary account/production credentials into Next.
  next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "53004"], {
    cwd: new URL(".", root),
    env: {
      PATH: env.PATH, HOME: env.HOME, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: gatewayOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonToken,
      SUPABASE_SERVICE_ROLE_KEY: token("service_role"),
      ANTHROPIC_API_KEY: "synthetic-disposable-model-only", ANTHROPIC_BASE_URL: gatewayOrigin,
      NODE_OPTIONS: `--require=${fileURLToPath(new URL("__tests__/support/budget-wizard-network.cjs", root))}`,
      NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fileURLToPath(new URL("__tests__/support/budget-wizard-fonts.cjs", root)),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [next.stdout, next.stderr]) stream.on("data", (chunk) => { nextLog += chunk.toString(); });
  await waitFor(async () => (await fetch(appOrigin)).status < 500, "Next dev server");

  browser = await puppeteer.launch({ headless: true, args: [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-background-networking",
    "--disable-extensions", "--disable-sync", "--no-first-run",
  ] });
  const writesBeforeOpen = writeCalls().length;
  const first = await openWizard(budgetId);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.deepEqual(await snapshot(), baseline, "opening an existing budget must not autosave it");
  // La espera por tiempo sólo acompaña: lo que lo demuestra es que la pasarela
  // no cursó ninguna RPC de escritura.
  assert.deepEqual(writeCalls().slice(writesBeforeOpen), [],
    "abrir un presupuesto existente no debe cursar ninguna RPC de escritura");
  const second = await openWizard(budgetId);
  // Next dev can briefly replace an already-mounted tab with its loading
  // boundary while compiling the second request. Wait for the first tab to
  // rehydrate before simulating an edit; a transient loading frame is not a
  // disappeared budget.
  try {
    await first.page.waitForSelector('input[placeholder="Ej: Reforma baño completo"]', { timeout: 30000 });
  } catch (error) {
    const firstText = await first.page.evaluate(() => document.body?.innerText?.slice(0, 1200) ?? "");
    const secondText = await second.page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? "");
    throw Error(`First tab lost the editable wizard. URL=${first.page.url()} text=${JSON.stringify(firstText)} ` +
      `secondURL=${second.page.url()} secondText=${JSON.stringify(secondText)} ` +
      `requests=${JSON.stringify(requests.slice(-25))} Next=${JSON.stringify(nextLog.slice(-1200))}`, { cause: error });
  }
  await waitFor(async () => (await first.page.$eval('input[placeholder="Ej: Reforma baño completo"]', (node) => node.value)) === "Base E2E", "first tab after dev reload", 15000);
  assert.deepEqual(await snapshot(), baseline, "second tab must not cause a revision write");
  assert.deepEqual(writeCalls().slice(writesBeforeOpen), [],
    "abrir una segunda pestaña tampoco escribe");
  await first.page.type('input[placeholder="Ej: Reforma baño completo"]', " editado");
  await waitFor(async () => (await snapshot()).lock_version === 2, "first real autosave", 15000);
  assert.equal((await snapshot()).title, "Base E2E editado");
  await second.page.type('input[placeholder="Ej: Reforma baño completo"]', " obsoleto");
  // El mensaje concreto de PT409, no un "Error:" cualquiera que cualquier otro
  // fallo satisfaría igual.
  await waitFor(async () => (await visibleText(second.page)).includes("otra pestaña o sesión"),
    "stale revision conflict message", 15000);
  const conflictText = await visibleText(second.page);
  assert.match(conflictText, /Recarga la página/, "el conflicto debe decir qué hacer");
  await waitFor(async () => (await visibleText(second.page)).includes("Recargar presupuesto"),
    "el conflicto debe bloquear la pestaña obsoleta con una acción de recarga");
  assert.ok(requests.some((entry) => entry.path === "/rpc/save_budget" && entry.status === 409),
    "la pestaña obsoleta debe haber recibido un 409 real de PostgREST");
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
  // ---- F1: presupuesto anterior a que el asistente guardara las partidas ----
  // Sus lineas viven solo en budget_items y su wizard_state no las tiene. Antes
  // de la correccion, una edicion cualquiera las sustituia por un conjunto vacio.
  const legacySeed = await fetch(`${restOrigin}/rpc/create_budget_with_items`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ p_budget_data: { title: "Antiguo E2E", budget_number: "WIZARD-E2E-LEGACY", total: 1350 }, p_items: [] }),
  });
  if (legacySeed.status !== 200) throw Error(`Legacy seed failed: ${legacySeed.status} ${await legacySeed.text()}`);
  const { budget_id: legacyId } = await legacySeed.json();
  await db.query(`insert into public.budget_items
      (budget_id, sort_order, concept, description, quantity, unit, category, chapter,
       unit_price, subtotal, unit_price_cost, subtotal_cost)
    values ($1,0,'Alicatado de bano','Azulejo 20x20',12,'m2','mano_obra','banos',30,360,20,240),
           ($1,1,'Pintura de salon','Plastica lavable',40,'m2','mano_obra','salon',12,480,8,320),
           ($1,2,'Instalacion electrica','Puntos de luz',6,'ud','material','instalaciones',85,510,60,360)`, [legacyId]);
  // wizard_state real de aquella epoca: con cabecera, sin partidas.
  await db.query("update public.budgets set wizard_state=$2 where id=$1",
    [legacyId, JSON.stringify({ title: "Antiguo E2E", currentStep: 0, ivaPercent: 21 })]);
  const legacyState = async () => (await db.query(`select b.lock_version,
      (select count(*) from public.budget_items i where i.budget_id=b.id)::int as items,
      (select coalesce(jsonb_agg(jsonb_build_array(i.concept, i.unit_price, i.subtotal, i.unit_price_cost)
        order by i.sort_order), '[]'::jsonb) from public.budget_items i where i.budget_id=b.id) as lines
    from public.budgets b where b.id=$1`, [legacyId])).rows[0];
  const legacyBaseline = await legacyState();
  assert.equal(legacyBaseline.items, 3);
  assert.equal(legacyBaseline.lock_version, 1);

  const writesBeforeLegacy = writeCalls().length;
  // Se abre en el paso de partidas: deben verse las tres, leidas de budget_items.
  const legacyTab = await openWizard(legacyId, "Antiguo E2E", { step: 1, ready: "Alicatado de bano" });
  const legacyShown = await visibleText(legacyTab.page);
  for (const concept of ["Alicatado de bano", "Pintura de salon", "Instalacion electrica"]) {
    assert.ok(legacyShown.includes(concept), `la partida ${concept} debe aparecer en el asistente`);
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.deepEqual(writeCalls().slice(writesBeforeLegacy), [],
    "abrir un presupuesto antiguo no debe escribir nada");
  assert.deepEqual(await legacyState(), legacyBaseline, "abrirlo no altera sus partidas");

  // Editar otro campo: el autoguardado debe conservar las tres partidas.
  const legacyEdit = await openWizard(legacyId, "Antiguo E2E");
  await legacyEdit.page.type('input[placeholder="Ej: Reforma baño completo"]', " revisado");
  await waitFor(async () => (await legacyState()).lock_version === 2, "autoguardado del presupuesto antiguo", 20000);
  const afterEdit = await legacyState();
  assert.equal(afterEdit.items, 3, "ninguna partida puede desaparecer al autoguardar");
  assert.deepEqual(afterEdit.lines, legacyBaseline.lines, "las partidas se reescriben identicas");
  assert.equal((await db.query("select title from public.budgets where id=$1", [legacyId])).rows[0].title,
    "Antiguo E2E revisado");
  assert.deepEqual(legacyTab.pageErrors, []);
  assert.deepEqual(legacyEdit.pageErrors, []);

  // ---- G3: resolver -> real API -> wizard state -> payload -> real RPC ----
  // Seed an EMPTY draft header, never price evidence or wizard partidas.
  const generatedTitle = "Procedencia E2E";
  const empty = await fetch(`${restOrigin}/rpc/create_budget_with_items`, {
    method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ p_budget_data: {
      title: generatedTitle, budget_number: "WIZARD-E2E-PROVENANCE", client_id: provenanceClient,
      wizard_state: { title: generatedTitle, clientId: provenanceClient, sector: "construccion",
        description: "Pintura de salón", sectorData: provenanceScope },
    }, p_items: [] }),
  });
  assert.equal(empty.status, 200, await empty.clone().text());
  const { budget_id: generatedId } = await empty.json();
  const generatedRows = async () => (await db.query(`select concept, unit_price_cost,
    price_source_type, price_confidence, price_checked_at from public.budget_items
    where budget_id=$1 order by sort_order`, [generatedId])).rows;
  assert.deepEqual(await generatedRows(), [], "no provenance-bearing lines may be seeded");
  const generated = await openWizard(generatedId, generatedTitle);
  const apiResponses = [];
  generated.page.on("response", async response => {
    const path = new URL(response.url()).pathname;
    if (["/api/prices/resolve", "/api/agent/budget-analysis"].includes(path)) {
      apiResponses.push({ path, status: response.status(), body: await response.json() });
    }
  });
  const clickButton = async text => generated.page.evaluate(text => {
    const button = [...document.querySelectorAll("button")].find(node => node.textContent?.trim() === text);
    if (!button || button.disabled) throw Error(`Button unavailable: ${text}`);
    button.click();
  }, text);
  await clickButton("Siguiente paso");
  await waitFor(async () => (await generated.page.$$("tbody tr")).length > 0 &&
    (await visibleText(generated.page)).includes("Partidas"), "generated wizard lines", 90000);
  await waitFor(() => apiResponses.some(response => response.path === "/api/prices/resolve"), "real price API response");
  assert.ok(apiResponses.some(response => response.path === "/api/agent/budget-analysis" && response.status === 200),
    `real analysis API must succeed: ${JSON.stringify(apiResponses.map(({path,status})=>({path,status})))}`);
  const priceResponses = apiResponses.filter(response => response.path === "/api/prices/resolve");
  for (const response of priceResponses) {
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
  }
  const quotes = priceResponses.flatMap(response => response.body.resolved);
  assert.ok(quotes.length > 0, "the resolver must have quoted actual wizard lines");
  const generatedWriteStart = writeCalls().length;
  await waitFor(async () => !(await generated.page.evaluate(() => [...document.querySelectorAll("button")]
    .find(node => node.textContent?.trim() === "Guardar borrador")?.disabled)), "save enabled");
  await clickButton("Guardar borrador");
  await waitFor(async () => writeCalls().slice(generatedWriteStart).some(call => call.path === "/rpc/save_budget" && call.status === 200 &&
      call.payload.p_budget_id === generatedId && call.payload.p_items.length > 0)
    && (await generatedRows()).length > 0, "generated provenance saved through real RPC", 20000);
  const persisted = await generatedRows();
  assert.equal(persisted.length, 5, "all five budget lines persist; the material basket is not double-counted");
  for (const item of persisted) {
    assert.notEqual(item.price_source_type, null, `G3 TRANSPORT: ${item.concept} source must reach budget_items`);
    assert.notEqual(item.price_confidence, null, `G3 TRANSPORT: ${item.concept} confidence must reach budget_items`);
    assert.notEqual(item.price_checked_at, null, `G3 TRANSPORT: ${item.concept} timestamp must reach budget_items`);
    assert.ok(resolverSources.has(item.price_source_type), `${item.concept}: unknown resolver source ${item.price_source_type}`);
    const quote = quotes.find(quote => quote.materialName === item.concept);
    assert.ok(quote, `${item.concept} must correspond to a response from the real resolver API`);
    assert.equal(item.price_source_type, quote.sourceType);
    assert.equal(Number(item.price_confidence), Number(quote.confidenceScore.toFixed(2)));
    assert.equal(item.price_checked_at.toISOString(), new Date(quote.capturedAt).toISOString());
  }
  const savedPayload = writeCalls().slice(generatedWriteStart).find(call => call.path === "/rpc/save_budget" && call.status === 200 &&
    call.payload.p_budget_id === generatedId && call.payload.p_items.length === persisted.length).payload;
  assert.equal(savedPayload.p_items.length, persisted.length);
  // Since B11, the eight basket materials live in wizard_state, not budget_items.
  const basket = (await db.query("select wizard_state->'materials' as materials from public.budgets where id=$1", [generatedId])).rows[0].materials;
  assert.equal(basket.length, 8, "all basket materials must remain in the saved wizard");
  for (const material of basket) {
    const quote = quotes.find(quote => quote.materialName === material.name);
    assert.ok(quote, `${material.name}: real resolver quote required`);
    assert.equal(material.price_source_type, quote.sourceType, `G3 TRANSPORT: ${material.name} source must reach wizard_state`);
    assert.equal(material.price_confidence, quote.confidenceScore);
    assert.equal(new Date(material.price_checked_at).toISOString(), new Date(quote.capturedAt).toISOString());
  }
  assert.match(await generated.page.$eval('[data-testid="price-provenance-summary"]', node => node.innerText),
    /0 de 5 líneas sin fuente verificable — 0 % del importe/);
  console.log("PASS G3 SUMMARY RESOLVED: 0 de 5 líneas; 0% del importe");
  console.log(`PASS G3 GENERATED: ${persisted.length} budget_items preserve source, confidence and timestamp from real resolver API`);
  console.log("PASS G3 BASKET: 8 materials preserve resolver evidence in wizard_state without duplicate budget_items");

  // Edit the cost in the REAL ItemsStep input, then explicitly save again.
  // No provider hooks, direct SQL edit or handcrafted provenance payload.
  const manualStart = Date.now();
  const edited = await generated.page.evaluate(() => {
    const tr = document.querySelector("tbody tr");
    const concept = tr?.querySelector('input[type="text"]')?.value;
    const input = tr?.querySelectorAll('input[type="number"]');
    const price = input?.[input.length - 1];
    if (!concept || !price) throw Error("Editable generated price unavailable");
    return { concept, previous: Number(price.value) };
  });
  const newPrice = Math.ceil(edited.previous) + 17;
  const priceInput = await generated.page.$('tbody tr:first-child td:nth-child(5) input[type="number"]');
  assert.ok(priceInput, "edit the unit cost, not quantity or displayed client price");
  // Puppeteer's fill clears the existing number and types into the visible
  // input, which runs ItemsStep.onChange and the real provider update handler.
  await generated.page.locator('tbody tr:first-child td:nth-child(5) input[type="number"]').fill(String(newPrice));
  await priceInput.press("Tab");
  assert.equal(Number(await priceInput.evaluate(node => node.value)), newPrice, "the real cost input must contain the edited amount");
  const manualWriteStart = writeCalls().length;
  await waitFor(async () => !(await generated.page.evaluate(() => [...document.querySelectorAll("button")]
    .find(node => node.textContent?.trim() === "Guardar borrador")?.disabled)), "manual save enabled");
  await clickButton("Guardar borrador");
  await waitFor(async () => writeCalls().slice(manualWriteStart).some(call => call.path === "/rpc/save_budget" && call.status === 200)
    && (await generatedRows()).some(row => row.concept === edited.concept && Number(row.unit_price_cost) === newPrice),
    "manually edited price saved", 20000);
  const afterManual = await generatedRows();
  const manualRow = afterManual.find(row => row.concept === edited.concept);
  assert.equal(manualRow.price_source_type, "user_edited", "manual edit must replace resolver provenance");
  assert.equal(Number(manualRow.price_confidence), 0.95);
  assert.ok(manualRow.price_checked_at instanceof Date);
  assert.ok(manualRow.price_checked_at.getTime() >= manualStart && manualRow.price_checked_at.getTime() <= Date.now());
  for (const original of persisted.filter(row => row.concept !== edited.concept)) {
    const current = afterManual.find(row => row.concept === original.concept);
    assert.deepEqual(current, original, "editing one price must preserve other lines and their provenance");
  }
  assert.deepEqual(generated.pageErrors, []);
  console.log("PASS G3 USER_EDITED: actual price input -> real save_budget -> user_edited / 0.95 / edit timestamp");

  // ---- G3 A: UI → real analysis route → real RPC → budget_items ----
  modelEnabled = true;
  await db.query("delete from public.price_items");
  await db.query(await readFile(new URL("__tests__/support/budget-wizard-ai-fixtures.sql", root), "utf8"));
  await db.query(`insert into public.technical_price_items
    (name,item_code,unit,unit_price,confidence_score,source,region,is_active)
    values('Sellado técnico soporte G3','E2E-TECH-G3','m2',12.5,0.78,'Banco técnico de prueba','espana',true)`);
  await db.query("notify pgrst, 'reload schema'");
  const aiSeed = await fetch(`${restOrigin}/rpc/create_budget_with_items`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ p_budget_data: { title: "Pintura G3", budget_number: "WIZARD-G3" }, p_items: [] }),
  });
  assert.equal(aiSeed.status, 200, await aiSeed.clone().text());
  const { budget_id: aiId } = await aiSeed.json();
  await db.query("update public.budgets set wizard_state=$2 where id=$1", [aiId, JSON.stringify({
    title: "Pintura G3", sector: "construccion", serviceType: "reforma",
    description: "Pintura de paredes y techos", currentStep: 1,
    sectorData: { superficie_m2: 40, num_banos: 0, incluye_cocina: false,
      incluye_ventanas: false, incluye_climatizacion: false, actuaciones: ["pintura"],
      calidad: "media", ubicacion: "Madrid", estancias: [] },
  })]);
  const ai = await openWizard(aiId, "Pintura G3", { step: 1, ready: "Volver a calcular" });
  const aiResponses = [];
  ai.page.on("response", async response => {
    if (new URL(response.url()).pathname === "/api/prices/resolve")
      aiResponses.push(await response.json());
  });
  const startedAt = Date.now();
  const analysisResponse = ai.page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/agent/budget-analysis", { timeout: 90000 });
  await ai.page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(node => node.textContent?.includes("Volver a calcular"));
    if (!button || button.disabled) throw Error("Recalculation button unavailable");
    button.click();
  });
  const analysis = await analysisResponse;
  assert.equal(analysis.status(), 200, await analysis.text());
  const result = await analysis.json();
  assert.equal(result.data_sources.using_ai_fallback, false, JSON.stringify(result.data_sources));
  assert.equal(modelCalls, 1, "the real route must consume the local model response");
  await waitFor(async () => (await visibleText(ai.page)).includes("Pintura pared G3 6") &&
    (await visibleText(ai.page)).includes("Volver a calcular"), "completed AI recalculation");
  // Wait for content, never for provenance: mutation must fail the SQL
  // assertion with NULL rows, not time out or pass on an empty set.
  const savedLines = async () => (await db.query(`select concept, category, subtotal, unit_price_cost,
    price_source_type, price_confidence, price_checked_at
    from public.budget_items where budget_id=$1 order by sort_order`, [aiId])).rows;
  await waitFor(async () => (await savedLines()).filter(row => row.concept.startsWith("Pintura pared G3 ")).length === 7,
    "AI lines persisted by browser autosave", 20000);
  const lines = await savedLines();
  assert.equal(lines.length, 8, "all eight model lines must persist; the material basket lives in wizard_state");
  const missing = lines.filter(row => row.price_source_type === null).map(row => row.concept);
  assert.deepEqual(missing, [], `NULL en partidas NUEVAS de budget_items: ${missing.join(", ")}`);
  const aiLines = lines.filter(row => row.concept.startsWith("Pintura pared G3 "));
  assert.equal(aiLines.length, 7, "all seven model prices must reach PostgreSQL");
  for (const line of aiLines) {
    assert.equal(line.price_source_type, "ai_estimate", `A BIS: ${line.concept} must stay ai_estimate after resolver miss, not estimated`);
    assert.equal(Number(line.price_confidence), 0.20, line.concept);
    assert.ok(line.price_checked_at instanceof Date && line.price_checked_at.getTime() >= startedAt &&
      line.price_checked_at.getTime() <= Date.now(), `${line.concept}: current persisted timestamp`);
  }
  const technicalLine = lines.find(line => line.concept === "Sellado técnico soporte G3");
  assert.equal(result.suggested_items.find(line => line.concept === technicalLine.concept).price_source_type,
    "ai_estimate", "the model initially proposed the technically resolved line too");
  assert.equal(technicalLine.price_source_type, "technical_bank");
  assert.equal(Number(technicalLine.price_confidence), 0.78);
  assert.equal(Number(technicalLine.unit_price_cost), 12.5);
  const aiQuotes = aiResponses.flatMap(response => response.resolved || []);
  for (const line of aiLines) {
    const miss = aiQuotes.find(quote => quote.materialName === line.concept);
    assert.ok(miss, `${line.concept}: the real resolver must have run`);
    assert.equal(miss.sourceType, "estimated", "exercise the absolute no-source fallback");
    assert.equal(miss.selectedPrice, 0);
  }
  const total = lines.reduce((sum, line) => sum + Number(line.subtotal), 0);
  const weak = aiLines.reduce((sum, line) => sum + Number(line.subtotal), 0);
  const percentage = (Math.round(weak / total * 1000) / 10).toLocaleString("es-ES");
  const expectedSummary = `7 de 8 líneas sin fuente verificable — ${percentage} % del importe`;
  assert.ok((await ai.page.$eval('[data-testid="price-provenance-summary"]', node => node.innerText)).includes(expectedSummary));
  console.log(`PASS G3 SUMMARY BEFORE SAVE: ${expectedSummary}`);
  // No explicit save was needed for the summary. Now save and read the detail
  // page, which loads its own budget_items through real PostgREST.
  const writeStart = writeCalls().length;
  await ai.page.evaluate(() => [...document.querySelectorAll("button")]
    .find(node => node.textContent?.trim() === "Guardar borrador")?.click());
  await waitFor(async () => writeCalls().slice(writeStart).some(call => call.path === "/rpc/save_budget" &&
    call.status === 200 && call.payload.p_budget_id === aiId), "AI explicit save");
  assert.ok((await visibleText(ai.page)).includes("Estimación IA · sin fuente técnica"));
  assert.deepEqual(ai.pageErrors, []);
  const detailResponse = await ai.page.goto(`${appOrigin}/dashboard/budgets/${aiId}`, {
    waitUntil: "domcontentloaded", timeout: 90000,
  });
  assert.equal(detailResponse.status(), 200);
  await ai.page.waitForSelector('[data-testid="price-provenance-summary"]', { timeout: 30000 });
  assert.ok((await ai.page.$eval('[data-testid="price-provenance-summary"]', node => node.innerText)).includes(expectedSummary));
  assert.deepEqual(ai.pageErrors, []);
  console.log(`PASS G3 SUMMARY SAVED DETAIL: ${expectedSummary}`);
  console.log("PASS A BIS: real resolver misses preserve 7 ai_estimate / 0.20; matched AI line adopts technical_bank / 0.78");
  console.log(`PASS G3 PostgreSQL 17: ${lines.length} líneas nuevas en budget_items, 0 NULL; 7 ai_estimate con confianza 0.20 y fecha actual`);

  // ---- G3 phase 4: actual inline collection -> bank -> a later generated budget ----
  const ownConcept = "Pintura pared G3 0";
  const ownPrice = 37.5;
  const ownInput = 'tbody tr:first-child input[aria-label="Tu precio por m2"]';
  await ai.page.waitForSelector(ownInput);
  await ai.page.locator(ownInput).fill(String(ownPrice));
  await ai.page.evaluate(() => [...document.querySelectorAll("tbody tr:first-child button")]
    .find(button => button.textContent?.trim() === "Guardar mi precio")?.click());
  try {
    await waitFor(async () => (await db.query("select unit_price_cost from public.budget_items where budget_id=$1 and concept=$2",
      [aiId, ownConcept])).rows.some(row => Number(row.unit_price_cost) === ownPrice), "own price saved in first budget", 20000);
  } catch (error) {
    throw Error(`Own price collection failed: ${JSON.stringify(requests.slice(-25))}; UI=${await visibleText(ai.page)}; errors=${JSON.stringify(ai.pageErrors)}`, { cause: error });
  }
  const collected = (await db.query("select * from public.budget_items where budget_id=$1 and concept=$2", [aiId, ownConcept])).rows[0];
  assert.equal(collected.price_source_type, "user_supplied");
  assert.equal(Number(collected.price_confidence), 0.95);
  await waitFor(async () => (await ai.page.$eval('[data-testid="price-provenance-summary"]', node => node.innerText)).includes("6 de 8"),
    "saved detail summary drops after own price");
  const correctedTotal = (await db.query("select subtotal from public.budget_items where budget_id=$1", [aiId])).rows.reduce((sum, row) => sum + Number(row.subtotal), 0);
  const correctedWeak = lines.filter(row => row.concept !== ownConcept && row.price_source_type === "ai_estimate").reduce((sum, row) => sum + Number(row.subtotal), 0);
  const correctedPercent = (Math.round(correctedWeak / correctedTotal * 1000) / 10).toLocaleString("es-ES");
  assert.ok((await ai.page.$eval('[data-testid="price-provenance-summary"]', node => node.innerText))
    .includes(`6 de 8 líneas sin fuente verificable — ${correctedPercent} % del importe`));
  // Queries alone, including a rejected unit, must not count as a reuse.
  async function quoteOwn(unit) {
    return ai.page.evaluate(async (name, unit) => {
      const response = await fetch("/api/prices/resolve", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ materials: [{ materialName: name, unit, quantity: 40, category: "mano_obra", qualityTier: "media" }], sector: "construccion", includeCommercialCatalog: false }) });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    }, ownConcept, unit);
  }
  const wrongUnit = await quoteOwn("ud");
  assert.notEqual(wrongUnit.resolved.find(row => row.materialName === ownConcept)?.sourceType, "manual_locked", "same name in another unit must not adopt own price");
  await quoteOwn("m2");
  const stats = async () => {
    const response = await fetch(`${restOrigin}/rpc/get_user_price_collection_stats`, { method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` }, body: "{}" });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  assert.equal((await stats()).reused, 0, "resolver lookups are not persisted reuses");
  const laterSeed = await fetch(`${restOrigin}/rpc/create_budget_with_items`, { method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ p_budget_data: { title: "Pintura propia posterior", budget_number: "WIZARD-OWN-SECOND" }, p_items: [] }) });
  assert.equal(laterSeed.status, 200, await laterSeed.clone().text());
  const { budget_id: laterId } = await laterSeed.json();
  const wizardState = (await db.query("select wizard_state from public.budgets where id=$1", [aiId])).rows[0].wizard_state;
  await db.query("update public.budgets set wizard_state=$2 where id=$1", [laterId, JSON.stringify({
    ...wizardState, title: "Pintura propia posterior", partidas: [], materials: [], currentStep: 1,
  })]);
  const later = await openWizard(laterId, "Pintura propia posterior", { step: 1, ready: "Volver a calcular" });
  await later.page.evaluate(() => [...document.querySelectorAll("button")]
    .find(button => button.textContent?.includes("Volver a calcular"))?.click());
  await waitFor(async () => (await visibleText(later.page)).includes("Pintura pared G3 6") &&
    (await visibleText(later.page)).includes("Volver a calcular"), "second generation completed");
  await waitFor(async () => (await db.query("select count(*)::int as n from public.budget_items where budget_id=$1", [laterId])).rows[0].n === 8,
    "second generated budget persisted", 30000);
  const reused = (await db.query("select * from public.budget_items where budget_id=$1 and concept=$2", [laterId, ownConcept])).rows[0];
  // First bank assertion intentionally occurs AFTER this persisted adoption:
  // deleting the bank write must fail on the second budget's missing source.
  assert.equal(reused.price_source_type, "manual_locked", "G3 OWN REUSE: second budget must resolve collected price, not remain without source");
  assert.equal(Number(reused.unit_price_cost), ownPrice);
  assert.equal(Number(reused.price_confidence), 1);
  const bank = (await db.query("select * from public.price_items where id=$1", [collected.price_item_id])).rows[0];
  assert.ok(bank);
  assert.equal(bank.user_id, owner);
  assert.equal(bank.name, ownConcept);
  assert.equal(bank.unit, "m2");
  assert.equal(Number(bank.unit_price), ownPrice);
  assert.equal(bank.is_manual_override, true);
  assert.equal(reused.price_item_id, bank.id);
  assert.deepEqual(await stats(), { saved: 1, reused: 1 });
  const saveAgain = await fetch(`${restOrigin}/rpc/save_budget`, { method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ p_budget_id: laterId,
      p_expected_lock_version: (await db.query("select lock_version from public.budgets where id=$1", [laterId])).rows[0].lock_version,
      p_budget_data: { title: "Pintura propia posterior" }, p_items: (await db.query("select * from public.budget_items where budget_id=$1 order by sort_order", [laterId])).rows }) });
  assert.equal(saveAgain.status, 200, await saveAgain.clone().text());
  assert.deepEqual(await stats(), { saved: 1, reused: 1 }, "autosave must not count the same price/budget twice");
  // RLS: nobody can manufacture counters or read somebody else's collection.
  const outsider = token("authenticated", "22222222-2222-4222-8222-222222222222");
  const outsiderStats = await fetch(`${restOrigin}/rpc/get_user_price_collection_stats`, { method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${outsider}` }, body: "{}" });
  assert.deepEqual(await outsiderStats.json(), { saved: 0, reused: 0 });
  const forged = await fetch(`${restOrigin}/user_price_collection_events`, { method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ user_id: owner, price_item_id: bank.id, budget_id: aiId, event_kind: "reused" }) });
  assert.equal(forged.status, 403, "authenticated users cannot forge instrumentation");
  // A persisted row is not enough by itself: it must actually adopt this bank
  // price in a later budget. Exercise all trigger guards through the real RPC.
  const rejectedSeed = await fetch(`${restOrigin}/rpc/save_budget`, { method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ p_budget_id: generatedId,
      p_expected_lock_version: (await db.query("select lock_version from public.budgets where id=$1", [generatedId])).rows[0].lock_version,
      p_budget_data: { title: generatedTitle },
      p_items: [
        { unit: "ud", unit_price_cost: ownPrice, price_source_type: "manual_locked", price_checked_at: new Date().toISOString() },
        { unit: "m2", unit_price_cost: ownPrice + 1, price_source_type: "manual_locked", price_checked_at: new Date().toISOString() },
        { unit: "m2", unit_price_cost: ownPrice, price_source_type: "user_edited", price_checked_at: new Date().toISOString() },
        { unit: "m2", unit_price_cost: ownPrice, price_source_type: "manual_locked", price_checked_at: "2020-01-01T00:00:00Z" },
      ].map(line => ({ ...line, concept: ownConcept, quantity: 1, unit_price: ownPrice, price_item_id: bank.id })) }) });
  assert.equal(rejectedSeed.status, 200, await rejectedSeed.clone().text());
  assert.deepEqual(await stats(), { saved: 1, reused: 1 }, "wrong unit/amount/source and pre-collection evidence are not counted");
  const ownWizard = await openWizard(aiId, "Pintura G3", { step: 1, ready: "Volver a calcular" });
  assert.ok((await visibleText(ownWizard.page)).includes("Tu precio · guardado en Precios"), "detail correction survives wizard hydration");
  const targetConcept = "Pintura pared G3 6";
  const wizardOwn = 'tbody tr:nth-child(7) input[aria-label="Tu precio por m2"]';
  await ownWizard.page.locator(wizardOwn).fill("22.5");
  await waitFor(async () => ownWizard.page.evaluate(() => ![...document.querySelectorAll("tbody tr:nth-child(7) button")]
    .find(button => button.textContent?.trim() === "Guardar mi precio")?.disabled), "wizard collection enabled");
  await ownWizard.page.evaluate(() => [...document.querySelectorAll("tbody tr:nth-child(7) button")]
    .find(button => button.textContent?.trim() === "Guardar mi precio")?.click());
  await waitFor(async () => (await db.query("select price_source_type,unit_price_cost from public.budget_items where budget_id=$1 and concept=$2",
    [aiId, targetConcept])).rows.some(line => line.price_source_type === "user_supplied" && Number(line.unit_price_cost) === 22.5),
    "wizard inline collection autosaved", 20000);
  assert.equal(Number((await db.query("select price_confidence from public.budget_items where budget_id=$1 and concept=$2", [aiId, targetConcept])).rows[0].price_confidence), 0.95);
  assert.deepEqual(await stats(), { saved: 2, reused: 1 });
  assert.ok((await ownWizard.page.$eval('[data-testid="price-provenance-summary"]', node => node.innerText)).includes("5 de 8"));
  assert.deepEqual(ownWizard.pageErrors, []);
  console.log("PASS G3 OWN WIZARD: detail edit survives hydration; inline assistant collection -> user_supplied / 0.95; summary drops again; saved=2 reused=1");
  const rollback = await readFile(new URL("docs/fase3/G3-OWN-PRICES-ROLLBACK.sql", root), "utf8");
  await assert.rejects(db.query(rollback), /Export and review own-price instrumentation before rollback/);
  await db.query("rollback");
  assert.deepEqual(await stats(), { saved: 2, reused: 1 }, "rollback gate refuses to discard live collection events");
  assert.deepEqual(later.pageErrors, []);
  assert.deepEqual(ai.pageErrors, []);
  console.log(`PASS G3 OWN COLLECTION: inline detail -> user_supplied / 0.95; price_items manual override ${ownPrice} EUR/m2; summary ${correctedPercent}%`);
  console.log("PASS G3 OWN REUSE: second real generated budget -> manual_locked; wrong unit rejected; counters saved=1 reused=1; queries/autosave do not inflate; RLS enforced");

  assert.deepEqual(first.pageErrors, []);
  assert.deepEqual(second.pageErrors, []);
  assert.deepEqual(final.pageErrors, []);
  console.log("PASS: wizard hydrates without writing, autosaves, rejects a stale tab, finalizes through PostgREST and keeps a legacy budget items");
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
