"use strict";
/**
 * Tests for lib/provider-comparison.ts (pure functions only)
 *
 * Run: npx tsc -p tsconfig.test.json --noEmit false && node --test .test-out/__tests__/lib/provider-comparison.test.js
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const provider_comparison_1 = require("../../lib/provider-comparison");
// ─── Test data ──────────────────────────────────────────────────────────────
function mockOption(overrides) {
    return {
        provider_id: "prov-001",
        provider_name: "Proveedor A",
        product_id: "prod-001",
        product_name: "Ladrillo hueco doble",
        brand: null,
        sku: null,
        unit_price: 0.45,
        effective_price_per_unit: 0.50,
        total_effective_cost: 500,
        unit: "ud",
        units_per_package: 1,
        minimum_order: 0,
        shipping_cost: 25,
        free_shipping_min: null,
        delivery_days_min: 1,
        delivery_days_max: 3,
        is_available: true,
        is_preferred: false,
        confidence_score: 0.85,
        source_type: "provider_catalog",
        checked_at: "2026-07-01T00:00:00Z",
        discount_pct: 0,
        ranking_score: 0,
        ranking_reasons: [],
        ...overrides,
    };
}
// ─── rankProviderOptions ────────────────────────────────────────────────────
(0, node_test_1.describe)("rankProviderOptions", () => {
    (0, node_test_1.it)("returns empty array for empty input", () => {
        const result = (0, provider_comparison_1.rankProviderOptions)([]);
        strict_1.default.equal(result.length, 0);
    });
    (0, node_test_1.it)("handles single provider", () => {
        const options = [mockOption()];
        const result = (0, provider_comparison_1.rankProviderOptions)(options);
        strict_1.default.equal(result.length, 1);
        strict_1.default.equal(result[0].ranking_score, 0);
        strict_1.default.ok(result[0].ranking_reasons.includes("Unico proveedor disponible"));
    });
    (0, node_test_1.it)("ranks cheaper provider higher", () => {
        const options = [
            mockOption({
                provider_id: "expensive",
                provider_name: "Caro",
                effective_price_per_unit: 10.0,
                total_effective_cost: 1000,
            }),
            mockOption({
                provider_id: "cheap",
                provider_name: "Barato",
                effective_price_per_unit: 5.0,
                total_effective_cost: 500,
            }),
        ];
        const result = (0, provider_comparison_1.rankProviderOptions)(options);
        strict_1.default.equal(result[0].provider_id, "cheap");
        strict_1.default.ok(result[0].ranking_score < result[1].ranking_score);
    });
    (0, node_test_1.it)("gives bonus to preferred providers (equal price)", () => {
        const options = [
            mockOption({
                provider_id: "normal",
                provider_name: "Normal",
                effective_price_per_unit: 5.0,
                is_preferred: false,
            }),
            mockOption({
                provider_id: "preferred",
                provider_name: "Preferido",
                effective_price_per_unit: 5.0, // same price
                is_preferred: true,
            }),
        ];
        const result = (0, provider_comparison_1.rankProviderOptions)(options);
        // Preferred should rank better at equal price
        strict_1.default.equal(result[0].provider_id, "preferred");
    });
    (0, node_test_1.it)("penalizes unavailable providers (equal price)", () => {
        const options = [
            mockOption({
                provider_id: "unavailable",
                provider_name: "No disponible",
                effective_price_per_unit: 5.0,
                is_available: false,
            }),
            mockOption({
                provider_id: "available",
                provider_name: "Disponible",
                effective_price_per_unit: 5.0,
                is_available: true,
            }),
        ];
        const result = (0, provider_comparison_1.rankProviderOptions)(options);
        // Available should rank better at equal price
        strict_1.default.equal(result[0].provider_id, "available");
    });
    (0, node_test_1.it)("considers delivery time in ranking", () => {
        const options = [
            mockOption({
                provider_id: "slow",
                provider_name: "Lento",
                effective_price_per_unit: 5.0,
                delivery_days_max: 30,
            }),
            mockOption({
                provider_id: "fast",
                provider_name: "Rapido",
                effective_price_per_unit: 5.0,
                delivery_days_max: 2,
            }),
        ];
        const result = (0, provider_comparison_1.rankProviderOptions)(options);
        strict_1.default.equal(result[0].provider_id, "fast");
    });
    (0, node_test_1.it)("generates ranking reasons", () => {
        const options = [
            mockOption({
                provider_id: "best",
                effective_price_per_unit: 1.0,
                is_preferred: true,
                confidence_score: 0.95,
                discount_pct: 10,
            }),
            mockOption({
                provider_id: "worst",
                effective_price_per_unit: 100.0,
                is_available: false,
                confidence_score: 0.3,
            }),
        ];
        const result = (0, provider_comparison_1.rankProviderOptions)(options);
        const best = result.find((o) => o.provider_id === "best");
        const worst = result.find((o) => o.provider_id === "worst");
        strict_1.default.ok(best.ranking_reasons.includes("Precio mas bajo"));
        strict_1.default.ok(best.ranking_reasons.includes("Proveedor preferido"));
        strict_1.default.ok(best.ranking_reasons.includes("Alta fiabilidad de precio"));
        strict_1.default.ok(best.ranking_reasons.includes("Descuento 10%"));
        strict_1.default.ok(worst.ranking_reasons.includes("Precio elevado"));
        strict_1.default.ok(worst.ranking_reasons.includes("No disponible actualmente"));
        strict_1.default.ok(worst.ranking_reasons.includes("Precio poco fiable"));
    });
    (0, node_test_1.it)("respects custom weights", () => {
        const options = [
            mockOption({
                provider_id: "cheap-slow",
                effective_price_per_unit: 1.0,
                delivery_days_max: 30,
            }),
            mockOption({
                provider_id: "expensive-fast",
                effective_price_per_unit: 10.0,
                delivery_days_max: 1,
            }),
        ];
        // Weight delivery heavily
        const deliveryWeighted = (0, provider_comparison_1.rankProviderOptions)(options, {
            price: 0.1,
            delivery: 0.7,
            confidence: 0.1,
            availability: 0.05,
            preferred: 0.05,
        });
        strict_1.default.equal(deliveryWeighted[0].provider_id, "expensive-fast");
        // Weight price heavily
        const priceWeighted = (0, provider_comparison_1.rankProviderOptions)(options, {
            price: 0.8,
            delivery: 0.05,
            confidence: 0.05,
            availability: 0.05,
            preferred: 0.05,
        });
        strict_1.default.equal(priceWeighted[0].provider_id, "cheap-slow");
    });
});
