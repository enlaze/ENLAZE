import type { PriceAlternative } from "./price-resolver";
import { canonicalProviderName, providerIdentitySlug } from "./provider-identity";
import { isTraceableCommercialPrice } from "./price-traceability";

export interface BasketMaterialForComparison {
  id: string;
  name: string;
  quantity: number;
  included: boolean;
  sourceName?: string;
  sourceUrl?: string;
  matchedProductName?: string;
  unit_price: number;
  confidenceScore?: number;
  priceCheckedAt?: string;
  deliveryDays?: number;
  isAvailable?: boolean;
  isRealData?: boolean;
  sourceType?: string;
  priceAlternatives?: PriceAlternative[];
}

export interface ComparableOffer extends PriceAlternative {
  canonicalSupplier: string;
  supplierId: string;
  displayPrice: number;
  isTraceable: boolean;
}

export interface ProviderBasketCoverage {
  id: string;
  name: string;
  matchedMaterials: number;
  totalMaterials: number;
  coveragePercent: number;
  traceableMaterials: number;
  partialBasketTotal: number;
  averageConfidence: number | null;
  maxDeliveryDays: number | null;
  unavailableMaterials: number;
  isRecommended: boolean;
}

function asComparableOffer(alternative: PriceAlternative): ComparableOffer | null {
  const displayPrice = Number(alternative.effectivePrice ?? alternative.price);
  if (!Number.isFinite(displayPrice) || displayPrice <= 0 || !alternative.supplier) return null;
  const canonicalSupplier = canonicalProviderName(alternative.supplier, alternative.url);
  return {
    ...alternative,
    canonicalSupplier,
    supplierId: providerIdentitySlug(canonicalSupplier, alternative.url),
    displayPrice,
    isTraceable: isTraceableCommercialPrice({
      selectedPrice: displayPrice,
      sourceType: alternative.sourceType,
      sourceUrl: alternative.url,
      confidenceScore: alternative.confidenceScore,
    }),
  };
}

export function getComparableOffers(material: BasketMaterialForComparison, limit = 5) {
  const offers = (material.priceAlternatives || [])
    .map(asComparableOffer)
    .filter((offer): offer is ComparableOffer => Boolean(offer));
  const unique = new Map<string, ComparableOffer>();

  for (const offer of offers) {
    const key = `${offer.supplierId}|${offer.title.toLowerCase()}|${offer.displayPrice.toFixed(4)}`;
    const current = unique.get(key);
    if (!current || Number(offer.isTraceable) > Number(current.isTraceable) ||
      (offer.confidenceScore ?? 0) > (current.confidenceScore ?? 0)) {
      unique.set(key, offer);
    }
  }

  const uniqueOffers = Array.from(unique.values());
  const traceablePrices = uniqueOffers
    .filter((offer) => offer.isTraceable)
    .map((offer) => offer.displayPrice)
    .sort((left, right) => left - right);
  const medianPrice = traceablePrices.length >= 2
    ? traceablePrices[Math.floor(traceablePrices.length / 2)]
    : null;
  const referencePrice = Number.isFinite(material.unit_price) && material.unit_price > 0
    ? material.unit_price
    : medianPrice;

  return uniqueOffers
    .filter((offer) => {
      if (!offer.isTraceable || !referencePrice) return true;
      const ratio = offer.displayPrice / referencePrice;
      return ratio >= 0.25 && ratio <= 4;
    })
    .sort((left, right) =>
      Number(right.isAvailable !== false) - Number(left.isAvailable !== false) ||
      Number(right.isTraceable) - Number(left.isTraceable) ||
      (right.confidenceScore ?? 0) - (left.confidenceScore ?? 0) ||
      left.displayPrice - right.displayPrice
    )
    .slice(0, Math.max(1, limit));
}

export function buildProviderBasketCoverage(materials: BasketMaterialForComparison[]) {
  const included = materials.filter((material) => material.included);
  const providers = new Map<string, {
    name: string;
    lines: Map<string, ComparableOffer>;
  }>();

  for (const material of included) {
    for (const offer of getComparableOffers(material, 15)) {
      const provider = providers.get(offer.supplierId) || {
        name: offer.canonicalSupplier,
        lines: new Map<string, ComparableOffer>(),
      };
      const current = provider.lines.get(material.id);
      if (!current || Number(offer.isTraceable) > Number(current.isTraceable) ||
        (offer.confidenceScore ?? 0) > (current.confidenceScore ?? 0) ||
        offer.displayPrice < current.displayPrice) {
        provider.lines.set(material.id, offer);
      }
      providers.set(offer.supplierId, provider);
    }
  }

  const result: ProviderBasketCoverage[] = Array.from(providers.entries()).map(([id, provider]) => {
    const materialById = new Map(included.map((material) => [material.id, material]));
    const lines = Array.from(provider.lines.entries());
    const traceableLines = lines.filter(([, offer]) => offer.isTraceable);
    const confidenceTotal = traceableLines.reduce((sum, [, offer]) => sum + (offer.confidenceScore ?? 0), 0);
    const deliveryDays = traceableLines
      .map(([, offer]) => offer.deliveryDays)
      .filter((days): days is number => typeof days === "number" && Number.isFinite(days));
    return {
      id,
      name: provider.name,
      matchedMaterials: lines.length,
      totalMaterials: included.length,
      coveragePercent: included.length > 0 ? Math.round((traceableLines.length / included.length) * 100) : 0,
      traceableMaterials: traceableLines.length,
      partialBasketTotal: Math.round(traceableLines.reduce((sum, [materialId, offer]) =>
        sum + offer.displayPrice * (materialById.get(materialId)?.quantity || 0), 0) * 100) / 100,
      averageConfidence: traceableLines.length > 0 ? confidenceTotal / traceableLines.length : null,
      maxDeliveryDays: deliveryDays.length > 0 ? Math.max(...deliveryDays) : null,
      unavailableMaterials: traceableLines.filter(([, offer]) => offer.isAvailable === false).length,
      isRecommended: false,
    };
  }).filter((provider) => provider.traceableMaterials > 0);

  result.sort((left, right) =>
    right.coveragePercent - left.coveragePercent ||
    right.traceableMaterials - left.traceableMaterials ||
    (right.averageConfidence ?? 0) - (left.averageConfidence ?? 0) ||
    left.partialBasketTotal - right.partialBasketTotal
  );
  if (result[0]) result[0].isRecommended = true;
  return result;
}
