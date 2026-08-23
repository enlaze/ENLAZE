/**
 * Red de integridad del generador de presupuestos.
 *
 * Cubre los 8 tests obligatorios del plan de arquitectura
 * (docs/ANALISIS-ARQUITECTURA-PRESUPUESTOS.md).
 *
 * CONVENCIÓN IMPORTANTE
 * ---------------------
 * Los tests cuya fase todavía no se ha implementado se marcan con
 * `{ todo: "Fase N" }`. Node los ejecuta y muestra el fallo en el informe,
 * pero NO devuelven código de salida distinto de cero. Así la red documenta
 * los defectos conocidos desde el primer día sin dejar el CI en rojo de forma
 * permanente mientras la fase correspondiente está pendiente.
 *
 * Al implementar una fase, quita el `todo` de sus tests: a partir de ese
 * momento pasan a ser bloqueantes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

const provider = read("app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx");
const budgetEngine = read("lib/budget-engine.ts");
const pdfRoute = read("app/api/budgets/pdf/route.ts");

/** Importa un módulo opcional; devuelve null si aún no existe. */
async function optionalImport(rel) {
  if (!exists(rel)) return null;
  return import(path.join(root, rel));
}

// ───────────────────────────────────────────────────────────────────────────
// TEST 1 — Pintura interior sin demolición no debe generar contenedores
// Fase 3 (Scope Engine)
// ───────────────────────────────────────────────────────────────────────────

test(
  "TEST 1: pintura interior sin demolicion no genera WASTE.CONTAINER.6M3",
  { todo: "Fase 3 - Scope Engine" },
  async () => {
    const scopeEngine = await optionalImport("lib/scope/scope-engine.ts");
    assert.ok(scopeEngine, "lib/scope/scope-engine.ts todavia no existe");

    const verdict = scopeEngine.resolveScope({
      trade: "painting",
      demolition: false,
      project_type: "interior_repaint",
    });

    assert.equal(
      verdict.forbidden.includes("WASTE.CONTAINER.6M3"),
      true,
      "el contenedor de escombros debe estar prohibido en pintura sin demolicion",
    );
    assert.equal(
      verdict.allowed.includes("WASTE.CONTAINER.6M3"),
      false,
      "el contenedor de escombros no puede estar permitido",
    );
  },
);

test(
  "TEST 1b: la cantidad de contenedores es 0 cuando no hay demolicion",
  { todo: "Fase 3 - Scope Engine" },
  async () => {
    const engine = await import(path.join(root, "lib/budget-engine.ts"));
    const q = engine.buildScopeQuantities({
      superficie_m2: 90,
      actuaciones: ["pintura"],
      conservation_strategy: "preserve",
    });
    assert.equal(
      q.wasteContainersEstimated,
      0,
      "un trabajo de pintura sin demolicion no debe estimar contenedores",
    );
  },
);

test("TEST 1c: los emisores de residuos siguen siendo cuatro (defecto documentado)", () => {
  // Este test NO es todo: documenta el estado actual y salta si alguien
  // unifica los emisores sin actualizar el plan. Es un canario, no un fallo.
  const emitters = [
    /add\("residuos", "Gestion de residuos y contenedores"/,
    /add\("residuos", "Contenedor y transporte a gestor autorizado"/,
    /add\("residuos", "Contenedores y transporte"/,
    /name: "Servicio de contenedor de escombros 6 m3"/,
  ];
  const present = emitters.filter((re) => re.test(budgetEngine)).length;
  assert.equal(
    present,
    4,
    `se esperaban 4 emisores de residuos sin unificar (Fase 3 los unifica); encontrados ${present}`,
  );
});

// ───────────────────────────────────────────────────────────────────────────
// TEST 2 — Duplicados por canonical_id
// Fase 2 (Registro canónico)
// ───────────────────────────────────────────────────────────────────────────

test(
  "TEST 2: dos lineas con el mismo canonical_id se detectan como duplicado",
  { todo: "Fase 2 - Registro canonico" },
  async () => {
    const validators = await optionalImport("lib/validation/validators.ts");
    assert.ok(validators, "lib/validation/validators.ts todavia no existe");

    const report = validators.validateDuplicates([
      { canonical_id: "WASTE.CONTAINER.6M3", concept: "Contenedor y transporte", quantity: 2 },
      { canonical_id: "WASTE.CONTAINER.6M3", concept: "Servicio contenedor escombros 6 m3", quantity: 2 },
    ]);

    assert.equal(report.valid, false);
    assert.ok(
      report.errors.some((e) => e.code === "DUPLICATE_CANONICAL_ID"),
      "debe emitirse DUPLICATE_CANONICAL_ID",
    );
  },
);

// ───────────────────────────────────────────────────────────────────────────
// TEST 3 — Doble imputación de materiales
// 3a: Fase 1 (eliminar la ocurrencia) · 3b: Fase 4 (detectarla)
// ───────────────────────────────────────────────────────────────────────────

test("TEST 3a: los materiales no se insertan como lineas economicas de cliente", () => {
  // Opción A: el material es evidencia del escandallo, no una línea facturable
  // independiente, porque applyMaterialBasketToItems ya lo pliega dentro del
  // coste de la partida (lib/budget-engine.ts).
  const inserts = provider.match(/const itemsToInsert = \[[^\]]*\]/g) || [];
  assert.ok(inserts.length >= 2, "se esperaban los dos puntos de insercion (saveDraft y finalizeBudget)");
  for (const stmt of inserts) {
    assert.doesNotMatch(
      stmt,
      /materialsToInsert/,
      `budget_items no debe recibir materiales como lineas de cliente: ${stmt}`,
    );
  }
});

test("TEST 3a-bis: el contrato de totales queda marcado en los presupuestos nuevos", () => {
  assert.match(
    provider,
    /TOTALS_CONTRACT_VERSION/,
    "los presupuestos nuevos deben marcar su contrato de totales para distinguirlos de los heredados",
  );
});

test(
  "TEST 3b: un precio que ya incluye material mas el material aparte se detecta",
  { todo: "Fase 4 - Validation Engine" },
  async () => {
    const validators = await optionalImport("lib/validation/validators.ts");
    assert.ok(validators, "lib/validation/validators.ts todavia no existe");

    const report = validators.validateDoubleImputation([
      {
        canonical_id: "PAINT.WALL.2COATS",
        price_type: "LABOR_AND_MATERIAL",
        quantity: 165,
        unit_price: 9.5,
        materials: ["PAINT.PLASTIC.MATT"],
      },
      { canonical_id: "PAINT.PLASTIC.MATT", price_type: "MATERIAL_ONLY", quantity: 40, unit_price: 3.2 },
    ]);

    assert.equal(report.valid, false);
    assert.ok(report.errors.some((e) => e.code === "DOUBLE_IMPUTATION"));
  },
);

// ───────────────────────────────────────────────────────────────────────────
// TEST 4 — La suma de las líneas debe igualar el subtotal
// Fase 1
// ───────────────────────────────────────────────────────────────────────────

test("TEST 4: si la suma de lineas no cuadra con el subtotal se bloquea", async () => {
  const totals = await optionalImport("lib/budget-totals.ts");
  assert.ok(totals, "lib/budget-totals.ts todavia no existe");

  const lines = [
    { quantity: 165, unit_price: 9.5 },
    { quantity: 42, unit_price: 7.25 },
  ];
  const computed = totals.computeBudgetTotals({ lines, ivaPercent: 21 });

  // Coherente: no lanza.
  totals.assertBudgetTotalsConsistent(computed.subtotal, computed);

  // Incoherente: lanza BUDGET_TOTAL_MISMATCH.
  assert.throws(
    () => totals.assertBudgetTotalsConsistent(computed.subtotal + 0.01, computed),
    (err) => err.code === "BUDGET_TOTAL_MISMATCH",
    "una desviacion de un solo centimo debe bloquear",
  );
});

test("TEST 4b: el subtotal es exactamente la suma de los importes de linea", async () => {
  const totals = await optionalImport("lib/budget-totals.ts");
  assert.ok(totals, "lib/budget-totals.ts todavia no existe");

  // Cantidades y precios elegidos para que la coma flotante ingenua falle:
  // 0.1 + 0.2 !== 0.3
  const lines = [
    { quantity: 1, unit_price: 0.1 },
    { quantity: 1, unit_price: 0.2 },
  ];
  const computed = totals.computeBudgetTotals({ lines, ivaPercent: 21 });
  assert.equal(computed.subtotal, 0.3);
});

// ───────────────────────────────────────────────────────────────────────────
// TEST 5 — subtotal + IVA debe igualar el total
// Fase 1
// ───────────────────────────────────────────────────────────────────────────

test("TEST 5: base imponible mas IVA es exactamente el total", async () => {
  const totals = await optionalImport("lib/budget-totals.ts");
  const money = await optionalImport("lib/money.ts");
  assert.ok(totals && money, "lib/budget-totals.ts todavia no existe");

  const cases = [
    { lines: [{ quantity: 165, unit_price: 9.5 }], ivaPercent: 21 },
    { lines: [{ quantity: 3, unit_price: 33.33 }], ivaPercent: 10 },
    { lines: [{ quantity: 7, unit_price: 14.29 }], ivaPercent: 21, discountType: "percent", discountPercent: 12.5 },
    { lines: [{ quantity: 1, unit_price: 1000 }], ivaPercent: 21, discountType: "amount", discountAmount: 333.33 },
  ];

  for (const input of cases) {
    const r = totals.computeBudgetTotals(input);

    // La garantía se expresa en céntimos, que es la unidad en la que el
    // módulo calcula y en la que se puede exigir igualdad estricta.
    assert.equal(
      r.cents.taxableBase + r.cents.ivaAmount,
      r.cents.total,
      `base ${r.taxableBase} + IVA ${r.ivaAmount} debe dar ${r.total}`,
    );
    assert.equal(r.cents.subtotal - r.cents.discountValue, r.cents.taxableBase);

    // Los importes en euros son una proyección para mostrar. Sumarlos con
    // coma flotante reintroduce el error que el módulo elimina
    // (666.67 + 140 === 806.6700000000001), así que la comprobación
    // equivalente sobre euros se hace convirtiendo primero a céntimos.
    assert.equal(
      money.toCents(r.taxableBase) + money.toCents(r.ivaAmount),
      money.toCents(r.total),
    );
  }
});

test("TEST 5b: el guardado y la finalizacion bloquean ante un descuadre", () => {
  assert.match(
    provider,
    /BUDGET_TOTAL_MISMATCH/,
    "el provider debe reaccionar a BUDGET_TOTAL_MISMATCH",
  );
  assert.match(
    provider,
    /assertBudgetTotalsConsistent|BudgetTotalMismatchError/,
    "el provider debe verificar el cuadre antes de persistir",
  );
});

test("TEST 5c: el PDF verifica el cuadre antes de renderizar", () => {
  assert.match(
    pdfRoute,
    /BUDGET_TOTAL_MISMATCH/,
    "la ruta del PDF debe bloquear ante un descuadre",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// TEST 6 — Cantidades estimadas por IA
// Fase 5
// ───────────────────────────────────────────────────────────────────────────

test(
  "TEST 6: una cantidad estimada por IA exige confirmacion",
  { todo: "Fase 5 - Quantity Engine" },
  async () => {
    const quantity = await optionalImport("lib/scope/quantity-engine.ts");
    assert.ok(quantity, "lib/scope/quantity-engine.ts todavia no existe");

    const q = quantity.resolveQuantity({ canonical_id: "PAINT.WALL.2COATS", hint: 165, source: "AI_ESTIMATE" });
    assert.equal(q.source, "AI_ESTIMATE");
    assert.equal(q.requires_confirmation, true);
    assert.ok(q.confidence < 1);
  },
);

// ───────────────────────────────────────────────────────────────────────────
// TEST 7 — Nunca inventar un precio en silencio
// Fase 5 (camino vivo). Los resolvers ya cumplen.
// ───────────────────────────────────────────────────────────────────────────

test("TEST 7a: el resolver v2 nunca inventa un precio", async () => {
  const src = read("lib/price-resolver-v2.ts");
  // El nivel ai_estimate está deliberadamente cableado a null.
  assert.match(src, /ai_estimate/, "debe existir el nivel ai_estimate");
  assert.match(
    src,
    /confidence_score:\s*0\.05|unit_price:\s*0/,
    "el fallback debe devolver precio 0 con confianza minima, no un numero plausible",
  );
});

test(
  "TEST 7b: el camino vivo no conserva el precio inventado por la IA",
  { todo: "Fase 5 - endurecer el prompt" },
  () => {
    const analysisRoute = read("app/api/agent/budget-analysis/route.ts");
    assert.doesNotMatch(
      analysisRoute,
      /unit_cost/,
      "el prompt no debe pedir unit_cost a la IA",
    );
  },
);

// ───────────────────────────────────────────────────────────────────────────
// TEST 8 — Outliers de precio
// Fase 6
// ───────────────────────────────────────────────────────────────────────────

test(
  "TEST 8: un presupuesto muy por encima del historico emite PRICE_OUTLIER",
  { todo: "Fase 6 - Sanity check" },
  async () => {
    const validators = await optionalImport("lib/validation/validators.ts");
    assert.ok(validators, "lib/validation/validators.ts todavia no existe");

    const report = validators.validateOutliers({
      total: 14200,
      historical: { p25: 6800, p50: 8200, p75: 9500, p95: 11000 },
    });

    assert.equal(report.valid, true, "un outlier avisa, no bloquea");
    assert.ok(report.warnings.some((w) => w.code === "PRICE_OUTLIER"));
  },
);
