"use client";

/**
 * Pestaña "Recibidas": las facturas de proveedor, con sus propios números
 * (pendiente de pago, pagado este mes, vencido, proveedores activos), los
 * filtros y la tabla que ya existían en app/dashboard/suppliers/invoices.
 *
 * El pulido del rediseño no toca ni la consulta ni los filtros. Lo que cambia
 * es el acabado: tarjetas de resumen afinadas, tabla más aireada y —sobre
 * todo— las etiquetas de estado, que venían con las clases de tema oscuro de
 * `receivedInvoiceStatusLabels` y sobre fondo claro se veían lavadas. Ahora
 * pintan con los tonos del sistema (`receivedStatusTone` + `StatusPill`),
 * legibles en los dos temas; el texto de la etiqueta sigue saliendo del
 * mismo mapa de siempre.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select, SearchInput } from "@/components/ui/form-fields";
import EmptyState from "@/components/ui/empty-state";
import Loading from "@/components/ui/loading";
import { Camera } from "lucide-react";
import { receivedInvoiceStatusLabels } from "@/lib/suppliers";
import ReceivedInvoiceForm from "./ReceivedInvoiceForm";
import { receivedStatusTone } from "./shared";
import {
  FactCard,
  StatTile,
  StatusPill,
  TabToolbar,
  factBtnPrimary,
  factBtnSecondary,
} from "./ui";
import type { ReceivedInvoicesState } from "./useReceivedInvoices";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-ES") : "—");

const TH = "px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-navy-400 dark:text-zinc-500";

export default function RecibidasTab({
  state,
  onGoToScan,
}: {
  state: ReceivedInvoicesState;
  onGoToScan: () => void;
}) {
  const {
    invoices, summary, total, loading, search, setSearch,
    statusFilter, setStatusFilter, showForm, saving, handleNewInvoice,
  } = state;

  if (loading) return <Loading />;

  return (
    <div className="space-y-6">
      <TabToolbar
        actions={
          <>
            <button onClick={onGoToScan} className={factBtnSecondary}>
              <Camera className="h-4 w-4" />
              Escanear factura
            </button>
            <button onClick={handleNewInvoice} disabled={saving} className={factBtnPrimary}>
              + Nueva factura
            </button>
          </>
        }
      >
        Gastos de proveedor · {total} factura{total !== 1 ? "s" : ""} registrada
        {total !== 1 ? "s" : ""}
      </TabToolbar>

      {/* KPIs del lado gastos */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Pendiente de pago" value={fmtMoney(summary.total_pending)} tone="warning" />
          <StatTile label="Pagado este mes" value={fmtMoney(summary.total_paid_month)} tone="success" />
          <StatTile
            label="Vencido"
            value={fmtMoney(summary.total_overdue)}
            tone={summary.total_overdue > 0 ? "danger" : "success"}
          />
          <StatTile label="Proveedores activos" value={summary.suppliers_active} />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={(v) => setSearch(v)}
          placeholder="Buscar por nº factura, proveedor..."
          className="min-w-[220px] flex-1 sm:max-w-sm"
        />
        {/* El ancho va en el contenedor: `Select` arrastra el w-full de
            `inputBase` y gana a cualquier w-* que se le pase por className,
            que es por lo que en la página original se comía toda la fila. */}
        <div className="w-48">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Todos los estados</option>
            {Object.entries(receivedInvoiceStatusLabels).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </Select>
        </div>
      </div>

      {showForm && <ReceivedInvoiceForm state={state} />}

      {invoices.length === 0 ? (
        <EmptyState
          title="Sin facturas recibidas"
          description="Registra tu primera factura de proveedor para controlar gastos y vencimientos."
          action={
            <button onClick={onGoToScan} className={factBtnPrimary}>
              <Camera className="h-4 w-4" />
              Escanear factura
            </button>
          }
        />
      ) : (
        <FactCard padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead>
                <tr className="border-b border-navy-100 bg-navy-50/60 dark:border-zinc-800 dark:bg-zinc-950/40">
                  <th className={`${TH} pl-6 text-left`}>Nº Factura</th>
                  <th className={`${TH} text-left`}>Proveedor</th>
                  <th className={`${TH} text-left`}>Fecha</th>
                  <th className={`${TH} text-left`}>Vencimiento</th>
                  <th className={`${TH} text-right`}>Total</th>
                  <th className={`${TH} text-right`}>Pagado</th>
                  <th className={`${TH} pr-6 text-right`}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const st = receivedInvoiceStatusLabels[inv.status] || { label: inv.status };
                  const isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && inv.payment_status !== "paid";
                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-navy-50 transition-colors last:border-0 hover:bg-navy-50/50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                    >
                      <td className="py-3.5 pl-6 pr-3">
                        <Link
                          href={`/dashboard/suppliers/invoices/${inv.id}`}
                          className="font-mono text-[12.5px] font-medium text-success-ink hover:underline"
                        >
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-3 py-3.5">
                        <p className="text-sm font-semibold text-navy-900 dark:text-white">{inv.supplier_name}</p>
                        {inv.supplier_nif && (
                          <p className="mt-0.5 font-mono text-[11.5px] text-navy-400 dark:text-zinc-500">
                            {inv.supplier_nif}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-sm tabular-nums text-navy-600 dark:text-zinc-400">
                        {fmtDate(inv.issue_date)}
                      </td>
                      <td className="px-3 py-3.5 text-sm">
                        <span
                          className={`tabular-nums ${isOverdue ? "font-semibold text-danger-ink" : "text-navy-600 dark:text-zinc-400"}`}
                        >
                          {fmtDate(inv.due_date)}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-right text-sm font-semibold tabular-nums text-navy-900 dark:text-white">
                        {fmtMoney(inv.total)}
                      </td>
                      <td className="px-3 py-3.5 text-right text-sm tabular-nums text-navy-600 dark:text-zinc-400">
                        {fmtMoney(inv.amount_paid)}
                      </td>
                      <td className="py-3.5 pl-3 pr-6">
                        <div className="flex justify-end">
                          <StatusPill tone={receivedStatusTone[inv.status] ?? "neutral"}>
                            {st.label}
                          </StatusPill>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </FactCard>
      )}
    </div>
  );
}
