"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";

const INPUT =
  "w-full rounded-xl border border-navy-200 bg-navy-50/60 px-4 py-2.5 text-sm text-navy-900 placeholder:text-navy-400 focus:border-brand-green/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-green/20 transition-colors dark:border-zinc-800 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500";

const LBL = "block text-xs font-medium text-navy-600 dark:text-zinc-300 mb-1.5";

interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
  errors: string[];
  provider: string;
}

export default function ImportPricesPanel({ onImported }: { onImported?: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [providerName, setProviderName] = useState("CYPE / Banco de precios");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Selecciona un archivo CSV primero");
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("provider", providerName);
      formData.append("source", "csv_import");

      const res = await fetch("/api/prices/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error en la importacion");

      setResult(data);
      toast.success(`Importados ${data.imported} productos de ${data.total}`);
      onImported?.();
    } catch (err: any) {
      toast.error(err.message || "Error al importar");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-navy-100 dark:border-zinc-800 p-6 space-y-4">
        <h3 className="text-lg font-semibold text-navy-900 dark:text-white">
          Importar precios desde CSV
        </h3>
        <p className="text-sm text-navy-500 dark:text-zinc-400">
          Sube un archivo CSV con precios de CYPE, BEDEC, o tu propia base de datos.
          El archivo debe tener al menos las columnas <strong>nombre</strong> y <strong>precio</strong>.
          Columnas opcionales: unidad, tipo, categoria, subcategoria, proveedor, marca, descripcion.
        </p>

        {/* Format example */}
        <div className="bg-navy-50 dark:bg-zinc-800 rounded-xl p-4 text-xs font-mono overflow-x-auto">
          <div className="text-navy-500 dark:text-zinc-400 mb-1">Ejemplo de formato CSV:</div>
          <div className="text-navy-700 dark:text-zinc-300">
            nombre;precio;unidad;tipo;categoria;subcategoria<br />
            Cemento gris CEM II 25 kg;4.20;ud;material;albanileria;cementos<br />
            Oficial 1a albanil;22.50;h;mano_obra;mano_obra;albanileria<br />
            Retroexcavadora mixta;280.00;dia;maquinaria;maquinaria;movimiento_tierras
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={LBL}>Nombre del proveedor / fuente</label>
            <input
              className={INPUT}
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="CYPE / Banco de precios"
            />
          </div>
          <div>
            <label className={LBL}>Archivo CSV</label>
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => setFileName(e.target.files?.[0]?.name || "")}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 px-4 py-2.5 rounded-xl border border-dashed border-navy-300 dark:border-zinc-600 text-sm text-navy-600 dark:text-zinc-300 hover:bg-navy-50 dark:hover:bg-zinc-800 transition-colors text-left"
              >
                {fileName || "Seleccionar archivo..."}
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={handleUpload}
          disabled={uploading || !fileName}
          className="px-6 py-2.5 bg-brand-green text-white font-semibold rounded-xl hover:bg-brand-green/90 disabled:opacity-50 transition-colors"
        >
          {uploading ? "Importando..." : "Importar precios"}
        </button>

        {/* Result */}
        {result && (
          <div className={`rounded-xl p-4 ${result.imported > 0 ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" : "bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"}`}>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="font-semibold text-green-700 dark:text-green-400">{result.imported}</span>
                <span className="text-navy-600 dark:text-zinc-400 ml-1">importados</span>
              </div>
              <div>
                <span className="font-semibold text-yellow-700 dark:text-yellow-400">{result.skipped}</span>
                <span className="text-navy-600 dark:text-zinc-400 ml-1">omitidos</span>
              </div>
              <div>
                <span className="font-semibold text-navy-700 dark:text-zinc-300">{result.total}</span>
                <span className="text-navy-600 dark:text-zinc-400 ml-1">total</span>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="mt-2 text-xs text-red-600 dark:text-red-400 space-y-0.5">
                {result.errors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
