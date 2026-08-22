/**
 * price-resolver-v2.ts
 *
 * Resolves material/partida prices through an 11-level priority cascade
 * using the Price Bank V2 tables (pb_*).
 *
 * Priority order:
 *   1.  manual_locked       — Precio manual bloqueado por la empresa
 *   2.  private_tariff      — Tarifa privada importada
 *   3.  negotiated          — Precio negociado
 *   4.  historical_approved — Historico reciente aprobado
 *   5.  preferred_supplier  — Proveedor preferido
 *   6.  provider_updated    — Precio actualizado de proveedor
 *   7.  private_bc3         — BC3 privado
 *   8.  technical_bank      — Banco tecnico global
 *   9.  enlaze_base         — Banco general de Enlaze
 *   10. market_estimate     — Estimacion de mercado
 *   11. ai_estimate         — IA como ultimo recurso
 *
 * Architecture:
 *   - resolveForConcept(): resolves one concept using pre-fetched data
 *   - resolveForBudget(): resolves all items in a budget
 *   - Both are PURE functions: no DB calls, no side effects
 *   - Supabase queries are done by the caller (API route)
 */

import type {
  PriceResolutionResult,
  PriceAlternativeV2,
  EffectiveCostBreakdown,
  ResolutionPriorityLevel,
} from "./types/price-bank";
import { calculateEffectiveCost } from "./effective-cost";
import { normalizeMaterialName, normalizeUnit } from "./price-resolver";
import { evaluateCommercialProductMatch } from "./commercial-product-match";

export { DEFAULT_PRIORITY_ORDER } from "./types/price-bank";

// ─── Input types ──────────────────────────────────────────────────────────

export interface PriceResolutionContext {
  company_id: string;
  province: string;
  quality_tier: "basica" | "media" | "alta";
  priority_order?: ResolutionPriorityLevel[];
}

export interface PrefetchedPriceData {
  current_prices: CurrentPriceRow[];
  manual_prices: ManualPriceRow[];
  historical_prices: HistoricalPriceRow[];
  technical_prices: TechnicalPriceRow[];
  enlaze_prices: EnlazePriceRow[];
}

export interface CurrentPriceRow {
  product_id: string;
  product_name: string;
  concept_id: string | null;
  concept_name: string | null;
  provider_id: string;
  provider_name: string;
  provider_province: string | null;
  provider_supply_zones: string[];
  is_preferred: boolean;
  brand: string | null;
  sku: string | null;
  unit: string;
  units_per_package: number;
  price_excl_vat: number;
  effective_price: number | null;
  shipping_cost: number;
  minimum_order: number;
  delivery_days_min: number;
  delivery_days_max: number;
  is_available: boolean;
  confidence_score: number;
  source_type: string;
  source_url?: string | null;
  checked_at: string | null;
  price_changed_at: string | null;
  is_private_tariff: boolean;
  is_negotiated: boolean;
}

export interface ManualPriceRow {
  name: string;
  unit: string;
  unit_price: number;
  supplier_name: string;
  source_type: string;
  is_locked: boolean;
}

export interface HistoricalPriceRow {
  concept_name: string;
  unit: string;
  unit_price: number;
  provider_name: string;
  budget_date: string;
  is_approved: boolean;
}

export interface TechnicalPriceRow {
  name: string;
  item_code: string;
  unit: string;
  unit_price: number;
  confidence_score: number;
  source: string;
  region: string;
  is_private: boolean;
}

export interface EnlazePriceRow {
  name: string;
  unit: string;
  unit_price: number;
  chapter: string;
  supplier_ref: string;
}

// ─── Single concept resolution ────────────────────────────────────────────

export interface ResolveConceptInput {
  concept_name: string;
  category: string;
  unit: string;
  quantity: number;
  reference_unit_price?: number;
}

/**
 * Resolve price for a single concept through the 11-level cascade.
 * PURE function: no DB access, no side effects.
 */
export function resolveForConcept(
  input: ResolveConceptInput,
  context: PriceResolutionContext,
  data: PrefetchedPriceData
): PriceResolutionResult {
  const normalized = normalizeMaterialName(input.concept_name);
  const now = new Date().toISOString();
  const alternatives: PriceAlternativeV2[] = [];
  const warnings: string[] = [];

  const priority = context.priority_order || [
    "manual_locked", "private_tariff", "negotiated",
    "historical_approved", "preferred_supplier", "provider_updated",
    "private_bc3", "technical_bank", "enlaze_base",
    "market_estimate", "ai_estimate",
  ];

  // Collect all alternatives first
  collectAlternatives(input, context, data, alternatives);

  // Try each level in priority order
  for (const level of priority) {
    const result = tryLevel(level, input, context, data, normalized, now, warnings);
    if (result) {
      return { ...result, alternatives, warnings };
    }
  }

  // Absolute fallback
  warnings.push("No se encontro precio en ninguna fuente. Precio estimado a 0.");
  return {
    concept_id: null, concept_name: input.concept_name,
    product_id: null, product_name: null,
    provider_id: null, provider_name: null, source_id: null,
    unit_price: 0, effective_price: 0, effective_cost_breakdown: null,
    source_type: "estimated", confidence_score: 0.05,
    selection_reason: "Sin fuente disponible",
    checked_at: now, alternatives, warnings,
  };
}

// ─── Level resolvers ──────────────────────────────────────────────────────

function tryLevel(
  level: ResolutionPriorityLevel,
  input: ResolveConceptInput,
  context: PriceResolutionContext,
  data: PrefetchedPriceData,
  normalized: string,
  now: string,
  warnings: string[]
): Omit<PriceResolutionResult, "alternatives" | "warnings"> | null {
  switch (level) {
    case "manual_locked":     return tryManualLocked(input, data, now);
    case "private_tariff":    return tryPrivateTariff(input, context, data, now);
    case "negotiated":        return tryNegotiated(input, context, data, now);
    case "historical_approved": return tryHistorical(input, data, now, warnings);
    case "preferred_supplier": return tryPreferredSupplier(input, context, data, now);
    case "provider_updated":  return tryProviderUpdated(input, context, data, now);
    case "private_bc3":       return tryPrivateBC3(input, data, now);
    case "technical_bank":    return tryTechnicalBank(input, data, now);
    case "enlaze_base":       return tryEnlazeBase(input, data, now);
    case "market_estimate":   return tryMarketEstimate(input, data, now, warnings);
    case "ai_estimate":       return null;
    default:                  return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function technicalMaterialMatchScore(a: string, b: string): number {
  const materialAliases = [
    { canonical: "placayeso", aliases: ["placa yeso laminado", "carton yeso", "pladur"] },
    { canonical: "adhesivoceramico", aliases: ["cemento cola", "adhesivo ceramico", "adhesivo porcelanico"] },
    { canonical: "revestimientoceramico", aliases: ["azulejo", "revestimiento ceramico", "baldosa ceramica"] },
    { canonical: "pavimentoporcelanico", aliases: ["pavimento porcelanico", "suelo porcelanico", "baldosa porcelanica"] },
    { canonical: "grifo", aliases: ["griferia", "grifo", "monomando"] },
    { canonical: "inodoro", aliases: ["inodoro", "wc", "sanitario"] },
    { canonical: "impermeabilizante", aliases: ["lamina impermeabilizante", "membrana impermeabilizante", "impermeabilizacion"] },
    { canonical: "pinturaplastica", aliases: ["pintura plastica", "pintura interior", "pintura paredes"] },
    { canonical: "imprimacion", aliases: ["imprimacion", "fijador", "sellador paredes"] },
  ];
  const expandAliases = (value: string) => {
    const normalized = normalizeMaterialName(value)
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const additions = materialAliases
      .filter((group) => group.aliases.some((alias) => normalized.includes(alias)))
      .map((group) => group.canonical);
    return `${normalized} ${additions.join(" ")}`.trim();
  };
  const na = expandAliases(a);
  const nb = expandAliases(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.95;
  const ignored = new Set([
    "para", "con", "sin", "tipo", "color", "blanco", "blanca", "negro",
    "negra", "pack", "unidad", "unidades", "material", "suministro",
  ]);
  const wordsA = Array.from(new Set(na.split(" ").filter((w) => w.length > 2 && !ignored.has(w))));
  const wordsB = Array.from(new Set(nb.split(" ").filter((w) => w.length > 2 && !ignored.has(w))));
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const overlap = wordsA.filter((w) =>
    wordsB.some((wb) => wb.includes(w) || w.includes(wb))
  );
  const baseScore = overlap.length / Math.max(1, Math.min(wordsA.length, wordsB.length));
  const extractMeasurements = (value: string) =>
    Array.from(new Set(
      value
        .replace(/,/g, ".")
        .match(/\d+(?:\.\d+)?\s*(?:mm|cm|m2|m3|ml|kg|l)\b/g) || []
    )).map((measurement) => measurement.replace(/\s+/g, ""));
  const measurementsA = extractMeasurements(na);
  const measurementsB = extractMeasurements(nb);
  if (
    measurementsA.length > 0 &&
    measurementsB.length > 0 &&
    !measurementsA.some((measurement) => measurementsB.includes(measurement))
  ) {
    return 0;
  }
  const measurementBonus =
    measurementsA.length > 0 &&
    measurementsB.length > 0 &&
    measurementsA.some((measurement) => measurementsB.includes(measurement))
      ? 0.15
      : 0;
  return Math.min(1, baseScore + measurementBonus);
}

function fuzzyMatch(a: string, b: string): boolean {
  return technicalMaterialMatchScore(a, b) >= 0.5;
}

function technicalUnitCompatible(requestedUnit: string, candidateUnit: string): boolean {
  const normalizeTechnicalUnit = (value: string) => {
    const normalized = normalizeUnit(value);
    if (normalized === "m") return "ml";
    if (normalized === "u" || normalized === "un") return "ud";
    return normalized;
  };
  return normalizeTechnicalUnit(requestedUnit) === normalizeTechnicalUnit(candidateUnit);
}

function technicalPriceCompatible(
  referenceUnitPrice: number | undefined,
  candidateUnitPrice: number,
): boolean {
  const reference = Number(referenceUnitPrice);
  const candidate = Number(candidateUnitPrice);
  if (!(reference > 0) || !(candidate > 0)) return candidate > 0;
  const ratio = candidate / reference;
  // A much larger/smaller value nearly always means that the BC3 line uses a
  // package, assembly or total-price unit that was not represented correctly.
  return ratio >= 0.25 && ratio <= 4;
}

function bestTechnicalMatch(
  input: ResolveConceptInput,
  candidates: TechnicalPriceRow[],
  isPrivate: boolean,
): TechnicalPriceRow | undefined {
  return candidates
    .filter((candidate) =>
      candidate.is_private === isPrivate
      && technicalUnitCompatible(input.unit, candidate.unit)
      && technicalPriceCompatible(input.reference_unit_price, candidate.unit_price)
      && technicalMaterialMatchScore(candidate.name, input.concept_name) >= 0.65
    )
    .sort((left, right) =>
      technicalMaterialMatchScore(right.name, input.concept_name)
      - technicalMaterialMatchScore(left.name, input.concept_name)
    )[0];
}

function commercialProductMatchEvaluation(
  product: CurrentPriceRow,
  input: ResolveConceptInput,
) {
  return evaluateCommercialProductMatch({
    requestedName: input.concept_name,
    candidateName: product.product_name,
    requestedUnit: input.unit,
    candidateUnit: product.unit,
    unitsPerPackage: product.units_per_package,
    referenceUnitPrice: input.reference_unit_price,
    candidateUnitPrice: product.price_excl_vat,
  });
}

function commercialProductMatch(product: CurrentPriceRow, input: ResolveConceptInput): boolean {
  return commercialProductMatchEvaluation(product, input).isExact;
}

function providerServesProvince(
  provider_province: string | null,
  supply_zones: string[],
  target_province: string
): boolean {
  if (!target_province) return true;
  const normalizeRegion = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9*]+/g, " ")
      .trim();
  const tp = normalizeRegion(target_province);
  const nationwideZones = new Set([
    "*", "all", "es", "espana", "nacional", "nacional espana",
    "toda espana", "peninsula", "peninsular",
  ]);
  if (provider_province && normalizeRegion(provider_province) === tp) return true;
  if (
    supply_zones.some((zone) => {
      const normalizedZone = normalizeRegion(zone);
      return (
        nationwideZones.has(normalizedZone) ||
        normalizedZone === tp ||
        normalizedZone.includes(tp) ||
        tp.includes(normalizedZone)
      );
    })
  ) return true;
  if (!provider_province && supply_zones.length === 0) return true;
  return false;
}

function buildEffectiveCost(
  price: number, quantity: number, units_per_package: number,
  shipping: number, minimum_order: number
): EffectiveCostBreakdown {
  return calculateEffectiveCost({
    unit_price: price, quantity_needed: quantity,
    units_per_package: units_per_package || 1,
    minimum_order: minimum_order || 0,
    shipping_cost: shipping || 0,
    other_costs: 0, discount_pct: 0, discount_flat: 0,
  });
}

// ─── Level 1: Manual locked ──────────────────────────────────────────────

function tryManualLocked(
  input: ResolveConceptInput, data: PrefetchedPriceData, now: string
): Omit<PriceResolutionResult, "alternatives" | "warnings"> | null {
  const match = data.manual_prices.find(
    (p) => p.is_locked && fuzzyMatch(p.name, input.concept_name)
  );
  if (!match) return null;
  return {
    concept_id: null, concept_name: input.concept_name,
    product_id: null, product_name: match.name,
    provider_id: null, provider_name: match.supplier_name || "Manual",
    source_id: null, unit_price: match.unit_price,
    effective_price: match.unit_price, effective_cost_breakdown: null,
    source_type: "manual_locked", confidence_score: 1.0,
    selection_reason: "Precio manual bloqueado por la empresa", checked_at: now,
  };
}

// ─── Level 2: Private tariff ─────────────────────────────────────────────

function tryPrivateTariff(
  input: ResolveConceptInput, context: PriceResolutionContext,
  data: PrefetchedPriceData, now: string
): Omit<PriceResolutionResult, "alternatives" | "warnings"> | null {
  const match = data.current_prices.find(
    (p) => p.is_private_tariff && commercialProductMatch(p, input) &&
      providerServesProvince(p.provider_province, p.provider_supply_zones, context.province)
  );
  if (!match) return null;
  const evaluation = commercialProductMatchEvaluation(match, input);
  const breakdown = buildEffectiveCost(match.price_excl_vat, input.quantity, match.units_per_package, match.shipping_cost, match.minimum_order);
  return {
    concept_id: match.concept_id, concept_name: match.concept_name || input.concept_name,
    product_id: match.product_id, product_name: match.product_name,
    provider_id: match.provider_id, provider_name: match.provider_name,
    source_id: null, unit_price: match.price_excl_vat,
    effective_price: breakdown.effective_per_unit, effective_cost_breakdown: breakdown,
    source_type: "private_tariff", confidence_score: Math.min(0.95, evaluation.score),
    selection_reason: "Tarifa privada importada", checked_at: match.checked_at || now,
  };
}

// ─── Level 3: Negotiated ─────────────────────────────────────────────────

function tryNegotiated(
  input: ResolveConceptInput, context: PriceResolutionContext,
  data: PrefetchedPriceData, now: string
): Omit<PriceResolutionResult, "alternatives" | "warnings"> | null {
  const match = data.current_prices.find(
    (p) => p.is_negotiated && commercialProductMatch(p, input) &&
      providerServesProvince(p.provider_province, p.provider_supply_zones, context.province)
  );
  if (!match) return null;
  const evaluation = commercialProductMatchEvaluation(match, input);
  const breakdown = buildEffectiveCost(match.price_excl_vat, input.quantity, match.units_per_package, match.shipping_cost, match.minimum_order);
  return {
    concept_id: match.concept_id, concept_name: match.concept_name || input.concept_name,
    product_id: match.product_id, product_name: match.product_name,
    provider_id: match.provider_id, provider_name: match.provider_name,
    source_id: null, unit_price: match.price_excl_vat,
    effective_price: breakdown.effective_per_unit, effective_cost_breakdown: breakdown,
    source_type: "negotiated", confidence_score: Math.min(0.93, evaluation.score),
    selection_reason: "Precio negociado con proveedor", checked_at: match.checked_at || now,
  };
}

// ─── Level 4: Historical approved ────────────────────────────────────────

function tryHistorical(
  input: ResolveConceptInput, data: PrefetchedPriceData,
  now: string, warnings: string[]
): Omit<PriceResolutionResult, "alternatives" | "warnings"> | null {
  const match = data.historical_prices.find(
    (p) => p.is_approved && fuzzyMatch(p.concept_name, input.concept_name)
  );
  if (!match) return null;
  const daysSince = Math.floor(
    (Date.now() - new Date(match.budget_date).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysSince > 90) {
    warnings.push(`Precio historico de "${match.concept_name}" tiene ${daysSince} dias. Puede estar desactualizado.`);
  }
  return {
    concept_id: null, concept_name: input.concept_name,
    product_id: null, product_name: match.concept_name,
    provider_id: null, provider_name: match.provider_name,
    source_id: null, unit_price: match.unit_price,
    effective_price: match.unit_price, effective_cost_breakdown: null,
    source_type: "historical_approved",
    confidence_score: daysSince < 30 ? 0.88 : daysSince < 60 ? 0.78 : 0.65,
    selection_reason: `Historico aprobado (${daysSince} dias)`,
    checked_at: match.budget_date,
  };
}

// ─── Level 5: Preferred supplier ─────────────────────────────────────────

function tryPreferredSupplier(
  input: ResolveConceptInput, context: PriceResolutionContext,
  data: PrefetchedPriceData, now: string
): Omit<PriceResolutionResult, "alternatives" | "warnings"> | null {
  const match = data.current_prices.filter(
    (p) => p.is_preferred && p.is_available &&
      commercialProductMatch(p, input) &&
      providerServesProvince(p.provider_province, p.provider_supply_zones, context.province)
  ).sort((left, right) =>
    commercialProductMatchEvaluation(right, input).score
      - commercialProductMatchEvaluation(left, input).score
    || Number(Boolean(right.source_url)) - Number(Boolean(left.source_url))
    || (right.confidence_score || 0) - (left.confidence_score || 0)
  )[0];
  if (!match) return null;
  const breakdown = buildEffectiveCost(match.price_excl_vat, input.quantity, match.units_per_package, match.shipping_cost, match.minimum_order);
  const evaluation = commercialProductMatchEvaluation(match, input);
  return {
    concept_id: match.concept_id, concept_name: match.concept_name || input.concept_name,
    product_id: match.product_id, product_name: match.product_name,
    provider_id: match.provider_id, provider_name: match.provider_name,
    source_id: null, unit_price: match.price_excl_vat,
    effective_price: breakdown.effective_per_unit, effective_cost_breakdown: breakdown,
    source_type: "preferred_supplier", confidence_score: Math.min(match.confidence_score || 0.85, evaluation.score),
    selection_reason: `Proveedor preferido: ${match.provider_name}`,
    checked_at: match.checked_at || now,
  };
}

// ─── Level 6: Provider updated (best effective cost) ─────────────────────

function tryProviderUpdated(
  input: ResolveConceptInput, context: PriceResolutionContext,
  data: PrefetchedPriceData, now: string
): Omit<PriceResolutionResult, "alternatives" | "warnings"> | null {
  const matches = data.current_prices.filter(
    (p) => !p.is_private_tariff && !p.is_negotiated && p.is_available &&
      commercialProductMatch(p, input) &&
      providerServesProvince(p.provider_province, p.provider_supply_zones, context.province)
  );
  if (matches.length === 0) return null;

  const withCost = matches.map((m) => ({
    match: m,
    matchScore: commercialProductMatchEvaluation(m, input).score,
    breakdown: buildEffectiveCost(m.price_excl_vat, input.quantity, m.units_per_package, m.shipping_cost, m.minimum_order),
  }));
  if (withCost.length === 0) return null;
  withCost.sort(
    (a, b) =>
      b.matchScore - a.matchScore ||
      Number(Boolean(b.match.source_url)) - Number(Boolean(a.match.source_url)) ||
      (b.match.confidence_score || 0) - (a.match.confidence_score || 0) ||
      a.breakdown.effective_per_unit - b.breakdown.effective_per_unit
  );
  const best = withCost[0];

  return {
    concept_id: best.match.concept_id, concept_name: best.match.concept_name || input.concept_name,
    product_id: best.match.product_id, product_name: best.match.product_name,
    provider_id: best.match.provider_id, provider_name: best.match.provider_name,
    source_id: null, unit_price: best.match.price_excl_vat,
    effective_price: best.breakdown.effective_per_unit, effective_cost_breakdown: best.breakdown,
    source_type: "provider_updated",
    confidence_score: Math.min(best.match.confidence_score || 0.82, best.matchScore),
    selection_reason: `Mejor coste efectivo de ${withCost.length} proveedor(es)`,
    checked_at: best.match.checked_at || now,
  };
}

// ─── Level 7: Private BC3 ────────────────────────────────────────────────

function tryPrivateBC3(
  input: ResolveConceptInput, data: PrefetchedPriceData, now: string
): Omit<PriceResolutionResult, "alternatives" | "warnings"> | null {
  const match = bestTechnicalMatch(input, data.technical_prices, true);
  if (!match) return null;
  return {
    concept_id: null, concept_name: input.concept_name,
    product_id: null, product_name: match.name,
    provider_id: null, provider_name: `BC3 privado (${match.source})`,
    source_id: null, unit_price: match.unit_price,
    effective_price: match.unit_price, effective_cost_breakdown: null,
    source_type: "private_bc3", confidence_score: match.confidence_score || 0.80,
    selection_reason: `BC3 privado: ${match.source}`, checked_at: now,
  };
}

// ─── Level 8: Technical bank (global) ────────────────────────────────────

function tryTechnicalBank(
  input: ResolveConceptInput, data: PrefetchedPriceData, now: string
): Omit<PriceResolutionResult, "alternatives" | "warnings"> | null {
  const match = bestTechnicalMatch(input, data.technical_prices, false);
  if (!match) return null;
  return {
    concept_id: null, concept_name: input.concept_name,
    product_id: null, product_name: match.name,
    provider_id: null, provider_name: `Banco tecnico (${match.source})`,
    source_id: null, unit_price: match.unit_price,
    effective_price: match.unit_price, effective_cost_breakdown: null,
    source_type: "technical_bank", confidence_score: match.confidence_score || 0.78,
    selection_reason: `Banco tecnico global: ${match.source} (${match.region})`,
    checked_at: now,
  };
}

// ─── Level 9: Enlaze base ────────────────────────────────────────────────

function tryEnlazeBase(
  input: ResolveConceptInput, data: PrefetchedPriceData, now: string
): Omit<PriceResolutionResult, "alternatives" | "warnings"> | null {
  const match = data.enlaze_prices.find((p) =>
    fuzzyMatch(p.name, input.concept_name)
    && technicalUnitCompatible(input.unit, p.unit)
    && technicalPriceCompatible(input.reference_unit_price, p.unit_price)
  );
  if (!match) return null;
  return {
    concept_id: null, concept_name: input.concept_name,
    product_id: null, product_name: match.name,
    provider_id: null, provider_name: match.supplier_ref || "Banco ENLAZE",
    source_id: null, unit_price: match.unit_price,
    effective_price: match.unit_price, effective_cost_breakdown: null,
    source_type: "enlaze_base", confidence_score: 0.45,
    selection_reason: "Banco general de Enlaze (referencia de mercado)", checked_at: now,
  };
}

// ─── Level 10: Market estimate ───────────────────────────────────────────

function tryMarketEstimate(
  input: ResolveConceptInput, data: PrefetchedPriceData,
  now: string, warnings: string[]
): Omit<PriceResolutionResult, "alternatives" | "warnings"> | null {
  const match = data.manual_prices.find(
    (p) => !p.is_locked && fuzzyMatch(p.name, input.concept_name)
  );
  if (!match) return null;
  warnings.push(`"${input.concept_name}": precio basado en estimacion de mercado. Confianza baja.`);
  return {
    concept_id: null, concept_name: input.concept_name,
    product_id: null, product_name: match.name,
    provider_id: null, provider_name: match.supplier_name || "Estimacion",
    source_id: null, unit_price: match.unit_price,
    effective_price: match.unit_price, effective_cost_breakdown: null,
    source_type: "market_estimate", confidence_score: 0.35,
    selection_reason: "Estimacion de mercado", checked_at: now,
  };
}

// ─── Alternatives collector ───────────────────────────────────────────────

function collectAlternatives(
  input: ResolveConceptInput, context: PriceResolutionContext,
  data: PrefetchedPriceData, alternatives: PriceAlternativeV2[]
): void {
  const seenProducts = new Set<string>();
  for (const p of data.current_prices) {
    const evaluation = commercialProductMatchEvaluation(p, input);
    if (!evaluation.isExact) continue;
    if (!providerServesProvince(p.provider_province, p.provider_supply_zones, context.province)) continue;
    if (!p.product_id || seenProducts.has(p.product_id)) continue;
    seenProducts.add(p.product_id);

    const breakdown = buildEffectiveCost(p.price_excl_vat, input.quantity, p.units_per_package, p.shipping_cost, p.minimum_order);
    alternatives.push({
      product_id: p.product_id, product_name: p.product_name,
      provider_id: p.provider_id, provider_name: p.provider_name,
      brand: p.brand, unit_price: p.price_excl_vat,
      effective_price: breakdown.effective_per_unit, is_available: p.is_available,
      delivery_days: p.delivery_days_max, confidence_score: Math.min(p.confidence_score, evaluation.score),
      source_type: p.source_type, checked_at: p.checked_at,
      source_url: p.source_url || null,
      delivery_days_min: p.delivery_days_min,
      unit: p.unit,
      units_per_package: p.units_per_package,
      match_score: evaluation.score,
      match_issues: evaluation.reasons,
    });
  }
  alternatives.sort((a, b) =>
    Number(b.is_available) - Number(a.is_available) ||
    Number(Boolean(b.source_url)) - Number(Boolean(a.source_url)) ||
    b.confidence_score - a.confidence_score ||
    (a.effective_price ?? 999999) - (b.effective_price ?? 999999)
  );
  alternatives.splice(15);
}

// ─── Batch resolution ─────────────────────────────────────────────────────

export interface BatchResolveInput {
  items: ResolveConceptInput[];
  context: PriceResolutionContext;
  data: PrefetchedPriceData;
}

export interface BatchResolveResult {
  results: PriceResolutionResult[];
  summary: {
    total: number;
    resolved: number;
    by_source: Record<string, number>;
    avg_confidence: number;
    needs_review: number;
    zero_price: number;
  };
}

/**
 * Resolve prices for all items in a budget.
 * Returns results + summary statistics.
 */
export function resolveForBudget(input: BatchResolveInput): BatchResolveResult {
  const results = input.items.map((item) =>
    resolveForConcept(item, input.context, input.data)
  );

  const by_source: Record<string, number> = {};
  let totalConfidence = 0;
  let needsReview = 0;
  let zeroPrice = 0;

  for (const r of results) {
    by_source[r.source_type] = (by_source[r.source_type] || 0) + 1;
    totalConfidence += r.confidence_score;
    if (r.confidence_score < 0.5) needsReview++;
    if (r.unit_price === 0) zeroPrice++;
  }

  return {
    results,
    summary: {
      total: results.length,
      resolved: results.filter((r) => r.unit_price > 0).length,
      by_source,
      avg_confidence: results.length > 0
        ? Math.round((totalConfidence / results.length) * 100) / 100
        : 0,
      needs_review: needsReview,
      zero_price: zeroPrice,
    },
  };
}
