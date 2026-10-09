"use client";

/** Facturas recibidas: clasificación, resumen fiscal y exportación del periodo. */

import Link from "next/link";
import { FormField, Select, SearchInput } from "@/components/ui/form-fields";
import EmptyState from "@/components/ui/empty-state";
import Loading from "@/components/ui/loading";
import { Camera, Download, Pencil, Trash2 } from "lucide-react";
import { receivedInvoiceStatusLabels } from "@/lib/suppliers";
import {
  MONTHS, QUARTERS, expenseCategoryLabels, receivedInvoiceComplianceIssues,
  type FiscalPeriod,
} from "@/lib/received-invoices";
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
    invoices, visibleInvoices, summary, total, loading, search, setSearch,
    statusFilter, setStatusFilter, showForm, saving, handleNewInvoice,
    projects, projectFilter, setProjectFilter, categoryFilter, setCategoryFilter,
    clients, clientFilter, handleClientFilter,
    editingId, deletingId, handleEditInvoice, handleDeleteInvoice,
    period, setPeriod, year, setYear, month, setMonth, quarter, setQuarter, availableYears,
    fiscalTotals, fiscalPdfHref, exporting, handleExport, loadError, load, page, setPage,
  } = state;

  return (
    <div className="space-y-6">
      <TabToolbar
        actions={
          <>
            <button onClick={handleExport} disabled={loading || exporting || !!loadError} className={factBtnSecondary}>
              <Download className="h-4 w-4" />{exporting ? "Exportando..." : "Exportar CSV"}
            </button>
            <Link href={fiscalPdfHref} target="_blank" rel="noopener noreferrer" className={factBtnSecondary}>
              PDF fiscal del periodo
            </Link>
            <Link href="/dashboard/trash" className={factBtnSecondary}>
              <Trash2 className="h-4 w-4" />
              Papelera
            </Link>
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
          <StatTile label="Pendiente de pago (general)" value={fmtMoney(summary.total_pending)} tone="warning" />
          <StatTile label="Pagado este mes (general)" value={fmtMoney(summary.total_paid_month)} tone="success" />
          <StatTile
            label="Vencido (general)"
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
          <Select aria-label="Estado de las facturas" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Todos los estados</option>
            {Object.entries(receivedInvoiceStatusLabels).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Cliente" className="min-w-48 flex-1">
          <Select aria-label="Filtrar por cliente" value={clientFilter} onChange={(e) => handleClientFilter(e.target.value)}>
            <option value="">Todos los clientes</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Obra" className="min-w-48 flex-1">
          <Select aria-label="Filtrar por obra" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">Todas las obras</option>
            {/* Elegido un cliente, solo sus obras: las demás darían una lista
                vacía sin que se vea el motivo. */}
            {projects
              .filter((p) => !clientFilter || p.client_id === clientFilter)
              .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Categoría" className="w-44">
          <Select aria-label="Filtrar por categoría" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Todas las categorías</option>
            {Object.entries(expenseCategoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
        </FormField>
        <FormField label="Periodo" className="w-40">
          <Select aria-label="Periodo fiscal" value={period} onChange={(e) => setPeriod(e.target.value as FiscalPeriod)}>
            <option value="year">Anual</option><option value="quarter">Trimestral</option><option value="month">Mensual</option>
          </Select>
        </FormField>
        <FormField label="Año" className="w-28">
          <Select aria-label="Año fiscal" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </FormField>
        {period === "quarter" && <FormField label="Trimestre" className="w-28">
          <Select aria-label="Trimestre fiscal" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
            {QUARTERS.map((q, i) => <option key={q} value={i + 1}>{q}</option>)}
          </Select>
        </FormField>}
        {period === "month" && <FormField label="Mes" className="w-40">
          <Select aria-label="Mes fiscal" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </FormField>}
      </div>

      <p className="text-xs text-navy-500 dark:text-zinc-400">
        El CSV y el resumen respetan todos los filtros. El PDF fiscal incluye todas las recibidas del periodo.
      </p>
      {!loading && !loadError && <section aria-label="Resumen fiscal del conjunto filtrado" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Base imponible" value={fmtMoney(fiscalTotals.subtotal)} />
        <StatTile label="IVA soportado" value={fmtMoney(fiscalTotals.iva)} tone="info" />
        <StatTile label="IRPF retenido" value={fmtMoney(fiscalTotals.irpf)} tone="warning" />
        <StatTile label="Total filtrado" value={fmtMoney(fiscalTotals.total)} tone="success" />
      </section>}

      {showForm && (
        <div id="received-invoice-form">
          <ReceivedInvoiceForm state={state} />
        </div>
      )}

      {loading ? <Loading /> : loadError ? (
        <FactCard><p role="alert">{loadError}</p><button onClick={load} className={factBtnSecondary}>Reintentar</button></FactCard>
      ) : invoices.length === 0 ? (
        <EmptyState
          title="Sin facturas recibidas"
          description="No hay facturas que coincidan con los filtros seleccionados."
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
            <table className="w-full min-w-[1040px]">
              <thead>
                <tr className="border-b border-navy-100 bg-navy-50/60 dark:border-zinc-800 dark:bg-zinc-950/40">
                  <th className={`${TH} pl-6 text-left`}>Nº Factura</th>
                  <th className={`${TH} text-left`}>Proveedor</th>
                  <th className={`${TH} text-left`}>Cliente</th>
                  <th className={`${TH} text-left`}>Obra</th>
                  <th className={`${TH} text-left`}>Fecha</th>
                  <th className={`${TH} text-left`}>Vencimiento</th>
                  <th className={`${TH} text-right`}>Total</th>
                  <th className={`${TH} text-right`}>Pagado</th>
                  <th className={`${TH} text-right`}>Estado</th>
                  <th className={`${TH} pr-6 text-right`}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleInvoices.map((inv) => {
                  const st = receivedInvoiceStatusLabels[inv.status] || { label: inv.status };
                  const isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && inv.payment_status !== "paid";
                  const issues = receivedInvoiceComplianceIssues(inv);
                  return (
                    <tr
                      key={inv.id}
                      className={`border-b border-navy-50 transition-colors last:border-0 hover:bg-navy-50/50 dark:border-zinc-800 dark:hover:bg-zinc-800/40 ${
                        editingId === inv.id ? "bg-brand-green/5" : ""
                      }`}
                    >
                      <td className="py-3.5 pl-6 pr-3">
                        <Link
                          href={`/dashboard/suppliers/invoices/${inv.id}`}
                          className="font-mono text-[12.5px] font-medium text-success-ink hover:underline"
                        >
                          {inv.invoice_series ? `${inv.invoice_series}/` : ""}{inv.invoice_number}
                        </Link>
                        {issues.length > 0 && (
                          <p
                            className="mt-1 text-[11px] font-semibold text-warning-ink"
                            title={issues.join(". ")}
                          >
                            Datos incompletos ({issues.length})
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        <p className="text-sm font-semibold text-navy-900 dark:text-white">{inv.supplier_name}</p>
                        {inv.supplier_nif && (
                          <p className="mt-0.5 font-mono text-[11.5px] text-navy-400 dark:text-zinc-500">
                            {inv.supplier_nif}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-sm text-navy-600 dark:text-zinc-400">
                        {inv.clients?.name || "—"}
                      </td>
                      <td className="px-3 py-3.5 text-sm text-navy-600 dark:text-zinc-400">
                        {inv.projects?.name || "—"}
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
                      <td className="px-3 py-3.5">
                        <div className="flex justify-end">
                          <StatusPill tone={receivedStatusTone[inv.status] ?? "neutral"}>
                            {st.label}
                          </StatusPill>
                        </div>
                      </td>
                      <td className="py-3.5 pl-3 pr-6">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditInvoice(inv)}
                            disabled={saving || deletingId === inv.id}
                            aria-label={`Editar factura ${inv.invoice_number}`}
                            title="Editar"
                            className="rounded-lg p-2 text-navy-500 transition hover:bg-navy-50 hover:text-navy-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteInvoice(inv)}
                            disabled={saving || deletingId === inv.id}
                            aria-label={`Mover a la papelera la factura ${inv.invoice_number}`}
                            title="Mover a la papelera"
                            className="rounded-lg p-2 text-navy-500 transition hover:bg-danger/10 hover:text-danger-ink disabled:opacity-40 dark:text-zinc-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > 50 && <div className="flex items-center justify-between gap-3 border-t border-navy-100 p-4 dark:border-zinc-800">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className={factBtnSecondary}>Anterior</button>
            <span className="text-sm text-navy-500 dark:text-zinc-400">{page * 50 + 1}–{Math.min((page + 1) * 50, total)} de {total}</span>
            <button disabled={(page + 1) * 50 >= total} onClick={() => setPage(page + 1)} className={factBtnSecondary}>Siguiente</button>
          </div>}
        </FactCard>
      )}
    </div>
  );
}
