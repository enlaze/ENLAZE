"use client";

import { useState } from "react";

interface ProviderEntry {
  provider_id: string;
  provider_name: string;
  provider_website: string | null;
  product_id: string;
  product_name: string;
  brand: string | null;
  unit_price: number;
  sale_unit: string;
  is_available: boolean;
  updated_at: string;
}

interface Comparison {
  product_name: string;
  providers: ProviderEntry[];
  min_price: number;
  max_price: number;
  price_spread_pct: string;
}

interface Props {
  onViewHistory: (productId: string, productName: string) => void;
}

export default function ProviderComparePanel({ onViewHistory }: Props) {
  const [query, setQuery] = useState("");
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function search() {
    if (query.trim().length < 2) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/prices/compare?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setComparisons(data.comparisons || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const INPUT_CLS = "w-full rounded-xl border border-navy-200 bg-navy-50/60 px-4 py-2.5 text-sm text-navy-900 placeholder:text-navy-400 focus:border-brand-green/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-green/20 transition-colors dark:border-zinc-800 dark:bg-zinc-900 dark:text-white";

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Buscar material para comparar (ej: cemento, azulejo, tuberia...)"
          className={INPUT_CLS + " flex-1"}
        />
        <button
          onClick={search}
          disabled={loading || query.trim().length < 2}
          className="px-5 py-2.5 text-sm font-medium text-white bg-brand-green rounded-xl hover:bg-brand-green-dark disabled:opacity-50 transition whitespace-nowrap"
        >
          {loading ? "Buscando..." : "Comparar"}
        </button>
      </div>

      {/* Results */}
      {loading ? (
        <div className="text-center text-navy-400 py-12">Buscando proveedores...</div>
      ) : comparisons.length === 0 && searched ? (
        <div className="text-center text-navy-400 dark:text-zinc-500 py-12">
          <p className="text-lg font-medium mb-1">No se encontraron productos</p>
          <p className="text-sm">Prueba con otro termino de busqueda.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {comparisons.map((comp, ci) => (
            <div key={ci} className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 bg-navy-50 dark:bg-zinc-800">
                <div>
                  <h4 className="text-sm font-bold text-navy-900 dark:text-white">{comp.product_name}</h4>
                  <p className="text-xs text-navy-500 dark:text-zinc-400">
                    {comp.providers.length} proveedor{comp.providers.length !== 1 ? "es" : ""}
                    {comp.providers.length > 1 && ` | Diferencia: ${comp.price_spread_pct}%`}
                  </p>
                </div>
                {comp.providers.length > 1 && (
                  <div className="text-right">
                    <p className="text-xs text-navy-500 dark:text-zinc-400">Mejor precio</p>
                    <p className="text-lg font-bold text-emerald-600">{comp.min_price.toFixed(2)} EUR</p>
                  </div>
                )}
              </div>

              {/* Provider rows */}
              <div className="divide-y divide-navy-50 dark:divide-zinc-800">
                {comp.providers
                  .sort((a, b) => a.unit_price - b.unit_price)
                  .map((prov, pi) => {
                    const isBest = prov.unit_price === comp.min_price && comp.providers.length > 1;
                    return (
                      <div key={pi} className={`flex items-center justify-between px-5 py-3 ${isBest ? "bg-emerald-50/50 dark:bg-emerald-900/10" : ""}`}>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-navy-900 dark:text-white">{prov.provider_name}</span>
                            {isBest && (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 dark:bg-emerald-900 dark:text-emerald-300 px-1.5 py-0.5 rounded-full uppercase">
                                Mejor precio
                              </span>
                            )}
                            {!prov.is_available && (
                              <span className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">
                                No disponible
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-navy-500 dark:text-zinc-400">
                            {prov.product_name}
                            {prov.brand ? ` - ${prov.brand}` : ""}
                            {" | "}
                            {prov.sale_unit}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className={`text-lg font-bold ${isBest ? "text-emerald-600" : "text-navy-900 dark:text-white"}`}>
                              {prov.unit_price.toFixed(2)} EUR
                            </p>
                            <p className="text-[10px] text-navy-400">
                              Act. {new Date(prov.updated_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                            </p>
                          </div>
                          <button
                            onClick={() => onViewHistory(prov.product_id, prov.product_name)}
                            className="text-xs text-brand-green hover:text-brand-green-dark font-medium px-2 py-1"
                            title="Ver historial de precios"
                          >
                            Historial
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
