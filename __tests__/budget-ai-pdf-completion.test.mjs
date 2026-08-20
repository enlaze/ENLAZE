import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateBudgetPDFHTML } from "../lib/pdf-generator.ts";

const budget = {
  budget_number: "PRE-2026-TEST",
  title: "Reforma de prueba",
  client_name: "Cliente Real",
  client_email: "cliente@example.com",
  client_phone: "600000000",
  client_address: "Calle de prueba, 1",
  service_type: "reforma",
  status: "pendiente",
  created_at: "2026-08-20T12:00:00.000Z",
  subtotal: 1000,
  iva_percent: 21,
  iva_amount: 210,
  total: 1210,
  notes: "NOTA INTERNA CONFIDENCIAL",
  conditions_text: "CONDICIONES COMERCIALES DEL CLIENTE",
};

const items = [{
  concept: "Partida de prueba",
  description: "Trabajo completo",
  category: "mano_obra",
  chapter: "demoliciones",
  quantity: 1,
  unit: "ud",
  unit_price: 1000,
  subtotal: 1000,
  subtotal_cost: 700,
}];

test("el PDF cliente incluye cliente y condiciones pero nunca notas internas", () => {
  const html = generateBudgetPDFHTML(budget, items, "client");
  assert.match(html, /Cliente Real/);
  assert.match(html, /cliente@example\.com/);
  assert.match(html, /CONDICIONES COMERCIALES DEL CLIENTE/);
  assert.doesNotMatch(html, /NOTA INTERNA CONFIDENCIAL/);
});

test("el PDF interno identifica las notas privadas e incluye las condiciones", () => {
  const html = generateBudgetPDFHTML(budget, items, "internal");
  assert.match(html, /USO INTERNO/);
  assert.match(html, /Notas internas - No enviar al cliente/);
  assert.match(html, /NOTA INTERNA CONFIDENCIAL/);
  assert.match(html, /CONDICIONES COMERCIALES DEL CLIENTE/);
  assert.match(html, /700\.00/);
});

test("el generador IA guarda la ficha del cliente, condiciones y notas", async () => {
  const provider = await readFile(
    new URL("../app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx", import.meta.url),
    "utf8",
  );
  const scope = await readFile(
    new URL("../app/dashboard/budgets/generate/_components/steps/ScopeStep.tsx", import.meta.url),
    "utf8",
  );

  assert.match(provider, /client_name: clientSnapshot\.name/);
  assert.match(provider, /client_email: clientSnapshot\.email/);
  assert.match(provider, /client_phone: clientSnapshot\.phone/);
  assert.match(provider, /conditions_text: state\.conditionsText/);
  assert.match(provider, /notes: state\.internalNotes/);
  assert.match(scope, /Condiciones del presupuesto/);
  assert.match(scope, /Notas internas/);
  assert.match(scope, /nunca aparecerán en el PDF del cliente/);
});

test("la pantalla final y la API ofrecen las dos variantes de PDF", async () => {
  const detailPage = await readFile(
    new URL("../app/dashboard/budgets/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const route = await readFile(
    new URL("../app/api/budgets/pdf/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(detailPage, /PDF cliente/);
  assert.match(detailPage, /PDF interno/);
  assert.match(detailPage, /exportPDF\("client"\)/);
  assert.match(detailPage, /exportPDF\("internal"\)/);
  assert.match(route, /body\.mode === "internal"/);
  assert.match(route, /X-Enlaze-PDF-Variant/);
  assert.match(route, /findInternalCost/);
});
