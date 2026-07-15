"use strict";
/**
 * technical-bank-adapter.ts
 *
 * Adapter for syncing prices from the technical_price_items table
 * (FIEBDC / ITeC / CYPE base prices) into pb_* tables.
 *
 * This is a "pull" adapter: it reads from an internal DB table.
 *
 * Source types: technical_bank_global, technical_bank_private
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TechnicalBankAdapter = void 0;
const base_adapter_1 = require("./base-adapter");
// ─── Adapter ─────────────────────────────────────────────────────────────
class TechnicalBankAdapter extends base_adapter_1.BasePriceAdapter {
    adapterName = "technical-bank";
    supportedTypes = [
        "technical_bank_global",
        "technical_bank_private",
    ];
    /** Pre-loaded technical price items (set by the sync pipeline) */
    _items = [];
    /**
     * Set items fetched from DB before calling fetch().
     * The sync pipeline queries technical_price_items and passes them here.
     */
    setItems(items) {
        this._items = items;
    }
    async fetch(context) {
        const records = this._items
            .filter((item) => item.is_active)
            .map((item) => ({
            external_id: item.item_code,
            product_name: item.name,
            description: item.description || "",
            brand: null,
            model: null,
            sku: item.item_code,
            ean: null,
            unit: item.unit,
            units_per_package: 1,
            price_excl_vat: item.unit_price,
            vat_pct: 21,
            shipping_cost: 0,
            other_costs: 0,
            discount_pct: 0,
            is_available: true,
            url: null,
            region: item.region || "ES",
            published_at: null,
            raw_data: {
                source_table: "technical_price_items",
                item_id: item.id,
                item_code: item.item_code,
                chapter: item.chapter,
                section: item.section,
                source: item.source,
                confidence_score: item.confidence_score,
                company_id: item.company_id,
            },
        }));
        return {
            records,
            errors: [],
            warnings: records.length === 0
                ? ["No active technical price items found"]
                : [],
        };
    }
    /**
     * Override normalize to preserve item_code as external_id
     * and set higher confidence for established bank prices.
     */
    normalize(records, context) {
        return records.map((r) => {
            const base = this.normalizeOne(r, context);
            // Technical bank prices have high confidence (established reference data)
            const rawConfidence = r.raw_data?.confidence_score;
            const confidence = typeof rawConfidence === "number" ? rawConfidence : 0.90;
            return {
                ...base,
                raw_data: {
                    ...(base.raw_data || {}),
                    confidence_score: confidence,
                    source_type: context.source.source_type === "technical_bank_private"
                        ? "private_bc3"
                        : "technical_bank",
                },
            };
        });
    }
}
exports.TechnicalBankAdapter = TechnicalBankAdapter;
// ─── Register ────────────────────────────────────────────────────────────
(0, base_adapter_1.registerAdapter)("technical_bank_global", () => new TechnicalBankAdapter());
(0, base_adapter_1.registerAdapter)("technical_bank_private", () => new TechnicalBankAdapter());
