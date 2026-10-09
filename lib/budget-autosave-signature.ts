/**
 * State that is allowed to trigger a budget autosave.
 *
 * Keep this as an allowlist. BudgetState also contains loading flags, errors,
 * fetched catalogues, analysis diagnostics and document views that change as a
 * consequence of rendering or recalculation. Those fields are persisted with
 * the next real edit, but they must never start a write by themselves.
 */
export const BUDGET_AUTOSAVE_EDITABLE_KEYS = [
  "currentStep",
  "sector",
  "title",
  "clientId",
  "clientName",
  "clientEmail",
  "clientPhone",
  "clientCompany",
  "projectId",
  "serviceType",
  "startDate",
  "description",
  "validUntil",
  "depositPercent",
  "paymentMethod",
  "paymentIban",
  "discountType",
  "discountPercent",
  "discountAmount",
  "paymentSchedule",
  "warrantyText",
  "executionDeadlineText",
  "observations",
  "conditionsText",
  "internalNotes",
  "ivaPercent",
  "marginPercent",
  "sectorData",
  "partidas",
  "selectedProviderId",
  "materials",
  "useSuggestedMaterials",
] as const;

export type BudgetAutosaveEditableKey = typeof BUDGET_AUTOSAVE_EDITABLE_KEYS[number];
type BudgetAutosaveSource = Record<BudgetAutosaveEditableKey, unknown>;

// A later lookup may refresh evidence without changing the line or its price.
// Evidence is persisted with the next real edit, never a reason to autosave.
const PRICE_EVIDENCE_KEYS = new Set([
  "price_source_type", "price_confidence", "price_checked_at",
  "resolved_unit_price", "resolved_source_type", "resolved_confidence", "resolved_checked_at",
  "price_source", "confidence_score", "price_source_detail",
  "sourceType", "confidenceScore", "priceCheckedAt",
]);

/** Stable fingerprint of only the state that may legitimately start a save. */
export function buildAutosaveSignature<T extends BudgetAutosaveSource>(state: T): string {
  const editable = Object.fromEntries(
    BUDGET_AUTOSAVE_EDITABLE_KEYS.map((key) => [key, state[key]]),
  );

  try {
    return JSON.stringify(editable, (key, value) => PRICE_EVIDENCE_KEYS.has(key) ? undefined : value);
  } catch {
    // Never fall back to an always-changing value: that would restart the loop.
    return "__unserializable__";
  }
}
