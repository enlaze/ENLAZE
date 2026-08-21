import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeterministicBudgetItems,
  estimateRealisticTimeline,
} from "../lib/budget-engine.ts";
import {
  generateClientPDFHTML,
  generateInternalPDFHTML,
} from "../lib/pdf-generator.ts";

const allActions = [
  "demoliciones", "albanileria", "electricidad", "fontaneria", "climatizacion",
  "alicatados", "pavimentos", "pintura", "carpinteria_interior",
  "carpinteria_exterior", "cocina_montaje", "banos_sanitarios", "iluminacion",
  "limpieza_final", "gestion_residuos",
];

const integralScope = {
  superficie_m2: 160,
  num_banos: 1,
  incluye_cocina: true,
  incluye_ventanas: true,
  incluye_climatizacion: true,
  estancias: ["vivienda_completa"],
  actuaciones: allActions,
  calidad: "media",
  ubicacion: "Alicante",
};

test("a 160 m2 integral refurbishment is not scheduled in 8-15 weeks", () => {
  const items = buildDeterministicBudgetItems(integralScope, 1.2);
  const timeline = estimateRealisticTimeline(integralScope, items);

  assert.ok(timeline.execution_weeks_min >= 14, JSON.stringify(timeline));
  assert.ok(timeline.execution_weeks_max >= 20, JSON.stringify(timeline));
  assert.ok(timeline.total_weeks_min > 15, JSON.stringify(timeline));
  assert.ok(timeline.total_weeks_max > timeline.execution_weeks_max);
  assert.ok(timeline.preparation_weeks_min >= 4);
  assert.ok(timeline.phase_breakdown.length >= 7);
  assert.match(timeline.assumptions.join(" "), /secados|suministros/i);
});

for (const action of ["fontaneria", "iluminacion", "pintura"]) {
  test(`${action} receives a focused partial-work schedule`, () => {
    const scope = {
      ...integralScope,
      actuaciones: [action],
      incluye_cocina: false,
      incluye_ventanas: false,
      incluye_climatizacion: false,
      estancias: [action === "fontaneria" ? "bano_1" : "salon"],
    };
    const items = buildDeterministicBudgetItems(scope, 1.2);
    const timeline = estimateRealisticTimeline(scope, items);

    assert.ok(timeline.execution_weeks_min >= 1);
    assert.ok(timeline.execution_weeks_max <= 6, JSON.stringify(timeline));
    assert.ok(timeline.total_weeks_max <= 8, JSON.stringify(timeline));
    assert.ok(timeline.phase_breakdown.length >= 1);
    assert.ok(timeline.total_weeks_max >= timeline.execution_weeks_max);
  });
}

test("made-to-measure windows expose procurement as the dominant lead time", () => {
  const scope = {
    ...integralScope,
    actuaciones: ["carpinteria_exterior"],
    incluye_cocina: false,
    incluye_climatizacion: false,
  };
  const timeline = estimateRealisticTimeline(
    scope,
    buildDeterministicBudgetItems(scope, 1.2),
  );

  assert.ok(timeline.preparation_weeks_min > timeline.execution_weeks_min);
  assert.ok(timeline.preparation_weeks_max >= 9);
  assert.match(timeline.assumptions.join(" "), /fabricadas a medida/i);
});

test("schedule confidence reflects unverified materials and known supplier lead time", () => {
  const items = buildDeterministicBudgetItems(integralScope, 1.2);
  const timeline = estimateRealisticTimeline(integralScope, items, {
    total_materials: 30,
    verified_materials: 20,
    max_delivery_days: 35,
    unavailable_materials: 1,
    unknown_delivery_materials: 8,
  });

  assert.equal(timeline.supply_readiness_percent, 67);
  assert.equal(timeline.uncertainty_level, "alta");
  assert.ok(timeline.confidence_percent < 65, JSON.stringify(timeline));
  assert.ok(timeline.preparation_weeks_max >= 9, JSON.stringify(timeline));
  assert.match(timeline.schedule_risks.join(" "), /10 materiales|sin disponibilidad/i);
  assert.match(timeline.optimization_actions.join(" "), /referencias pendientes|stock/i);
});

test("client and internal PDFs disclose preparation, execution and total term", () => {
  const budget = {
    budget_number: "PRE-TEST",
    title: "Reforma integral",
    service_type: "construccion",
    status: "pendiente",
    created_at: new Date("2026-08-20T12:00:00Z").toISOString(),
    subtotal: 0,
    iva_percent: 21,
    iva_amount: 0,
    total: 0,
    preparation_weeks_min: 5,
    preparation_weeks_max: 9,
    execution_weeks_min: 15,
    execution_weeks_max: 23,
    total_weeks_min: 19,
    total_weeks_max: 31,
    execution_phases: [],
  };
  const clientHtml = generateClientPDFHTML(budget, {
    chapters: [],
    subtotal: 0,
    ivaPct: 21,
    ivaAmount: 0,
    total: 0,
    qualityLabel: "Gama media / estandar",
  });
  const internalHtml = generateInternalPDFHTML(budget, {
    chapters: [],
    totals: {
      directCost: 0,
      materialsCost: 0,
      laborCost: 0,
      equipmentCost: 0,
      wasteCost: 0,
      clientSubtotal: 0,
      totalMargin: 0,
      totalMarginPct: 0,
      ivaPct: 21,
      ivaAmount: 0,
      clientTotal: 0,
    },
    avgConfidence: 70,
    qualityTier: "media",
  });

  assert.match(clientHtml, /Preparacion y suministros/);
  assert.match(clientHtml, /Total recomendado/);
  assert.match(internalHtml, /Preparacion y compras/);
  assert.match(internalHtml, /Ruta critica calculada/);
});
