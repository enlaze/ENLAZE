/**
 * «Ingresos del mes» del Centro de control tiene que cuadrar con «Cobrado»
 * de Facturación: facturas emitidas pagadas, sin anuladas ni cobros parciales.
 *
 *   node --import tsx --test __tests__/dashboard-income.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { collectedInMonth, invoicedInMonth, isCollected } from "../lib/dashboard-income.ts";

const OCT = { month: 9, year: 2026 };
const SEP = { month: 8, year: 2026 };

const invoices = [
  // Cobradas en octubre (como F-2026/0012 y 0013 de la demo).
  { status: "paid", payment_status: "paid", total: 1754.5, issue_date: "2026-10-06", payment_date: "2026-10-23" },
  { status: "paid", payment_status: "paid", total: "1064.80", issue_date: "2026-10-14", payment_date: "2026-10-23" },
  // Emitida en septiembre, cobrada en octubre: ingreso de octubre.
  { status: "paid", payment_status: "paid", total: 500, issue_date: "2026-09-20", payment_date: "2026-10-02" },
  // Pendientes y vencidas: facturadas, no cobradas.
  { status: "sent", payment_status: "pending", total: 1240, issue_date: "2026-09-05" },
  { status: "sent", payment_status: "pending", total: 3751, issue_date: "2026-10-03" },
  // Cobro parcial: Facturación no lo cuenta como cobrado.
  { status: "sent", payment_status: "partial", total: 900, issue_date: "2026-10-10", payment_date: null },
  // Anulada aunque figure pagada: fuera de todo.
  { status: "cancelled", payment_status: "paid", total: 999, issue_date: "2026-10-01", payment_date: "2026-10-05" },
  // Factura antigua sin payment_date: cae en el mes de emisión.
  { status: "paid", payment_status: "paid", total: 200, issue_date: "2026-09-12", payment_date: null },
];

test("lo cobrado va al mes del cobro", () => {
  assert.equal(collectedInMonth(invoices, OCT), 1754.5 + 1064.8 + 500);
  assert.equal(collectedInMonth(invoices, SEP), 200);
});

test("la suma de los meses es el «Cobrado» de Facturación", () => {
  const cobradoFacturacion = invoices
    .filter((i) => i.status !== "cancelled" && i.payment_status === "paid")
    .reduce((s, i) => s + Number(i.total || 0), 0);
  assert.equal(collectedInMonth(invoices, OCT) + collectedInMonth(invoices, SEP), cobradoFacturacion);
});

test("lo facturado va al mes de emisión y no cuenta anuladas", () => {
  assert.equal(invoicedInMonth(invoices, OCT), 1754.5 + 1064.8 + 3751 + 900);
  assert.equal(invoicedInMonth(invoices, SEP), 500 + 1240 + 200);
});

test("invoice_date solo como respaldo de issue_date", () => {
  const legacy = [{ status: "sent", payment_status: "pending", total: 100, issue_date: null, invoice_date: "2026-10-01" }];
  assert.equal(invoicedInMonth(legacy, OCT), 100);
});

test("ni parciales ni anuladas son cobradas", () => {
  assert.equal(isCollected({ status: "sent", payment_status: "partial", total: 1 }), false);
  assert.equal(isCollected({ status: "cancelled", payment_status: "paid", total: 1 }), false);
  assert.equal(isCollected({ status: "paid", payment_status: "paid", total: 1 }), true);
});
