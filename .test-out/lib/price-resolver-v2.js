"use strict";
/**
 * price-resolver-v2.ts
 *
 * Resolves material/partida prices through an 11-level priority cascade
 * using the Price Bank V2 tables (pb_*).
 *
 * Priority order:
 *   1.  manual_locked       — Precio manual bloqueado por la empresa
 *   2.  private_tariff      — Tarifa privada importada
 *   3.  negotiated          — Precio negociado
 *   4.  historical_approved — Histórico reciente aprobado
 *   5.  preferred_supplier  — Proveedor preferido
 *   6.  provider_updated    — Precio actualizado de proveedor
 *   7.  private_bc3         — BC3 privado
 *   8.  technical_bank      — Banco técnico global
 *   9.  enlaze_base         — Banco general de Enlaze
 *   10. market_estimate     — Estimación de mercado
 *   11. ai_estimate         — IA como último recurso
 *
 * This module is designed to work alongside price-resolver.ts (v1).
 * The v2 endpoint uses this; v1 endpoints continue using the original.
 *
 * Architecture:
 *   - resolveForConcept(): resolves one concept using pre-fetched data
 *   - resolveForBudget(): resolves all items in a budget
 *   - Both are PURE functions: no DB calls, no side effects
 *   - Supabase queries are done by the caller (API route)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PRIORITY_ORDER = void 0;
exports.resolveForConcept = resolveForConcept;
exports.resolveForBudget = resolveForBudget;
const effective_cost_1 = require("./effective-cost");
const price_resolver_1 = require("./price-resolver");
// Re-export the default priority so callers can customize
var price_bank_1 = require("./types/price-bank");
Object.defineProperty(exports, "DEFAULT_PRIORITY_ORDER", { enumerable: true, get: function () { return price_bank_1.DEFAULT_PRIORITY_ORDER; } });
/**
 * Resolve price for a single concept through the 11-level cascade.
 *
 * PURE function: no DB access, no side effects.
 * All data is pre-fetched and passed in.
 */
function resolveForConcept(input, context, data) {
    const normalized = (0, price_resolver_1.normalizeMaterialName)(input.concept_name);
    const normalizedUnit = (0, price_resolver_1.normalizeUnit)(input.unit);
    const now = new Date().toISOString();
    const alternatives = [];
    const warnings = [];
    const priority = context.priority_order || [
        "manual_locked",
        "private_tariff",
        "negotiated",
        "historical_approved",
        "preferred_supplier",
        "provider_updated",
        "private_bc3",
        "technical_bank",
        "enlaze_base",
        "market_estimate",
        "ai_estimate",
    ];
    // Collect all alternatives first (for the alternatives list)
    collectAlternatives(input, context, data, alternatives);
    // Try each level in priority order
    for (const level of priority) {
        const result = tryLevel(level, input, context, data, normalized, normalizedUnit, now, warnings);
        if (result) {
            return {
                ...result,
                alternatives,
                warnings,
            };
        }
    }
    // Absolute fallback
    warnings.push("No se encontró precio en ninguna fuente. Precio estimado a 0.");
    return {
        concept_id: null,
        concept_name: input.concept_name,
        product_id: null,
        product_name: null,
        provider_id: null,
        provider_name: null,
        source_id: null,
        unit_price: 0,
        effective_price: 0,
        effective_cost_breakdown: null,
        source_type: "estimated",
        confidence_score: 0.05,
        selection_reason: "Sin fuente disponible",
        checked_at: now,
        alternatives,
        warnings,
    };
}
// ─── Level resolvers ──────────────────────────────────────────────────────
function tryLevel(level, input, context, data, normalized, normalizedUnit, now, warnings) {
    switch (level) {
        case "manual_locked":
            return tryManualLocked(input, data, normalized, now);
        case "private_tariff":
            return tryPrivateTariff(input, context, data, normalized, now);
        case "negotiated":
            return tryNegotiated(input, context, data, normalized, now);
        case "historical_approved":
            return tryHistorical(input, data, normalized, now, warnings);
        case "preferred_supplier":
            return tryPreferredSupplier(input, context, data, normalized, now);
        case "provider_updated":
            return tryProviderUpdated(input, context, data, normalized, now);
        case "private_bc3":
            return tryPrivateBC3(input, data, normalized, now);
        case "technical_bank":
            return tryTechnicalBank(input, data, normalized, now);
        case "enlaze_base":
            return tryEnlazeBase(input, data, normalized, now);
        case "market_estimate":
            return tryMarketEstimate(input, data, normalized, now, warnings);
        case "ai_estimate":
            return null; // AI estimate is handled externally, never here
        default:
            return null;
    }
}
function fuzzyMatch(a, b) {
    const na = (0, price_resolver_1.normalizeMaterialName)(a);
    const nb = (0, price_resolver_1.normalizeMaterialName)(b);
    if (na === nb)
        return true;
    if (na.includes(nb) || nb.includes(na))
        return true;
    const wordsA = na.split(" ").filter((w) => w.length > 2);
    const wordsB = nb.split(" ").filter((w) => w.length > 2);
    if (wordsA.length === 0 || wordsB.length === 0)
        return false;
    const overlap = wordsA.filter((w) => wordsB.some((wb) => wb.includes(w) || w.includes(wb)));
    const threshold = Math.min(wordsA.length, wordsB.length) <= 2 ? 1 : 2;
    return overlap.length >= threshold;
}
function providerServesProvince(provider_province, supply_zones, target_province) {
    if (!target_province)
        return true;
    const tp = target_province.toLowerCase();
    // Provider in same province
    if (provider_province && provider_province.toLowerCase() === tp)
        return true;
    // Province in supply zones
    if (supply_zones.some((z) => z.toLowerCase() === tp))
        return true;
    // National providers (no province restriction)
    if (!provider_province && supply_zones.length === 0)
        return true;
    return false;
}
function buildEffectiveCost(price, quantity, units_per_package, shipping, minimum_order) {
    return (0, effective_cost_1.calculateEffectiveCost)({
        unit_price: price,
        quantity_needed: quantity,
        units_per_package: units_per_package || 1,
        minimum_order: minimum_order || 0,
        shipping_cost: shipping || 0,
        other_costs: 0,
        discount_pct: 0,
        discount_flat: 0,
    });
}
// ── Level 1: Manual locked ────────────────────────────────────────────────
function tryManualLocked(input, data, normalized, now) {
    const match = data.manual_prices.find((p) => p.is_locked && fuzzyMatch(p.name, input.concept_name));
    if (!match)
        return null;
    return {
        concept_id: null,
        concept_name: input.concept_name,
        product_id: null,
        product_name: match.name,
        provider_id: null,
        provider_name: match.supplier_name || "Manual",
        source_id: null,
        unit_price: match.unit_price,
        effective_price: match.unit_price,
        effective_cost_breakdown: null,
        source_type: "manual_locked",
        confidence_score: 1.0,
        selection_reason: "Precio manual bloqueado por la empresa",
        checked_at: now,
    };
}
// ── Level 2: Private tariff ───────────────────────────────────────────────
function tryPrivateTariff(input, context, data, normalized, now) {
    const match = data.current_prices.find((p) => p.is_private_tariff &&
        fuzzyMatch(p.product_name, input.concept_name) &&
        providerServesProvince(p.provider_province, p.provider_supply_zones, context.province));
    if (!match)
        return null;
    const breakdown = buildEffectiveCost(match.price_excl_vat, input.quantity, match.units_per_package, match.shipping_cost, match.minimum_order);
    return {
        concept_id: match.concept_id,
        concept_name: match.concept_name || input.concept_name,
        product_id: match.product_id,
        product_name: match.product_name,
        provider_id: match.provider_id,
        provider_name: match.provider_name,
        source_id: null,
        unit_price: match.price_excl_vat,
        effective_price: breakdown.effective_per_unit,
        effective_cost_breakdown: breakdown,
        source_type: "private_tariff",
        confidence_score: 0.95,
        selection_reason: "Tarifa privada importada",
        checked_at: match.checked_at || now,
    };
}
// ── Level 3: Negotiated ───────────────────────────────────────────────────
function tryNegotiated(input, context, data, normalized, now) {
    const match = data.current_prices.find((p) => p.is_negotiated &&
        fuzzyMatch(p.product_name, input.concept_name) &&
        providerServesProvince(p.provider_province, p.provider_supply_zones, context.province));
    if (!match)
        return null;
    const breakdown = buildEffectiveCost(match.price_excl_vat, input.quantity, match.units_per_package, match.shipping_cost, match.minimum_order);
    return {
        concept_id: match.concept_id,
        concept_name: match.concept_name || input.concept_name,
        product_id: match.product_id,
        product_name: match.product_name,
        provider_id: match.provider_id,
        provider_name: match.provider_name,
        source_id: null,
        unit_price: match.price_excl_vat,
        effective_price: breakdown.effective_per_unit,
        effective_cost_breakdown: breakdown,
        source_type: "negotiated",
        confidence_score: 0.93,
        selection_reason: "Precio negociado con proveedor",
        checked_at: match.checked_at || now,
    };
}
// ── Level 4: Historical approved ──────────────────────────────────────────
function tryHistorical(input, data, normalized, now, warnings) {
    const match = data.historical_prices.find((p) => p.is_approved && fuzzyMatch(p.concept_name, input.concept_name));
    if (!match)
        return null;
    // Check if historical price is recent (< 90 days)
    const daysSince = Math.floor((Date.now() - new Date(match.budget_date).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince > 90) {
        warnings.push(`Precio histórico de "${match.concept_name}" tiene ${daysSince} días. Puede estar desactualizado.`);
    }
    return {
        concept_id: null,
        concept_name: input.concept_name,
        product_id: null,
        product_name: match.concept_name,
        provider_id: null,
        provider_name: match.provider_name,
        source_id: null,
        unit_price: match.unit_price,
        effective_price: match.unit_price,
        effective_cost_breakdown: null,
        source_type: "historical_approved",
        confidence_score: daysSince < 30 ? 0.88 : daysSince < 60 ? 0.78 : 0.65,
        selection_reason: `Histórico aprobado (${daysSince} días)`,
        checked_at: match.budget_date,
    };
}
// ── Level 5: Preferred supplier ───────────────────────────────────────────
function tryPreferredSupplier(input, context, data, normalized, now) {
    const match = data.current_prices.find((p) => p.is_preferred &&
        p.is_available &&
        fuzzyMatch(p.product_name, input.concept_name) &&
        providerServesProvince(p.provider_province, p.provider_supply_zones, context.province));
    if (!match)
        return null;
    const breakdown = buildEffectiveCost(match.price_excl_vat, input.quantity, match.units_per_package, match.shipping_cost, match.minimum_order);
    return {
        concept_id: match.concept_id,
        concept_name: match.concept_name || input.concept_name,
        product_id: match.product_id,
        product_name: match.product_name,
        provider_id: match.provider_id,
        provider_name: match.provider_name,
        source_id: null,
        unit_price: match.price_excl_vat,
        effective_price: breakdown.effective_per_unit,
        effective_cost_breakdown: breakdown,
        source_type: "preferred_supplier",
        confidence_score: match.confidence_score || 0.85,
        selection_reason: `Proveedor preferido: ${match.provider_name}`,
        checked_at: match.checked_at || now,
    };
}
// ── Level 6: Provider updated (any available provider) ────────────────────
function tryProviderUpdated(input, context, data, normalized, now) {
    // Find all matching providers, sort by effective price
    const matches = data.current_prices.filter((p) => !p.is_private_tariff &&
        !p.is_negotiated &&
        p.is_available &&
        fuzzyMatch(p.product_name, input.concept_name) &&
        providerServesProvince(p.provider_province, p.provider_supply_zones, context.province));
    if (matches.length === 0)
        return null;
    // Calculate effective cost for each and pick cheapest
    const withCost = matches.map((m) => {
        const breakdown = buildEffectiveCost(m.price_excl_vat, input.quantity, m.units_per_package, m.shipping_cost, m.minimum_order);
        return { match: m, breakdown };
    });
    withCost.sort((a, b) => a.breakdown.effective_per_unit - b.breakdown.effective_per_unit);
    const best = withCost[0];
    return {
        concept_id: best.match.concept_id,
        concept_name: best.match.concept_name || input.concept_name,
        product_id: best.match.product_id,
        product_name: best.match.product_name,
        provider_id: best.match.provider_id,
        provider_name: best.match.provider_name,
        source_id: null,
        unit_price: best.match.price_excl_vat,
        effective_price: best.breakdown.effective_per_unit,
        effective_cost_breakdown: best.breakdown,
        source_type: "provider_updated",
        confidence_score: best.match.confidence_score || 0.82,
        selection_reason: `Mejor coste efectivo de ${withCost.length} proveedor(es)`,
        checked_at: best.match.checked_at || now,
    };
}
// ── Level 7: Private BC3 ─────────────────────────────────────────────────
function tryPrivateBC3(input, data, normalized, now) {
    const match = data.technical_prices.find((p) => p.is_private && fuzzyMatch(p.name, input.concept_name));
    if (!match)
        return null;
    return {
        concept_id: null,
        concept_name: input.concept_name,
        product_id: null,
        product_name: match.name,
        provider_id: null,
        provider_name: `BC3 privado (${match.source})`,
        source_id: null,
        unit_price: match.unit_price,
        effective_price: match.unit_price,
        effective_cost_breakdown: null,
        source_type: "private_bc3",
        confidence_score: match.confidence_score || 0.80,
        selection_reason: `BC3 privado: ${match.source}`,
        checked_at: now,
    };
}
// ── Level 8: Technical bank (global) ──────────────────────────────────────
function tryTechnicalBank(input, data, normalized, now) {
    const match = data.technical_prices.find((p) => !p.is_private && fuzzyMatch(p.name, input.concept_name));
    if (!match)
        return null;
    return {
        concept_id: null,
        concept_name: input.concept_name,
        product_id: null,
        product_name: match.name,
        provider_id: null,
        provider_name: `Banco técnico (${match.source})`,
        source_id: null,
        unit_price: match.unit_price,
        effective_price: match.unit_price,
        effective_cost_breakdown: null,
        source_type: "technical_bank",
        confidence_score: match.confidence_score || 0.78,
        selection_reason: `Banco técnico global: ${match.source} (${match.region})`,
        checked_at: now,
    };
}
// ── Level 9: Enlaze base ─────────────────────────────────────────────────
function tryEnlazeBase(input, data, normalized, now) {
    const match = data.enlaze_prices.find((p) => fuzzyMatch(p.name, input.concept_name));
    if (!match)
        return null;
    return {
        concept_id: null,
        concept_name: input.concept_name,
        product_id: null,
        product_name: match.name,
        provider_id: null,
        provider_name: match.supplier_ref || "Banco ENLAZE",
        source_id: null,
        unit_price: match.unit_price,
        effective_price: match.unit_price,
        effective_cost_breakdown: null,
        source_type: "enlaze_base",
        confidence_score: 0.45,
        selection_reason: "Banco general de Enlaze (referencia de mercado)",
        checked_at: now,
    };
}
// ── Level 10: Market estimate ─────────────────────────────────────────────
function tryMarketEstimate(input, data, normalized, now, warnings) {
    // Market estimate from non-locked manual prices
    const match = data.manual_prices.find((p) => !p.is_locked && fuzzyMatch(p.name, input.concept_name));
    if (!match)
        return null;
    warnings.push(`"${input.concept_name}": precio basado en estimación de mercado. Confianza baja.`);
    return {
        concept_id: null,
        concept_name: input.concept_name,
        product_id: null,
        product_name: match.name,
        provider_id: null,
        provider_name: match.supplier_name || "Estimación",
        source_id: null,
        unit_price: match.unit_price,
        effective_price: match.unit_price,
        effective_cost_breakdown: null,
        source_type: "market_estimate",
        confidence_score: 0.35,
        selection_reason: "Estimación de mercado",
        checked_at: now,
    };
}
// ─── Alternatives collector ───────────────────────────────────────────────
function collectAlternatives(input, context, data, alternatives) {
    // Collect from current_prices
    for (const p of data.current_prices) {
        if (!fuzzyMatch(p.product_name, input.concept_name))
            continue;
        if (!providerServesProvince(p.provider_province, p.provider_supply_zones, context.province))
            continue;
        const breakdown = buildEffectiveCost(p.price_excl_vat, input.quantity, p.units_per_package, p.shipping_cost, p.minimum_order);
        alternatives.push({
            product_id: p.product_id,
            product_name: p.product_name,
            provider_id: p.provider_id,
            provider_name: p.provider_name,
            brand: p.brand,
            unit_price: p.price_excl_vat,
            effective_price: breakdown.effective_per_unit,
            is_available: p.is_available,
            delivery_days: p.delivery_days_max,
            confidence_score: p.confidence_score,
            source_type: p.source_type,
            checked_at: p.checked_at,
        });
    }
    // Sort alternatives by effective price
    alternatives.sort((a, b) => (a.effective_price ?? 999999) - (b.effective_price ?? 999999));
}
/**
 * Resolve prices for all items in a budget.
 * Returns results + summary statistics.
 */
function resolveForBudget(input) {
    const results = input.items.map((item) => resolveForConcept(item, input.context, input.data));
    const by_source = {};
    let totalConfidence = 0;
    let needsReview = 0;
    let zeroPrice = 0;
    for (const r of results) {
        const st = r.source_type;
        by_source[st] = (by_source[st] || 0) + 1;
        totalConfidence += r.confidence_score;
        if (r.confidence_score < 0.5)
            needsReview++;
        if (r.unit_price === 0)
            zeroPrice++;
    }
    return {
        results,
        summary: {
            total: results.length,
            resolved: results.filter((r) => r.unit_price > 0).length,
            by_source,
            avg_confidence: results.length > 0
                ? Math.round((totalConfidence / results.length) * 100) / 100
                : 0,
            needs_review: needsReview,
            zero_price: zeroPrice,
        },
    };
}
