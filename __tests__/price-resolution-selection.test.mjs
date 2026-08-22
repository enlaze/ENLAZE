import test from "node:test";
import assert from "node:assert/strict";

import { preferTraceableCommercialAlternative } from "../lib/price-resolution-selection.ts";

const request = {
  materialName: "Perfil metalico para Pladur (montante 48mm)",
  category: "material",
  unit: "ud",
  quantity: 52,
  referenceUnitPrice: 3.2,
  qualityTier: "media",
  location: "Alicante",
};

function provisionalResolution(overrides = {}) {
  return {
    materialName: request.materialName,
    normalizedName: "perfil metalico para pladur montante 48mm",
    selectedProductName: request.materialName,
    category: "material",
    unit: "ud",
    sourceUnit: "ud",
    quantity: 52,
    qualityTier: "media",
    selectedPrice: 3.2,
    priceMin: 3.2,
    priceMedian: 3.2,
    priceMax: 3.2,
    selectedSupplier: "Referencia mercado",
    sourceUrl: "",
    sourceType: "market_estimate",
    confidenceScore: 0.35,
    capturedAt: "2026-08-22T10:00:00.000Z",
    alternatives: [],
    ...overrides,
  };
}

test("an exact official supplier offer replaces a provisional material price", () => {
  const result = preferTraceableCommercialAlternative(provisionalResolution({
    alternatives: [
      {
        supplier: "OBRAMAT",
        title: "MONTANTE PLACO 48 MM 3 M",
        price: 2.58,
        unit: "ud",
        qualityTier: "media",
        url: "https://www.obramat.es/productos/montante-placo-48-mm-3-m-10926503.html",
        sourceType: "n8n_market",
        confidenceScore: 0.82,
        matchScore: 0.92,
        isAvailable: true,
        checkedAt: "2026-08-21T09:00:00.000Z",
      },
    ],
  }), request);

  assert.equal(result.selectedSupplier, "OBRAMAT");
  assert.equal(result.selectedProductName, "MONTANTE PLACO 48 MM 3 M");
  assert.equal(result.selectedPrice, 2.58);
  assert.equal(result.sourceType, "n8n_market");
  assert.equal(result.confidenceScore, 0.82);
});

test("a wrong profile dimension is never promoted", () => {
  const original = provisionalResolution({
    alternatives: [
      {
        supplier: "OBRAMAT",
        title: "MONTANTE PLACO 70 MM 3 M",
        price: 2.2,
        unit: "ud",
        qualityTier: "media",
        url: "https://www.obramat.es/productos/montante-placo-70-mm-3-m.html",
        sourceType: "n8n_market",
        confidenceScore: 0.9,
        matchScore: 0.95,
        isAvailable: true,
      },
    ],
  });

  assert.deepEqual(preferTraceableCommercialAlternative(original, request), original);
});

test("company-controlled prices keep priority over catalogue alternatives", () => {
  const manual = provisionalResolution({
    selectedPrice: 2.9,
    selectedSupplier: "Tarifa propia",
    sourceType: "private_tariff",
    alternatives: [
      {
        supplier: "OBRAMAT",
        title: "MONTANTE PLACO 48 MM 3 M",
        price: 2.58,
        unit: "ud",
        qualityTier: "media",
        url: "https://www.obramat.es/productos/montante-placo-48-mm-3-m-10926503.html",
        sourceType: "n8n_market",
        confidenceScore: 0.82,
        matchScore: 0.92,
      },
    ],
  });

  assert.deepEqual(preferTraceableCommercialAlternative(manual, request), manual);
});
