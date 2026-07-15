"use strict";
/**
 * Tests for the price source adapter pattern.
 *
 * Tests:
 *   - Base adapter: normalize, validate, dedup hash, unit normalization
 *   - N8n webhook adapter: confidence scoring, fallback rejection
 *   - Technical bank adapter: item mapping, confidence scoring
 *   - Registry: registration, lookup
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const base_adapter_1 = require("../../lib/adapters/base-adapter");
const n8n_webhook_adapter_1 = require("../../lib/adapters/n8n-webhook-adapter");
const technical_bank_adapter_1 = require("../../lib/adapters/technical-bank-adapter");
// ─── Fixtures ────────────────────────────────────────────────────────────
function makeSource(overrides) {
    return {
        id: "src-001",
        company_id: null,
        name: "test-source",
        source_type: "n8n_webhook",
        provider_id: "prov-001",
        country: "ES",
        region: null,
        url: null,
        update_frequency: "daily",
        last_checked_at: null,
        last_success_at: null,
        next_run_at: null,
        status: "active",
        last_error: null,
        credential_ref: null,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        ...overrides,
    };
}
function makeProvider(overrides) {
    return {
        id: "prov-001",
        company_id: null,
        name: "Test Provider",
        trade_name: null,
        legal_name: null,
        nif: null,
        website: null,
        country: "ES",
        autonomous_community: null,
        province: "Madrid",
        supply_zones: ["Madrid", "Toledo"],
        shipping_cost_flat: 0,
        shipping_cost_per_kg: 0,
        free_shipping_min: null,
        minimum_order: 0,
        delivery_days_min: 1,
        delivery_days_max: 5,
        payment_terms_days: 30,
        is_preferred: false,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        ...overrides,
    };
}
function makeContext(overrides) {
    return {
        source: makeSource(),
        provider: makeProvider(),
        region: "ES",
        run_id: "run-001",
        ...overrides,
    };
}
function makeRawRecord(overrides) {
    return {
        external_id: null,
        product_name: "Cemento Portland CEM II 25kg",
        description: "Cemento de albañilería general",
        brand: "CEMEX",
        model: null,
        sku: "CEM-25-001",
        ean: null,
        unit: "saco",
        units_per_package: 1,
        price_excl_vat: 4.5,
        vat_pct: 21,
        shipping_cost: 0,
        other_costs: 0,
        discount_pct: 0,
        is_available: true,
        url: null,
        region: "ES",
        published_at: null,
        raw_data: null,
        ...overrides,
    };
}
// ─── Concrete test adapter (for base class tests) ────────────────────────
class TestAdapter extends base_adapter_1.BasePriceAdapter {
    adapterName = "test";
    supportedTypes = ["n8n_webhook"];
    async fetch(_context) {
        return { records: [], errors: [], warnings: [] };
    }
}
// ─── Base Adapter Tests ─────────────────────────────────────────────────
(0, node_test_1.describe)("BasePriceAdapter — normalize", () => {
    (0, node_test_1.it)("normalizes a record with all expected fields", () => {
        const adapter = new TestAdapter();
        const records = [makeRawRecord()];
        const ctx = makeContext();
        const normalized = adapter.normalize(records, ctx);
        strict_1.default.equal(normalized.length, 1);
        const n = normalized[0];
        strict_1.default.ok(n.normalized_name.length > 0);
        strict_1.default.equal(n.normalized_unit, "saco");
        strict_1.default.equal(n.effective_price, 4.5); // no discount, no shipping
        strict_1.default.ok(n.dedup_hash.length === 40);
    });
    (0, node_test_1.it)("computes effective price with discount", () => {
        const adapter = new TestAdapter();
        const records = [makeRawRecord({ price_excl_vat: 100, discount_pct: 10 })];
        const ctx = makeContext();
        const normalized = adapter.normalize(records, ctx);
        // 100 - 10% = 90
        strict_1.default.equal(normalized[0].effective_price, 90);
    });
    (0, node_test_1.it)("computes effective price with shipping and other costs", () => {
        const adapter = new TestAdapter();
        const records = [
            makeRawRecord({
                price_excl_vat: 100,
                shipping_cost: 15,
                other_costs: 5,
            }),
        ];
        const ctx = makeContext();
        const normalized = adapter.normalize(records, ctx);
        // 100 + 15 + 5 = 120
        strict_1.default.equal(normalized[0].effective_price, 120);
    });
    (0, node_test_1.it)("computes effective price with multi-unit package", () => {
        const adapter = new TestAdapter();
        const records = [
            makeRawRecord({
                price_excl_vat: 10, // per unit
                units_per_package: 4,
                shipping_cost: 8,
            }),
        ];
        const ctx = makeContext();
        const normalized = adapter.normalize(records, ctx);
        // package_cost = 10 * 4 = 40, total = 40 + 8 = 48, per unit = 48/4 = 12
        strict_1.default.equal(normalized[0].effective_price, 12);
    });
});
(0, node_test_1.describe)("BasePriceAdapter — validate", () => {
    (0, node_test_1.it)("passes valid records", () => {
        const adapter = new TestAdapter();
        const records = [makeRawRecord()];
        const normalized = adapter.normalize(records, makeContext());
        const result = adapter.validate(normalized);
        strict_1.default.ok(result.ok);
        strict_1.default.equal(result.errors.length, 0);
    });
    (0, node_test_1.it)("rejects records with missing product_name", () => {
        const adapter = new TestAdapter();
        const records = [makeRawRecord({ product_name: "" })];
        const normalized = adapter.normalize(records, makeContext());
        const result = adapter.validate(normalized);
        strict_1.default.ok(!result.ok);
        strict_1.default.ok(result.errors.some((e) => e.includes("Missing product_name")));
    });
    (0, node_test_1.it)("rejects records with negative price", () => {
        const adapter = new TestAdapter();
        const records = [makeRawRecord({ price_excl_vat: -5 })];
        const normalized = adapter.normalize(records, makeContext());
        const result = adapter.validate(normalized);
        strict_1.default.ok(!result.ok);
        strict_1.default.ok(result.errors.some((e) => e.includes("Negative price")));
    });
    (0, node_test_1.it)("warns on zero price", () => {
        const adapter = new TestAdapter();
        const records = [makeRawRecord({ price_excl_vat: 0 })];
        const normalized = adapter.normalize(records, makeContext());
        const result = adapter.validate(normalized);
        strict_1.default.ok(result.ok); // warning, not error
        strict_1.default.ok(result.warnings.some((w) => w.includes("Zero price")));
    });
});
(0, node_test_1.describe)("BasePriceAdapter — unit normalization", () => {
    (0, node_test_1.it)("normalizes common units", () => {
        const adapter = new TestAdapter();
        const ctx = makeContext();
        const units = [
            { input: "unidad", expected: "ud" },
            { input: "m2", expected: "m2" },
            { input: "m²", expected: "m2" },
            { input: "metro cuadrado", expected: "m2" },
            { input: "kg", expected: "kg" },
            { input: "kilogramo", expected: "kg" },
            { input: "metro lineal", expected: "ml" },
            { input: "partida alzada", expected: "pa" },
            { input: "saco", expected: "saco" },
        ];
        for (const { input, expected } of units) {
            const records = [makeRawRecord({ unit: input })];
            const normalized = adapter.normalize(records, ctx);
            strict_1.default.equal(normalized[0].normalized_unit, expected, `Expected "${input}" → "${expected}", got "${normalized[0].normalized_unit}"`);
        }
    });
});
(0, node_test_1.describe)("BasePriceAdapter — dedup hash", () => {
    (0, node_test_1.it)("same inputs produce same hash", () => {
        const adapter = new TestAdapter();
        const ctx = makeContext();
        const r1 = adapter.normalize([makeRawRecord()], ctx);
        const r2 = adapter.normalize([makeRawRecord()], ctx);
        strict_1.default.equal(r1[0].dedup_hash, r2[0].dedup_hash);
    });
    (0, node_test_1.it)("different price produces different hash", () => {
        const adapter = new TestAdapter();
        const ctx = makeContext();
        const r1 = adapter.normalize([makeRawRecord({ price_excl_vat: 100 })], ctx);
        const r2 = adapter.normalize([makeRawRecord({ price_excl_vat: 200 })], ctx);
        strict_1.default.notEqual(r1[0].dedup_hash, r2[0].dedup_hash);
    });
    (0, node_test_1.it)("different provider produces different hash", () => {
        const adapter = new TestAdapter();
        const ctx1 = makeContext({ provider: makeProvider({ name: "Provider A" }) });
        const ctx2 = makeContext({ provider: makeProvider({ name: "Provider B" }) });
        const r1 = adapter.normalize([makeRawRecord()], ctx1);
        const r2 = adapter.normalize([makeRawRecord()], ctx2);
        strict_1.default.notEqual(r1[0].dedup_hash, r2[0].dedup_hash);
    });
});
// ─── N8n Webhook Adapter Tests ──────────────────────────────────────────
(0, node_test_1.describe)("N8nWebhookAdapter", () => {
    (0, node_test_1.it)("returns pre-loaded records from fetch()", async () => {
        const adapter = new n8n_webhook_adapter_1.N8nWebhookAdapter();
        const records = [
            {
                ...makeRawRecord(),
                extraction_method: "scraped",
                ai_enriched: false,
            },
        ];
        adapter.setRecords(records);
        const result = await adapter.fetch(makeContext());
        strict_1.default.equal(result.records.length, 1);
        strict_1.default.equal(result.errors.length, 0);
    });
    (0, node_test_1.it)("adds confidence score based on extraction_method", () => {
        const adapter = new n8n_webhook_adapter_1.N8nWebhookAdapter();
        const records = [
            {
                ...makeRawRecord({ product_name: "Scraped item" }),
                extraction_method: "scraped",
                ai_enriched: false,
            },
            {
                ...makeRawRecord({ product_name: "AI item" }),
                extraction_method: "ai_enriched",
                ai_enriched: true,
            },
        ];
        const normalized = adapter.normalize(records, makeContext());
        const scrapedConf = normalized[0].raw_data?.confidence_score;
        const aiConf = normalized[1].raw_data?.confidence_score;
        strict_1.default.equal(scrapedConf, 0.85);
        strict_1.default.equal(aiConf, 0.70);
    });
    (0, node_test_1.it)("rejects fallback items in validate()", () => {
        const adapter = new n8n_webhook_adapter_1.N8nWebhookAdapter();
        const records = [
            {
                ...makeRawRecord({ product_name: "Real item" }),
                extraction_method: "scraped",
                ai_enriched: false,
            },
            {
                ...makeRawRecord({ product_name: "Fallback item" }),
                extraction_method: "fallback",
                ai_enriched: false,
            },
        ];
        const normalized = adapter.normalize(records, makeContext());
        const result = adapter.validate(normalized);
        strict_1.default.ok(!result.ok);
        strict_1.default.ok(result.errors.some((e) => e.includes("Fallback price rejected")));
        strict_1.default.ok(result.errors.some((e) => e.includes("Fallback item")));
        // Only the fallback should fail, not the real item
        strict_1.default.equal(result.errors.filter((e) => e.includes("Real item")).length, 0);
    });
    (0, node_test_1.it)("warns on round AI prices", () => {
        const adapter = new n8n_webhook_adapter_1.N8nWebhookAdapter();
        const records = [
            {
                ...makeRawRecord({ product_name: "AI price", price_excl_vat: 200 }),
                extraction_method: "ai_enriched",
                ai_enriched: true,
            },
        ];
        const normalized = adapter.normalize(records, makeContext());
        const result = adapter.validate(normalized);
        strict_1.default.ok(result.warnings.some((w) => w.includes("round number")));
    });
});
// ─── Technical Bank Adapter Tests ───────────────────────────────────────
(0, node_test_1.describe)("TechnicalBankAdapter", () => {
    (0, node_test_1.it)("maps technical_price_items to RawPriceRecord", async () => {
        const adapter = new technical_bank_adapter_1.TechnicalBankAdapter();
        const items = [
            {
                id: "tech-001",
                item_code: "01HOR010",
                name: "Hormigón HA-25/B/20/IIa, en central",
                description: "Hormigón armado HA-25",
                unit: "m3",
                unit_price: 78.5,
                chapter: "Estructuras",
                section: "Hormigones",
                region: "ES",
                source: "FIEBDC",
                confidence_score: 0.95,
                company_id: null,
                is_active: true,
            },
        ];
        adapter.setItems(items);
        const ctx = makeContext({
            source: makeSource({ source_type: "technical_bank_global" }),
        });
        const result = await adapter.fetch(ctx);
        strict_1.default.equal(result.records.length, 1);
        const r = result.records[0];
        strict_1.default.equal(r.product_name, "Hormigón HA-25/B/20/IIa, en central");
        strict_1.default.equal(r.sku, "01HOR010");
        strict_1.default.equal(r.price_excl_vat, 78.5);
        strict_1.default.equal(r.unit, "m3");
        strict_1.default.equal(r.raw_data?.source, "FIEBDC");
    });
    (0, node_test_1.it)("filters out inactive items", async () => {
        const adapter = new technical_bank_adapter_1.TechnicalBankAdapter();
        adapter.setItems([
            {
                id: "t1",
                item_code: "ACTIVE",
                name: "Active item",
                description: null,
                unit: "ud",
                unit_price: 10,
                chapter: null,
                section: null,
                region: "ES",
                source: "CYPE",
                confidence_score: 0.9,
                company_id: null,
                is_active: true,
            },
            {
                id: "t2",
                item_code: "INACTIVE",
                name: "Inactive item",
                description: null,
                unit: "ud",
                unit_price: 20,
                chapter: null,
                section: null,
                region: "ES",
                source: "CYPE",
                confidence_score: 0.9,
                company_id: null,
                is_active: false,
            },
        ]);
        const result = await adapter.fetch(makeContext());
        strict_1.default.equal(result.records.length, 1);
        strict_1.default.equal(result.records[0].product_name, "Active item");
    });
    (0, node_test_1.it)("sets high confidence for technical bank items", () => {
        const adapter = new technical_bank_adapter_1.TechnicalBankAdapter();
        const records = [
            makeRawRecord({
                raw_data: { confidence_score: 0.95, source: "FIEBDC" },
            }),
        ];
        const ctx = makeContext({
            source: makeSource({ source_type: "technical_bank_global" }),
        });
        const normalized = adapter.normalize(records, ctx);
        strict_1.default.equal(normalized[0].raw_data?.confidence_score, 0.95);
        strict_1.default.equal(normalized[0].raw_data?.source_type, "technical_bank");
    });
    (0, node_test_1.it)("defaults confidence to 0.90 if not set", () => {
        const adapter = new technical_bank_adapter_1.TechnicalBankAdapter();
        const records = [
            makeRawRecord({ raw_data: null }),
        ];
        const ctx = makeContext({
            source: makeSource({ source_type: "technical_bank_global" }),
        });
        const normalized = adapter.normalize(records, ctx);
        strict_1.default.equal(normalized[0].raw_data?.confidence_score, 0.90);
    });
});
// ─── Registry Tests ─────────────────────────────────────────────────────
(0, node_test_1.describe)("Adapter Registry", () => {
    (0, node_test_1.it)("has n8n_webhook adapter registered", () => {
        // Import side-effect registers it
        strict_1.default.ok((0, base_adapter_1.hasAdapter)("n8n_webhook"));
    });
    (0, node_test_1.it)("has technical_bank_global adapter registered", () => {
        strict_1.default.ok((0, base_adapter_1.hasAdapter)("technical_bank_global"));
    });
    (0, node_test_1.it)("has technical_bank_private adapter registered", () => {
        strict_1.default.ok((0, base_adapter_1.hasAdapter)("technical_bank_private"));
    });
    (0, node_test_1.it)("returns null for unregistered adapter", () => {
        strict_1.default.equal((0, base_adapter_1.getAdapter)("api"), null);
    });
    (0, node_test_1.it)("creates fresh adapter instances", () => {
        const a1 = (0, base_adapter_1.getAdapter)("n8n_webhook");
        const a2 = (0, base_adapter_1.getAdapter)("n8n_webhook");
        strict_1.default.ok(a1 !== a2); // factory creates new instance each time
    });
    (0, node_test_1.it)("lists registered adapters", () => {
        const registered = (0, base_adapter_1.listRegisteredAdapters)();
        strict_1.default.ok(registered.includes("n8n_webhook"));
        strict_1.default.ok(registered.includes("technical_bank_global"));
        strict_1.default.ok(registered.includes("technical_bank_private"));
    });
});
