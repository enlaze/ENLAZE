"use client";

import React, { useState, useCallback } from "react";
import { useBudgetGenerate, type BudgetState } from "../BudgetGenerateProvider";
import { Card } from "@/components/ui/card";
import type { PDFBudget } from "@/lib/pdf-generator";
import { resolveMarketPrices, type PriceRequest, type QualityTier } from "@/lib/price-resolver";

/** Build the budget metadata object for PDF generation */
function buildBudgetMeta(state: BudgetState): PDFBudget {
  const subtotal = state.clientView?.subtotal
    ?? state.partidas.filter(p => p.status !== "opcional").reduce((s, p) => s + p.subtotal_client, 0);
  return {
    budget_number: state.draftId ? `PRE-${new Date().getFullYear()}` : `BORRADOR-${new Date().getFullYear()}`,
    title: state.title || "Presupuesto Generado",
    service_type: state.serviceType || state.sector,
    status: "pendiente",
    created_at: new Date().toISOString(),
    subtotal,
    iva_percent: state.ivaPercent,
    iva_amount: subtotal * (state.ivaPercent / 100),
    total: subtotal * (1 + state.ivaPercent / 100),
  };
}

/** Build legacy flat items array for the old PDF generator (fallback) */
function buildLegacyPDFItems(state: BudgetState, mode: "client" | "internal") {
  const marginMultiplier = 1 + (state.marginPercent / 100);
  return [
    ...state.partidas.filter(p => p.status !== "opcional").map(p => ({
      concept: p.concept,
      description: p.description,
      category: p.category,
      quantity: p.quantity,
      unit: p.unit,
      unit_price: p.unit_price_client,
      subtotal: p.subtotal_client,
      ...(mode === "internal" ? { subtotal_cost: p.subtotal_cost } : {}),
    })),
    ...state.materials.filter(m => m.included).map(m => ({
      concept: m.name,
      description: "Material",
      category: "material",
      quantity: m.quantity,
      unit: m.unit,
      unit_price: m.unit_price * marginMultiplier,
      subtotal: m.subtotal * marginMultiplier,
      ...(mode === "internal" ? { subtotal_cost: m.subtotal } : {}),
    })),
  ];
}

export function ProvidersStep() {
  const { state, setSelectedProvider, updateMaterial, setUseSuggestedMaterials } = useBudgetGenerate();
  const { providerOptions, selectedProviderId, materials, useSuggestedMaterials } = state;
  const [showCompare, setShowCompare] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [priceRefreshResult, setPriceRefreshResult] = useState<{
    ok: boolean;
    message: string;
    summary?: { fromWebSearch: number; fromCache: number; estimated: number; total: number };
  } | null>(null);

  const handleRefreshMarketPrices = useCallback(async () => {
    if (isRefreshingPrices) return;
    setIsRefreshingPrices(true);
    setPriceRefreshResult(null);

    try {
      // Build PriceRequest list from current materials
      const qualityTier: QualityTier = (state as any).qualityTier || "media";
      const location: string = (state as any).location || (state as any).city || "";

      const priceRequests: PriceRequest[] = materials
        .filter(m => m.included)
        .map(m => ({
          materialName: m.name,
          category: (m as any).category || "material",
          unit: m.unit,
          quantity: m.quantity,
          qualityTier,
          location,
        }));

      if (priceRequests.length === 0) {
        setPriceRefreshResult({ ok: false, message: "No hay materiales seleccionados para actualizar." });
        return;
      }

      const result = await resolveMarketPrices({
        materials: priceRequests,
        location,
        forceRefresh: true,
      });

      if (result.ok && result.resolved.length > 0) {
        // Update material prices with resolved prices
        for (const rp of result.resolved) {
          const mat = materials.find(m =>
            m.name.toLowerCase().includes(rp.normalizedName) ||
            rp.normalizedName.includes(m.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
          );
          if (mat && rp.selectedPrice > 0) {
            updateMaterial(mat.id, {
              unit_price: rp.selectedPrice,
              subtotal: rp.selectedPrice * mat.quantity,
              sourceType: rp.sourceType,
              isRealData: rp.sourceType !== "estimated",
            });
          }
        }

        setPriceRefreshResult({
          ok: true,
          message: `Precios actualizados: ${result.summary.fromWebSearch} web, ${result.summary.fromCache} cache, ${result.summary.estimated} estimados`,
          summary: result.summary,
        });
      } else {
        setPriceRefreshResult({
          ok: false,
          message: result.error || "No se pudieron actualizar los precios. Se mantienen los estimados.",
        });
      }
    } catch (err: any) {
      setPriceRefreshResult({
        ok: false,
        message: err.message || "Error al conectar con el servidor de precios.",
      });
    } finally {
      setIsRefreshingPrices(false);
    }
  }, [isRefreshingPrices, materials, state, updateMaterial]);

  const getBadgeProps = (sourceType?: string, isRealData?: boolean) => {
    if (sourceType === "n8n_sync") return { label: "REAL", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800" };
    if (sourceType === "default") return { label: "BASE", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700" };
    if (sourceType === "market_reference") return { label: "REFERENCIA", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800" };
    if (sourceType === "fallback" || sourceType === "unknown") return { label: "ESTIMADO", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800" };
    if (isRealData) return { label: "REAL", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800" };
    return { label: "SIN FUENTE", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700" };
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card>
        <div className="mb-6 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold text-navy-900 dark:text-white">Selecciona el proveedor</h2>
            <p className="text-sm text-navy-600 dark:text-zinc-400">
              Escoge un proveedor principal para recalcular automáticamente los costes y márgenes de los materiales.
            </p>
          </div>
          <button 
            onClick={() => setShowCompare(!showCompare)}
            className={`hidden sm:flex px-4 py-2 border rounded-lg text-sm font-medium transition ${showCompare ? 'bg-navy-900 text-white border-navy-900 dark:bg-white dark:text-navy-900' : 'bg-white dark:bg-zinc-800 border-navy-200 dark:border-zinc-700 hover:bg-navy-50 dark:hover:bg-zinc-700'}`}
          >
            {showCompare ? 'Cerrar comparador' : 'Comparar proveedores'}
          </button>
        </div>

        {showCompare && (
          <div className="mb-8 bg-navy-50 dark:bg-zinc-800/50 rounded-xl p-5 border border-navy-200 dark:border-zinc-700 animate-in fade-in slide-in-from-top-4">
            <h3 className="font-bold text-navy-900 dark:text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-brand-green" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
              Comparativa de Proveedores
            </h3>
            {providerOptions.length <= 1 ? (
              <p className="text-sm text-navy-600 dark:text-zinc-400">
                No hay suficientes proveedores reales para comparar. Se usará el proveedor actual.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {providerOptions.map(p => (
                  <div key={p.id} className={`bg-white dark:bg-zinc-900 p-4 rounded-lg border ${selectedProviderId === p.id ? 'border-brand-green' : 'border-navy-100 dark:border-zinc-800'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-bold text-navy-900 dark:text-white">{p.name}</h4>
                      <span className={`${getBadgeProps(p.sourceType, p.isRealData).className} text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider`}>{getBadgeProps(p.sourceType, p.isRealData).label}</span>
                    </div>
                    <ul className="text-sm text-navy-600 dark:text-zinc-400 mb-4 space-y-1">
                      <li><strong>Materiales:</strong> {p.materialsCount || 0} disponibles</li>
                      <li><strong>Plazo:</strong> {p.deliveryTime}</li>
                      <li><strong>Origen:</strong> {p.description}</li>
                    </ul>
                    <div className="flex justify-between items-center mt-auto">
                      <div className="font-bold text-navy-900 dark:text-white">
                        {p.estimatedPrice > 0 ? `${p.estimatedPrice.toFixed(2)} €` : 'Calculando...'}
                      </div>
                      {selectedProviderId !== p.id ? (
                        <button 
                          onClick={() => { setSelectedProvider(p.id); setShowCompare(false); }}
                          className="text-xs bg-navy-100 hover:bg-brand-green hover:text-navy-900 dark:bg-zinc-800 text-navy-700 dark:text-white font-medium px-3 py-1.5 rounded transition"
                        >
                          Usar este
                        </button>
                      ) : (
                        <span className="text-xs font-bold text-brand-green bg-brand-green/10 px-3 py-1.5 rounded">Seleccionado</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {providerOptions.length === 0 && (
          <div className="text-center py-10 bg-navy-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-navy-200 dark:border-zinc-700 mb-8">
            <span className="text-3xl mb-2 block">🏪</span>
            <h4 className="text-sm font-bold text-navy-900 dark:text-white">Sin proveedores disponibles</h4>
            <p className="text-xs text-navy-500 dark:text-zinc-400 mt-1 max-w-xs mx-auto">
              Los proveedores se generan automaticamente con el analisis IA. Vuelve al paso anterior y usa "Generar con IA".
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {providerOptions.map(provider => {
            const isSelected = selectedProviderId === provider.id;
            return (
              <div 
                key={provider.id}
                onClick={() => setSelectedProvider(provider.id)}
                className={`relative rounded-xl p-4 cursor-pointer transition-all ${
                  isSelected 
                    ? "border-2 border-brand-green bg-brand-green/5 shadow-sm" 
                    : "border border-navy-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-brand-green/50"
                }`}
              >
                {provider.isRecommended && (
                  <div className="absolute -top-3 -right-3 bg-brand-green text-navy-900 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full shadow-sm">
                    Recomendado
                  </div>
                )}
                {isSelected && (
                  <div className="absolute top-3 right-3 text-brand-green">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-navy-900 dark:text-white">{provider.name}</h3>
                  <span className={`${getBadgeProps(provider.sourceType, provider.isRealData).className} text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider`}>{getBadgeProps(provider.sourceType, provider.isRealData).label}</span>
                </div>
                <p className="text-xs text-navy-500 dark:text-zinc-400 mb-2 line-clamp-1">{provider.description}</p>
                {provider.materialsCount !== undefined && provider.materialsCount > 0 ? (
                  <p className="text-xs text-navy-500 dark:text-zinc-400 mb-3 font-medium">
                    {provider.materialsCount} materiales disponibles
                  </p>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 font-medium flex items-center gap-1">
                    <span>⚠️</span> Sin materiales para este alcance
                  </p>
                )}
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-[10px] text-navy-400 dark:text-zinc-500 uppercase tracking-wider">Cesta estimada</div>
                    {provider.estimatedPrice > 0 ? (
                      <span className="text-sm font-bold text-navy-900 dark:text-white">{provider.estimatedPrice.toFixed(2)} €</span>
                    ) : (
                      <span className="text-xs font-medium text-navy-500 dark:text-zinc-400 italic">Dinámica</span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-navy-400 dark:text-zinc-500 uppercase tracking-wider">{provider.deliveryTime}</div>
                    <span className={`text-xs font-semibold ${
                      provider.stockLevel === 'Alto' ? 'text-brand-green' : 
                      provider.stockLevel === 'Medio' ? 'text-amber-500' : 'text-navy-500'
                    }`}>
                      {provider.stockLevel}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-6 border-t border-navy-100 dark:border-zinc-800">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
            <h3 className="text-lg font-bold text-navy-900 dark:text-white">Selecciona los materiales</h3>
            <div className="flex bg-navy-50 dark:bg-zinc-800 p-1 rounded-lg">
              <button
                onClick={() => setUseSuggestedMaterials(true)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${useSuggestedMaterials ? "bg-white dark:bg-zinc-700 shadow-sm text-navy-900 dark:text-white" : "text-navy-500 dark:text-zinc-400 hover:text-navy-700"}`}
              >
                Sugeridos IA
              </button>
              <button
                onClick={() => setUseSuggestedMaterials(false)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${!useSuggestedMaterials ? "bg-white dark:bg-zinc-700 shadow-sm text-navy-900 dark:text-white" : "text-navy-500 dark:text-zinc-400 hover:text-navy-700"}`}
              >
                Manual
              </button>
            </div>
          </div>

          {materials.length === 0 ? (
            <div className="text-center py-10 bg-navy-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-navy-200 dark:border-zinc-700">
              <span className="text-3xl mb-2 block">📦</span>
              <h4 className="text-sm font-bold text-navy-900 dark:text-white">Sin materiales disponibles</h4>
              <p className="text-xs text-navy-500 dark:text-zinc-400 mt-1 max-w-xs mx-auto">
                Los materiales se generan automaticamente con la IA o desde tu catalogo de precios. Vuelve al paso anterior y usa "Generar con IA" para obtener una lista completa.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-navy-50 dark:bg-zinc-800/50 border-y border-navy-100 dark:border-zinc-800 text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase tracking-wider">
                    <th className="p-3 w-10 text-center">Inc.</th>
                    <th className="p-3">Material</th>
                    <th className="p-3 w-24 text-right">Cant.</th>
                    <th className="p-3 w-20">Ud.</th>
                    <th className="p-3 w-28 text-right">Coste Ud.</th>
                    <th className="p-3 w-28 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                  {materials.map((m) => (
                    <tr key={m.id} className={`hover:bg-navy-50/50 dark:hover:bg-zinc-800/50 transition-colors ${!m.included ? 'opacity-50' : ''}`}>
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={m.included}
                          onChange={(e) => updateMaterial(m.id, { included: e.target.checked })}
                          className="rounded border-navy-300 text-brand-green focus:ring-brand-green/20"
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-navy-900 dark:text-white">{m.name}</p>
                          <span className={`${getBadgeProps(m.sourceType, m.isRealData).className} border text-[9px] px-1 rounded-sm uppercase tracking-wider font-semibold`} title="Fuente de datos">
                            {getBadgeProps(m.sourceType, m.isRealData).label}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={m.quantity}
                          onChange={(e) => updateMaterial(m.id, { quantity: parseFloat(e.target.value) || 0 })}
                          disabled={!m.included}
                          className="w-full text-right font-medium text-navy-900 dark:text-white bg-transparent border border-transparent hover:border-navy-200 dark:hover:border-zinc-700 rounded p-1 focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green text-sm disabled:opacity-50"
                        />
                      </td>
                      <td className="p-3 text-sm text-navy-600 dark:text-zinc-400">
                        {m.unit}
                      </td>
                      <td className="p-3 text-right text-sm text-navy-600 dark:text-zinc-400">
                        {m.unit_price.toFixed(2)} EUR
                      </td>
                      <td className="p-3 text-right font-bold text-navy-900 dark:text-white text-sm">
                        {m.subtotal.toFixed(2)} EUR
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Market price refresh */}
      {materials.length > 0 && (
        <Card>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-lg font-bold text-navy-900 dark:text-white">Precios de mercado</h2>
              <p className="text-sm text-navy-500 dark:text-zinc-400">
                Busca precios reales en proveedores y compara con los estimados actuales.
              </p>
            </div>
            <button
              onClick={handleRefreshMarketPrices}
              disabled={isRefreshingPrices}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition ${
                isRefreshingPrices
                  ? "bg-gray-200 text-gray-500 cursor-wait dark:bg-zinc-700 dark:text-zinc-500"
                  : "bg-brand-green text-navy-900 hover:bg-brand-green/90 shadow-sm"
              }`}
            >
              {isRefreshingPrices ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Buscando precios...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Actualizar precios de mercado
                </>
              )}
            </button>
          </div>

          {priceRefreshResult && (
            <div className={`mt-4 p-3 rounded-lg border text-sm ${
              priceRefreshResult.ok
                ? "bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-900/30 text-green-700 dark:text-green-400"
                : "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30 text-amber-700 dark:text-amber-400"
            }`}>
              <p className="font-medium">{priceRefreshResult.message}</p>
              {priceRefreshResult.summary && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <span className="px-2 py-0.5 rounded bg-white dark:bg-zinc-800 border border-current/10">
                    Total: {priceRefreshResult.summary.total}
                  </span>
                  {priceRefreshResult.summary.fromWebSearch > 0 && (
                    <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400">
                      Web: {priceRefreshResult.summary.fromWebSearch}
                    </span>
                  )}
                  {priceRefreshResult.summary.fromCache > 0 && (
                    <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400">
                      Cache: {priceRefreshResult.summary.fromCache}
                    </span>
                  )}
                  {priceRefreshResult.summary.estimated > 0 && (
                    <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                      Estimados: {priceRefreshResult.summary.estimated}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* PDF Export section - visible in last step */}
      <Card>
        <h2 className="text-lg font-bold text-navy-900 dark:text-white mb-1">Exportar presupuesto</h2>
        <p className="text-sm text-navy-500 dark:text-zinc-400 mb-4">
          Descarga el presupuesto en PDF antes o despues de finalizar. El PDF cliente es limpio y profesional; el interno incluye costes, margenes y notas.
        </p>
        {state.isUndervalued && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg">
            <p className="text-xs text-red-600 dark:text-red-400 font-medium">
              El presupuesto esta por debajo del minimo realista de mercado. No se puede descargar el PDF cliente. Genera de nuevo con IA o ajusta las partidas.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => {
              if (state.isUndervalued) return;
              const pdfLib = require("@/lib/pdf-generator");
              const budgetMeta = buildBudgetMeta(state);

              if (state.clientView) {
                // New chapter-based PDF (no escandallo)
                pdfLib.printPDF(pdfLib.generateClientPDFHTML(budgetMeta, state.clientView));
              } else {
                // Legacy flat-table fallback
                const items = buildLegacyPDFItems(state, "client");
                const subtotal = items.reduce((s: number, i: any) => s + i.subtotal, 0);
                budgetMeta.subtotal = subtotal;
                budgetMeta.iva_amount = subtotal * (state.ivaPercent / 100);
                budgetMeta.total = subtotal * (1 + state.ivaPercent / 100);
                pdfLib.printPDF(pdfLib.generateBudgetPDFHTML(budgetMeta, items, "client"));
              }
            }}
            disabled={state.isUndervalued}
            className={`flex-1 min-w-[180px] py-3 px-4 font-bold rounded-xl transition text-sm ${
              state.isUndervalued
                ? "bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-zinc-700 dark:text-zinc-500"
                : "bg-navy-900 hover:bg-navy-800 text-white dark:bg-zinc-800 dark:hover:bg-zinc-700"
            }`}
          >
            Descargar PDF cliente
          </button>
          <button
            onClick={() => {
              const pdfLib = require("@/lib/pdf-generator");
              const budgetMeta = buildBudgetMeta(state);

              if (state.internalView) {
                // New escandallo PDF with full breakdown
                pdfLib.printPDF(pdfLib.generateInternalPDFHTML(budgetMeta, state.internalView));
              } else {
                // Legacy flat-table fallback
                const items = buildLegacyPDFItems(state, "internal");
                const subtotal = items.reduce((s: number, i: any) => s + i.subtotal, 0);
                budgetMeta.subtotal = subtotal;
                budgetMeta.iva_amount = subtotal * (state.ivaPercent / 100);
                budgetMeta.total = subtotal * (1 + state.ivaPercent / 100);
                pdfLib.printPDF(pdfLib.generateBudgetPDFHTML(budgetMeta, items, "internal"));
              }
            }}
            className="flex-1 min-w-[180px] py-3 px-4 bg-white hover:bg-navy-50 text-navy-900 font-bold rounded-xl border-2 border-brand-green/50 transition text-sm dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:text-white"
          >
            Descargar PDF interno
          </button>
        </div>
      </Card>
    </div>
  );
}
