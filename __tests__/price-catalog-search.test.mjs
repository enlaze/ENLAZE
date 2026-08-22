import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogSearchTokens,
  buildCatalogSearchTokenGroups,
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
  assert.equal(groups.length, 4);
  assert.deepEqual(groups[0], ["placa", "yeso", "laminado"]);
  assert.deepEqual(groups[1], ["tuberia", "evacuacion", "110mm"]);
  assert.deepEqual(groups[2], ["tubo", "pvc"]);
  assert.deepEqual(groups[3], ["pvc", "compacto"]);
});

test("catalogue search adds supplier synonyms without weakening exact validation", () => {
  assert.deepEqual(
    buildCatalogSearchTokenGroups("Perfil metálico para Pladur (montante 48mm)"),
    [
      ["perfil", "metalico", "pladur"],
      ["montante"],
      ["perfil", "placo"],
    ],
  );
  assert.deepEqual(
    buildCatalogSearchTokenGroups("Imprimación fijadora (15L)"),
    [
      ["imprimacion", "fijadora"],
      ["imprimacion"],
      ["fijador"],
    ],
  );
  assert.deepEqual(
    buildCatalogSearchTokenGroups("Silicona neutra sanitaria (cartucho 300ml)"),
    [
      ["silicona", "neutra", "sanitaria"],
      ["silicona", "neutra"],
      ["silicona"],
    ],
  );
});

test("atomic specifications keep compact supplier-language fallback searches", () => {
  assert.deepEqual(
    buildCatalogSearchTokenGroups("Mortero seco de cemento M-7.5 gris saco 25 kg").slice(-2),
    [["mortero", "m7"], ["mortero", "seco"]],
  );
  assert.ok(
    buildCatalogSearchTokenGroups("Suelo laminado AC5 10 mm acabado roble")
      .some((tokens) => tokens.join(" ") === "laminado ac5 roble"),
  );
  assert.ok(
    buildCatalogSearchTokenGroups("Puerta interior en block lacada blanca ciega 72.5 cm derecha")
      .some((tokens) => tokens.join(" ") === "puerta 72 derecha"),
  );
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

test("technical banks reject incompatible units and implausible unit-price scales", () => {
  const context = { company_id: "company", province: "", quality_tier: "media" };
  const baseData = {
    current_prices: [], manual_prices: [], historical_prices: [], enlaze_prices: [],
  };
  const technical = (name, unit, unit_price) => ({
    name, unit, unit_price, item_code: name, confidence_score: 0.8,
    source: "enlaze_base", region: "espana", is_private: false,
  });

  const incompatibleUnit = resolveForConcept(
    { concept_name: "Mobiliario de cocina", category: "cocina", unit: "ml", quantity: 7, reference_unit_price: 720 },
    context,
    { ...baseData, technical_prices: [technical("Mobiliario de cocina", "PA", 5500)] },
  );
  assert.equal(incompatibleUnit.source_type, "estimated");

  const implausibleScale = resolveForConcept(
    { concept_name: "Mecanismos eléctricos", category: "electricidad", unit: "ud", quantity: 112, reference_unit_price: 24 },
    context,
    { ...baseData, technical_prices: [technical("Mecanismos eléctricos", "ud", 220)] },
  );
  assert.equal(implausibleScale.source_type, "estimated");

  const compatible = resolveForConcept(
    { concept_name: "Cuadro eléctrico y protecciones", category: "electricidad", unit: "ud", quantity: 1, reference_unit_price: 220 },
    context,
    { ...baseData, technical_prices: [technical("Cuadro eléctrico y protecciones", "ud", 220)] },
  );
  assert.equal(compatible.source_type, "technical_bank");
});
