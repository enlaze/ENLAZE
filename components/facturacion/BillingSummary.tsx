"use client";

/**
 * Resumen del hub de Facturación: los cuatro números que importan del lado
 * emitidas + el facturado mes a mes.
 *
 * Los KPIs son exactamente los que ya calculaba la página de facturas
 * emitidas (emitido / cobrado / pendiente / vencidas); aquí solo cambian de
 * sitio y "Vencido" pasa a expresarse en euros además de en número de
 * facturas, porque es el dato que dispara la acción de cobro.
 *
 * El pulido del rediseño no toca ni un cálculo: afina las tarjetas (rótulo
 * pequeño, cifra tabular con el color de su significado) y da al gráfico la
 * rejilla de 12 columnas, las barras apiladas con la esquina superior
 * redondeada y la línea de base del diseño.
 */

import { eur, isOverdueInvoice, type IssuedInvoice } from "./shared";
import { FactCard, FactLabel, StatTile } from "./ui";

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
    <FactCard className="px-6 pb-[18px] pt-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-5">
        <div className="flex flex-col gap-2">
          <FactLabel>Facturado por mes</FactLabel>
          <span className="flex items-baseline gap-2">
            <span className="text-[21px] font-bold tracking-[-0.02em] tabular-nums text-navy-900 dark:text-white">
              {eur(periodTotal)}
            </span>
            <span className="text-[13px] text-navy-600 dark:text-zinc-400">últimos 12 meses</span>
          </span>
        </div>
        <div className="flex items-center gap-[18px] pt-1 text-[12.5px] font-medium text-navy-600 dark:text-zinc-400">
          <span className="inline-flex items-center gap-[7px]">
            <span className="h-[9px] w-[9px] rounded-[3px] bg-brand-green" />
            Cobrado
          </span>
          <span className="inline-flex items-center gap-[7px]">
            <span className="h-[9px] w-[9px] rounded-[3px] bg-brand-green/25" />
            Pendiente
          </span>
        </div>
      </div>

      {max === 0 ? (
        <div className="flex h-[190px] items-center justify-center rounded-xl border border-dashed border-navy-100 text-sm text-navy-400 dark:border-zinc-800 dark:text-zinc-500">
          Todavía no hay facturas emitidas en los últimos 12 meses.
        </div>
      ) : (
        <>
          <div className="grid h-[190px] grid-cols-12 items-end gap-2 border-b border-navy-50 pb-0.5 sm:gap-3 lg:gap-3.5 dark:border-zinc-800">
            {months.map((m) => {
              const pendiente = Math.max(m.facturado - m.cobrado, 0);
              // Alturas en % de la columna: la barra completa mide lo que
              // pesa el mes contra el mejor mes del periodo.
              const paidPct = (m.cobrado / max) * 100;
              const pendPct = (pendiente / max) * 100;
              const hasPend = pendPct > 0;
              return (
                <div
                  key={m.key}
                  className="flex h-full flex-col justify-end"
                  title={`${m.monthName}: ${eur(m.facturado)} facturado · ${eur(m.cobrado)} cobrado`}
                >
                  {hasPend && (
                    <div
                      className="mx-auto w-full max-w-[44px] rounded-t-lg bg-brand-green/25"
                      style={{ height: `${Math.max(pendPct, 1.5)}%` }}
                    />
                  )}
                  {paidPct > 0 && (
                    <div
                      className={`mx-auto w-full max-w-[44px] bg-brand-green ${hasPend ? "" : "rounded-t-lg"}`}
                      style={{ height: `${Math.max(paidPct, 1.5)}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-12 gap-2 pt-3 sm:gap-3 lg:gap-3.5">
            {months.map((m) => (
              <span
                key={m.key}
                className="text-center text-xs font-medium text-navy-400 dark:text-zinc-500"
              >
                {m.label}
              </span>
            ))}
          </div>
        </>
      )}
    </FactCard>
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Facturado"
          value={eur(facturado)}
          detail={`${live.length} factura${live.length === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Cobrado"
          value={eur(cobrado)}
          tone="success"
          detail={facturado > 0 ? `${Math.round((cobrado / facturado) * 100)}% del total` : "—"}
        />
        <StatTile label="Pendiente" value={eur(pendiente)} tone="warning" detail="sin cobrar" />
        <StatTile
          label="Vencido"
          value={eur(vencido)}
          tone={overdue.length > 0 ? "danger" : "success"}
          detail={
            overdue.length > 0
              ? `${overdue.length} factura${overdue.length === 1 ? "" : "s"} fuera de plazo`
              : "nada fuera de plazo"
          }
        />
      </div>
      <MonthlyChart invoices={invoices} />
    </div>
  );
}
