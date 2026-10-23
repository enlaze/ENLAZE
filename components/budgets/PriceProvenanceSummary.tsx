import React from "react";
import { summarizePriceProvenance, type PriceProvenanceLine } from "@/lib/budget-price-provenance";

export function PriceProvenanceSummary({ lines }: { lines: readonly PriceProvenanceLine[] }) {
  const summary = summarizePriceProvenance(lines);
  if (!summary.totalLines) return null;
  const percent = summary.weakPercent.toLocaleString("es-ES", { maximumFractionDigits: 1 });
  return (
    <div role="status" aria-label="Procedencia de los precios" data-testid="price-provenance-summary"
      className={`my-4 rounded-xl border p-3 text-sm ${summary.weakLines
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        : "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200"}`}>
      <p className="font-semibold">{summary.weakLines} de {summary.totalLines} líneas sin fuente verificable — {percent} % del importe</p>
      <p className="mt-1 text-xs">Sobre las partidas incluidas, antes de IVA.</p>
    </div>
  );
}
