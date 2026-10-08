import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  resolveForConcept,
  matchManualPrice,
  manualPriceSimilarity,
  MANUAL_PRICE_MIN_SIMILARITY,
} from "../lib/price-resolver-v2.ts";
import { applyProviderToAIMaterials } from "../lib/provider-materials.ts";

// Decision (b1-mi-precio): a price the user fixed by hand wins over
// everything — n8n, supplier, private tariff and geographic adjustment.

const context = { company_id: "u1", province: "Alicante", quality_tier: "media" };

function manual(overrides = {}) {
  return {
    name: "Saco de cemento gris 25 kg",
    unit: "ud",
    unit_price: 7.77,
    supplier_name: "Almacén del barrio",
    source_type: "manual",
    is_manual_override: true,
    ...overrides,
  };
}

function trackerRow(overrides = {}) {
  return {
    product_id: "p1",
    product_name: "Saco de cemento gris 25 kg",
    concept_id: null,
    concept_name: null,
    provider_id: "prov1",
    provider_name: "Proveedor n8n",
    provider_province: "Alicante",
    provider_supply_zones: [],
    is_preferred: true,
    brand: null,
    sku: null,
    unit: "ud",
    units_per_package: 1,
    price_excl_vat: 5.1,
    effective_price: 5.1,
    shipping_cost: 0,
    minimum_order: 0,
    delivery_days_min: 1,
    delivery_days_max: 3,
    is_available: true,
    confidence_score: 0.95,
    source_type: "n8n_market",
    source_url: "https://example.com/cemento",
    checked_at: null,
    price_changed_at: null,
    is_private_tariff: true,
    is_negotiated: true,
    ...overrides,
  };
}

function data(overrides = {}) {
  return {
    current_prices: [trackerRow()],
    manual_prices: [manual()],
    historical_prices: [],
    technical_prices: [{
      name: "Saco de cemento gris 25 kg", item_code: "C1", unit: "ud",
      unit_price: 6, confidence_score: 0.9, source: "BC3", region: "espana", is_private: true,
    }],
    enlaze_prices: [{ name: "Saco de cemento gris 25 kg", unit: "ud", unit_price: 6.5, chapter: "", supplier_ref: "x" }],
    ...overrides,
  };
}

const input = {
  concept_name: "Saco de cemento gris 25 kg",
  category: "material",
  unit: "ud",
  quantity: 10,
  reference_unit_price: 6,
};

test("a manual price wins over private tariff, negotiated, preferred supplier and banks", () => {
  const result = resolveForConcept(input, context, data());
  assert.equal(result.source_type, "manual_locked");
  assert.equal(result.unit_price, 7.77);
  assert.equal(result.effective_price, 7.77);
  assert.equal(result.confidence_score, 1);
});

test("a manual price wins even when priority_order puts it last or leaves it out", () => {
  for (const priority_order of [
    ["private_tariff", "negotiated", "provider_updated", "manual_locked"],
    ["provider_updated", "technical_bank"],
  ]) {
    const result = resolveForConcept(input, { ...context, priority_order }, data());
    assert.equal(result.source_type, "manual_locked");
    assert.equal(result.unit_price, 7.77);
  }
});

test("a price not marked as manual does not take level 1", () => {
  const result = resolveForConcept(
    input,
    context,
    data({ manual_prices: [manual({ is_manual_override: false })] }),
  );
  assert.notEqual(result.source_type, "manual_locked");
});

test("the closest manual price is chosen, not the first one listed", () => {
  const rows = [
    manual({ name: "Cemento cola blanco", unit_price: 99 }),
    manual({ name: "Saco de cemento gris 25 kg", unit_price: 7.77 }),
  ];
  assert.equal(matchManualPrice(input.concept_name, "ud", rows).price?.unit_price, 7.77);
});

test("a zero manual price is ignored instead of zeroing the line", () => {
  assert.equal(matchManualPrice(input.concept_name, "ud", [manual({ unit_price: 0 })]).price, undefined);
});

test("\"Cemento gris\" never takes the price of \"Cemento cola\" (nor the reverse)", () => {
  assert.ok(manualPriceSimilarity("Cemento gris", "Cemento cola") < MANUAL_PRICE_MIN_SIMILARITY);
  for (const [mine, line] of [["Cemento gris", "Cemento cola"], ["Cemento cola", "Cemento gris"]]) {
    const match = matchManualPrice(line, "saco", [manual({ name: mine, unit: "saco" })]);
    assert.equal(match.price, undefined);
    assert.equal(match.unitMismatchNotice, undefined);
  }
  // A short generic name is not "the same product" as a longer specific one.
  assert.equal(matchManualPrice("Cemento cola", "saco", [manual({ name: "Cemento", unit: "saco" })]).price, undefined);
});

test("the similarity threshold accepts the same product written differently", () => {
  for (const [a, b] of [
    ["Saco de cemento gris 25 kg", "Cemento gris saco 25kg"],
    ["Sacos de cemento gris (25 kg)", "Saco de cemento gris 25 kg"],
    ["Pintura plástica blanca 15 l", "Pintura plastica blanca 15 l interior"],
  ]) {
    assert.ok(manualPriceSimilarity(a, b) >= MANUAL_PRICE_MIN_SIMILARITY, `${a} ~ ${b}`);
  }
  for (const [a, b] of [
    ["Azulejo blanco 20x20 mate", "Azulejo blanco 20x20 brillo"],
    ["Saco de cemento gris 25 kg", "Saco de cemento gris 35 kg"],
    ["Placa de yeso 13 mm", "Placa de yeso 15 mm"],
  ]) {
    assert.ok(manualPriceSimilarity(a, b) < MANUAL_PRICE_MIN_SIMILARITY, `${a} !~ ${b}`);
  }
});

test("a manual price in another unit is not applied: next source plus a short notice", () => {
  const result = resolveForConcept(
    { ...input, unit: "kg", reference_unit_price: undefined },
    context,
    data({
      manual_prices: [manual({ unit: "saco" })],
      current_prices: [],
      technical_prices: [],
      enlaze_prices: [{ name: "Saco de cemento gris 25 kg", unit: "kg", unit_price: 0.3, chapter: "", supplier_ref: "x" }],
    }),
  );
  assert.equal(result.source_type, "enlaze_base");
  assert.equal(result.unit_price, 0.3);
  assert.equal(result.manual_price_notice, "Tu precio es por saco; esta partida va en kg");
});

test("units are compared after normalising aliases, never converted", () => {
  assert.ok(matchManualPrice(input.concept_name, "uds", [manual({ unit: "ud" })]).price);
  assert.ok(matchManualPrice(input.concept_name, "sacos", [manual({ unit: "saco" })]).price);
  const kg = matchManualPrice(input.concept_name, "kg", [manual({ unit: "saco" })]);
  assert.equal(kg.price, undefined);
  assert.match(kg.unitMismatchNotice, /^Tu precio es por saco; esta partida va en kg$/);
});

test("choosing a provider never replaces a manual material price", () => {
  const base = [
    { id: "m1", name: "Saco de cemento gris 25 kg", quantity: 10, unit: "ud", unit_price: 7.77, subtotal: 77.7, included: true, sourceType: "manual_locked" },
    { id: "m2", name: "Arena de río", quantity: 1, unit: "m3", unit_price: 30, subtotal: 30, included: true, sourceType: "estimated" },
  ];
  const catalog = [
    { id: "c1", name: "Saco de cemento gris 25 kg", quantity: 1, unit: "ud", unit_price: 4, subtotal: 4, included: true, provider_id: "leroy" },
    { id: "c2", name: "Arena de río", quantity: 1, unit: "m3", unit_price: 25, subtotal: 25, included: true, provider_id: "leroy" },
  ];
  const [cement, sand] = applyProviderToAIMaterials(base, catalog, "leroy", "Leroy");
  assert.equal(cement.unit_price, 7.77);
  assert.equal(cement.sourceType, "manual_locked");
  assert.equal(cement.provider_adjustment, undefined);
  assert.equal(sand.unit_price, 25);
});

test("the resolve route reads is_manual_override, never the missing is_locked column", () => {
  for (const file of [
    "app/api/prices/resolve/route.ts",
    "app/api/budgets/reprice/route.ts",
    "app/api/budgets/generate-v2/route.ts",
  ]) {
    const route = readFileSync(file, "utf8");
    assert.doesNotMatch(route, /is_locked/, file);
  }
  const route = readFileSync("app/api/prices/resolve/route.ts", "utf8");
  assert.match(route, /\.eq\("is_manual_override", true\)/);
  // v1 path: manual prices are checked before the cache and never cached.
  const v1 = route.slice(route.indexOf("// ── V1 Path"));
  assert.ok(v1.indexOf("matchManualPrice(") < v1.indexOf("cacheMap.get(cacheKey)"));
  assert.match(v1, /sourceType !== "manual_locked"/);
});

test("the Precios lock button reads and writes is_manual_override", () => {
  const page = readFileSync("app/dashboard/prices/page.tsx", "utf8");
  assert.match(page, /const newVal = !item\.is_manual_override/);
  assert.doesNotMatch(page, /row\.source_type === "manual" \?/);
  const types = readFileSync("lib/types/price.ts", "utf8");
  assert.match(types, /PRICE_LIST_COLUMNS[\s\S]*is_manual_override/);
});

test("the client PDFs never say where a price comes from", () => {
  const pdf = readFileSync("lib/pdf-generator.ts", "utf8");
  const start = (name) => pdf.indexOf(`function ${name}(`);
  const bodies = [
    pdf.slice(start("generateClientPDFHTML"), start("generateInternalPDFHTML")),
    pdf.slice(start("renderPresupixClientHTML"), pdf.indexOf("\n}\n", start("renderPresupixClientHTML"))),
  ];
  for (const body of bodies) {
    assert.ok(body.length > 200);
    assert.doesNotMatch(body, /sourceType|source_type|price_source|confidence|srcIcon|Tu precio/i);
  }
});
