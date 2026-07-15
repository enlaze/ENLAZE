"use strict";
/**
 * bc3-import-adapter.ts
 *
 * Adapter for importing BC3/FIEBDC prices into pb_* tables.
 * Converts ParsedBC3 concepts (materials only) into RawPriceRecord
 * for the standard sync pipeline.
 *
 * This adapter works alongside the existing technical-price-importer
 * which writes to technical_price_items. This adapter writes to
 * pb_products + pb_price_observations for V2 price resolution.
 *
 * Source types: bc3
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BC3ImportAdapter = void 0;
const base_adapter_1 = require("./base-adapter");
const bc3_parser_1 = require("../bc3-parser");
// ─── Adapter ─────────────────────────────────────────────────────────────
class BC3ImportAdapter extends base_adapter_1.BasePriceAdapter {
    adapterName = "bc3-import";
    supportedTypes = ["bc3"];
    /** Pre-parsed BC3 data (set before calling fetch()) */
    _parsed = null;
    _source = "bc3";
    _region = "ES";
    _edition = new Date().getFullYear().toString();
    /**
     * Set parsed BC3 data and import metadata before calling fetch().
     */
    setParsedData(parsed, options) {
        this._parsed = parsed;
        this._source = options.source;
        this._region = options.region;
        this._edition = options.edition;
    }
    async fetch(_context) {
        if (!this._parsed) {
            return {
                records: [],
                errors: [{ message: "No BC3 data set. Call setParsedData() first." }],
                warnings: [],
            };
        }
        const classified = (0, bc3_parser_1.classifyConcepts)(this._parsed);
        const warnings = [];
        // Only import materials (items + standalone items, not chapters or resources)
        // Resources are components (labor, machinery, etc.) — not standalone products
        const materialCodes = new Set([
            ...classified.itemCodes,
            ...classified.standaloneCodes,
        ]);
        // Also include resources that are type=3 (material)
        for (const code of classified.resourceCodes) {
            const concept = this._parsed.concepts.find((c) => c.code === code);
            if (concept && concept.type === 3) {
                materialCodes.add(code);
            }
        }
        const records = [];
        for (const concept of this._parsed.concepts) {
            if (!materialCodes.has(concept.code))
                continue;
            if (concept.price <= 0) {
                warnings.push(`Skipping "${concept.summary}" (${concept.code}): price=${concept.price}`);
                continue;
            }
            // Find long text description if available
            const longText = this._parsed.longTexts.find((lt) => lt.code === concept.code);
            // Find parent chapter name
            const parentCodes = classified.childParentMap.get(concept.code) || [];
            let chapterName = "";
            for (const parentCode of parentCodes) {
                if (classified.chapterCodes.has(parentCode) ||
                    classified.rootCodes.includes(parentCode)) {
                    const parentConcept = this._parsed.concepts.find((c) => c.code === parentCode);
                    if (parentConcept) {
                        chapterName = parentConcept.summary;
                        break;
                    }
                }
            }
            const componentType = (0, bc3_parser_1.inferComponentType)(concept);
            records.push({
                external_id: concept.code,
                product_name: concept.summary,
                description: longText?.text || concept.summary,
                brand: null,
                model: null,
                sku: concept.code,
                ean: null,
                unit: concept.unit || "ud",
                units_per_package: 1,
                price_excl_vat: concept.price,
                vat_pct: 21,
                shipping_cost: 0,
                other_costs: 0,
                discount_pct: 0,
                is_available: true,
                url: null,
                region: this._region,
                published_at: concept.date || null,
                raw_data: {
                    source_table: "bc3_import",
                    bc3_code: concept.code,
                    bc3_type: concept.type,
                    component_type: componentType,
                    chapter: chapterName,
                    source: this._source,
                    edition: this._edition,
                    fiebdc_version: this._parsed.metadata.fiebdcVersion,
                    generated_by: this._parsed.metadata.generatedBy,
                },
            });
        }
        if (records.length === 0) {
            warnings.push("No importable materials found in BC3 file (items with price > 0)");
        }
        return {
            records,
            errors: [],
            warnings,
        };
    }
    /**
     * Override normalize to set source_type based on BC3 import type.
     */
    normalize(records, context) {
        return records.map((r) => {
            const base = this.normalizeOne(r, context);
            const rawData = r.raw_data;
            return {
                ...base,
                raw_data: {
                    ...(base.raw_data || {}),
                    confidence_score: 0.90, // BC3 files are reliable reference data
                    source_type: rawData?.source === "cype" || rawData?.source === "ive"
                        ? "technical_bank"
                        : "private_bc3",
                },
            };
        });
    }
}
exports.BC3ImportAdapter = BC3ImportAdapter;
// ─── Register ────────────────────────────────────────────────────────────
(0, base_adapter_1.registerAdapter)("bc3", () => new BC3ImportAdapter());
