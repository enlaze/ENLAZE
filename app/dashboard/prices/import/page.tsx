"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import PageHeader from "@/components/ui/page-header";

/* ─── Types ──────────────────────────────────────────────────────── */

interface ColumnMapping {
  name: string | null;
  unit: string | null;
  unit_price: string | null;
  brand: string | null;
  sku: string | null;
  category: string | null;
  description: string | null;
}

interface ImportRow {
  row_number: number;
  name: string;
  unit: string;
  unit_price: number;
  brand: string | null;
  sku: string | null;
  category: string | null;
  description: string | null;
  is_valid: boolean;
  errors: string[];
}

interface AnalysisResult {
  ok: boolean;
  file_name: string;
  file_type: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  detected_columns: string[];
  suggested_mapping: ColumnMapping;
  preview: ImportRow[];
  warnings: string[];
  errors: string[];
}

type Step = "upload" | "preview" | "confirm" | "done";

/* ─── Styles ─────────────────────────────────────────────────────── */

const INPUT_CLS =
  "w-full rounded-xl border border-navy-200 bg-navy-50/60 px-4 py-2.5 text-sm text-navy-900 placeholder:text-navy-400 focus:border-brand-green/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-green/20 transition-colors dark:border-zinc-800 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500";

const BTN_PRIMARY =
  "inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const BTN_SECONDARY =
  "inline-flex items-center gap-2 rounded-xl border border-navy-200 bg-white px-5 py-2.5 text-sm font-medium text-navy-700 shadow-sm hover:bg-navy-50 transition-colors dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700";

/* ═══════════════════════════════════════════════════════════════════ */

export default function ImportPricesPage() {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({
    name: null, unit: null, unit_price: null,
    brand: null, sku: null, category: null, description: null,
  });
  const [providerName, setProviderName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    products_created: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  /* ── Upload & analyze ──────────────────────────────────────────── */

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setAnalysis(null);
    setStep("upload");
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!file) return;
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/pb/import/analyze", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Error al analizar");
        return;
      }

      setAnalysis(data as AnalysisResult);
      setMapping(data.suggested_mapping);
      setStep("preview");
    } catch {
      toast.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  }, [file, toast]);

  /* ── Re-analyze with updated mapping ───────────────────────────── */

  const handleRemapAndAnalyze = useCallback(async () => {
    if (!file) return;
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));

      const res = await fetch("/api/pb/import/analyze", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Error al re-analizar");
        return;
      }

      setAnalysis(data as AnalysisResult);
      toast.success("Mapeo actualizado");
    } catch {
      toast.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  }, [file, mapping, toast]);

  /* ── Process import ────────────────────────────────────────────── */

  const handleImport = useCallback(async () => {
    if (!analysis || !providerName.trim()) {
      toast.error("Indica el nombre del proveedor");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/pb/import/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: analysis.preview.filter((r) => r.is_valid),
          provider_name: providerName.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Error al importar");
        return;
      }

      setResult({
        products_created: data.products_created,
        skipped: data.skipped,
        errors: data.errors || [],
      });
      setStep("done");
      toast.success(`${data.products_created} productos importados`);
    } catch {
      toast.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  }, [analysis, providerName, toast]);

  /* ─── Render ───────────────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Importar precios"
        description="Sube un CSV con productos y precios de un proveedor"
        breadcrumbs={[
          { label: "Catálogo de precios", href: "/dashboard/prices" },
          { label: "Importar" },
        ]}
      />

      {/* ── Step indicator ── */}
      <div className="flex items-center gap-3 text-sm">
        {(["upload", "preview", "confirm", "done"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                step === s
                  ? "bg-brand-green text-white"
                  : i < ["upload", "preview", "confirm", "done"].indexOf(step)
                  ? "bg-brand-green/20 text-brand-green"
                  : "bg-navy-100 text-navy-400 dark:bg-zinc-800 dark:text-zinc-500"
              }`}
            >
              {i + 1}
            </div>
            <span className={step === s ? "font-medium text-navy-900 dark:text-white" : "text-navy-400 dark:text-zinc-500"}>
              {s === "upload" ? "Subir" : s === "preview" ? "Preview" : s === "confirm" ? "Confirmar" : "Hecho"}
            </span>
            {i < 3 && <div className="h-px w-8 bg-navy-200 dark:bg-zinc-700" />}
          </div>
        ))}
      </div>

      {/* ── Step: Upload ── */}
      {step === "upload" && (
        <div className="rounded-2xl border border-navy-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto max-w-md space-y-6">
            <div className="rounded-2xl border-2 border-dashed border-navy-200 bg-navy-50/40 p-10 text-center dark:border-zinc-700 dark:bg-zinc-800/50">
              <div className="mb-3 text-3xl">📄</div>
              <p className="mb-4 text-sm text-navy-600 dark:text-zinc-400">
                Arrastra un archivo CSV o haz clic para seleccionar
              </p>
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleFileChange}
                className="mx-auto block w-full max-w-xs text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-green/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-green hover:file:bg-brand-green/20"
              />
            </div>

            {file && (
              <div className="flex items-center justify-between rounded-xl bg-brand-green/5 px-4 py-3 text-sm">
                <span className="font-medium text-navy-900 dark:text-white">{file.name}</span>
                <span className="text-navy-500 dark:text-zinc-400">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={!file || loading}
              className={BTN_PRIMARY + " w-full justify-center"}
            >
              {loading ? "Analizando..." : "Analizar archivo"}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Preview ── */}
      {step === "preview" && analysis && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-navy-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs text-navy-500 dark:text-zinc-400">Total filas</p>
              <p className="mt-1 text-2xl font-bold text-navy-900 dark:text-white">{analysis.total_rows}</p>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-900/20">
              <p className="text-xs text-green-600 dark:text-green-400">Válidas</p>
              <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-300">{analysis.valid_rows}</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-900/20">
              <p className="text-xs text-red-600 dark:text-red-400">Con errores</p>
              <p className="mt-1 text-2xl font-bold text-red-700 dark:text-red-300">{analysis.invalid_rows}</p>
            </div>
          </div>

          {/* Warnings */}
          {analysis.warnings.length > 0 && (
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">Avisos:</p>
              {analysis.warnings.map((w, i) => (
                <p key={i} className="mt-1 text-sm text-yellow-700 dark:text-yellow-400">• {w}</p>
              ))}
            </div>
          )}

          {/* Column mapping */}
          <div className="rounded-2xl border border-navy-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="mb-4 text-sm font-semibold text-navy-900 dark:text-white">Mapeo de columnas</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {(Object.keys(mapping) as (keyof ColumnMapping)[]).map((field) => (
                <div key={field}>
                  <label className="mb-1 block text-xs font-medium text-navy-600 dark:text-zinc-400 capitalize">
                    {field === "unit_price" ? "Precio" : field === "name" ? "Nombre" : field}
                  </label>
                  <select
                    value={mapping[field] || ""}
                    onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || null })}
                    className={INPUT_CLS}
                  >
                    <option value="">— Sin asignar —</option>
                    {analysis.detected_columns.map((col) => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <button
              onClick={handleRemapAndAnalyze}
              disabled={loading}
              className={BTN_SECONDARY + " mt-4"}
            >
              {loading ? "Re-analizando..." : "Aplicar mapeo"}
            </button>
          </div>

          {/* Preview table */}
          <div className="rounded-2xl border border-navy-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-navy-200 px-6 py-4 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
                Preview ({Math.min(analysis.preview.length, 50)} filas)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-100 bg-navy-50/50 dark:border-zinc-800 dark:bg-zinc-800/50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-navy-500 dark:text-zinc-400">#</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-navy-500 dark:text-zinc-400">Nombre</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-navy-500 dark:text-zinc-400">Ud</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-navy-500 dark:text-zinc-400">Precio</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-navy-500 dark:text-zinc-400">Marca</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-navy-500 dark:text-zinc-400">SKU</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-navy-500 dark:text-zinc-400">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.preview.slice(0, 30).map((row) => (
                    <tr
                      key={row.row_number}
                      className={`border-b border-navy-50 dark:border-zinc-800/50 ${
                        !row.is_valid ? "bg-red-50/50 dark:bg-red-900/10" : ""
                      }`}
                    >
                      <td className="px-4 py-2 text-navy-400 dark:text-zinc-500">{row.row_number}</td>
                      <td className="max-w-[200px] truncate px-4 py-2 font-medium text-navy-900 dark:text-white">{row.name || "—"}</td>
                      <td className="px-4 py-2 text-navy-600 dark:text-zinc-400">{row.unit}</td>
                      <td className="px-4 py-2 text-right font-mono text-navy-900 dark:text-white">
                        {row.unit_price > 0 ? row.unit_price.toFixed(2) + " €" : "—"}
                      </td>
                      <td className="px-4 py-2 text-navy-600 dark:text-zinc-400">{row.brand || "—"}</td>
                      <td className="px-4 py-2 text-navy-600 dark:text-zinc-400">{row.sku || "—"}</td>
                      <td className="px-4 py-2 text-center">
                        {row.is_valid ? (
                          <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">OK</span>
                        ) : (
                          <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400" title={row.errors.join(", ")}>
                            Error
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={() => setStep("upload")} className={BTN_SECONDARY}>
              Volver
            </button>
            <button
              onClick={() => setStep("confirm")}
              disabled={analysis.valid_rows === 0}
              className={BTN_PRIMARY}
            >
              Continuar con {analysis.valid_rows} filas válidas
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Confirm ── */}
      {step === "confirm" && analysis && (
        <div className="rounded-2xl border border-navy-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto max-w-md space-y-6">
            <h3 className="text-lg font-semibold text-navy-900 dark:text-white">Confirmar importación</h3>

            <div className="rounded-xl bg-navy-50 p-4 dark:bg-zinc-800">
              <p className="text-sm text-navy-600 dark:text-zinc-400">
                Se importarán <strong className="text-navy-900 dark:text-white">{analysis.valid_rows}</strong> productos
                de <strong className="text-navy-900 dark:text-white">{analysis.file_name}</strong>
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy-600 dark:text-zinc-300">
                Nombre del proveedor *
              </label>
              <input
                type="text"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder="Ej: Leroy Merlin, Obramat, Saltoki..."
                className={INPUT_CLS}
              />
              <p className="mt-1.5 text-xs text-navy-400 dark:text-zinc-500">
                Si ya existe un proveedor con este nombre, se vincularán los productos.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setStep("preview")} className={BTN_SECONDARY}>
                Volver
              </button>
              <button
                onClick={handleImport}
                disabled={loading || !providerName.trim()}
                className={BTN_PRIMARY}
              >
                {loading ? "Importando..." : "Importar productos"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Done ── */}
      {step === "done" && result && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center dark:border-green-900 dark:bg-green-900/20">
          <div className="mb-3 text-4xl">✅</div>
          <h3 className="mb-2 text-lg font-semibold text-green-800 dark:text-green-300">
            Importación completada
          </h3>
          <p className="mb-6 text-sm text-green-700 dark:text-green-400">
            {result.products_created} productos creados
            {result.skipped > 0 && ` · ${result.skipped} duplicados omitidos`}
          </p>

          {result.errors.length > 0 && (
            <div className="mx-auto mb-6 max-w-md rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-left dark:border-yellow-800 dark:bg-yellow-900/20">
              <p className="mb-2 text-xs font-medium text-yellow-800 dark:text-yellow-300">
                Errores ({result.errors.length}):
              </p>
              {result.errors.slice(0, 5).map((e, i) => (
                <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400">• {e}</p>
              ))}
              {result.errors.length > 5 && (
                <p className="mt-1 text-xs text-yellow-500">... y {result.errors.length - 5} más</p>
              )}
            </div>
          )}

          <div className="flex justify-center gap-3">
            <button
              onClick={() => {
                setStep("upload");
                setFile(null);
                setAnalysis(null);
                setResult(null);
                setProviderName("");
              }}
              className={BTN_SECONDARY}
            >
              Importar otro archivo
            </button>
            <button
              onClick={() => router.push("/dashboard/prices")}
              className={BTN_PRIMARY}
            >
              Ir al catálogo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
