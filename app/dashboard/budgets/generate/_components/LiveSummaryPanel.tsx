"use client";

import React from "react";
import { useBudgetGenerate } from "./BudgetGenerateProvider";

export function LiveSummaryPanel() {
  const { state, nextStep, saveDraft } = useBudgetGenerate();
  const { totals, marginPercent, sector, providerOptions, selectedProviderId, materials, isRealDataMode } = state;
  const isConstruction = sector === "construccion";

  const totalWithIva = totals.clientPrice * (1 + state.ivaPercent / 100);

  const activeProvider = providerOptions?.find(p => p.id === selectedProviderId);
  const includedMaterialsCount = materials?.filter(m => m.included).length || 0;

  // Real data check
  // Real data check (don't show as real if it's default/fallback)
  const isMaterialBasketReal = isRealDataMode && activeProvider?.isRealData && activeProvider?.name !== "Banco ENLAZE base" && activeProvider?.name !== "Referencia mercado";

  // EUR/m2 calculation
  let detectedArea = state.aiInsights?.detected_area_m2;
  if (!detectedArea && isConstruction) {
    const match = (state.description || "").match(/(\d+)\s*(m2|metros|m²)/i);
    if (match) detectedArea = parseInt(match[1], 10);
  }
  const pricePerM2 = detectedArea && detectedArea > 0 ? totals.clientPrice / detectedArea : null;

  let priceRange = state.aiInsights?.estimated_price_range;
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

  // Timeline calculation
  let estimatedTimeline = state.aiInsights?.estimated_timeline;
  if (!estimatedTimeline && isConstruction) {
    const serviceType = (state.serviceType || state.description || "").toLowerCase();
    let minWeeks = 4;
    let maxWeeks = 6;
    if (serviceType.includes("integral") || serviceType.includes("completa")) {
      if (totals.clientPrice > 80000) { minWeeks = 10; maxWeeks = 14; }
      else if (totals.clientPrice > 40000) { minWeeks = 6; maxWeeks = 10; }
      else { minWeeks = 4; maxWeeks = 6; }
    } else if (serviceType.includes("baño") || serviceType.includes("cocina")) {
      minWeeks = 2; maxWeeks = 4;
    } else {
      minWeeks = 1; maxWeeks = 2;
    }
    estimatedTimeline = { total_duration_weeks: maxWeeks, total_duration_days: maxWeeks * 5 };
  }

  let endDateValue = state.endDate ? new Date(state.endDate) : null;
  if (!endDateValue && state.startDate && estimatedTimeline?.total_duration_days) {
    endDateValue = new Date(state.startDate);
    endDateValue.setDate(endDateValue.getDate() + parseInt(estimatedTimeline.total_duration_days.toString(), 10));
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



  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-navy-100 dark:border-zinc-800 shadow-sm p-6 sticky top-24">
      <h3 className="text-lg font-bold text-navy-900 dark:text-white mb-4">Resumen en vivo</h3>

      {isConstruction && activeProvider && (
        <div className="flex items-center gap-3 bg-navy-50 dark:bg-zinc-800/50 p-3 rounded-xl mb-4 border border-navy-100 dark:border-zinc-700">
          <div className="w-8 h-8 rounded-full bg-white dark:bg-zinc-700 flex items-center justify-center shadow-sm text-lg">
            🏢
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-center">
              <div className="text-[10px] text-navy-500 dark:text-zinc-400 uppercase tracking-wider font-bold">Proveedor activo</div>
              {isMaterialBasketReal && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 rounded">Catalogo Real</span>
              )}
            </div>
            <div className="text-sm font-bold text-navy-900 dark:text-white">{activeProvider.name}</div>
          </div>
        </div>
      )}

      <div className="space-y-4 mb-6">
        <div className="flex justify-between items-center text-sm">
          <span className="text-navy-600 dark:text-zinc-400">
            {isConstruction ? "Mano de obra y servicios" : "Coste de ejecucion"}
          </span>
          <span className="font-semibold text-navy-900 dark:text-white">{(totals.directCost - totals.materialsCost).toFixed(2)} EUR</span>
        </div>

        {isConstruction && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-navy-600 dark:text-zinc-400">
              Materiales ({includedMaterialsCount})
            </span>
            <div className="flex items-center gap-2">
              {!isMaterialBasketReal && includedMaterialsCount > 0 && (
                <span className="text-[10px] uppercase font-bold text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-1 rounded" title="Precios simulados/estimados">Estimado</span>
              )}
              <span className="font-semibold text-navy-900 dark:text-white">{totals.materialsCost.toFixed(2)} EUR</span>
            </div>
          </div>
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
              <span className="text-xs font-bold text-navy-600 dark:text-zinc-400 uppercase tracking-wider">EUR/m2</span>
              <span className={`text-sm font-bold ${
                priceRange && pricePerM2 < (priceRange.min / (detectedArea || 1)) ? 'text-red-500' :
                priceRange && pricePerM2 > (priceRange.max / (detectedArea || 1)) ? 'text-amber-500' :
                'text-brand-green'
              }`}>
                {pricePerM2.toFixed(0)} EUR/m2
              </span>
            </div>
            {priceRange && detectedArea && (
              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] text-navy-400 dark:text-zinc-500">Rango mercado ({detectedArea}m2)</span>
                <span className="text-[10px] text-navy-400 dark:text-zinc-500">
                  {(priceRange.min / detectedArea).toFixed(0)}-{(priceRange.max / detectedArea).toFixed(0)} EUR/m2
                </span>
              </div>
            )}
            {priceRange && (
              <div className="flex justify-between items-center mt-0.5">
                <span className="text-[10px] text-navy-400 dark:text-zinc-500">Rango total</span>
                <span className="text-[10px] text-navy-400 dark:text-zinc-500">
                </span>
              </div>
            )}
            {priceRange && pricePerM2 < (priceRange.min / (detectedArea || 1)) && (
              <div className="mt-3 p-2 bg-red-50/50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg">
                <p className="text-[10px] text-red-600 dark:text-red-400 font-medium mb-1 flex items-start gap-1">
                  <span className="text-xs">⚠️</span>
                  <span>
                    Presupuesto infravalorado. Revisa capítulos faltantes o genera una versión realista. El actual ({totals.clientPrice.toLocaleString("es-ES", {maximumFractionDigits: 0})} €) está {(priceRange.min - totals.clientPrice).toLocaleString("es-ES", {maximumFractionDigits: 0})} € por debajo del mínimo de mercado.
                  </span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Timeline and dates */}
        {(startDateFormatted || endDateFormatted || estimatedTimeline) && (
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
            {estimatedTimeline && (
              <div className="flex justify-between items-center text-sm mt-1">
                <span className="text-navy-500 dark:text-zinc-400">Duracion</span>
                <span className="font-medium text-navy-900 dark:text-white">
                  {estimatedTimeline.total_duration_weeks} semanas ({estimatedTimeline.total_duration_days} dias)
                </span>
              </div>
            )}
            {state.aiInsights?.calendar_phases && state.aiInsights.calendar_phases.length > 0 && (
              <div className="text-[10px] text-navy-400 dark:text-zinc-500 mt-1">
                {state.aiInsights.calendar_phases.length} fases planificadas
              </div>
            )}
          </div>
        )}
      </div>

      {dataSources && (
        <div className="bg-navy-50 dark:bg-zinc-800/50 border border-navy-100 dark:border-zinc-800 rounded-xl p-4 mb-6">
          <h4 className="text-xs font-bold text-navy-800 dark:text-zinc-300 uppercase tracking-wider mb-2 flex items-center">
            <span className="mr-2">📊</span> Fuentes de datos
          </h4>
          <ul className="text-[11px] text-navy-600 dark:text-zinc-400 space-y-1">
            <li className="flex justify-between">
              <span>Datos reales sincronizados (n8n):</span>
              <span className="font-bold text-navy-900 dark:text-white">{dataSources.n8n_items_count} precios</span>
            </li>
            <li className="flex justify-between">
              <span>Banco base ENLAZE:</span>
              <span className="font-bold text-navy-900 dark:text-white">{dataSources.default_items_count} referencias</span>
            </li>
            {dataSources.using_fallback && (
              <li className="text-amber-600 dark:text-amber-400 mt-1 font-medium">
                ⚠️ {dataSources.fallback_reason}
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl p-4">
        <h4 className="text-xs font-bold text-amber-800 dark:text-amber-500 uppercase tracking-wider mb-2 flex items-center">
          <span className="mr-2">✨</span> Insights IA
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
              <li>Sugerencia: Revisa los precios de los materiales con los proveedores reales.</li>
              {!isMaterialBasketReal && (
                <li>Conecta tus catalogos de compra para evitar precios estimados.</li>
              )}
            </>
          ) : null}
        </ul>
      </div>

      {/* Analysis dirty warning */}
      {state.analysisDirty && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded-xl p-3 mb-4">
          <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
            La propuesta ha cambiado desde el ultimo analisis. Pulsa "Generar con IA" en el paso de Partidas para recalcular.
          </p>
        </div>
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
