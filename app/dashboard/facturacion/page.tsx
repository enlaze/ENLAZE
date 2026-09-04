"use client";

/**
 * Hub de Facturación.
 *
 * Antes eran dos secciones distintas del menú ("Facturas emitidas" y "Facturas
 * recibidas", con el escaneo escondido dentro de la segunda). Aquí conviven en
 * un único sitio: arriba el resumen de lo que facturas y lo que te queda por
 * cobrar, y debajo tres pestañas con el MISMO contenido y la misma lógica que
 * tenían las páginas originales (Verifactu, estados, seguimiento de cobro y
 * pago, OCR).
 *
 * La pestaña activa vive en `?tab=` para que las redirecciones de las rutas
 * antiguas caigan donde el usuario esperaba.
 *
 * El `data-fact-surface` no declara paleta: solo engancha la sombra de tarjeta
 * del rediseño, que globals.css deriva de `--color-navy-900`. Todo el color de
 * esta pantalla sale de los tokens que ya usa el resto del dashboard.
 */

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/ui/page-header";
import InfoFlipCard from "@/components/ui/InfoFlipCard";
import Loading from "@/components/ui/loading";
import { SkeletonKpi } from "@/components/ui/skeleton";
import BillingSummary from "@/components/facturacion/BillingSummary";
import EmitidasTab from "@/components/facturacion/EmitidasTab";
import RecibidasTab from "@/components/facturacion/RecibidasTab";
import EscanearTab from "@/components/facturacion/EscanearTab";
import { useIssuedInvoices } from "@/components/facturacion/useIssuedInvoices";
import { useReceivedInvoices } from "@/components/facturacion/useReceivedInvoices";

type TabKey = "emitidas" | "recibidas" | "escanear";

const TABS: { key: TabKey; label: string }[] = [
  { key: "emitidas", label: "Emitidas" },
  { key: "recibidas", label: "Recibidas" },
  { key: "escanear", label: "Escanear" },
];

function isTabKey(value: string | null): value is TabKey {
  return value === "emitidas" || value === "recibidas" || value === "escanear";
}

function FacturacionHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supplierFilter = searchParams.get("supplier") || "";
  const tabParam = searchParams.get("tab");

  const [tab, setTab] = useState<TabKey>(isTabKey(tabParam) ? tabParam : "emitidas");

  const changeTab = useCallback(
    (next: TabKey) => {
      setTab(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      router.replace(`/dashboard/facturacion?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const issued = useIssuedInvoices();
  const received = useReceivedInvoices(
    supplierFilter,
    useCallback(() => setTab("recibidas"), []),
  );

  const counts: Record<TabKey, number | undefined> = {
    emitidas: issued.loading ? undefined : issued.invoices.length,
    recibidas: received.loading ? undefined : received.total,
    escanear: undefined,
  };

  return (
    <div data-fact-surface className="mx-auto max-w-6xl">
      <PageHeader
        title="Facturación"
        description="Lo que emites y lo que recibes, en el mismo sitio"
        titleAdornment={
          <InfoFlipCard
            label="Información sobre Facturación"
            what="Todas tus facturas en un solo sitio: las que emites a clientes (con Verifactu y Facturae) y las que recibes de proveedores, que puedes dar de alta con una foto."
            howTo="Para saber de un vistazo qué has facturado, qué te han pagado y qué llevas esperando demasiado. Lo vencido sale en rojo: son las llamadas de mañana."
          />
        }
      />

      {/* Ritmo del rediseño: 32px entre resumen, pestañas y contenido. */}
      <div className="space-y-8">
        {issued.loading ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SkeletonKpi />
            <SkeletonKpi />
            <SkeletonKpi />
            <SkeletonKpi />
          </div>
        ) : (
          <BillingSummary invoices={issued.invoices} />
        )}

        {/* Pestañas */}
        <div
          role="tablist"
          aria-label="Secciones de facturación"
          className="flex w-fit max-w-full items-center gap-1.5 overflow-x-auto rounded-2xl border border-navy-100 bg-navy-50/60 p-1.5 dark:border-zinc-800 dark:bg-zinc-950/40"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => changeTab(t.key)}
              className={`inline-flex h-[38px] cursor-pointer items-center whitespace-nowrap rounded-xl border px-4 text-[14.5px] font-semibold transition-colors ${
                tab === t.key
                  ? "border-navy-100 bg-white text-navy-900 shadow-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  : "border-transparent text-navy-600 hover:text-navy-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {t.label}
              {counts[t.key] !== undefined && (
                <span className="ml-1.5 text-[13px] font-medium opacity-55">{counts[t.key]}</span>
              )}
            </button>
          ))}
        </div>

        <div>
          {tab === "emitidas" && (issued.loading ? <Loading /> : <EmitidasTab state={issued} />)}
          {tab === "recibidas" && (
            <RecibidasTab state={received} onGoToScan={() => changeTab("escanear")} />
          )}
          {tab === "escanear" && <EscanearTab state={received} />}
        </div>
      </div>
    </div>
  );
}

export default function FacturacionPage() {
  return (
    <Suspense fallback={<Loading />}>
      <FacturacionHub />
    </Suspense>
  );
}
