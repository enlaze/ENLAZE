import {
  evaluateCommercialProductMatch,
  isProductSpecificSourceUrl,
} from "./commercial-product-match";

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
  materialName?: string | null;
  selectedProductName?: string | null;
  unit?: string | null;
  requestedUnit?: string | null;
  sourceUnit?: string | null;
  referenceUnitPrice?: number | null;
  unitsPerPackage?: number | null;
  matchScore?: number | null;
  evidenceVerified?: boolean | null;
  evidenceType?: string | null;
  evidenceVerification?: string | null;
}

const VERIFIED_CATALOG_EVIDENCE = new Map([
  ["official_bc3_catalog", "official_catalog_sku_raw_price_sha256"],
  ["official_pdf_catalog", "official_catalog_sku_source_url_raw_price_sha256"],
  ["authorized_price_tariff", "authorized_tariff_sku_raw_price_sha256"],
]);

export function hasVerifiedCatalogEvidence(
  candidate: Pick<
    TraceablePriceCandidate,
    "evidenceVerified" | "evidenceType" | "evidenceVerification"
  > | null | undefined
): boolean {
  if (!candidate?.evidenceVerified) return false;
  const evidenceType = String(candidate.evidenceType || "");
  return VERIFIED_CATALOG_EVIDENCE.get(evidenceType) ===
    String(candidate.evidenceVerification || "");
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
  if (
    !candidate ||
    Number(candidate.selectedPrice) <= 0 ||
    !TRACEABLE_COMMERCIAL_SOURCES.has(String(candidate.sourceType || "")) ||
    !(
      isProductSpecificSourceUrl(candidate.sourceUrl) ||
      hasVerifiedCatalogEvidence(candidate)
    ) ||
    Number(candidate.confidenceScore || 0) < 0.75
  ) {
    return false;
  }

  if (typeof candidate.matchScore === "number" && candidate.matchScore < 0.8) {
    return false;
  }

  // New resolver responses provide both names and both units. Re-run the
  // pure gate here so UI coverage cannot be inflated by stale flags.
  if (
    candidate.materialName &&
    candidate.selectedProductName &&
    (candidate.requestedUnit || candidate.unit) &&
    candidate.sourceUnit
  ) {
    return evaluateCommercialProductMatch({
      requestedName: candidate.materialName,
      candidateName: candidate.selectedProductName,
      requestedUnit: candidate.requestedUnit || candidate.unit,
      candidateUnit: candidate.sourceUnit,
      unitsPerPackage: candidate.unitsPerPackage,
      referenceUnitPrice: candidate.referenceUnitPrice,
      candidateUnitPrice: candidate.selectedPrice,
    }).isExact;
  }

  // Backwards compatibility for older call sites that only carry evidence
  // metadata. New budget and comparison paths always provide match details.
  return true;
}
