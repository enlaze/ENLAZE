"use strict";
/**
 * Tests for lib/budget-views-v2.ts and lib/budget-snapshot.ts (pure functions only)
 *
 * Run: npx tsc -p tsconfig.test.json --noEmit false && node --test .test-out/__tests__/lib/budget-views-v2.test.js
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const budget_views_v2_1 = require("../../lib/budget-views-v2");
const budget_snapshot_1 = require("../../lib/budget-snapshot");
// ─── Test data helpers ──────────────────────────────────────────────────────
function mockScope(overrides) {
    return {
        project_type: "reforma_integral",
        work_category: "residencial",
        location: "Valencia",
        surface_m2: 90,
        num_bathrooms: 1,
        num_rooms: 3,
        includes_kitchen: true,
        includes_windows: false,
        includes_hvac: false,
        current_state: "necesita_reforma",
        quality: "media",
        rooms: ["salon", "dormitorio1", "dormitorio2", "bano", "cocina"],
        works_requested: ["demoliciones", "albanileria", "pintura"],
        start_date: null,
        deadline_date: null,
        description: "Reforma integral piso 90m2",
        client: {
            name: "Juan Garcia",
            nif: "12345678A",
            address: "Calle Mayor 10, Valencia",
            email: "juan@example.com",
            phone: "600123456",
        },
        ...overrides,
    };
}
function mockPrefs(overrides) {
    return {
        quality: "media",
        margin_percent: 25,
        indirect_costs_percent: 6,
        tax_percent: 21,
        workers_count: null,
        include_alternatives: false,
        ...overrides,
    };
}
function mockItem(overrides) {
    return {
        id: "item-001",
        chapter: "demoliciones",
        code: "02.DEM.001",
        name: "Demolicion tabiqueria de ladrillo",
        description: "Demolicion de tabiqueria interior de ladrillo hueco sencillo",
        unit: "m2",
        quantity: 45,
        quantity_calculation: "Perimetro x altura estimada",
        trade: "peon",
        estimated_hours: 16,
        priority: "obligatoria",
        dependencies: [],
        material_cost_per_unit: 0.5,
        labor_cost_per_unit: 8.0,
        labor_hours_per_unit: 0.35,
        machinery_cost_per_unit: 1.2,
        unit_cost: 9.7,
        unit_price_sale: 12.13,
        subtotal_cost: 436.5,
        subtotal_sale: 545.85,
        margin_percent: 25,
        confidence_score: 0.85,
        price_source: "technical_bank",
        price_source_detail: "CYPE 2026",
        supplier: null,
        materials: [],
        ...overrides,
    };
}
function mockItems() {
    return [
        mockItem(),
        mockItem({
            id: "item-002",
            chapter: "albanileria",
            code: "03.ALB.001",
            name: "Tabique de ladrillo hueco doble",
            unit: "m2",
            quantity: 30,
            material_cost_per_unit: 12.0,
            labor_cost_per_unit: 15.0,
            labor_hours_per_unit: 0.5,
            machinery_cost_per_unit: 0.0,
            unit_cost: 27.0,
            unit_price_sale: 33.75,
            subtotal_cost: 810.0,
            subtotal_sale: 1012.5,
            confidence_score: 0.90,
            price_source: "user_catalog",
        }),
        mockItem({
            id: "item-003",
            chapter: "pintura",
            code: "10.PIN.001",
            name: "Pintura plastica blanca lisa",
            unit: "m2",
            quantity: 200,
            material_cost_per_unit: 2.5,
            labor_cost_per_unit: 4.0,
            labor_hours_per_unit: 0.15,
            machinery_cost_per_unit: 0.0,
            unit_cost: 6.5,
            unit_price_sale: 8.13,
            subtotal_cost: 1300.0,
            subtotal_sale: 1626.0,
            confidence_score: 0.95,
            price_source: "enlaze_base",
        }),
    ];
}
// ─── buildClientViewV2 ─────────────────────────────────────────────────────
(0, node_test_1.describe)("buildClientViewV2", () => {
    (0, node_test_1.it)("builds a valid client view", () => {
        const items = mockItems();
        const scope = mockScope();
        const prefs = mockPrefs();
        const view = (0, budget_views_v2_1.buildClientViewV2)({ items, scope, preferences: prefs });
        strict_1.default.ok(view.chapters.length >= 3, "Should have 3 chapters");
        strict_1.default.equal(view.tax_percent, 21);
        strict_1.default.ok(view.subtotal > 0);
        strict_1.default.ok(view.total > view.subtotal, "Total should include IVA");
        strict_1.default.equal(view.client.name, "Juan Garcia");
        strict_1.default.equal(view.project.location, "Valencia");
    });
    (0, node_test_1.it)("groups items by chapter correctly", () => {
        const items = mockItems();
        const view = (0, budget_views_v2_1.buildClientViewV2)({
            items,
            scope: mockScope(),
            preferences: mockPrefs(),
        });
        const demChapter = view.chapters.find((ch) => ch.name.includes("Demolicion"));
        strict_1.default.ok(demChapter, "Should have demolition chapter");
        strict_1.default.equal(demChapter.items.length, 1);
        const pintChapter = view.chapters.find((ch) => ch.name.includes("Pintura"));
        strict_1.default.ok(pintChapter, "Should have paint chapter");
        strict_1.default.equal(pintChapter.items.length, 1);
    });
    (0, node_test_1.it)("shows PVP (sale price), not cost", () => {
        const items = [mockItem()];
        const view = (0, budget_views_v2_1.buildClientViewV2)({
            items,
            scope: mockScope(),
            preferences: mockPrefs(),
        });
        const item = view.chapters[0].items[0];
        strict_1.default.equal(item.unit_price, 12.13, "Should show sale price, not cost");
        strict_1.default.ok(item.unit_price > 9.7, "PVP should be higher than cost");
    });
    (0, node_test_1.it)("calculates chapter subtotals correctly", () => {
        const items = mockItems();
        const view = (0, budget_views_v2_1.buildClientViewV2)({
            items,
            scope: mockScope(),
            preferences: mockPrefs(),
        });
        for (const chapter of view.chapters) {
            const expectedSubtotal = chapter.items.reduce((s, i) => s + i.subtotal, 0);
            strict_1.default.ok(Math.abs(chapter.subtotal - expectedSubtotal) < 0.01, `Chapter ${chapter.name} subtotal mismatch`);
        }
    });
    (0, node_test_1.it)("calculates total with IVA", () => {
        const items = mockItems();
        const view = (0, budget_views_v2_1.buildClientViewV2)({
            items,
            scope: mockScope(),
            preferences: mockPrefs({ tax_percent: 21 }),
        });
        const expectedTaxAmount = view.subtotal * 0.21;
        strict_1.default.ok(Math.abs(view.tax_amount - expectedTaxAmount) < 0.01, "Tax amount should be 21% of subtotal");
        strict_1.default.ok(Math.abs(view.total - (view.subtotal + view.tax_amount)) < 0.01, "Total = subtotal + tax");
    });
});
// ─── buildInternalViewV2 ────────────────────────────────────────────────────
(0, node_test_1.describe)("buildInternalViewV2", () => {
    (0, node_test_1.it)("builds internal view with cost breakdown", () => {
        const items = mockItems();
        const view = (0, budget_views_v2_1.buildInternalViewV2)({
            items,
            economics: null,
            timeline: null,
            preferences: mockPrefs(),
        });
        strict_1.default.ok(view.chapters.length >= 3);
        strict_1.default.ok(view.totals.direct_cost > 0);
        strict_1.default.ok(view.totals.sale_subtotal > view.totals.direct_cost);
        strict_1.default.ok(view.totals.margin_percent > 0);
    });
    (0, node_test_1.it)("includes confidence and risk per item", () => {
        const items = mockItems();
        const view = (0, budget_views_v2_1.buildInternalViewV2)({
            items,
            economics: null,
            timeline: null,
            preferences: mockPrefs(),
        });
        for (const chapter of view.chapters) {
            for (const item of chapter.items) {
                strict_1.default.ok(item.confidence >= 0 && item.confidence <= 1);
                strict_1.default.ok(["bajo", "medio", "alto"].includes(item.risk));
            }
        }
    });
    (0, node_test_1.it)("shows supplier and price source", () => {
        const items = [
            mockItem({
                supplier: "Leroy Merlin",
                price_source: "user_catalog",
                confidence_score: 0.95,
            }),
        ];
        const view = (0, budget_views_v2_1.buildInternalViewV2)({
            items,
            economics: null,
            timeline: null,
            preferences: mockPrefs(),
        });
        const item = view.chapters[0].items[0];
        strict_1.default.equal(item.supplier, "Leroy Merlin");
        strict_1.default.equal(item.price_source, "user_catalog");
    });
    (0, node_test_1.it)("calculates labor hours", () => {
        const items = mockItems();
        const view = (0, budget_views_v2_1.buildInternalViewV2)({
            items,
            economics: null,
            timeline: null,
            preferences: mockPrefs(),
        });
        strict_1.default.ok(view.totals.total_hours > 0);
        // 45*0.35 + 30*0.5 + 200*0.15 = 15.75 + 15 + 30 = 60.75
        strict_1.default.ok(Math.abs(view.totals.total_hours - 60.75) < 0.1, `Expected ~60.75 hours, got ${view.totals.total_hours}`);
    });
    (0, node_test_1.it)("identifies high-risk items (confidence < 0.5)", () => {
        const items = [
            mockItem({ confidence_score: 0.90 }),
            mockItem({
                id: "low-conf",
                code: "99.OTR.001",
                name: "Partida estimada",
                chapter: "otros",
                confidence_score: 0.30,
                price_source: "estimated",
            }),
        ];
        const view = (0, budget_views_v2_1.buildInternalViewV2)({
            items,
            economics: null,
            timeline: null,
            preferences: mockPrefs(),
        });
        strict_1.default.ok(view.totals.high_risk_items.length >= 1);
        strict_1.default.ok(view.totals.high_risk_items.some((r) => r.includes("Partida estimada")), "Should identify low-confidence item");
        strict_1.default.ok(view.confidence.high_risk_items.length >= 1);
    });
});
// ─── compareSnapshots ───────────────────────────────────────────────────────
(0, node_test_1.describe)("compareSnapshots", () => {
    function makeClientView(items) {
        const chapItems = items.map((i) => ({
            code: i.code,
            name: i.name,
            description: "",
            unit: i.unit,
            quantity: i.qty,
            unit_price: i.price,
            subtotal: i.qty * i.price,
        }));
        const subtotal = chapItems.reduce((s, i) => s + i.subtotal, 0);
        const taxAmount = subtotal * 0.21;
        return {
            company: { name: "", nif: "", address: "", phone: "", email: "" },
            client: { name: "", nif: "", address: "", email: "", phone: "" },
            project: { description: "", location: "", budget_number: "", date: "", validity_days: 30 },
            chapters: [{
                    name: "Test",
                    order: 1,
                    items: chapItems,
                    subtotal,
                }],
            subtotal,
            tax_percent: 21,
            tax_amount: taxAmount,
            total: subtotal + taxAmount,
            payment_terms: "",
            conditions: [],
            exclusions: [],
        };
    }
    (0, node_test_1.it)("detects no changes when views are identical", () => {
        const items = [
            { code: "01.001", name: "Item A", unit: "m2", qty: 10, price: 50 },
            { code: "01.002", name: "Item B", unit: "ud", qty: 5, price: 100 },
        ];
        const viewA = makeClientView(items);
        const viewB = makeClientView(items);
        const diff = (0, budget_snapshot_1.compareSnapshots)(viewA, viewB, 1, 2);
        strict_1.default.equal(diff.items_added.length, 0);
        strict_1.default.equal(diff.items_removed.length, 0);
        strict_1.default.equal(diff.items_changed.length, 0);
        strict_1.default.equal(diff.total_diff, 0);
    });
    (0, node_test_1.it)("detects added items", () => {
        const viewA = makeClientView([
            { code: "01.001", name: "Item A", unit: "m2", qty: 10, price: 50 },
        ]);
        const viewB = makeClientView([
            { code: "01.001", name: "Item A", unit: "m2", qty: 10, price: 50 },
            { code: "01.002", name: "Item B", unit: "ud", qty: 5, price: 100 },
        ]);
        const diff = (0, budget_snapshot_1.compareSnapshots)(viewA, viewB, 1, 2);
        strict_1.default.equal(diff.items_added.length, 1);
        strict_1.default.equal(diff.items_added[0].code, "01.002");
        strict_1.default.ok(diff.total_after > diff.total_before);
    });
    (0, node_test_1.it)("detects removed items", () => {
        const viewA = makeClientView([
            { code: "01.001", name: "Item A", unit: "m2", qty: 10, price: 50 },
            { code: "01.002", name: "Item B", unit: "ud", qty: 5, price: 100 },
        ]);
        const viewB = makeClientView([
            { code: "01.001", name: "Item A", unit: "m2", qty: 10, price: 50 },
        ]);
        const diff = (0, budget_snapshot_1.compareSnapshots)(viewA, viewB, 1, 2);
        strict_1.default.equal(diff.items_removed.length, 1);
        strict_1.default.equal(diff.items_removed[0].code, "01.002");
    });
    (0, node_test_1.it)("detects price changes", () => {
        const viewA = makeClientView([
            { code: "01.001", name: "Item A", unit: "m2", qty: 10, price: 50 },
        ]);
        const viewB = makeClientView([
            { code: "01.001", name: "Item A", unit: "m2", qty: 10, price: 60 },
        ]);
        const diff = (0, budget_snapshot_1.compareSnapshots)(viewA, viewB, 1, 2);
        strict_1.default.equal(diff.items_changed.length, 1);
        strict_1.default.equal(diff.items_changed[0].unit_price_before, 50);
        strict_1.default.equal(diff.items_changed[0].unit_price_after, 60);
        strict_1.default.equal(diff.items_changed[0].price_diff_pct, 20);
        strict_1.default.ok(diff.total_diff > 0);
    });
    (0, node_test_1.it)("detects quantity changes", () => {
        const viewA = makeClientView([
            { code: "01.001", name: "Item A", unit: "m2", qty: 10, price: 50 },
        ]);
        const viewB = makeClientView([
            { code: "01.001", name: "Item A", unit: "m2", qty: 15, price: 50 },
        ]);
        const diff = (0, budget_snapshot_1.compareSnapshots)(viewA, viewB, 1, 2);
        strict_1.default.equal(diff.items_changed.length, 1);
        strict_1.default.equal(diff.items_changed[0].quantity_before, 10);
        strict_1.default.equal(diff.items_changed[0].quantity_after, 15);
    });
    (0, node_test_1.it)("calculates total impact correctly", () => {
        const viewA = makeClientView([
            { code: "01.001", name: "A", unit: "m2", qty: 10, price: 100 },
        ]);
        const viewB = makeClientView([
            { code: "01.001", name: "A", unit: "m2", qty: 10, price: 120 },
        ]);
        const diff = (0, budget_snapshot_1.compareSnapshots)(viewA, viewB, 1, 2);
        // A: 10*100=1000, tax=210, total=1210
        // B: 10*120=1200, tax=252, total=1452
        strict_1.default.equal(diff.total_before, 1210);
        strict_1.default.equal(diff.total_after, 1452);
        strict_1.default.equal(diff.total_diff, 242);
        strict_1.default.ok(Math.abs(diff.total_diff_pct - 20) < 0.1);
    });
});
