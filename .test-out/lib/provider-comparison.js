"use strict";
/**
 * provider-comparison.ts
 *
 * Compares providers for a given budget item or material concept.
 *
 * Given a concept name or item, queries pb_products + pb_price_current
 * to find all available providers offering that product, then ranks them
 * by effective cost, availability, delivery time, and confidence.
 *
 * Use cases:
 *   - "Comparar proveedores" button on a budget item
 *   - Provider selection during price resolution
 *   - Bulk comparison across all items in a budget
 *
 * The comparison functions that query DB are async.
 * The ranking/scoring functions are pure.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareProviders = compareProviders;
exports.rankProviderOptions = rankProviderOptions;
exports.bulkCompareProviders = bulkCompareProviders;
const effective_cost_1 = require("./effective-cost");
const DEFAULT_WEIGHTS = {
    price: 0.50,
    delivery: 0.15,
    confidence: 0.15,
    availability: 0.10,
    preferred: 0.10,
};
// ─── Main comparison function ───────────────────────────────────────────────
/**
 * Compare providers for a given concept/material.
 *
 * Queries pb_products joined with pb_providers and pb_price_current
 * to find matching products, then calculates effective costs and ranks.
 */
async function compareProviders(supabase, input, weights) {
    const { concept_name, quantity, unit, region, only_available = true, limit: maxResults = 20, } = input;
    const w = { ...DEFAULT_WEIGHTS, ...weights };
    // Search products matching the concept name
    let query = supabase
        .from("pb_products")
        .select(`
      id,
      commercial_name,
      brand,
      sku,
      sale_unit,
      units_per_package,
      unit_price,
      is_available,
      provider_id,
      pb_providers!inner (
        id,
        name,
        shipping_cost_flat,
        free_shipping_min,
        minimum_order,
        delivery_days_min,
        delivery_days_max,
        is_preferred,
        is_active
      )
    `)
        .eq("is_active", true)
        .eq("pb_providers.is_active", true)
        .ilike("commercial_name", `%${concept_name}%`)
        .order("unit_price", { ascending: true })
        .limit(maxResults * 2); // fetch extra for filtering
    if (only_available) {
        query = query.eq("is_available", true);
    }
    if (unit) {
        query = query.eq("sale_unit", unit);
    }
    const { data: products, error: queryError } = await query;
    if (queryError) {
        return {
            ok: false,
            concept_name,
            quantity,
            options: [],
            cheapest: null,
            fastest: null,
            recommended: null,
            savings_vs_most_expensive: 0,
            error: `Error buscando productos: ${queryError.message}`,
        };
    }
    if (!products || products.length === 0) {
        return {
            ok: true,
            concept_name,
            quantity,
            options: [],
            cheapest: null,
            fastest: null,
            recommended: null,
            savings_vs_most_expensive: 0,
        };
    }
    // Fetch current prices for these products
    const productIds = products.map((p) => p.id);
    const { data: currentPrices } = await supabase
        .from("pb_price_current")
        .select("product_id, price_excl_vat, effective_price, confidence_score, source_type, checked_at")
        .in("product_id", productIds);
    const priceMap = new Map((currentPrices || []).map((cp) => [cp.product_id, cp]));
    // Fetch discount info from latest observations
    const { data: observations } = await supabase
        .from("pb_price_observations")
        .select("product_id, discount_pct, shipping_cost, other_costs")
        .in("product_id", productIds)
        .order("checked_at", { ascending: false });
    const obsMap = new Map();
    for (const obs of observations || []) {
        if (!obsMap.has(obs.product_id)) {
            obsMap.set(obs.product_id, {
                discount_pct: Number(obs.discount_pct) || 0,
                shipping_cost: Number(obs.shipping_cost) || 0,
                other_costs: Number(obs.other_costs) || 0,
            });
        }
    }
    // Build provider options with effective cost calculation
    const options = [];
    for (const product of products) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provider = product.pb_providers;
        if (!provider)
            continue;
        // Filter by region if specified
        if (region && provider.region && provider.region !== region)
            continue;
        const currentPrice = priceMap.get(product.id);
        const obs = obsMap.get(product.id);
        const basePrice = currentPrice
            ? Number(currentPrice.price_excl_vat) || Number(product.unit_price) || 0
            : Number(product.unit_price) || 0;
        const discountPct = obs?.discount_pct || 0;
        const shippingCost = obs?.shipping_cost || Number(provider.shipping_cost_flat) || 0;
        const otherCosts = obs?.other_costs || 0;
        // Calculate effective cost
        const effectiveInput = {
            unit_price: basePrice,
            quantity_needed: quantity,
            units_per_package: Number(product.units_per_package) || 1,
            minimum_order: Number(provider.minimum_order) || 0,
            shipping_cost: shippingCost,
            other_costs: otherCosts,
            discount_pct: discountPct,
            discount_flat: 0,
        };
        const breakdown = (0, effective_cost_1.calculateEffectiveCost)(effectiveInput);
        const option = {
            provider_id: String(provider.id),
            provider_name: String(provider.name),
            product_id: String(product.id),
            product_name: String(product.commercial_name),
            brand: product.brand || null,
            sku: product.sku || null,
            unit_price: basePrice,
            effective_price_per_unit: breakdown.effective_per_unit,
            total_effective_cost: breakdown.total_effective,
            unit: String(product.sale_unit),
            units_per_package: Number(product.units_per_package) || 1,
            minimum_order: Number(provider.minimum_order) || 0,
            shipping_cost: shippingCost,
            free_shipping_min: provider.free_shipping_min ?? null,
            delivery_days_min: Number(provider.delivery_days_min) || 0,
            delivery_days_max: Number(provider.delivery_days_max) || 0,
            is_available: Boolean(product.is_available),
            is_preferred: Boolean(provider.is_preferred),
            confidence_score: currentPrice ? Number(currentPrice.confidence_score) || 0.5 : 0.5,
            source_type: currentPrice?.source_type ?? null,
            checked_at: currentPrice?.checked_at ?? null,
            discount_pct: discountPct,
            ranking_score: 0,
            ranking_reasons: [],
        };
        options.push(option);
    }
    // Calculate ranking scores
    const rankedOptions = rankProviderOptions(options, w);
    // Limit results
    const finalOptions = rankedOptions.slice(0, maxResults);
    // Find best options
    const cheapest = finalOptions.length > 0
        ? finalOptions.reduce((best, opt) => opt.effective_price_per_unit < best.effective_price_per_unit ? opt : best)
        : null;
    const fastest = finalOptions.filter((o) => o.is_available).length > 0
        ? finalOptions
            .filter((o) => o.is_available)
            .reduce((best, opt) => opt.delivery_days_max < best.delivery_days_max ? opt : best)
        : null;
    const recommended = finalOptions.length > 0 ? finalOptions[0] : null; // best ranked
    // Calculate potential savings
    const maxEffective = finalOptions.length > 0
        ? Math.max(...finalOptions.map((o) => o.total_effective_cost))
        : 0;
    const minEffective = cheapest ? cheapest.total_effective_cost : 0;
    const savings = round2(maxEffective - minEffective);
    return {
        ok: true,
        concept_name,
        quantity,
        options: finalOptions,
        cheapest,
        fastest,
        recommended,
        savings_vs_most_expensive: savings,
    };
}
// ─── Ranking (PURE function) ────────────────────────────────────────────────
/**
 * Rank provider options by a weighted score.
 *
 * Lower score = better.
 *
 * Scoring:
 *   - Price: normalized 0-1 (cheapest=0, most expensive=1)
 *   - Delivery: normalized 0-1 (fastest=0, slowest=1)
 *   - Confidence: inverted (high confidence = low score)
 *   - Availability: 0 if available, 1 if not
 *   - Preferred: 0 if preferred, 1 if not
 */
function rankProviderOptions(options, weights = DEFAULT_WEIGHTS) {
    if (options.length === 0)
        return [];
    if (options.length === 1) {
        options[0].ranking_score = 0;
        options[0].ranking_reasons = ["Unico proveedor disponible"];
        return options;
    }
    // Find min/max for normalization
    const prices = options.map((o) => o.effective_price_per_unit);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;
    const deliveries = options.map((o) => o.delivery_days_max);
    const minDelivery = Math.min(...deliveries);
    const maxDelivery = Math.max(...deliveries);
    const deliveryRange = maxDelivery - minDelivery || 1;
    return options
        .map((opt) => {
        const reasons = [];
        // Price score (0 = cheapest, 1 = most expensive)
        const priceScore = (opt.effective_price_per_unit - minPrice) / priceRange;
        // Delivery score (0 = fastest, 1 = slowest)
        const deliveryScore = (opt.delivery_days_max - minDelivery) / deliveryRange;
        // Confidence score (inverted: high confidence = 0)
        const confidenceScore = 1 - opt.confidence_score;
        // Availability (0 = available, 1 = not)
        const availabilityScore = opt.is_available ? 0 : 1;
        // Preferred bonus (0 = preferred, 1 = not)
        const preferredScore = opt.is_preferred ? 0 : 1;
        const totalScore = round2(priceScore * weights.price +
            deliveryScore * weights.delivery +
            confidenceScore * weights.confidence +
            availabilityScore * weights.availability +
            preferredScore * weights.preferred);
        // Generate ranking reasons
        if (priceScore === 0)
            reasons.push("Precio mas bajo");
        if (priceScore <= 0.2 && priceScore > 0)
            reasons.push("Precio competitivo");
        if (priceScore >= 0.8)
            reasons.push("Precio elevado");
        if (deliveryScore === 0)
            reasons.push("Entrega mas rapida");
        if (opt.is_preferred)
            reasons.push("Proveedor preferido");
        if (opt.confidence_score >= 0.9)
            reasons.push("Alta fiabilidad de precio");
        if (opt.confidence_score < 0.5)
            reasons.push("Precio poco fiable");
        if (!opt.is_available)
            reasons.push("No disponible actualmente");
        if (opt.discount_pct > 0)
            reasons.push(`Descuento ${opt.discount_pct}%`);
        return {
            ...opt,
            ranking_score: totalScore,
            ranking_reasons: reasons,
        };
    })
        .sort((a, b) => a.ranking_score - b.ranking_score);
}
/**
 * Compare providers for multiple budget items at once.
 * Returns potential savings per item.
 */
async function bulkCompareProviders(supabase, items, region) {
    const results = [];
    for (const item of items) {
        const comparison = await compareProviders(supabase, {
            concept_name: item.item_name,
            quantity: item.quantity,
            unit: item.unit,
            region,
            limit: 5,
        });
        const bestCost = comparison.cheapest
            ? comparison.cheapest.effective_price_per_unit
            : item.current_unit_cost;
        const savings = round2(item.current_unit_cost - bestCost);
        const savingsPct = item.current_unit_cost > 0
            ? round2((savings / item.current_unit_cost) * 100)
            : 0;
        results.push({
            item_id: item.item_id,
            item_name: item.item_name,
            current_cost: item.current_unit_cost,
            best_cost: round2(bestCost),
            savings: Math.max(0, savings),
            savings_pct: Math.max(0, savingsPct),
            best_provider: comparison.cheapest?.provider_name ?? null,
            alternatives_count: comparison.options.length,
        });
    }
    return results;
}
// ─── Helpers ────────────────────────────────────────────────────────────────
function round2(n) {
    return Math.round(n * 100) / 100;
}
