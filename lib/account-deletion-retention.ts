/**
 * Only issued invoices that have left the editable draft state are fiscal
 * documents. Cancelled and rectified invoices remain definitive records and
 * must keep their lines and audit trail.
 */
export const FISCALLY_DEFINITIVE_ISSUED_INVOICE_STATUSES = [
  "issued",
  "sent",
  "paid",
  "overdue",
  "cancelled",
  "rectified",
] as const;

const definitiveStatuses = new Set<string>(
  FISCALLY_DEFINITIVE_ISSUED_INVOICE_STATUSES
);

export function isFiscallyDefinitiveIssuedInvoiceStatus(
  status: unknown
): boolean {
  return typeof status === "string" && definitiveStatuses.has(status);
}

/**
 * Durable account-deletion checkpoint stored in protected Auth app_metadata.
 * It survives a failed Auth deletion and tells a retry that destructive data
 * and Storage cleanup already completed, so the retry must only clear fiscal
 * owner markers and remove the Auth user.
 */
export const ACCOUNT_DELETION_PHASE_METADATA_KEY =
  "enlaze_account_deletion_phase";
export const ACCOUNT_DELETION_CLEANUP_COMPLETE = "cleanup_complete_v1";

export function isAccountDeletionCleanupComplete(
  appMetadata: unknown
): boolean {
  if (!appMetadata || typeof appMetadata !== "object") return false;
  return (
    (appMetadata as Record<string, unknown>)[
      ACCOUNT_DELETION_PHASE_METADATA_KEY
    ] === ACCOUNT_DELETION_CLEANUP_COMPLETE
  );
}

export function markAccountDeletionCleanupComplete(
  appMetadata: unknown
): Record<string, unknown> {
  const current =
    appMetadata && typeof appMetadata === "object"
      ? (appMetadata as Record<string, unknown>)
      : {};
  return {
    ...current,
    [ACCOUNT_DELETION_PHASE_METADATA_KEY]: ACCOUNT_DELETION_CLEANUP_COMPLETE,
  };
}
