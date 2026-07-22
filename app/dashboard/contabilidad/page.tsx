"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { FormField, Select } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import { SkeletonKpi, SkeletonTable } from "@/components/ui/skeleton";
import EmptyState from "@/components/ui/empty-state";
import InfoFlipCard from "@/components/ui/InfoFlipCard";

/* ─── Types ─── */

interface ReceivedInvoice {
  id: string;
  invoice_number: string;
  supplier_name: string;
  invoice_date: string;
  base_amount: number;
  iva_amount: number;
  irpf_amount: number;
  total_amount: number;
  category: string;
  payment_status: string;
}

interface IssuedInvoice {
  id: string;
  invoice_number: string;
  client_name: string;
  issue_date: string;
  subtotal: number;
  iva_amount: number;
  irpf_amount: number;
  total: number;
  payment_status: string;
}

/* ─── Helpers ─── */

function eur(n: number) {
  return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const QUARTERS = ["1T", "2T", "3T", "4T"];

const paymentLabels: Record<string, { label: string; color: string }> = {
  paid: { label: "Pagada", color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  pending: { label: "Pendiente", color: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  overdue: { label: "Vencida", color: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  cancelled: { label: "Anulada", color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
};

/* ─── Component ─── */

export default function ContabilidadPage() {
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [received, setReceived] = useState<ReceivedInvoice[]>([]);
  const [issued, setIssued] = useState<IssuedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const downloading = false; // kept for button disabled state

  // Filters
  const currentYear = new Date().getFullYear();
  const [period, setPeriod] = useState<"year" | "quarter" | "month">("year");
  const [year, setYear] = useState(currentYear);
  const [quarter, setQuarter] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [viewType, setViewType] = useState<"all" | "received" | "issued">("all");

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const [recRes, issRes] = await Promise.all([
      supabase
        .from("invoices")
        .select("id, invoice_number, supplier_name, invoice_date, base_amount, iva_amount, irpf_amount, total_amount, category, payment_status")
        .eq("user_id", user.id)
        .order("invoice_date", { ascending: false }),
      supabase
        .from("issued_invoices")
        .select("id, invoice_number, client_name, issue_date, subtotal, iva_amount, irpf_amount, total, payment_status")
        .eq("user_id", user.id)
        .order("issue_date", { ascending: false }),
    ]);

    setReceived((recRes.data as ReceivedInvoice[]) || []);
    setIssued((issRes.data as IssuedInvoice[]) || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  // Filter by period
  const filteredReceived = useMemo(() => {
    return received.filter((inv) => {
      const d = new Date(inv.invoice_date);
      if (d.getFullYear() !== year) return false;
      if (period === "quarter") {
        const q = Math.ceil((d.getMonth() + 1) / 3);
        return q === quarter;
      }
      if (period === "month") return d.getMonth() + 1 === month;
      return true;
    });
  }, [received, year, period, quarter, month]);

  const filteredIssued = useMemo(() => {
    return issued.filter((inv) => {
      const d = new Date(inv.issue_date);
      if (d.getFullYear() !== year) return false;
      if (period === "quarter") {
        const q = Math.ceil((d.getMonth() + 1) / 3);
        return q === quarter;
      }
      if (period === "month") return d.getMonth() + 1 === month;
      return true;
    });
  }, [issued, year, period, quarter, month]);

  // KPIs
  const totalRecibidas = filteredReceived.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const totalEmitidas = filteredIssued.reduce((s, i) => s + Number(i.total || 0), 0);
  const ivaRepercutido = filteredIssued.reduce((s, i) => s + Number(i.iva_amount || 0), 0);
  const ivaSoportado = filteredReceived.reduce((s, i) => s + Number(i.iva_amount || 0), 0);
  const resultadoIva = ivaRepercutido - ivaSoportado;
  const baseRecibidas = filteredReceived.reduce((s, i) => s + Number(i.base_amount || 0), 0);
  const baseEmitidas = filteredIssued.reduce((s, i) => s + Number(i.subtotal || 0), 0);
  const resultado = baseEmitidas - baseRecibidas;

  // Period label
  const periodLabel = period === "month"
    ? `${MONTHS[month - 1]} ${year}`
    : period === "quarter"
      ? `${quarter}T ${year}`
      : `${year}`;

  // Download PDF
  function handleDownload() {
    if (!userId) return;

    const params = new URLSearchParams({
      user_id: userId,
      type: viewType,
      period,
      year: year.toString(),
    });
    if (period === "month") params.set("month", month.toString());
    if (period === "quarter") params.set("quarter", quarter.toString());

    window.open(`/contabilidad-print?${params}`, "_blank");
  }

  // Years available
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    received.forEach((i) => years.add(new Date(i.invoice_date).getFullYear()));
    issued.forEach((i) => years.add(new Date(i.issue_date).getFullYear()));
    if (years.size === 0) years.add(currentYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [received, issued]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-48 animate-pulse rounded bg-navy-100" />
          <div className="h-4 w-72 animate-pulse rounded bg-navy-100/70" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SkeletonKpi /><SkeletonKpi /><SkeletonKpi /><SkeletonKpi />
        </div>
        <SkeletonTable rows={8} cols={6} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Contabilidad"
        description="Resumen fiscal y descarga de informes por periodo"
        titleAdornment={
          <InfoFlipCard
            label="Info Contabilidad"
            what="El centro de control fiscal de tu negocio. Aqui ves el resumen de facturas emitidas y recibidas, el resultado del IVA y puedes descargar informes en PDF por mes, trimestre o ano."
            howTo="Selecciona el periodo que necesites (mes, trimestre o ano), revisa los datos y descarga el PDF. Util para tu gestor, para preparar impuestos o para tener un archivo contable."
          />
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <FormField label="Periodo">
          <Select value={period} onChange={(e) => setPeriod(e.target.value as "year" | "quarter" | "month")}>
            <option value="year">Anual</option>
            <option value="quarter">Trimestral</option>
            <option value="month">Mensual</option>
          </Select>
        </FormField>

        <FormField label="Ano">
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>
        </FormField>

        {period === "quarter" && (
          <FormField label="Trimestre">
            <Select value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
              {QUARTERS.map((q, i) => (
                <option key={i} value={i + 1}>{q}</option>
              ))}
            </Select>
          </FormField>
        )}

        {period === "month" && (
          <FormField label="Mes">
            <Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </Select>
          </FormField>
        )}

        <FormField label="Tipo">
          <Select value={viewType} onChange={(e) => setViewType(e.target.value as "all" | "received" | "issued")}>
            <option value="all">Todas</option>
            <option value="received">Recibidas</option>
            <option value="issued">Emitidas</option>
          </Select>
        </FormField>

        <div className="flex items-end">
          <Button onClick={handleDownload} disabled={downloading}>
            {downloading ? "Generando..." : "Descargar PDF"}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Facturado (emitidas)" value={eur(totalEmitidas)} accent="green" />
        <StatCard label="Gastos (recibidas)" value={eur(totalRecibidas)} accent="red" />
        <StatCard
          label="Resultado IVA"
          value={eur(resultadoIva)}
          accent={resultadoIva >= 0 ? "yellow" : "green"}
        />
        <StatCard
          label="Resultado neto"
          value={eur(resultado)}
          accent={resultado >= 0 ? "green" : "red"}
        />
      </div>

      {/* IVA / IRPF detail */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <h3 className="text-sm font-semibold text-navy-900 dark:text-white uppercase tracking-wider mb-3">
            Desglose IVA — {periodLabel}
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-navy-500 dark:text-zinc-400">IVA repercutido (emitidas)</span>
              <span className="font-medium text-navy-900 dark:text-white">{eur(ivaRepercutido)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-navy-500 dark:text-zinc-400">IVA soportado (recibidas)</span>
              <span className="font-medium text-navy-900 dark:text-white">{eur(ivaSoportado)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-navy-100 dark:border-zinc-800">
              <span className="font-semibold text-navy-900 dark:text-white">Resultado</span>
              <span className={`font-bold ${resultadoIva > 0 ? "text-red-600" : "text-green-600"}`}>
                {eur(resultadoIva)} {resultadoIva > 0 ? "(a ingresar)" : "(a compensar)"}
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-navy-900 dark:text-white uppercase tracking-wider mb-3">
            Cuenta de resultados — {periodLabel}
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-navy-500 dark:text-zinc-400">Ingresos (base imponible)</span>
              <span className="font-medium text-green-600">{eur(baseEmitidas)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-navy-500 dark:text-zinc-400">Gastos (base imponible)</span>
              <span className="font-medium text-red-600">{eur(baseRecibidas)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-navy-100 dark:border-zinc-800">
              <span className="font-semibold text-navy-900 dark:text-white">Resultado</span>
              <span className={`font-bold ${resultado >= 0 ? "text-green-600" : "text-red-600"}`}>
                {eur(resultado)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Tables */}
      {(viewType === "all" || viewType === "received") && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-navy-900 dark:text-white uppercase tracking-wider mb-3">
            Facturas recibidas ({filteredReceived.length})
          </h3>
          {filteredReceived.length === 0 ? (
            <Card>
              <p className="text-sm text-navy-500 dark:text-zinc-400 text-center py-4">
                No hay facturas recibidas en este periodo.
              </p>
            </Card>
          ) : (
            <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-navy-50/50 dark:bg-zinc-800/30 border-b border-navy-100 dark:border-zinc-800">
                      <th className="text-left text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">Factura</th>
                      <th className="text-left text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Proveedor</th>
                      <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Fecha</th>
                      <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Base</th>
                      <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">IVA</th>
                      <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Total</th>
                      <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReceived.map((inv) => {
                      const st = paymentLabels[inv.payment_status] || paymentLabels.pending;
                      return (
                        <tr key={inv.id} className="border-t border-navy-50 dark:border-zinc-800 hover:bg-navy-50/50 dark:hover:bg-zinc-800/30">
                          <td className="px-5 py-2.5 text-xs font-mono text-navy-600">{inv.invoice_number}</td>
                          <td className="px-3 py-2.5 text-sm text-navy-900 dark:text-white">{inv.supplier_name}</td>
                          <td className="px-3 py-2.5 text-center text-xs text-navy-500">{new Date(inv.invoice_date).toLocaleDateString("es-ES")}</td>
                          <td className="px-3 py-2.5 text-right text-sm">{eur(inv.base_amount)}</td>
                          <td className="px-3 py-2.5 text-right text-sm">{eur(inv.iva_amount)}</td>
                          <td className="px-3 py-2.5 text-right text-sm font-semibold">{eur(inv.total_amount)}</td>
                          <td className="px-5 py-2.5 text-center">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${st.color}`}>{st.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-navy-200 dark:border-zinc-700 bg-navy-50/50 dark:bg-zinc-800/30">
                      <td colSpan={3} className="px-5 py-2 text-xs font-semibold text-navy-500 uppercase">Total recibidas</td>
                      <td className="px-3 py-2 text-right text-sm font-bold">{eur(filteredReceived.reduce((s, i) => s + Number(i.base_amount || 0), 0))}</td>
                      <td className="px-3 py-2 text-right text-sm font-bold">{eur(ivaSoportado)}</td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-red-600">{eur(totalRecibidas)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {(viewType === "all" || viewType === "issued") && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-navy-900 dark:text-white uppercase tracking-wider mb-3">
            Facturas emitidas ({filteredIssued.length})
          </h3>
          {filteredIssued.length === 0 ? (
            <Card>
              <p className="text-sm text-navy-500 dark:text-zinc-400 text-center py-4">
                No hay facturas emitidas en este periodo.
              </p>
            </Card>
          ) : (
            <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-navy-50/50 dark:bg-zinc-800/30 border-b border-navy-100 dark:border-zinc-800">
                      <th className="text-left text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">Factura</th>
                      <th className="text-left text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Cliente</th>
                      <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Fecha</th>
                      <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Base</th>
                      <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">IVA</th>
                      <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Total</th>
                      <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIssued.map((inv) => {
                      const st = paymentLabels[inv.payment_status] || paymentLabels.pending;
                      return (
                        <tr key={inv.id} className="border-t border-navy-50 dark:border-zinc-800 hover:bg-navy-50/50 dark:hover:bg-zinc-800/30">
                          <td className="px-5 py-2.5 text-xs font-mono text-navy-600">{inv.invoice_number}</td>
                          <td className="px-3 py-2.5 text-sm text-navy-900 dark:text-white">{inv.client_name}</td>
                          <td className="px-3 py-2.5 text-center text-xs text-navy-500">{new Date(inv.issue_date).toLocaleDateString("es-ES")}</td>
                          <td className="px-3 py-2.5 text-right text-sm">{eur(inv.subtotal)}</td>
                          <td className="px-3 py-2.5 text-right text-sm">{eur(inv.iva_amount)}</td>
                          <td className="px-3 py-2.5 text-right text-sm font-semibold">{eur(inv.total)}</td>
                          <td className="px-5 py-2.5 text-center">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${st.color}`}>{st.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-navy-200 dark:border-zinc-700 bg-navy-50/50 dark:bg-zinc-800/30">
                      <td colSpan={3} className="px-5 py-2 text-xs font-semibold text-navy-500 uppercase">Total emitidas</td>
                      <td className="px-3 py-2 text-right text-sm font-bold">{eur(baseEmitidas)}</td>
                      <td className="px-3 py-2 text-right text-sm font-bold">{eur(ivaRepercutido)}</td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-green-600">{eur(totalEmitidas)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {filteredReceived.length === 0 && filteredIssued.length === 0 && (
        <EmptyState
          title="Sin facturas en este periodo"
          description="No hay facturas registradas en el periodo seleccionado. Prueba con otro rango de fechas."
        />
      )}
    </div>
  );
}
