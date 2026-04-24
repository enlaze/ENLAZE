"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { SupabaseClient } from "@supabase/supabase-js";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import Loading from "@/components/ui/loading";

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
  const supabase = createClient();

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

  if (loading) return <Loading />;

  const runTypeLabels: Record<string, string> = {
    budget_generation: "Generación de Presupuestos",
    ocr_invoice: "OCR de Facturas",
  };

  const notReviewedCount = aiRuns.filter((r) => !r.human_reviewed).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Cumplimiento de IA"
        description="Auditoría de ejecuciones de IA y supervisión humana."
      />

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total ejecuciones" value={summary.totalRuns} />
        <StatCard
          label="Por revisar"
          value={notReviewedCount}
          accent={notReviewedCount > 0 ? "yellow" : "green"}
        />
        <StatCard label="Duración promedio" value={`${summary.avgDuration}ms`} accent="blue" />
        <StatCard label="Tokens totales" value={summary.totalTokens} accent="green" />
      </div>

      {/* Run Types Summary */}
      {Object.keys(summary.runsByType).length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">
            Ejecuciones por tipo
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(summary.runsByType).map(([type, count]) => (
              <div
                key={type}
                className="p-4 rounded-xl border border-navy-100 bg-navy-50 text-center dark:border-zinc-800 dark:bg-zinc-800"
              >
                <p className="text-lg font-bold text-brand-green">{count}</p>
                <p className="text-xs text-navy-500 dark:text-zinc-400 mt-1">{runTypeLabels[type] || type}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* AI Runs Table */}
      <Card padding={false}>
        <div className="p-6 pb-4">
          <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider">
            Ejecuciones recientes
          </h2>
        </div>

        {aiRuns.length === 0 ? (
          <p className="px-6 pb-6 text-navy-500 dark:text-zinc-400 text-sm">
            No hay ejecuciones de IA registradas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 border-y border-navy-100 dark:bg-zinc-800/50 dark:border-zinc-800">
                <tr>
                  <th className="text-left px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">Tipo</th>
                  <th className="text-left px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">Modelo</th>
                  <th className="text-left px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">Entidad</th>
                  <th className="text-right px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">Tokens</th>
                  <th className="text-right px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">Duración</th>
                  <th className="text-center px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">Revisado</th>
                  <th className="text-left px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">Fecha</th>
                  <th className="text-center px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody>
                {aiRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-navy-100 last:border-0 hover:bg-navy-50 transition dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  >
                    <td className="px-4 py-3 text-navy-800 dark:text-zinc-200">
                      {runTypeLabels[run.run_type] || run.run_type}
                    </td>
                    <td className="px-4 py-3 text-navy-600 dark:text-zinc-400 font-mono text-xs">{run.model}</td>
                    <td className="px-4 py-3 text-navy-600 dark:text-zinc-400">{run.entity_type}</td>
                    <td className="px-4 py-3 text-right text-navy-800 dark:text-zinc-200">
                      {run.tokens_in + run.tokens_out}
                    </td>
                    <td className="px-4 py-3 text-right text-navy-800 dark:text-zinc-200">
                      {run.duration_ms}ms
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${
                          run.human_reviewed
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900"
                            : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900"
                        }`}
                      >
                        {run.human_reviewed ? "✓" : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-navy-500 dark:text-zinc-400">
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
                          className="text-xs px-3 py-1 bg-brand-green text-navy-900 rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
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
      </Card>

      {/* Human Review Alert */}
      {notReviewedCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 dark:bg-amber-950/30 dark:border-amber-900">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <span className="font-semibold">
              {notReviewedCount} ejecución{notReviewedCount !== 1 ? "es" : ""} pendiente
              {notReviewedCount !== 1 ? "s" : ""} de revisar humanamente.
            </span>{" "}
            La supervisión humana es obligatoria para garantizar la conformidad con la normativa de IA.
          </p>
        </div>
      )}
    </div>
  );
}
