/**
 * budget-validator.ts
 *
 * FASE 6 del generador de presupuestos v2.
 * Validacion automatica pre-entrega del presupuesto.
 *
 * 100% determinista — sin IA, sin llamadas externas.
 * Ejecuta 6 categorias de checks: completeness, quantities, pricing,
 * profitability, duration, consistency.
 *
 * Solo muestra warnings relevantes (ver seccion 9.2 de la arquitectura).
 */

import type {
  BudgetItemV2,
  BudgetEconomics,
  BudgetTimeline,
  ProjectAnalysis,
  BudgetScopeV2,
  ValidationReport,
  ValidationCheck,
  ValidationWarning,
  EstimatedItemInfo,
} from "./types/budget-v2";

// ─── Core validation ────────────────────────────────────────────────────────

/**
 * FASE 6: Validate a complete budget before delivery.
 *
 * Pure function — no side effects, no DB calls.
 *
 * @param items - BudgetItemV2[] with prices resolved
 * @param economics - BudgetEconomics from FASE 4
 * @param analysis - ProjectAnalysis from FASE 1
 * @param scope - BudgetScopeV2 original input
 * @param timeline - BudgetTimeline from FASE 5 (optional)
 */
export function validateBudget(
  items: BudgetItemV2[],
  economics: BudgetEconomics,
  analysis: ProjectAnalysis,
  scope: BudgetScopeV2,
  timeline: BudgetTimeline | null,
): ValidationReport {
  const checks: ValidationCheck[] = [];
  const warnings: ValidationWarning[] = [];
  const suggestions: string[] = [];
  const contradictions: string[] = [];

  // Run all check categories
  runCompletenessChecks(items, analysis, checks, warnings, suggestions);
  runQuantityChecks(items, scope, checks, warnings, suggestions);
  runPricingChecks(items, checks, warnings);
  runProfitabilityChecks(items, economics, checks, warnings);
  runDurationChecks(items, timeline, checks, warnings);
  runConsistencyChecks(items, economics, checks, warnings);

  // Collect estimated items
  const estimatedItems = collectEstimatedItems(items);

  // Calculate score (0-100)
  const score = calculateScore(checks, warnings);

  // Is valid? Pass if score >= 60 and no "fail" checks
  const hasFails = checks.some(c => c.status === "fail");
  const isValid = score >= 60 && !hasFails;

  return {
    is_valid: isValid,
    score,
    checks,
    warnings,
    suggestions,
    estimated_items: estimatedItems,
    contradictions,
  };
}

// ─── COMPLETENESS checks ────────────────────────────────────────────────────

function runCompletenessChecks(
  items: BudgetItemV2[],
  analysis: ProjectAnalysis,
  checks: ValidationCheck[],
  warnings: ValidationWarning[],
  suggestions: string[],
): void {
  // Check 1: All required chapters from analysis are present
  const activeChapters = new Set(items.map(i => i.chapter));
  const requiredChapters = analysis.required_chapters.map(c => c.code);
  const missingChapters = requiredChapters.filter(c => !activeChapters.has(c));

  if (missingChapters.length === 0) {
    checks.push({
      category: "completeness",
      check: "Capitulos requeridos presentes",
      status: "pass",
      detail: `${requiredChapters.length}/${requiredChapters.length} capitulos presentes`,
    });
  } else {
    checks.push({
      category: "completeness",
      check: "Capitulos requeridos presentes",
      status: missingChapters.length <= 2 ? "warning" : "fail",
      detail: `Faltan ${missingChapters.length} capitulos: ${missingChapters.join(", ")}`,
    });
    warnings.push({
      severity: missingChapters.length <= 2 ? "medium" : "high",
      category: "completeness",
      message: `Faltan capitulos requeridos: ${missingChapters.join(", ")}`,
      affected_items: [],
    });
  }

  // Check 2: No duplicate items (same name + chapter)
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const item of items) {
    if (item.priority === "opcional") continue;
    const key = `${item.chapter}|${item.name.toLowerCase().trim()}`;
    if (seen.has(key)) {
      duplicates.push(item.name);
    }
    seen.add(key);
  }

  checks.push({
    category: "completeness",
    check: "Partidas duplicadas",
    status: duplicates.length === 0 ? "pass" : "warning",
    detail: duplicates.length === 0
      ? "0 duplicados encontrados"
      : `${duplicates.length} posibles duplicados: ${duplicates.slice(0, 3).join(", ")}`,
  });

  // Check 3: Each active chapter has at least 1 item
  const emptyChapters: string[] = [];
  for (const ch of requiredChapters) {
    const chapterItems = items.filter(i => i.chapter === ch && i.priority !== "opcional");
    if (chapterItems.length === 0 && activeChapters.has(ch)) {
      emptyChapters.push(ch);
    }
  }

  if (emptyChapters.length > 0) {
    checks.push({
      category: "completeness",
      check: "Capitulos con partidas",
      status: "warning",
      detail: `${emptyChapters.length} capitulos sin partidas obligatorias`,
    });
  }

  // Suggestions from commonly_forgotten
  if (analysis.commonly_forgotten && analysis.commonly_forgotten.length > 0) {
    for (const forgotten of analysis.commonly_forgotten) {
      suggestions.push(`Considerar: ${forgotten}`);
    }
  }
}

// ─── QUANTITIES checks ──────────────────────────────────────────────────────

function runQuantityChecks(
  items: BudgetItemV2[],
  scope: BudgetScopeV2,
  checks: ValidationCheck[],
  warnings: ValidationWarning[],
  suggestions: string[],
): void {
  const surfaceM2 = scope.surface_m2;

  // Check: m2 pavimento compatible with surface
  const pavimentoItems = items.filter(i => i.chapter === "pavimentos" && i.unit === "m2");
  const totalPavimentoM2 = pavimentoItems.reduce((sum, i) => sum + i.quantity, 0);

  if (pavimentoItems.length > 0) {
    // Pavimento should be roughly equal to surface (+-30%)
    const ratio = surfaceM2 > 0 ? totalPavimentoM2 / surfaceM2 : 0;
    if (ratio >= 0.7 && ratio <= 1.3) {
      checks.push({
        category: "quantities",
        check: "Coherencia m2 pavimento vs superficie",
        status: "pass",
        detail: `${totalPavimentoM2} m2 pavimento para ${surfaceM2} m2 de vivienda`,
      });
    } else if (ratio > 0) {
      checks.push({
        category: "quantities",
        check: "Coherencia m2 pavimento vs superficie",
        status: "warning",
        detail: `${totalPavimentoM2} m2 pavimento vs ${surfaceM2} m2 superficie (ratio ${ratio.toFixed(2)})`,
      });
      if (ratio < 0.7) {
        suggestions.push("Los m2 de pavimento parecen bajos para la superficie total. Revisar mediciones.");
      }
    }
  }

  // Check: m2 pintura compatible with surface
  const pinturaItems = items.filter(i => i.chapter === "pintura" && i.unit === "m2");
  const totalPinturaM2 = pinturaItems.reduce((sum, i) => sum + i.quantity, 0);

  if (pinturaItems.length > 0 && surfaceM2 > 0) {
    // Paint area typically 2.5-4x floor area (walls + ceiling)
    const paintRatio = totalPinturaM2 / surfaceM2;
    if (paintRatio >= 1.5 && paintRatio <= 5.0) {
      checks.push({
        category: "quantities",
        check: "Coherencia m2 pintura vs superficie",
        status: "pass",
        detail: `${totalPinturaM2} m2 pintura para ${surfaceM2} m2 (ratio ${paintRatio.toFixed(1)}x)`,
      });
    } else {
      checks.push({
        category: "quantities",
        check: "Coherencia m2 pintura vs superficie",
        status: "warning",
        detail: `${totalPinturaM2} m2 pintura para ${surfaceM2} m2 (ratio ${paintRatio.toFixed(1)}x, esperado 2-4x)`,
      });
    }
  }

  // Check: num sanitarios compatible with num_banos
  const sanitarioItems = items.filter(
    i => i.chapter === "sanitarios" && i.unit === "ud" && i.priority !== "opcional",
  );
  const totalSanitarios = sanitarioItems.reduce((sum, i) => sum + i.quantity, 0);

  if (scope.num_bathrooms > 0 && sanitarioItems.length > 0) {
    // At least 2 sanitarios per bathroom (inodoro + lavabo minimum)
    const minExpected = scope.num_bathrooms * 2;
    if (totalSanitarios >= minExpected) {
      checks.push({
        category: "quantities",
        check: "Sanitarios compatibles con numero de banos",
        status: "pass",
        detail: `${totalSanitarios} sanitarios para ${scope.num_bathrooms} banos`,
      });
    } else {
      checks.push({
        category: "quantities",
        check: "Sanitarios compatibles con numero de banos",
        status: "warning",
        detail: `Solo ${totalSanitarios} sanitarios para ${scope.num_bathrooms} banos (minimo esperado: ${minExpected})`,
      });
      warnings.push({
        severity: "medium",
        category: "quantities",
        message: `Numero de sanitarios parece bajo para ${scope.num_bathrooms} banos`,
        affected_items: sanitarioItems.map(i => i.id),
      });
    }
  }

  // Check: zero quantities
  const zeroQtyItems = items.filter(i => i.quantity <= 0 && i.priority !== "opcional");
  if (zeroQtyItems.length > 0) {
    checks.push({
      category: "quantities",
      check: "Partidas con cantidad cero",
      status: "fail",
      detail: `${zeroQtyItems.length} partidas con cantidad 0 o negativa`,
    });
    warnings.push({
      severity: "high",
      category: "quantities",
      message: `${zeroQtyItems.length} partidas obligatorias con cantidad cero`,
      affected_items: zeroQtyItems.map(i => i.id),
    });
  }
}

// ─── PRICING checks ─────────────────────────────────────────────────────────

function runPricingChecks(
  items: BudgetItemV2[],
  checks: ValidationCheck[],
  warnings: ValidationWarning[],
): void {
  // Check: no zero prices
  const zeroPriceItems = items.filter(
    i => i.unit_cost <= 0 && i.priority !== "opcional" && i.chapter !== "protecciones",
  );

  checks.push({
    category: "pricing",
    check: "Precios unitarios validos",
    status: zeroPriceItems.length === 0 ? "pass" : "warning",
    detail: zeroPriceItems.length === 0
      ? "Todos los precios unitarios son > 0"
      : `${zeroPriceItems.length} partidas con precio unitario 0`,
  });

  if (zeroPriceItems.length > 0) {
    warnings.push({
      severity: "high",
      category: "pricing",
      message: `${zeroPriceItems.length} partidas sin precio asignado`,
      affected_items: zeroPriceItems.map(i => i.id),
    });
  }

  // Check: estimated items with low confidence
  const lowConfidenceItems = items.filter(
    i => i.price_source === "estimated" && i.confidence_score < 0.50,
  );

  if (lowConfidenceItems.length === 0) {
    checks.push({
      category: "pricing",
      check: "Precios verificados",
      status: "pass",
      detail: "Todos los precios tienen confianza >= 0.50",
    });
  } else {
    checks.push({
      category: "pricing",
      check: "Precios verificados",
      status: "warning",
      detail: `${lowConfidenceItems.length} partidas con precios estimados (confianza < 0.50)`,
    });
    warnings.push({
      severity: "medium",
      category: "pricing",
      message: `${lowConfidenceItems.length} partidas con precio estimado. Recomendamos actualizar precios de mercado.`,
      affected_items: lowConfidenceItems.map(i => i.id),
    });
  }

  // Check: average confidence
  const avgConfidence = items.length > 0
    ? items.reduce((sum, i) => sum + i.confidence_score, 0) / items.length
    : 0;

  checks.push({
    category: "pricing",
    check: "Confianza promedio de precios",
    status: avgConfidence >= 0.60 ? "pass" : avgConfidence >= 0.40 ? "warning" : "fail",
    detail: `Confianza promedio: ${(avgConfidence * 100).toFixed(0)}%`,
  });
}

// ─── PROFITABILITY checks ───────────────────────────────────────────────────

function runProfitabilityChecks(
  items: BudgetItemV2[],
  economics: BudgetEconomics,
  checks: ValidationCheck[],
  warnings: ValidationWarning[],
): void {
  const margin = economics.cost_breakdown.margin_percent;

  // Check: global margin >= 10%
  if (margin >= 15) {
    checks.push({
      category: "profitability",
      check: "Margen suficiente",
      status: "pass",
      detail: `Margen global ${margin}%, minimo recomendado 15%`,
    });
  } else if (margin >= 10) {
    checks.push({
      category: "profitability",
      check: "Margen suficiente",
      status: "warning",
      detail: `Margen global ${margin}%, recomendado minimo 15%`,
    });
  } else {
    checks.push({
      category: "profitability",
      check: "Margen suficiente",
      status: "fail",
      detail: `Margen global ${margin}%, muy por debajo del minimo 10%`,
    });
    warnings.push({
      severity: "high",
      category: "profitability",
      message: `Margen global del ${margin}% es insuficiente. Riesgo de perdidas.`,
      affected_items: [],
    });
  }

  // Check: no chapter with negative margin
  const negativeMarginChapters = economics.chapter_breakdown.filter(
    ch => ch.margin_percent < 0,
  );

  if (negativeMarginChapters.length > 0) {
    checks.push({
      category: "profitability",
      check: "Capitulos con margen negativo",
      status: "fail",
      detail: `${negativeMarginChapters.length} capitulos con margen negativo: ${negativeMarginChapters.map(c => c.chapter_label).join(", ")}`,
    });
    warnings.push({
      severity: "high",
      category: "profitability",
      message: `Capitulos con margen negativo: ${negativeMarginChapters.map(c => c.chapter_label).join(", ")}`,
      affected_items: [],
    });
  } else {
    checks.push({
      category: "profitability",
      check: "Capitulos con margen negativo",
      status: "pass",
      detail: "Ningun capitulo con margen negativo",
    });
  }

  // Check: indirect costs included
  if (economics.cost_breakdown.indirect_costs > 0) {
    checks.push({
      category: "profitability",
      check: "Costes indirectos incluidos",
      status: "pass",
      detail: `${economics.cost_breakdown.indirect_costs_percent}% costes indirectos (${economics.cost_breakdown.indirect_costs.toFixed(2)} EUR)`,
    });
  } else {
    checks.push({
      category: "profitability",
      check: "Costes indirectos incluidos",
      status: "warning",
      detail: "No se han incluido costes indirectos",
    });
  }

  // Check: undervaluation (from economics)
  if (economics.undervaluation_check.is_undervalued) {
    // Only show if margin < 15% or confidence < 0.60 (per section 9.2)
    const avgConfidence = items.length > 0
      ? items.reduce((sum, i) => sum + i.confidence_score, 0) / items.length
      : 0;
    const shouldShow = margin < 15 || avgConfidence < 0.60;

    if (shouldShow) {
      checks.push({
        category: "profitability",
        check: "Presupuesto no infravalorado",
        status: "warning",
        detail: `${economics.undervaluation_check.score} indicadores de infravaloracion positivos`,
      });
      for (const w of economics.undervaluation_check.warnings) {
        warnings.push({
          severity: w.severity,
          category: "profitability",
          message: `Infravaloracion: ${w.indicator} - ${w.detail}`,
          affected_items: [],
        });
      }
    }
  } else {
    const perM2 = economics.per_m2;
    checks.push({
      category: "profitability",
      check: "Presupuesto no infravalorado",
      status: "pass",
      detail: `${perM2.sale} EUR/m2, rango mercado ${perM2.market_reference_min}-${perM2.market_reference_max} EUR/m2`,
    });
  }
}

// ─── DURATION checks ────────────────────────────────────────────────────────

function runDurationChecks(
  items: BudgetItemV2[],
  timeline: BudgetTimeline | null,
  checks: ValidationCheck[],
  warnings: ValidationWarning[],
): void {
  if (!timeline) return;

  const totalHours = items.reduce((sum, i) => sum + i.estimated_hours, 0);
  const workers = timeline.recommended_crew.workers_total;
  const minDaysNeeded = workers > 0 ? Math.ceil(totalHours / (workers * 8)) : 0;

  // Check: duration >= minimum required
  if (timeline.estimated_duration.working_days_min >= minDaysNeeded) {
    checks.push({
      category: "duration",
      check: "Duracion realista",
      status: "pass",
      detail: `${timeline.estimated_duration.weeks_min}-${timeline.estimated_duration.weeks_max} semanas para ${items.length} partidas`,
    });
  } else {
    checks.push({
      category: "duration",
      check: "Duracion realista",
      status: "warning",
      detail: `Duracion estimada ${timeline.estimated_duration.working_days_min} dias, pero se necesitan minimo ${minDaysNeeded} dias con ${workers} trabajadores`,
    });
    warnings.push({
      severity: "medium",
      category: "duration",
      message: `La duracion estimada puede ser insuficiente para las cantidades del presupuesto`,
      affected_items: [],
    });
  }

  // Check: no phases with 0 duration
  const zeroDurationPhases = timeline.phases.filter(p => p.duration_days <= 0);
  if (zeroDurationPhases.length > 0) {
    checks.push({
      category: "duration",
      check: "Fases con duracion valida",
      status: "warning",
      detail: `${zeroDurationPhases.length} fases con duracion 0`,
    });
  }
}

// ─── CONSISTENCY checks ─────────────────────────────────────────────────────

function runConsistencyChecks(
  items: BudgetItemV2[],
  economics: BudgetEconomics,
  checks: ValidationCheck[],
  _warnings: ValidationWarning[],
): void {
  // Check: subtotals = quantity * unit_price
  const inconsistentSubtotals: string[] = [];
  for (const item of items) {
    const expectedCost = round2(item.quantity * item.unit_cost);
    const expectedSale = round2(item.quantity * item.unit_price_sale);

    if (Math.abs(item.subtotal_cost - expectedCost) > 0.02) {
      inconsistentSubtotals.push(`${item.code}: subtotal_cost ${item.subtotal_cost} != ${expectedCost}`);
    }
    if (Math.abs(item.subtotal_sale - expectedSale) > 0.02) {
      inconsistentSubtotals.push(`${item.code}: subtotal_sale ${item.subtotal_sale} != ${expectedSale}`);
    }
  }

  checks.push({
    category: "consistency",
    check: "Subtotales correctos",
    status: inconsistentSubtotals.length === 0 ? "pass" : "warning",
    detail: inconsistentSubtotals.length === 0
      ? "Todos los subtotales son coherentes"
      : `${inconsistentSubtotals.length} inconsistencias en subtotales`,
  });

  // Check: total items = sum of chapters
  const totalFromItems = round2(items.reduce((sum, i) => sum + i.subtotal_cost, 0));
  const totalFromChapters = round2(
    economics.chapter_breakdown.reduce((sum, c) => sum + c.direct_cost, 0),
  );

  if (Math.abs(totalFromItems - totalFromChapters) <= 1.0) {
    checks.push({
      category: "consistency",
      check: "Total coherente entre partidas y capitulos",
      status: "pass",
      detail: `Total partidas: ${totalFromItems} EUR, total capitulos: ${totalFromChapters} EUR`,
    });
  } else {
    checks.push({
      category: "consistency",
      check: "Total coherente entre partidas y capitulos",
      status: "warning",
      detail: `Diferencia: ${Math.abs(totalFromItems - totalFromChapters).toFixed(2)} EUR entre partidas (${totalFromItems}) y capitulos (${totalFromChapters})`,
    });
  }

  // Check: IVA calculated correctly
  const expectedTax = round2(economics.cost_breakdown.sale_price_before_tax * economics.cost_breakdown.tax_percent / 100);
  if (Math.abs(economics.cost_breakdown.tax_amount - expectedTax) <= 0.02) {
    checks.push({
      category: "consistency",
      check: "IVA calculado correctamente",
      status: "pass",
      detail: `IVA ${economics.cost_breakdown.tax_percent}%: ${economics.cost_breakdown.tax_amount} EUR`,
    });
  } else {
    checks.push({
      category: "consistency",
      check: "IVA calculado correctamente",
      status: "fail",
      detail: `IVA calculado ${economics.cost_breakdown.tax_amount} EUR vs esperado ${expectedTax} EUR`,
    });
  }
}

// ─── Estimated items collection ─────────────────────────────────────────────

function collectEstimatedItems(items: BudgetItemV2[]): EstimatedItemInfo[] {
  return items
    .filter(i => i.price_source === "estimated" && i.confidence_score < 0.50)
    .map(i => ({
      item_id: i.id,
      concept: i.name,
      reason: i.price_source_detail || "Sin precio verificado en banco tecnico ni proveedor",
      estimated_price: i.unit_cost,
      confidence: i.confidence_score,
    }));
}

// ─── Score calculation ──────────────────────────────────────────────────────

function calculateScore(
  checks: ValidationCheck[],
  validationWarnings: ValidationWarning[],
): number {
  if (checks.length === 0) return 100;

  let score = 100;

  // Deduct per check status
  for (const check of checks) {
    if (check.status === "fail") score -= 15;
    if (check.status === "warning") score -= 5;
  }

  // Deduct per warning severity
  for (const w of validationWarnings) {
    if (w.severity === "high") score -= 3;
    if (w.severity === "medium") score -= 1;
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
