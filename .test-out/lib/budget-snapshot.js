"use strict";
/**
 * budget-snapshot.ts
 *
 * Creates, reads, and compares budget snapshots.
 *
 * A snapshot captures the full state of a budget at a point in time:
 *   - Client view (what the client sees)
 *   - Internal view (full escandallo)
 *   - Economics (cost breakdown)
 *   - Timeline (planning)
 *   - Validation report
 *
 * Snapshots are stored in the `budget_snapshots` table.
 * The version number auto-increments per budget.
 *
 * Comparison: produces a diff between two snapshots showing:
 *   - Items added/removed/changed
 *   - Price changes with percentages
 *   - Total impact
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSnapshot = createSnapshot;
exports.listSnapshots = listSnapshots;
exports.getSnapshot = getSnapshot;
exports.compareSnapshots = compareSnapshots;
exports.persistBudget = persistBudget;
const budget_views_v2_1 = require("./budget-views-v2");
// ─── Create snapshot ────────────────────────────────────────────────────────
/**
 * Create a new snapshot for a budget.
 * Auto-increments the version number.
 * Builds client and internal views from the items.
 */
async function createSnapshot(supabase, input) {
    // Get the next version number
    const { data: lastSnapshot } = await supabase
        .from("budget_snapshots")
        .select("version")
        .eq("budget_id", input.budgetId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
    const nextVersion = (lastSnapshot?.version ?? 0) + 1;
    // Build views
    const clientView = (0, budget_views_v2_1.buildClientViewV2)({
        items: input.items,
        scope: input.scope,
        preferences: input.preferences,
        company: input.company,
    });
    const internalView = (0, budget_views_v2_1.buildInternalViewV2)({
        items: input.items,
        economics: input.economics,
        timeline: input.timeline,
        preferences: input.preferences,
    });
    // Insert snapshot
    const { data, error } = await supabase
        .from("budget_snapshots")
        .insert({
        budget_id: input.budgetId,
        version: nextVersion,
        snapshot_type: input.snapshotType,
        client_view: clientView,
        internal_view: internalView,
        economics: input.economics || {},
        timeline: input.timeline || null,
        validation: input.validation || null,
    })
        .select("id")
        .single();
    if (error) {
        return {
            ok: false,
            snapshotId: "",
            version: nextVersion,
            error: `Failed to create snapshot: ${error.message}`,
        };
    }
    return {
        ok: true,
        snapshotId: data.id,
        version: nextVersion,
    };
}
// ─── Read snapshots ─────────────────────────────────────────────────────────
/**
 * List all snapshots for a budget (summary only, no full views).
 */
async function listSnapshots(supabase, budgetId) {
    const { data, error } = await supabase
        .from("budget_snapshots")
        .select("id, version, snapshot_type, economics, internal_view, created_at")
        .eq("budget_id", budgetId)
        .order("version", { ascending: false });
    if (error || !data)
        return [];
    return data.map((row) => {
        const economics = row.economics;
        const internalView = row.internal_view;
        const itemsCount = internalView?.chapters?.reduce((sum, ch) => sum + ch.items.length, 0) ?? 0;
        return {
            id: row.id,
            version: row.version,
            snapshot_type: row.snapshot_type,
            total_sale: economics?.cost_breakdown?.total_sale_price ?? 0,
            total_cost: economics?.cost_breakdown?.total_cost ?? 0,
            items_count: itemsCount,
            created_at: row.created_at,
        };
    });
}
/**
 * Get a specific snapshot with full views.
 */
async function getSnapshot(supabase, budgetId, version) {
    const { data, error } = await supabase
        .from("budget_snapshots")
        .select("*")
        .eq("budget_id", budgetId)
        .eq("version", version)
        .maybeSingle();
    if (error || !data)
        return null;
    return {
        budget_id: data.budget_id,
        version: data.version,
        snapshot_type: data.snapshot_type,
        client_view: data.client_view,
        internal_view: data.internal_view,
        economics: data.economics,
        timeline: data.timeline,
        validation: data.validation,
        created_at: data.created_at,
    };
}
// ─── Compare snapshots ──────────────────────────────────────────────────────
/**
 * Compare two snapshots of the same budget.
 * Returns a diff showing items added, removed, and changed.
 *
 * This is a PURE function — no DB access.
 * Caller must provide the two ClientView objects.
 */
function compareSnapshots(viewA, viewB, versionA, versionB) {
    // Flatten items from chapters
    const itemsA = new Map();
    for (const ch of viewA.chapters) {
        for (const item of ch.items) {
            itemsA.set(item.code, {
                code: item.code,
                name: item.name,
                chapter: ch.name,
                unit: item.unit,
                quantity: item.quantity,
                unit_price: item.unit_price,
                subtotal: item.subtotal,
            });
        }
    }
    const itemsB = new Map();
    for (const ch of viewB.chapters) {
        for (const item of ch.items) {
            itemsB.set(item.code, {
                code: item.code,
                name: item.name,
                chapter: ch.name,
                unit: item.unit,
                quantity: item.quantity,
                unit_price: item.unit_price,
                subtotal: item.subtotal,
            });
        }
    }
    const added = [];
    const removed = [];
    const changed = [];
    // Items in B but not in A = added
    for (const [code, item] of itemsB) {
        if (!itemsA.has(code)) {
            added.push(item);
        }
    }
    // Items in A but not in B = removed
    for (const [code, item] of itemsA) {
        if (!itemsB.has(code)) {
            removed.push(item);
        }
    }
    // Items in both = check for changes
    for (const [code, itemA] of itemsA) {
        const itemB = itemsB.get(code);
        if (!itemB)
            continue;
        const priceChanged = Math.abs(itemA.unit_price - itemB.unit_price) > 0.01;
        const qtyChanged = Math.abs(itemA.quantity - itemB.quantity) > 0.001;
        if (priceChanged || qtyChanged) {
            const priceDiffPct = itemA.unit_price > 0
                ? ((itemB.unit_price - itemA.unit_price) / itemA.unit_price) * 100
                : itemB.unit_price > 0 ? 100 : 0;
            changed.push({
                code,
                name: itemB.name,
                chapter: itemB.chapter,
                quantity_before: itemA.quantity,
                quantity_after: itemB.quantity,
                unit_price_before: itemA.unit_price,
                unit_price_after: itemB.unit_price,
                subtotal_before: itemA.subtotal,
                subtotal_after: itemB.subtotal,
                price_diff_pct: Math.round(priceDiffPct * 100) / 100,
            });
        }
    }
    const totalBefore = viewA.total;
    const totalAfter = viewB.total;
    const totalDiff = totalAfter - totalBefore;
    const totalDiffPct = totalBefore > 0
        ? ((totalDiff / totalBefore) * 100)
        : totalAfter > 0 ? 100 : 0;
    return {
        version_a: versionA,
        version_b: versionB,
        items_added: added,
        items_removed: removed,
        items_changed: changed,
        total_before: Math.round(totalBefore * 100) / 100,
        total_after: Math.round(totalAfter * 100) / 100,
        total_diff: Math.round(totalDiff * 100) / 100,
        total_diff_pct: Math.round(totalDiffPct * 100) / 100,
    };
}
/**
 * Persist a generated budget to the database.
 *
 * 1. INSERT into `budgets` table
 * 2. INSERT items into `budget_items` table
 * 3. Create initial snapshot (version 1, type "generated")
 *
 * Returns the budget ID and snapshot ID.
 */
async function persistBudget(supabase, input) {
    const { userId, scope, preferences, items, analysis, economics, timeline, validation } = input;
    // Calculate totals
    const subtotal = items.reduce((sum, i) => sum + i.subtotal_sale, 0);
    const ivaPercent = preferences.tax_percent;
    const ivaAmount = subtotal * (ivaPercent / 100);
    const total = subtotal + ivaAmount;
    // Generate budget number
    const budgetNumber = `PRE-${Date.now().toString(36).toUpperCase()}`;
    // 1. Insert budget
    const { data: budget, error: budgetError } = await supabase
        .from("budgets")
        .insert({
        user_id: userId,
        budget_number: budgetNumber,
        title: scope.description || `${scope.project_type} - ${scope.surface_m2}m2`,
        service_type: scope.project_type,
        status: "borrador",
        subtotal: Math.round(subtotal * 100) / 100,
        iva_percent: ivaPercent,
        iva_amount: Math.round(ivaAmount * 100) / 100,
        total: Math.round(total * 100) / 100,
        client_name: scope.client?.name || null,
        client_email: scope.client?.email || null,
        client_phone: scope.client?.phone || null,
        client_address: scope.client?.address || null,
        client_nif: scope.client?.nif || null,
        // V2 columns
        analysis,
        economics,
        timeline,
        validation,
        version: 1,
        quality_tier: preferences.quality,
        scope_data: scope,
    })
        .select("id")
        .single();
    if (budgetError || !budget) {
        return {
            ok: false,
            budgetId: "",
            snapshotId: "",
            version: 0,
            error: `Failed to create budget: ${budgetError?.message}`,
        };
    }
    const budgetId = budget.id;
    // 2. Insert budget items
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
        // Additional v2 data stored as jsonb
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
        const { error: itemsError } = await supabase
            .from("budget_items")
            .insert(batch);
        if (itemsError) {
            console.error(`[PersistBudget] Error inserting items batch ${i}-${i + batch.length}:`, itemsError.message);
        }
    }
    // 3. Create initial snapshot
    const snapshotResult = await createSnapshot(supabase, {
        budgetId,
        snapshotType: "generated",
        items,
        scope,
        preferences,
        economics,
        timeline,
        validation,
    });
    if (!snapshotResult.ok) {
        console.error("[PersistBudget] Snapshot creation failed:", snapshotResult.error);
    }
    return {
        ok: true,
        budgetId,
        snapshotId: snapshotResult.snapshotId || "",
        version: snapshotResult.version,
    };
}
