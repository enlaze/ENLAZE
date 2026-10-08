/** Price evidence belongs to the price actually saved, not just the last quote. */
const USER_EDITED_CONFIDENCE = 0.95;

export interface BudgetPriceEvidence {
  price_source_type?: string | null;
  price_confidence?: number | null;
  price_checked_at?: string | null;
  /** The adopted resolver price, before a person edits the line. */
  resolved_unit_price?: number | null;
  resolved_source_type?: string | null;
  resolved_confidence?: number | null;
  resolved_checked_at?: string | null;
}

export interface PersistedPriceEvidence {
  price_source_type: string | null;
  price_confidence: number | null;
  price_checked_at: string | null;
}

export function resolvedPriceEvidence(
  price: number,
  sourceType: string,
  confidence: number,
  checkedAt: string,
): BudgetPriceEvidence {
  return {
    price_source_type: sourceType,
    price_confidence: confidence,
    price_checked_at: checkedAt,
    resolved_unit_price: price,
    resolved_source_type: sourceType,
    resolved_confidence: confidence,
    resolved_checked_at: checkedAt,
  };
}

export function evidenceAfterPriceEdit<T extends BudgetPriceEvidence>(
  item: T,
  newPrice: number,
  editedAt: string,
): T {
  if (item.resolved_unit_price == null) return item;
  if (newPrice === item.resolved_unit_price) {
    return {
      ...item,
      price_source_type: item.resolved_source_type ?? null,
      price_confidence: item.resolved_confidence ?? null,
      price_checked_at: item.resolved_checked_at ?? null,
    };
  }
  return {
    ...item,
    price_source_type: "user_edited",
    price_confidence: USER_EDITED_CONFIDENCE,
    price_checked_at: editedAt,
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
    };
  }
  return {
    price_source_type: item.price_source_type ?? null,
    price_confidence: item.price_confidence ?? null,
    price_checked_at: item.price_checked_at ?? null,
  };
}
