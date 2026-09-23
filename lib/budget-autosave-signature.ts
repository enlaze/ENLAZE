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

/** Stable fingerprint of only the state that may legitimately start a save. */
export function buildAutosaveSignature<T extends BudgetAutosaveSource>(state: T): string {
  const editable = Object.fromEntries(
    BUDGET_AUTOSAVE_EDITABLE_KEYS.map((key) => [key, state[key]]),
  );

  try {
    return JSON.stringify(editable);
  } catch {
    // Never fall back to an always-changing value: that would restart the loop.
    return "__unserializable__";
  }
}
