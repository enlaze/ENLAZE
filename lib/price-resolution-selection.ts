import type {
  PriceAlternative,
  PriceRequest,
  ResolvedPrice,
} from "./price-resolver";
import { isTraceableCommercialPrice } from "./price-traceability";

const USER_CONTROLLED_SOURCES = new Set([
  "user_catalog",
  "manual_locked",
  "private_tariff",
  "negotiated",
  "historical_approved",
]);

function alternativePrice(alternative: PriceAlternative): number {
  const effective = Number(alternative.effectivePrice);
  return Number.isFinite(effective) && effective > 0
    ? effective
    : Number(alternative.price);
}

function isTraceableAlternative(
  alternative: PriceAlternative,
  request: PriceRequest,
): boolean {
  return alternative.isAvailable !== false && isTraceableCommercialPrice({
    selectedPrice: alternativePrice(alternative),
    sourceType: alternative.sourceType,
    sourceUrl: alternative.url,
    confidenceScore: alternative.confidenceScore,
    materialName: request.materialName,
    selectedProductName: alternative.title,
    requestedUnit: request.unit,
    sourceUnit: alternative.unit,
    referenceUnitPrice: request.referenceUnitPrice,
    unitsPerPackage: alternative.unitsPerPackage,
    matchScore: alternative.matchScore,
    evidenceVerified: alternative.evidenceVerified,
    evidenceType: alternative.evidenceType,
    evidenceVerification: alternative.evidenceVerification,
  });
}

/**
 * Prefer a strictly equivalent, traceable supplier product over a technical
 * or provisional fallback. Prices explicitly controlled by the company are
 * never replaced automatically.
 */
export function preferTraceableCommercialAlternative(
  resolved: ResolvedPrice,
  request: PriceRequest,
): ResolvedPrice {
  if (USER_CONTROLLED_SOURCES.has(String(resolved.sourceType))) return resolved;

  if (isTraceableCommercialPrice({
    ...resolved,
    requestedUnit: request.unit,
    referenceUnitPrice: request.referenceUnitPrice,
  })) {
    return resolved;
  }

  const best = resolved.alternatives
    .filter((alternative) => isTraceableAlternative(alternative, request))
    .sort((left, right) =>
      (right.matchScore ?? 0) - (left.matchScore ?? 0) ||
      (right.confidenceScore ?? 0) - (left.confidenceScore ?? 0) ||
      alternativePrice(left) - alternativePrice(right)
    )[0];

  if (!best) return resolved;

  const selectedPrice = alternativePrice(best);
  const traceablePrices = resolved.alternatives
    .filter((alternative) => isTraceableAlternative(alternative, request))
    .map(alternativePrice)
    .sort((left, right) => left - right);

  return {
    ...resolved,
    selectedProductName: best.title,
    sourceUnit: best.unit || request.unit,
    selectedPrice,
    priceMin: traceablePrices[0] ?? selectedPrice,
    priceMedian: traceablePrices[Math.floor(traceablePrices.length / 2)] ?? selectedPrice,
    priceMax: traceablePrices.at(-1) ?? selectedPrice,
    selectedSupplier: best.supplier,
    sourceUrl: best.url || "",
    sourceType: (best.sourceType || "provider_updated") as ResolvedPrice["sourceType"],
    confidenceScore: best.confidenceScore ?? resolved.confidenceScore,
    capturedAt: best.checkedAt || resolved.capturedAt,
    providerId: best.providerId,
    isAvailable: best.isAvailable,
    deliveryDays: best.deliveryDays,
    matchScore: best.matchScore,
    matchIssues: best.matchIssues || [],
    unitsPerPackage: best.unitsPerPackage,
    evidenceVerified: best.evidenceVerified,
    evidenceType: best.evidenceType,
    evidenceVerification: best.evidenceVerification,
  };
}
