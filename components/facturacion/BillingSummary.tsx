"use client";

/**
 * Resumen del hub de Facturación: los cuatro números que importan del lado
 * emitidas + el facturado mes a mes.
 *
 * Los KPIs son exactamente los que ya calculaba la página de facturas
 * emitidas (emitido / cobrado / pendiente / vencidas); aquí solo cambian de
 * sitio y "Vencido" pasa a expresarse en euros además de en número de
 * facturas, porque es el dato que dispara la acción de cobro.
 */

import { StatCard } from "@/components/ui/card";
import { eur, isOverdueInvoice, type IssuedInvoice } from "./shared";

const MONTHS_SHOWN = 12;
const MONTH_LABELS = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

interface MonthBucket {
  key: string;
  label: string;
  monthName: string;
  facturado: number;
  cobrado: number;
}

/** Últimos 12 meses (incluido el actual), en orden cronológico. */
function buildMonths(invoices: IssuedInvoice[]): MonthBucket[] {
  const now = new Date();
  const buckets: MonthBucket[] = [];
  for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: MONTH_LABELS[d.getMonth()],
      monthName: d.toLocaleDateString("es-ES", { month: "long", year: "numeric" }),
      facturado: 0,
      cobrado: 0,
    });
  }

  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const inv of invoices) {
    if (!inv.issue_date || inv.status === "cancelled") continue;
    const d = new Date(inv.issue_date);
    const bucket = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (!bucket) continue;
    const total = Number(inv.total || 0);
    bucket.facturado += total;
    if (inv.payment_status === "paid") bucket.cobrado += total;
  }
  return buckets;
}

function MonthlyChart({ invoices }: { invoices: IssuedInvoice[] }) {
  const months = buildMonths(invoices);
  const max = Math.max(...months.map((m) => m.facturado), 0);
  const periodTotal = months.reduce((s, m) => s + m.facturado, 0);

  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-navy-500 dark:text-zinc-400">
            Facturado por mes
          </p>
          <p className="mt-1 text-lg font-bold text-navy-900 dark:text-white">
            {eur(periodTotal)}{" "}
            <span className="text-xs font-medium text-navy-400 dark:text-zinc-500">
              últimos 12 meses
            </span>
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-navy-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-brand-green" />
            Cobrado
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-brand-green/25" />
            Pendiente
          </span>
        </div>
      </div>

      {max === 0 ? (
        <div className="flex h-[132px] items-center justify-center rounded-xl border border-dashed border-navy-100 text-sm text-navy-400 dark:border-zinc-800 dark:text-zinc-500">
          Todavía no hay facturas emitidas en los últimos 12 meses.
        </div>
      ) : (
        <div className="flex h-[132px] items-end gap-1.5 sm:gap-2">
          {months.map((m) => {
            const heightPct = max > 0 ? (m.facturado / max) * 100 : 0;
            const paidPct = m.facturado > 0 ? (m.cobrado / m.facturado) * 100 : 0;
            return (
              <div key={m.key} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <div
                  className="relative flex w-full max-w-[34px] flex-col justify-end overflow-hidden rounded-md bg-brand-green/25 transition-opacity group-hover:opacity-80"
                  style={{ height: `${Math.max(heightPct, m.facturado > 0 ? 3 : 0)}%`, minHeight: m.facturado > 0 ? 3 : 0 }}
                  title={`${m.monthName}: ${eur(m.facturado)} facturado · ${eur(m.cobrado)} cobrado`}
                >
                  <div className="w-full bg-brand-green" style={{ height: `${paidPct}%` }} />
                </div>
                <span className="text-[10px] font-medium text-navy-400 dark:text-zinc-500">{m.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function BillingSummary({ invoices }: { invoices: IssuedInvoice[] }) {
  const live = invoices.filter((i) => i.status !== "cancelled");
  const facturado = live.reduce((s, i) => s + Number(i.total || 0), 0);
  const cobrado = live
    .filter((i) => i.payment_status === "paid")
    .reduce((s, i) => s + Number(i.total || 0), 0);
  const pendiente = live
    .filter((i) => i.payment_status !== "paid")
    .reduce((s, i) => s + Number(i.total || 0), 0);
  const overdue = invoices.filter(isOverdueInvoice);
  const vencido = overdue.reduce((s, i) => s + Number(i.total || 0), 0);

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Facturado" value={eur(facturado)} accent="blue" detail={`${live.length} factura${live.length === 1 ? "" : "s"}`} />
        <StatCard label="Cobrado" value={eur(cobrado)} accent="green" detail={facturado > 0 ? `${Math.round((cobrado / facturado) * 100)}% del total` : "—"} />
        <StatCard label="Pendiente" value={eur(pendiente)} accent="yellow" detail="sin cobrar" />
        <StatCard
          label="Vencido"
          value={eur(vencido)}
          accent={overdue.length > 0 ? "red" : "green"}
          detail={overdue.length > 0 ? `${overdue.length} factura${overdue.length === 1 ? "" : "s"} fuera de plazo` : "nada fuera de plazo"}
        />
      </div>
      <MonthlyChart invoices={invoices} />
    </div>
  );
}
