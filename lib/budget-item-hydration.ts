import { generatedPriceBaseline } from "./budget-price-provenance";

/**
 * Rebuilds wizard partidas from the budget_items rows of a budget saved before
 * the wizard stored them in wizard_state. The column pair is the inverse of the
 * one revisionItems() writes: unit_price/subtotal hold the client price and
 * unit_price_cost/subtotal_cost the cost.
 */
export function partidasFromBudgetItems(rows: readonly Record<string, unknown>[]) {
  const number = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const text = (value: unknown, fallback = "") =>
    typeof value === "string" && value.trim() ? value : fallback;
  return rows.map((row, index) => generatedPriceBaseline({
    id: text(row.id, `budget-item-${index}`),
    concept: text(row.concept),
    description: text(row.description),
    quantity: number(row.quantity),
    unit: text(row.unit, "ud"),
    category: text(row.category, "otros"),
    chapter: text(row.chapter, text(row.category, "otros")),
    unit_price: number(row.unit_price_cost),
    subtotal_cost: number(row.subtotal_cost),
    unit_price_client: number(row.unit_price),
    subtotal_client: number(row.subtotal),
    // budget_items only ever receives the non-optional lines.
    status: "incluida" as const,
    price_source_type: text(row.price_source_type) || null,
    price_source: text(row.price_source_type) || undefined,
    price_confidence: row.price_confidence == null ? null : number(row.price_confidence),
    price_checked_at: text(row.price_checked_at) || null,
    price_item_id: text(row.price_item_id) || null,
  }, number(row.unit_price_cost)));
}
