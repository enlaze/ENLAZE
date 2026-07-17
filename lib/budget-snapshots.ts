/**
 * budget-snapshots.ts
 *
 * Create, list, and diff budget snapshots.
 *
 * A snapshot captures the full state of a budget's items at a point in time.
 * Three snapshot types:
 *   - generated: auto-created after budget generation
 *   - edited:    created when user saves manual edits
 *   - repriced:  created after a reprice run
 *
 * Diff compares two snapshots and highlights:
 *   - Added/removed items
 *   - Price changes (unit_cost)
 *   - Source changes (price_source)
 *   - Quantity changes
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BudgetItemV2, SnapshotType } from "./types/budget-v2";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SnapshotRow {
  id: string;
  budget_id: string;
  user_id: string;
  version: number;
  snapshot_type: SnapshotType;
  label: string | null;
  items_data: BudgetItemV2[];
  summary_data: Record<string, unknown>;
  analysis_data: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  resolver_used: "v1" | "v2";
  total_items: number;
  total_cost: number;
  total_sale: number;
  avg_confidence: number;
  created_at: string;
}

export interface CreateSnapshotInput {
  budget_id: string;
  user_id: string;
  snapshot_type: SnapshotType;
  label?: string;
  items: BudgetItemV2[];
  summary?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  resolver_used?: "v1" | "v2";
  metadata?: Record<string, unknown>;
}

export interface SnapshotListItem {
  id: string;
  version: number;
  snapshot_type: SnapshotType;
  label: string | null;
  total_items: number;
  total_cost: number;
  total_sale: number;
  avg_confidence: number;
  resolver_used: string;
  created_at: string;
}

// ─── Diff types ──────────────────────────────────────────────────────────────

export interface ItemDiff {
  name: string;
  chapter: string;
  change_type: "added" | "removed" | "modified" | "unchanged";
  changes: FieldChange[];
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
  delta?: number;
  delta_pct?: number;
}

export interface SnapshotDiff {
  from_version: number;
  to_version: number;
  from_type: SnapshotType;
  to_type: SnapshotType;
  items_added: number;
  items_removed: number;
  items_modified: number;
  items_unchanged: number;
  cost_delta: number;
  cost_delta_pct: number;
  sale_delta: number;
  diffs: ItemDiff[];
}

// ─── Create snapshot ─────────────────────────────────────────────────────────

export async function createSnapshot(
  supabase: SupabaseClient,
  input: CreateSnapshotInput
): Promise<{ ok: boolean; snapshot_id: string | null; version: number; error?: string }> {
  // Get next version number
  const { data: lastSnapshot } = await supabase
    .from("budget_snapshots")
    .select("version")
    .eq("budget_id", input.budget_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (lastSnapshot?.version ?? 0) + 1;

  // Calculate summary stats
  const totalCost = input.items.reduce((sum, i) => sum + (i.subtotal_cost || 0), 0);
  const totalSale = input.items.reduce((sum, i) => sum + (i.subtotal_sale || 0), 0);
  const avgConfidence = input.items.length > 0
    ? input.items.reduce((sum, i) => sum + (i.confidence_score || 0), 0) / input.items.length
    : 0;

  const { data, error } = await supabase
    .from("budget_snapshots")
    .insert({
      budget_id: input.budget_id,
      user_id: input.user_id,
      version: nextVersion,
      snapshot_type: input.snapshot_type,
      label: input.label ?? null,
      items_data: input.items,
      summary_data: input.summary ?? {},
      analysis_data: input.analysis ?? null,
      metadata: input.metadata ?? {},
      resolver_used: input.resolver_used ?? "v1",
      total_items: input.items.length,
      total_cost: Math.round(totalCost * 100) / 100,
      total_sale: Math.round(totalSale * 100) / 100,
      avg_confidence: Math.round(avgConfidence * 100) / 100,
    })
    .select("id, version")
    .single();

  if (error || !data) {
    return { ok: false, snapshot_id: null, version: 0, error: error?.message };
  }

  return { ok: true, snapshot_id: data.id, version: data.version };
}

// ─── List snapshots ──────────────────────────────────────────────────────────

export async function listSnapshots(
  supabase: SupabaseClient,
  budgetId: string
): Promise<SnapshotListItem[]> {
  const { data } = await supabase
    .from("budget_snapshots")
    .select("id, version, snapshot_type, label, total_items, total_cost, total_sale, avg_confidence, resolver_used, created_at")
    .eq("budget_id", budgetId)
    .order("version", { ascending: false });

  return (data || []) as SnapshotListItem[];
}

// ─── Get snapshot ────────────────────────────────────────────────────────────

export async function getSnapshot(
  supabase: SupabaseClient,
  snapshotId: string
): Promise<SnapshotRow | null> {
  const { data } = await supabase
    .from("budget_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .single();

  return data as SnapshotRow | null;
}

// ─── Diff two snapshots ──────────────────────────────────────────────────────

/**
 * Compare two snapshots and return a structured diff.
 * Pure function: works on the items arrays.
 */
export function diffSnapshots(
  from: SnapshotRow,
  to: SnapshotRow
): SnapshotDiff {
  const fromItems = from.items_data || [];
  const toItems = to.items_data || [];

  // Index by name (primary key for items)
  const fromMap = new Map<string, BudgetItemV2>();
  for (const item of fromItems) {
    fromMap.set(item.name, item);
  }

  const toMap = new Map<string, BudgetItemV2>();
  for (const item of toItems) {
    toMap.set(item.name, item);
  }

  const diffs: ItemDiff[] = [];
  let added = 0;
  let removed = 0;
  let modified = 0;
  let unchanged = 0;

  // Check items in "to" snapshot
  for (const [name, toItem] of toMap) {
    const fromItem = fromMap.get(name);

    if (!fromItem) {
      // Added
      added++;
      diffs.push({
        name,
        chapter: toItem.chapter,
        change_type: "added",
        changes: [],
      });
      continue;
    }

    // Compare fields
    const changes = compareItems(fromItem, toItem);

    if (changes.length > 0) {
      modified++;
      diffs.push({
        name,
        chapter: toItem.chapter,
        change_type: "modified",
        changes,
      });
    } else {
      unchanged++;
    }
  }

  // Check removed items
  for (const [name, fromItem] of fromMap) {
    if (!toMap.has(name)) {
      removed++;
      diffs.push({
        name,
        chapter: fromItem.chapter,
        change_type: "removed",
        changes: [],
      });
    }
  }

  // Sort diffs: removed first, then modified, then added
  const order = { removed: 0, modified: 1, added: 2, unchanged: 3 };
  diffs.sort((a, b) => order[a.change_type] - order[b.change_type]);

  const costDelta = to.total_cost - from.total_cost;
  const costDeltaPct = from.total_cost > 0
    ? (costDelta / from.total_cost) * 100
    : 0;

  return {
    from_version: from.version,
    to_version: to.version,
    from_type: from.snapshot_type,
    to_type: to.snapshot_type,
    items_added: added,
    items_removed: removed,
    items_modified: modified,
    items_unchanged: unchanged,
    cost_delta: Math.round(costDelta * 100) / 100,
    cost_delta_pct: Math.round(costDeltaPct * 100) / 100,
    sale_delta: Math.round((to.total_sale - from.total_sale) * 100) / 100,
    diffs,
  };
}

// ─── Field comparison ────────────────────────────────────────────────────────

const TRACKED_FIELDS: (keyof BudgetItemV2)[] = [
  "quantity",
  "unit_cost",
  "unit_price_sale",
  "subtotal_cost",
  "subtotal_sale",
  "confidence_score",
  "price_source",
  "price_source_detail",
  "supplier",
  "unit",
];

function compareItems(from: BudgetItemV2, to: BudgetItemV2): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const field of TRACKED_FIELDS) {
    const beforeVal = from[field];
    const afterVal = to[field];

    if (beforeVal === afterVal) continue;
    if (beforeVal == null && afterVal == null) continue;

    const change: FieldChange = {
      field,
      before: beforeVal,
      after: afterVal,
    };

    // Calculate delta for numeric fields
    if (typeof beforeVal === "number" && typeof afterVal === "number") {
      change.delta = Math.round((afterVal - beforeVal) * 100) / 100;
      change.delta_pct = beforeVal > 0
        ? Math.round(((afterVal - beforeVal) / beforeVal) * 10000) / 100
        : 0;
    }

    changes.push(change);
  }

  return changes;
}
