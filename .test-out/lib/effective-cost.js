"use strict";
/**
 * effective-cost.ts
 *
 * Calculates the effective cost of a material considering:
 * - Unit price
 * - Quantity needed
 * - Package size (units per package)
 * - Package rounding (you buy whole packages)
 * - Minimum order
 * - Shipping costs
 * - Discounts
 * - Other costs
 *
 * Pure functions. No side effects. No DB access.
 *
 * Formula:
 *   packages_needed = ceil(quantity / units_per_package)
 *   package_cost = packages_needed * unit_price * units_per_package
 *   subtotal = max(package_cost, minimum_order)
 *   discount = subtotal * (discount_pct / 100) + discount_flat
 *   effective = subtotal + shipping + other_costs - discount
 *   effective_per_unit = effective / actual_units_purchased
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateEffectiveCost = calculateEffectiveCost;
exports.compareProviders = compareProviders;
// ─── Core calculation ─────────────────────────────────────────────────────
/**
 * Calculate the effective cost breakdown for a material purchase.
 *
 * Returns a breakdown showing exactly how the effective per-unit cost
 * was derived, enabling full traceability.
 */
function calculateEffectiveCost(input) {
    const { unit_price, quantity_needed, units_per_package, minimum_order, shipping_cost, other_costs, discount_pct, discount_flat, } = input;
    // Guard: avoid division by zero
    const safeUnitsPerPkg = Math.max(units_per_package, 1);
    const safeQuantity = Math.max(quantity_needed, 1);
    // 1. How many packages do we need?
    const packages_needed = Math.ceil(safeQuantity / safeUnitsPerPkg);
    // 2. Actual units we're purchasing (always >= quantity_needed)
    const actual_units = packages_needed * safeUnitsPerPkg;
    // 3. Package cost (before minimum order check)
    let package_cost = round2(actual_units * unit_price);
    // 4. Apply minimum order — if package_cost < minimum_order,
    // the customer still pays at least minimum_order
    if (minimum_order > 0 && package_cost < minimum_order) {
        package_cost = minimum_order;
    }
    // 5. Calculate discount
    const pct_discount = round2(package_cost * (discount_pct / 100));
    const total_discount = round2(pct_discount + (discount_flat || 0));
    // 6. Total effective cost
    const total_effective = round2(package_cost + (shipping_cost || 0) + (other_costs || 0) - total_discount);
    // 7. Effective cost per unit of what we actually need
    const effective_per_unit = round4(total_effective / safeQuantity);
    return {
        unit_price,
        quantity_needed: safeQuantity,
        units_per_package: safeUnitsPerPkg,
        packages_needed,
        package_cost,
        shipping_cost: shipping_cost || 0,
        other_costs: other_costs || 0,
        discount_amount: total_discount,
        total_effective,
        effective_per_unit,
    };
}
/**
 * Compare multiple providers for the same material, considering effective cost.
 * Returns sorted by effective_per_unit (cheapest first), with flags
 * for cheapest, fastest, and recommended.
 */
function compareProviders(input) {
    const results = input.candidates.map((c) => {
        const breakdown = calculateEffectiveCost({
            unit_price: c.unit_price,
            quantity_needed: input.quantity_needed,
            units_per_package: c.units_per_package,
            minimum_order: c.minimum_order,
            shipping_cost: c.shipping_cost,
            other_costs: c.other_costs,
            discount_pct: c.discount_pct,
            discount_flat: c.discount_flat,
        });
        return {
            provider_id: c.provider_id,
            provider_name: c.provider_name,
            product_id: c.product_id,
            product_name: c.product_name,
            breakdown,
            is_available: c.is_available,
            delivery_days: c.delivery_days,
            is_cheapest: false,
            is_fastest: false,
            is_recommended: false,
            recommendation_reason: "",
        };
    });
    // Sort by effective per unit
    results.sort((a, b) => a.breakdown.effective_per_unit - b.breakdown.effective_per_unit);
    // Flag cheapest (among available if prefer_available)
    const availableResults = input.prefer_available
        ? results.filter((r) => r.is_available)
        : results;
    if (availableResults.length > 0) {
        availableResults[0].is_cheapest = true;
    }
    // Flag fastest
    const withDelivery = results.filter((r) => r.delivery_days !== null && r.is_available);
    if (withDelivery.length > 0) {
        withDelivery.sort((a, b) => (a.delivery_days ?? 999) - (b.delivery_days ?? 999));
        withDelivery[0].is_fastest = true;
    }
    // Recommend: cheapest available, or fastest if prefer_fastest
    if (input.prefer_fastest && withDelivery.length > 0) {
        withDelivery[0].is_recommended = true;
        withDelivery[0].recommendation_reason = "Proveedor más rápido disponible";
    }
    else if (availableResults.length > 0) {
        availableResults[0].is_recommended = true;
        availableResults[0].recommendation_reason = "Menor coste efectivo disponible";
    }
    else if (results.length > 0) {
        results[0].is_recommended = true;
        results[0].recommendation_reason =
            "Menor coste efectivo (verificar disponibilidad)";
    }
    return results;
}
// ─── Helpers ──────────────────────────────────────────────────────────────
function round2(n) {
    return Math.round(n * 100) / 100;
}
function round4(n) {
    return Math.round(n * 10000) / 10000;
}
