import {
  buildDeterministicBudgetItems,
  buildScopeMaterials,
  estimateRealisticTimeline,
  getMarketRange,
  type BudgetScope,
} from "./budget-engine";
import { TECHNICAL_ENGINE_SUMMARY } from "./ai-usage-policy";

interface DeterministicAnalysisInput {
  sector?: string;
  serviceType?: string;
  scope: BudgetScope;
  trackerProductsCount?: number;
  reason?: string;
}

/** API-compatible analysis generated without an external language model. */
export function buildDeterministicBudgetAnalysis({
  sector = "construccion",
  serviceType = "reforma",
  scope,
  trackerProductsCount = 0,
  reason = "external_enhancement_unavailable",
}: DeterministicAnalysisInput) {
  const items = buildDeterministicBudgetItems(scope, 1);
  const materials = buildScopeMaterials(scope);
  const marketRange = getMarketRange(scope, serviceType);
  const timeline = estimateRealisticTimeline(scope, items);
  const providerStats = new Map<string, { count: number; total: number }>();

  for (const material of materials) {
    const current = providerStats.get(material.provider_id) || { count: 0, total: 0 };
    current.count += 1;
    current.total += material.subtotal;
    providerStats.set(material.provider_id, current);
  }

  const providerNames: Record<string, string> = {
    "leroy-merlin": "Leroy Merlin",
    obramat: "OBRAMAT",
    saltoki: "Saltoki",
    "referencia-mercado": "Referencia mercado",
  };
  const totalDurationDays = Math.round(
    (timeline.execution_working_days_min + timeline.execution_working_days_max) / 2,
  );

  return {
    summary: TECHNICAL_ENGINE_SUMMARY,
    confidence_score: trackerProductsCount > 0 ? 78 : 68,
    source: "enlaze_deterministic_engine",
    analysis_mode: "deterministic_engine",
    detected_scope: {
      sector,
      service_type: serviceType || "general",
      area_m2: scope.superficie_m2,
      location: scope.ubicacion,
      project_context: scope.project_context || "existing_renovation",
      existing_condition: scope.existing_condition || "unknown",
      conservation_strategy: scope.conservation_strategy || "balanced",
    },
    suggested_items: items.map((item) => ({
      concept: item.concept,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_cost: item.unit_price,
      margin_pct: 20,
      category: item.category,
      chapter: item.chapter,
      estimated_hours: item.estimated_hours,
    })),
    suggested_materials: materials.map((material) => ({
      concept: material.name,
      quantity: material.quantity,
      unit: material.unit,
      unit_cost: material.unit_price,
      supplier_name: providerNames[material.provider_id] || "Referencia mercado",
      source: "provisional_pending_tracker",
      source_type: "estimated",
    })),
    provider_options: Array.from(providerStats.entries()).map(([providerId, stats]) => ({
      name: providerNames[providerId] || providerId,
      materials_count: stats.count,
      estimated_total: Math.round(stats.total * 100) / 100,
      source: "provisional_pending_tracker",
    })),
    regulatory_notes: [],
    calendar_phases: timeline.phase_breakdown.map((phase) => ({
      title: phase.title,
      duration_days: Math.round((phase.duration_days_min + phase.duration_days_max) / 2),
      description: phase.description,
      depends_on: phase.depends_on || [],
    })),
    estimated_timeline: {
      total_duration_days: totalDurationDays,
      total_duration_weeks: Math.ceil(totalDurationDays / 5),
      confidence: 0.75,
      notes: `Ejecución estimada: ${timeline.execution_weeks_min}-${timeline.execution_weeks_max} semanas. Plazo total recomendado: ${timeline.total_weeks_min}-${timeline.total_weeks_max} semanas.`,
    },
    estimated_price_range: marketRange,
    pricing_confidence: trackerProductsCount > 0 ? 76 : 65,
    price_warnings: [],
    missing_questions: [
      ...(scope.superficie_m2 > 0 ? [] : ["Indica la superficie afectada para afinar cantidades e importe."]),
      ...((scope.project_context || "existing_renovation") !== "new_build" && (!scope.existing_condition || scope.existing_condition === "unknown")
        ? ["Confirma mediante visita el estado de soportes e instalaciones antes de cerrar el presupuesto."]
        : []),
    ],
    data_sources: {
      tracker_products_count: trackerProductsCount,
      analysis_mode: "deterministic_engine",
      using_ai_fallback: true,
      ai_fallback_reason: reason,
    },
  };
}
