import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustToMarket,
  applyMaterialBasketToItems,
  buildScopeMaterials,
  getAffectedArea,
  getMarketRange,
  normalizeBudgetItemsToScope,
} from "../lib/budget-engine.ts";

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
