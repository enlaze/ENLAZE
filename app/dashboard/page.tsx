"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";

/* ─────────────────────────────────────────────────────────────────────
 *  Icons — Lucide-style (stroke 1.75, 24×24, rounded)
 * ──────────────────────────────────────────────────────────────────── */

type IP = { className?: string; size?: number };
const Ico = ({ children, size = 20, className = "" }: IP & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {children}
  </svg>
);

const IcoUsers = (p: IP) => (<Ico {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Ico>);
const IcoFile = (p: IP) => (<Ico {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></Ico>);
const IcoTrending = (p: IP) => (<Ico {...p}><path d="m22 7-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></Ico>);
const IcoPercent = (p: IP) => (<Ico {...p}><path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></Ico>);
const IcoAlert = (p: IP) => (<Ico {...p}><path d="m10.3 2.3.4.7-8.3 14.3a1.7 1.7 0 0 0 1.5 2.6h16.4a1.7 1.7 0 0 0 1.5-2.6L13.3 3a1.7 1.7 0 0 0-3 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></Ico>);
const IcoArrow = (p: IP) => (<Ico {...p}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Ico>);
const IcoCalendar = (p: IP) => (<Ico {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Ico>);
const IcoClock = (p: IP) => (<Ico {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Ico>);
const IcoZap = (p: IP) => (<Ico {...p}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></Ico>);
const IcoInvoice = (p: IP) => (<Ico {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h3" /></Ico>);

/* ─────────────────────────────────────────────────────────────────────
 *  Types
 * ──────────────────────────────────────────────────────────────────── */

interface KpiData {
  activeClients: number;
  budgetsSent: number;
  incomeThisMonth: number;
  conversionRate: number;
  clientsTrend: number;
  budgetsTrend: number;
  incomeTrend: number;
}

interface AlertData {
  clientsNoReply: number;
  budgetsPending: number;
  invoicesUnpaid: number;
}

interface Opportunity {
  label: string;
  detail: string;
  href: string;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Greeting helper
 * ──────────────────────────────────────────────────────────────────── */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 7) return "Buenas noches";
  if (h < 13) return "Buenos días";
  if (h < 21) return "Buenas tardes";
  return "Buenas noches";
}

/* ─────────────────────────────────────────────────────────────────────
 *  Page
 * ──────────────────────────────────────────────────────────────────── */

export default function DashboardHome() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [kpi, setKpi] = useState<KpiData>({
    activeClients: 0, budgetsSent: 0, incomeThisMonth: 0,
    conversionRate: 0, clientsTrend: 0, budgetsTrend: 0, incomeTrend: 0,
  });
  const [alerts, setAlerts] = useState<AlertData>({
    clientsNoReply: 0, budgetsPending: 0, invoicesUnpaid: 0,
  });
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      /* ── User ─────────────────────────────────────────────── */
      const { data: { user } } = await supabase.auth.getUser();
      const full = user?.user_metadata?.full_name || user?.user_metadata?.name || "";
      setUserName(full ? full.split(" ")[0] : (user?.email?.split("@")[0] ?? ""));

      /* ── Clients ──────────────────────────────────────────── */
      const { data: clients } = await supabase.from("clients").select("id, status, created_at");
      const allC = clients ?? [];
      const activeClients = allC.filter(c => c.status === "active").length;

      /* ── Budgets ──────────────────────────────────────────── */
      const { data: budgets } = await supabase
        .from("budgets")
        .select("id, status, total, created_at, client_id, title");
      const allB = budgets ?? [];

      const now = new Date();
      const thisMonth = (d: string) => {
        const dt = new Date(d);
        return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
      };
      const lastMonth = (d: string) => {
        const dt = new Date(d);
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return dt.getMonth() === prev.getMonth() && dt.getFullYear() === prev.getFullYear();
      };

      const sentThisMonth = allB.filter(b => b.status !== "draft" && thisMonth(b.created_at)).length;
      const sentLastMonth = allB.filter(b => b.status !== "draft" && lastMonth(b.created_at)).length;

      const acceptedThisMonth = allB.filter(b => b.status === "accepted" && thisMonth(b.created_at));
      const acceptedLastMonth = allB.filter(b => b.status === "accepted" && lastMonth(b.created_at));
      const incomeThisMonth = acceptedThisMonth.reduce((s, b) => s + (b.total || 0), 0);
      const incomeLastMonth = acceptedLastMonth.reduce((s, b) => s + (b.total || 0), 0);

      const totalSent = allB.filter(b => b.status !== "draft").length;
      const totalAccepted = allB.filter(b => b.status === "accepted").length;
      const conversionRate = totalSent > 0 ? Math.round((totalAccepted / totalSent) * 100) : 0;

      /* ── Invoices (issued) ────────────────────────────────── */
      const { data: invoices } = await supabase
        .from("issued_invoices")
        .select("id, status, total");
      const allInv = invoices ?? [];
      const invoicesUnpaid = allInv.filter((inv: any) =>
        inv.status === "pending" || inv.status === "overdue"
      ).length;

      /* ── Trend helpers ────────────────────────────────────── */
      const pctChange = (curr: number, prev: number) =>
        prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 100);

      const clientsThisM = allC.filter(c => thisMonth(c.created_at)).length;
      const clientsLastM = allC.filter(c => lastMonth(c.created_at)).length;

      /* ── Alerts ───────────────────────────────────────────── */
      const pendingBudgets = allB.filter(b => b.status === "pending").length;
      // "Clients without reply" = leads that haven't become active
      const clientsNoReply = allC.filter(c => c.status === "lead").length;

      /* ── Opportunities ────────────────────────────────────── */
      const opps: Opportunity[] = [];
      const pendingList = allB.filter(b => b.status === "pending" || b.status === "sent");
      pendingList.slice(0, 2).forEach(b => {
        const days = Math.floor((Date.now() - new Date(b.created_at).getTime()) / 86400000);
        opps.push({
          label: b.title || `Presupuesto #${b.id?.slice(0, 6)}`,
          detail: `Hace ${days} día${days !== 1 ? "s" : ""} · Sin respuesta`,
          href: "/dashboard/budgets",
        });
      });

      const newLeads = allC.filter(c => c.status === "lead").slice(0, 2);
      newLeads.forEach(c => {
        opps.push({
          label: `Lead nuevo: ${(c as any).name || "Sin nombre"}`,
          detail: "Sin contactar todavía",
          href: "/dashboard/clientes",
        });
      });

      setKpi({
        activeClients,
        budgetsSent: sentThisMonth,
        incomeThisMonth,
        conversionRate,
        clientsTrend: pctChange(clientsThisM, clientsLastM),
        budgetsTrend: pctChange(sentThisMonth, sentLastMonth),
        incomeTrend: pctChange(incomeThisMonth, incomeLastMonth),
      });
      setAlerts({ clientsNoReply, budgetsPending: pendingBudgets, invoicesUnpaid });
      setOpportunities(opps);
      setLoading(false);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-navy-400">Cargando tu centro de control...</div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* ── 1. Header / Greeting ─────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-green" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-400">
            Centro de control
          </span>
        </div>
        <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 md:text-[2.5rem]">
          {greeting()}, {userName}
        </h1>
        <p className="mt-1.5 text-[15px] text-navy-500">
          Esto es lo que necesita tu atención hoy.
        </p>
      </div>

      {/* ── 2. KPI Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<IcoUsers size={20} />}
          label="Clientes activos"
          value={String(kpi.activeClients)}
          trend={kpi.clientsTrend}
        />
        <KpiCard
          icon={<IcoFile size={20} />}
          label="Presupuestos enviados"
          value={String(kpi.budgetsSent)}
          trend={kpi.budgetsTrend}
          sub="Este mes"
        />
        <KpiCard
          icon={<IcoTrending size={20} />}
          label="Ingresos del mes"
          value={`€${kpi.incomeThisMonth.toLocaleString("es-ES")}`}
          trend={kpi.incomeTrend}
          featured
        />
        <KpiCard
          icon={<IcoPercent size={20} />}
          label="Tasa de conversión"
          value={`${kpi.conversionRate} %`}
        />
      </div>

      {/* ── 3. Alerts & 4. Opportunities ─────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Alerts */}
        <section className="overflow-hidden rounded-2xl border border-navy-100 bg-white shadow-[0_1px_2px_rgba(10,25,41,0.04)]">
          <div className="flex items-center gap-2 border-b border-navy-100 px-6 py-4">
            <IcoAlert size={16} className="text-amber-500" />
            <h2 className="text-[14px] font-semibold text-navy-900">Requiere atención</h2>
          </div>
          <ul className="divide-y divide-navy-50">
            <AlertRow
              label="Clientes sin responder"
              count={alerts.clientsNoReply}
              href="/dashboard/clientes"
              severity="danger"
            />
            <AlertRow
              label="Presupuestos pendientes"
              count={alerts.budgetsPending}
              href="/dashboard/budgets"
              severity="warning"
            />
            <AlertRow
              label="Facturas por cobrar"
              count={alerts.invoicesUnpaid}
              href="/dashboard/issued-invoices"
              severity="info"
            />
          </ul>
        </section>

        {/* Opportunities */}
        <section className="overflow-hidden rounded-2xl border border-navy-100 bg-white shadow-[0_1px_2px_rgba(10,25,41,0.04)]">
          <div className="flex items-center gap-2 border-b border-navy-100 px-6 py-4">
            <IcoZap size={16} className="text-brand-green" />
            <h2 className="text-[14px] font-semibold text-navy-900">Oportunidades</h2>
          </div>
          {opportunities.length === 0 ? (
            <div className="px-6 py-10 text-center text-[13.5px] text-navy-400">
              No hay oportunidades pendientes. Todo al día.
            </div>
          ) : (
            <ul className="divide-y divide-navy-50">
              {opportunities.map((o, i) => (
                <li key={i}>
                  <Link
                    href={o.href}
                    className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-navy-50/60"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-brand-green transition-transform group-hover:scale-105">
                      <IcoArrow size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-navy-800 group-hover:text-navy-900">
                        {o.label}
                      </span>
                      <span className="block truncate text-[12px] text-navy-400">
                        {o.detail}
                      </span>
                    </span>
                    <IcoArrow size={14} className="shrink-0 text-navy-300 transition-transform group-hover:translate-x-0.5 group-hover:text-navy-500" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── 5. Quick links ───────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-navy-400">
          Accesos rápidos
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <QuickLink icon={<IcoUsers size={18} />} label="Ver clientes" href="/dashboard/clientes" />
          <QuickLink icon={<IcoFile size={18} />} label="Ver presupuestos" href="/dashboard/budgets" />
          <QuickLink icon={<IcoInvoice size={18} />} label="Ver facturas" href="/dashboard/issued-invoices" />
          <QuickLink icon={<IcoCalendar size={18} />} label="Ver calendario" href="/dashboard/calendar" />
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Sub-components
 * ──────────────────────────────────────────────────────────────────── */

function KpiCard({
  icon,
  label,
  value,
  trend,
  sub,
  featured,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend?: number;
  sub?: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`
        relative overflow-hidden rounded-2xl border bg-white p-6
        shadow-[0_1px_2px_rgba(10,25,41,0.04)]
        transition-all duration-300 hover:-translate-y-[2px]
        hover:shadow-[0_12px_32px_-16px_rgba(10,25,41,0.18)]
        ${featured
          ? "border-brand-green/20 shadow-[0_1px_2px_rgba(10,25,41,0.04),0_20px_48px_-24px_rgba(0,200,150,0.2)]"
          : "border-navy-100"
        }
      `}
    >
      {featured && (
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-green/60 to-transparent" />
      )}
      <div
        className={`
          flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset
          ${featured
            ? "bg-brand-green/10 text-brand-green ring-brand-green/20"
            : "bg-navy-50 text-navy-600 ring-navy-100"
          }
        `}
      >
        {icon}
      </div>
      <p className="mt-5 text-[12.5px] font-medium text-navy-500">{label}</p>
      <div className="mt-1 flex items-end gap-2.5">
        <p className="text-[2rem] font-semibold tabular-nums tracking-[-0.02em] text-navy-900">
          {value}
        </p>
        {trend !== undefined && trend !== 0 && (
          <span
            className={`
              mb-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5
              text-[11px] font-bold tabular-nums
              ${trend > 0
                ? "bg-brand-green/10 text-brand-green"
                : "bg-red-50 text-red-500"
              }
            `}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={trend < 0 ? "rotate-180" : ""}
              aria-hidden
            >
              <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
            </svg>
            {Math.abs(trend)} %
          </span>
        )}
      </div>
      {sub && <p className="mt-0.5 text-[11.5px] text-navy-400">{sub}</p>}
    </div>
  );
}

function AlertRow({
  label,
  count,
  href,
  severity,
}: {
  label: string;
  count: number;
  href: string;
  severity: "danger" | "warning" | "info";
}) {
  const colors = {
    danger: "bg-red-50 text-red-600 ring-red-100",
    warning: "bg-amber-50 text-amber-600 ring-amber-100",
    info: "bg-sky-50 text-sky-600 ring-sky-100",
  };
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center justify-between px-6 py-4 transition-colors hover:bg-navy-50/60"
      >
        <span className="text-[13.5px] font-medium text-navy-700 group-hover:text-navy-900">
          {label}
        </span>
        <span
          className={`
            flex h-6 min-w-6 items-center justify-center rounded-full px-2
            text-[11px] font-bold tabular-nums ring-1 ring-inset
            ${colors[severity]}
          `}
        >
          {count}
        </span>
      </Link>
    </li>
  );
}

function QuickLink({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="
        group flex items-center gap-3
        rounded-2xl border border-navy-100 bg-white
        px-5 py-4
        shadow-[0_1px_2px_rgba(10,25,41,0.04)]
        transition-all duration-200
        hover:-translate-y-[1px] hover:border-brand-green/30 hover:shadow-[0_8px_24px_-12px_rgba(0,200,150,0.2)]
      "
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy-600 ring-1 ring-inset ring-navy-100 transition-colors group-hover:bg-brand-green/10 group-hover:text-brand-green group-hover:ring-brand-green/20">
        {icon}
      </span>
      <span className="text-[13.5px] font-medium text-navy-700 group-hover:text-navy-900">
        {label}
      </span>
    </Link>
  );
}
