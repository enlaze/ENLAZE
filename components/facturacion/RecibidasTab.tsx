"use client";

/**
 * Pestaña "Recibidas": las facturas de proveedor, con sus propios números
 * (pendiente de pago, pagado este mes, vencido, proveedores activos), los
 * filtros y la tabla que ya existían en app/dashboard/suppliers/invoices.
 */

import Link from "next/link";
import { Card, StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SearchInput } from "@/components/ui/form-fields";
import EmptyState from "@/components/ui/empty-state";
import Loading from "@/components/ui/loading";
import { Camera } from "lucide-react";
import { receivedInvoiceStatusLabels } from "@/lib/suppliers";
import ReceivedInvoiceForm from "./ReceivedInvoiceForm";
import type { ReceivedInvoicesState } from "./useReceivedInvoices";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-ES") : "—");

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
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-navy-500 dark:text-zinc-400">
          Gastos de proveedor · {total} factura{total !== 1 ? "s" : ""} registrada{total !== 1 ? "s" : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onGoToScan}>
            <Camera className="h-4 w-4" />
            Escanear factura
          </Button>
          <Button onClick={handleNewInvoice} disabled={saving}>
            + Nueva factura
          </Button>
        </div>
      </div>

      {/* KPIs del lado gastos */}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Pendiente de pago" value={fmtMoney(summary.total_pending)} accent="yellow" />
          <StatCard label="Pagado este mes" value={fmtMoney(summary.total_paid_month)} accent="green" />
          <StatCard label="Vencido" value={fmtMoney(summary.total_overdue)} accent={summary.total_overdue > 0 ? "red" : "green"} />
          <StatCard label="Proveedores activos" value={summary.suppliers_active} accent="blue" />
        </div>
      )}

      {/* Filtros */}
      <div className="mb-6 flex flex-wrap gap-3">
        <SearchInput
          value={search}
          onChange={(v) => setSearch(v)}
          placeholder="Buscar por nº factura, proveedor..."
          className="w-64"
        />
        {/* El ancho va en el contenedor: `Select` arrastra el w-full de
            `inputBase` y gana a cualquier w-* que se le pase por className,
            que es por lo que en la página original se comía toda la fila. */}
        <div className="w-44">
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
            <Button onClick={onGoToScan}>
              <Camera className="h-4 w-4" />
              Escanear factura
            </Button>
          }
        />
      ) : (
        <Card padding={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100 bg-navy-50/60 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-navy-700 dark:text-zinc-300">Nº Factura</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-navy-700 dark:text-zinc-300">Proveedor</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase text-navy-700 dark:text-zinc-300">Fecha</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase text-navy-700 dark:text-zinc-300">Vencimiento</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-navy-700 dark:text-zinc-300">Total</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-navy-700 dark:text-zinc-300">Pagado</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase text-navy-700 dark:text-zinc-300">Estado</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const st = receivedInvoiceStatusLabels[inv.status] || { label: inv.status, color: "" };
                  const isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && inv.payment_status !== "paid";
                  return (
                    <tr key={inv.id} className="border-b border-navy-100 transition last:border-0 hover:bg-navy-50/40 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                      <td className="px-4 py-2.5">
                        <Link href={`/dashboard/suppliers/invoices/${inv.id}`} className="text-sm font-medium text-brand-green hover:underline">
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-sm text-navy-900 dark:text-white">{inv.supplier_name}</p>
                        {inv.supplier_nif && <p className="text-xs text-navy-500 dark:text-zinc-400">{inv.supplier_nif}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-center text-sm text-navy-600 dark:text-zinc-400">{fmtDate(inv.issue_date)}</td>
                      <td className="px-3 py-2.5 text-center text-sm">
                        <span className={isOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-navy-600 dark:text-zinc-400"}>
                          {fmtDate(inv.due_date)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm font-medium text-navy-900 dark:text-white">{fmtMoney(inv.total)}</td>
                      <td className="px-3 py-2.5 text-right text-sm text-navy-600 dark:text-zinc-400">{fmtMoney(inv.amount_paid)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
