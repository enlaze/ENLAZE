// El proxy deja pasar a n8n solo en las rutas de /api/agent que llama, una
// por una, y solo si trae Authorization Bearer (la ruta comprueba la clave).
// Todo lo demás de /api/agent sigue exigiendo sesión en el proxy.
//
// OJO (2026-10-11): estas pruebas llaman a proxy() directamente. En el
// servidor real, Next ignora hoy el 401 del proxy en /api/* porque esa
// respuesta copia la cabecera x-middleware-next de NextResponse.next() y la
// petición sigue hasta la ruta. Ver informes/2026-10-11-b9-proxy-n8n.md.
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// createServerClient necesita URL y clave; no se llega a hacer ninguna
// petición de red útil: sin cookies no hay sesión.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "anon-de-prueba";

const { proxy } = await import("../proxy.ts");

const N8N_ROUTES = [
  "/api/agent/users",
  "/api/agent/config",
  "/api/agent/news",
  "/api/agent/ingest",
  "/api/agent/calendar/summary",
  "/api/agent/gmail/summary",
  "/api/agent/market/summary",
  "/api/agent/reputation/summary",
  "/api/agent/sheets/summary",
];

function req(path, headers = {}) {
  return new NextRequest(new URL(path, "https://enlaze.test"), { headers });
}

// Ojo: el 401 del proxy copia las cabeceras de la respuesta, x-middleware-next
// incluida; por eso se mira también el estado.
const passedThrough = (res) =>
  res.status === 200 && res.headers.get("x-middleware-next") === "1";

test("las rutas de n8n con Bearer llegan a la ruta (que comprueba la clave)", async () => {
  for (const path of N8N_ROUTES) {
    const res = await proxy(req(`${path}?user_id=x`, { authorization: "Bearer cualquiera" }));
    assert.ok(passedThrough(res), `${path} debería pasar el proxy`);
  }
});

test("las rutas de n8n sin Bearer siguen exigiendo sesión en el proxy", async () => {
  for (const path of N8N_ROUTES) {
    const res = await proxy(req(path));
    assert.equal(res.status, 401, `${path} sin Bearer debería dar 401 del proxy`);
  }
});

test("el resto de /api/agent no se abre aunque traiga Bearer", async () => {
  for (const path of [
    "/api/agent/budgets/generate",
    "/api/agent/budget-analysis",
    "/api/agent/daily-briefing",
    "/api/agent/sheets/list",
    "/api/agent/market/prices",
    "/api/agent/market/analysis",
    "/api/agent/gmail/action/create-draft",
    "/api/agent/calendar/action/create-event",
    "/api/agent/sheets/action/append-row",
    // ni prefijos ni variaciones de una ruta abierta
    "/api/agent/users/otra",
    "/api/agent/users/",
    "/api/agent",
  ]) {
    const res = await proxy(req(path, { authorization: "Bearer cualquiera" }));
    assert.equal(res.status, 401, `${path} no debería pasar el proxy`);
  }
});
