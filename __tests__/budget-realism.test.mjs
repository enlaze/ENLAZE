import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  adjustToMarket,
  applyMaterialBasketToItems,
  buildDeterministicBudgetItems,
  buildScopeQuantities,
  buildScopeMaterials,
  getAffectedArea,
  getMarketRange,
  getRequestedChapters,
  inferBudgetActions,
  normalizeBudgetItemsToScope,
  normalizeBathroomCount,
  resolveProjectContext,
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

test("refurbishment and new build have different physical starting points", () => {
  const preserve = buildScopeQuantities({
    ...fullScope,
    project_context: "existing_renovation",
    existing_condition: "fair",
    conservation_strategy: "preserve",
  });
  const replace = buildScopeQuantities({
    ...fullScope,
    project_context: "existing_renovation",
    existing_condition: "fair",
    conservation_strategy: "replace",
  });
  const newBuild = buildScopeQuantities({ ...fullScope, project_context: "new_build" });

  assert.equal(resolveProjectContext("Reforma integral"), "existing_renovation");
  assert.equal(resolveProjectContext("Obra nueva"), "new_build");
  assert.ok(preserve.demolitionArea < replace.demolitionArea);
  assert.equal(newBuild.demolitionArea, 0);

  const renovationItems = normalizeBudgetItemsToScope({
    ...fullScope,
    project_context: "existing_renovation",
    conservation_strategy: "balanced",
  }, [], 1.2);
  assert.ok(renovationItems.some((item) => item.chapter === "diagnostico"));
  assert.ok(renovationItems.some((item) => /conserv|preexist/i.test(`${item.concept} ${item.description}`)));
  assert.ok(renovationItems.every((item) => !/cimentaci|estructura completa/i.test(`${item.concept} ${item.description}`)));

  const newBuildItems = normalizeBudgetItemsToScope({ ...fullScope, project_context: "new_build" }, [], 1.2);
  assert.ok(newBuildItems.every((item) => item.chapter !== "demoliciones"));
  assert.ok(newBuildItems.every((item) => item.chapter !== "diagnostico"));
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

test("a painting budget can target one room with zero bathrooms", () => {
  const paintingScope = {
    ...fullScope,
    num_banos: 0,
    incluye_cocina: true,
    incluye_ventanas: false,
    incluye_climatizacion: false,
    estancias: ["salon"],
    actuaciones: ["pintura"],
  };
  const quantities = buildScopeQuantities(paintingScope);
  const items = buildDeterministicBudgetItems(paintingScope, 1.2);

  assert.equal(normalizeBathroomCount(0), 0);
  assert.equal(normalizeBathroomCount(undefined), 1);
  assert.equal(quantities.bathroomsCount, 0);
  assert.equal(quantities.kitchenIncluded, false);
  assert.equal(quantities.wetWallArea, 0);
  assert.ok(items.length >= 4);
  assert.ok(items.every((item) => item.chapter === "pintura"));
  assert.ok(buildScopeMaterials(paintingScope).every((material) => material.linked_chapter === "pintura"));
});

test("the UI and API preserve zero bathrooms and use the new title", async () => {
  const [pageSource, scopeSource, providerSource, apiSource] = await Promise.all([
    readFile(new URL("../app/dashboard/budgets/generate/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/budgets/generate/_components/steps/ScopeStep.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/agent/budget-analysis/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /title="Presupuesto inteligente"/);
  assert.match(scopeSource, /Nº de baños afectados/);
  assert.match(scopeSource, /min="0"/);
  assert.doesNotMatch(scopeSource, /scopeData\.num_banos \|\| 1/);
  assert.doesNotMatch(providerSource, /num_banos: state\.sectorData\.num_banos \|\| 1/);
  assert.match(apiSource, /num_banos: normalizeBathroomCount\(scope\?\.num_banos\)/);
  assert.match(scopeSource, /Punto de partida real de la obra/);
  assert.match(scopeSource, /Reforma de edificio existente/);
  assert.match(apiSource, /NO presupuestes cimentacion, estructura/);
});

test("a finalized smart budget can be reopened with its complete wizard state", async () => {
  const [pageSource, providerSource, detailSource, editSource] = await Promise.all([
    readFile(new URL("../app/dashboard/budgets/generate/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/budgets/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/budgets/[id]/edit/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(pageSource, /budgetIdFromLocation/);
  assert.match(pageSource, /draftId: budget\.id/);
  assert.match(providerSource, /wizard_state: \{[\s\S]*draftId: budgetId/);
  assert.match(detailSource, /Abrir en Presupuesto inteligente/);
  assert.match(editSource, /Editar alcance, partidas y proveedores/);
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

test("budget analysis remains available without external AI and hides provider billing details", () => {
  const scope = { ...fullScope, actuaciones: ["fontaneria"], incluye_cocina: false };
  const analysis = buildDeterministicBudgetAnalysis({
    scope,
    serviceType: "fontaneria",
    trackerProductsCount: 1200,
    reason: "provider_billing_unavailable",
  });
  assert.equal(analysis.analysis_mode, "deterministic_engine");
  assert.equal(analysis.data_sources.tracker_products_count, 1200);
  assert.ok(analysis.suggested_items.length >= 5);
  assert.ok(analysis.suggested_materials.length >= 5);
  assert.deepEqual(analysis.price_warnings, []);
  assert.equal(analysis.data_sources.ai_fallback_reason, "provider_billing_unavailable");
  assert.doesNotMatch(analysis.summary, /claude|saldo|token/i);
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
