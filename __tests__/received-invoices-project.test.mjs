import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { receivedInvoiceCostTotals } from "../lib/received-invoices.ts";

test("coste de obra: importes pagados parciales, pendientes y céntimos", () => {
  assert.deepEqual(receivedInvoiceCostTotals([
    { total: 100.10, amount_paid: 25.05, status: "partial" },
    { total: 50.20, amount_paid: 50.20, status: "paid" },
    { total: 80, amount_paid: null, status: "approved" },
  ]), { total: 230.30, paid: 75.25, pending: 155.05 });
  assert.deepEqual(receivedInvoiceCostTotals([{ total: 100, amount_paid: 40, status: "paid" }]),
    { total: 100, paid: 40, pending: 60 }, "prevalece el importe realmente pagado sobre la etiqueta");
  assert.deepEqual(receivedInvoiceCostTotals([]), { total: 0, paid: 0, pending: 0 });
});

test("la obra carga recibidas completas solo por project_id y conserva ese contexto al dar de alta", () => {
  const source = readFileSync(new URL("../app/dashboard/projects/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /getAllReceivedInvoices\(supabase, \{ project_id: pid \}\)/);
  assert.doesNotMatch(source, /invoiceFilter|from\("invoices"\)/);
  assert.match(source, /receivedInvoiceCostTotals\(invoices\)/);
  assert.match(source, /facturacion\?tab=recibidas&project=\$\{project.id\}/);
});
