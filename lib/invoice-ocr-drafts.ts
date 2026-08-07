export const RETAINED_INVOICE_BUCKET = "received-invoice-documents";

export interface OcrDraftLocation {
  objectPath: string;
  fileName: string;
}

function isSafeObjectSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    /^[a-zA-Z0-9._-]+$/.test(value)
  );
}

export function retainedInvoiceStorageUrl(objectPath: string): string {
  return `storage://${RETAINED_INVOICE_BUCKET}/${objectPath}`;
}

/**
 * Resolve only an unconfirmed OCR object belonging to the authenticated user.
 * The strict single-segment filename also rejects encoded URLs, traversal and
 * attempts to target a confirmed fiscal document.
 */
export function parseOwnedOcrDraftUrl(
  rawUrl: unknown,
  userId: string
): OcrDraftLocation | null {
  if (typeof rawUrl !== "string" || !userId) return null;

  const prefix = retainedInvoiceStorageUrl(`${userId}/drafts/`);
  if (!rawUrl.startsWith(prefix)) return null;

  const fileName = rawUrl.slice(prefix.length);
  if (!isSafeObjectSegment(fileName)) return null;

  return {
    objectPath: `${userId}/drafts/${fileName}`,
    fileName,
  };
}

export function buildConfirmedInvoiceDocument(
  userId: string,
  invoiceId: string,
  fileName: string
): { objectPath: string; storageUrl: string } | null {
  if (
    !userId ||
    !/^[0-9a-f-]{36}$/i.test(invoiceId) ||
    !isSafeObjectSegment(fileName)
  ) {
    return null;
  }

  const objectPath = `${userId}/confirmed/${invoiceId}/${fileName}`;
  return { objectPath, storageUrl: retainedInvoiceStorageUrl(objectPath) };
}

/**
 * Deterministic private destination for a received-invoice document found
 * living in the legacy public `invoices` bucket. Kept under its own
 * `legacy/` prefix, distinct from `confirmed/`, so migrated files can never
 * collide with an OCR-promoted document for the same invoice id.
 */
export function buildLegacyReceivedInvoiceDocument(
  userId: string,
  invoiceId: string,
  fileName: string
): { objectPath: string; storageUrl: string } | null {
  if (
    !userId ||
    !/^[0-9a-f-]{36}$/i.test(invoiceId) ||
    !isSafeObjectSegment(fileName)
  ) {
    return null;
  }

  const objectPath = `${userId}/legacy/${invoiceId}/${fileName}`;
  return { objectPath, storageUrl: retainedInvoiceStorageUrl(objectPath) };
}

export function isConfirmedInvoiceDocumentUrl(
  rawUrl: unknown,
  userId: string,
  invoiceId: string
): boolean {
  return parseConfirmedInvoiceDocumentUrl(rawUrl, userId, invoiceId) !== null;
}

/**
 * Resolve an immutable OCR document only when its owner and invoice id match
 * the retained fiscal row. Malformed and orphaned objects are never retained.
 */
export function parseConfirmedInvoiceDocumentUrl(
  rawUrl: unknown,
  userId: string,
  invoiceId: string
): OcrDraftLocation | null {
  if (
    typeof rawUrl !== "string" ||
    !userId ||
    !/^[0-9a-f-]{36}$/i.test(invoiceId)
  ) {
    return null;
  }
  const prefix = retainedInvoiceStorageUrl(
    `${userId}/confirmed/${invoiceId}/`
  );
  const fileName = rawUrl.startsWith(prefix) ? rawUrl.slice(prefix.length) : "";
  if (!isSafeObjectSegment(fileName)) return null;

  return {
    objectPath: `${userId}/confirmed/${invoiceId}/${fileName}`,
    fileName,
  };
}

/**
 * Resolve the exact retained object referenced by a stable received-invoice
 * row. A draft can legitimately remain referenced when account deletion
 * fences an in-flight promotion before its compare-and-set update. In that
 * case the draft itself is the only fiscal source document and must survive.
 */
export function parseRetainedReceivedInvoiceDocumentUrl(
  rawUrl: unknown,
  userId: string,
  invoiceId: string
): OcrDraftLocation | null {
  return (
    parseConfirmedInvoiceDocumentUrl(rawUrl, userId, invoiceId) ??
    parseOwnedOcrDraftUrl(rawUrl, userId)
  );
}
