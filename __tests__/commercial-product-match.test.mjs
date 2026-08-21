import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateCommercialProductMatch,
  isProductSpecificSourceUrl,
} from "../lib/commercial-product-match.ts";
import { isTraceableCommercialPrice } from "../lib/price-traceability.ts";

function evaluate(overrides) {
  return evaluateCommercialProductMatch({
    requestedName: "Mortero de cemento M-7.5 (saco 25kg)",
    candidateName: "Mortero de cemento M-7.5 saco 25 kg",
    requestedUnit: "sacos",
    candidateUnit: "ud",
    referenceUnitPrice: 3.5,
    candidateUnitPrice: 3.64,
    ...overrides,
  });
}

test("an exact package match is accepted even when the catalogue stores it as one unit", () => {
  const result = evaluate({});
  assert.equal(result.isExact, true);
  assert.ok(result.score >= 0.8);
});

test("measurements inside parentheses are mandatory and reject a 2kg product for a 25kg requirement", () => {
  const result = evaluate({ candidateName: "Mortero Portland 2 kg" });
  assert.equal(result.isExact, false);
  assert.equal(result.formatCompatible, false);
  assert.match(result.reasons.join(" "), /25kg/i);
});

test("official M-7.5 mortar is accepted while other grades and mortar variants are rejected", () => {
  assert.equal(evaluate({ candidateName: "MORTERO SECO M7.5 25 KG GRIS", candidateUnit: "ud", candidateUnitPrice: 1.55 }).isExact, true);
  assert.equal(evaluate({ candidateName: "Mortero seco M-5 saco 25 kg" }).isExact, false);
  assert.equal(evaluate({ candidateName: "Mortero seco M-10 saco 25 kg" }).isExact, false);
  assert.equal(evaluate({ candidateName: "Mortero cola C2TE saco 25 kg" }).isExact, false);
  assert.equal(evaluate({ candidateName: "Mortero autonivelante saco 25 kg" }).isExact, false);
});

test("three-dimensional catalogue formats expose their thickness", () => {
  const result = evaluateCommercialProductMatch({
    requestedName: "Placa de yeso laminado 13mm (Pladur N)",
    candidateName: "PLACA DE YESO LAMINADO GLASROC H 2000X1200X13MM",
    requestedUnit: "ud",
    candidateUnit: "ud",
    referenceUnitPrice: 9.8,
    candidateUnitPrice: 15.95,
  });
  assert.equal(result.formatCompatible, true);
  assert.equal(result.isExact, true);
});

test("tools and accessories cannot impersonate the requested construction product", () => {
  const profile = evaluateCommercialProductMatch({
    requestedName: "Perfil metalico para Pladur (montante 48mm)",
    candidateName: "Paleta yesero 180x115mm",
    requestedUnit: "ud",
    candidateUnit: "ud",
    referenceUnitPrice: 3.2,
    candidateUnitPrice: 6.33,
  });
  const pipe = evaluateCommercialProductMatch({
    requestedName: "Tuberia multicapa 16mm (rollo 50m)",
    candidateName: "Accesorios de tuberia multicapa tes 25x20x25",
    requestedUnit: "rollos",
    candidateUnit: "ud",
    referenceUnitPrice: 42,
    candidateUnitPrice: 21.76,
  });
  assert.equal(profile.isExact, false);
  assert.equal(pipe.isExact, false);
  assert.equal(pipe.accessoryCompatible, false);
});

test("a component price cannot replace a complete electrical panel or bathroom set", () => {
  const panel = evaluateCommercialProductMatch({
    requestedName: "Cuadro electrico + protecciones",
    candidateName: "Cuadro electrico completo con protecciones",
    requestedUnit: "ud",
    candidateUnit: "ud",
    referenceUnitPrice: 220,
    candidateUnitPrice: 2.58,
  });
  const basin = evaluateCommercialProductMatch({
    requestedName: "Lavabo sobre encimera + monomando",
    candidateName: "Grifo monomando para lavabo",
    requestedUnit: "ud",
    candidateUnit: "ud",
    referenceUnitPrice: 130,
    candidateUnitPrice: 11,
  });
  assert.equal(panel.priceCompatible, false);
  assert.equal(panel.isExact, false);
  assert.equal(basin.bundleCompatible, false);
  assert.equal(basin.isExact, false);
});

test("direct product pages are distinguishable from homepages and catalogue files", () => {
  assert.equal(isProductSpecificSourceUrl("https://www.obramat.es/productos/puerta-10340904.html"), true);
  assert.equal(isProductSpecificSourceUrl("https://www.leroymerlin.es"), false);
  assert.equal(isProductSpecificSourceUrl("https://view.publitas.com/catalogo/page/343"), false);
  assert.equal(isProductSpecificSourceUrl("https://www.acae.es/catalogos/roca/fiebdc-roca.zip"), false);
});

test("commercial traceability requires exact product semantics when match details are present", () => {
  const base = {
    selectedPrice: 3.64,
    sourceType: "provider_updated",
    sourceUrl: "https://supplier.example/product/mortero-25kg",
    confidenceScore: 0.82,
    materialName: "Mortero de cemento M-7.5 (saco 25kg)",
    unit: "sacos",
    sourceUnit: "ud",
    matchScore: 0.9,
  };
  assert.equal(isTraceableCommercialPrice({
    ...base,
    selectedProductName: "Mortero de cemento M-7.5 saco 25kg",
  }), true);
  assert.equal(isTraceableCommercialPrice({
    ...base,
    selectedProductName: "Mortero Portland 2kg",
  }), false);
  assert.equal(isTraceableCommercialPrice({
    ...base,
    selectedProductName: "Mortero de cemento M-7.5 saco 25kg",
    sourceUrl: "https://supplier.example/",
  }), false);
});

test("official catalogues require persisted ingestion evidence", () => {
  const base = {
    selectedPrice: 130,
    sourceType: "provider_updated",
    confidenceScore: 0.82,
    materialName: "Lavabo Roca de porcelana",
    selectedProductName: "Lavabo Roca Ona 600 mm",
    unit: "ud",
    sourceUnit: "ud",
    matchScore: 0.9,
    sourceUrl: "https://www.acae.es/catalogos/roca/fiebdc-roca.zip",
    evidenceType: "official_bc3_catalog",
    evidenceVerification: "official_catalog_sku_raw_price_sha256",
  };

  assert.equal(isTraceableCommercialPrice(base), false);
  assert.equal(isTraceableCommercialPrice({
    ...base,
    evidenceVerified: true,
  }), true);
  assert.equal(isTraceableCommercialPrice({
    ...base,
    evidenceVerified: true,
    evidenceVerification: "provider_payload",
  }), false);

  assert.equal(isTraceableCommercialPrice({
    ...base,
    materialName: "Mortero de cemento M-7.5 (saco 25kg)",
    selectedProductName: "Mortero seco gris M-7.5 25 kg",
    unit: "sacos",
    sourceUnit: "saco",
    sourceUrl: "https://view.publitas.com/catalogo-2026/catalogo-2026-alicante/page/14",
    evidenceType: "official_pdf_catalog",
    evidenceVerification: "official_catalog_sku_source_url_raw_price_sha256",
    evidenceVerified: true,
    selectedPrice: 3.64,
  }), true);
});
