"use client";

/**
 * Pestaña "Escanear": la foto de la factura de proveedor entra por aquí.
 *
 * Usa exactamente el mismo flujo OCR que ya vivía en la página de facturas
 * recibidas (/api/invoices/ocr con sus borradores en storage); lo único nuevo
 * es que tiene sitio propio y explica el paso a paso, en vez de esconderse
 * detrás de un botón de la cabecera.
 */

import { Camera, Loader2, FileImage, ScanLine, PencilLine } from "lucide-react";
import ReceivedInvoiceForm from "./ReceivedInvoiceForm";
import type { ReceivedInvoicesState } from "./useReceivedInvoices";

const STEPS = [
  { icon: FileImage, title: "Haz la foto", text: "Con el móvil o subiendo un JPG, PNG o WEBP desde el ordenador." },
  { icon: ScanLine, title: "La IA lee los datos", text: "Proveedor, NIF, número, fechas, base, IVA e IRPF." },
  { icon: PencilLine, title: "Revisas y registras", text: "Corriges lo que haga falta y la factura entra en Recibidas." },
];

export default function EscanearTab({ state }: { state: ReceivedInvoicesState }) {
  const { scanning, saving, showForm, handleScan } = state;

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-navy-100 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-green/10 text-brand-green">
          {scanning ? <Loader2 className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}
        </span>
        <h2 className="text-lg font-bold text-navy-900 dark:text-white">
          {scanning ? "Analizando la factura..." : "Escanea una factura de proveedor"}
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-navy-500 dark:text-zinc-400">
          Haz una foto y la IA rellena los datos por ti. Tú solo compruebas que están bien
          antes de registrarla.
        </p>

        <label
          className={`mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition ${
            scanning || saving
              ? "pointer-events-none cursor-not-allowed bg-navy-100 text-navy-400 dark:bg-zinc-800 dark:text-zinc-500"
              : "cursor-pointer bg-brand-green text-white shadow-sm shadow-brand-green/20 hover:bg-brand-green-dark"
          }`}
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {scanning ? "Analizando factura..." : "Escanear factura"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={handleScan}
            disabled={scanning || saving}
            className="hidden"
          />
        </label>

        <div className="mt-8 grid gap-4 text-left sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="rounded-xl border border-navy-100 bg-navy-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-navy-500 shadow-sm dark:bg-zinc-800 dark:text-zinc-300">
                  <step.icon className="h-4 w-4" />
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
                  Paso {i + 1}
                </span>
              </div>
              <p className="text-sm font-semibold text-navy-900 dark:text-white">{step.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-navy-500 dark:text-zinc-400">{step.text}</p>
            </div>
          ))}
        </div>
      </div>

      {showForm && <ReceivedInvoiceForm state={state} title="Revisa los datos leídos" />}
    </div>
  );
}
