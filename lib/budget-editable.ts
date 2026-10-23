/**
 * Estados en los que un presupuesto todavía se puede modificar como borrador.
 * Es la misma lista que comprueba la base en budget_internal.save_core
 * (supabase/migrations/20260915160000_budget_revision_rpcs.sql): fuera de
 * ella, guardar falla con «Use the contractual revision flow for this budget».
 * La interfaz no debe ofrecer cambios que la base va a rechazar.
 */
export const DRAFT_EDITABLE_BUDGET_STATUSES: readonly string[] = ["borrador", "draft", "pendiente", "pending"];

export function isBudgetEditableAsDraft(status: string | null | undefined): boolean {
  return !!status && DRAFT_EDITABLE_BUDGET_STATUSES.includes(status);
}
