"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import {
  getTreasurySummary,
  checkOverdueInvoices,
  paymentMethodLabels,
  type TreasurySummary,
  type Payment,
} from "@/lib/payments";

interface InvoiceRow {
  id: string;
  invoice_number: string;
  client_name: string;
  total: number;
  amount_paid: number;
  due_date: string | null;
  payment_status: string;
  status: string;
}

type Tab = "treasury" | "invoices" | "history";

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    paid: { label: "Pagada", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    partial: { label: "Parcial", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
    pending: { label: "Pendiente", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
    overdue: { label: "Vencida", cls: "bg-red-50 text-red-700 ring-red-200" },
  };
  const s = map[status] || { label: status, cls: "bg-navy-50 text-navy-600 dark:bg-zinc-900/50 dark:text-zinc-300 ring-navy-200 dark:ring-zinc-800" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  );
}

export default function PaymentsPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("treasury");
  const [loading, setLoading] = useState(true);
  const [treasury, setTreasury] = useState<TreasurySummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Fire-and-forget: check overdue
    checkOverdueInvoices(supabase);

    const [treasuryData, invoicesRes, paymentsRes] = await Promise.all([
      getTreasurySummary(supabase),
      supabase
        .from("issued_invoices")
        .select("id, invoice_number, client_name, total, amount_paid, due_date, payment_status, status")
        .eq("user_id", user.id)
        .neq("status", "cancelled")
        .order("due_date", { ascending: true }),
      supabase
        .from("payments")
        .select("*")
        .eq("user_id", user.id)
        .order("payment_date", { ascending: false })
        .limit(50),
    ]);

    setTreasury(treasuryData);
    setInvoices((invoicesRes.data as InvoiceRow[]) || []);
    setPayments((paymentsRes.data as Payment[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData(); // eslint-disable-line react-hooks/set-state-in-effect
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredInvoices = invoices.filter((inv) => {
    if (filterStatus === "all") return true;
    return inv.payment_status === filterStatus;
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: "treasury", label: "Tesorería" },
    { key: "invoices", label: "Facturas pendientes" },
    { key: "history", label: "Historial de cobros" },
  ];

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy-200 dark:border-zinc-800 border-t-brand-green" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Pagos y Tesorería</h1>
        <p className="text-sm text-navy-500 dark:text-zinc-500 mt-1">Control de cobros, pagos y estado financiero</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-navy-50 dark:bg-zinc-900/50 rounded-xl p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-white text-navy-900 dark:text-white shadow-sm"
                : "text-navy-500 hover:text-navy-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Treasury Tab */}
      {tab === "treasury" && treasury && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <TreasuryCard
              label="Saldo neto"
              value={`€${treasury.net_balance.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`}
              color={treasury.net_balance >= 0 ? "text-emerald-600" : "text-red-600"}
              featured
            />
            <TreasuryCard
              label="Cobros totales"
              value={`€${treasury.total_income.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`}
              color="text-emerald-600"
            />
            <TreasuryCard
              label="Pendiente de cobro"
              value={`€${treasury.outstanding.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`}
              color="text-amber-600"
            />
            <TreasuryCard
              label="Vencido"
              value={`€${treasury.overdue_amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`}
              color="text-red-600"
              sub={treasury.overdue_count > 0 ? `${treasury.overdue_count} factura${treasury.overdue_count !== 1 ? "s" : ""}` : undefined}
            />
          </div>

          {/* Progress bars */}
          <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-navy-900 dark:text-white mb-4">Resumen de facturación</h3>
            <div className="space-y-4">
              <ProgressBar
                label="Cobrado"
                current={treasury.total_collected}
                total={treasury.total_invoiced}
                color="bg-emerald-500"
              />
              <ProgressBar
                label="Pendiente"
                current={treasury.outstanding}
                total={treasury.total_invoiced}
                color="bg-amber-500"
              />
              <ProgressBar
                label="Vencido"
                current={treasury.overdue_amount}
                total={treasury.total_invoiced}
                color="bg-red-500"
              />
            </div>
          </div>

          {/* Quick overdue list */}
          {treasury.overdue_count > 0 && (
            <div className="rounded-2xl border border-red-100 bg-red-50/30 p-6">
              <h3 className="text-sm font-semibold text-red-700 mb-3">Facturas vencidas</h3>
              <div className="space-y-2">
                {invoices
                  .filter((i) => i.payment_status === "overdue")
                  .slice(0, 5)
                  .map((inv) => (
                    <Link
                      key={inv.id}
                      href={`/dashboard/issued-invoices/${inv.id}`}
                      className="flex items-center justify-between rounded-xl bg-white dark:bg-zinc-900 px-4 py-3 border border-red-100 hover:border-red-200 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium text-navy-900 dark:text-white">{inv.invoice_number}</p>
                        <p className="text-xs text-navy-500 dark:text-zinc-500">{inv.client_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-red-600">
                          €{(Number(inv.total) - Number(inv.amount_paid || 0)).toLocaleString("es-ES", { minimumFractionDigits: 2 })}
                        </p>
                        <p className="text-[11px] text-navy-400 dark:text-zinc-500">
                          Venció {inv.due_date ? new Date(inv.due_date).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "—"}
                        </p>
                      </div>
                    </Link>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Invoices Tab */}
      {tab === "invoices" && (
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex gap-2">
            {["all", "pending", "partial", "overdue", "paid"].map((f) => (
              <button
                key={f}
                onClick={() => setFilterStatus(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterStatus === f
                    ? "bg-navy-900 text-white"
                    : "bg-navy-50 text-navy-600 dark:bg-zinc-900/50 dark:text-zinc-300 hover:bg-navy-100 dark:hover:bg-zinc-800"
                }`}
              >
                {f === "all" ? "Todas" : f === "pending" ? "Pendientes" : f === "partial" ? "Parciales" : f === "overdue" ? "Vencidas" : "Pagadas"}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
            {filteredInvoices.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-navy-400 dark:text-zinc-500">No hay facturas con este filtro.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-navy-100 dark:border-zinc-800 bg-navy-50 dark:bg-zinc-900/50">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Factura</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Cliente</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Total</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Cobrado</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Pendiente</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Vencimiento</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Estado</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-50">
                    {filteredInvoices.map((inv) => {
                      const pending = Number(inv.total) - Number(inv.amount_paid || 0);
                      const isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && inv.payment_status !== "paid";
                      return (
                        <tr key={inv.id} className={`hover:bg-navy-50/60 dark:hover:bg-zinc-800/50 transition-colors ${isOverdue ? "bg-red-50/30" : ""}`}>
                          <td className="px-4 py-3">
                            <Link href={`/dashboard/issued-invoices/${inv.id}`} className="font-medium text-navy-900 dark:text-white hover:text-brand-green">
                              {inv.invoice_number}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-navy-600 dark:text-zinc-400">{inv.client_name}</td>
                          <td className="px-4 py-3 text-right font-medium text-navy-900 dark:text-white">€{Number(inv.total).toLocaleString("es-ES", { minimumFractionDigits: 2 })}</td>
                          <td className="px-4 py-3 text-right text-emerald-600">€{Number(inv.amount_paid || 0).toLocaleString("es-ES", { minimumFractionDigits: 2 })}</td>
                          <td className="px-4 py-3 text-right font-medium text-navy-900 dark:text-white">€{pending.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</td>
                          <td className={`px-4 py-3 text-xs ${isOverdue ? "text-red-600 font-semibold" : "text-navy-500"}`}>
                            {inv.due_date ? new Date(inv.due_date).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                          </td>
                          <td className="px-4 py-3 text-center">{statusBadge(inv.payment_status)}</td>
                          <td className="px-4 py-3 text-center">
                            {inv.payment_status !== "paid" && (
                              <Link
                                href={`/dashboard/issued-invoices/${inv.id}`}
                                className="rounded-lg bg-brand-green px-3 py-1 text-xs font-semibold text-white hover:opacity-90 transition"
                              >
                                Registrar cobro
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* History Tab */}
      {tab === "history" && (
        <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
          {payments.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-navy-400 dark:text-zinc-500">No hay cobros registrados todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-navy-100 dark:border-zinc-800 bg-navy-50 dark:bg-zinc-900/50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Fecha</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Concepto</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Método</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Referencia</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Importe</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-500">Tipo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-navy-50/60 dark:hover:bg-zinc-800/50 transition-colors">
                      <td className="px-4 py-3 text-navy-600 dark:text-zinc-400">
                        {new Date(p.payment_date).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3 text-navy-900 dark:text-white font-medium">{p.concept}</td>
                      <td className="px-4 py-3 text-navy-500 dark:text-zinc-500">{paymentMethodLabels[p.payment_method] || p.payment_method}</td>
                      <td className="px-4 py-3 text-navy-400 dark:text-zinc-500 font-mono text-xs">{p.reference || "—"}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${p.type === "income" ? "text-emerald-600" : "text-red-600"}`}>
                        {p.type === "income" ? "+" : "−"}€{Number(p.amount).toLocaleString("es-ES", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          p.type === "income" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                        }`}>
                          {p.type === "income" ? "Cobro" : "Gasto"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */

function TreasuryCard({
  label, value, color, featured, sub,
}: {
  label: string; value: string; color: string; featured?: boolean; sub?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-white dark:bg-zinc-900 p-5 shadow-sm ${featured ? "border-brand-green/20 ring-1 ring-brand-green/10" : "border-navy-100 dark:border-zinc-800"}`}>
      <p className="text-[12px] font-medium text-navy-500 dark:text-zinc-500">{label}</p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-navy-400 dark:text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function ProgressBar({
  label, current, total, color,
}: {
  label: string; current: number; total: number; color: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-navy-600 dark:text-zinc-400">{label}</span>
        <span className="text-xs text-navy-400 dark:text-zinc-500 tabular-nums">€{current.toLocaleString("es-ES", { minimumFractionDigits: 2 })} / €{total.toLocaleString("es-ES", { minimumFractionDigits: 2 })} ({pct}%)</span>
      </div>
      <div className="h-2 w-full rounded-full bg-navy-100 dark:bg-zinc-900">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
