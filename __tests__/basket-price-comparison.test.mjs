import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderBasketCoverage,
  getComparableOffers,
} from "../lib/basket-price-comparison.ts";
import { canonicalProviderName } from "../lib/provider-identity.ts";

test("combined legacy provider names are disambiguated by the official product URL", () => {
  assert.equal(
    canonicalProviderName("Leroy Merlin / OBRAMAT", "https://www.leroymerlin.es/productos/mortero"),
    "Leroy Merlin",
  );
  assert.equal(
    canonicalProviderName("Leroy Merlin / OBRAMAT", "https://www.obramat.es/productos/mortero"),
    "OBRAMAT",
  );
  assert.equal(
    canonicalProviderName("Leroy Merlin / OBRAMAT", ""),
    "Comparador Leroy Merlin / OBRAMAT",
  );
});

test("material offers keep traceability and rank available official offers first", () => {
  const offers = getComparableOffers({
    id: "m1",
    name: "Mortero",
    quantity: 10,
    included: true,
    unit_price: 4,
    priceAlternatives: [
      { supplier: "Sin fuente", title: "Mortero A", price: 2, unit: "saco", qualityTier: "media", confidenceScore: 0.9 },
      { supplier: "OBRAMAT", title: "Mortero B", price: 4, unit: "saco", qualityTier: "media", confidenceScore: 0.82, sourceType: "provider_updated", url: "https://obramat.es/b", isAvailable: true },
      { supplier: "Leroy Merlin", title: "Mortero C", price: 3.5, unit: "saco", qualityTier: "media", confidenceScore: 0.85, sourceType: "provider_updated", url: "https://leroymerlin.es/c", isAvailable: false },
    ],
  });

  assert.equal(offers[0].canonicalSupplier, "OBRAMAT");
  assert.equal(offers[0].isTraceable, true);
  assert.equal(offers.at(-1).isAvailable, false);
});

test("provider comparison reports partial coverage instead of presenting a partial subtotal as a full basket", () => {
  const coverage = buildProviderBasketCoverage([
    {
      id: "m1", name: "Mortero", quantity: 10, included: true, unit_price: 4,
      priceAlternatives: [
        { supplier: "OBRAMAT", title: "Mortero", price: 4, unit: "saco", qualityTier: "media", confidenceScore: 0.82, sourceType: "provider_updated", url: "https://obramat.es/m" },
      ],
    },
    {
      id: "m2", name: "Pintura", quantity: 2, included: true, unit_price: 30,
      priceAlternatives: [
        { supplier: "Leroy Merlin", title: "Pintura", price: 28, unit: "ud", qualityTier: "media", confidenceScore: 0.86, sourceType: "provider_updated", url: "https://leroymerlin.es/p" },
      ],
    },
  ]);

  assert.equal(coverage.length, 2);
  assert.equal(coverage[0].coveragePercent, 50);
  assert.equal(coverage[0].matchedMaterials, 1);
  assert.equal(coverage[0].totalMaterials, 2);
});

test("untraceable candidates never create fake provider reliability or delivery promises", () => {
  const coverage = buildProviderBasketCoverage([
    {
      id: "m1", name: "Mortero", quantity: 10, included: true, unit_price: 4,
      priceAlternatives: [
        { supplier: "Referencia mercado ES", title: "Estimación", price: 4, unit: "saco", qualityTier: "media", confidenceScore: 0.82, deliveryDays: 7 },
        { supplier: "OBRAMAT", title: "Mortero oficial", price: 4.2, unit: "saco", qualityTier: "media", confidenceScore: 0.84, sourceType: "provider_updated", url: "https://obramat.es/m", deliveryDays: 3 },
      ],
    },
  ]);

  assert.equal(coverage.length, 1);
  assert.equal(coverage[0].name, "OBRAMAT");
  assert.equal(coverage[0].traceableMaterials, 1);
  assert.equal(coverage[0].averageConfidence, 0.84);
  assert.equal(coverage[0].maxDeliveryDays, 3);
});

test("comparison rejects implausible effective-price outliers until their unit conversion is validated", () => {
  const offers = getComparableOffers({
    id: "m1", name: "Mortero", quantity: 10, included: true, unit_price: 4,
    priceAlternatives: [
      { supplier: "OBRAMAT", title: "Mortero comparable", price: 4.1, unit: "saco", qualityTier: "media", confidenceScore: 0.86, sourceType: "provider_updated", url: "https://obramat.es/m" },
      { supplier: "Marketplace", title: "Palé sin conversión", price: 120, unit: "saco", qualityTier: "media", confidenceScore: 0.82, sourceType: "provider_updated", url: "https://example.com/pale" },
    ],
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].canonicalSupplier, "OBRAMAT");
});
