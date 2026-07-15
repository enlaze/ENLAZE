"use strict";
/**
 * budget-edit.ts
 *
 * Inline editing of budget items.
 *
 * Handles:
 *   1. Single-item edits (quantity, cost, margin, description)
 *   2. Item addition/removal
 *   3. Recalculation of totals after edit
 *   4. Saving edited budget + creating snapshot
 *
 * Uses recalculateItem from budget-economics.ts for math.
 * All edit operations return new arrays (immutable updates).
 * DB persistence is handled by the API route, not here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.editItem = editItem;
exports.addItem = addItem;
exports.removeItem = removeItem;
exports.moveItem = moveItem;
exports.calculateEditSummary = calculateEditSummary;
exports.persistEdit = persistEdit;
const budget_economics_1 = require("./budget-economics");
const budget_snapshot_1 = require("./budget-snapshot");
// ─── Pure edit functions ────────────────────────────────────────────────────
/**
 * Edit a single item in the budget.
 * Returns a new items array with the edited item recalculated.
 *
 * This is a PURE function — no DB access.
 */
function editItem(input) {
    const { items, itemId, edits } = input;
    const idx = items.findIndex((i) => i.id === itemId);
    if (idx === -1) {
        return {
            ok: false,
            items,
            editedItem: null,
            error: `Item ${itemId} no encontrado`,
        };
    }
    const original = items[idx];
    // Apply text fields directly
    const updated = {
        ...original,
        ...(edits.name !== undefined && { name: edits.name }),
        ...(edits.description !== undefined && { description: edits.description }),
        ...(edits.unit !== undefined && { unit: edits.unit }),
        ...(edits.priority !== undefined && { priority: edits.priority }),
        ...(edits.supplier !== undefined && { supplier: edits.supplier }),
    };
    // Apply numeric fields via recalculateItem for correct math
    const hasNumericEdits = edits.quantity !== undefined ||
        edits.unit_cost !== undefined ||
        edits.margin_percent !== undefined ||
        edits.material_cost_per_unit !== undefined ||
        edits.labor_cost_per_unit !== undefined ||
        edits.machinery_cost_per_unit !== undefined;
    const recalculated = hasNumericEdits
        ? (0, budget_economics_1.recalculateItem)(updated, {
            quantity: edits.quantity,
            unit_cost: edits.unit_cost,
            margin_percent: edits.margin_percent,
            material_cost_per_unit: edits.material_cost_per_unit,
            labor_cost_per_unit: edits.labor_cost_per_unit,
            machinery_cost_per_unit: edits.machinery_cost_per_unit,
        })
        : updated;
    const newItems = [...items];
    newItems[idx] = recalculated;
    return {
        ok: true,
        items: newItems,
        editedItem: recalculated,
    };
}
/**
 * Add a new item to the budget.
 * Calculates subtotals based on unit_cost and margin.
 *
 * PURE function.
 */
function addItem(input) {
    const { items, newItem } = input;
    const marginPercent = newItem.margin_percent || 25;
    const unitCost = newItem.unit_cost || 0;
    const unitPriceSale = round2(unitCost * (1 + marginPercent / 100));
    const completeItem = {
        ...newItem,
        unit_price_sale: unitPriceSale,
        subtotal_cost: round2(newItem.quantity * unitCost),
        subtotal_sale: round2(newItem.quantity * unitPriceSale),
    };
    return [...items, completeItem];
}
/**
 * Remove an item from the budget.
 *
 * PURE function.
 */
function removeItem(input) {
    return input.items.filter((i) => i.id !== input.itemId);
}
/**
 * Reorder items within a chapter or move between chapters.
 *
 * PURE function.
 */
function moveItem(items, itemId, targetChapter, targetIndex) {
    const idx = items.findIndex((i) => i.id === itemId);
    if (idx === -1)
        return items;
    const item = { ...items[idx], chapter: targetChapter };
    const remaining = items.filter((i) => i.id !== itemId);
    if (targetIndex !== undefined && targetIndex >= 0 && targetIndex <= remaining.length) {
        remaining.splice(targetIndex, 0, item);
        return remaining;
    }
    // Default: append to end
    return [...remaining, item];
}
// ─── Summary calculation ────────────────────────────────────────────────────
/**
 * Calculate a summary of budget totals from current items.
 *
 * PURE function.
 */
function calculateEditSummary(items) {
    if (items.length === 0) {
        return {
            total_cost: 0,
            total_sale: 0,
            total_items: 0,
            chapters: 0,
            avg_confidence: 0,
            avg_margin: 0,
        };
    }
    const totalCost = items.reduce((sum, i) => sum + i.subtotal_cost, 0);
    const totalSale = items.reduce((sum, i) => sum + i.subtotal_sale, 0);
    const avgConfidence = items.reduce((sum, i) => sum + i.confidence_score, 0) / items.length;
    const avgMargin = items.reduce((sum, i) => sum + i.margin_percent, 0) / items.length;
    const chapters = new Set(items.map((i) => i.chapter)).size;
    return {
        total_cost: round2(totalCost),
        total_sale: round2(totalSale),
        total_items: items.length,
        chapters,
        avg_confidence: round2(avgConfidence),
        avg_margin: round2(avgMargin),
    };
}
// ─── Persistence ────────────────────────────────────────────────────────────
/**
 * Save edited items to DB and create a snapshot.
 *
 * Steps:
 *   1. Update budget_items in DB (delete old + insert new)
 *   2. Update budget totals
 *   3. Create snapshot with type "edited"
 *
 * Returns the new snapshot version.
 */
async function persistEdit(supabase, input) {
    const { budgetId, items, scope, preferences, economics, timeline, validation } = input;
    // Calculate new totals
    const subtotal = items.reduce((sum, i) => sum + i.subtotal_sale, 0);
    const ivaPercent = preferences.tax_percent;
    const ivaAmount = subtotal * (ivaPercent / 100);
    const total = subtotal + ivaAmount;
    // 1. Update budget totals
    const { error: budgetError } = await supabase
        .from("budgets")
        .update({
        subtotal: round2(subtotal),
        iva_amount: round2(ivaAmount),
        total: round2(total),
        economics,
        timeline,
        validation,
        // version is incremented by snapshot creation
    })
        .eq("id", budgetId);
    if (budgetError) {
        return {
            ok: false,
            snapshotVersion: 0,
            error: `Error actualizando presupuesto: ${budgetError.message}`,
        };
    }
    // 2. Replace budget items (delete + insert)
    const { error: deleteError } = await supabase
        .from("budget_items")
        .delete()
        .eq("budget_id", budgetId);
    if (deleteError) {
        return {
            ok: false,
            snapshotVersion: 0,
            error: `Error eliminando partidas antiguas: ${deleteError.message}`,
        };
    }
    const itemRows = items.map((item, idx) => ({
        budget_id: budgetId,
        concept: item.name,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unit_price: item.unit_price_sale,
        subtotal: item.subtotal_sale,
        chapter: item.chapter,
        sort_order: idx,
        metadata: {
            code: item.code,
            trade: item.trade,
            priority: item.priority,
            unit_cost: item.unit_cost,
            subtotal_cost: item.subtotal_cost,
            material_cost_per_unit: item.material_cost_per_unit,
            labor_cost_per_unit: item.labor_cost_per_unit,
            labor_hours_per_unit: item.labor_hours_per_unit,
            machinery_cost_per_unit: item.machinery_cost_per_unit,
            margin_percent: item.margin_percent,
            confidence_score: item.confidence_score,
            price_source: item.price_source,
            price_source_detail: item.price_source_detail,
            supplier: item.supplier,
            materials: item.materials,
            quantity_calculation: item.quantity_calculation,
            dependencies: item.dependencies,
        },
    }));
    // Insert in batches of 50
    for (let i = 0; i < itemRows.length; i += 50) {
        const batch = itemRows.slice(i, i + 50);
        const { error: insertError } = await supabase
            .from("budget_items")
            .insert(batch);
        if (insertError) {
            console.error(`[BudgetEdit] Error inserting items batch ${i}-${i + batch.length}:`, insertError.message);
        }
    }
    // 3. Create snapshot
    const snapshotResult = await (0, budget_snapshot_1.createSnapshot)(supabase, {
        budgetId,
        snapshotType: "edited",
        items,
        scope,
        preferences,
        economics,
        timeline,
        validation,
    });
    if (!snapshotResult.ok) {
        return {
            ok: false,
            snapshotVersion: 0,
            error: `Error creando snapshot: ${snapshotResult.error}`,
        };
    }
    return {
        ok: true,
        snapshotVersion: snapshotResult.version,
    };
}
// ─── Helpers ────────────────────────────────────────────────────────────────
function round2(n) {
    return Math.round(n * 100) / 100;
}
