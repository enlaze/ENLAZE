// b13: el resumen diario calcula en código lo que la cuenta tiene en Enlaze
// (qué cobrar, a quién contestar, qué presupuesto mandar y subidas de precio).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBusinessFacts,
  daysBetween,
  madridToday,
  MAX_BUSINESS_ACTIONS,
} from "../lib/agent/business-facts.ts";

const TODAY = "2026-10-17";

function inv(over = {}) {
  return {
    id: "i1", invoice_number: "F-1", client_name: "Comunidad Pinar 8",
    total: 1240, amount_paid: 0, due_date: "2026-10-05", status: "sent", payment_status: "pending",
    ...over,
  };
}
function bud(over = {}) {
  return {
    id: "b1", title: "Reforma de baño", client_name: "Marta Soler", total: 4860,
    status: "enviado", sent_at: "2026-10-14T09:00:00Z", updated_at: "2026-10-14T09:00:00Z", valid_until: "2026-11-13",
    ...over,
  };
}
function note(over = {}) {
  return {
    id: "n1", product_name: "Cemento cola", provider_name: "Almacenes Vinalopó",
    old_price: 12.9, new_price: 14.06, change_pct: 9, direction: "up", is_read: false,
    created_at: "2026-10-16T08:00:00Z", ...over,
  };
}
const empty = { today: TODAY, issuedInvoices: [], budgets: [], priceNotifications: [], receivedInvoices: [] };

test("sin datos no hay nada que contar", () => {
  const f = buildBusinessFacts(empty);
  assert.deepEqual(f.actions, []);
  assert.equal(f.headline, null);
  assert.equal(f.narrative, null);
});

test("qué cobrar: solo vencidas, sin cobrar y no anuladas; lo pendiente descuenta lo cobrado", () => {
  const f = buildBusinessFacts({
    ...empty,
    issuedInvoices: [
      inv(),
      inv({ id: "i2", invoice_number: "F-2", total: 630, amount_paid: 100, due_date: "2026-10-12" }),
      inv({ id: "i3", payment_status: "paid" }),
      inv({ id: "i4", status: "cancelled" }),
      inv({ id: "i5", status: "draft" }),
      inv({ id: "i6", due_date: "2026-10-17" }), // vence hoy: aún no
      inv({ id: "i7", due_date: null }),
      inv({ id: "i8", total: 500, amount_paid: 500 }),
    ],
  });
  assert.equal(f.overdue.count, 2);
  assert.equal(f.overdue.amount, 1240 + 530);
  const cobrar = f.actions.filter((a) => a.kind === "cobrar");
  assert.deepEqual(cobrar.map((a) => a.title), [
    "Reclamar la factura F-1 a Comunidad Pinar 8",
    "Reclamar la factura F-2 a Comunidad Pinar 8",
  ]);
  assert.equal(cobrar[0].reason, "1240 €, vencida hace 12 días. El recordatorio está preparado.".replace("1240", "1.240"));
  assert.equal(cobrar[1].reason, "530 €, vencida hace 5 días. El recordatorio está preparado.");
  assert.equal(cobrar[0].priority, "alta");
  assert.equal(cobrar[1].priority, "media");
  assert.equal(cobrar[0].href, "/dashboard/facturacion?tab=emitidas&reclamar=i1");
});

test("a quién contestar: enviados hace 2 días o más, vigentes y sin respuesta", () => {
  const f = buildBusinessFacts({
    ...empty,
    budgets: [
      bud(),
      bud({ id: "b2", sent_at: "2026-10-16T09:00:00Z" }), // ayer: aún no
      bud({ id: "b3", status: "aceptado" }),
      bud({ id: "b4", status: "rechazado" }),
      bud({ id: "b5", valid_until: "2026-10-10" }), // caducado
      bud({ id: "b6", sent_at: null }),
    ],
  });
  assert.equal(f.unanswered.count, 1);
  assert.deepEqual(f.actions.map((a) => [a.kind, a.title, a.reason]), [
    ["contestar", "Llamar a Marta Soler por el presupuesto «Reforma de baño»", "4860 €, enviado hace 3 días y sin respuesta.".replace("4860", "4.860")],
  ]);
  assert.equal(f.actions[0].href, "/dashboard/budgets/b1");
});

test("qué presupuesto mandar: los terminados (pendiente) sin enviar", () => {
  const f = buildBusinessFacts({
    ...empty,
    budgets: [
      bud({ id: "b7", title: "Cocina", client_name: "Javier Ruiz", total: 9099.2, status: "pendiente", sent_at: null, updated_at: "2026-10-15T10:00:00Z" }),
      bud({ id: "b8", status: "borrador", sent_at: null }),
    ],
  });
  assert.equal(f.toSend.count, 1);
  assert.equal(f.actions[0].kind, "enviar");
  assert.equal(f.actions[0].title, "Mandar el presupuesto «Cocina» a Javier Ruiz");
  assert.equal(f.actions[0].reason, "9.099,20 €. Está terminado y sin enviar desde hace 2 días.");
});

test("avisos de precio: subidas sin leer de la última semana", () => {
  const f = buildBusinessFacts({
    ...empty,
    priceNotifications: [
      note(),
      note({ id: "n2", direction: "down" }),
      note({ id: "n3", is_read: true }),
      note({ id: "n4", created_at: "2026-10-01T08:00:00Z" }),
    ],
  });
  assert.equal(f.priceRises.count, 1);
  assert.equal(f.actions[0].title, "Revisar el precio de Cemento cola");
  assert.equal(f.actions[0].reason, "Almacenes Vinalopó lo ha subido de 12,90 € a 14,06 € (+9 %).");
});

test("las acciones van por prioridad y se cortan en el máximo", () => {
  const many = Array.from({ length: 8 }, (_, i) =>
    inv({ id: `x${i}`, invoice_number: `F-${i}`, total: 100, due_date: "2026-10-15" }),
  );
  const f = buildBusinessFacts({ ...empty, issuedInvoices: many, budgets: [bud()], priceNotifications: [note()] });
  assert.equal(f.actions.length, MAX_BUSINESS_ACTIONS);
  // El presupuesto de 4.860 € es «alta»: va delante de los cobros pequeños («media»).
  assert.equal(f.actions[0].kind, "contestar");
});

test("titular y narrativa mecánicos, en castellano llano", () => {
  const f = buildBusinessFacts({
    ...empty,
    issuedInvoices: [inv(), inv({ id: "i2", total: 630, due_date: "2026-10-12" })],
    budgets: [bud()],
    priceNotifications: [note()],
  });
  assert.equal(f.headline, "Hoy toca cobrar 1.870 € y contestar un presupuesto");
  assert.equal(
    f.narrative,
    "Tienes 2 facturas vencidas que suman 1.870 €. Un presupuesto enviado sigue sin respuesta. Un proveedor ha subido el precio de un material que vigilas.",
  );
});

test("ojo con: facturas de proveedor sin pagar que vencen en 7 días o menos", () => {
  const r = (over) => ({ id: "r", supplier_name: "Cerámicas Levante", total: 1464.1, amount_paid: 0, due_date: "2026-10-20", status: "pending", payment_status: "unpaid", ...over });
  const f = buildBusinessFacts({
    ...empty,
    receivedInvoices: [r(), r({ id: "r2", due_date: "2026-11-30" }), r({ id: "r3", payment_status: "paid" }), r({ id: "r4", due_date: "2026-10-17", supplier_name: "Electro Baix", total: 99 })],
  });
  assert.deepEqual(f.watchOuts, [
    "Hoy vence la factura de Electro Baix (99 €).",
    "La factura de Cerámicas Levante (1.464,10 €) vence en 3 días.",
  ]);
});

test("fechas: días entre dos días y hoy en Madrid", () => {
  assert.equal(daysBetween("2026-10-05", "2026-10-17"), 12);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2); // cambio de hora
  // 23:30 UTC del 17 ya es el 18 en Madrid (UTC+2 en octubre).
  assert.equal(madridToday(new Date("2026-10-17T23:30:00Z")), "2026-10-18");
});
