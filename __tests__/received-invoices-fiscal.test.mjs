import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  receivedInvoiceDateRange, receivedInvoiceFiscalTotals, receivedInvoicesCsv,
} from "../lib/received-invoices.ts";
import FormModule from "../components/facturacion/ReceivedInvoiceForm.tsx";

const ReceivedInvoiceForm = FormModule.default ?? FormModule;

const invoice = {
  id: "recibida", invoice_number: "F-1", supplier_name: 'Proveedor; "uno"', supplier_nif: "B12345678",
  issue_date: "2026-09-30", projects: { name: "Obra centro" }, category: "material",
  subtotal: 100.01, iva_percent: 21, iva_amount: 21, irpf_percent: 15, irpf_amount: 15, total: 106.01, status: "approved",
};

test("periodos por fecha: trimestres, cambio de año y febrero bisiesto", () => {
  const range = (period, year, month = 1, quarter = 1) => Object.values(receivedInvoiceDateRange(period, year, month, quarter));
  assert.deepEqual(range("year", 2026), ["2026-01-01", "2026-12-31"]);
  assert.deepEqual(range("month", 2024, 2), ["2024-02-01", "2024-02-29"]);
  assert.deepEqual(range("month", 2025, 2), ["2025-02-01", "2025-02-28"]);
  assert.deepEqual(range("month", 2026, 12), ["2026-12-01", "2026-12-31"]);
  for (const [q, first, last] of [[1,"01-01","03-31"], [2,"04-01","06-30"], [3,"07-01","09-30"], [4,"10-01","12-31"]]) {
    assert.deepEqual(range("quarter", 2026, 1, q), [`2026-${first}`, `2026-${last}`]);
  }
});

test("resumen fiscal suma el conjunto completo en céntimos", () => {
  const invoices = Array.from({ length: 75 }, () => invoice);
  assert.deepEqual(receivedInvoiceFiscalTotals(invoices), { subtotal: 7500.75, iva: 1575, irpf: 1125, total: 7950.75 });
  assert.deepEqual(receivedInvoiceFiscalTotals([]), { subtotal: 0, iva: 0, irpf: 0, total: 0 });
});

test("CSV español: BOM, punto y coma, coma decimal, comillas, obras y estados", () => {
  const csv = receivedInvoicesCsv([invoice, { ...invoice, invoice_number: '=HYPERLINK("bad")', projects: null }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /"Proveedor; ""uno"""/);
  assert.match(csv, /"30\/09\/2026";"Obra centro";"Material";100,01;21,00;21,00;15,00;15,00;106,01;"Aprobada"/);
  assert.match(csv, /"'=HYPERLINK/);
  assert.equal(csv.split("\r\n").length, 4);
});

test("el formulario solo ofrece obras del cliente elegido y conserva la preselección", () => {
  const html = renderToStaticMarkup(React.createElement(ReceivedInvoiceForm, { state: {
    form: { invoice_number: "F-1", supplier_id: "", supplier_name: "Proveedor", supplier_nif: "", client_id: "a", project_id: "obra-a", category: "general", subtotal: "100", iva_percent: "21", irpf_percent: "0", issue_date: "2026-10-07", due_date: "", payment_method: "transferencia", notes: "" },
    suppliers: [], clients: [{ id: "a", name: "Cliente A" }, { id: "b", name: "Cliente B" }],
    projects: [{ id: "obra-a", name: "Obra elegida", client_id: "a" }, { id: "obra-b", name: "Obra ajena", client_id: "b" }],
  } }));
  assert.match(html, /value="obra-a" selected=""/);
  assert.ok(html.includes("Obra elegida"));
  assert.ok(!html.includes("Obra ajena"));
  assert.ok(html.includes("Categoría de gasto"));
});
