"use strict";
/**
 * Tests for lib/effective-cost.ts
 *
 * Run: npx tsx --test __tests__/lib/effective-cost.test.ts
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const effective_cost_1 = require("../../lib/effective-cost");
(0, node_test_1.describe)("calculateEffectiveCost", () => {
    (0, node_test_1.it)("basic calculation with no extras", () => {
        const result = (0, effective_cost_1.calculateEffectiveCost)({
            unit_price: 10,
            quantity_needed: 5,
            units_per_package: 1,
            minimum_order: 0,
            shipping_cost: 0,
            other_costs: 0,
            discount_pct: 0,
            discount_flat: 0,
        });
        strict_1.default.equal(result.packages_needed, 5);
        strict_1.default.equal(result.package_cost, 50);
        strict_1.default.equal(result.total_effective, 50);
        strict_1.default.equal(result.effective_per_unit, 10);
    });
    (0, node_test_1.it)("rounds up packages correctly", () => {
        const result = (0, effective_cost_1.calculateEffectiveCost)({
            unit_price: 22,
            quantity_needed: 15,
            units_per_package: 6,
            minimum_order: 0,
            shipping_cost: 0,
            other_costs: 0,
            discount_pct: 0,
            discount_flat: 0,
        });
        // Need 15 units, 6 per package → 3 packages → 18 units
        strict_1.default.equal(result.packages_needed, 3);
        strict_1.default.equal(result.package_cost, 18 * 22); // 396
        // Effective per unit = 396 / 15 = 26.4
        strict_1.default.equal(result.effective_per_unit, 26.4);
    });
    (0, node_test_1.it)("applies minimum order", () => {
        const result = (0, effective_cost_1.calculateEffectiveCost)({
            unit_price: 5,
            quantity_needed: 2,
            units_per_package: 1,
            minimum_order: 50,
            shipping_cost: 0,
            other_costs: 0,
            discount_pct: 0,
            discount_flat: 0,
        });
        // Package cost = 10, but minimum order = 50
        strict_1.default.equal(result.package_cost, 50);
        strict_1.default.equal(result.total_effective, 50);
        strict_1.default.equal(result.effective_per_unit, 25);
    });
    (0, node_test_1.it)("applies shipping and other costs", () => {
        const result = (0, effective_cost_1.calculateEffectiveCost)({
            unit_price: 100,
            quantity_needed: 1,
            units_per_package: 1,
            minimum_order: 0,
            shipping_cost: 15,
            other_costs: 5,
            discount_pct: 0,
            discount_flat: 0,
        });
        strict_1.default.equal(result.total_effective, 120);
        strict_1.default.equal(result.effective_per_unit, 120);
    });
    (0, node_test_1.it)("applies percentage discount", () => {
        const result = (0, effective_cost_1.calculateEffectiveCost)({
            unit_price: 100,
            quantity_needed: 10,
            units_per_package: 1,
            minimum_order: 0,
            shipping_cost: 0,
            other_costs: 0,
            discount_pct: 10,
            discount_flat: 0,
        });
        // 10 * 100 = 1000 - 10% = 900
        strict_1.default.equal(result.total_effective, 900);
        strict_1.default.equal(result.effective_per_unit, 90);
    });
    (0, node_test_1.it)("applies flat discount", () => {
        const result = (0, effective_cost_1.calculateEffectiveCost)({
            unit_price: 100,
            quantity_needed: 10,
            units_per_package: 1,
            minimum_order: 0,
            shipping_cost: 0,
            other_costs: 0,
            discount_pct: 0,
            discount_flat: 50,
        });
        strict_1.default.equal(result.total_effective, 950);
    });
    (0, node_test_1.it)("combined: packages + shipping + discount + minimum", () => {
        const result = (0, effective_cost_1.calculateEffectiveCost)({
            unit_price: 12,
            quantity_needed: 25,
            units_per_package: 10,
            minimum_order: 0,
            shipping_cost: 20,
            other_costs: 5,
            discount_pct: 5,
            discount_flat: 0,
        });
        // 25 units / 10 per pkg = 3 packages → 30 units
        // package_cost = 30 * 12 = 360
        // discount = 360 * 0.05 = 18
        // total = 360 + 20 + 5 - 18 = 367
        strict_1.default.equal(result.packages_needed, 3);
        strict_1.default.equal(result.package_cost, 360);
        strict_1.default.equal(result.discount_amount, 18);
        strict_1.default.equal(result.total_effective, 367);
        // effective_per_unit = 367 / 25 = 14.68
        strict_1.default.equal(result.effective_per_unit, 14.68);
    });
    (0, node_test_1.it)("handles zero quantity gracefully", () => {
        const result = (0, effective_cost_1.calculateEffectiveCost)({
            unit_price: 10,
            quantity_needed: 0,
            units_per_package: 1,
            minimum_order: 0,
            shipping_cost: 0,
            other_costs: 0,
            discount_pct: 0,
            discount_flat: 0,
        });
        // Should treat as 1
        strict_1.default.equal(result.quantity_needed, 1);
        strict_1.default.equal(result.total_effective, 10);
    });
    (0, node_test_1.it)("handles zero units_per_package gracefully", () => {
        const result = (0, effective_cost_1.calculateEffectiveCost)({
            unit_price: 10,
            quantity_needed: 5,
            units_per_package: 0,
            minimum_order: 0,
            shipping_cost: 0,
            other_costs: 0,
            discount_pct: 0,
            discount_flat: 0,
        });
        // Should treat as 1
        strict_1.default.equal(result.units_per_package, 1);
    });
});
(0, node_test_1.describe)("compareProviders", () => {
    (0, node_test_1.it)("recommends cheapest available provider", () => {
        const results = (0, effective_cost_1.compareProviders)({
            quantity_needed: 10,
            candidates: [
                {
                    provider_id: "p1",
                    provider_name: "Leroy Merlin",
                    product_id: "prod1",
                    product_name: "Azulejo A",
                    unit_price: 20,
                    units_per_package: 1,
                    minimum_order: 0,
                    shipping_cost: 0,
                    other_costs: 0,
                    discount_pct: 0,
                    discount_flat: 0,
                    is_available: true,
                    delivery_days: 3,
                },
                {
                    provider_id: "p2",
                    provider_name: "Obramat",
                    product_id: "prod2",
                    product_name: "Azulejo B",
                    unit_price: 18,
                    units_per_package: 1,
                    minimum_order: 0,
                    shipping_cost: 10,
                    other_costs: 0,
                    discount_pct: 0,
                    discount_flat: 0,
                    is_available: true,
                    delivery_days: 5,
                },
            ],
            prefer_available: true,
            prefer_fastest: false,
        });
        // Obramat: 18*10 + 10 = 190, per unit = 19
        // Leroy:   20*10 = 200, per unit = 20
        strict_1.default.equal(results[0].provider_name, "Obramat");
        strict_1.default.equal(results[0].is_cheapest, true);
        strict_1.default.equal(results[0].is_recommended, true);
        strict_1.default.equal(results[1].provider_name, "Leroy Merlin");
        strict_1.default.equal(results[1].is_fastest, true);
    });
    (0, node_test_1.it)("recommends fastest when prefer_fastest", () => {
        const results = (0, effective_cost_1.compareProviders)({
            quantity_needed: 10,
            candidates: [
                {
                    provider_id: "p1",
                    provider_name: "Slow Cheap",
                    product_id: "prod1",
                    product_name: "Item A",
                    unit_price: 10,
                    units_per_package: 1,
                    minimum_order: 0,
                    shipping_cost: 0,
                    other_costs: 0,
                    discount_pct: 0,
                    discount_flat: 0,
                    is_available: true,
                    delivery_days: 10,
                },
                {
                    provider_id: "p2",
                    provider_name: "Fast Expensive",
                    product_id: "prod2",
                    product_name: "Item B",
                    unit_price: 15,
                    units_per_package: 1,
                    minimum_order: 0,
                    shipping_cost: 0,
                    other_costs: 0,
                    discount_pct: 0,
                    discount_flat: 0,
                    is_available: true,
                    delivery_days: 1,
                },
            ],
            prefer_available: true,
            prefer_fastest: true,
        });
        const recommended = results.find((r) => r.is_recommended);
        strict_1.default.equal(recommended?.provider_name, "Fast Expensive");
        strict_1.default.equal(recommended?.recommendation_reason, "Proveedor más rápido disponible");
    });
    (0, node_test_1.it)("skips unavailable when prefer_available", () => {
        const results = (0, effective_cost_1.compareProviders)({
            quantity_needed: 5,
            candidates: [
                {
                    provider_id: "p1",
                    provider_name: "Cheapest But Unavailable",
                    product_id: "prod1",
                    product_name: "Item A",
                    unit_price: 5,
                    units_per_package: 1,
                    minimum_order: 0,
                    shipping_cost: 0,
                    other_costs: 0,
                    discount_pct: 0,
                    discount_flat: 0,
                    is_available: false,
                    delivery_days: null,
                },
                {
                    provider_id: "p2",
                    provider_name: "Available",
                    product_id: "prod2",
                    product_name: "Item B",
                    unit_price: 10,
                    units_per_package: 1,
                    minimum_order: 0,
                    shipping_cost: 0,
                    other_costs: 0,
                    discount_pct: 0,
                    discount_flat: 0,
                    is_available: true,
                    delivery_days: 3,
                },
            ],
            prefer_available: true,
            prefer_fastest: false,
        });
        const cheapest = results.find((r) => r.is_cheapest);
        strict_1.default.equal(cheapest?.provider_name, "Available");
        strict_1.default.equal(cheapest?.is_recommended, true);
    });
});
