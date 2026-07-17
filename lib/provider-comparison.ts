/**
 * provider-comparison.ts
 *
 * Compares providers for a given normalized concept using pb_products
 * and pb_price_current data. Returns ranked alternatives with weighted
 * scoring across multiple dimensions.
 *
 * Weights (default):
 *   - price:        50%  (lower effective price = better)
 *   - delivery:     15%  (fewer days = better)
 *   - confidence:   15%  (higher = better)
 *   - availability: 10%  (available > unavailable)
 *   - preferred:    10%  (preferred supplier bonus)
 *
 * Pure functions. No DB access. No AI calls.
 */

import type {
  PBProduct,
  PBProvider,
  PBPriceCurrent,
  PriceAlternativeV2,
} from "./types/price-bank";
import { calculateEffectiveCost, type EffectiveCostInput } from "./effective-cost";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ComparisonWeights {
  price: number;
  delivery: number;
  confidence: number;
  availability: number;
  preferred: number;
}

export const DEFAULT_WEIGHTS: ComparisonWeights = {
  price: 0.50,
  delivery: 0.15,
  confidence: 0.15,
  availability: 0.10,
  preferred: 0.10,
};

export interface ScoredAlternative extends PriceAlternativeV2 {
  /** Weighted composite score (0-1, higher = better) */
  composite_score: number;
  /** Per-dimension scores */
  dimension_scores: {
    price: number;
    delivery: number;
    confidence: number;
    availability: number;
    preferred: number;
  };
  /** Effective cost breakdown if calculable */
  effective_cost_breakdown: import("./types/price-bank").EffectiveCostBreakdown | null;
}

export interface ComparisonResult {
  ok: boolean;
  concept_id: string;
  concept_name: string;
  quantity_needed: number;
  best: ScoredAlternative | null;
  alternatives: ScoredAlternative[];
  total_found: number;
  warnings: string[];
}

export interface ComparisonInput {
  concept_id: string;
  concept_name: string;
  quantity_needed: number;
  province?: string;
  weights?: Partial<ComparisonWeights>;
}

/** Pre-fetched data the caller passes in (no DB in this module). */
export interface ComparisonData {
  products: PBProduct[];
  providers: PBProvider[];
  current_prices: PBPriceCurrent[];
}

// ─── Core comparison ─────────────────────────────────────────────────────────

/**
 * Compare all available providers for a single concept.
 *
 * The caller pre-fetches products, providers, and current prices from Supabase,
 * then this function scores and ranks them.
 */
export function compareProviders(
  input: ComparisonInput,
  data: ComparisonData
): ComparisonResult {
  const warnings: string[] = [];
  const weights = { ...DEFAULT_WEIGHTS, ...input.weights };

  // Normalize weights so they sum to 1
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  const norm: ComparisonWeights = {
    price: weights.price / weightSum,
    delivery: weights.delivery / weightSum,
    confidence: weights.confidence / weightSum,
    availability: weights.availability / weightSum,
    preferred: weights.preferred / weightSum,
  };

  // 1. Filter products for this concept
  const conceptProducts = data.products.filter(
    (p) => p.concept_id === input.concept_id && p.is_active
  );

  if (conceptProducts.length === 0) {
    return {
      ok: false,
      concept_id: input.concept_id,
      concept_name: input.concept_name,
      quantity_needed: input.quantity_needed,
      best: null,
      alternatives: [],
      total_found: 0,
      warnings: ["No products found for this concept"],
    };
  }

  // 2. Build provider lookup
  const providerMap = new Map<string, PBProvider>();
  for (const prov of data.providers) {
    providerMap.set(prov.id, prov);
  }

  // 3. Build current price lookup (product_id → best current price)
  const priceMap = new Map<string, PBPriceCurrent>();
  for (const pc of data.current_prices) {
    const existing = priceMap.get(pc.product_id);
    if (!existing || (pc.effective_price ?? pc.price_excl_vat) < (existing.effective_price ?? existing.price_excl_vat)) {
      priceMap.set(pc.product_id, pc);
    }
  }

  // 4. Build scored alternatives
  const scored: ScoredAlternative[] = [];

  for (const product of conceptProducts) {
    const provider = providerMap.get(product.provider_id);
    if (!provider || !provider.is_active) continue;

    // Province filter
    if (input.province && provider.supply_zones.length > 0) {
      const normalizedProvince = input.province.toLowerCase();
      const serves = provider.supply_zones.some(
        (z) => z.toLowerCase() === normalizedProvince || z === "*"
      );
      if (!serves) continue;
    }

    const currentPrice = priceMap.get(product.id);
    const unitPrice = currentPrice?.price_excl_vat ?? product.unit_price;

    // Effective cost
    let effectiveBreakdown: import("./types/price-bank").EffectiveCostBreakdown | null = null;
    let effectivePerUnit = unitPrice;

    try {
      const costInput: EffectiveCostInput = {
        unit_price: unitPrice,
        quantity_needed: Math.max(input.quantity_needed, 1),
        units_per_package: product.units_per_package,
        minimum_order: provider.minimum_order,
        shipping_cost: provider.shipping_cost_flat,
        other_costs: 0,
        discount_pct: 0,
        discount_flat: 0,
      };
      effectiveBreakdown = calculateEffectiveCost(costInput);
      effectivePerUnit = effectiveBreakdown.effective_per_unit;
    } catch {
      warnings.push(`Could not calculate effective cost for product ${product.id}`);
    }

    const confidence = currentPrice?.confidence_score ?? 0.5;

    scored.push({
      product_id: product.id,
      product_name: product.commercial_name,
      provider_id: provider.id,
      provider_name: provider.name,
      brand: product.brand,
      unit_price: unitPrice,
      effective_price: effectivePerUnit,
      is_available: currentPrice?.is_available ?? product.is_available,
      delivery_days: provider.delivery_days_max,
      confidence_score: confidence,
      source_type: currentPrice?.source_type ?? "provider_catalog",
      checked_at: currentPrice?.checked_at ?? product.checked_at,
      // Extended fields
      composite_score: 0, // calculated below
      dimension_scores: { price: 0, delivery: 0, confidence: 0, availability: 0, preferred: 0 },
      effective_cost_breakdown: effectiveBreakdown,
    });
  }

  if (scored.length === 0) {
    return {
      ok: false,
      concept_id: input.concept_id,
      concept_name: input.concept_name,
      quantity_needed: input.quantity_needed,
      best: null,
      alternatives: [],
      total_found: 0,
      warnings: [...warnings, "No active providers serve the requested province"],
    };
  }

  // 5. Compute dimension scores
  const prices = scored.map((s) => s.effective_price ?? s.unit_price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  const deliveries = scored.map((s) => s.delivery_days ?? 30);
  const minDelivery = Math.min(...deliveries);
  const maxDelivery = Math.max(...deliveries);
  const deliveryRange = maxDelivery - minDelivery || 1;

  for (const alt of scored) {
    const ep = alt.effective_price ?? alt.unit_price;
    const dd = alt.delivery_days ?? 30;

    // Price: lower is better → 1.0 for cheapest, 0.0 for most expensive
    const priceScore = 1 - (ep - minPrice) / priceRange;

    // Delivery: fewer days is better
    const deliveryScore = 1 - (dd - minDelivery) / deliveryRange;

    // Confidence: direct (0-1)
    const confidenceScore = alt.confidence_score;

    // Availability: binary
    const availabilityScore = alt.is_available ? 1.0 : 0.0;

    // Preferred: check provider
    const provider = providerMap.get(alt.provider_id);
    const preferredScore = provider?.is_preferred ? 1.0 : 0.0;

    alt.dimension_scores = {
      price: round2(priceScore),
      delivery: round2(deliveryScore),
      confidence: round2(confidenceScore),
      availability: availabilityScore,
      preferred: preferredScore,
    };

    alt.composite_score = round4(
      priceScore * norm.price +
      deliveryScore * norm.delivery +
      confidenceScore * norm.confidence +
      availabilityScore * norm.availability +
      preferredScore * norm.preferred
    );
  }

  // 6. Sort by composite score descending
  scored.sort((a, b) => b.composite_score - a.composite_score);

  return {
    ok: true,
    concept_id: input.concept_id,
    concept_name: input.concept_name,
    quantity_needed: input.quantity_needed,
    best: scored[0] ?? null,
    alternatives: scored,
    total_found: scored.length,
    warnings,
  };
}

// ─── Bulk comparison ─────────────────────────────────────────────────────────

export interface BulkComparisonInput {
  items: ComparisonInput[];
  province?: string;
  weights?: Partial<ComparisonWeights>;
}

export interface BulkComparisonResult {
  ok: boolean;
  results: ComparisonResult[];
  summary: {
    total_concepts: number;
    concepts_with_alternatives: number;
    concepts_without_alternatives: number;
    unique_providers: number;
    potential_savings: number;
  };
}

/**
 * Compare providers for multiple concepts at once.
 * Useful for repricing an entire budget.
 */
export function bulkCompareProviders(
  input: BulkComparisonInput,
  data: ComparisonData
): BulkComparisonResult {
  const results: ComparisonResult[] = [];
  const allProviderIds = new Set<string>();
  let totalSavings = 0;

  for (const item of input.items) {
    const mergedItem: ComparisonInput = {
      ...item,
      province: item.province ?? input.province,
      weights: { ...input.weights, ...item.weights },
    };

    const result = compareProviders(mergedItem, data);
    results.push(result);

    // Track unique providers
    for (const alt of result.alternatives) {
      allProviderIds.add(alt.provider_id);
    }

    // Estimate savings: difference between most expensive and best
    if (result.alternatives.length >= 2) {
      const prices = result.alternatives
        .map((a) => a.effective_price ?? a.unit_price)
        .filter((p) => p > 0);
      if (prices.length >= 2) {
        const max = Math.max(...prices);
        const min = Math.min(...prices);
        totalSavings += (max - min) * mergedItem.quantity_needed;
      }
    }
  }

  const withAlts = results.filter((r) => r.total_found > 0).length;

  return {
    ok: true,
    results,
    summary: {
      total_concepts: input.items.length,
      concepts_with_alternatives: withAlts,
      concepts_without_alternatives: input.items.length - withAlts,
      unique_providers: allProviderIds.size,
      potential_savings: round2(totalSavings),
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
