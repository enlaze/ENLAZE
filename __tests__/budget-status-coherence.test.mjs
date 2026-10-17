import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* b11: PRE-2026-53806 sale "Aceptado" con la línea de tiempo en "Rechazado".
   Lo dejó así el código de abril, que permitía cualquier cambio de estado y
   no borraba la fecha contraria. Estas pruebas fijan que no vuelva a pasar. */

const detail = readFileSync("app/dashboard/budgets/[id]/page.tsx", "utf8");

// Última definición de una función en las migraciones (por orden de nombre).
function latestDefinition(fn) {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let body = null;
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const at = sql.search(new RegExp(`create (or replace )?function public\\.${fn}\\(`, "i"));
    if (at >= 0) body = sql.slice(at, sql.indexOf("$fn$;", at) + 5);
  }
  assert.ok(body, `no se encuentra public.${fn}`);
  return body;
}

test("la línea de tiempo del presupuesto obedece al estado, no a la fecha", () => {
  const start = detail.indexOf("<AcceptanceTimeline");
  const block = detail.slice(start, detail.indexOf("/>", start));
  assert.match(block, /budget\.status === "rechazado"\s*\?\s*\{ label: "Rechazado"/);
  assert.match(block, /date: budget\.status === "aceptado" \? budget\.accepted_at : null/);
  assert.doesNotMatch(block, /budget\.rejected_at\s*\?/);
});

test("al cambiar el estado, la página deja las fechas como las deja la base", () => {
  const start = detail.indexOf("async function updateStatus(");
  const block = detail.slice(start, detail.indexOf("changeBudgetStatus(", start));
  assert.match(block, /accepted_at: newStatus === "aceptado" \? now : null/);
  assert.match(block, /rejected_at: newStatus === "rechazado" \? now : null/);
  assert.doesNotMatch(block, /!budget\.(accepted|rejected)_at/);
});

test("la base solo permite enviado → aceptado/rechazado y borra la fecha contraria", () => {
  const change = latestDefinition("change_budget_status");
  assert.match(change, /b\.status in \('pendiente','pending'\) and p_status = 'enviado'/);
  assert.match(change, /b\.status in \('enviado','sent'\) and p_status in \('aceptado','rechazado'\)/);
  assert.match(change, /accepted_at = case when p_status = 'aceptado' then clock_timestamp\(\) else null end/);
  assert.match(change, /rejected_at = case when p_status = 'rechazado' then clock_timestamp\(\) else null end/);

  const portal = latestDefinition("portal_respond_to_budget");
  assert.match(portal, /accepted_at = case when v_status = 'aceptado' then clock_timestamp\(\) else null end/);
  assert.match(portal, /rejected_at = case when v_status = 'rechazado' then clock_timestamp\(\) else null end/);
});

test("un presupuesto contractual con importe necesita partidas", () => {
  const dir = "supabase/migrations";
  const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  assert.match(sql, /b\.total > 0 and jsonb_array_length\(p_items\) = 0 then\s*raise exception 'A contractual budget with positive total requires items'/);
});

/* b11, decisión de Daniil (2026-10-17): la cesta de materiales deja de
   guardarse como partidas. Ya está dentro del coste de las partidas y no suma
   al subtotal; guardada como líneas, «Partidas» sumaba más que el subtotal. */

const wizard = readFileSync("app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx", "utf8");
const pdfRoute = readFileSync("app/api/budgets/pdf/route.ts", "utf8");

test("el asistente guarda como partidas solo las partidas, no la cesta", () => {
  const start = wizard.indexOf("const revisionItems = () => {");
  const block = wizard.slice(start, wizard.indexOf("const revisionPayload = (", start));
  assert.ok(start >= 0);
  assert.doesNotMatch(block, /state\.materials|Material sugerido|category: "material"/);
});

test("la cesta sigue guardada en wizard_state para que el asistente la recargue", () => {
  assert.match(wizard, /wizard_state: \{\s*\.\.\.state,/);
});

test("el PDF solo busca el coste en la cesta para las filas antiguas «Material sugerido»", () => {
  assert.match(pdfRoute, /item\.description === "Material sugerido" && Array\.isArray\(state\.materials\)/);
  assert.doesNotMatch(pdfRoute, /item\.category === "material" && Array\.isArray\(state\.materials\)/);
});
