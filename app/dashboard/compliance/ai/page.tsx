"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { SupabaseClient } from "@supabase/supabase-js";

interface AiRun {
  id: string;
  run_type: "budget_generation" | "ocr_invoice" | string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  human_reviewed: boolean;
  entity_type: string;
  created_at: string;
}

interface AiSummary {
  totalRuns: number;
  runsByType: Record<string, number>;
  avgDuration: number;
  totalTokens: number;
}

async function loadAiRuns(supabase: SupabaseClient, userId: string): Promise<AiRun[]> {
  const { data } = await supabase
    .from("ai_runs")
    .select("id, run_type, model, tokens_in, tokens_out, duration_ms, human_reviewed, entity_type, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  return data || [];
}

async function markAsHumanReviewed(supabase: SupabaseClient, runId: string) {
  const { error } = await supabase
    .from("ai_runs")
    .update({ human_reviewed: true })
    .eq("id", runId);

  return !error;
}

async function loadAiSummary(supabase: SupabaseClient, userId: string): Promise<AiSummary> {
  const { data } = await supabase
    .from("ai_runs")
    .select("id, run_type, duration_ms, tokens_in, tokens_out")
    .eq("user_id", userId);

  const runs = data || [];
  const totalRuns = runs.length;
  const runsByType: Record<string, number> = {};
  let totalDuration = 0;
  let totalTokens = 0;

  runs.forEach((run) => {
    runsByType[run.run_type] = (runsByType[run.run_type] || 0) + 1;
    totalDuration += run.duration_ms || 0;
    totalTokens += (run.tokens_in || 0) + (run.tokens_out || 0);
  });

  return {
    totalRuns,
    runsByType,
    avgDuration: totalRuns > 0 ? Math.round(totalDuration / totalRuns) : 0,
    totalTokens,
  };
}

export default function AiCompliancePage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<AiSummary>({
    totalRuns: 0,
    runsByType: {},
    avgDuration: 0,
    totalTokens: 0,
  });
  const [aiRuns, setAiRuns] = useState<AiRun[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [summaryData, runsData] = await Promise.all([
        loadAiSummary(supabase, user.id),
        loadAiRuns(supabase, user.id),
      ]);

      setSummary(summaryData);
      setAiRuns(runsData);
      setLoading(false);
    }
    fetch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleMarkReviewed(runId: string) {
    setReviewingId(runId);
    const success = await markAsHumanReviewed(supabase, runId);
    if (success) {
      setAiRuns((prev) =>
        prev.map((r) => (r.id === runId ? { ...r, human_reviewed: true } : r))
      );
    }
    setReviewingId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div>
      </div>
    );
  }

  const runTypeLabels: Record<string, string> = {
    budget_generation: "Generación de Presupuestos",
    ocr_invoice: "OCR de Facturas",
  };

  const notReviewedCount = aiRuns.filter((r) => !r.human_reviewed).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Compliance de IA</h1>
        <p className="text-[var(--color-navy-400)] text-sm">Auditoría de ejecuciones de IA y supervisión humana</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total Ejecuciones" value={String(summary.totalRuns)} color="text-[var(--color-navy-100)]" />
        <KpiCard
          label="Por Revisar"
          value={String(notReviewedCount)}
          color={notReviewedCount > 0 ? "text-yellow-400" : "text-emerald-400"}
        />
        <KpiCard label="Duración Promedio" value={`${summary.avgDuration}ms`} color="text-blue-400" />
        <KpiCard label="Tokens Totales" value={String(summary.totalTokens)} color="text-[var(--color-brand-green)]" />
      </div>

      {/* Run Types Summary */}
      {Object.keys(summary.runsByType).length > 0 && (
        <div className="bg-[var(--color-navy-800)] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">
            Ejecuciones por Tipo
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(summary.runsByType).map(([type, count]) => (
              <div key={type} className="p-4 rounded-lg bg-[var(--color-navy-750)] text-center">
                <p className="text-lg font-bold text-[var(--color-brand-green)]">{count}</p>
                <p className="text-xs text-[var(--color-navy-400)] mt-1">{runTypeLabels[type] || type}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Runs Table */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-6">
        <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">
          Ejecuciones Recientes
        </h2>

        {aiRuns.length === 0 ? (
          <p className="text-[var(--color-navy-400)] text-sm">No hay ejecuciones de IA registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-navy-700)]">
                <tr>
                  <th className="text-left px-4 py-3 text-[var(--color-navy-300)] font-semibold">Tipo</th>
                  <th className="text-left px-4 py-3 text-[var(--color-navy-300)] font-semibold">Modelo</th>
                  <th className="text-left px-4 py-3 text-[var(--color-navy-300)] font-semibold">Entidad</th>
                  <th className="text-right px-4 py-3 text-[var(--color-navy-300)] font-semibold">Tokens</th>
                  <th className="text-right px-4 py-3 text-[var(--color-navy-300)] font-semibold">Duración</th>
                  <th className="text-center px-4 py-3 text-[var(--color-navy-300)] font-semibold">Revisado</th>
                  <th className="text-left px-4 py-3 text-[var(--color-navy-300)] font-semibold">Fecha</th>
                  <th className="text-center px-4 py-3 text-[var(--color-navy-300)] font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody>
                {aiRuns.map((run) => (
                  <tr key={run.id} className="border-b border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition">
                    <td className="px-4 py-3 text-[var(--color-navy-200)]">
                      {runTypeLabels[run.run_type] || run.run_type}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-navy-300)] font-mono text-xs">{run.model}</td>
                    <td className="px-4 py-3 text-[var(--color-navy-300)]">{run.entity_type}</td>
                    <td className="px-4 py-3 text-right text-[var(--color-navy-200)]">
                      {run.tokens_in + run.tokens_out}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-navy-200)]">
                      {run.duration_ms}ms
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        run.human_reviewed
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-yellow-500/20 text-yellow-300"
                      }`}>
                        {run.human_reviewed ? "✓" : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-navy-400)]">
                      {new Date(run.created_at).toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {!run.human_reviewed && (
                        <button
                          onClick={() => handleMarkReviewed(run.id)}
                          disabled={reviewingId === run.id}
                          className="text-xs px-2 py-1 bg-[var(--color-brand-green)] text-[var(--color-navy-900)] rounded font-medium hover:opacity-90 transition disabled:opacity-50"
                        >
                          {reviewingId === run.id ? "..." : "Revisar"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Human Review Alert */}
      {notReviewedCount > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <p className="text-sm text-yellow-300">
            <span className="font-semibold">{notReviewedCount} ejecución{notReviewedCount !== 1 ? "es" : ""} pendiente{notReviewedCount !== 1 ? "s" : ""} de revisar humanamente.</span> La supervisión humana es obligatoria para garantizar la conformidad con la normativa de IA.
          </p>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-xs text-[var(--color-navy-400)] mt-1">{label}</p>
    </div>
  );
}
