import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogSearchTokens,
  buildUniqueCatalogTokenGroups,
} from "../lib/price-catalog-search.ts";
import { resolveForConcept } from "../lib/price-resolver-v2.ts";

test("catalogue candidate search keeps meaningful tokens per material", () => {
  assert.deepEqual(
    buildCatalogSearchTokens("Mortero de cemento M-7.5 (saco 25kg)"),
    ["mortero", "cemento"],
  );
  assert.deepEqual(
    buildCatalogSearchTokens("Pintura plástica blanca mate (cubo 15L)"),
    ["pintura", "plastica", "mate"],
  );
});

test("catalogue searches remain independent and deduplicate equal requests", () => {
  const groups = buildUniqueCatalogTokenGroups([
    "Placa de yeso laminado 13mm",
    "Placa de yeso laminado 13mm",
    "Tubería PVC evacuación 110mm",
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], ["placa", "yeso", "laminado"]);
  assert.deepEqual(groups[1], ["tuberia", "evacuacion", "110mm"]);
});

test("equivalent commercial matches prefer the traceable supplier product", () => {
  const base = {
    concept_id: null,
    concept_name: null,
    provider_id: "provider",
    provider_province: null,
    provider_supply_zones: [],
    is_preferred: false,
    brand: null,
    sku: null,
    unit: "ud",
    units_per_package: 1,
    price_excl_vat: 12,
    effective_price: 12,
    shipping_cost: 0,
    minimum_order: 0,
    delivery_days_min: 1,
    delivery_days_max: 3,
    is_available: true,
    confidence_score: 0.82,
    source_type: "n8n_market",
    checked_at: "2026-08-21T08:00:00.000Z",
    price_changed_at: null,
    is_private_tariff: false,
    is_negotiated: false,
  };
  const result = resolveForConcept(
    { concept_name: "Pintura plástica mate 15L", category: "pintura", unit: "ud", quantity: 1 },
    { company_id: "company", province: "", quality_tier: "media" },
    {
      current_prices: [
        { ...base, product_id: "without-link", product_name: "Pintura plástica mate 15L", provider_name: "Referencia", source_url: null },
        { ...base, product_id: "with-link", product_name: "Pintura plástica mate 15L", provider_name: "Proveedor oficial", source_url: "https://supplier.example/product" },
      ],
      manual_prices: [],
      historical_prices: [],
      technical_prices: [],
      enlaze_prices: [],
    },
  );
  assert.equal(result.product_id, "with-link");
  assert.equal(result.provider_name, "Proveedor oficial");
});

test("commercial matching rejects products whose price unit cannot be compared", () => {
  const result = resolveForConcept(
    { concept_name: "Pavimento porcelánico 60x60", category: "pavimentos", unit: "m2", quantity: 20 },
    { company_id: "company", province: "", quality_tier: "media" },
    {
      current_prices: [{
        product_id: "piece-price", product_name: "Pavimento porcelánico 60x60",
        concept_id: null, concept_name: null, provider_id: "provider", provider_name: "Proveedor",
        provider_province: null, provider_supply_zones: [], is_preferred: false,
        brand: null, sku: null, unit: "ud", units_per_package: 1,
        price_excl_vat: 18, effective_price: 18, shipping_cost: 0, minimum_order: 0,
        delivery_days_min: 1, delivery_days_max: 3, is_available: true,
        confidence_score: 0.82, source_type: "n8n_market", source_url: "https://supplier.example/tile",
        checked_at: "2026-08-21T08:00:00.000Z", price_changed_at: null,
        is_private_tariff: false, is_negotiated: false,
      }],
      manual_prices: [], historical_prices: [], technical_prices: [], enlaze_prices: [],
    },
  );

  assert.equal(result.product_id, null);
  assert.equal(result.alternatives.length, 0);
  assert.equal(result.source_type, "estimated");
});
