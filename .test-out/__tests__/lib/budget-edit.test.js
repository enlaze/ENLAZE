"use strict";
/**
 * Tests for lib/budget-edit.ts (pure functions only)
 *
 * Run: npx tsc -p tsconfig.test.json --noEmit false && node --test .test-out/__tests__/lib/budget-edit.test.js
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const budget_edit_1 = require("../../lib/budget-edit");
// ─── Test data ──────────────────────────────────────────────────────────────
function mockItem(overrides) {
    return {
        id: "item-001",
        chapter: "demoliciones",
        code: "02.DEM.001",
        name: "Demolicion tabiqueria",
        description: "Demolicion de tabiqueria interior",
        unit: "m2",
        quantity: 45,
        quantity_calculation: "Perimetro x altura",
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
            name: "Tabique ladrillo",
            quantity: 30,
            material_cost_per_unit: 12.0,
            labor_cost_per_unit: 15.0,
            machinery_cost_per_unit: 0.0,
            unit_cost: 27.0,
            unit_price_sale: 33.75,
            subtotal_cost: 810.0,
            subtotal_sale: 1012.5,
        }),
        mockItem({
            id: "item-003",
            chapter: "pintura",
            code: "10.PIN.001",
            name: "Pintura plastica",
            quantity: 200,
            material_cost_per_unit: 2.5,
            labor_cost_per_unit: 4.0,
            machinery_cost_per_unit: 0.0,
            unit_cost: 6.5,
            unit_price_sale: 8.13,
            subtotal_cost: 1300.0,
            subtotal_sale: 1626.0,
        }),
    ];
}
// ─── editItem ───────────────────────────────────────────────────────────────
(0, node_test_1.describe)("editItem", () => {
    (0, node_test_1.it)("edits quantity and recalculates subtotals", () => {
        const items = mockItems();
        const result = (0, budget_edit_1.editItem)({
            items,
            itemId: "item-001",
            edits: { quantity: 60 },
        });
        strict_1.default.ok(result.ok);
        strict_1.default.ok(result.editedItem);
        strict_1.default.equal(result.editedItem.quantity, 60);
        // subtotal_cost = 60 * 9.7 = 582
        strict_1.default.ok(Math.abs(result.editedItem.subtotal_cost - 582) < 0.01);
        // Original items unchanged
        strict_1.default.equal(items[0].quantity, 45);
    });
    (0, node_test_1.it)("edits margin and recalculates sale price", () => {
        const items = [mockItem()];
        const result = (0, budget_edit_1.editItem)({
            items,
            itemId: "item-001",
            edits: { margin_percent: 30 },
        });
        strict_1.default.ok(result.ok);
        const edited = result.editedItem;
        strict_1.default.equal(edited.margin_percent, 30);
        // unit_price_sale = 9.7 * 1.30 = 12.61
        strict_1.default.ok(Math.abs(edited.unit_price_sale - 12.61) < 0.01);
    });
    (0, node_test_1.it)("edits text fields without recalculation", () => {
        const items = [mockItem()];
        const result = (0, budget_edit_1.editItem)({
            items,
            itemId: "item-001",
            edits: { name: "Nuevo nombre", description: "Nueva desc" },
        });
        strict_1.default.ok(result.ok);
        strict_1.default.equal(result.editedItem.name, "Nuevo nombre");
        strict_1.default.equal(result.editedItem.description, "Nueva desc");
        // Subtotals unchanged
        strict_1.default.equal(result.editedItem.subtotal_cost, 436.5);
    });
    (0, node_test_1.it)("returns error for non-existent item", () => {
        const items = [mockItem()];
        const result = (0, budget_edit_1.editItem)({
            items,
            itemId: "non-existent",
            edits: { quantity: 10 },
        });
        strict_1.default.ok(!result.ok);
        strict_1.default.ok(result.error?.includes("no encontrado"));
        strict_1.default.equal(result.editedItem, null);
    });
    (0, node_test_1.it)("edits material cost and recalculates unit_cost", () => {
        const items = [mockItem()];
        const result = (0, budget_edit_1.editItem)({
            items,
            itemId: "item-001",
            edits: { material_cost_per_unit: 2.0 },
        });
        strict_1.default.ok(result.ok);
        const edited = result.editedItem;
        // unit_cost = 2.0 + 8.0 + 1.2 = 11.2
        strict_1.default.ok(Math.abs(edited.unit_cost - 11.2) < 0.01);
        strict_1.default.ok(Math.abs(edited.material_cost_per_unit - 2.0) < 0.01);
    });
});
// ─── addItem ────────────────────────────────────────────────────────────────
(0, node_test_1.describe)("addItem", () => {
    (0, node_test_1.it)("adds an item with calculated subtotals", () => {
        const items = [mockItem()];
        const newItem = mockItem({
            id: "item-new",
            code: "99.NEW.001",
            name: "Partida nueva",
            quantity: 10,
            unit_cost: 50,
            margin_percent: 20,
        });
        const result = (0, budget_edit_1.addItem)({ items, newItem });
        strict_1.default.equal(result.length, 2);
        const added = result[1];
        strict_1.default.equal(added.id, "item-new");
        // unit_price_sale = 50 * 1.20 = 60
        strict_1.default.equal(added.unit_price_sale, 60);
        // subtotal_sale = 10 * 60 = 600
        strict_1.default.equal(added.subtotal_sale, 600);
        // subtotal_cost = 10 * 50 = 500
        strict_1.default.equal(added.subtotal_cost, 500);
    });
    (0, node_test_1.it)("does not modify original array", () => {
        const items = [mockItem()];
        const result = (0, budget_edit_1.addItem)({
            items,
            newItem: mockItem({ id: "item-new" }),
        });
        strict_1.default.equal(items.length, 1);
        strict_1.default.equal(result.length, 2);
    });
});
// ─── removeItem ─────────────────────────────────────────────────────────────
(0, node_test_1.describe)("removeItem", () => {
    (0, node_test_1.it)("removes the specified item", () => {
        const items = mockItems();
        const result = (0, budget_edit_1.removeItem)({ items, itemId: "item-002" });
        strict_1.default.equal(result.length, 2);
        strict_1.default.ok(!result.find((i) => i.id === "item-002"));
    });
    (0, node_test_1.it)("returns all items if id not found", () => {
        const items = mockItems();
        const result = (0, budget_edit_1.removeItem)({ items, itemId: "non-existent" });
        strict_1.default.equal(result.length, 3);
    });
});
// ─── moveItem ───────────────────────────────────────────────────────────────
(0, node_test_1.describe)("moveItem", () => {
    (0, node_test_1.it)("changes item chapter", () => {
        const items = mockItems();
        const result = (0, budget_edit_1.moveItem)(items, "item-001", "pintura");
        const moved = result.find((i) => i.id === "item-001");
        strict_1.default.ok(moved);
        strict_1.default.equal(moved.chapter, "pintura");
    });
    (0, node_test_1.it)("returns original items if id not found", () => {
        const items = mockItems();
        const result = (0, budget_edit_1.moveItem)(items, "non-existent", "pintura");
        strict_1.default.equal(result.length, 3);
    });
});
// ─── calculateEditSummary ───────────────────────────────────────────────────
(0, node_test_1.describe)("calculateEditSummary", () => {
    (0, node_test_1.it)("calculates correct totals", () => {
        const items = mockItems();
        const summary = (0, budget_edit_1.calculateEditSummary)(items);
        strict_1.default.equal(summary.total_items, 3);
        strict_1.default.equal(summary.chapters, 3);
        // total_cost = 436.5 + 810 + 1300 = 2546.5
        strict_1.default.ok(Math.abs(summary.total_cost - 2546.5) < 0.01);
        // total_sale = 545.85 + 1012.5 + 1626 = 3184.35
        strict_1.default.ok(Math.abs(summary.total_sale - 3184.35) < 0.01);
        strict_1.default.ok(summary.avg_confidence > 0);
        strict_1.default.ok(summary.avg_margin > 0);
    });
    (0, node_test_1.it)("returns zeros for empty items", () => {
        const summary = (0, budget_edit_1.calculateEditSummary)([]);
        strict_1.default.equal(summary.total_items, 0);
        strict_1.default.equal(summary.total_cost, 0);
        strict_1.default.equal(summary.total_sale, 0);
        strict_1.default.equal(summary.chapters, 0);
    });
});
