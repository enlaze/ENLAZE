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
 *   effective_per_unit = effective / quantity_needed
 */

import type { EffectiveCostBreakdown } from "./types/price-bank";

// ─── Input ────────────────────────────────────────────────────────────────

export interface EffectiveCostInput {
  /** Price per sale unit (excl. VAT) */
  unit_price: number;
  /** Quantity the project needs */
  quantity_needed: number;
  /** How many units come in one package (1 = sold individually) */
  units_per_package: number;
  /** Minimum order amount in EUR (0 = no minimum) */
  minimum_order: number;
  /** Flat shipping cost for this order */
  shipping_cost: number;
  /** Other costs (handling, insurance, etc.) */
  other_costs: number;
  /** Discount as percentage (0-100) */
  discount_pct: number;
  /** Flat discount amount in EUR */
  discount_flat: number;
}

// ─── Core calculation ─────────────────────────────────────────────────────

/**
 * Calculate the effective cost breakdown for a material purchase.
 *
 * Returns a breakdown showing exactly how the effective per-unit cost
 * was derived, enabling full traceability.
 */
export function calculateEffectiveCost(
  input: EffectiveCostInput
): EffectiveCostBreakdown {
  const {
    unit_price,
    quantity_needed,
    units_per_package,
    minimum_order,
    shipping_cost,
    other_costs,
    discount_pct,
    discount_flat,
  } = input;

  // Guard: avoid division by zero
  const safeUnitsPerPkg = Math.max(units_per_package, 1);
  const safeQuantity = Math.max(quantity_needed, 1);

  // 1. How many packages do we need?
  const packages_needed = Math.ceil(safeQuantity / safeUnitsPerPkg);

  // 2. Actual units we're purchasing (always >= quantity_needed)
  const actual_units = packages_needed * safeUnitsPerPkg;

  // 3. Package cost (before minimum order check)
  let package_cost = round2(actual_units * unit_price);

  // 4. Apply minimum order
  if (minimum_order > 0 && package_cost < minimum_order) {
    package_cost = minimum_order;
  }

  // 5. Calculate discount
  const pct_discount = round2(package_cost * (discount_pct / 100));
  const total_discount = round2(pct_discount + (discount_flat || 0));

  // 6. Total effective cost
  const total_effective = round2(
    package_cost + (shipping_cost || 0) + (other_costs || 0) - total_discount
  );

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

// ─── Helpers ──────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
