"use client";

import { useEffect, useState } from "react";

interface Change {
  product_id: string;
  product_name: string;
  provider: string;
  old_price: number;
  new_price: number;
  change_pct: number;
  direction: string;
}

interface Report {
  week_start: string;
  week_end: string;
  total_products_tracked: number;
  products_changed: number;
  avg_change_pct: number;
  biggest_increase: Change | null;
  biggest_decrease: Change | null;
  summary_data: Change[];
}

export default function WeeklyReportPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [weeksBack, setWeeksBack] = useState(1);

  useEffect(() => { loadReport(); }, [weeksBack]);

  async function loadReport() {
    setLoading(true);
    try {
      const res = await fetch(`/api/prices/weekly-report?weeks=${weeksBack}`);
      const data = await res.json();
      setReport(data.report || null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      {/* Week selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-navy-600 dark:text-zinc-400">Semana:</span>
        {[1, 2, 3, 4].map((w) => (
          <button
            key={w}
            onClick={() => setWeeksBack(w)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
              weeksBack === w
                ? "bg-brand-green text-white"
                : "bg-navy-50 text-navy-600 hover:bg-navy-100 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {w === 1 ? "Esta semana" : `Hace ${w} sem.`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-navy-400 py-12">Generando informe...</div>
      ) : !report ? (
        <div className="text-center text-navy-400 py-12">No se pudo generar el informe.</div>
      ) : report.total_products_tracked === 0 ? (
        <div className="text-center text-navy-400 dark:text-zinc-500 py-12">
          <p className="text-lg font-medium mb-1">Sin datos para esta semana</p>
          <p className="text-sm">No se registraron observaciones de precios en el periodo {formatDate(report.week_start)} - {formatDate(report.week_end)}.</p>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <h4 className="text-sm font-semibold text-navy-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
              Informe semanal
            </h4>
            <p className="text-xs text-navy-400 dark:text-zinc-500">
              {formatDate(report.week_start)} &mdash; {formatDate(report.week_end)}
            </p>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-navy-100 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4 text-center">
              <p className="text-[10px] text-navy-500 dark:text-zinc-400 uppercase font-medium">Productos</p>
              <p className="text-2xl font-bold text-brand-green">{report.total_products_tracked}</p>
            </div>
            <div className="rounded-2xl border border-navy-100 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4 text-center">
              <p className="text-[10px] text-navy-500 dark:text-zinc-400 uppercase font-medium">Con cambios</p>
              <p className="text-2xl font-bold text-amber-600">{report.products_changed}</p>
            </div>
            <div className="rounded-2xl border border-navy-100 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4 text-center">
              <p className="text-[10px] text-navy-500 dark:text-zinc-400 uppercase font-medium">Cambio medio</p>
              <p className={`text-2xl font-bold ${report.avg_change_pct > 0 ? "text-red-500" : report.avg_change_pct < 0 ? "text-emerald-600" : "text-navy-500"}`}>
                {report.avg_change_pct > 0 ? "+" : ""}{report.avg_change_pct.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-2xl border border-navy-100 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4 text-center">
              <p className="text-[10px] text-navy-500 dark:text-zinc-400 uppercase font-medium">Estables</p>
              <p className="text-2xl font-bold text-blue-600">
                {report.total_products_tracked - report.products_changed}
              </p>
            </div>
          </div>

          {/* Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {report.biggest_increase && (
              <div className="rounded-2xl border border-red-100 bg-red-50/50 dark:border-red-900 dark:bg-red-900/10 p-4">
                <p className="text-xs font-semibold text-red-600 uppercase mb-2">Mayor subida</p>
                <p className="text-sm font-bold text-navy-900 dark:text-white">{report.biggest_increase.product_name}</p>
                <p className="text-xs text-navy-500 dark:text-zinc-400">{report.biggest_increase.provider}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm text-navy-500">{Number(report.biggest_increase.old_price).toFixed(2)}</span>
                  <span className="text-navy-400">&rarr;</span>
                  <span className="text-sm font-bold text-red-600">{Number(report.biggest_increase.new_price).toFixed(2)} EUR</span>
                  <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 px-1.5 py-0.5 rounded-full">
                    +{Number(report.biggest_increase.change_pct).toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
            {report.biggest_decrease && (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-900/10 p-4">
                <p className="text-xs font-semibold text-emerald-600 uppercase mb-2">Mayor bajada</p>
                <p className="text-sm font-bold text-navy-900 dark:text-white">{report.biggest_decrease.product_name}</p>
                <p className="text-xs text-navy-500 dark:text-zinc-400">{report.biggest_decrease.provider}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm text-navy-500">{Number(report.biggest_decrease.old_price).toFixed(2)}</span>
                  <span className="text-navy-400">&rarr;</span>
                  <span className="text-sm font-bold text-emerald-600">{Number(report.biggest_decrease.new_price).toFixed(2)} EUR</span>
                  <span className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 px-1.5 py-0.5 rounded-full">
                    {Number(report.biggest_decrease.change_pct).toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Changes table */}
          {report.summary_data.length > 0 && (
            <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              <div className="px-5 py-3 bg-navy-50 dark:bg-zinc-800">
                <h4 className="text-sm font-semibold text-navy-700 dark:text-zinc-300">
                  Todos los cambios ({report.summary_data.length})
                </h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-navy-100 dark:border-zinc-800">
                      <th className="text-left px-4 py-2 text-xs font-medium text-navy-500">Producto</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-navy-500">Proveedor</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-navy-500">Antes</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-navy-500">Ahora</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-navy-500">Cambio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.summary_data.map((c, i) => (
                      <tr key={i} className="border-b border-navy-50 dark:border-zinc-800 last:border-b-0">
                        <td className="px-4 py-2 text-navy-900 dark:text-white font-medium">{c.product_name}</td>
                        <td className="px-4 py-2 text-navy-500 dark:text-zinc-400">{c.provider}</td>
                        <td className="px-4 py-2 text-right text-navy-500">{Number(c.old_price).toFixed(2)}</td>
                        <td className="px-4 py-2 text-right font-medium text-navy-900 dark:text-white">{Number(c.new_price).toFixed(2)}</td>
                        <td className={`px-4 py-2 text-right font-bold ${c.direction === "up" ? "text-red-500" : "text-emerald-600"}`}>
                          {c.direction === "up" ? "+" : ""}{Number(c.change_pct).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
