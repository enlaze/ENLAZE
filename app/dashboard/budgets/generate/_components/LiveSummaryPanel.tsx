"use client";

import React from "react";
import { Building2, BarChart3, Sparkles } from "lucide-react";
import { useBudgetGenerate } from "./BudgetGenerateProvider";

export function LiveSummaryPanel() {
  const { state, nextStep, saveDraft, analyzeWithAI } = useBudgetGenerate();
  const { totals, marginPercent, sector, providerOptions, selectedProviderId, materials, isRealDataMode } = state;
  const isConstruction = sector === "construccion";

  const totalWithIva = totals.clientPrice * (1 + state.ivaPercent / 100);

  const activeProvider = providerOptions?.find(p => p.id === selectedProviderId);
  const appliedCommercialProviders = providerOptions?.filter((provider) => provider.isRealData) || [];
  const providerSummaryName = appliedCommercialProviders.length > 1
    ? `Cesta multiproveedor (${appliedCommercialProviders.length})`
    : activeProvider?.name || "Referencia técnica ENLAZE";
  const includedMaterialsCount = materials?.filter(m => m.included).length || 0;

  // Real data check
  // Real data check (don't show as real if it's default/fallback)
  const isMaterialBasketReal =
    state.priceVerification.verified > 0 ||
    (isRealDataMode && activeProvider?.isRealData && activeProvider?.name !== "Banco ENLAZE base" && activeProvider?.name !== "Referencia mercado");

  // EUR/m2 calculation — user scope always takes priority
  let detectedArea = state.realismAudit.effectiveAreaM2 || state.sectorData?.superficie_m2 || state.aiInsights?.detected_area_m2;
  if (!detectedArea && isConstruction) {
    const match = (state.description || "").match(/(\d+)\s*(m2|metros|m²)/i);
    if (match) detectedArea = parseInt(match[1], 10);
  }
  const pricePerM2 = detectedArea && detectedArea > 0 ? totals.clientPrice / detectedArea : null;
  const pvpPerM2 = detectedArea && detectedArea > 0 ? totalWithIva / detectedArea : null;

  let priceRange = state.realismAudit.recalculatedAt && detectedArea
    ? {
        min: state.realismAudit.marketMinPerM2 * detectedArea,
        max: state.realismAudit.marketMaxPerM2 * detectedArea,
      }
    : state.aiInsights?.estimated_price_range;
  if (!priceRange && detectedArea && detectedArea > 0 && isConstruction) {
    const serviceType = (state.serviceType || state.description || "").toLowerCase();
    let minExpected = 400;
    let maxExpected = 900;
    if (serviceType.includes("integral") || serviceType.includes("completa")) {
      minExpected = 500; maxExpected = 1200;
    } else if (serviceType.includes("baño") || serviceType.includes("cocina")) {
      minExpected = 600; maxExpected = 1500;
    } else if (serviceType.includes("parcial") || serviceType.includes("pintura")) {
      minExpected = 100; maxExpected = 400;
    }
    priceRange = { min: detectedArea * minExpected, max: detectedArea * maxExpected };
  }

  // Timeline — use realistic timeline from engine if available
  const realisticTimeline = state.realisticTimeline;
  let estimatedTimeline = state.aiInsights?.estimated_timeline;
  if (!estimatedTimeline && realisticTimeline) {
    estimatedTimeline = {
      total_duration_weeks: realisticTimeline.execution_weeks_min,
      total_duration_days: realisticTimeline.execution_weeks_min * 5,
    };
  }

  let endDateValue = state.endDate ? new Date(state.endDate) : null;
  if (!endDateValue && state.startDate && estimatedTimeline?.total_duration_days) {
    endDateValue = new Date(state.startDate);
    let workingDays = parseInt(estimatedTimeline.total_duration_days.toString(), 10);
    while (workingDays > 0) {
      endDateValue.setDate(endDateValue.getDate() + 1);
      const day = endDateValue.getDay();
      if (day !== 0 && day !== 6) workingDays--;
    }
  }

  const endDateFormatted = endDateValue
    ? endDateValue.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const startDateFormatted = state.startDate
    ? new Date(state.startDate).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })
    : null;

  // Data sources
  let dataSources = state.aiInsights?.data_sources;
  if (!dataSources) {
    const n8nCount = providerOptions?.filter(p => p.sourceType === "n8n_sync").reduce((sum, p) => sum + (p.materialsCount || 0), 0) || 0;
    const defaultCount = providerOptions?.filter(p => p.sourceType === "default" || p.sourceType === "market_reference").reduce((sum, p) => sum + (p.materialsCount || 0), 0) || 0;
    dataSources = {
      n8n_items_count: n8nCount,
      default_items_count: defaultCount,
      using_fallback: n8nCount === 0,
      fallback_reason: "Catálogo real insuficiente: usando banco base y referencias estimadas",
      real_suppliers: [],
      price_items_count: n8nCount + defaultCount,
      sector_price_count: 0,
      sector_regulation_count: 0
    };
  }
  const trackerProductsAvailable =
    dataSources?.tracker_products_count ||
    state.priceVerification.trackerProductsAvailable ||
    0;
  const hasConnectedTracker = trackerProductsAvailable > 0;
  const verifiedMaterials = state.priceVerification.verified;
  const totalMaterialsToVerify = state.priceVerification.total;
  const pendingMaterials = state.priceVerification.estimated;



  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-navy-100 dark:border-zinc-800 shadow-sm p-6">
      <h3 className="text-lg font-bold text-navy-900 dark:text-white mb-4">Resumen en vivo</h3>

      {isConstruction && activeProvider && (() => {
        const matchedCount = materials?.filter(m => (m as any).provider_adjustment?.applied === true).length || 0;
        const missingCount = materials?.filter(m => (m as any).missing_in_selected_provider === true).length || 0;
        const hasEnrichment = matchedCount > 0 || missingCount > 0;
        return (
          <div className="bg-navy-50 dark:bg-zinc-800/50 p-3 rounded-xl mb-4 border border-navy-100 dark:border-zinc-700">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-white dark:bg-zinc-700 flex items-center justify-center shadow-sm">
                <Building2 className="h-4 w-4 text-[#00c896]" />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-center">
                  <div className="text-[10px] text-navy-500 dark:text-zinc-400 uppercase tracking-wider font-bold">Origen de la cesta</div>
                  {isMaterialBasketReal && (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 rounded">Catalogo Real</span>
                  )}
                </div>
                <div className="text-sm font-bold text-navy-900 dark:text-white">{providerSummaryName}</div>
              </div>
            </div>
            {hasEnrichment && (
              <div className="mt-2 pt-2 border-t border-navy-200/50 dark:border-zinc-700/50 flex flex-wrap gap-2">
                <span className="text-[10px] font-semibold text-green-600 dark:text-green-400 flex items-center gap-0.5">
                  <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  {matchedCount} de {includedMaterialsCount} con precio
                </span>
                {missingCount > 0 && (
                  <span className="text-[10px] font-semibold text-amber-500 dark:text-amber-400 flex items-center gap-0.5">
                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                    {missingCount} sin precio exacto
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <div className="space-y-4 mb-6">
        <div className="flex justify-between items-center text-sm">
          <span className="text-navy-600 dark:text-zinc-400">
            {isConstruction ? "Coste de ejecución por partidas" : "Coste de ejecución"}
          </span>
          <span className="font-semibold text-navy-900 dark:text-white">{totals.directCost.toFixed(2)} EUR</span>
        </div>

        {isConstruction && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-navy-600 dark:text-zinc-400">
              Cesta de materiales incluida ({includedMaterialsCount})
            </span>
            <div className="flex items-center gap-2">
              {!isMaterialBasketReal && includedMaterialsCount > 0 && (
                <span className="text-[10px] uppercase font-bold text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-1 rounded" title="Precios simulados/estimados">Estimado</span>
              )}
              <span className="font-semibold text-navy-900 dark:text-white">{totals.materialsCost.toFixed(2)} EUR</span>
            </div>
          </div>
        )}

        {isConstruction && includedMaterialsCount > 0 && (
          <p className="-mt-2 text-[10px] leading-4 text-navy-400 dark:text-zinc-500">
            La cesta actualiza el componente de material de las partidas; no se suma una segunda vez.
          </p>
        )}

        <div className="flex justify-between items-center text-sm">
          <span className="text-navy-600 dark:text-zinc-400">
            Margen sugerido ({marginPercent}%)
          </span>
          <span className="font-semibold text-brand-green">+{totals.profit.toFixed(2)} EUR</span>
        </div>

        <div className="pt-4 border-t border-navy-100 dark:border-zinc-800">
          <div className="flex justify-between items-center">
            <span className="text-navy-900 dark:text-white font-medium">Precio final (Sin IVA)</span>
            <span className="text-lg font-bold text-navy-900 dark:text-white">{totals.clientPrice.toFixed(2)} EUR</span>
          </div>
          <div className="flex justify-between items-center mt-1 text-sm text-navy-500 dark:text-zinc-500">
            <span>IVA ({state.ivaPercent}%)</span>
            <span>{(totals.clientPrice * (state.ivaPercent / 100)).toFixed(2)} EUR</span>
          </div>
        </div>

        <div className="bg-navy-50 dark:bg-zinc-800/50 p-3 rounded-xl mt-2 flex justify-between items-center">
          <span className="text-sm font-bold text-navy-900 dark:text-white">PVP Cliente</span>
          <span className="text-xl font-black text-brand-green">{totalWithIva.toFixed(2)} EUR</span>
        </div>

        {/* EUR/m2 indicator for construction */}
        {isConstruction && pricePerM2 !== null && (
          <div className="bg-navy-50 dark:bg-zinc-800/50 p-3 rounded-xl mt-1">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-navy-600 dark:text-zinc-400 uppercase tracking-wider">Precio sin IVA / m2</span>
              <span className={`text-sm font-bold ${
                priceRange && pricePerM2 < (priceRange.min / (detectedArea || 1)) ? 'text-red-500' :
                priceRange && pricePerM2 > (priceRange.max / (detectedArea || 1)) ? 'text-amber-500' :
                'text-brand-green'
              }`}>
                {pricePerM2.toFixed(0)} EUR/m2
              </span>
            </div>
            {pvpPerM2 !== null && (
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-navy-500 dark:text-zinc-400">PVP con IVA / m2</span>
                <span className="text-xs font-bold text-navy-900 dark:text-white">{pvpPerM2.toFixed(0)} EUR/m2</span>
              </div>
            )}
            {priceRange && detectedArea && (
              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] text-navy-400 dark:text-zinc-500">Rango de referencia sin IVA ({detectedArea}m2)</span>
                <span className="text-[10px] text-navy-400 dark:text-zinc-500">
                  {(priceRange.min / detectedArea).toFixed(0)}-{(priceRange.max / detectedArea).toFixed(0)} EUR/m2
                </span>
              </div>
            )}
            {state.isUndervalued && priceRange && (
              <div className="mt-3 p-2 bg-red-50/50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg">
                <p className="text-[10px] text-red-600 dark:text-red-400 font-medium mb-1 flex items-start gap-1">
                  <span className="text-xs">⚠️</span>
                  <span>
                    Presupuesto pendiente de ajuste: esta por debajo del minimo realista de mercado. No se puede finalizar ni descargar PDF cliente.
                  </span>
                </p>
              </div>
            )}
            {!state.isUndervalued && state.marketAdjustMessage && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-2 dark:border-amber-900/30 dark:bg-amber-900/10">
                <p className="flex items-start gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                  <span className="text-xs">ℹ</span>
                  <span>Umbral inferior de referencia aplicado. No es un precio exacto: confirma mediciones, estado existente y ofertas antes de cerrar.</span>
                </p>
              </div>
            )}
            {!state.isUndervalued && !state.marketAdjustMessage && priceRange && pricePerM2 !== null && pricePerM2 < (priceRange.min / (detectedArea || 1)) && (
              <div className="mt-3 p-2 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-lg">
                <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium flex items-start gap-1">
                  <span className="text-xs">⚠️</span>
                  <span>
                    Presupuesto por debajo del rango de mercado ({totals.clientPrice.toLocaleString("es-ES", {maximumFractionDigits: 0})} EUR vs minimo {priceRange.min.toLocaleString("es-ES", {maximumFractionDigits: 0})} EUR).
                  </span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Timeline and dates */}
        {(startDateFormatted || endDateFormatted || estimatedTimeline || realisticTimeline) && (
          <div className="bg-navy-50 dark:bg-zinc-800/50 p-3 rounded-xl mt-1">
            <div className="text-xs font-bold text-navy-600 dark:text-zinc-400 uppercase tracking-wider mb-2">Calendario</div>
            {startDateFormatted && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-navy-500 dark:text-zinc-400">Inicio</span>
                <span className="font-medium text-navy-900 dark:text-white">{startDateFormatted}</span>
              </div>
            )}
            {endDateFormatted && (
              <div className="flex justify-between items-center text-sm mt-1">
                <span className="text-navy-500 dark:text-zinc-400">Fin estimado</span>
                <span className="font-medium text-navy-900 dark:text-white">{endDateFormatted}</span>
              </div>
            )}
            {realisticTimeline ? (
              <>
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-navy-500 dark:text-zinc-400">Preparacion y suministros</span>
                  <span className="font-medium text-navy-900 dark:text-white">
                    {realisticTimeline.preparation_weeks_min}-{realisticTimeline.preparation_weeks_max} semanas
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-navy-500 dark:text-zinc-400">Ejecucion estimada</span>
                  <span className="font-medium text-navy-900 dark:text-white">
                    {realisticTimeline.execution_weeks_min}-{realisticTimeline.execution_weeks_max} semanas
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-navy-500 dark:text-zinc-400">Plazo total recomendado</span>
                  <span className="font-medium text-navy-900 dark:text-white">
                    {realisticTimeline.total_weeks_min}-{realisticTimeline.total_weeks_max} semanas
                  </span>
                </div>
                {typeof realisticTimeline.confidence_percent === "number" && (
                  <div className="mt-2 rounded-lg border border-navy-200 bg-white/70 p-2 dark:border-zinc-700 dark:bg-zinc-900/50">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold uppercase tracking-wider text-navy-500 dark:text-zinc-400">Confianza del plazo</span>
                      <span className={`font-bold ${
                        realisticTimeline.uncertainty_level === "baja"
                          ? "text-green-600"
                          : realisticTimeline.uncertainty_level === "media"
                            ? "text-amber-600"
                            : "text-red-600"
                      }`}>
                        {realisticTimeline.confidence_percent}% · incertidumbre {realisticTimeline.uncertainty_level}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-navy-100 dark:bg-zinc-800">
                      <div className="h-full rounded-full bg-brand-green" style={{ width: `${realisticTimeline.confidence_percent}%` }} />
                    </div>
                  </div>
                )}
                {realisticTimeline.phase_breakdown.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] text-navy-500 dark:text-zinc-400 font-bold uppercase">Ruta critica ({realisticTimeline.phase_breakdown.length} fases)</div>
                    {realisticTimeline.phase_breakdown.slice(0, 6).map((phase, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[10px]">
                        <span className="text-navy-400 dark:text-zinc-500 truncate max-w-[60%]">{phase.title}</span>
                        <span className="text-navy-500 dark:text-zinc-400 font-medium">
                          {phase.duration_days_min}-{phase.duration_days_max}d
                        </span>
                      </div>
                    ))}
                    {realisticTimeline.phase_breakdown.length > 6 && (
                      <div className="text-[10px] text-navy-400 dark:text-zinc-500">+{realisticTimeline.phase_breakdown.length - 6} fases mas</div>
                    )}
                  </div>
                )}
                {realisticTimeline.optimization_actions?.length > 0 && (
                  <div className="mt-3 border-t border-navy-200 pt-2 dark:border-zinc-700">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-brand-green">Cómo reducir el plazo</div>
                    <ul className="mt-1 space-y-1 text-[10px] leading-4 text-navy-500 dark:text-zinc-400">
                      {realisticTimeline.optimization_actions.slice(0, 3).map((action, index) => (
                        <li key={index}>• {action}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : estimatedTimeline ? (
              <div className="flex justify-between items-center text-sm mt-1">
                <span className="text-navy-500 dark:text-zinc-400">Duración</span>
                <span className="font-medium text-navy-900 dark:text-white">
                  {estimatedTimeline.total_duration_weeks} semanas ({estimatedTimeline.total_duration_days} días)
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {dataSources && (
        <div className="bg-navy-50 dark:bg-zinc-800/50 border border-navy-100 dark:border-zinc-800 rounded-xl p-4 mb-6">
          <h4 className="text-xs font-bold text-navy-800 dark:text-zinc-300 uppercase tracking-wider mb-2 flex items-center">
            <BarChart3 className="mr-2 h-4 w-4 text-[#00c896]" /> Cobertura y trazabilidad
          </h4>
          <ul className="text-[11px] text-navy-600 dark:text-zinc-400 space-y-1">
            <li className="flex justify-between">
              <span>Productos disponibles en el rastreador:</span>
              <span className="font-bold text-navy-900 dark:text-white">
                {trackerProductsAvailable.toLocaleString("es-ES")}
              </span>
            </li>
            <li className="flex justify-between">
              <span>Materiales verificados en este presupuesto:</span>
              <span className="font-bold text-navy-900 dark:text-white">
                {verifiedMaterials}/{totalMaterialsToVerify}
              </span>
            </li>
            <li className="flex justify-between">
              <span>Cobertura comercial:</span>
              <span className={`font-bold ${totalMaterialsToVerify > 0 && verifiedMaterials / totalMaterialsToVerify >= 0.9 ? "text-brand-green" : "text-amber-600"}`}>
                {totalMaterialsToVerify > 0 ? Math.round((verifiedMaterials / totalMaterialsToVerify) * 100) : 0}% (objetivo 90%)
              </span>
            </li>
            <li className="flex justify-between">
              <span>Referencias técnicas por validar:</span>
              <span className={`font-bold ${pendingMaterials > 0 ? "text-navy-700 dark:text-zinc-300" : "text-brand-green"}`}>
                {pendingMaterials}
              </span>
            </li>
            {state.sectorData.ubicacion && (
              <li className="pt-1 text-navy-500 dark:text-zinc-400">
                Zona: <strong>{state.sectorData.ubicacion}</strong>. El ajuste local afecta a mano de obra y logística, no al precio del producto.
              </li>
            )}
          </ul>
          <div className={`mt-3 rounded-lg border p-2.5 text-[11px] leading-4 ${
            !hasConnectedTracker
              ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300"
              : verifiedMaterials === totalMaterialsToVerify && totalMaterialsToVerify > 0
                ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/20 dark:text-green-300"
                : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-300"
          }`}>
            {!hasConnectedTracker
              ? "El catálogo de mercado está pendiente de sincronización. La propuesta conserva referencias técnicas identificadas y editables."
              : verifiedMaterials === totalMaterialsToVerify && totalMaterialsToVerify > 0
                ? "Cesta verificada: todos los materiales seleccionados tienen una referencia comercial trazable."
                : `Catálogo conectado con ${trackerProductsAvailable.toLocaleString("es-ES")} productos. ENLAZE está validando las equivalencias comerciales de esta cesta y mantiene claramente identificadas las referencias pendientes.`}
          </div>
        </div>
      )}

      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl p-4">
        <h4 className="text-xs font-bold text-amber-800 dark:text-amber-500 uppercase tracking-wider mb-2 flex items-center">
          <Sparkles className="mr-2 h-4 w-4" /> Insights IA
        </h4>
        <ul className="text-sm text-amber-900 dark:text-amber-400 space-y-2">
          {state.aiInsights?.missing_questions && state.aiInsights.missing_questions.length > 0 && (
            <li className="mb-2">
              <strong className="block text-xs uppercase opacity-80 mb-1">Preguntas al cliente:</strong>
              <ul className="list-disc pl-4 space-y-1">
                {state.aiInsights.missing_questions.map((q, idx) => (
                  <li key={idx}>{q}</li>
                ))}
              </ul>
            </li>
          )}
          {state.aiInsights?.regulatory_notes && state.aiInsights.regulatory_notes.length > 0 && (
            <li className="mb-2">
              <strong className="block text-xs uppercase opacity-80 mb-1">Avisos normativos:</strong>
              <ul className="list-disc pl-4 space-y-1">
                {state.aiInsights.regulatory_notes.map((n: any, idx: number) => (
                  <li key={idx}><strong>{n.title}:</strong> {n.description}</li>
                ))}
              </ul>
            </li>
          )}
          {state.aiInsights?.price_warnings && state.aiInsights.price_warnings.length > 0 && (
            <li className="mb-2">
              <strong className="block text-xs uppercase text-red-600 dark:text-red-400 mb-1">Avisos de precio:</strong>
              <ul className="list-disc pl-4 space-y-1 text-red-700 dark:text-red-300">
                {state.aiInsights.price_warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </li>
          )}
          {!state.aiInsights && state.partidas.length === 0 ? (
            <li>Describe el alcance para que la IA genere recomendaciones personalizadas.</li>
          ) : !state.aiInsights && state.partidas.length > 0 && isConstruction ? (
            <>
              <li>Revisa la cobertura de cada material antes de finalizar el presupuesto.</li>
              {!isMaterialBasketReal && hasConnectedTracker && (
                <li>El catálogo está conectado; las referencias pendientes requieren una equivalencia comercial exacta.</li>
              )}
              {!isMaterialBasketReal && !hasConnectedTracker && (
                <li>Sincroniza el rastreador para incorporar precios comerciales verificables.</li>
              )}
            </>
          ) : null}
        </ul>
      </div>

      {/* Analysis dirty warning */}
      {state.analysisDirty && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded-xl p-3 mb-4">
          <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
            La propuesta ha cambiado desde el último análisis. Pulsa "Generar con IA" en el paso de Partidas para recalcular.
          </p>
        </div>
      )}

      {state.partidas.length > 0 && (
        <button
          type="button"
          onClick={() => analyzeWithAI(true)}
          disabled={state.isAnalyzing}
          className="mb-3 w-full rounded-xl border border-brand-green/40 bg-brand-green/10 px-4 py-2.5 text-sm font-bold text-brand-green transition hover:bg-brand-green/20 disabled:opacity-50"
        >
          {state.isAnalyzing ? "Recalculando con precios actuales..." : "Volver a calcular presupuesto"}
        </button>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <button
          className="w-full py-3 bg-brand-green text-navy-900 font-bold rounded-xl hover:opacity-90 transition disabled:opacity-50"
          onClick={nextStep}
          disabled={state.isAnalyzing}
        >
          {state.isAnalyzing ? "Analizando peticion..." : "Siguiente paso"}
        </button>
        <button
          onClick={() => saveDraft(true)}
          disabled={state.isSavingDraft}
          className="w-full py-2 bg-transparent text-navy-600 dark:text-zinc-400 font-medium hover:text-navy-900 dark:hover:text-white transition text-sm disabled:opacity-50"
        >
          {state.isSavingDraft ? "Guardando..." : "Guardar borrador"}
        </button>
        {state.saveError && (
          <p className="text-xs text-red-500 text-center">{state.saveError}</p>
        )}
      </div>
    </div>
  );
}
