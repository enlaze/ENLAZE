"use strict";
/**
 * Tests for BC3 import adapter.
 *
 * Tests that BC3 parsed data is correctly mapped to RawPriceRecord
 * format for the sync pipeline.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const bc3_import_adapter_1 = require("../../lib/adapters/bc3-import-adapter");
const bc3_parser_1 = require("../../lib/bc3-parser");
// ─── Fixtures ────────────────────────────────────────────────────────────
function makeSource() {
    return {
        id: "src-bc3",
        company_id: null,
        name: "bc3-import",
        source_type: "bc3",
        provider_id: "prov-bc3",
        country: "ES",
        region: null,
        url: null,
        update_frequency: "manual",
        last_checked_at: null,
        last_success_at: null,
        next_run_at: null,
        status: "active",
        last_error: null,
        credential_ref: null,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
    };
}
function makeProvider() {
    return {
        id: "prov-bc3",
        company_id: null,
        name: "FIEBDC Import",
        trade_name: null,
        legal_name: null,
        nif: null,
        website: null,
        country: "ES",
        autonomous_community: null,
        province: null,
        supply_zones: [],
        shipping_cost_flat: 0,
        shipping_cost_per_kg: 0,
        free_shipping_min: null,
        minimum_order: 0,
        delivery_days_min: 0,
        delivery_days_max: 0,
        payment_terms_days: 0,
        is_preferred: false,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
    };
}
function makeContext() {
    return {
        source: makeSource(),
        provider: makeProvider(),
        region: "ES",
        run_id: "run-bc3-test",
    };
}
/**
 * Minimal BC3 content for testing.
 * Contains:
 *   - Root node
 *   - 1 chapter
 *   - 2 items (partidas) with decomposition
 *   - 3 resources (1 material, 1 labor, 1 machinery)
 */
const SAMPLE_BC3 = `~V|FIEBDC-3/2020|TestGenerator|Sample BC3|
~K|2\\2\\2\\2\\2\\2\\2\\2\\0\\0\\0\\0\\21|
~C|ROOT||Presupuesto de prueba|0||0|
~C|01||Capitulo Albanileria|0||0|
~C|01.001|m2|Solado de baldosa ceramica 30x30|25.50|20260101|0|
~C|01.002|m2|Enfoscado de cemento e=15mm|18.75|20260101|0|
~C|MBAL001|m2|Baldosa ceramica 30x30 cm|12.00|20260101|3|
~C|MOFI001|h|Oficial primera albanil|22.50|20260101|1|
~C|MPEO001|h|Peon ordinario|17.80|20260101|1|
~C|MCEM001|kg|Cemento portland CEM II|0.12|20260101|3|
~D|ROOT|01\\1.0\\1.0|
~D|01|01.001\\1.0\\1.0\\01.002\\1.0\\1.0|
~D|01.001|MBAL001\\1.0\\1.05\\MOFI001\\1.0\\0.35\\MPEO001\\1.0\\0.20|
~D|01.002|MCEM001\\1.0\\5.0\\MOFI001\\1.0\\0.25\\MPEO001\\1.0\\0.15|
~T|01.001|Suministro y colocacion de solado de baldosa ceramica 30x30 cm tomada con cemento cola|
~T|01.002|Enfoscado maestreado de cemento portland de 15 mm de espesor|
`;
// ─── Tests ───────────────────────────────────────────────────────────────
(0, node_test_1.describe)("BC3ImportAdapter — fetch", () => {
    (0, node_test_1.it)("extracts material items and resources from BC3", async () => {
        const adapter = new bc3_import_adapter_1.BC3ImportAdapter();
        const parsed = (0, bc3_parser_1.parseBC3)(SAMPLE_BC3);
        adapter.setParsedData(parsed, {
            source: "public_bc3",
            region: "comunitat_valenciana",
            edition: "2026",
        });
        const result = await adapter.fetch(makeContext());
        strict_1.default.equal(result.errors.length, 0);
        // Should include: 01.001 (item), 01.002 (item), MBAL001 (material resource), MCEM001 (material resource)
        // Should NOT include: MOFI001 (labor), MPEO001 (labor) — unless they are type=3
        // In our sample: MOFI001 type=1 (labor), MPEO001 type=1 (labor) → excluded
        // Items 01.001 and 01.002 are included as items
        // MBAL001 type=3 (material) → included
        // MCEM001 type=3 (material) → included
        strict_1.default.equal(result.records.length, 4);
        const names = result.records.map((r) => r.product_name);
        strict_1.default.ok(names.includes("Solado de baldosa ceramica 30x30"));
        strict_1.default.ok(names.includes("Enfoscado de cemento e=15mm"));
        strict_1.default.ok(names.includes("Baldosa ceramica 30x30 cm"));
        strict_1.default.ok(names.includes("Cemento portland CEM II"));
    });
    (0, node_test_1.it)("skips items with zero price", async () => {
        const adapter = new bc3_import_adapter_1.BC3ImportAdapter();
        // ROOT and chapter 01 have price=0, they should be skipped
        const parsed = (0, bc3_parser_1.parseBC3)(SAMPLE_BC3);
        adapter.setParsedData(parsed, {
            source: "cype",
            region: "ES",
            edition: "2026",
        });
        const result = await adapter.fetch(makeContext());
        // ROOT (price=0) and 01 (chapter, price=0) should not appear
        for (const record of result.records) {
            strict_1.default.ok(record.price_excl_vat > 0, `Price should be > 0 for ${record.product_name}`);
        }
    });
    (0, node_test_1.it)("sets correct metadata in raw_data", async () => {
        const adapter = new bc3_import_adapter_1.BC3ImportAdapter();
        const parsed = (0, bc3_parser_1.parseBC3)(SAMPLE_BC3);
        adapter.setParsedData(parsed, {
            source: "cype",
            region: "comunitat_valenciana",
            edition: "2026",
        });
        const result = await adapter.fetch(makeContext());
        const item = result.records.find((r) => r.sku === "01.001");
        strict_1.default.ok(item);
        const rawData = item.raw_data;
        strict_1.default.equal(rawData.source, "cype");
        strict_1.default.equal(rawData.edition, "2026");
        strict_1.default.equal(rawData.bc3_code, "01.001");
        strict_1.default.equal(rawData.source_table, "bc3_import");
    });
    (0, node_test_1.it)("includes long text descriptions", async () => {
        const adapter = new bc3_import_adapter_1.BC3ImportAdapter();
        const parsed = (0, bc3_parser_1.parseBC3)(SAMPLE_BC3);
        adapter.setParsedData(parsed, {
            source: "public_bc3",
            region: "ES",
            edition: "2026",
        });
        const result = await adapter.fetch(makeContext());
        const item = result.records.find((r) => r.sku === "01.001");
        strict_1.default.ok(item);
        strict_1.default.ok(item.description.includes("baldosa ceramica 30x30"));
    });
    (0, node_test_1.it)("returns empty when no parsed data set", async () => {
        const adapter = new bc3_import_adapter_1.BC3ImportAdapter();
        const result = await adapter.fetch(makeContext());
        strict_1.default.equal(result.records.length, 0);
        strict_1.default.equal(result.errors.length, 1);
        strict_1.default.ok(result.errors[0].message.includes("No BC3 data"));
    });
});
(0, node_test_1.describe)("BC3ImportAdapter — normalize", () => {
    (0, node_test_1.it)("sets high confidence for BC3 data", async () => {
        const adapter = new bc3_import_adapter_1.BC3ImportAdapter();
        const parsed = (0, bc3_parser_1.parseBC3)(SAMPLE_BC3);
        adapter.setParsedData(parsed, {
            source: "cype",
            region: "ES",
            edition: "2026",
        });
        const result = await adapter.fetch(makeContext());
        const normalized = adapter.normalize(result.records, makeContext());
        for (const r of normalized) {
            const confidence = r.raw_data
                ?.confidence_score;
            strict_1.default.equal(confidence, 0.90);
        }
    });
    (0, node_test_1.it)("classifies CYPE source as technical_bank", async () => {
        const adapter = new bc3_import_adapter_1.BC3ImportAdapter();
        const parsed = (0, bc3_parser_1.parseBC3)(SAMPLE_BC3);
        adapter.setParsedData(parsed, {
            source: "cype",
            region: "ES",
            edition: "2026",
        });
        const result = await adapter.fetch(makeContext());
        const normalized = adapter.normalize(result.records, makeContext());
        for (const r of normalized) {
            const sourceType = r.raw_data?.source_type;
            strict_1.default.equal(sourceType, "technical_bank");
        }
    });
    (0, node_test_1.it)("classifies non-CYPE source as private_bc3", async () => {
        const adapter = new bc3_import_adapter_1.BC3ImportAdapter();
        const parsed = (0, bc3_parser_1.parseBC3)(SAMPLE_BC3);
        adapter.setParsedData(parsed, {
            source: "manual",
            region: "ES",
            edition: "2026",
        });
        const result = await adapter.fetch(makeContext());
        const normalized = adapter.normalize(result.records, makeContext());
        for (const r of normalized) {
            const sourceType = r.raw_data?.source_type;
            strict_1.default.equal(sourceType, "private_bc3");
        }
    });
    (0, node_test_1.it)("generates dedup hashes", async () => {
        const adapter = new bc3_import_adapter_1.BC3ImportAdapter();
        const parsed = (0, bc3_parser_1.parseBC3)(SAMPLE_BC3);
        adapter.setParsedData(parsed, {
            source: "cype",
            region: "ES",
            edition: "2026",
        });
        const result = await adapter.fetch(makeContext());
        const normalized = adapter.normalize(result.records, makeContext());
        for (const r of normalized) {
            strict_1.default.ok(r.dedup_hash.length === 40);
            strict_1.default.ok(/^[a-f0-9]+$/.test(r.dedup_hash));
        }
        // All hashes should be unique (different products)
        const hashes = new Set(normalized.map((r) => r.dedup_hash));
        strict_1.default.equal(hashes.size, normalized.length);
    });
});
(0, node_test_1.describe)("BC3ImportAdapter — validate", () => {
    (0, node_test_1.it)("passes valid BC3 records", async () => {
        const adapter = new bc3_import_adapter_1.BC3ImportAdapter();
        const parsed = (0, bc3_parser_1.parseBC3)(SAMPLE_BC3);
        adapter.setParsedData(parsed, {
            source: "cype",
            region: "ES",
            edition: "2026",
        });
        const result = await adapter.fetch(makeContext());
        const normalized = adapter.normalize(result.records, makeContext());
        const validation = adapter.validate(normalized);
        strict_1.default.ok(validation.ok);
        strict_1.default.equal(validation.errors.length, 0);
    });
});
(0, node_test_1.describe)("BC3ImportAdapter — registry", () => {
    (0, node_test_1.it)("is registered as bc3 source type", async () => {
        // Import registers it
        const { hasAdapter, getAdapter } = await Promise.resolve().then(() => __importStar(require("../../lib/adapters/base-adapter")));
        strict_1.default.ok(hasAdapter("bc3"));
        const adapter = getAdapter("bc3");
        strict_1.default.ok(adapter instanceof bc3_import_adapter_1.BC3ImportAdapter);
    });
});
