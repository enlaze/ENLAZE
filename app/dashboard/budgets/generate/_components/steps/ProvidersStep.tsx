"use client";

import React, { useState, useCallback, useMemo } from "react";
import { Store, Package, ChevronDown, ExternalLink, ShieldCheck, Clock3, AlertTriangle } from "lucide-react";
import {
  calculateBudgetFinancials,
  useBudgetGenerate,
  type BudgetState,
} from "../BudgetGenerateProvider";
import { Card } from "@/components/ui/card";
import type { PDFBudget } from "@/lib/pdf-generator";
import {
  buildProviderBasketCoverage,
  getComparableOffers,
  type ComparableOffer,
} from "@/lib/basket-price-comparison";
import {
  isCommercialProductMaterial,
  isServiceMaterial,
} from "@/lib/material-procurement";

const SECTOR_REFERENCE_PROVIDERS = [
  { name: "Leroy Merlin", specialty: "Materiales, equipamiento y reforma" },
  { name: "OBRAMAT", specialty: "Construcción y reforma profesional" },
  { name: "Porcelanosa", specialty: "Cerámica, superficies y baños" },
  { name: "Roca", specialty: "Baño, sanitarios y grifería" },
  { name: "Eurocasa", specialty: "Distribución de materiales" },
];

function normalizeProviderName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Build the budget metadata object for PDF generation */
function buildBudgetMeta(state: BudgetState): PDFBudget {
  const subtotal = state.clientView?.subtotal
    ?? state.partidas.filter(p => p.status !== "opcional").reduce((s, p) => s + p.subtotal_client, 0);
  const financials = calculateBudgetFinancials(
    subtotal,
    state.ivaPercent,
    state.discountType,
    state.discountPercent,
    state.discountAmount,
  );
  return {
    budget_number: state.draftId ? `PRE-${new Date().getFullYear()}` : `BORRADOR-${new Date().getFullYear()}`,
    title: state.title || "Presupuesto Generado",
    client_name: state.clientName,
    client_email: state.clientEmail,
    client_phone: state.clientPhone,
    service_type: state.serviceType || state.sector,
    status: "pendiente",
    created_at: new Date().toISOString(),
    valid_until: state.validUntil || null,
    subtotal: financials.subtotal,
    iva_percent: state.ivaPercent,
    iva_amount: financials.ivaAmount,
    total: financials.total,
    notes: state.internalNotes,
    deposit_percent: state.depositPercent,
    payment_method: state.paymentMethod,
    payment_iban: state.paymentIban,
    discount_type: state.discountType,
    discount_percent: state.discountPercent,
    discount_amount: financials.discountValue,
    payment_schedule: state.paymentSchedule,
    warranty_text: state.warrantyText,
    execution_deadline_text: state.executionDeadlineText,
    observations: state.observations,
    conditions_text: state.conditionsText,
    location: state.sectorData.ubicacion || null,
    geographic_profile: state.partidas.find((partida) => partida.geographic_profile)?.geographic_profile || "Media nacional",
    geographic_adjustment: state.partidas.some((partida) => partida.geographic_factor && partida.geographic_factor !== 1)
      ? "El coeficiente local se aplica únicamente a mano de obra, logística, maquinaria y residuos. Los productos conservan el precio comprobado por el rastreador."
      : "Base nacional sin incremento geográfico. Los productos conservan el precio comprobado por el rastreador.",
    technical_document_names: state.sectorData.technical_document_names || [],
    execution_weeks_min: state.realisticTimeline?.execution_weeks_min || null,
    execution_weeks_max: state.realisticTimeline?.execution_weeks_max || null,
    preparation_weeks_min: state.realisticTimeline?.preparation_weeks_min || null,
    preparation_weeks_max: state.realisticTimeline?.preparation_weeks_max || null,
    total_weeks_min: state.realisticTimeline?.total_weeks_min || null,
    total_weeks_max: state.realisticTimeline?.total_weeks_max || null,
    schedule_assumptions: state.realisticTimeline?.assumptions || [],
    execution_phases: state.realisticTimeline?.phase_breakdown || [],
  };
}

/** Build legacy flat items array for the old PDF generator (fallback) */
function buildLegacyPDFItems(state: BudgetState, mode: "client" | "internal") {
  return state.partidas.filter(p => p.status !== "opcional").map(p => ({
      concept: p.concept,
      description: p.description,
      category: p.category,
      quantity: p.quantity,
      unit: p.unit,
      unit_price: p.unit_price_client,
      subtotal: p.subtotal_client,
      ...(mode === "internal" ? { subtotal_cost: p.subtotal_cost } : {}),
    }));
}

export function ProvidersStep() {
  const { state, updateMaterial, setUseSuggestedMaterials, analyzeWithAI } = useBudgetGenerate();
  const { providerOptions, materials, useSuggestedMaterials } = state;
  const [showCompare, setShowCompare] = useState(false);
  const [expandedMaterialId, setExpandedMaterialId] = useState<string | null>(null);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [priceRefreshResult, setPriceRefreshResult] = useState<{
    ok: boolean;
    message: string;
    summary?: {
      fromWebSearch: number;
      fromCache: number;
      fromN8n?: number;
      estimated: number;
      total: number;
      tracker_products_available?: number;
    };
  } | null>(null);

  const handleRefreshMarketPrices = useCallback(async () => {
    if (isRefreshingPrices) return;
    setIsRefreshingPrices(true);
    setPriceRefreshResult(null);

    try {
      if (materials.filter((material) => material.included).length === 0) {
        setPriceRefreshResult({ ok: false, message: "No hay materiales seleccionados para actualizar." });
        return;
      }

      const refreshed = await analyzeWithAI(true);
      if (refreshed) {
        setPriceRefreshResult({
          ok: true,
          message: "Presupuesto recalculado con el rastreador y el banco técnico actuales.",
        });
      } else {
        setPriceRefreshResult({
          ok: false,
          message: "No se pudieron actualizar los precios. Se mantienen los importes anteriores.",
        });
      }
    } catch (error: unknown) {
      setPriceRefreshResult({
        ok: false,
        message: error instanceof Error ? error.message : "Error al conectar con el servidor de precios.",
      });
    } finally {
      setIsRefreshingPrices(false);
    }
  }, [analyzeWithAI, isRefreshingPrices, materials]);

  /** Badge props for source/provider status. Provider match/missing flags take priority when present. */
  const getBadgeProps = (sourceType?: string, isRealData?: boolean, material?: any) => {
    if (isServiceMaterial(material || {})) {
      return material?.isRealData
        ? { label: "OFERTA", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800" }
        : { label: "SERVICIO", className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-violet-200 dark:border-violet-800" };
    }
    // Provider enrichment flags take priority (commit 1.1.b.2)
    if (material?.missing_in_selected_provider === true) {
      return { label: "SIN PRECIO", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800" };
    }
    if (material?.provider_adjustment?.applied === true) {
      return { label: "PROVEEDOR", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800" };
    }
    // Original logic
    if (
      isRealData &&
      ["n8n_sync", "n8n_market", "provider_updated", "preferred_supplier", "private_tariff", "negotiated"].includes(sourceType || "")
    ) {
      return { label: "RASTREADOR", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800" };
    }
    if (["n8n_sync", "n8n_market", "provider_updated", "preferred_supplier", "private_tariff", "negotiated"].includes(sourceType || "")) {
      return { label: "POR VALIDAR", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800" };
    }
    if (sourceType === "default") return { label: "BASE", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700" };
    if (sourceType === "market_reference") return { label: "REFERENCIA", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800" };
    if (sourceType === "fallback" || sourceType === "unknown" || sourceType === "estimated") return { label: "POR VALIDAR", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800" };
    if (isRealData) return { label: "REAL", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800" };
    return { label: "REFERENCIA", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700" };
  };

  // Provider coverage stats for UI banner
  const providerMatchCount = materials.filter(m => (m as any).provider_adjustment?.applied === true).length;
  const providerMissingCount = materials.filter(m => (m as any).missing_in_selected_provider === true).length;
  const hasProviderEnrichment = providerMatchCount > 0 || providerMissingCount > 0;
  const includedMaterials = materials.filter((material) => material.included);
  const includedProducts = includedMaterials.filter(isCommercialProductMaterial);
  const includedServices = includedMaterials.filter(isServiceMaterial);
  const verifiedMaterials = includedProducts.filter((material) => material.isRealData).length;
  const quotedServices = includedServices.filter((material) => material.isRealData).length;
  const coveragePercent = includedProducts.length > 0
    ? Math.round((verifiedMaterials / includedProducts.length) * 100)
    : 0;
  const basketProviderCoverage = useMemo(
    () => buildProviderBasketCoverage(materials),
    [materials],
  );
  const comparableOffersCount = useMemo(
    () => materials.reduce((sum, material) => sum + getComparableOffers(material, 15).length, 0),
    [materials],
  );

  const selectOffer = (materialId: string, offer: ComparableOffer) => {
    const traceable = offer.isTraceable;
    updateMaterial(materialId, {
      unit_price: offer.displayPrice,
      provider_id: offer.supplierId,
      isRealData: traceable,
      sourceType: offer.sourceType || "provider_updated",
      sourceName: offer.canonicalSupplier,
      matchedProductName: offer.title,
      sourceUrl: offer.url || undefined,
      priceCheckedAt: offer.checkedAt || new Date().toISOString(),
      confidenceScore: offer.confidenceScore ?? (traceable ? 0.75 : 0.5),
      isAvailable: offer.isAvailable,
      deliveryDays: offer.deliveryDays,
      missing_in_selected_provider: false,
      provider_fallback_reason: undefined,
      provider_adjustment: undefined,
    });
    setExpandedMaterialId(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card>
        <div className="mb-6 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold text-navy-900 dark:text-white">Proveedores y cobertura de la cesta</h2>
            <p className="text-sm text-navy-600 dark:text-zinc-400">
              Compara fuentes trazables. ENLAZE solo identifica como verificado un importe vinculado a un producto real.
            </p>
          </div>
          <button 
            onClick={() => setShowCompare(!showCompare)}
            className={`hidden sm:flex px-4 py-2 border rounded-lg text-sm font-medium transition ${showCompare ? 'bg-navy-900 text-white border-navy-900 dark:bg-white dark:text-navy-900' : 'bg-white dark:bg-zinc-800 border-navy-200 dark:border-zinc-700 hover:bg-navy-50 dark:hover:bg-zinc-700'}`}
          >
            {showCompare ? 'Cerrar comparador' : 'Comparar proveedores'}
          </button>
        </div>

        {includedMaterials.length > 0 && (
          <div className={`mb-6 rounded-xl border p-4 ${
            coveragePercent === 100
              ? "border-green-200 bg-green-50 dark:border-green-900/40 dark:bg-green-950/20"
              : coveragePercent >= 70
                ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20"
                : "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20"
          }`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {coveragePercent === 100
                    ? <ShieldCheck className="h-5 w-5 text-green-600" />
                    : <AlertTriangle className={`h-5 w-5 ${coveragePercent >= 70 ? "text-amber-600" : "text-red-600"}`} />}
                  <h3 className="font-bold text-navy-900 dark:text-white">
                    Cobertura comercial de productos: {verifiedMaterials}/{includedProducts.length} ({coveragePercent}%)
                  </h3>
                </div>
                <p className="mt-1 text-xs text-navy-600 dark:text-zinc-400">
                  {coveragePercent === 100
                    ? "Todos los productos de la cesta tienen una referencia exacta y trazable. Revisa únicamente disponibilidad y entrega antes de comprar."
                    : `Objetivo operativo: 100%. Faltan ${Math.max(includedProducts.length - verifiedMaterials, 0)} productos exactos por confirmar para eliminar equivalencias falsas.`}
                </p>
                {includedServices.length > 0 && (
                  <p className="mt-1 text-xs font-medium text-violet-700 dark:text-violet-400">
                    Servicios locales: {quotedServices}/{includedServices.length} con oferta vinculada. No se mezclan con el catálogo de productos.
                  </p>
                )}
              </div>
              <div className="flex gap-2 text-xs">
                <span className="rounded-lg border border-white/60 bg-white/70 px-2.5 py-1.5 font-semibold text-navy-700 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                  {comparableOffersCount} ofertas comparables
                </span>
                <span className="rounded-lg border border-white/60 bg-white/70 px-2.5 py-1.5 font-semibold text-navy-700 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                  {basketProviderCoverage.length} proveedores
                </span>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80 dark:bg-zinc-800">
              <div
                className={`h-full rounded-full ${coveragePercent === 100 ? "bg-green-500" : coveragePercent >= 70 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${coveragePercent}%` }}
              />
            </div>
          </div>
        )}

        {showCompare && (
          <div className="mb-8 bg-navy-50 dark:bg-zinc-800/50 rounded-xl p-5 border border-navy-200 dark:border-zinc-700 animate-in fade-in slide-in-from-top-4">
            <h3 className="font-bold text-navy-900 dark:text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-brand-green" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
              Comparativa de cobertura
            </h3>
            {basketProviderCoverage.length === 0 ? (
              <p className="text-sm text-navy-600 dark:text-zinc-400">
                Todavía no hay ofertas comerciales trazables para comparar. La base técnica se mantiene identificada hasta encontrar equivalencias reales.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {basketProviderCoverage.map((provider) => (
                  <div key={provider.id} className={`bg-white dark:bg-zinc-900 p-4 rounded-lg border ${provider.isRecommended ? 'border-brand-green' : 'border-navy-100 dark:border-zinc-800'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-bold text-navy-900 dark:text-white">{provider.name}</h4>
                      {provider.isRecommended && (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-green-700 dark:bg-green-900/30 dark:text-green-400">Mayor cobertura</span>
                      )}
                    </div>
                    <ul className="text-sm text-navy-600 dark:text-zinc-400 mb-4 space-y-1">
                      <li><strong>Cobertura verificada:</strong> {provider.traceableMaterials}/{provider.totalMaterials} ({provider.coveragePercent}%)</li>
                      {provider.matchedMaterials > provider.traceableMaterials && (
                        <li><strong>Candidatos sin validar:</strong> {provider.matchedMaterials - provider.traceableMaterials}</li>
                      )}
                      <li><strong>Confianza de coincidencia:</strong> {provider.averageConfidence === null ? "No calculable" : `${Math.round(provider.averageConfidence * 100)}%`}</li>
                      <li><strong>Entrega máxima conocida:</strong> {provider.maxDeliveryDays ? `${provider.maxDeliveryDays} días` : "A confirmar"}</li>
                    </ul>
                    <div className="mt-auto flex items-end justify-between border-t border-navy-100 pt-3 dark:border-zinc-800">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-navy-400">Subtotal verificado cubierto</div>
                        <div className="font-bold text-navy-900 dark:text-white">{provider.partialBasketTotal.toFixed(2)} €</div>
                      </div>
                      {provider.coveragePercent < 100 && (
                        <span className="max-w-28 text-right text-[10px] leading-4 text-amber-600 dark:text-amber-400">No representa la cesta completa</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mb-8">
          <div className="mb-3">
            <h3 className="text-sm font-bold text-navy-900 dark:text-white">Proveedores y marcas de referencia del sector</h3>
            <p className="text-xs text-navy-500 dark:text-zinc-400">
              Directorio sectorial. La vinculación de precio se muestra únicamente cuando el rastreador dispone de una referencia comprobable.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {SECTOR_REFERENCE_PROVIDERS.map((reference) => {
              const linkedProvider = providerOptions.find((provider) => {
                const providerName = normalizeProviderName(provider.name);
                const referenceName = normalizeProviderName(reference.name);
                return provider.isRealData && (providerName.includes(referenceName) || referenceName.includes(providerName));
              });
              return (
                <div
                  key={reference.name}
                  className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-navy-50/60 dark:bg-zinc-800/40 p-3"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-8 w-8 rounded-lg bg-white dark:bg-zinc-900 border border-navy-100 dark:border-zinc-700 flex items-center justify-center font-black text-xs text-navy-800 dark:text-white">
                      {reference.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="font-bold text-sm text-navy-900 dark:text-white">{reference.name}</div>
                  </div>
                  <p className="text-[11px] leading-4 text-navy-500 dark:text-zinc-400 min-h-8">{reference.specialty}</p>
                  <div className={`mt-2 text-[10px] font-bold uppercase tracking-wider ${linkedProvider ? "text-brand-green" : "text-navy-500 dark:text-zinc-400"}`}>
                    {linkedProvider ? `${linkedProvider.materialsCount || 0} precios vinculados` : "Referencia sectorial"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {providerOptions.length === 0 && (
          <div className="text-center py-10 bg-navy-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-navy-200 dark:border-zinc-700 mb-8">
            <Store className="h-8 w-8 text-[#00c896] mb-2 mx-auto" />
            <h4 className="text-sm font-bold text-navy-900 dark:text-white">Sin proveedores disponibles</h4>
            <p className="text-xs text-navy-500 dark:text-zinc-400 mt-1 max-w-xs mx-auto">
              Los proveedores se generan automáticamente con el análisis IA. Vuelve al paso anterior y usa "Generar con IA".
            </p>
          </div>
        )}
        <div className="mb-3">
          <h3 className="text-sm font-bold text-navy-900 dark:text-white">Fuentes aplicadas a la cesta actual</h3>
          <p className="text-xs text-navy-500 dark:text-zinc-400">
            Este resumen muestra el precio elegido para cada material. Las demás ofertas se consultan y seleccionan dentro de cada fila.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {providerOptions.map(provider => {
            return (
              <div 
                key={provider.id}
                className="relative rounded-xl border border-navy-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {provider.isRecommended && (
                  <div className="absolute -top-3 -right-3 bg-brand-green text-navy-900 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full shadow-sm">
                    Fuente principal
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
                    <div className="text-[10px] text-navy-400 dark:text-zinc-500 uppercase tracking-wider">
                      {provider.isRealData ? "Cesta con precio verificado" : "Base técnica de trabajo"}
                    </div>
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
              <Package className="h-8 w-8 text-[#00c896] mb-2 mx-auto" />
              <h4 className="text-sm font-bold text-navy-900 dark:text-white">Sin materiales disponibles</h4>
              <p className="text-xs text-navy-500 dark:text-zinc-400 mt-1 max-w-xs mx-auto">
                Los materiales se generan automáticamente con la IA o desde tu catálogo de precios. Vuelve al paso anterior y usa "Generar con IA" para obtener una lista completa.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              {/* Provider coverage banner */}
              {hasProviderEnrichment && (
                <div className="mb-3 p-3 rounded-lg border bg-navy-50 dark:bg-zinc-800/50 border-navy-200 dark:border-zinc-700 flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-bold text-navy-700 dark:text-zinc-300">Cobertura del proveedor:</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 font-semibold">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    {providerMatchCount} de {materials.length} con precio del proveedor
                  </span>
                  {providerMissingCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 font-semibold">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                      {providerMissingCount} con precio estimado/base
                    </span>
                  )}
                </div>
              )}
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
                  {materials.map((m) => {
                    const offers = isCommercialProductMaterial(m) ? getComparableOffers(m, 5) : [];
                    const isExpanded = expandedMaterialId === m.id;
                    return (
                      <React.Fragment key={m.id}>
                        <tr className={`hover:bg-navy-50/50 dark:hover:bg-zinc-800/50 transition-colors ${!m.included ? 'opacity-50' : ''}`}>
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              checked={m.included}
                              onChange={(e) => updateMaterial(m.id, { included: e.target.checked })}
                              className="rounded border-navy-300 text-brand-green focus:ring-brand-green/20"
                            />
                          </td>
                          <td className="p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-navy-900 dark:text-white">{m.name}</p>
                              <span
                                className={`${getBadgeProps(m.sourceType, m.isRealData, m).className} border text-[9px] px-1 rounded-sm uppercase tracking-wider font-semibold`}
                                title={(m as any).provider_fallback_reason || "Fuente de datos"}
                              >
                                {getBadgeProps(m.sourceType, m.isRealData, m).label}
                              </span>
                              {offers.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedMaterialId(isExpanded ? null : m.id)}
                                  className="inline-flex items-center gap-1 rounded border border-navy-200 px-2 py-0.5 text-[10px] font-semibold text-navy-700 hover:border-brand-green hover:text-navy-900 dark:border-zinc-700 dark:text-zinc-300"
                                >
                                  {offers.length} alternativas
                                  <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                </button>
                              )}
                            </div>
                            {m.specification && (
                              <p className="mt-1 text-[11px] leading-4 text-navy-600 dark:text-zinc-400">
                                Especificación verificable: {m.specification}
                              </p>
                            )}
                            <div className="mt-1 text-[10px] text-navy-400 dark:text-zinc-500 flex flex-wrap gap-x-3 gap-y-1">
                              <span>{m.sourceName || "Sin proveedor verificado"}</span>
                              {m.matchedProductName && (
                                <span className="basis-full text-navy-500 dark:text-zinc-400">
                                  Coincidencia: {m.matchedProductName}
                                </span>
                              )}
                              {m.priceCheckedAt && (
                                <span>Comprobado: {new Date(m.priceCheckedAt).toLocaleDateString("es-ES")}</span>
                              )}
                              {typeof m.confidenceScore === "number" && (
                                <span>{m.isRealData ? "Coincidencia verificada" : "Confianza provisional"}: {Math.round(m.confidenceScore * 100)}%</span>
                              )}
                              {typeof m.deliveryDays === "number" && (
                                <span>Entrega: hasta {m.deliveryDays} días</span>
                              )}
                              {m.isAvailable === false && <span className="font-semibold text-red-600">Sin disponibilidad</span>}
                              {m.sourceUrl && (
                                <a href={m.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                                  {m.isRealData ? "Abrir fuente oficial" : "Revisar candidato"} <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
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
                          <td className="p-3 text-sm text-navy-600 dark:text-zinc-400">{m.unit}</td>
                          <td className="p-3 text-right text-sm text-navy-600 dark:text-zinc-400">{m.unit_price.toFixed(2)} EUR</td>
                          <td className="p-3 text-right font-bold text-navy-900 dark:text-white text-sm">{m.subtotal.toFixed(2)} EUR</td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} className="bg-navy-50/70 p-3 dark:bg-zinc-800/40">
                              <div className="mb-2 flex items-center justify-between">
                                <div>
                                  <div className="text-xs font-bold text-navy-900 dark:text-white">Ofertas equivalentes encontradas</div>
                                  <div className="text-[10px] text-navy-500 dark:text-zinc-400">Ordenadas por disponibilidad, trazabilidad, fiabilidad y coste efectivo.</div>
                                </div>
                              </div>
                              <div className="grid gap-2 lg:grid-cols-2">
                                {offers.map((offer) => {
                                  const isCurrent = Boolean(m.sourceUrl && offer.url && m.sourceUrl === offer.url) || (
                                    m.sourceName === offer.canonicalSupplier &&
                                    m.matchedProductName === offer.title &&
                                    Math.abs(m.unit_price - offer.displayPrice) < 0.001
                                  );
                                  return (
                                    <div key={`${offer.supplierId}-${offer.productId || offer.title}-${offer.displayPrice}`} className="rounded-lg border border-navy-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="text-xs font-bold text-navy-900 dark:text-white">{offer.canonicalSupplier}</span>
                                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${offer.isTraceable ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
                                              {offer.isTraceable ? "Trazable" : "Por validar"}
                                            </span>
                                          </div>
                                          <p className="mt-1 line-clamp-2 text-[11px] text-navy-600 dark:text-zinc-400">{offer.title}</p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                          <div className="text-sm font-black text-navy-900 dark:text-white">{offer.displayPrice.toFixed(2)} €</div>
                                          <div className="text-[9px] text-navy-400">/{offer.unit}</div>
                                        </div>
                                      </div>
                                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-navy-500 dark:text-zinc-400">
                                        <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> {Math.round((offer.confidenceScore ?? 0) * 100)}%</span>
                                        <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> {offer.deliveryDays ? `hasta ${offer.deliveryDays} días` : "plazo a confirmar"}</span>
                                        <span>{offer.isAvailable === false ? "Sin disponibilidad" : "Disponible"}</span>
                                        {offer.checkedAt && <span>{new Date(offer.checkedAt).toLocaleDateString("es-ES")}</span>}
                                      </div>
                                      <div className="mt-3 flex items-center justify-between gap-2">
                                        {offer.url ? (
                                          <a href={offer.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:underline">
                                            {offer.isTraceable ? "Abrir fuente oficial" : "Fuente del candidato"} <ExternalLink className="h-3 w-3" />
                                          </a>
                                        ) : <span className="text-[10px] text-amber-600">Sin enlace verificable</span>}
                                        <button
                                          type="button"
                                          disabled={isCurrent || offer.isAvailable === false}
                                          onClick={() => selectOffer(m.id, offer)}
                                          className={`rounded px-2.5 py-1.5 text-[10px] font-bold ${isCurrent ? "bg-green-100 text-green-700" : offer.isAvailable === false ? "cursor-not-allowed bg-navy-100 text-navy-400 dark:bg-zinc-800" : "bg-navy-900 text-white hover:bg-brand-green hover:text-navy-900 dark:bg-white dark:text-navy-900"}`}
                                        >
                                          {isCurrent ? "Precio actual" : offer.isAvailable === false ? "No disponible" : offer.isTraceable ? "Usar esta oferta" : "Usar como provisional"}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
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
                  {(priceRefreshResult.summary.fromN8n || 0) > 0 && (
                    <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400">
                      Rastreador: {priceRefreshResult.summary.fromN8n}
                    </span>
                  )}
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
          Descarga el presupuesto en PDF antes o después de finalizar. El PDF cliente es limpio y profesional; el interno incluye costes, márgenes y notas.
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
