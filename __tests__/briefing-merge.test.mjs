// b13: el resumen del agente y los hechos de la cuenta se juntan sin que uno
// pise al otro. Lo que ya hacía el resumen (Gmail, Calendar...) no se pierde.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildBusinessFacts } from "../lib/agent/business-facts.ts";
import { mergeBriefing, MAX_CARD_ACTIONS } from "../lib/agent/briefing-merge.ts";

const TODAY = "2026-10-17";

const agent = (over = {}) => ({
  id: "s1",
  executionDate: TODAY,
  headline: "Hoy tienes dos citas y un email de un cliente",
  narrative: "Narrativa del agente.",
  actions: [{ title: "Contestar a Laura por email", reason: "Pregunta por la obra", priority: "media" }],
  opportunities: ["Feria del sector el jueves"],
  watchOuts: ["Lluvia el viernes"],
  aiWritten: true,
  ...over,
});

const facts = buildBusinessFacts({
  today: TODAY,
  issuedInvoices: [{ id: "i1", invoice_number: "F-9", client_name: "Comunidad Pinar 8", total: 1240, amount_paid: 0, due_date: "2026-10-05", status: "sent", payment_status: "pending" }],
  budgets: [],
  priceNotifications: [],
  receivedInvoices: [{ id: "r1", supplier_name: "Cerámicas Levante", total: 300, amount_paid: 0, due_date: "2026-10-20", status: "pending", payment_status: "unpaid" }],
});
const noFacts = buildBusinessFacts({ today: TODAY, issuedInvoices: [], budgets: [], priceNotifications: [], receivedInvoices: [] });

test("resumen de hoy: se respeta entero y los hechos van delante", () => {
  const m = mergeBriefing(agent(), facts, TODAY);
  assert.equal(m.summaryId, "s1");
  assert.equal(m.headline, "Hoy tienes dos citas y un email de un cliente");
  assert.equal(m.narrative, "Narrativa del agente.");
  assert.equal(m.aiWritten, true);
  assert.deepEqual(m.actions.map((a) => a.title), [
    "Reclamar la factura F-9 a Comunidad Pinar 8",
    "Contestar a Laura por email",
  ]);
  assert.equal(m.actions[0].href, "/dashboard/facturacion?tab=emitidas&reclamar=i1");
  assert.equal(m.actions[0].hrefLabel, "Ver el recordatorio");
  assert.deepEqual(m.opportunities, ["Feria del sector el jueves"]);
  assert.deepEqual(m.watchOuts, ["La factura de Cerámicas Levante (300 €) vence en 3 días.", "Lluvia el viernes"]);
});

test("resumen de hoy sin hechos: queda exactamente como antes", () => {
  const a = agent();
  const m = mergeBriefing(a, noFacts, TODAY);
  assert.deepEqual(
    { headline: m.headline, narrative: m.narrative, actions: m.actions, opportunities: m.opportunities, watchOuts: m.watchOuts, aiWritten: m.aiWritten },
    { headline: a.headline, narrative: a.narrative, actions: a.actions, opportunities: a.opportunities, watchOuts: a.watchOuts, aiWritten: true },
  );
});

test("resumen viejo con hechos: manda lo de hoy y no se mezcla lo viejo", () => {
  const m = mergeBriefing(agent({ executionDate: "2026-10-05" }), facts, TODAY);
  assert.equal(m.summaryId, `negocio-${TODAY}`);
  assert.equal(m.date, TODAY);
  assert.equal(m.headline, "Hoy toca cobrar 1.240 €");
  assert.equal(m.aiWritten, false);
  assert.ok(m.actions.every((a) => a.title !== "Contestar a Laura por email"));
});

test("resumen viejo sin hechos: se enseña como hasta ahora", () => {
  const m = mergeBriefing(agent({ executionDate: "2026-10-05" }), noFacts, TODAY);
  assert.equal(m.summaryId, "s1");
  assert.equal(m.date, "2026-10-05");
  assert.equal(m.aiWritten, true);
});

test("sin agente: los hechos bastan para tener resumen; sin nada, null", () => {
  const m = mergeBriefing(null, facts, TODAY);
  assert.equal(m.hasBusinessFacts, true);
  assert.equal(m.narrative, "Tienes una factura vencida de 1.240 €.");
  assert.equal(mergeBriefing(null, noFacts, TODAY), null);
  assert.equal(mergeBriefing(null, null, TODAY), null);
});

test("la tarjeta no pasa del máximo de acciones", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ title: `A${i}` }));
  const m = mergeBriefing(agent({ actions: many }), facts, TODAY);
  assert.equal(m.actions.length, MAX_CARD_ACTIONS);
  assert.equal(m.actions[0].title, "Reclamar la factura F-9 a Comunidad Pinar 8");
});

test("la tarjeta del panel usa la mezcla y carga los hechos de la cuenta", () => {
  const src = readFileSync("components/dashboard/AgentExperience.tsx", "utf8");
  assert.match(src, /mergeBriefing\(agent, businessFacts, madridToday\(\)\)/);
  for (const table of ["issued_invoices", "budgets", "price_alert_notifications", "received_invoices"]) {
    assert.match(src, new RegExp(`\\.from\\("${table}"\\)`), table);
  }
  // Las consultas de los hechos filtran por el usuario, como las del agente.
  const block = src.slice(src.indexOf("Hechos de la propia cuenta para el resumen"), src.indexOf("setBusinessFacts("));
  assert.equal((block.match(/\.eq\("user_id", user\.id\)/g) || []).length, 4);
});
