// El proxy protege /api de verdad: sin sesión responde él mismo 401, sin la
// cabecera x-middleware-next que hacía que Next lo ignorase (b12). Una prueba
// por cada tipo de llamante, y las listas de rutas sin sesión fijadas aquí
// para que nadie las amplíe sin darse cuenta.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

// Sin red: la sesión de prueba se responde con este fetch falso.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://prueba.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-de-prueba";
const SESSION_COOKIE = "sb-prueba-auth-token";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://prueba.supabase.co/auth/v1/user")) return realFetch(input, init);
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  if (headers.get("authorization") !== "Bearer token-de-sesion") {
    return Response.json({ msg: "invalid JWT" }, { status: 401 });
  }
  return Response.json({ id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated" });
};

const { proxy } = await import("../proxy.ts");
const { PUBLIC_API_ROUTES, BEARER_API_ROUTES, isPublicApiRoute, isBearerApiCall } = await import(
  "../lib/proxy-routes.ts"
);

function req(path, headers = {}) {
  return new NextRequest(new URL(path, "https://enlaze.test"), { headers });
}

function sessionCookie() {
  const session = {
    access_token: "token-de-sesion",
    refresh_token: "refresco",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "00000000-0000-0000-0000-000000000001" },
  };
  return `${SESSION_COOKIE}=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

const passedThrough = (res) => res.headers.get("x-middleware-next") === "1";

async function assertProxy401(res, path) {
  assert.equal(res.status, 401, `${path}: debería dar 401 del proxy`);
  assert.equal(res.headers.get("x-middleware-next"), null, `${path}: el 401 no puede llevar x-middleware-next`);
  assert.deepEqual(await res.json(), { error: "No autorizado" });
  assert.equal(res.headers.get("x-frame-options"), "DENY", `${path}: sin cabeceras de seguridad`);
}

// Todas las rutas de app/api, con los segmentos [id] rellenos.
function apiRoutes(dir = "app/api") {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return apiRoutes(path);
    return entry === "route.ts" ? [dir.replace(/^app/, "").replace(/\[[^\]]+\]/g, "x")] : [];
  });
}
const ROUTES = apiRoutes();
const PROTECTED = ROUTES.filter((p) => !isPublicApiRoute(p));

test("las listas de rutas sin sesión son exactamente estas", () => {
  assert.deepEqual(PUBLIC_API_ROUTES, [
    "/api/auth",
    "/api/webhook",
    "/api/webhooks",
    "/api/signatures/public",
    "/api/signatures/verify-otp",
    "/api/signatures/send-otp",
    "/api/pb/ingest",
    "/api/pb/sync/run",
    "/api/prices/n8n-sync",
    "/api/technical-prices/import",
    "/api/billing/webhook",
    "/api/prices/process-alerts",
    "/api/prices/weekly-report/send",
  ]);
  assert.deepEqual(BEARER_API_ROUTES, [
    "/api/agent/users",
    "/api/agent/config",
    "/api/agent/news",
    "/api/agent/ingest",
    "/api/agent/calendar/summary",
    "/api/agent/gmail/summary",
    "/api/agent/market/summary",
    "/api/agent/reputation/summary",
    "/api/agent/sheets/summary",
    "/api/pb/webhook",
    "/api/internal/anon-privileges-check",
    "/api/cron/dispatch-scheduled",
  ]);
  // Cada ruta de las listas existe de verdad.
  for (const route of [...PUBLIC_API_ROUTES, ...BEARER_API_ROUTES]) {
    assert.ok(ROUTES.some((p) => p === route || p.startsWith(route + "/")), `${route} no existe`);
  }
});

test("sin nada: toda ruta protegida de /api recibe el 401 del proxy, que no sigue hasta la ruta", async () => {
  assert.ok(PROTECTED.length > 40, `solo ${PROTECTED.length} rutas protegidas`);
  for (const path of PROTECTED) await assertProxy401(await proxy(req(path)), path);
});

test("con sesión: el dashboard llega a sus rutas", async () => {
  for (const path of ["/api/billing/status", "/api/search", "/api/agent/gmail/summary", "/api/agent/sheets/list"]) {
    const res = await proxy(req(path, { cookie: sessionCookie() }));
    assert.ok(passedThrough(res), `${path} con sesión debería pasar (status ${res.status})`);
  }
  // Una cookie con un token que Supabase no reconoce no es sesión.
  const bad = sessionCookie().replace(
    /base64-.*/,
    "base64-" + Buffer.from(JSON.stringify({ access_token: "otro", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: {} })).toString("base64url"),
  );
  await assertProxy401(await proxy(req("/api/billing/status", { cookie: bad })), "cookie falsa");
});

test("con Bearer: los sistemas llegan a sus rutas, y solo a esas", async () => {
  for (const path of BEARER_API_ROUTES) {
    const res = await proxy(req(`${path}?user_id=x`, { authorization: "Bearer cualquiera" }));
    assert.ok(passedThrough(res), `${path} con Bearer debería llegar a la ruta`);
  }
  for (const path of PROTECTED.filter((p) => !BEARER_API_ROUTES.includes(p))) {
    await assertProxy401(await proxy(req(path, { authorization: "Bearer cualquiera" })), `${path} con Bearer`);
  }
  // Ni prefijos ni variaciones de una ruta abierta, ni otro esquema.
  for (const path of ["/api/agent/users/otra", "/api/agent/users/", "/api/agent", "/api/cron/otra", "/api/internal"]) {
    await assertProxy401(await proxy(req(path, { authorization: "Bearer cualquiera" })), path);
  }
  assert.equal(isBearerApiCall("/api/cron/dispatch-scheduled", "Basic abc"), false);
  assert.equal(isBearerApiCall("/api/cron/dispatch-scheduled", null), false);
});

test("Bearer falso: pasa el proxy, pero la propia ruta lo rechaza", () => {
  // Las rutas usan "server-only", que solo se deja importar con la condición
  // react-server: se llaman en un proceso aparte.
  const dir = mkdtempSync(join(tmpdir(), "proxy-bearer-"));
  const script = join(dir, "check.mjs");
  const root = resolve(".");
  writeFileSync(
    script,
    `
    process.env.AGENT_API_KEY = "agente-bueno";
    process.env.WEBHOOK_SECRET = "webhook-bueno";
    process.env.CRON_SECRET = "cron-bueno";
    process.env.ANON_PRIVILEGES_CHECK_TOKEN = "centinela-bueno";
    const { NextRequest } = await import(${JSON.stringify(join(root, "node_modules/next/server.js"))});
    const out = {};
    for (const [route, method] of ${JSON.stringify(
      BEARER_API_ROUTES.map((r) => [r, ["/api/agent/ingest", "/api/pb/webhook", "/api/cron/dispatch-scheduled"].includes(r) ? "POST" : "GET"]),
    )}) {
      const mod = await import(${JSON.stringify(root)} + "/app" + route + "/route.ts");
      const init = { method, headers: { authorization: "Bearer falso", "content-type": "application/json" } };
      if (method === "POST") init.body = "{}";
      const res = await mod[method](new NextRequest("https://enlaze.test" + route + "?user_id=x", init));
      out[route] = res.status;
    }
    console.log(JSON.stringify(out));
    `,
  );
  const stdout = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9" },
  });
  const statuses = JSON.parse(stdout.trim().split("\n").pop());
  for (const route of BEARER_API_ROUTES) {
    assert.equal(statuses[route], 401, `${route} con Bearer falso debería dar 401 de la ruta`);
  }
});

test("webhook de Stripe: llega a la ruta sin sesión (la ruta verifica la firma)", async () => {
  const res = await proxy(req("/api/billing/webhook", { "stripe-signature": "t=1,v1=falsa" }));
  assert.ok(passedThrough(res));
});

test("cron: con su Bearer llega a la ruta; sin él, 401 del proxy", async () => {
  const path = "/api/cron/dispatch-scheduled";
  assert.ok(passedThrough(await proxy(req(path, { authorization: "Bearer secreto-del-cron" }))));
  await assertProxy401(await proxy(req(path)), path);
  // La cabecera alternativa x-cron-secret ya no basta: el proxy pide Bearer.
  await assertProxy401(await proxy(req(path, { "x-cron-secret": "secreto-del-cron" })), `${path} con x-cron-secret`);
});

test("las páginas públicas y el dashboard siguen igual", async () => {
  for (const path of ["/", "/login", "/firmar/abc", "/portal/token"]) {
    assert.ok(passedThrough(await proxy(req(path))), `${path} debería ser pública`);
  }
  const res = await proxy(req("/dashboard/facturacion?tab=recibidas"));
  assert.equal(res.status, 307);
  assert.equal(new URL(res.headers.get("location")).searchParams.get("redirect"), "/dashboard/facturacion?tab=recibidas");
});
