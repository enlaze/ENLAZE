"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { eventLabels, eventIcons } from "@/lib/fiscal-events";
import type { FiscalEventType } from "@/lib/fiscal-events";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import Loading from "@/components/ui/loading";

interface FiscalSummary {
  totalInvoices: number;
  totalIssued: number;
  totalDraft: number;
  totalPaid: number;
  totalCancelled: number;
  totalAmount: number;
  totalPaidAmount: number;
  verifactuEnabled: number;
  withXml: number;
  withHash: number;
  softwareVersion: string;
}

interface RecentEvent {
  id: string;
  event_type: string;
  created_at: string;
  invoice_number: string;
  invoice_id: string;
}

function eur(n: number) {
  return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

export default function FiscalCompliancePage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<FiscalSummary>({
    totalInvoices: 0, totalIssued: 0, totalDraft: 0, totalPaid: 0,
    totalCancelled: 0, totalAmount: 0, totalPaidAmount: 0,
    verifactuEnabled: 0, withXml: 0, withHash: 0, softwareVersion: "—",
  });
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: invoices } = await supabase
      .from("issued_invoices")
      .select("id, invoice_number, status, total, verifactu_registered, verifactu_hash, facturae_xml, payment_status")
      .eq("user_id", user.id);

    const inv = invoices || [];
    const totalInvoices = inv.length;
    const totalIssued = inv.filter((i) => i.status === "issued" || i.status === "sent").length;
    const totalDraft = inv.filter((i) => i.status === "draft").length;
    const totalPaid = inv.filter((i) => i.status === "paid" || i.payment_status === "paid").length;
    const totalCancelled = inv.filter((i) => i.status === "cancelled").length;
    const totalAmount = inv.reduce((s, i) => s + Number(i.total || 0), 0);
    const totalPaidAmount = inv.filter((i) => i.status === "paid" || i.payment_status === "paid")
      .reduce((s, i) => s + Number(i.total || 0), 0);
    const verifactuEnabled = inv.filter((i) => i.verifactu_registered).length;
    const withXml = inv.filter((i) => i.facturae_xml).length;
    const withHash = inv.filter((i) => i.verifactu_hash).length;

    const { data: sv } = await supabase
      .from("software_versions")
      .select("version")
      .eq("is_current", true)
      .limit(1)
      .single();

    setSummary({
      totalInvoices, totalIssued, totalDraft, totalPaid, totalCancelled,
      totalAmount, totalPaidAmount,
      verifactuEnabled, withXml, withHash,
      softwareVersion: sv?.version || "—",
    });

    const invoiceIds = inv.map((i) => i.id);
    if (invoiceIds.length > 0) {
      const { data: events } = await supabase
        .from("fiscal_events")
        .select("id, event_type, created_at, invoice_id")
        .in("invoice_id", invoiceIds)
        .order("created_at", { ascending: false })
        .limit(20);

      const enriched = (events || []).map((ev) => {
        const invMatch = inv.find((i) => i.id === ev.invoice_id);
        return { ...ev, invoice_number: invMatch?.invoice_number || "—" };
      });
      setRecentEvents(enriched);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  if (loading) return <Loading />;

  const checks = [
    {
      label: "Facturas con hash Verifactu",
      current: summary.withHash,
      total: summary.totalInvoices,
      ok: summary.withHash === summary.totalInvoices && summary.totalInvoices > 0,
    },
    {
      label: "Facturas con XML Facturae",
      current: summary.withXml,
      total: summary.totalInvoices,
      ok: summary.withXml >= summary.totalIssued,
    },
    {
      label: "Facturas emitidas registradas Verifactu",
      current: summary.verifactuEnabled,
      total: summary.totalInvoices,
      ok: summary.verifactuEnabled === summary.totalInvoices && summary.totalInvoices > 0,
    },
    {
      label: "Borradores pendientes de emitir",
      current: summary.totalDraft,
      total: summary.totalInvoices,
      ok: summary.totalDraft === 0,
    },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Cumplimiento fiscal"
        description="Trazabilidad fiscal, Verifactu y Facturae."
        actions={
          <div className="text-right">
            <span className="text-xs text-navy-400 dark:text-zinc-500">Software version</span>
            <p className="text-sm font-mono text-brand-green">{summary.softwareVersion}</p>
          </div>
        }
      />

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total facturas" value={summary.totalInvoices} />
        <StatCard label="Emitidas" value={summary.totalIssued} accent="blue" />
        <StatCard label="Cobradas" value={summary.totalPaid} accent="green" detail={eur(summary.totalPaidAmount)} />
        <StatCard label="Importe total" value={eur(summary.totalAmount)} accent="green" />
      </div>

      {/* Compliance Checks */}
      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">
          Controles de cumplimiento
        </h3>
        <div className="space-y-2">
          {checks.map((check, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-3 rounded-xl border border-navy-100 bg-gray-50 dark:border-zinc-800 dark:bg-zinc-800/50"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    check.ok ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                <span className="text-sm text-navy-800 dark:text-zinc-200">{check.label}</span>
              </div>
              <span
                className={`text-sm font-semibold ${
                  check.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {check.current}/{check.total}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Verifactu & Facturae summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl border border-navy-100 bg-white p-5 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
          <p className="text-3xl font-bold text-brand-green">{summary.withHash}</p>
          <p className="text-xs text-navy-500 dark:text-zinc-400 mt-1">Con hash SHA-256</p>
        </div>
        <div className="rounded-2xl border border-navy-100 bg-white p-5 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
          <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{summary.withXml}</p>
          <p className="text-xs text-navy-500 dark:text-zinc-400 mt-1">Con XML Facturae 3.2.2</p>
        </div>
        <div className="rounded-2xl border border-navy-100 bg-white p-5 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
          <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{summary.verifactuEnabled}</p>
          <p className="text-xs text-navy-500 dark:text-zinc-400 mt-1">Registradas Verifactu</p>
        </div>
      </div>

      {/* Recent Fiscal Events */}
      <Card>
        <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">
          Eventos fiscales recientes
        </h3>
        {recentEvents.length === 0 ? (
          <p className="text-sm text-navy-500 dark:text-zinc-400">
            No hay eventos fiscales registrados todavía. Se registrarán automáticamente al emitir, enviar o cobrar facturas.
          </p>
        ) : (
          <div className="space-y-2">
            {recentEvents.map((ev) => {
              const evType = ev.event_type as FiscalEventType;
              return (
                <div
                  key={ev.id}
                  className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 transition dark:hover:bg-zinc-800/50"
                >
                  <span className="text-lg">{eventIcons[evType] || "📋"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-navy-800 dark:text-zinc-200">
                      {eventLabels[evType] || ev.event_type}
                    </p>
                    <p className="text-xs text-navy-500 dark:text-zinc-400">
                      <Link
                        href={`/dashboard/issued-invoices/${ev.invoice_id}`}
                        className="text-brand-green hover:underline"
                      >
                        {ev.invoice_number}
                      </Link>
                      {" · "}
                      {new Date(ev.created_at).toLocaleDateString("es-ES", {
                        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
