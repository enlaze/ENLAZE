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
    <div className="mx-auto max-w-6xl">
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

      {issued.loading ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
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
        className="mb-6 flex w-fit gap-1 rounded-xl bg-navy-50 p-1 dark:bg-zinc-900/50"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => changeTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-white text-navy-900 shadow-sm dark:bg-zinc-800 dark:text-white"
                : "text-navy-500 hover:text-navy-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {t.label}
            {counts[t.key] !== undefined && (
              <span className={`ml-1.5 text-xs ${tab === t.key ? "opacity-70" : "text-navy-400 dark:text-zinc-500"}`}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "emitidas" && (issued.loading ? <Loading /> : <EmitidasTab state={issued} />)}
      {tab === "recibidas" && (
        <RecibidasTab state={received} onGoToScan={() => changeTab("escanear")} />
      )}
      {tab === "escanear" && <EscanearTab state={received} />}
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
