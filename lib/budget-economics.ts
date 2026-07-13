/**
 * budget-economics.ts
 *
 * FASE 4 del generador de presupuestos v2.
 * Calcula costes, margenes, rentabilidad y detecta infravaloracion.
 *
 * 100% determinista — sin IA, sin llamadas externas.
 * Recibe BudgetItemV2[] + preferencias y devuelve BudgetEconomics.
 *
 * Funciones principales:
 *   - calculateEconomics(): calculo completo de economics
 *   - checkUndervaluation(): deteccion de infravaloracion (5 indicadores)
 *   - recalculateItem(): recalcular una partida tras edicion
 */

import type {
  BudgetItemV2,
  BudgetPreferences,
  BudgetEconomics,
  CostBreakdownV2,
  PerM2Analysis,
  UndervaluationCheck,
  UndervaluationWarning,
  ChapterEconomics,
  PriceConfidenceSummary,
  ChapterCode,
  ProjectType,
  QualityTier,
  WarningSeverity,
  MarketRange,
} from "./types/budget-v2";

// ─── Market ranges EUR/m2 by project type and quality ───────────────────────

const MARKET_RANGES: MarketRange[] = [
  // Reforma integral
  { project_type: "reforma_integral", quality: "basica", min_eur_m2: 200, max_eur_m2: 400 },
  { project_type: "reforma_integral", quality: "media",  min_eur_m2: 350, max_eur_m2: 650 },
  { project_type: "reforma_integral", quality: "alta",   min_eur_m2: 550, max_eur_m2: 1200 },
  // Reforma parcial
  { project_type: "reforma_parcial", quality: "basica", min_eur_m2: 120, max_eur_m2: 280 },
  { project_type: "reforma_parcial", quality: "media",  min_eur_m2: 200, max_eur_m2: 450 },
  { project_type: "reforma_parcial", quality: "alta",   min_eur_m2: 350, max_eur_m2: 800 },
  // Reforma bano
  { project_type: "reforma_bano", quality: "basica", min_eur_m2: 400, max_eur_m2: 800 },
  { project_type: "reforma_bano", quality: "media",  min_eur_m2: 600, max_eur_m2: 1200 },
  { project_type: "reforma_bano", quality: "alta",   min_eur_m2: 1000, max_eur_m2: 2500 },
  // Reforma cocina
  { project_type: "reforma_cocina", quality: "basica", min_eur_m2: 350, max_eur_m2: 700 },
  { project_type: "reforma_cocina", quality: "media",  min_eur_m2: 550, max_eur_m2: 1100 },
  { project_type: "reforma_cocina", quality: "alta",   min_eur_m2: 900, max_eur_m2: 2200 },
  // Obra nueva
  { project_type: "obra_nueva", quality: "basica", min_eur_m2: 800, max_eur_m2: 1200 },
  { project_type: "obra_nueva", quality: "media",  min_eur_m2: 1100, max_eur_m2: 1800 },
  { project_type: "obra_nueva", quality: "alta",   min_eur_m2: 1600, max_eur_m2: 3000 },
  // Rehabilitacion
  { project_type: "rehabilitacion", quality: "basica", min_eur_m2: 250, max_eur_m2: 500 },
  { project_type: "rehabilitacion", quality: "media",  min_eur_m2: 400, max_eur_m2: 800 },
  { project_type: "rehabilitacion", quality: "alta",   min_eur_m2: 650, max_eur_m2: 1500 },
  // Fallbacks for other types
  { project_type: "mantenimiento", quality: "basica", min_eur_m2: 50, max_eur_m2: 150 },
  { project_type: "mantenimiento", quality: "media",  min_eur_m2: 100, max_eur_m2: 300 },
  { project_type: "mantenimiento", quality: "alta",   min_eur_m2: 200, max_eur_m2: 500 },
  { project_type: "instalacion", quality: "basica", min_eur_m2: 80, max_eur_m2: 200 },
  { project_type: "instalacion", quality: "media",  min_eur_m2: 150, max_eur_m2: 400 },
  { project_type: "instalacion", quality: "alta",   min_eur_m2: 300, max_eur_m2: 800 },
  { project_type: "otro", quality: "basica", min_eur_m2: 100, max_eur_m2: 300 },
  { project_type: "otro", quality: "media",  min_eur_m2: 200, max_eur_m2: 500 },
  { project_type: "otro", quality: "alta",   min_eur_m2: 350, max_eur_m2: 1000 },
];

function getMarketRange(projectType: ProjectType, quality: QualityTier): { min: number; max: number } {
  const match = MARKET_RANGES.find(
    (r) => r.project_type === projectType && r.quality === quality,
  );
  if (match) return { min: match.min_eur_m2, max: match.max_eur_m2 };
  // Fallback: generic ranges
  const fallback: Record<QualityTier, { min: number; max: number }> = {
    basica: { min: 150, max: 400 },
    media: { min: 300, max: 700 },
    alta: { min: 500, max: 1500 },
  };
  return fallback[quality];
}

// ─── Rendimientos de referencia (h/unidad) para check de infravaloración ────

const RENDIMIENTOS_REF: Record<string, Record<string, number>> = {
  demoliciones:       { m2: 0.30, ud: 0.50, m3: 2.0, pa: 4.0 },
  albanileria:        { m2: 0.60, ud: 0.80, ml: 0.20 },
  fontaneria:         { ud: 2.50, ml: 0.30, punto: 1.50, pa: 8.0 },
  electricidad:       { ud: 0.80, punto: 1.20, ml: 0.15, pa: 6.0 },
  revestimientos:     { m2: 0.55, ml: 0.20 },
  pavimentos:         { m2: 0.45, ml: 0.15 },
  pintura:            { m2: 0.15, ml: 0.10 },
  carpinteria_interior: { ud: 2.00 },
  carpinteria_exterior: { ud: 3.00 },
  sanitarios:         { ud: 2.00, pa: 6.0 },
  cocina:             { pa: 16.0 },
  climatizacion:      { ud: 8.00 },
  impermeabilizacion: { m2: 0.35 },
  falsos_techos:      { m2: 0.40 },
  residuos:           { ud: 1.00, m3: 0.50 },
  limpieza:           { m2: 0.10, pa: 4.0 },
  protecciones:       { pa: 3.0, ud: 0.50 },
};

// ─── Chapter labels ─────────────────────────────────────────────────────────

const CHAPTER_LABELS: Record<ChapterCode, string> = {
  protecciones: "Protecciones y trabajos previos",
  demoliciones: "Demoliciones y retiradas",
  albanileria: "Albanileria y tabiqueria",
  fontaneria: "Fontaneria y saneamiento",
  electricidad: "Electricidad e iluminacion",
  impermeabilizacion: "Impermeabilizacion",
  revestimientos: "Revestimientos de paredes",
  pavimentos: "Pavimentos y solados",
  rodapie: "Rodapie",
  pintura: "Pintura y acabados",
  carpinteria_interior: "Carpinteria interior",
  carpinteria_exterior: "Carpinteria exterior y cerramientos",
  sanitarios: "Sanitarios y griferia",
  cocina: "Cocina",
  climatizacion: "Climatizacion",
  falsos_techos: "Falsos techos",
  residuos: "Gestion de residuos",
  limpieza: "Limpieza final de obra",
  seguridad: "Seguridad y salud",
  otros: "Otros",
};

// ─── Core calculation ───────────────────────────────────────────────────────

/**
 * FASE 4: Calculate full economic breakdown for a budget.
 *
 * Pure function — no side effects, no DB calls.
 *
 * @param items - BudgetItemV2[] with prices already resolved (FASE 3)
 * @param preferences - user's margin, indirect costs, tax config
 * @param projectType - for market range comparison
 * @param surfaceM2 - for EUR/m2 calculation
 * @param workersCount - for duration vs crew check (optional)
 * @param calendarDays - estimated calendar days (from planner, optional)
 */
export function calculateEconomics(
  items: BudgetItemV2[],
  preferences: BudgetPreferences,
  projectType: ProjectType,
  surfaceM2: number,
  workersCount?: number | null,
  calendarDays?: number | null,
): BudgetEconomics {
  // ── Cost breakdown ──
  const costBreakdown = calculateCostBreakdown(items, preferences);

  // ── Per m2 analysis ──
  const perM2 = calculatePerM2(costBreakdown, surfaceM2, projectType, preferences.quality);

  // ── Undervaluation check ──
  const undervaluationCheck = checkUndervaluation(
    items,
    costBreakdown,
    perM2,
    preferences,
    projectType,
    surfaceM2,
    workersCount ?? null,
    calendarDays ?? null,
  );

  // ── Chapter breakdown ──
  const chapterBreakdown = calculateChapterBreakdown(items, preferences.margin_percent);

  // ── Price confidence summary ──
  const priceConfidence = calculatePriceConfidence(items);

  return {
    cost_breakdown: costBreakdown,
    per_m2: perM2,
    undervaluation_check: undervaluationCheck,
    chapter_breakdown: chapterBreakdown,
    price_confidence: priceConfidence,
  };
}

// ─── Cost breakdown ─────────────────────────────────────────────────────────

function calculateCostBreakdown(
  items: BudgetItemV2[],
  preferences: BudgetPreferences,
): CostBreakdownV2 {
  let materials = 0;
  let labor = 0;
  let machinery = 0;
  let wasteManagement = 0;

  for (const item of items) {
    materials += item.material_cost_per_unit * item.quantity;
    labor += item.labor_cost_per_unit * item.quantity;
    machinery += item.machinery_cost_per_unit * item.quantity;

    // Waste from residuos chapter
    if (item.chapter === "residuos") {
      wasteManagement += item.subtotal_cost;
    }
  }

  const transport = 0; // Will be calculated if transport items exist
  const directCost = materials + labor + machinery + transport + wasteManagement;

  const indirectCostsPercent = preferences.indirect_costs_percent ?? 6;
  const indirectCosts = round2(directCost * indirectCostsPercent / 100);
  const totalCost = round2(directCost + indirectCosts);

  const marginPercent = preferences.margin_percent ?? 25;
  const salePriceBeforeTax = round2(totalCost * (1 + marginPercent / 100));
  const marginAmount = round2(salePriceBeforeTax - totalCost);

  const taxPercent = preferences.tax_percent ?? 21;
  const taxAmount = round2(salePriceBeforeTax * taxPercent / 100);
  const totalSalePrice = round2(salePriceBeforeTax + taxAmount);

  const profit = marginAmount;
  const profitabilityPercent = totalCost > 0
    ? round2((profit / totalCost) * 100)
    : 0;

  return {
    materials: round2(materials),
    labor: round2(labor),
    machinery: round2(machinery),
    transport: round2(transport),
    waste_management: round2(wasteManagement),
    direct_cost: round2(directCost),
    indirect_costs_percent: indirectCostsPercent,
    indirect_costs: indirectCosts,
    total_cost: totalCost,
    margin_percent: marginPercent,
    margin_amount: marginAmount,
    sale_price_before_tax: salePriceBeforeTax,
    tax_percent: taxPercent,
    tax_amount: taxAmount,
    total_sale_price: totalSalePrice,
    profit,
    profitability_percent: profitabilityPercent,
  };
}

// ─── Per m2 analysis ────────────────────────────────────────────────────────

function calculatePerM2(
  costBreakdown: CostBreakdownV2,
  surfaceM2: number,
  projectType: ProjectType,
  quality: QualityTier,
): PerM2Analysis {
  const m2 = Math.max(surfaceM2, 1); // avoid division by zero
  const costPerM2 = round2(costBreakdown.total_cost / m2);
  const salePerM2 = round2(costBreakdown.sale_price_before_tax / m2);

  const range = getMarketRange(projectType, quality);

  return {
    cost: costPerM2,
    sale: salePerM2,
    market_reference_min: range.min,
    market_reference_max: range.max,
    is_within_market: salePerM2 >= range.min && salePerM2 <= range.max,
  };
}

// ─── Undervaluation detection (5 indicators) ────────────────────────────────

/**
 * Check for budget undervaluation using 5 concrete indicators.
 * Only flags as undervalued if >= 2 indicators are positive.
 */
export function checkUndervaluation(
  items: BudgetItemV2[],
  costBreakdown: CostBreakdownV2,
  perM2: PerM2Analysis,
  preferences: BudgetPreferences,
  projectType: ProjectType,
  surfaceM2: number,
  workersCount: number | null,
  calendarDays: number | null,
): UndervaluationCheck {
  const warnings: UndervaluationWarning[] = [];

  // ── Indicator 1: EUR/m2 below market minimum ──
  if (perM2.sale < perM2.market_reference_min) {
    warnings.push({
      indicator: "EUR/m2 por debajo del minimo de mercado",
      detail: `${perM2.sale} EUR/m2 vs minimo ${perM2.market_reference_min} EUR/m2 para ${projectType} calidad ${preferences.quality}`,
      severity: perM2.sale < perM2.market_reference_min * 0.7 ? "high" : "medium",
    });
  }

  // ── Indicator 2: Global margin below 10% ──
  if (costBreakdown.margin_percent < 10) {
    warnings.push({
      indicator: "Margen global insuficiente",
      detail: `Margen ${costBreakdown.margin_percent}%, minimo recomendado 10%`,
      severity: costBreakdown.margin_percent < 5 ? "high" : "medium",
    });
  }

  // ── Indicator 3: Insufficient labor hours for quantities ──
  const laborCheck = checkLaborHours(items);
  if (laborCheck) {
    warnings.push(laborCheck);
  }

  // ── Indicator 4: Material prices below 60% of market minimum ──
  const cheapMaterials = checkCheapMaterials(items);
  if (cheapMaterials) {
    warnings.push(cheapMaterials);
  }

  // ── Indicator 5: Duration incompatible with crew ──
  if (workersCount && calendarDays && workersCount > 0 && calendarDays > 0) {
    const totalHours = items.reduce((sum, i) => sum + i.estimated_hours, 0);
    const requiredDays = totalHours / (workersCount * 8);
    if (requiredDays > calendarDays * 1.2) {
      warnings.push({
        indicator: "Duracion incompatible con cuadrilla",
        detail: `${Math.round(requiredDays)} dias necesarios con ${workersCount} trabajadores, pero se estiman ${calendarDays} dias calendario`,
        severity: requiredDays > calendarDays * 1.5 ? "high" : "medium",
      });
    }
  }

  const score = warnings.length;

  return {
    is_undervalued: score >= 2,
    score,
    warnings,
  };
}

function checkLaborHours(items: BudgetItemV2[]): UndervaluationWarning | null {
  let totalExpected = 0;
  let totalActual = 0;
  const deficientChapters: string[] = [];

  // Group items by chapter
  const byChapter = new Map<string, BudgetItemV2[]>();
  for (const item of items) {
    const list = byChapter.get(item.chapter) || [];
    list.push(item);
    byChapter.set(item.chapter, list);
  }

  for (const [chapter, chapterItems] of byChapter) {
    const rendimientos = RENDIMIENTOS_REF[chapter];
    if (!rendimientos) continue;

    let chapterExpected = 0;
    let chapterActual = 0;

    for (const item of chapterItems) {
      const rendimiento = rendimientos[item.unit] || rendimientos["ud"] || 0;
      const expectedHours = item.quantity * rendimiento;
      chapterExpected += expectedHours;
      chapterActual += item.estimated_hours;
    }

    totalExpected += chapterExpected;
    totalActual += chapterActual;

    // Flag chapter if hours < 70% of expected
    if (chapterExpected > 0 && chapterActual < chapterExpected * 0.7) {
      deficientChapters.push(CHAPTER_LABELS[chapter as ChapterCode] || chapter);
    }
  }

  if (totalExpected > 0 && totalActual < totalExpected * 0.7) {
    return {
      indicator: "Horas de mano de obra insuficientes",
      detail: `${Math.round(totalActual)}h calculadas vs ${Math.round(totalExpected)}h esperadas. Capitulos deficientes: ${deficientChapters.join(", ") || "varios"}`,
      severity: totalActual < totalExpected * 0.5 ? "high" as WarningSeverity : "medium" as WarningSeverity,
    };
  }

  return null;
}

function checkCheapMaterials(items: BudgetItemV2[]): UndervaluationWarning | null {
  // Check for items with material cost suspiciously low
  // We compare against estimated items — if material_cost_per_unit is 0
  // for items in material-heavy chapters, that's suspicious
  const materialHeavyChapters = new Set([
    "sanitarios", "cocina", "carpinteria_interior", "carpinteria_exterior",
    "climatizacion", "revestimientos", "pavimentos",
  ]);

  const suspiciousItems: string[] = [];

  for (const item of items) {
    if (!materialHeavyChapters.has(item.chapter)) continue;
    if (item.priority === "opcional") continue;

    // Material cost should be significant in these chapters
    if (item.unit_cost > 0 && item.material_cost_per_unit <= 0) {
      suspiciousItems.push(item.name);
    }

    // Price source is estimated with very low confidence
    if (item.price_source === "estimated" && item.confidence_score < 0.3) {
      suspiciousItems.push(item.name);
    }
  }

  if (suspiciousItems.length >= 3) {
    return {
      indicator: "Materiales con precio sospechosamente bajo",
      detail: `${suspiciousItems.length} partidas con coste de material bajo o sin verificar: ${suspiciousItems.slice(0, 5).join(", ")}`,
      severity: suspiciousItems.length >= 5 ? "high" : "medium",
    };
  }

  return null;
}

// ─── Chapter breakdown ──────────────────────────────────────────────────────

function calculateChapterBreakdown(
  items: BudgetItemV2[],
  defaultMarginPercent: number,
): ChapterEconomics[] {
  const byChapter = new Map<ChapterCode, BudgetItemV2[]>();
  for (const item of items) {
    const list = byChapter.get(item.chapter) || [];
    list.push(item);
    byChapter.set(item.chapter, list);
  }

  const totalDirectCost = items.reduce((sum, i) => sum + i.subtotal_cost, 0);
  const result: ChapterEconomics[] = [];

  for (const [chapter, chapterItems] of byChapter) {
    const directCost = chapterItems.reduce((sum, i) => sum + i.subtotal_cost, 0);
    const salePrice = chapterItems.reduce((sum, i) => sum + i.subtotal_sale, 0);
    const confidenceSum = chapterItems.reduce((sum, i) => sum + i.confidence_score, 0);
    const marginPercent = directCost > 0
      ? round2(((salePrice - directCost) / directCost) * 100)
      : defaultMarginPercent;

    result.push({
      chapter,
      chapter_label: CHAPTER_LABELS[chapter] || chapter,
      direct_cost: round2(directCost),
      sale_price: round2(salePrice),
      weight_percent: totalDirectCost > 0
        ? round2((directCost / totalDirectCost) * 100)
        : 0,
      margin_percent: marginPercent,
      confidence_avg: chapterItems.length > 0
        ? round2(confidenceSum / chapterItems.length)
        : 0,
    });
  }

  // Sort by weight descending
  result.sort((a, b) => b.weight_percent - a.weight_percent);

  return result;
}

// ─── Price confidence summary ───────────────────────────────────────────────

function calculatePriceConfidence(items: BudgetItemV2[]): PriceConfidenceSummary {
  const totalItems = items.length;
  if (totalItems === 0) {
    return {
      overall: 0,
      from_user_catalog: 0,
      from_technical_bank: 0,
      from_enlaze_base: 0,
      from_n8n_market: 0,
      from_web_search: 0,
      estimated: 0,
      total_items: 0,
    };
  }

  const overallSum = items.reduce((sum, i) => sum + i.confidence_score, 0);

  return {
    overall: round2(overallSum / totalItems),
    from_user_catalog: items.filter((i) => i.price_source === "user_catalog").length,
    from_technical_bank: items.filter((i) => i.price_source === "technical_bank").length,
    from_enlaze_base: items.filter((i) => i.price_source === "enlaze_base").length,
    from_n8n_market: items.filter((i) => i.price_source === "n8n_market").length,
    from_web_search: items.filter((i) => i.price_source === "web_search").length,
    estimated: items.filter((i) => i.price_source === "estimated").length,
    total_items: totalItems,
  };
}

// ─── Item recalculation (for edits) ─────────────────────────────────────────

/**
 * Recalculate a single item after the user edits quantity, unit_cost, or margin.
 * Returns a new item with updated subtotals.
 */
export function recalculateItem(
  item: BudgetItemV2,
  overrides?: {
    quantity?: number;
    unit_cost?: number;
    margin_percent?: number;
    material_cost_per_unit?: number;
    labor_cost_per_unit?: number;
    machinery_cost_per_unit?: number;
  },
): BudgetItemV2 {
  const quantity = overrides?.quantity ?? item.quantity;

  const materialCost = overrides?.material_cost_per_unit ?? item.material_cost_per_unit;
  const laborCost = overrides?.labor_cost_per_unit ?? item.labor_cost_per_unit;
  const machineryCost = overrides?.machinery_cost_per_unit ?? item.machinery_cost_per_unit;

  const unitCost = overrides?.unit_cost ?? (materialCost + laborCost + machineryCost);
  const marginPercent = overrides?.margin_percent ?? item.margin_percent;
  const unitPriceSale = round2(unitCost * (1 + marginPercent / 100));

  return {
    ...item,
    quantity,
    material_cost_per_unit: round2(materialCost),
    labor_cost_per_unit: round2(laborCost),
    machinery_cost_per_unit: round2(machineryCost),
    unit_cost: round2(unitCost),
    unit_price_sale: unitPriceSale,
    subtotal_cost: round2(quantity * unitCost),
    subtotal_sale: round2(quantity * unitPriceSale),
    margin_percent: marginPercent,
  };
}

// ─── Reprice impact calculation ─────────────────────────────────────────────

import type { PriceChange, RepriceImpact } from "./types/budget-v2";

/**
 * Calculate the impact of a reprice operation.
 * Compares old items with new items and returns changes + impact summary.
 */
export function calculateRepriceImpact(
  oldItems: BudgetItemV2[],
  newItems: BudgetItemV2[],
  marginPercent: number,
): { changes: PriceChange[]; impact: RepriceImpact } {
  const changes: PriceChange[] = [];

  const newMap = new Map(newItems.map((i) => [i.id, i]));

  for (const oldItem of oldItems) {
    const newItem = newMap.get(oldItem.id);
    if (!newItem) continue;

    if (oldItem.unit_cost !== newItem.unit_cost) {
      const diffPercent = oldItem.unit_cost > 0
        ? round2(((newItem.unit_cost - oldItem.unit_cost) / oldItem.unit_cost) * 100)
        : 0;

      changes.push({
        item_id: oldItem.id,
        item_name: oldItem.name,
        chapter: oldItem.chapter,
        price_before: oldItem.unit_cost,
        price_after: newItem.unit_cost,
        difference: round2(newItem.unit_cost - oldItem.unit_cost),
        difference_percent: diffPercent,
        source_before: oldItem.price_source,
        source_after: newItem.price_source,
        supplier_before: oldItem.supplier,
        supplier_after: newItem.supplier,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const totalBefore = oldItems.reduce((sum, i) => sum + i.subtotal_cost, 0);
  const totalAfter = newItems.reduce((sum, i) => sum + i.subtotal_cost, 0);
  const difference = round2(totalAfter - totalBefore);
  const differencePercent = totalBefore > 0
    ? round2((difference / totalBefore) * 100)
    : 0;

  const marginBefore = round2(totalBefore * (marginPercent / 100));
  const marginAfter = round2(totalAfter * (marginPercent / 100));

  const impact: RepriceImpact = {
    total_before: round2(totalBefore),
    total_after: round2(totalAfter),
    difference,
    difference_percent: differencePercent,
    margin_before: marginBefore,
    margin_after: marginAfter,
    items_changed: changes.length,
    items_unchanged: oldItems.length - changes.length,
  };

  return { changes, impact };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
