const TRACEABLE_COMMERCIAL_SOURCES = new Set([
  "n8n_market",
  "provider_updated",
  "preferred_supplier",
  "private_tariff",
  "negotiated",
  "authorized_supplier",
  "web_search",
]);

export interface TraceablePriceCandidate {
  selectedPrice?: number | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  confidenceScore?: number | null;
}

function hasHttpSourceUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * A price may be presented as tracker-verified only when it is a positive,
 * high-confidence commercial observation with a concrete HTTP(S) source.
 * Technical banks, manual locks and estimates remain useful inputs, but are
 * deliberately not labelled as independently verified market evidence.
 */
export function isTraceableCommercialPrice(
  candidate: TraceablePriceCandidate | null | undefined
): boolean {
  return Boolean(
    candidate &&
      Number(candidate.selectedPrice) > 0 &&
      TRACEABLE_COMMERCIAL_SOURCES.has(String(candidate.sourceType || "")) &&
      hasHttpSourceUrl(candidate.sourceUrl) &&
      Number(candidate.confidenceScore || 0) >= 0.75
  );
}
