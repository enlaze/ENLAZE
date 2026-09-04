"use client";

/**
 * Pestaña "Escanear": la foto de la factura de proveedor entra por aquí.
 *
 * Usa exactamente el mismo flujo OCR que ya vivía en la página de facturas
 * recibidas (/api/invoices/ocr con sus borradores en storage); lo único nuevo
 * es que tiene sitio propio y explica el paso a paso, en vez de esconderse
 * detrás de un botón de la cabecera.
 *
 * El pulido del rediseño le da aire: icono de 64px, titular grande y las tres
 * tarjetas de pasos con su propio rótulo numerado.
 */

import { Camera, Loader2, FileImage, ScanLine, PencilLine } from "lucide-react";
import ReceivedInvoiceForm from "./ReceivedInvoiceForm";
import { FactCard, FactLabel } from "./ui";
import type { ReceivedInvoicesState } from "./useReceivedInvoices";

const STEPS = [
  { icon: FileImage, title: "Haz la foto", text: "Con el móvil o subiendo un JPG, PNG o WEBP desde el ordenador." },
  { icon: ScanLine, title: "La IA lee los datos", text: "Proveedor, NIF, número, fechas, base, IVA e IRPF." },
  { icon: PencilLine, title: "Revisas y registras", text: "Corriges lo que haga falta y la factura entra en Recibidas." },
];

export default function EscanearTab({ state }: { state: ReceivedInvoicesState }) {
  const { scanning, saving, showForm, handleScan } = state;

  return (
    <div className="space-y-6">
      <FactCard className="flex flex-col items-center px-6 py-10 sm:px-12 sm:py-14">
        <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-[18px] bg-brand-green/10 text-success-ink">
          {scanning ? <Loader2 className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}
        </span>
        <h2 className="mb-3 text-center text-[25px] font-bold tracking-[-0.02em] text-navy-900 dark:text-white">
          {scanning ? "Analizando la factura..." : "Escanea una factura de proveedor"}
        </h2>
        <p className="mb-7 max-w-[520px] text-center text-[15px] leading-relaxed text-navy-600 dark:text-zinc-400">
          Haz una foto y la IA rellena los datos por ti. Tú solo compruebas que están bien
          antes de registrarla.
        </p>

        <label
          className={`mb-11 inline-flex h-[46px] items-center gap-2.5 rounded-xl px-6 text-[15px] font-semibold transition-colors ${
            scanning || saving
              ? "pointer-events-none cursor-not-allowed bg-navy-100 text-navy-400 dark:bg-zinc-800 dark:text-zinc-500"
              : "cursor-pointer bg-brand-green text-white shadow-sm shadow-brand-green/25 hover:bg-brand-green-dark"
          }`}
        >
          {scanning ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Camera className="h-[18px] w-[18px]" />}
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

        <div className="grid w-full gap-4 text-left sm:grid-cols-3 lg:gap-[18px]">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="flex flex-col gap-3 rounded-2xl border border-navy-100 bg-navy-50/50 p-[22px] dark:border-zinc-800 dark:bg-zinc-950/40"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-navy-100 bg-white text-success-ink dark:border-zinc-800 dark:bg-zinc-900">
                  <step.icon className="h-[15px] w-[15px]" />
                </span>
                <FactLabel>Paso {i + 1}</FactLabel>
              </span>
              <p className="text-base font-bold tracking-[-0.01em] text-navy-900 dark:text-white">
                {step.title}
              </p>
              <p className="text-[13.5px] leading-relaxed text-navy-600 dark:text-zinc-400">
                {step.text}
              </p>
            </div>
          ))}
        </div>
      </FactCard>

      {showForm && <ReceivedInvoiceForm state={state} title="Revisa los datos leídos" />}
    </div>
  );
}
