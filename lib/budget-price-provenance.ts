/** Price evidence belongs to the price actually saved, not just the last quote. */
const USER_EDITED_CONFIDENCE = 0.95;
export const AI_ESTIMATE_CONFIDENCE = 0.20;
export const AI_ESTIMATE_LABEL = "Estimación IA · sin fuente técnica";
export const USER_SUPPLIED_CONFIDENCE = 0.95;
export const USER_SUPPLIED_LABEL = "Tu precio · guardado en Precios";

// One definition for provenance reporting. This is NOT an adoption policy:
// market_estimate can improve an AI price while still lacking a verifiable source.
const ESTIMATE_SOURCE_TYPES: ReadonlySet<string | null> = new Set([
  "estimated", "market_estimate", "ai_estimate", null,
]);
export function isEstimateSourceType(sourceType: string | null | undefined): boolean {
  return ESTIMATE_SOURCE_TYPES.has(sourceType || null);
}

export interface PriceProvenanceLine {
  price_source_type?: string | null;
  /** Sale amount before VAT, the same amount displayed and saved per line. */
  subtotal: number;
  status?: string;
}

export function summarizePriceProvenance(lines: readonly PriceProvenanceLine[]) {
  let totalLines = 0, weakLines = 0, totalCents = 0, weakCents = 0;
  for (const line of lines) {
    if (line.status === "opcional") continue;
    const cents = Number.isFinite(line.subtotal) ? Math.round(line.subtotal * 100) : 0;
    totalLines += 1;
    totalCents += cents;
    if (isEstimateSourceType(line.price_source_type)) {
      weakLines += 1;
      weakCents += cents;
    }
  }
  return {
    totalLines, weakLines,
    totalAmount: totalCents / 100,
    weakAmount: weakCents / 100,
    weakPercent: totalCents > 0 ? Math.round(weakCents / totalCents * 1000) / 10 : 0,
  };
}

/** A resolver miss supplies no evidence about the existing price. In particular
 * it must not turn an AI proposal (0.20) into an anonymous fallback (0.05).
 * Keep real and user-edited evidence too. Only an unlabelled/deterministic
 * fallback can be labelled with the resolver's absolute fallback. */
export function evidenceAfterResolverMiss(item: BudgetPriceEvidence, checkedAt: string): BudgetPriceEvidence {
  if (item.price_source_type && item.price_source_type !== "estimated") return item;
  return estimatedPriceEvidence(checkedAt);
}

/** Deterministic safety fallback: no model and no verified price source. */
export function estimatedPriceEvidence(checkedAt: string): PersistedPriceEvidence {
  return { price_source_type: "estimated", price_confidence: 0.05, price_checked_at: checkedAt };
}

/** Capture the generated amount only after automatic geographic/market adjustments. */
export function generatedPriceBaseline<T extends BudgetPriceEvidence>(item: T, price: number): T {
  if (item.resolved_unit_price != null || !item.price_source_type) return item;
  return {
    ...item,
    resolved_unit_price: price,
    resolved_source_type: item.price_source_type,
    resolved_confidence: item.price_confidence,
    resolved_checked_at: item.price_checked_at,
    ...(item.price_item_id ? { resolved_price_item_id: item.price_item_id } : {}),
  };
}

export interface BudgetPriceEvidence {
  price_source_type?: string | null;
  price_confidence?: number | null;
  price_checked_at?: string | null;
  price_item_id?: string | null;
  /** The adopted or generated price, before a person edits the line. */
  resolved_unit_price?: number | null;
  resolved_source_type?: string | null;
  resolved_confidence?: number | null;
  resolved_checked_at?: string | null;
  resolved_price_item_id?: string | null;
}

export interface PersistedPriceEvidence {
  price_source_type: string | null;
  price_confidence: number | null;
  price_checked_at: string | null;
  price_item_id?: string | null;
}

export function resolvedPriceEvidence(
  price: number,
  sourceType: string,
  confidence: number,
  checkedAt: string,
  priceItemId?: string,
): BudgetPriceEvidence {
  return {
    price_source_type: sourceType,
    price_confidence: confidence,
    price_checked_at: checkedAt,
    resolved_unit_price: price,
    resolved_source_type: sourceType,
    resolved_confidence: confidence,
    resolved_checked_at: checkedAt,
    ...(priceItemId ? { price_item_id: priceItemId, resolved_price_item_id: priceItemId } : {}),
  };
}

export function evidenceAfterPriceEdit<T extends BudgetPriceEvidence>(
  item: T,
  newPrice: number,
  editedAt: string,
): T {
  if (item.resolved_unit_price == null && !item.price_source_type) return item;
  if (newPrice === item.resolved_unit_price) {
    return {
      ...item,
      price_source_type: item.resolved_source_type ?? null,
      price_confidence: item.resolved_confidence ?? null,
      price_checked_at: item.resolved_checked_at ?? null,
      ...(item.resolved_price_item_id ? { price_item_id: item.resolved_price_item_id } : {}),
    };
  }
  return {
    ...item,
    price_source_type: "user_edited",
    price_confidence: USER_EDITED_CONFIDENCE,
    price_checked_at: editedAt,
    ...(item.price_item_id ? { price_item_id: null } : {}),
  };
}

export function evidenceForSave(
  item: BudgetPriceEvidence,
  currentUnitPrice?: number,
  savedAt = new Date().toISOString(),
): PersistedPriceEvidence {
  // Defend the persistence boundary too: a recalculation or another editor may
  // have changed the amount without going through the UI's update handler.
  if (item.resolved_unit_price != null && currentUnitPrice !== undefined &&
      currentUnitPrice !== item.resolved_unit_price) {
    return {
      price_source_type: "user_edited",
      price_confidence: USER_EDITED_CONFIDENCE,
      price_checked_at: item.price_source_type === "user_edited"
        ? item.price_checked_at ?? savedAt
        : savedAt,
      ...(item.price_item_id ? { price_item_id: null } : {}),
    };
  }
  return {
    price_source_type: item.price_source_type ?? null,
    price_confidence: item.price_confidence ?? null,
    price_checked_at: item.price_checked_at ?? null,
    ...(item.price_item_id ? { price_item_id: item.price_item_id } : {}),
  };
}
