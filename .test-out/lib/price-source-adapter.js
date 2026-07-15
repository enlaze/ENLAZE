"use strict";
/**
 * price-source-adapter.ts
 *
 * Modular adapter architecture for price sources.
 * Each adapter implements the PriceSourceAdapter interface.
 *
 * Available adapters:
 *   - ManualAdapter      — manual prices, private tariffs, negotiated
 *   - BC3Adapter         — BC3/FIEBDC file imports
 *   - FileImportAdapter  — Excel/CSV file imports
 *   - TechnicalBankAdapter — global technical price bank
 *   - InternalBankAdapter  — Enlaze base price bank
 *   - WebSearchAdapter   — SerpAPI Google Shopping
 *   - N8nWebhookAdapter  — n8n webhook receiver
 *   - ProviderAPIAdapter — placeholder for provider APIs
 *
 * Adapters are registered in ADAPTER_REGISTRY and selected by source_type.
 *
 * IMPORTANT:
 *   - No adapter performs real scraping without explicit configuration
 *   - API/feed adapters that need credentials are marked as needs_credentials
 *   - This module is server-side only
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdapter = getAdapter;
exports.getRegisteredTypes = getRegisteredTypes;
exports.normalizeRecord = normalizeRecord;
exports.baseNormalize = baseNormalize;
const normalized_concepts_1 = require("./normalized-concepts");
const price_resolver_1 = require("./price-resolver");
const crypto_1 = require("crypto");
// ─── Base normalization (shared by all adapters) ──────────────────────────
function baseNormalize(record) {
    const normalizedName = (0, normalized_concepts_1.normalizeForMatching)(record.product_name);
    const normalizedUnit = (0, price_resolver_1.normalizeUnit)(record.unit);
    // Calculate effective price
    const packageQty = Math.max(record.units_per_package, 1);
    const basePrice = record.price_excl_vat * packageQty;
    const discount = basePrice * (record.discount_pct / 100);
    const effective = basePrice + record.shipping_cost + record.other_costs - discount;
    // Dedup hash: provider + product + price + region
    const hashInput = [
        record.sku || record.ean || normalizedName,
        record.price_excl_vat.toFixed(4),
        record.region,
    ].join("|");
    const dedup_hash = (0, crypto_1.createHash)("sha256").update(hashInput).digest("hex").slice(0, 16);
    return {
        ...record,
        normalized_name: normalizedName,
        normalized_unit: normalizedUnit,
        effective_price: Math.round(effective * 100) / 100,
        dedup_hash,
    };
}
// ─── Manual Adapter ───────────────────────────────────────────────────────
// Handles: manual, private_tariff, negotiated
// These don't "fetch" — records are provided by the user/import directly.
class ManualAdapter {
    type = "manual";
    async validateConfiguration(_source) {
        return { ok: true, errors: [], warnings: [] };
    }
    async fetchPrices(_context) {
        // Manual sources don't auto-fetch — records are inserted directly
        return {
            records: [],
            errors: [],
            warnings: ["Manual source: no automatic fetch. Records are inserted directly."],
        };
    }
    normalize(record) {
        return baseNormalize(record);
    }
}
// ─── Technical Bank Adapter ───────────────────────────────────────────────
// Reads from existing technical_price_items table
class TechnicalBankAdapter {
    type = "technical_bank_global";
    async validateConfiguration(source) {
        // Technical bank is always available (it's our own DB)
        if (!source.region) {
            return {
                ok: true,
                errors: [],
                warnings: ["No region specified — will fetch all regions."],
            };
        }
        return { ok: true, errors: [], warnings: [] };
    }
    async fetchPrices(context) {
        // NOTE: Actual DB query is done by the sync orchestrator.
        // This adapter just defines the shape. The orchestrator passes
        // technical_price_items rows through normalize().
        return {
            records: [],
            errors: [],
            warnings: [
                "TechnicalBankAdapter.fetchPrices: DB query is handled by sync orchestrator. " +
                    "Use normalize() on each technical_price_items row.",
            ],
        };
    }
    normalize(record) {
        return baseNormalize(record);
    }
}
// ─── Internal Bank Adapter (Enlaze base prices) ──────────────────────────
// Reads from the hardcoded INTERNAL_PRICE_DB in price-resolver.ts
class InternalBankAdapter {
    type = "market_estimate";
    async validateConfiguration(_source) {
        return { ok: true, errors: [], warnings: [] };
    }
    async fetchPrices(_context) {
        // Enlaze base prices are hardcoded in price-resolver.ts
        // The sync orchestrator reads from INTERNAL_PRICE_DB and normalizes
        return {
            records: [],
            errors: [],
            warnings: [
                "InternalBankAdapter: prices from hardcoded INTERNAL_PRICE_DB. " +
                    "Orchestrator handles extraction.",
            ],
        };
    }
    normalize(record) {
        return baseNormalize(record);
    }
}
// ─── Web Search Adapter ──────────────────────────────────────────────────
// Uses SerpAPI Google Shopping (existing web-price-search.ts)
class WebSearchAdapter {
    type = "web_authorized";
    async validateConfiguration(source) {
        const apiKey = process.env.SERP_API_KEY;
        if (!apiKey) {
            return {
                ok: false,
                errors: ["SERP_API_KEY not configured in environment variables."],
                warnings: [],
            };
        }
        return { ok: true, errors: [], warnings: [] };
    }
    async fetchPrices(context) {
        // Web search is triggered per-material, not as a batch sync.
        // The price-resolver calls web-price-search.ts directly for materials
        // that couldn't be resolved from other sources.
        return {
            records: [],
            errors: [],
            warnings: [
                "WebSearchAdapter: triggered per-material by price-resolver, " +
                    "not as a batch sync. Use web-price-search.ts directly.",
            ],
        };
    }
    normalize(record) {
        return baseNormalize(record);
    }
}
// ─── N8n Webhook Adapter ─────────────────────────────────────────────────
// Receives price data from n8n workflows via webhook
class N8nWebhookAdapter {
    type = "n8n_webhook";
    async validateConfiguration(source) {
        if (!source.url) {
            return {
                ok: false,
                errors: ["N8n webhook URL not configured."],
                warnings: [],
            };
        }
        return { ok: true, errors: [], warnings: [] };
    }
    async fetchPrices(_context) {
        // N8n pushes data to us via webhook — we don't pull
        return {
            records: [],
            errors: [],
            warnings: [
                "N8nWebhookAdapter: data is pushed via webhook, not pulled. " +
                    "Configure n8n to POST to /api/prices/sync/webhook.",
            ],
        };
    }
    normalize(record) {
        return baseNormalize(record);
    }
}
// ─── Provider API Adapter (placeholder) ──────────────────────────────────
// For future provider-specific API integrations
class ProviderAPIAdapter {
    type = "api";
    async validateConfiguration(source) {
        if (!source.credential_ref) {
            return {
                ok: false,
                errors: [
                    "API adapter requires credentials. Configure credential_ref " +
                        "pointing to a secure credential store (e.g., Supabase Vault).",
                ],
                warnings: [],
            };
        }
        if (!source.url) {
            return {
                ok: false,
                errors: ["API endpoint URL not configured."],
                warnings: [],
            };
        }
        return {
            ok: true,
            errors: [],
            warnings: [
                "Provider API adapter is a placeholder. Implement fetch logic " +
                    "for each specific provider API.",
            ],
        };
    }
    async fetchPrices(_context) {
        // Placeholder — each real provider API would have its own subclass
        return {
            records: [],
            errors: [
                {
                    message: "Provider API adapter not implemented for this provider.",
                    detail: "Create a subclass of ProviderAPIAdapter with provider-specific " +
                        "fetch logic. Required: API URL, auth method, response mapping.",
                },
            ],
            warnings: [],
        };
    }
    normalize(record) {
        return baseNormalize(record);
    }
}
// ─── Feed Adapter (placeholder) ──────────────────────────────────────────
class FeedAdapter {
    type = "feed";
    async validateConfiguration(source) {
        if (!source.url) {
            return {
                ok: false,
                errors: ["Feed URL not configured."],
                warnings: [],
            };
        }
        return {
            ok: true,
            errors: [],
            warnings: [
                "Feed adapter is ready but no feed parser implemented yet. " +
                    "Supported formats: XML product feed, JSON feed.",
            ],
        };
    }
    async fetchPrices(_context) {
        return {
            records: [],
            errors: [
                {
                    message: "Feed adapter not yet implemented.",
                    detail: "Requires: feed URL, format (XML/JSON), field mapping.",
                },
            ],
            warnings: [],
        };
    }
    normalize(record) {
        return baseNormalize(record);
    }
}
// ─── File Import Adapter ─────────────────────────────────────────────────
// For Excel/CSV imports — the actual parsing is in import-excel-csv.ts
class FileImportAdapter {
    type = "excel";
    async validateConfiguration(_source) {
        return { ok: true, errors: [], warnings: [] };
    }
    async fetchPrices(_context) {
        // File imports are handled by the import wizard, not by sync
        return {
            records: [],
            errors: [],
            warnings: [
                "FileImportAdapter: file imports are processed via the import wizard UI, " +
                    "not via automatic sync.",
            ],
        };
    }
    normalize(record) {
        return baseNormalize(record);
    }
}
// ─── BC3 Adapter ─────────────────────────────────────────────────────────
// Uses existing bc3-parser.ts — imports handled by import wizard
class BC3Adapter {
    type = "bc3";
    async validateConfiguration(_source) {
        return { ok: true, errors: [], warnings: [] };
    }
    async fetchPrices(_context) {
        // BC3 imports are handled by bc3-parser.ts + technical-price-importer.ts
        return {
            records: [],
            errors: [],
            warnings: [
                "BC3Adapter: file imports processed via bc3-parser.ts and " +
                    "technical-price-importer.ts. Use the import wizard.",
            ],
        };
    }
    normalize(record) {
        return baseNormalize(record);
    }
}
// ─── Adapter Registry ─────────────────────────────────────────────────────
const ADAPTER_INSTANCES = [
    new ManualAdapter(),
    new TechnicalBankAdapter(),
    new InternalBankAdapter(),
    new WebSearchAdapter(),
    new N8nWebhookAdapter(),
    new ProviderAPIAdapter(),
    new FeedAdapter(),
    new FileImportAdapter(),
    new BC3Adapter(),
];
/**
 * Map of source_type → adapter instance.
 * Multiple source types can map to the same adapter.
 */
const ADAPTER_MAP = {};
// Register all adapters by their primary type
for (const adapter of ADAPTER_INSTANCES) {
    ADAPTER_MAP[adapter.type] = adapter;
}
// Additional type aliases
ADAPTER_MAP["private_tariff"] = ADAPTER_MAP["manual"];
ADAPTER_MAP["negotiated"] = ADAPTER_MAP["manual"];
ADAPTER_MAP["provider_catalog"] = ADAPTER_MAP["manual"];
ADAPTER_MAP["csv"] = ADAPTER_MAP["excel"];
ADAPTER_MAP["technical_bank_private"] = ADAPTER_MAP["technical_bank_global"];
ADAPTER_MAP["budget_history"] = ADAPTER_MAP["manual"];
ADAPTER_MAP["ai_estimate"] = ADAPTER_MAP["market_estimate"];
/**
 * Get the adapter for a given source type.
 * Returns null if no adapter is registered for that type.
 */
function getAdapter(sourceType) {
    return ADAPTER_MAP[sourceType] || null;
}
/**
 * Get all registered adapter types.
 */
function getRegisteredTypes() {
    return Object.keys(ADAPTER_MAP);
}
/**
 * Normalize a raw record using the appropriate adapter.
 * Falls back to base normalization if no adapter found.
 */
function normalizeRecord(sourceType, record) {
    const adapter = getAdapter(sourceType);
    if (adapter) {
        return adapter.normalize(record);
    }
    return baseNormalize(record);
}
