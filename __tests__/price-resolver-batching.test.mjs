import test from "node:test";
import assert from "node:assert/strict";

import { resolveMarketPricesBatched } from "../lib/price-resolver.ts";

test("large baskets are resolved sequentially in stable, complete batches", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    setTimeout,
    clearTimeout,
  };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    calls.push(body.materials.map((material) => material.materialName));
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          resolved: body.materials.map((material) => ({
            materialName: material.materialName,
            selectedPrice: material.referenceUnitPrice,
          })),
          summary: {
            total: body.materials.length,
            fromUserCatalog: 0,
            fromEnlaze: 0,
            fromN8n: body.materials.length,
            fromWebSearch: 0,
            fromCache: 0,
            estimated: 0,
            webSearchesPerformed: 0,
            webSearchesSuccessful: 0,
            tracker_products_available: 41_616,
            tracker_candidates: body.materials.length,
            avg_confidence: 0.82,
            by_source: { provider_updated: body.materials.length },
          },
          cachedUntil: "",
        };
      },
    };
  };

  try {
    const materials = Array.from({ length: 17 }, (_, index) => ({
      materialName: `Producto ${index + 1}`,
      category: "material",
      unit: "ud",
      quantity: 1,
      referenceUnitPrice: index + 1,
      qualityTier: "media",
      location: "Alicante",
    }));
    const result = await resolveMarketPricesBatched({ materials, location: "Alicante" }, 8);

    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((batch) => batch.length), [8, 8, 1]);
    assert.deepEqual(result.resolved.map((resolved) => resolved.materialName), materials.map((material) => material.materialName));
    assert.equal(result.summary.total, 17);
    assert.equal(result.summary.fromN8n, 17);
    assert.equal(result.summary.tracker_products_available, 41_616);
    assert.equal(result.summary.by_source.provider_updated, 17);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
