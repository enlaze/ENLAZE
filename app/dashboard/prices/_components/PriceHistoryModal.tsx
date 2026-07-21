"use client";

import { useEffect, useState } from "react";

interface HistoryPoint {
  id: string;
  price_excl_vat: number;
  checked_at: string;
  is_available: boolean;
}

interface Props {
  productId: string;
  productName: string;
  onClose: () => void;
}

export default function PriceHistoryModal({ productId, productName, onClose }: Props) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);
  const [product, setProduct] = useState<any>(null);

  useEffect(() => {
    loadHistory();
  }, [productId, days]);

  async function loadHistory() {
    setLoading(true);
    try {
      const res = await fetch(`/api/prices/history?product_id=${productId}&days=${days}`);
      const data = await res.json();
      setHistory(data.history || []);
      setProduct(data.product || null);
    } catch (err) {
      console.error("Error loading history:", err);
    } finally {
      setLoading(false);
    }
  }

  // Calculate stats
  const prices = history.map((h) => Number(h.price_excl_vat));
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const currentPrice = prices.length > 0 ? prices[prices.length - 1] : 0;
  const firstPrice = prices.length > 0 ? prices[0] : 0;
  const changePct = firstPrice > 0 ? ((currentPrice - firstPrice) / firstPrice) * 100 : 0;

  // Build SVG chart
  const chartW = 600;
  const chartH = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const innerW = chartW - padding.left - padding.right;
  const innerH = chartH - padding.top - padding.bottom;

  const priceRange = maxPrice - minPrice || 1;
  const timeRange = history.length > 1
    ? new Date(history[history.length - 1].checked_at).getTime() - new Date(history[0].checked_at).getTime()
    : 1;

  const points = history.map((h, i) => {
    const x = padding.left + (history.length > 1
      ? ((new Date(h.checked_at).getTime() - new Date(history[0].checked_at).getTime()) / timeRange) * innerW
      : innerW / 2);
    const y = padding.top + innerH - ((Number(h.price_excl_vat) - minPrice) / priceRange) * innerH;
    return { x, y, price: Number(h.price_excl_vat), date: h.checked_at };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = linePath + ` L ${points[points.length - 1]?.x || 0} ${padding.top + innerH} L ${points[0]?.x || 0} ${padding.top + innerH} Z`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-navy-100 dark:border-zinc-800 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-navy-100 dark:border-zinc-800">
          <div>
            <h3 className="text-lg font-bold text-navy-900 dark:text-white">{productName}</h3>
            <p className="text-sm text-navy-500 dark:text-zinc-400">
              {product?.pb_providers?.name || "Proveedor desconocido"}
              {product?.brand ? ` - ${product.brand}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-navy-700 dark:text-zinc-500 dark:hover:text-zinc-300 text-xl">
            &times;
          </button>
        </div>

        {/* Period selector */}
        <div className="flex gap-2 px-5 pt-4">
          {[30, 90, 180, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                days === d
                  ? "bg-brand-green text-white"
                  : "bg-navy-50 text-navy-600 hover:bg-navy-100 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>

        {/* Chart */}
        <div className="p-5">
          {loading ? (
            <div className="h-[200px] flex items-center justify-center text-navy-400">
              Cargando historial...
            </div>
          ) : history.length < 2 ? (
            <div className="h-[200px] flex items-center justify-center text-navy-400 dark:text-zinc-500">
              <div className="text-center">
                <p className="text-lg font-medium">Sin datos suficientes</p>
                <p className="text-sm mt-1">Se necesitan al menos 2 observaciones de precio para mostrar el grafico.</p>
              </div>
            </div>
          ) : (
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-auto">
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                const y = padding.top + innerH * (1 - pct);
                const price = minPrice + priceRange * pct;
                return (
                  <g key={pct}>
                    <line x1={padding.left} y1={y} x2={chartW - padding.right} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                    <text x={padding.left - 8} y={y + 4} textAnchor="end" className="text-[10px]" fill="#94a3b8">
                      {price.toFixed(2)}
                    </text>
                  </g>
                );
              })}

              {/* Area fill */}
              <path d={areaPath} fill="url(#greenGradient)" opacity="0.3" />

              {/* Line */}
              <path d={linePath} fill="none" stroke="#00c896" strokeWidth="2.5" strokeLinejoin="round" />

              {/* Dots */}
              {points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="3" fill="#00c896" stroke="white" strokeWidth="1.5" />
              ))}

              {/* Gradient definition */}
              <defs>
                <linearGradient id="greenGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00c896" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#00c896" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* X axis labels */}
              {points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 5)) === 0 || i === points.length - 1).map((p, i) => (
                <text key={i} x={p.x} y={chartH - 5} textAnchor="middle" className="text-[9px]" fill="#94a3b8">
                  {new Date(p.date).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                </text>
              ))}
            </svg>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 px-5 pb-5">
          <div className="rounded-xl bg-navy-50 dark:bg-zinc-800 p-3 text-center">
            <p className="text-[10px] text-navy-500 dark:text-zinc-400 uppercase font-medium">Actual</p>
            <p className="text-lg font-bold text-navy-900 dark:text-white">{currentPrice.toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-navy-50 dark:bg-zinc-800 p-3 text-center">
            <p className="text-[10px] text-navy-500 dark:text-zinc-400 uppercase font-medium">Minimo</p>
            <p className="text-lg font-bold text-emerald-600">{minPrice.toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-navy-50 dark:bg-zinc-800 p-3 text-center">
            <p className="text-[10px] text-navy-500 dark:text-zinc-400 uppercase font-medium">Maximo</p>
            <p className="text-lg font-bold text-red-500">{maxPrice.toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-navy-50 dark:bg-zinc-800 p-3 text-center">
            <p className="text-[10px] text-navy-500 dark:text-zinc-400 uppercase font-medium">Variacion</p>
            <p className={`text-lg font-bold ${changePct > 0 ? "text-red-500" : changePct < 0 ? "text-emerald-600" : "text-navy-500"}`}>
              {changePct > 0 ? "+" : ""}{changePct.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Observation list */}
        {history.length > 0 && (
          <div className="px-5 pb-5">
            <p className="text-xs font-semibold text-navy-600 dark:text-zinc-400 uppercase mb-2">
              Ultimas observaciones ({history.length})
            </p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-navy-100 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-navy-50 dark:bg-zinc-800 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-navy-500">Fecha</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-navy-500">Precio</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-navy-500">Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((h, i, arr) => {
                    const prev = arr[i + 1];
                    const change = prev ? Number(h.price_excl_vat) - Number(prev.price_excl_vat) : 0;
                    return (
                      <tr key={h.id} className="border-t border-navy-50 dark:border-zinc-800">
                        <td className="px-3 py-1.5 text-navy-600 dark:text-zinc-300">
                          {new Date(h.checked_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium text-navy-900 dark:text-white">
                          {Number(h.price_excl_vat).toFixed(2)} EUR
                        </td>
                        <td className={`px-3 py-1.5 text-right font-medium ${change > 0 ? "text-red-500" : change < 0 ? "text-emerald-600" : "text-navy-400"}`}>
                          {change !== 0 ? `${change > 0 ? "+" : ""}${change.toFixed(2)}` : "="}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
