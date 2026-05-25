/**
 * provider-materials.ts
 * Commit 1.1.b.2 — Provider enrichment for AI/engine materials.
 *
 * When the user selects a provider in AI/engine mode, we do NOT filter
 * materials destructively. Instead we keep every material from the base
 * list and enrich/re-price the ones that have a match in the selected
 * provider's catalog. Materials without a match keep their base price
 * and are flagged as missing_in_selected_provider.
 *
 * Guarantees:
 *   - baseAIMaterials is NEVER mutated.
 *   - Output always has the same length as baseAIMaterials.
 *   - Reversible: A → B → A produces identical output to a fresh A.
 *   - Idempotent: apply(apply(x)) === apply(x).
 *   - unit_price 0 in provider catalog is treated as no-match.
 */

import { normalizeMaterialName } from "@/lib/price-resolver";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProviderMaterial {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  subtotal: number;
  included: boolean;
  provider_id?: string;
  isRealData?: boolean;
  sourceType?: string;
  missing_in_selected_provider?: boolean;
  provider_fallback_reason?: string;
  provider_adjustment?: ProviderAdjustmentMeta;
}

export interface ProviderAdjustmentMeta {
  applied: boolean;
  provider_id: string;
  provider_name: string;
  original_unit_price: number;
  adjusted_unit_price: number;
  match_type: "exact" | "fuzzy" | "none";
  adjusted_at: string;
}

// ─── Core function ──────────────────────────────────────────────────────────

/**
 * Applies a provider selection to a base list of AI/engine materials.
 *
 * For each base material:
 *   1. Try to find a match in providerCatalog by normalized name.
 *   2. If match found AND unit_price > 0 → use provider's price.
 *   3. If no match → keep base price, flag missing_in_selected_provider.
 *
 * @param baseAIMaterials  Immutable snapshot of AI/engine materials (never mutated)
 * @param providerCatalog  All fetched real materials from Supabase (allFetchedMaterials)
 * @param providerId       The selected provider ID (or null/empty to reset)
 * @param providerName     Human-readable provider name for metadata
 * @returns New array of ProviderMaterial with same length as baseAIMaterials
 */
export function applyProviderToAIMaterials(
  baseAIMaterials: ProviderMaterial[],
  providerCatalog: ProviderMaterial[],
  providerId: string | null,
  providerName: string
): ProviderMaterial[] {
  // If no provider selected, return clean clones without provider metadata
  if (!providerId || providerId.trim() === "") {
    return baseAIMaterials.map(m => ({
      ...m,
      missing_in_selected_provider: undefined,
      provider_fallback_reason: undefined,
      provider_adjustment: undefined,
    }));
  }

  // Build a lookup index: normalized name → provider catalog entry
  const providerItems = providerCatalog.filter(m => m.provider_id === providerId);
  const providerIndex = new Map<string, ProviderMaterial>();
  for (const item of providerItems) {
    const key = normalizeMaterialName(item.name);
    // Only index if unit_price > 0 (treat 0 as no-match)
    if (item.unit_price > 0) {
      providerIndex.set(key, item);
    }
  }

  const adjustedAt = new Date().toISOString();

  return baseAIMaterials.map(baseMat => {
    const normalizedName = normalizeMaterialName(baseMat.name);
    const providerMatch = providerIndex.get(normalizedName);

    if (providerMatch) {
      // Match found — use provider's real price
      const newPrice = providerMatch.unit_price;
      return {
        ...baseMat,
        unit_price: newPrice,
        subtotal: Math.round(baseMat.quantity * newPrice * 100) / 100,
        isRealData: true,
        sourceType: providerMatch.sourceType || "provider_match",
        missing_in_selected_provider: false,
        provider_fallback_reason: undefined,
        provider_adjustment: {
          applied: true,
          provider_id: providerId,
          provider_name: providerName,
          original_unit_price: baseMat.unit_price,
          adjusted_unit_price: newPrice,
          match_type: "exact" as const,
          adjusted_at: adjustedAt,
        },
      };
    } else {
      // No match — keep base price, flag as missing
      return {
        ...baseMat,
        missing_in_selected_provider: true,
        provider_fallback_reason: `Material "${baseMat.name}" no encontrado en el catálogo de ${providerName}. Se mantiene precio base.`,
        provider_adjustment: {
          applied: false,
          provider_id: providerId,
          provider_name: providerName,
          original_unit_price: baseMat.unit_price,
          adjusted_unit_price: baseMat.unit_price,
          match_type: "none" as const,
          adjusted_at: adjustedAt,
        },
      };
    }
  });
}
