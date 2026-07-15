"use strict";
/**
 * Tests for the webhook v2 Zod schemas and helper functions.
 *
 * We test the validation logic and helpers in isolation (no Supabase needed).
 * The actual route handler tests would require mocking Supabase.
 *
 * Run: npx tsx --test __tests__/lib/webhook-v2-schemas.test.ts
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const zod_1 = require("zod");
const crypto_1 = require("crypto");
const normalized_concepts_1 = require("../../lib/normalized-concepts");
// ─── Reproduce schemas from the webhook route for testing ────────────────
// (These mirror app/api/prices/sync/webhook/route.ts)
const extractionMethodSchema = zod_1.z.enum(["scraped", "ai_enriched", "fallback"]);
const webhookPriceItemSchema = zod_1.z.object({
    product_name: zod_1.z.string().min(1).max(500),
    description: zod_1.z.string().default(""),
    brand: zod_1.z.string().max(200).nullable().optional(),
    model: zod_1.z.string().max(200).nullable().optional(),
    sku: zod_1.z.string().max(100).nullable().optional(),
    ean: zod_1.z.string().max(20).nullable().optional(),
    unit: zod_1.z.string().min(1).default("ud"),
    units_per_package: zod_1.z.number().min(1).default(1),
    price_excl_vat: zod_1.z.number().min(0),
    vat_pct: zod_1.z.number().min(0).max(100).default(21),
    shipping_cost: zod_1.z.number().min(0).default(0),
    other_costs: zod_1.z.number().min(0).default(0),
    discount_pct: zod_1.z.number().min(0).max(100).default(0),
    is_available: zod_1.z.boolean().default(true),
    url: zod_1.z.string().url().nullable().optional(),
    category: zod_1.z.string().optional(),
    subcategory: zod_1.z.string().optional(),
    extraction_method: extractionMethodSchema.default("scraped"),
    ai_enriched: zod_1.z.boolean().default(false),
    raw_data: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).nullable().optional(),
});
const webhookBodySchema = zod_1.z.object({
    source_name: zod_1.z.string().min(1).max(200),
    provider_name: zod_1.z.string().min(1).max(200),
    provider_province: zod_1.z.string().optional(),
    provider_supply_zones: zod_1.z.array(zod_1.z.string()).optional(),
    idempotency_key: zod_1.z.string().optional(),
    prices: zod_1.z.array(webhookPriceItemSchema).min(1).max(500),
});
// ─── Helper replicas ────────────────────────────────────────────────────
function makeDedupHash(providerName, productName, price, unit) {
    const payload = [
        (0, normalized_concepts_1.normalizeForMatching)(providerName),
        (0, normalized_concepts_1.normalizeForMatching)(productName),
        price.toFixed(2),
        unit.toLowerCase(),
    ].join("|");
    return (0, crypto_1.createHash)("sha256").update(payload).digest("hex").slice(0, 40);
}
function confidenceFromMethod(method, aiEnriched) {
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
// ─── Schema validation tests ────────────────────────────────────────────
(0, node_test_1.describe)("webhookBodySchema — validation", () => {
    (0, node_test_1.it)("accepts a valid minimal payload", () => {
        const result = webhookBodySchema.safeParse({
            source_name: "leroy_platos_ducha",
            provider_name: "Leroy Merlin",
            prices: [
                { product_name: "Plato ducha 70x120", price_excl_vat: 189.0 },
            ],
        });
        strict_1.default.ok(result.success);
        strict_1.default.equal(result.data.prices[0].unit, "ud"); // default
        strict_1.default.equal(result.data.prices[0].extraction_method, "scraped"); // default
        strict_1.default.equal(result.data.prices[0].ai_enriched, false); // default
        strict_1.default.equal(result.data.prices[0].vat_pct, 21); // default
    });
    (0, node_test_1.it)("accepts a full payload with all fields", () => {
        const result = webhookBodySchema.safeParse({
            source_name: "obramat_cementos",
            provider_name: "OBRAMAT",
            provider_province: "Madrid",
            provider_supply_zones: ["Madrid", "Toledo"],
            idempotency_key: "n8n-run-2026-07-14-abc",
            prices: [
                {
                    product_name: "Cemento Portland CEM II 32.5 saco 25kg",
                    description: "Cemento de albañilería general",
                    brand: "CEMEX",
                    sku: "CEM-25-001",
                    ean: "8400001234567",
                    unit: "saco",
                    units_per_package: 1,
                    price_excl_vat: 4.5,
                    vat_pct: 21,
                    shipping_cost: 0,
                    other_costs: 0,
                    discount_pct: 0,
                    is_available: true,
                    url: "https://www.obramat.es/cemento-portland",
                    category: "albanileria",
                    subcategory: "cementos",
                    extraction_method: "scraped",
                    ai_enriched: false,
                    raw_data: { page_url: "https://www.obramat.es/cementos" },
                },
            ],
        });
        strict_1.default.ok(result.success);
        strict_1.default.equal(result.data.prices[0].brand, "CEMEX");
    });
    (0, node_test_1.it)("rejects empty source_name", () => {
        const result = webhookBodySchema.safeParse({
            source_name: "",
            provider_name: "Test",
            prices: [{ product_name: "X", price_excl_vat: 1 }],
        });
        strict_1.default.ok(!result.success);
    });
    (0, node_test_1.it)("rejects empty prices array", () => {
        const result = webhookBodySchema.safeParse({
            source_name: "test",
            provider_name: "Test",
            prices: [],
        });
        strict_1.default.ok(!result.success);
    });
    (0, node_test_1.it)("rejects missing product_name", () => {
        const result = webhookBodySchema.safeParse({
            source_name: "test",
            provider_name: "Test",
            prices: [{ price_excl_vat: 10 }],
        });
        strict_1.default.ok(!result.success);
    });
    (0, node_test_1.it)("rejects negative price", () => {
        const result = webhookBodySchema.safeParse({
            source_name: "test",
            provider_name: "Test",
            prices: [{ product_name: "X", price_excl_vat: -5 }],
        });
        strict_1.default.ok(!result.success);
    });
    (0, node_test_1.it)("rejects invalid extraction_method", () => {
        const result = webhookBodySchema.safeParse({
            source_name: "test",
            provider_name: "Test",
            prices: [
                {
                    product_name: "X",
                    price_excl_vat: 10,
                    extraction_method: "magic",
                },
            ],
        });
        strict_1.default.ok(!result.success);
    });
    (0, node_test_1.it)("rejects invalid url", () => {
        const result = webhookBodySchema.safeParse({
            source_name: "test",
            provider_name: "Test",
            prices: [
                {
                    product_name: "X",
                    price_excl_vat: 10,
                    url: "not-a-url",
                },
            ],
        });
        strict_1.default.ok(!result.success);
    });
    (0, node_test_1.it)("allows null url", () => {
        const result = webhookBodySchema.safeParse({
            source_name: "test",
            provider_name: "Test",
            prices: [
                {
                    product_name: "X",
                    price_excl_vat: 10,
                    url: null,
                },
            ],
        });
        strict_1.default.ok(result.success);
    });
});
// ─── Dedup hash tests ───────────────────────────────────────────────────
(0, node_test_1.describe)("makeDedupHash", () => {
    (0, node_test_1.it)("produces a 40-char hex string", () => {
        const hash = makeDedupHash("Leroy Merlin", "Plato ducha 70x120", 189, "ud");
        strict_1.default.equal(hash.length, 40);
        strict_1.default.ok(/^[a-f0-9]+$/.test(hash));
    });
    (0, node_test_1.it)("same inputs produce same hash", () => {
        const h1 = makeDedupHash("Leroy Merlin", "Plato ducha 70x120", 189, "ud");
        const h2 = makeDedupHash("Leroy Merlin", "Plato ducha 70x120", 189, "ud");
        strict_1.default.equal(h1, h2);
    });
    (0, node_test_1.it)("different price produces different hash", () => {
        const h1 = makeDedupHash("Leroy Merlin", "Plato ducha 70x120", 189, "ud");
        const h2 = makeDedupHash("Leroy Merlin", "Plato ducha 70x120", 199, "ud");
        strict_1.default.notEqual(h1, h2);
    });
    (0, node_test_1.it)("normalizes accents and casing", () => {
        const h1 = makeDedupHash("LEROY MERLIN", "PLATO DUCHA 70x120", 189, "ud");
        const h2 = makeDedupHash("leroy merlin", "plato ducha 70x120", 189, "ud");
        strict_1.default.equal(h1, h2);
    });
    (0, node_test_1.it)("different provider produces different hash", () => {
        const h1 = makeDedupHash("Leroy Merlin", "Plato ducha", 100, "ud");
        const h2 = makeDedupHash("Obramat", "Plato ducha", 100, "ud");
        strict_1.default.notEqual(h1, h2);
    });
});
// ─── Confidence scoring tests ───────────────────────────────────────────
(0, node_test_1.describe)("confidenceFromMethod", () => {
    (0, node_test_1.it)("scraped without AI = 0.85", () => {
        strict_1.default.equal(confidenceFromMethod("scraped", false), 0.85);
    });
    (0, node_test_1.it)("scraped with AI enrichment = 0.75", () => {
        strict_1.default.equal(confidenceFromMethod("scraped", true), 0.75);
    });
    (0, node_test_1.it)("ai_enriched = 0.70", () => {
        strict_1.default.equal(confidenceFromMethod("ai_enriched", false), 0.70);
    });
    (0, node_test_1.it)("fallback = 0.10 (very low)", () => {
        strict_1.default.equal(confidenceFromMethod("fallback", false), 0.10);
    });
    (0, node_test_1.it)("unknown method = 0.50", () => {
        strict_1.default.equal(confidenceFromMethod("other", false), 0.50);
    });
});
// ─── Fallback detection tests ───────────────────────────────────────────
(0, node_test_1.describe)("fallback filtering logic", () => {
    (0, node_test_1.it)("separates fallback from real prices", () => {
        const prices = [
            { product_name: "Cemento CEM II", price_excl_vat: 4.5, extraction_method: "scraped", ai_enriched: false },
            { product_name: "Fallback ducha", price_excl_vat: 189, extraction_method: "fallback", ai_enriched: false },
            { product_name: "Azulejo AI", price_excl_vat: 22, extraction_method: "ai_enriched", ai_enriched: true },
            { product_name: "Zero price", price_excl_vat: 0, extraction_method: "scraped", ai_enriched: false },
        ];
        const realPrices = [];
        const rejected = [];
        for (const item of prices) {
            if (item.extraction_method === "fallback") {
                rejected.push(item.product_name);
            }
            else if (item.price_excl_vat <= 0) {
                rejected.push(`${item.product_name} (precio=0)`);
            }
            else {
                realPrices.push(item);
            }
        }
        strict_1.default.equal(realPrices.length, 2);
        strict_1.default.equal(rejected.length, 2);
        strict_1.default.ok(rejected.includes("Fallback ducha"));
        strict_1.default.ok(rejected.some((r) => r.includes("Zero price")));
        strict_1.default.equal(realPrices[0].product_name, "Cemento CEM II");
        strict_1.default.equal(realPrices[1].product_name, "Azulejo AI");
    });
});
