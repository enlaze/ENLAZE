"use strict";
/**
 * Tests for lib/price-resolver-v2.ts
 *
 * Run: npx tsx --test __tests__/lib/price-resolver-v2.test.ts
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const price_resolver_v2_1 = require("../../lib/price-resolver-v2");
// ─── Fixtures ─────────────────────────────────────────────────────────────
function makeContext(overrides) {
    return {
        company_id: "user-123",
        province: "Madrid",
        quality_tier: "media",
        ...overrides,
    };
}
function emptyData() {
    return {
        current_prices: [],
        manual_prices: [],
        historical_prices: [],
        technical_prices: [],
        enlaze_prices: [],
    };
}
function makeCurrentPrice(overrides) {
    return {
        product_id: "prod-1",
        product_name: "Cemento Portland CEM II 32.5 saco 25kg",
        concept_id: null,
        concept_name: null,
        provider_id: "prov-1",
        provider_name: "Leroy Merlin",
        provider_province: "Madrid",
        provider_supply_zones: [],
        is_preferred: false,
        brand: "CEMEX",
        sku: null,
        unit: "saco",
        units_per_package: 1,
        price_excl_vat: 4.5,
        effective_price: null,
        shipping_cost: 0,
        minimum_order: 0,
        delivery_days_min: 1,
        delivery_days_max: 3,
        is_available: true,
        confidence_score: 0.85,
        source_type: "provider_updated",
        checked_at: new Date().toISOString(),
        price_changed_at: null,
        is_private_tariff: false,
        is_negotiated: false,
        ...overrides,
    };
}
// ─── Level 1: Manual locked ──────────────────────────────────────────────
(0, node_test_1.describe)("resolveForConcept — manual_locked (level 1)", () => {
    (0, node_test_1.it)("selects locked manual price with highest priority", () => {
        const data = emptyData();
        data.manual_prices = [
            {
                name: "Cemento Portland",
                unit: "saco",
                unit_price: 5.0,
                supplier_name: "Mi proveedor",
                source_type: "manual",
                is_locked: true,
            },
        ];
        data.current_prices = [
            makeCurrentPrice({ price_excl_vat: 4.0, provider_name: "Obramat" }),
        ];
        const result = (0, price_resolver_v2_1.resolveForConcept)({ concept_name: "Cemento Portland", category: "albanileria", unit: "saco", quantity: 10 }, makeContext(), data);
        strict_1.default.equal(result.source_type, "manual_locked");
        strict_1.default.equal(result.unit_price, 5.0);
        strict_1.default.equal(result.confidence_score, 1.0);
    });
});
// ─── Level 5: Preferred supplier ─────────────────────────────────────────
(0, node_test_1.describe)("resolveForConcept — preferred_supplier (level 5)", () => {
    (0, node_test_1.it)("selects preferred supplier over regular providers", () => {
        const data = emptyData();
        data.current_prices = [
            makeCurrentPrice({
                product_id: "prod-1",
                product_name: "Cemento Portland CEM II 25kg",
                provider_id: "prov-1",
                provider_name: "Regular Store",
                price_excl_vat: 3.0,
                is_preferred: false,
            }),
            makeCurrentPrice({
                product_id: "prod-2",
                product_name: "Cemento Portland CEM II saco 25kg",
                provider_id: "prov-2",
                provider_name: "Preferred Store",
                price_excl_vat: 4.0,
                is_preferred: true,
            }),
        ];
        const result = (0, price_resolver_v2_1.resolveForConcept)({ concept_name: "Cemento Portland", category: "albanileria", unit: "saco", quantity: 10 }, makeContext(), data);
        strict_1.default.equal(result.source_type, "preferred_supplier");
        strict_1.default.equal(result.provider_name, "Preferred Store");
        strict_1.default.equal(result.unit_price, 4.0);
    });
});
// ─── Level 6: Provider updated (cheapest) ────────────────────────────────
(0, node_test_1.describe)("resolveForConcept — provider_updated (level 6)", () => {
    (0, node_test_1.it)("picks cheapest effective price from available providers", () => {
        const data = emptyData();
        data.current_prices = [
            makeCurrentPrice({
                product_id: "prod-1",
                product_name: "Azulejo porcelanico 60x60",
                provider_id: "prov-1",
                provider_name: "Leroy",
                price_excl_vat: 25.0,
                shipping_cost: 5,
            }),
            makeCurrentPrice({
                product_id: "prod-2",
                product_name: "Azulejo porcelanico 60x60 rectificado",
                provider_id: "prov-2",
                provider_name: "Obramat",
                price_excl_vat: 22.0,
                shipping_cost: 0,
            }),
        ];
        const result = (0, price_resolver_v2_1.resolveForConcept)({ concept_name: "Azulejo porcelanico 60x60", category: "revestimientos", unit: "m2", quantity: 20 }, makeContext(), data);
        strict_1.default.equal(result.source_type, "provider_updated");
        strict_1.default.equal(result.provider_name, "Obramat");
        strict_1.default.equal(result.unit_price, 22.0);
    });
});
// ─── Level 8: Technical bank ─────────────────────────────────────────────
(0, node_test_1.describe)("resolveForConcept — technical_bank (level 8)", () => {
    (0, node_test_1.it)("falls back to technical bank when no provider data", () => {
        const data = emptyData();
        data.technical_prices = [
            {
                name: "Azulejo porcelánico 60x60",
                item_code: "AZ001",
                unit: "m2",
                unit_price: 28.0,
                confidence_score: 0.8,
                source: "Base CYPE",
                region: "Madrid",
                is_private: false,
            },
        ];
        const result = (0, price_resolver_v2_1.resolveForConcept)({ concept_name: "Azulejo porcelanico 60x60", category: "revestimientos", unit: "m2", quantity: 20 }, makeContext(), data);
        strict_1.default.equal(result.source_type, "technical_bank");
        strict_1.default.equal(result.unit_price, 28.0);
    });
});
// ─── Cascade order ───────────────────────────────────────────────────────
(0, node_test_1.describe)("resolveForConcept — cascade order", () => {
    (0, node_test_1.it)("manual_locked beats everything", () => {
        const data = emptyData();
        data.manual_prices = [
            { name: "Cemento", unit: "saco", unit_price: 10, supplier_name: "Manual", source_type: "manual", is_locked: true },
        ];
        data.current_prices = [
            makeCurrentPrice({ product_name: "Cemento Portland", price_excl_vat: 5, is_preferred: true }),
        ];
        data.technical_prices = [
            { name: "Cemento Portland", item_code: "C1", unit: "saco", unit_price: 3, confidence_score: 0.9, source: "CYPE", region: "ES", is_private: false },
        ];
        const result = (0, price_resolver_v2_1.resolveForConcept)({ concept_name: "Cemento Portland", category: "albanileria", unit: "saco", quantity: 1 }, makeContext(), data);
        strict_1.default.equal(result.source_type, "manual_locked");
        strict_1.default.equal(result.unit_price, 10);
    });
    (0, node_test_1.it)("returns zero price fallback when nothing matches", () => {
        const result = (0, price_resolver_v2_1.resolveForConcept)({ concept_name: "Producto inexistente XYZ 123", category: "otros", unit: "ud", quantity: 1 }, makeContext(), emptyData());
        strict_1.default.equal(result.unit_price, 0);
        strict_1.default.equal(result.source_type, "estimated");
        strict_1.default.ok(result.confidence_score < 0.1);
        strict_1.default.ok(result.warnings.length > 0);
    });
});
// ─── Province filtering ─────────────────────────────────────────────────
(0, node_test_1.describe)("resolveForConcept — province filtering", () => {
    (0, node_test_1.it)("excludes providers from other provinces without supply zones", () => {
        const data = emptyData();
        data.current_prices = [
            makeCurrentPrice({
                product_name: "Ladrillo perforado",
                provider_province: "Barcelona",
                provider_supply_zones: [],
                price_excl_vat: 0.5,
            }),
        ];
        const result = (0, price_resolver_v2_1.resolveForConcept)({ concept_name: "Ladrillo perforado", category: "albanileria", unit: "ud", quantity: 100 }, makeContext({ province: "Madrid" }), data);
        // Should NOT match Barcelona-only provider for Madrid project
        strict_1.default.notEqual(result.source_type, "provider_updated");
    });
    (0, node_test_1.it)("includes providers that serve the province via supply zones", () => {
        const data = emptyData();
        data.current_prices = [
            makeCurrentPrice({
                product_name: "Ladrillo perforado",
                provider_province: "Barcelona",
                provider_supply_zones: ["Madrid", "Toledo", "Guadalajara"],
                price_excl_vat: 0.5,
            }),
        ];
        const result = (0, price_resolver_v2_1.resolveForConcept)({ concept_name: "Ladrillo perforado", category: "albanileria", unit: "ud", quantity: 100 }, makeContext({ province: "Madrid" }), data);
        strict_1.default.equal(result.source_type, "provider_updated");
        strict_1.default.equal(result.unit_price, 0.5);
    });
});
// ─── Batch resolution ──────────────────────────────────────────────────
(0, node_test_1.describe)("resolveForBudget", () => {
    (0, node_test_1.it)("resolves multiple items and returns summary", () => {
        const data = emptyData();
        data.manual_prices = [
            { name: "Cemento Portland", unit: "saco", unit_price: 5.0, supplier_name: "Manual", source_type: "manual", is_locked: true },
        ];
        data.current_prices = [
            makeCurrentPrice({ product_name: "Azulejo porcelanico 60x60", price_excl_vat: 22.0 }),
        ];
        const items = [
            { concept_name: "Cemento Portland", category: "albanileria", unit: "saco", quantity: 50 },
            { concept_name: "Azulejo porcelanico 60x60", category: "revestimientos", unit: "m2", quantity: 20 },
            { concept_name: "Producto fantasma XYZ", category: "otros", unit: "ud", quantity: 1 },
        ];
        const result = (0, price_resolver_v2_1.resolveForBudget)({
            items,
            context: makeContext(),
            data,
        });
        strict_1.default.equal(result.results.length, 3);
        strict_1.default.equal(result.summary.total, 3);
        strict_1.default.equal(result.summary.resolved, 2); // 2 with price > 0
        strict_1.default.equal(result.summary.zero_price, 1);
        strict_1.default.ok(result.summary.by_source["manual_locked"] >= 1);
        strict_1.default.ok(result.summary.avg_confidence > 0);
    });
});
