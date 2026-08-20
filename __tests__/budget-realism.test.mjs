import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustToMarket,
  applyMaterialBasketToItems,
  buildDeterministicBudgetItems,
  buildScopeMaterials,
  getAffectedArea,
  getMarketRange,
  getRequestedChapters,
  inferBudgetActions,
  normalizeBudgetItemsToScope,
} from "../lib/budget-engine.ts";
import { buildDeterministicBudgetAnalysis } from "../lib/budget-analysis-fallback.ts";

const fullScope = {
  superficie_m2: 145,
  num_banos: 2,
  incluye_cocina: true,
  incluye_ventanas: true,
  incluye_climatizacion: true,
  estancias: ["vivienda_completa"],
  actuaciones: [],
  calidad: "media",
  ubicacion: "Barcelona",
};

test("a 145 m2 integral refurbishment in Barcelona is not benchmarked at 94k", () => {
  const range = getMarketRange(fullScope, "reforma");
  assert.equal(getAffectedArea(fullScope), 145);
  assert.ok(range.min > 94_000, `minimum was ${range.min}`);
});

test("selected rooms and actions constrain area, chapters and materials", () => {
  const partial = {
    ...fullScope,
    estancias: ["cocina", "bano_1"],
    actuaciones: ["pintura", "banos_sanitarios"],
    incluye_ventanas: false,
    incluye_climatizacion: false,
  };
  assert.ok(getAffectedArea(partial) < fullScope.superficie_m2);

  const chapters = normalizeBudgetItemsToScope(partial, [], 1.2).map((item) => item.chapter);
  assert.deepEqual(new Set(chapters), new Set(["impermeabilizacion", "pintura", "sanitarios"]));
  assert.ok(buildScopeMaterials(partial).every((material) => chapters.includes(material.linked_chapter)));
});

test("resolved material basket replaces the provisional component instead of being added twice", () => {
  const items = [{
    id: "p1",
    concept: "Pintura",
    description: "",
    quantity: 10,
    unit: "m2",
    category: "mano_obra",
    chapter: "pintura",
    unit_price: 10,
    subtotal_cost: 100,
    unit_price_client: 12,
    subtotal_client: 120,
    status: "incluida",
    cost_breakdown: {
      material_cost: 20,
      labor_cost: 70,
      equipment_cost: 5,
      waste_cost: 5,
      margin: 20,
      pvp: 120,
      source: "engine_estimate",
      confidence_score: 0.7,
      price_type: "estimated",
    },
  }];
  const materials = [{
    id: "m1",
    name: "Pintura rastreada",
    quantity: 1,
    unit: "ud",
    unit_price: 35,
    subtotal: 35,
    included: true,
    provider_id: "provider",
    linked_chapter: "pintura",
    isRealData: true,
    sourceType: "provider_updated",
  }];

  const [updated] = applyMaterialBasketToItems(items, materials, 1.2);
  assert.equal(updated.subtotal_cost, 115);
  assert.equal(updated.subtotal_client, 138);
  assert.equal(updated.cost_breakdown.material_cost, 35);
});

test("market calibration preserves authoritative prices", () => {
  const estimated = normalizeBudgetItemsToScope(fullScope, [], 1.2);
  const authoritative = {
    ...estimated[0],
    price_source: "technical_bank",
    unit_price: 999,
    subtotal_cost: 999,
    unit_price_client: 1198.8,
    subtotal_client: 1198.8,
  };
  const result = adjustToMarket(fullScope, [authoritative, ...estimated.slice(1)], [], "reforma", 1.2, true);
  assert.equal(result.items[0].unit_price, 999);
  assert.equal(result.items[0].price_source, "technical_bank");
});

for (const action of ["fontaneria", "iluminacion", "pintura"]) {
  test(`the deterministic engine creates a detailed and constrained ${action} budget`, () => {
    const scope = {
      ...fullScope,
      estancias: [action === "fontaneria" ? "bano_1" : "salon"],
      actuaciones: [action],
      incluye_cocina: false,
      incluye_ventanas: false,
      incluye_climatizacion: false,
    };
    const requested = getRequestedChapters(scope);
    const items = buildDeterministicBudgetItems(scope, 1.2);
    assert.ok(items.length >= 4, `only ${items.length} items were generated`);
    assert.ok(items.every((item) => requested.has(item.chapter)));
    assert.ok(items.every((item) => item.quantity > 0 && item.unit_price > 0));
    assert.ok(buildScopeMaterials(scope).length >= (action === "iluminacion" ? 4 : 5));
    const range = getMarketRange(scope, action);
    assert.ok(range.min >= (action === "fontaneria" ? 1_800 : 900));
    assert.ok(range.max > range.min);
  });
}

test("partial actions are inferred when the service type contains the trade", () => {
  assert.deepEqual(inferBudgetActions("Trabajo de fontanería e iluminación"), ["iluminacion", "fontaneria"]);
});

test("budget analysis remains available without Claude and includes tracker metadata", () => {
  const scope = { ...fullScope, actuaciones: ["fontaneria"], incluye_cocina: false };
  const analysis = buildDeterministicBudgetAnalysis({
    scope,
    serviceType: "fontaneria",
    trackerProductsCount: 1200,
    reason: "Claude sin saldo",
  });
  assert.equal(analysis.analysis_mode, "deterministic_engine");
  assert.equal(analysis.data_sources.tracker_products_count, 1200);
  assert.ok(analysis.suggested_items.length >= 5);
  assert.ok(analysis.suggested_materials.length >= 5);
  assert.match(analysis.price_warnings[0], /sin saldo/i);
});

test("every construction action supported by the form produces a budget", () => {
  const actions = [
    "demoliciones", "albanileria", "electricidad", "fontaneria", "climatizacion",
    "alicatados", "pavimentos", "pintura", "carpinteria_interior",
    "carpinteria_exterior", "cocina_montaje", "banos_sanitarios", "iluminacion",
    "limpieza_final", "gestion_residuos",
  ];
  for (const action of actions) {
    const items = buildDeterministicBudgetItems({ ...fullScope, actuaciones: [action] }, 1.2);
    assert.ok(items.length >= 2, `${action} generated ${items.length} items`);
    assert.ok(items.every((item) => item.subtotal_client > 0), `${action} has an empty amount`);
  }
});
