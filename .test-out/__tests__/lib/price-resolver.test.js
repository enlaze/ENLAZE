"use strict";
/**
 * Tests for lib/price-resolver.ts
 *
 * Captures current behavior before refactoring.
 * Run: npx tsx --test __tests__/lib/price-resolver.test.ts
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const price_resolver_1 = require("../../lib/price-resolver");
// ─── normalizeUnit ───────────────────────────────────────────────────────
(0, node_test_1.describe)("normalizeUnit", () => {
    (0, node_test_1.it)("normalizes m² to m2", () => {
        strict_1.default.equal((0, price_resolver_1.normalizeUnit)("m²"), "m2");
    });
    (0, node_test_1.it)("normalizes metros cuadrados to m2", () => {
        strict_1.default.equal((0, price_resolver_1.normalizeUnit)("metros cuadrados"), "m2");
    });
    (0, node_test_1.it)("normalizes ud variants", () => {
        strict_1.default.equal((0, price_resolver_1.normalizeUnit)("uds"), "ud");
        strict_1.default.equal((0, price_resolver_1.normalizeUnit)("unidad"), "ud");
        strict_1.default.equal((0, price_resolver_1.normalizeUnit)("unidades"), "ud");
    });
    (0, node_test_1.it)("normalizes ml variants", () => {
        strict_1.default.equal((0, price_resolver_1.normalizeUnit)("metros lineales"), "ml");
        strict_1.default.equal((0, price_resolver_1.normalizeUnit)("metro lineal"), "ml");
    });
    (0, node_test_1.it)("preserves unknown units", () => {
        strict_1.default.equal((0, price_resolver_1.normalizeUnit)("foobar"), "foobar");
    });
    (0, node_test_1.it)("is case-insensitive", () => {
        strict_1.default.equal((0, price_resolver_1.normalizeUnit)("M²"), "m2");
        strict_1.default.equal((0, price_resolver_1.normalizeUnit)("UD"), "ud");
    });
});
// ─── normalizeMaterialName ───────────────────────────────────────────────
(0, node_test_1.describe)("normalizeMaterialName", () => {
    (0, node_test_1.it)("lowercases", () => {
        strict_1.default.equal((0, price_resolver_1.normalizeMaterialName)("AZULEJO"), "azulejo");
    });
    (0, node_test_1.it)("strips accents", () => {
        strict_1.default.equal((0, price_resolver_1.normalizeMaterialName)("Porcelánico"), "porcelanico");
    });
    (0, node_test_1.it)("strips parenthetical content", () => {
        const result = (0, price_resolver_1.normalizeMaterialName)("Cable (rollo 100m)");
        strict_1.default.ok(!result.includes("rollo"));
        strict_1.default.ok(!result.includes("100m"));
        strict_1.default.ok(result.includes("cable"));
    });
    (0, node_test_1.it)("collapses whitespace", () => {
        const result = (0, price_resolver_1.normalizeMaterialName)("  azulejo   porcelanico  ");
        strict_1.default.equal(result, "azulejo porcelanico");
    });
});
// ─── classifyQualityTier ─────────────────────────────────────────────────
(0, node_test_1.describe)("classifyQualityTier", () => {
    (0, node_test_1.it)("detects alta quality keywords", () => {
        strict_1.default.equal((0, price_resolver_1.classifyQualityTier)("Porcelánico premium rectificado", "pavimentos", "media"), "alta");
    });
    (0, node_test_1.it)("detects basica quality keywords", () => {
        strict_1.default.equal((0, price_resolver_1.classifyQualityTier)("Suelo vinilico económico", "pavimentos", "media"), "basica");
    });
    (0, node_test_1.it)("returns requested tier when no keyword match", () => {
        strict_1.default.equal((0, price_resolver_1.classifyQualityTier)("Suelo de algo normal", "pavimentos", "media"), "media");
    });
    (0, node_test_1.it)("returns requested tier for unknown chapter", () => {
        strict_1.default.equal((0, price_resolver_1.classifyQualityTier)("Premium super", "unknown_chapter", "basica"), "basica");
    });
});
// ─── getQualityMultiplier ────────────────────────────────────────────────
(0, node_test_1.describe)("getQualityMultiplier", () => {
    (0, node_test_1.it)("returns 1.0 for media quality", () => {
        strict_1.default.equal((0, price_resolver_1.getQualityMultiplier)("pavimentos", "media"), 1.0);
        strict_1.default.equal((0, price_resolver_1.getQualityMultiplier)("sanitarios", "media"), 1.0);
    });
    (0, node_test_1.it)("returns < 1 for basica", () => {
        const mult = (0, price_resolver_1.getQualityMultiplier)("pavimentos", "basica");
        strict_1.default.ok(mult < 1);
        strict_1.default.ok(mult > 0);
    });
    (0, node_test_1.it)("returns > 1 for alta", () => {
        const mult = (0, price_resolver_1.getQualityMultiplier)("pavimentos", "alta");
        strict_1.default.ok(mult > 1);
    });
    (0, node_test_1.it)("uses default for unknown chapter", () => {
        const mult = (0, price_resolver_1.getQualityMultiplier)("unknown_chapter", "alta");
        strict_1.default.equal(mult, 1.35);
    });
});
// ─── resolveMaterialPrice ────────────────────────────────────────────────
(0, node_test_1.describe)("resolveMaterialPrice", () => {
    const baseRequest = {
        materialName: "Azulejo porcelanico pared",
        category: "revestimientos",
        unit: "m2",
        quantity: 30,
        qualityTier: "media",
        location: "Valencia",
    };
    (0, node_test_1.it)("resolves from user catalog (level 1)", () => {
        const result = (0, price_resolver_1.resolveMaterialPrice)(baseRequest, [{ name: "Azulejo porcelanico pared", unit_price: 25, unit: "m2", supplier_name: "Mi proveedor", source_type: "manual" }]);
        strict_1.default.equal(result.sourceType, "user_catalog");
        strict_1.default.equal(result.selectedPrice, 25);
        strict_1.default.ok(result.confidenceScore >= 0.9);
    });
    (0, node_test_1.it)("resolves from technical bank (level 2)", () => {
        const result = (0, price_resolver_1.resolveMaterialPrice)(baseRequest, [], // no user prices
        [], // no enlaze prices
        [], // no n8n prices
        [], // no web results
        [{ name: "Azulejo porcelanico pared", item_code: "R01", unit: "m2", unit_price: 18.50, confidence_score: 0.85, source: "cype", region: "valencia" }]);
        strict_1.default.equal(result.sourceType, "technical_bank");
        strict_1.default.equal(result.selectedPrice, 18.50);
    });
    (0, node_test_1.it)("resolves from enlaze base (level 3)", () => {
        const result = (0, price_resolver_1.resolveMaterialPrice)(baseRequest, [], // no user
        [{ name: "Azulejo porcelanico pared", unit_price: 20, unit: "m2", supplier_name: "Banco ENLAZE" }]);
        strict_1.default.equal(result.sourceType, "enlaze_base");
        strict_1.default.equal(result.selectedPrice, 20);
    });
    (0, node_test_1.it)("resolves from n8n market (level 4)", () => {
        const result = (0, price_resolver_1.resolveMaterialPrice)(baseRequest, [], [], [{ title: "Azulejo porcelanico pared", value: 22, unit: "m2", source: "n8n_feed" }]);
        strict_1.default.equal(result.sourceType, "n8n_market");
        strict_1.default.equal(result.selectedPrice, 22);
    });
    (0, node_test_1.it)("resolves from web search (level 6)", () => {
        const result = (0, price_resolver_1.resolveMaterialPrice)(baseRequest, [], [], [], [
            { supplier: "Leroy Merlin", title: "Azulejo A", price: 15, unit: "m2", qualityTier: "media" },
            { supplier: "Obramat", title: "Azulejo B", price: 20, unit: "m2", qualityTier: "media" },
            { supplier: "Bricomart", title: "Azulejo C", price: 25, unit: "m2", qualityTier: "media" },
        ]);
        strict_1.default.equal(result.sourceType, "web_search");
        strict_1.default.ok(result.selectedPrice > 0);
        strict_1.default.ok(result.alternatives.length >= 3);
    });
    (0, node_test_1.it)("falls back to internal estimate (level 7)", () => {
        const result = (0, price_resolver_1.resolveMaterialPrice)(baseRequest);
        strict_1.default.equal(result.sourceType, "estimated");
        strict_1.default.ok(result.selectedPrice > 0);
        strict_1.default.ok(result.confidenceScore < 0.5);
    });
    (0, node_test_1.it)("returns zero for completely unknown material", () => {
        const result = (0, price_resolver_1.resolveMaterialPrice)({
            ...baseRequest,
            materialName: "Producto completamente irreconocible e imposible de encontrar 12345",
        });
        strict_1.default.equal(result.sourceType, "estimated");
        strict_1.default.ok(result.confidenceScore <= 0.15);
    });
    (0, node_test_1.it)("respects priority order (user > technical > enlaze)", () => {
        const result = (0, price_resolver_1.resolveMaterialPrice)(baseRequest, [{ name: "Azulejo porcelanico pared", unit_price: 99, unit: "m2", supplier_name: "User", source_type: "manual" }], [{ name: "Azulejo porcelanico pared", unit_price: 20, unit: "m2", supplier_name: "Enlaze" }], [], [], [{ name: "Azulejo porcelanico pared", item_code: "R01", unit: "m2", unit_price: 18, confidence_score: 0.9, source: "cype", region: "es" }]);
        // User price should win
        strict_1.default.equal(result.sourceType, "user_catalog");
        strict_1.default.equal(result.selectedPrice, 99);
    });
});
// ─── resolvePricesForBudget ──────────────────────────────────────────────
(0, node_test_1.describe)("resolvePricesForBudget", () => {
    (0, node_test_1.it)("resolves batch and identifies materials needing web search", () => {
        const result = (0, price_resolver_1.resolvePricesForBudget)({
            materials: [
                { materialName: "Azulejo porcelanico pared", category: "revestimientos", unit: "m2", quantity: 30, qualityTier: "media", location: "Madrid" },
                { materialName: "Producto imposible XYZ9999", category: "otros", unit: "ud", quantity: 1, qualityTier: "media", location: "Madrid" },
            ],
        });
        strict_1.default.equal(result.resolved.length, 2);
        // The unknown product should be in needsWebSearch
        strict_1.default.ok(result.needsWebSearch.length >= 1);
        strict_1.default.ok(result.needsWebSearch.some((r) => r.materialName.includes("XYZ9999")));
    });
});
// ─── Cache helpers ───────────────────────────────────────────────────────
(0, node_test_1.describe)("cache helpers", () => {
    (0, node_test_1.it)("buildCacheEntry creates valid entry", () => {
        const resolved = (0, price_resolver_1.resolveMaterialPrice)({
            materialName: "Azulejo porcelanico pared",
            category: "revestimientos",
            unit: "m2",
            quantity: 10,
            qualityTier: "media",
            location: "Valencia",
        });
        const entry = (0, price_resolver_1.buildCacheEntry)(resolved, "Valencia");
        strict_1.default.equal(entry.location, "Valencia");
        strict_1.default.ok(entry.cachedAt);
        strict_1.default.ok(entry.expiresAt);
        strict_1.default.ok(new Date(entry.expiresAt) > new Date(entry.cachedAt));
    });
    (0, node_test_1.it)("isCacheValid returns true for fresh entry", () => {
        const resolved = (0, price_resolver_1.resolveMaterialPrice)({
            materialName: "Test",
            category: "test",
            unit: "ud",
            quantity: 1,
            qualityTier: "media",
            location: "test",
        });
        const entry = (0, price_resolver_1.buildCacheEntry)(resolved, "test");
        strict_1.default.equal((0, price_resolver_1.isCacheValid)(entry), true);
    });
    (0, node_test_1.it)("isCacheValid returns false for expired entry", () => {
        const entry = {
            materialName: "test",
            normalizedName: "test",
            unit: "ud",
            qualityTier: "media",
            location: "test",
            resolvedPrice: {},
            cachedAt: "2020-01-01T00:00:00Z",
            expiresAt: "2020-01-02T00:00:00Z",
        };
        strict_1.default.equal((0, price_resolver_1.isCacheValid)(entry), false);
    });
});
