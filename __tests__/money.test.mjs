/**
 * Unitarios de aritmética monetaria (lib/money.ts) y de la fuente única de
 * verdad matemática (lib/budget-totals.ts).
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const money = await import(path.join(root, "lib/money.ts"));
const totals = await import(path.join(root, "lib/budget-totals.ts"));

test("toCents absorbe el ruido de la coma flotante", () => {
  assert.equal(money.toCents(0.1), 10);
  assert.equal(money.toCents(0.2), 20);
  assert.equal(money.toCents(1.005), 101, "mitad hacia arriba pese a 1.005*100 = 100.49999...");
  assert.equal(money.toCents(9.5), 950);
  assert.equal(money.toCents(0), 0);
  assert.equal(money.toCents(null), 0);
  assert.equal(money.toCents("no es un numero"), 0);
  assert.equal(money.toCents(Infinity), 0);
});

test("fromCents invierte toCents sin perdida", () => {
  for (const euros of [0, 0.01, 0.1, 9.5, 1567.5, 12345.67]) {
    assert.equal(money.fromCents(money.toCents(euros)), euros);
  }
});

test("lineTotalCents es exacto con cantidades fraccionarias", () => {
  assert.equal(money.lineTotalCents(165, 9.5), 156750);
  assert.equal(money.lineTotalCents(12.5, 9.5), 11875);
  assert.equal(money.lineTotalCents(3, 33.33), 9999);
  assert.equal(money.lineTotalCents(0, 100), 0);
  assert.equal(money.lineTotalCents(1, 0), 0);
});

test("sumCents no acumula error", () => {
  const cents = Array.from({ length: 1000 }, () => money.toCents(0.1));
  assert.equal(money.sumCents(cents), 10000);
  assert.equal(money.fromCents(money.sumCents(cents)), 100);
});

test("percentOfCents redondea mitad hacia arriba", () => {
  assert.equal(money.percentOfCents(10000, 21), 2100);
  assert.equal(money.percentOfCents(10000, 10), 1000);
  assert.equal(money.percentOfCents(333, 21), 70, "69.93 -> 70");
  assert.equal(money.percentOfCents(10000, 0), 0);
});

test("el subtotal es exactamente la suma de las lineas", () => {
  const lines = [
    { quantity: 165, unit_price: 9.5 },
    { quantity: 42.5, unit_price: 7.25 },
    { quantity: 1, unit_price: 0.01 },
  ];
  const r = totals.computeBudgetTotals({ lines, ivaPercent: 21 });

  // En céntimos: igualdad exacta.
  const sumOfLineCents = r.cents.lineTotals.reduce((acc, c) => acc + c, 0);
  assert.equal(sumOfLineCents, r.cents.subtotal);

  // En euros: los importes mostrados también deben sumar el subtotal mostrado.
  const sumOfEuroLines = money.fromCents(
    r.lineTotals.reduce((acc, euros) => acc + money.toCents(euros), 0),
  );
  assert.equal(sumOfEuroLines, r.subtotal);
});

test("base imponible mas IVA da el total, con y sin descuento", () => {
  const scenarios = [
    { lines: [{ quantity: 1, unit_price: 1000 }], ivaPercent: 21 },
    { lines: [{ quantity: 7, unit_price: 14.29 }], ivaPercent: 10 },
    {
      lines: [{ quantity: 3, unit_price: 333.33 }],
      ivaPercent: 21,
      discountType: "percent",
      discountPercent: 12.5,
    },
    {
      lines: [{ quantity: 1, unit_price: 1000 }],
      ivaPercent: 21,
      discountType: "amount",
      discountAmount: 333.33,
    },
  ];
  for (const s of scenarios) {
    const r = totals.computeBudgetTotals(s);
    assert.equal(r.cents.taxableBase + r.cents.ivaAmount, r.cents.total);
    assert.equal(r.cents.subtotal - r.cents.discountValue, r.cents.taxableBase);
    // En euros hay que volver a céntimos antes de sumar: los importes en euros
    // son una proyección para mostrar, no operandos aritméticos.
    assert.equal(
      money.toCents(r.taxableBase) + money.toCents(r.ivaAmount),
      money.toCents(r.total),
      "tambien debe cuadrar en euros, comparado en centimos",
    );
  }
});

test("los importes en euros no deben operarse con coma flotante", () => {
  // Documenta por qué la garantía se expresa en céntimos. Caso real del
  // módulo: 1000 - 333.33 da 666.6700000000001 en coma flotante, pero la base
  // imponible correcta es 666.67. En céntimos la resta es exacta.
  const r = totals.computeBudgetTotals({
    lines: [{ quantity: 1, unit_price: 1000 }],
    ivaPercent: 21,
    discountType: "amount",
    discountAmount: 333.33,
  });

  assert.equal(r.subtotal, 1000);
  assert.equal(r.discountValue, 333.33);
  assert.equal(r.taxableBase, 666.67);
  assert.equal(r.ivaAmount, 140);
  assert.equal(r.total, 806.67);

  // Exacto en céntimos.
  assert.equal(r.cents.subtotal - r.cents.discountValue, r.cents.taxableBase);
  assert.equal(r.cents.taxableBase + r.cents.ivaAmount, r.cents.total);

  // Inexacto si se opera sobre la proyección en euros: por eso el módulo
  // devuelve `cents` y por eso el assert de cuadre compara céntimos.
  assert.notEqual(
    r.subtotal - r.discountValue,
    r.taxableBase,
    "1000 - 333.33 en coma flotante no da exactamente 666.67",
  );
});

test("el descuento por importe nunca supera el subtotal", () => {
  const r = totals.computeBudgetTotals({
    lines: [{ quantity: 1, unit_price: 100 }],
    ivaPercent: 21,
    discountType: "amount",
    discountAmount: 500,
  });
  assert.equal(r.discountValue, 100);
  assert.equal(r.taxableBase, 0);
  assert.equal(r.total, 0);
});

test("el descuento por porcentaje se acota a [0,100]", () => {
  const over = totals.computeBudgetTotals({
    lines: [{ quantity: 1, unit_price: 100 }],
    ivaPercent: 21,
    discountType: "percent",
    discountPercent: 250,
  });
  assert.equal(over.discountValue, 100);

  const under = totals.computeBudgetTotals({
    lines: [{ quantity: 1, unit_price: 100 }],
    ivaPercent: 21,
    discountType: "percent",
    discountPercent: -30,
  });
  assert.equal(under.discountValue, 0);
});

test("computeBudgetTotalsFromSubtotal coincide con computeBudgetTotals", () => {
  const lines = [{ quantity: 165, unit_price: 9.5 }, { quantity: 42, unit_price: 7.25 }];
  const fromLines = totals.computeBudgetTotals({
    lines,
    ivaPercent: 21,
    discountType: "percent",
    discountPercent: 5,
  });
  const fromSubtotal = totals.computeBudgetTotalsFromSubtotal(fromLines.subtotal, 21, "percent", 5, 0);

  assert.equal(fromSubtotal.cents.subtotal, fromLines.cents.subtotal);
  assert.equal(fromSubtotal.cents.taxableBase, fromLines.cents.taxableBase);
  assert.equal(fromSubtotal.cents.ivaAmount, fromLines.cents.ivaAmount);
  assert.equal(fromSubtotal.cents.total, fromLines.cents.total);
});

test("assertBudgetTotalsConsistent bloquea una desviacion de un centimo", () => {
  const computed = totals.computeBudgetTotals({
    lines: [{ quantity: 165, unit_price: 9.5 }],
    ivaPercent: 21,
  });

  assert.doesNotThrow(() => totals.assertBudgetTotalsConsistent(computed.subtotal, computed));

  assert.throws(
    () => totals.assertBudgetTotalsConsistent(computed.subtotal + 0.01, computed),
    (err) => {
      assert.equal(err.code, "BUDGET_TOTAL_MISMATCH");
      assert.equal(err.deltaCents, -1);
      return true;
    },
  );
});

test("checkBudgetTotalsConsistency informa sin lanzar", () => {
  const computed = totals.computeBudgetTotals({
    lines: [{ quantity: 1, unit_price: 100 }],
    ivaPercent: 21,
  });
  const bad = totals.checkBudgetTotalsConsistency(90, computed);
  assert.equal(bad.ok, false);
  assert.equal(bad.deltaCents, 1000);
  assert.equal(bad.deltaEuros, 10);

  const good = totals.checkBudgetTotalsConsistency(100, computed);
  assert.equal(good.ok, true);
  assert.equal(good.deltaCents, 0);
});

test("el contrato de totales distingue presupuestos nuevos de heredados", () => {
  assert.equal(totals.hasCurrentTotalsContract({ totals_contract: totals.TOTALS_CONTRACT_VERSION }), true);
  assert.equal(totals.hasCurrentTotalsContract({}), false, "presupuesto heredado");
  assert.equal(totals.hasCurrentTotalsContract(null), false);
  assert.equal(totals.hasCurrentTotalsContract("v2-partidas-only"), false);
});
