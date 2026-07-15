"use strict";
/**
 * n8n-webhook-adapter.ts
 *
 * Adapter for prices pushed by the n8n workflow via webhook.
 * This is a "push" adapter: data is received, not fetched.
 *
 * The webhook v2 endpoint (/api/prices/sync/webhook) pre-processes
 * the payload and calls this adapter's normalize/validate methods
 * for pipeline consistency.
 *
 * Key behaviors:
 *   - fetch() returns pre-loaded records (set via setRecords())
 *   - normalize() adds extraction_method-based confidence scoring
 *   - validate() rejects fallback-sourced items
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.N8nWebhookAdapter = void 0;
const base_adapter_1 = require("./base-adapter");
// ─── Adapter ─────────────────────────────────────────────────────────────
class N8nWebhookAdapter extends base_adapter_1.BasePriceAdapter {
    adapterName = "n8n-webhook";
    supportedTypes = ["n8n_webhook"];
    /** Pre-loaded records from the webhook payload */
    _records = [];
    /** Set records from the webhook handler before calling fetch() */
    setRecords(records) {
        this._records = records;
    }
    /**
     * For push-based adapters, fetch() just returns the pre-loaded records.
     */
    async fetch(_context) {
        return {
            records: this._records,
            errors: [],
            warnings: this._records.length === 0
                ? ["No records received from webhook"]
                : [],
        };
    }
    /**
     * Override normalize to add confidence scoring based on extraction_method.
     */
    normalize(records, context) {
        return records.map((r) => {
            const n8nRecord = r;
            const base = this.normalizeOne(r, context);
            // Override effective_price with confidence-weighted value
            const confidence = this.confidenceFromMethod(n8nRecord.extraction_method, n8nRecord.ai_enriched);
            return {
                ...base,
                raw_data: {
                    ...(base.raw_data || {}),
                    extraction_method: n8nRecord.extraction_method,
                    ai_enriched: n8nRecord.ai_enriched,
                    confidence_score: confidence,
                    category: n8nRecord.category || null,
                    subcategory: n8nRecord.subcategory || null,
                },
            };
        });
    }
    /**
     * Override validate to reject fallback-sourced items.
     */
    validate(records) {
        // Run base validations first
        const base = super.validate(records);
        const errors = [...base.errors];
        const warnings = [...base.warnings];
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const rawData = r.raw_data;
            const method = rawData?.extraction_method;
            if (method === "fallback") {
                errors.push(`[${i}] Fallback price rejected: "${r.product_name}". ` +
                    `Hardcoded fallback prices are not allowed in pb_* tables.`);
            }
            // Warn on AI-enriched prices with suspiciously round numbers
            if (method === "ai_enriched" || rawData?.ai_enriched) {
                const price = r.price_excl_vat;
                if (price > 0 && price === Math.round(price) && price % 10 === 0) {
                    warnings.push(`[${i}] AI-enriched price "${r.product_name}" is a round number (${price}). May need review.`);
                }
            }
        }
        return {
            ok: errors.length === 0,
            errors,
            warnings,
        };
    }
    // ─── Private helpers ───────────────────────────────────────────────
    confidenceFromMethod(method, aiEnriched) {
        switch (method) {
            case "scraped":
                return aiEnriched ? 0.75 : 0.85;
            case "ai_enriched":
                return 0.70;
            case "fallback":
                return 0.10;
            default:
                return 0.50;
        }
    }
}
exports.N8nWebhookAdapter = N8nWebhookAdapter;
// ─── Register ────────────────────────────────────────────────────────────
(0, base_adapter_1.registerAdapter)("n8n_webhook", () => new N8nWebhookAdapter());
