"use client";

import React from "react";
import { useBudgetGenerate } from "./BudgetGenerateProvider";

export function LiveSummaryPanel() {
  const { state, nextStep } = useBudgetGenerate();
  const { totals, marginPercent, sector, providerOptions, selectedProviderId, materials, isRealDataMode } = state;
  const isConstruction = sector === "construccion";

  const totalWithIva = totals.clientPrice * (1 + state.ivaPercent / 100);

  const activeProvider = providerOptions?.find(p => p.id === selectedProviderId);
  const includedMaterialsCount = materials?.filter(m => m.included).length || 0;
  
  // Real data check
  const isMaterialBasketReal = isRealDataMode && activeProvider?.isRealData;

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
                <span className="text-[9px] font-bold uppercase tracking-wider text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 rounded">Catálogo Real</span>
              )}
            </div>
            <div className="text-sm font-bold text-navy-900 dark:text-white">{activeProvider.name}</div>
          </div>
        </div>
      )}

      <div className="space-y-4 mb-6">
        <div className="flex justify-between items-center text-sm">
          <span className="text-navy-600 dark:text-zinc-400">
            {isConstruction ? "Mano de obra y servicios" : "Coste de ejecución"}
          </span>
          <span className="font-semibold text-navy-900 dark:text-white">{(totals.directCost - totals.materialsCost).toFixed(2)} €</span>
        </div>

        {isConstruction && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-navy-600 dark:text-zinc-400">
              Materiales ({includedMaterialsCount})
            </span>
            <div className="flex items-center gap-2">
              {!isMaterialBasketReal && (
                <span className="text-[10px] uppercase font-bold text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-1 rounded" title="Precios simulados/estimados">Estimado</span>
              )}
              <span className="font-semibold text-navy-900 dark:text-white">{totals.materialsCost.toFixed(2)} €</span>
            </div>
          </div>
        )}
        
        <div className="flex justify-between items-center text-sm">
          <span className="text-navy-600 dark:text-zinc-400">
            Margen sugerido ({marginPercent}%)
          </span>
          <span className="font-semibold text-brand-green">+{totals.profit.toFixed(2)} €</span>
        </div>

        <div className="pt-4 border-t border-navy-100 dark:border-zinc-800">
          <div className="flex justify-between items-center">
            <span className="text-navy-900 dark:text-white font-medium">Precio final (Sin IVA)</span>
            <span className="text-lg font-bold text-navy-900 dark:text-white">{totals.clientPrice.toFixed(2)} €</span>
          </div>
          <div className="flex justify-between items-center mt-1 text-sm text-navy-500 dark:text-zinc-500">
            <span>IVA ({state.ivaPercent}%)</span>
            <span>{(totals.clientPrice * (state.ivaPercent / 100)).toFixed(2)} €</span>
          </div>
        </div>

        <div className="bg-navy-50 dark:bg-zinc-800/50 p-3 rounded-xl mt-2 flex justify-between items-center">
          <span className="text-sm font-bold text-navy-900 dark:text-white">PVP Cliente</span>
          <span className="text-xl font-black text-brand-green">{totalWithIva.toFixed(2)} €</span>
        </div>
      </div>

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
          {state.aiInsights?.calendar_phases && state.aiInsights.calendar_phases.length > 0 && (
            <li>
              <strong className="block text-xs uppercase opacity-80 mb-1">Fases sugeridas:</strong>
              <span className="text-xs">{state.aiInsights.calendar_phases.length} fases ({state.aiInsights.calendar_phases.reduce((a: number, b: any) => a + (b.duration_days || 0), 0)} días aprox)</span>
            </li>
          )}
          {!state.aiInsights && state.partidas.length === 0 ? (
            <li>Describe el alcance para que la IA genere recomendaciones personalizadas.</li>
          ) : !state.aiInsights && state.partidas.length > 0 && isConstruction ? (
            <>
              <li>Sugerencia: Revisa los precios de los materiales con los proveedores reales.</li>
              {!isMaterialBasketReal && (
                <li>💡 Conecta tus catálogos de compra para evitar precios estimados.</li>
              )}
            </>
          ) : null}
        </ul>
      </div>
      
      <div className="mt-6 flex flex-col gap-2">
        <button 
          className="w-full py-3 bg-brand-green text-navy-900 font-bold rounded-xl hover:opacity-90 transition disabled:opacity-50"
          onClick={nextStep}
          disabled={state.isAnalyzing}
        >
          {state.isAnalyzing ? "✨ Analizando petición..." : "Siguiente paso"}
        </button>
        <button className="w-full py-2 bg-transparent text-navy-600 dark:text-zinc-400 font-medium hover:text-navy-900 dark:hover:text-white transition text-sm">
          Guardar borrador
        </button>
      </div>
    </div>
  );
}
