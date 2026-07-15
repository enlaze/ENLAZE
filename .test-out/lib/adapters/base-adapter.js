"use strict";
/**
 * base-adapter.ts
 *
 * Abstract base class for all price source adapters.
 * Each adapter knows how to:
 *   1. fetch() — retrieve raw prices from a source (scrape, API, etc.)
 *   2. normalize() — clean, deduplicate, compute effective prices
 *   3. validate() — check data quality before insert
 *
 * The sync pipeline calls these in order:
 *   fetch → normalize → validate → persist (done by the pipeline, not the adapter)
 *
 * Adapters are STATELESS. All context is passed via PriceFetchContext.
 * No DB access inside adapters — the pipeline handles persistence.
 *
 * Concrete adapters:
 *   - N8nWebhookAdapter: receives pre-fetched data from n8n webhook push
 *   - TechnicalBankAdapter: reads from technical_price_items
 *   - (Future) ApiAdapter: fetches from REST APIs
 *   - (Future) FeedAdapter: parses RSS/Atom price feeds
 *   - (Future) WebScraperAdapter: direct scraping (currently done by n8n)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BasePriceAdapter = void 0;
exports.registerAdapter = registerAdapter;
exports.getAdapter = getAdapter;
exports.hasAdapter = hasAdapter;
exports.listRegisteredAdapters = listRegisteredAdapters;
const crypto_1 = require("crypto");
const normalized_concepts_1 = require("../normalized-concepts");
// ─── Adapter Registry ────────────────────────────────────────────────────
/** Map of source_type → adapter class */
const adapterRegistry = new Map();
function registerAdapter(sourceType, factory) {
    adapterRegistry.set(sourceType, factory);
}
function getAdapter(sourceType) {
    const factory = adapterRegistry.get(sourceType);
    return factory ? factory() : null;
}
function hasAdapter(sourceType) {
    return adapterRegistry.has(sourceType);
}
function listRegisteredAdapters() {
    return Array.from(adapterRegistry.keys());
}
// ─── Base Adapter ────────────────────────────────────────────────────────
class BasePriceAdapter {
    /**
     * Normalize raw records: clean names, compute effective price, dedup hash.
     * Default implementation handles most cases; override for source-specific logic.
     */
    normalize(records, context) {
        return records.map((r) => this.normalizeOne(r, context));
    }
    /**
     * Validate a set of normalized records.
     * Default checks: non-empty name, positive price, valid unit.
     * Override to add source-specific validation.
     */
    validate(records) {
        const errors = [];
        const warnings = [];
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            // Required fields
            if (!r.product_name || r.product_name.trim().length === 0) {
                errors.push(`[${i}] Missing product_name`);
            }
            if (r.price_excl_vat < 0) {
                errors.push(`[${i}] Negative price: ${r.price_excl_vat}`);
            }
            if (r.price_excl_vat === 0) {
                warnings.push(`[${i}] Zero price for "${r.product_name}"`);
            }
            // Unit sanity
            if (!r.unit || r.unit.trim().length === 0) {
                errors.push(`[${i}] Missing unit for "${r.product_name}"`);
            }
            // Package size
            if (r.units_per_package < 1) {
                warnings.push(`[${i}] units_per_package < 1 for "${r.product_name}", defaulting to 1`);
            }
            // Discount sanity
            if (r.discount_pct < 0 || r.discount_pct > 100) {
                warnings.push(`[${i}] discount_pct out of range (${r.discount_pct}) for "${r.product_name}"`);
            }
            // VAT sanity
            if (r.vat_pct < 0 || r.vat_pct > 100) {
                warnings.push(`[${i}] vat_pct out of range (${r.vat_pct}) for "${r.product_name}"`);
            }
        }
        return {
            ok: errors.length === 0,
            errors,
            warnings,
        };
    }
    // ─── Protected helpers ──────────────────────────────────────────────
    /** Normalize one record (used by default normalize()) */
    normalizeOne(record, _context) {
        const normalizedName = (0, normalized_concepts_1.normalizeForMatching)(record.product_name);
        const normalizedUnit = this.normalizeUnit(record.unit);
        const effectivePrice = this.computeEffectivePrice(record);
        const dedupHash = this.computeDedupHash(record, _context);
        return {
            ...record,
            normalized_name: normalizedName,
            normalized_unit: normalizedUnit,
            effective_price: effectivePrice,
            dedup_hash: dedupHash,
        };
    }
    /** Compute effective per-unit price considering discounts, shipping, packaging */
    computeEffectivePrice(record) {
        const unitPrice = record.price_excl_vat;
        const units = Math.max(record.units_per_package, 1);
        const packageCost = unitPrice * units;
        const discountAmount = record.discount_pct > 0
            ? packageCost * (record.discount_pct / 100)
            : 0;
        const total = packageCost - discountAmount + record.shipping_cost + record.other_costs;
        return Math.round((total / units) * 100) / 100;
    }
    /** Generate SHA-256 dedup hash */
    computeDedupHash(record, context) {
        const providerName = context.provider?.name || context.source.name;
        const payload = [
            (0, normalized_concepts_1.normalizeForMatching)(providerName),
            (0, normalized_concepts_1.normalizeForMatching)(record.product_name),
            record.price_excl_vat.toFixed(2),
            record.unit.toLowerCase(),
        ].join("|");
        return (0, crypto_1.createHash)("sha256").update(payload).digest("hex").slice(0, 40);
    }
    /** Normalize unit abbreviations */
    normalizeUnit(unit) {
        const normalized = unit.toLowerCase().trim();
        const unitMap = {
            ud: "ud",
            unidad: "ud",
            unidades: "ud",
            u: "ud",
            m2: "m2",
            "m\u00B2": "m2",
            "metro cuadrado": "m2",
            "metros cuadrados": "m2",
            ml: "ml",
            m: "ml",
            metro: "ml",
            "metro lineal": "ml",
            "metros lineales": "ml",
            kg: "kg",
            kilo: "kg",
            kilogramo: "kg",
            kilogramos: "kg",
            l: "l",
            litro: "l",
            litros: "l",
            saco: "saco",
            rollo: "rollo",
            m3: "m3",
            "m\u00B3": "m3",
            "metro cubico": "m3",
            "metros cubicos": "m3",
            t: "t",
            tonelada: "t",
            toneladas: "t",
            pa: "pa",
            "partida alzada": "pa",
        };
        return unitMap[normalized] || normalized;
    }
}
exports.BasePriceAdapter = BasePriceAdapter;
