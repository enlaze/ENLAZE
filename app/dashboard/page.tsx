"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { logError, formatErrorForUI } from "@/lib/error-handler";
import ErrorAlert from "@/components/ErrorAlert";
import ErrorBoundary from "@/components/ErrorBoundary";
import { SkeletonCard, SkeletonKpi, SkeletonTable } from "@/components/ui/skeleton";

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
// IcoArrow reserved for future use
const IcoCalendar = (p: IP) => (<Ico {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Ico>);
// IcoZap reserved for future use
const IcoInvoice = (p: IP) => (<Ico {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h3" /></Ico>);
const IcoClock = (p: IP) => (<Ico {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Ico>);
const IcoShield = (p: IP) => (<Ico {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Ico>);

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
  invoicesUnpaid: number;
  totalOutstanding: number;
  expensesPending: number;
  expensesOverdue: number;
  totalExpensesPending: number;
}

interface MonthlyRevenue {
  month: string;
  label: string;
  income: number;
  invoiced: number;
}

interface BudgetBreakdown {
  status: string;
  label: string;
  count: number;
  color: string;
}

interface ActivityItem {
  id: string;
  action: string;
  entity_type: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface ComplianceStatus {
  area: string;
  label: string;
  status: "green" | "yellow" | "red";
  detail: string;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Helpers
 * ──────────────────────────────────────────────────────────────────── */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 7) return "Buenas noches";
  if (h < 13) return "Buenos días";
  if (h < 21) return "Buenas tardes";
  return "Buenas noches";
}

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function getLast6Months(): { month: number; year: number; label: string }[] {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ month: d.getMonth(), year: d.getFullYear(), label: MONTH_NAMES[d.getMonth()] });
  }
  return months;
}

function pctChange(curr: number, prev: number) {
  return prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 100);
}

function inMonth(dateStr: string, m: number, y: number): boolean {
  const d = new Date(dateStr);
  return d.getMonth() === m && d.getFullYear() === y;
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    "budget.created": "Presupuesto creado",
    "budget.status_changed": "Estado de presupuesto cambiado",
    "issued_invoice.created": "Factura emitida",
    "issued_invoice.status_changed": "Estado de factura cambiado",
    "project.created": "Obra creada",
    "project_change.created": "Cambio de obra registrado",
    "legal.accepted": "Documento legal aceptado",
    "marketing.opted_in": "Consentimiento marketing otorgado",
  };
  return map[action] || action.replace(/[._]/g, " ");
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
    invoicesUnpaid: 0, totalOutstanding: 0,
    expensesPending: 0, expensesOverdue: 0, totalExpensesPending: 0,
  });
  const [monthlyRevenue, setMonthlyRevenue] = useState<MonthlyRevenue[]>([]);
  const [budgetBreakdown, setBudgetBreakdown] = useState<BudgetBreakdown[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [complianceChecks, setComplianceChecks] = useState<ComplianceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function loadDashboard() {
      try {
        setError(null);

        /* ── User ─────────────────────────────────────────────── */
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const full = user.user_metadata?.full_name || user.user_metadata?.name || "";
        setUserName(full ? full.split(" ")[0] : (user.email?.split("@")[0] ?? ""));

        const months = getLast6Months();
        const now = new Date();
        const thisM = now.getMonth();
        const thisY = now.getFullYear();
        const prevM = new Date(thisY, thisM - 1, 1);

        /* ── Parallel data fetch ────────────────────────────── */
        const [clientsRes, budgetsRes, invoicesRes, activityRes, legalRes, aiRunsRes, incidentsRes, receivedInvRes] = await Promise.all([
          supabase.from("clients").select("id, status, created_at"),
          supabase.from("budgets").select("id, status, total, created_at"),
          supabase.from("issued_invoices").select("id, status, total, invoice_date, payment_status"),
          supabase.from("activity_log").select("id, action, entity_type, created_at, metadata").eq("user_id", user.id).order("created_at", { ascending: false }).limit(8),
          supabase.from("legal_acceptances").select("id").eq("user_id", user.id),
          supabase.from("ai_runs").select("id, human_reviewed").eq("user_id", user.id),
          supabase.from("security_incidents").select("id, status"),
          supabase.from("received_invoices").select("id, status, total, amount_paid, due_date, payment_status"),
        ]);

      const allC = clientsRes.data ?? [];
      const allB = budgetsRes.data ?? [];
      const allInv = invoicesRes.data ?? [];
      const allActivity = activityRes.data ?? [];
      const allLegal = legalRes.data ?? [];
      const allAi = aiRunsRes.data ?? [];
      const allIncidents = incidentsRes.data ?? [];
      const allReceivedInv = receivedInvRes.data ?? [];

      /* ── KPIs ───────────────────────────────────────────── */
      const activeClients = allC.filter(c => c.status === "active").length;

      const sentThisMonth = allB.filter(b => b.status !== "draft" && inMonth(b.created_at, thisM, thisY)).length;
      const sentLastMonth = allB.filter(b => b.status !== "draft" && inMonth(b.created_at, prevM.getMonth(), prevM.getFullYear())).length;

      const acceptedThisMonth = allB.filter(b => b.status === "accepted" && inMonth(b.created_at, thisM, thisY));
      const acceptedLastMonth = allB.filter(b => b.status === "accepted" && inMonth(b.created_at, prevM.getMonth(), prevM.getFullYear()));
      const incomeThisMonth = acceptedThisMonth.reduce((s, b) => s + (b.total || 0), 0);
      const incomeLastMonth = acceptedLastMonth.reduce((s, b) => s + (b.total || 0), 0);

      const totalSent = allB.filter(b => b.status !== "draft").length;
      const totalAccepted = allB.filter(b => b.status === "accepted").length;
      const conversionRate = totalSent > 0 ? Math.round((totalAccepted / totalSent) * 100) : 0;

      const clientsThisM = allC.filter(c => inMonth(c.created_at, thisM, thisY)).length;
      const clientsLastM = allC.filter(c => inMonth(c.created_at, prevM.getMonth(), prevM.getFullYear())).length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unpaidInvoices = allInv.filter((inv: any) => inv.status === "pending" || inv.status === "overdue" || inv.payment_status === "pending");
      const invoicesUnpaid = unpaidInvoices.length;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalOutstanding = unpaidInvoices.reduce((s: number, inv: any) => s + Number(inv.total || 0), 0);

      // Expenses (received invoices)
      const unpaidExpenses = allReceivedInv.filter((ri: Record<string, unknown>) => ri.payment_status !== "paid");
      const overdueExpenses = unpaidExpenses.filter((ri: Record<string, unknown>) => ri.due_date && new Date(ri.due_date as string) < new Date());
      const totalExpensesPending = unpaidExpenses.reduce((s: number, ri: Record<string, unknown>) => s + Number(ri.total || 0) - Number(ri.amount_paid || 0), 0);

      setKpi({
        activeClients, budgetsSent: sentThisMonth, incomeThisMonth,
        conversionRate,
        clientsTrend: pctChange(clientsThisM, clientsLastM),
        budgetsTrend: pctChange(sentThisMonth, sentLastMonth),
        incomeTrend: pctChange(incomeThisMonth, incomeLastMonth),
        invoicesUnpaid, totalOutstanding,
        expensesPending: unpaidExpenses.length,
        expensesOverdue: overdueExpenses.length,
        totalExpensesPending,
      });

      /* ── Monthly Revenue (last 6 months) ────────────────── */
      const revenue: MonthlyRevenue[] = months.map(m => {
        const monthIncome = allB
          .filter(b => b.status === "accepted" && inMonth(b.created_at, m.month, m.year))
          .reduce((s, b) => s + (b.total || 0), 0);
        const monthInvoiced = allInv
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((inv: any) => inv.invoice_date && inMonth(inv.invoice_date, m.month, m.year))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .reduce((s: number, inv: any) => s + Number(inv.total || 0), 0);
        return { month: `${m.year}-${m.month}`, label: m.label, income: monthIncome, invoiced: monthInvoiced };
      });
      setMonthlyRevenue(revenue);

      /* ── Budget Breakdown ───────────────────────────────── */
      const statusMap: Record<string, { label: string; color: string }> = {
        draft: { label: "Borrador", color: "#94a3b8" },
        pending: { label: "Pendiente", color: "#f59e0b" },
        sent: { label: "Enviado", color: "#3b82f6" },
        enviado: { label: "Enviado", color: "#3b82f6" },
        accepted: { label: "Aceptado", color: "#00c896" },
        aceptado: { label: "Aceptado", color: "#00c896" },
        rejected: { label: "Rechazado", color: "#ef4444" },
        rechazado: { label: "Rechazado", color: "#ef4444" },
      };
      const counts: Record<string, number> = {};
      allB.forEach(b => { counts[b.status] = (counts[b.status] || 0) + 1; });
      const breakdown = Object.entries(counts)
        .map(([status, count]) => ({
          status,
          label: statusMap[status]?.label || status,
          count,
          color: statusMap[status]?.color || "#64748b",
        }))
        .sort((a, b) => b.count - a.count);
      setBudgetBreakdown(breakdown);

      /* ── Recent Activity ────────────────────────────────── */
      setRecentActivity(allActivity as ActivityItem[]);

      /* ── Compliance Checks ──────────────────────────────── */
      const checks: ComplianceStatus[] = [];

      // Legal
      const hasTerms = allLegal.length >= 2; // terms + privacy
      checks.push({
        area: "legal",
        label: "Legal / Privacidad",
        status: hasTerms ? "green" : "red",
        detail: hasTerms ? "Términos y privacidad aceptados" : "Falta aceptar documentos legales",
      });

      // Fiscal
      const invoicesWithoutHash = allInv.filter((inv: Record<string, unknown>) => !inv.verifactu_hash).length;
      checks.push({
        area: "fiscal",
        label: "Fiscal / Verifactu",
        status: invoicesWithoutHash === 0 ? "green" : invoicesWithoutHash <= 3 ? "yellow" : "red",
        detail: invoicesWithoutHash === 0 ? "Todas las facturas con hash" : `${invoicesWithoutHash} factura(s) sin hash Verifactu`,
      });

      // AI
      const unreviewedAi = allAi.filter(r => !r.human_reviewed).length;
      checks.push({
        area: "ai",
        label: "IA / Supervisión",
        status: unreviewedAi === 0 ? "green" : unreviewedAi <= 5 ? "yellow" : "red",
        detail: unreviewedAi === 0 ? "Todas las ejecuciones revisadas" : `${unreviewedAi} ejecución(es) sin revisar`,
      });

      // Security
      const openIncidents = allIncidents.filter(i => i.status === "open").length;
      checks.push({
        area: "security",
        label: "Seguridad",
        status: openIncidents === 0 ? "green" : "red",
        detail: openIncidents === 0 ? "Sin incidentes abiertos" : `${openIncidents} incidente(s) abierto(s)`,
      });

      setComplianceChecks(checks);
      setLoading(false);
    } catch (err) {
      // Log error and show friendly message to user
      logError(err, {
        component: "DashboardHome",
        action: "loadDashboard",
      });
      setError(err instanceof Error ? err : new Error(String(err)));
      setLoading(false);
    }
    }

    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="space-y-8" aria-busy="true" aria-live="polite">
        {/* KPI grid skeleton */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        {/* Two-column content skeleton */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <SkeletonCard />
            <SkeletonTable rows={4} cols={3} />
          </div>
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </div>
    );
  }

  // Show error state if data loading failed
  if (error) {
    const formatted = formatErrorForUI(error);
    return (
      <div className="space-y-4">
        <ErrorAlert
          title={formatted.title}
          message={formatted.message}
          variant={formatted.icon === "error" ? "error" : formatted.icon === "warning" ? "warning" : "info"}
          action={{
            label: "Recargar dashboard",
            onClick: () => window.location.reload(),
          }}
        />
        <div className="text-sm text-navy-600 dark:text-zinc-400 p-4 rounded-lg bg-navy-50 border border-navy-100 dark:border-zinc-800">
          Si el problema persiste, contacta con{" "}
          <a href="mailto:support@enlaze.es" className="text-brand-green font-medium hover:underline">
            soporte
          </a>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary name="dashboard-home">
      <div className="space-y-8">
      {/* ── 1. Header / Greeting ─────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-green" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-400 dark:text-zinc-500">
            Centro de control
          </span>
        </div>
        <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 dark:text-white md:text-[2.5rem]">
          {greeting()}, {userName}
        </h1>
        <p className="mt-1.5 text-[15px] text-navy-500 dark:text-zinc-500">
          Esto es lo que necesita tu atención hoy.
        </p>
      </div>

      {/* ── Onboarding checklist (auto-hides when all steps done) ── */}
      <OnboardingChecklist />

      {/* ── Daily Briefing ── */}
      <DailyBriefingCard />

      {/* ── 2. KPI Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={<IcoUsers size={20} />} label="Clientes activos" value={String(kpi.activeClients)} trend={kpi.clientsTrend} />
        <KpiCard icon={<IcoFile size={20} />} label="Presupuestos enviados" value={String(kpi.budgetsSent)} trend={kpi.budgetsTrend} sub="Este mes" />
        <KpiCard icon={<IcoTrending size={20} />} label="Ingresos del mes" value={`€${kpi.incomeThisMonth.toLocaleString("es-ES")}`} trend={kpi.incomeTrend} featured />
        <KpiCard icon={<IcoPercent size={20} />} label="Tasa de conversión" value={`${kpi.conversionRate} %`} />
      </div>

      {/* ── 3. Revenue Chart + Budget Breakdown ──────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Revenue Chart (2 cols) */}
        <section className="lg:col-span-2 overflow-hidden rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[0_1px_2px_rgba(10,25,41,0.04)]">
          <div className="flex items-center justify-between border-b border-navy-100 dark:border-zinc-800 px-6 py-4">
            <h2 className="text-[14px] font-semibold text-navy-900 dark:text-white">Evolución de ingresos</h2>
            <div className="flex items-center gap-4 text-[11px]">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-brand-green" /> Aceptados</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> Facturado</span>
            </div>
          </div>
          <div className="px-6 py-6">
            <BarChart data={monthlyRevenue} />
          </div>
        </section>

        {/* Budget Breakdown (1 col) */}
        <section className="overflow-hidden rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[0_1px_2px_rgba(10,25,41,0.04)]">
          <div className="border-b border-navy-100 dark:border-zinc-800 px-6 py-4">
            <h2 className="text-[14px] font-semibold text-navy-900 dark:text-white">Presupuestos por estado</h2>
          </div>
          <div className="px-6 py-6">
            <DonutChart data={budgetBreakdown} />
            <div className="mt-4 space-y-2">
              {budgetBreakdown.map(b => (
                <div key={b.status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: b.color }} />
                    <span className="text-[13px] text-navy-700 dark:text-zinc-300">{b.label}</span>
                  </div>
                  <span className="text-[13px] font-semibold tabular-nums text-navy-900 dark:text-white">{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ── 4. Alerts + Outstanding + Compliance ─────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Alerts */}
        <section className="overflow-hidden rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[0_1px_2px_rgba(10,25,41,0.04)]">
          <div className="flex items-center gap-2 border-b border-navy-100 dark:border-zinc-800 px-6 py-4">
            <IcoAlert size={16} className="text-amber-500" />
            <h2 className="text-[14px] font-semibold text-navy-900 dark:text-white">Requiere atención</h2>
          </div>
          <ul className="divide-y divide-navy-50">
            <AlertRow label="Facturas por cobrar" count={kpi.invoicesUnpaid} href="/dashboard/issued-invoices" severity="danger" />
            <AlertRow label="Importe pendiente" count={0} href="/dashboard/issued-invoices" severity="warning" customValue={`€${kpi.totalOutstanding.toLocaleString("es-ES")}`} />
            <AlertRow label="Tasa conversión" count={0} href="/dashboard/budgets" severity={kpi.conversionRate >= 50 ? "info" : "warning"} customValue={`${kpi.conversionRate}%`} />
            <AlertRow label="Facturas por pagar" count={kpi.expensesPending} href="/dashboard/suppliers/invoices" severity={kpi.expensesPending > 0 ? "warning" : "info"} />
            {kpi.expensesOverdue > 0 && (
              <AlertRow label="Gastos vencidos" count={kpi.expensesOverdue} href="/dashboard/suppliers/invoices" severity="danger" />
            )}
            {kpi.totalExpensesPending > 0 && (
              <AlertRow label="Total gastos pdtes." count={0} href="/dashboard/suppliers/invoices" severity="warning" customValue={`€${kpi.totalExpensesPending.toLocaleString("es-ES")}`} />
            )}
          </ul>
        </section>

        {/* Compliance Summary */}
        <section className="overflow-hidden rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[0_1px_2px_rgba(10,25,41,0.04)]">
          <div className="flex items-center gap-2 border-b border-navy-100 dark:border-zinc-800 px-6 py-4">
            <IcoShield size={16} className="text-brand-green" />
            <h2 className="text-[14px] font-semibold text-navy-900 dark:text-white">Cumplimiento</h2>
            <Link href="/dashboard/compliance" className="ml-auto text-[11px] text-navy-500 dark:text-zinc-500 hover:text-brand-green">
              Ver todo →
            </Link>
          </div>
          <ul className="divide-y divide-navy-50">
            {complianceChecks.map(c => (
              <li key={c.area} className="flex items-center gap-3 px-6 py-3.5">
                <span className={`h-3 w-3 rounded-full ${
                  c.status === "green" ? "bg-emerald-400" : c.status === "yellow" ? "bg-amber-400" : "bg-red-400"
                }`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-navy-800">{c.label}</p>
                  <p className="text-[11px] text-navy-400 dark:text-zinc-500 truncate">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Recent Activity */}
        <section className="overflow-hidden rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[0_1px_2px_rgba(10,25,41,0.04)]">
          <div className="flex items-center gap-2 border-b border-navy-100 dark:border-zinc-800 px-6 py-4">
            <IcoClock size={16} className="text-navy-500 dark:text-zinc-500" />
            <h2 className="text-[14px] font-semibold text-navy-900 dark:text-white">Actividad reciente</h2>
            <Link href="/dashboard/audit-log" className="ml-auto text-[11px] text-navy-500 dark:text-zinc-500 hover:text-brand-green">
              Ver todo →
            </Link>
          </div>
          {recentActivity.length === 0 ? (
            <div className="px-6 py-10 text-center text-[13px] text-navy-400 dark:text-zinc-500">
              No hay actividad registrada aún.
            </div>
          ) : (
            <ul className="divide-y divide-navy-50">
              {recentActivity.slice(0, 6).map(a => (
                <li key={a.id} className="px-6 py-3">
                  <p className="text-[13px] text-navy-700 dark:text-zinc-300">{actionLabel(a.action)}</p>
                  <p className="text-[11px] text-navy-400 dark:text-zinc-500 mt-0.5">
                    {new Date(a.created_at).toLocaleDateString("es-ES", {
                      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                    {a.entity_type && <span className="ml-2 rounded bg-navy-50 dark:bg-zinc-900/50 px-1 py-0.5 text-[10px] uppercase text-navy-600 dark:text-zinc-400">{a.entity_type}</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── 5. Quick links ───────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-navy-400 dark:text-zinc-500">
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
    </ErrorBoundary>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  SVG Bar Chart (pure, no dependencies)
 * ──────────────────────────────────────────────────────────────────── */

function BarChart({ data }: { data: MonthlyRevenue[] }) {
  if (data.length === 0) return <p className="text-[13px] text-navy-400 dark:text-zinc-500 text-center py-8">Sin datos</p>;

  const maxVal = Math.max(...data.flatMap(d => [d.income, d.invoiced]), 1);
  const chartH = 160;
  const barW = 24;
  const gap = 16;
  const totalW = data.length * (barW * 2 + gap + 8);

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(totalW, 300)} height={chartH + 30} className="w-full" viewBox={`0 0 ${Math.max(totalW, 300)} ${chartH + 30}`}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1="0" y1={chartH - chartH * f} x2={Math.max(totalW, 300)} y2={chartH - chartH * f}
            stroke="#e2e8f0" strokeWidth="1" strokeDasharray={f === 0 ? "0" : "4 4"} />
        ))}

        {data.map((d, i) => {
          const x = i * (barW * 2 + gap + 8) + 20;
          const h1 = (d.income / maxVal) * chartH;
          const h2 = (d.invoiced / maxVal) * chartH;

          return (
            <g key={d.month}>
              {/* Income bar */}
              <rect x={x} y={chartH - h1} width={barW} height={Math.max(h1, 2)}
                rx="4" fill="#00c896" opacity="0.85" />
              {/* Invoiced bar */}
              <rect x={x + barW + 4} y={chartH - h2} width={barW} height={Math.max(h2, 2)}
                rx="4" fill="#38bdf8" opacity="0.7" />
              {/* Label */}
              <text x={x + barW + 2} y={chartH + 18} textAnchor="middle"
                className="fill-navy-400 text-[11px]">{d.label}</text>
              {/* Value on hover area */}
              {d.income > 0 && (
                <text x={x + barW / 2} y={chartH - h1 - 6} textAnchor="middle"
                  className="fill-navy-600 text-[10px] font-medium">
                  €{d.income >= 1000 ? `${(d.income / 1000).toFixed(1)}k` : d.income}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  SVG Donut Chart
 * ──────────────────────────────────────────────────────────────────── */

function DonutChart({ data }: { data: BudgetBreakdown[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return <p className="text-[13px] text-navy-400 dark:text-zinc-500 text-center py-4">Sin presupuestos</p>;

  const size = 120;
  const strokeW = 20;
  const radius = (size - strokeW) / 2;
  const circumference = 2 * Math.PI * radius;

  const segments = data.reduce<Array<BudgetBreakdown & { offset: number; length: number }>>((acc, d) => {
    const pct = d.count / total;
    const prevOffset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].length : 0;
    acc.push({ ...d, offset: prevOffset, length: pct * circumference });
    return acc;
  }, []);

  return (
    <div className="flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        {segments.map(seg => (
          <circle
            key={seg.status}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeW}
            strokeDasharray={`${seg.length} ${circumference - seg.length}`}
            strokeDashoffset={-seg.offset}
            strokeLinecap="round"
          />
        ))}
      </svg>
      <div className="absolute text-center">
        <p className="text-2xl font-bold text-navy-900 dark:text-white">{total}</p>
        <p className="text-[10px] text-navy-400 dark:text-zinc-500">Total</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Sub-components
 * ──────────────────────────────────────────────────────────────────── */

function KpiCard({
  icon, label, value, trend, sub, featured,
}: {
  icon: React.ReactNode; label: string; value: string;
  trend?: number; sub?: string; featured?: boolean;
}) {
  return (
    <div className={`
      relative overflow-hidden rounded-2xl border bg-white dark:bg-zinc-900 p-6
      shadow-[0_1px_2px_rgba(10,25,41,0.04)]
      transition-all duration-300 hover:-translate-y-[2px]
      hover:shadow-[0_12px_32px_-16px_rgba(10,25,41,0.18)]
      ${featured
        ? "border-brand-green/20 shadow-[0_1px_2px_rgba(10,25,41,0.04),0_20px_48px_-24px_rgba(0,200,150,0.2)]"
        : "border-navy-100 dark:border-zinc-800"
      }
    `}>
      {featured && <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-green/60 to-transparent" />}
      <div className={`
        flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset
        ${featured ? "bg-brand-green/10 text-brand-green ring-brand-green/20" : "bg-navy-50 text-navy-600 dark:text-zinc-400 ring-navy-100"}
      `}>
        {icon}
      </div>
      <p className="mt-5 text-[12.5px] font-medium text-navy-500 dark:text-zinc-500">{label}</p>
      <div className="mt-1 flex items-end gap-2.5">
        <p className="text-[2rem] font-semibold tabular-nums tracking-[-0.02em] text-navy-900 dark:text-white">{value}</p>
        {trend !== undefined && trend !== 0 && (
          <span className={`
            mb-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums
            ${trend > 0 ? "bg-brand-green/10 text-brand-green" : "bg-red-50 text-red-500"}
          `}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={trend < 0 ? "rotate-180" : ""} aria-hidden>
              <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
            </svg>
            {Math.abs(trend)} %
          </span>
        )}
      </div>
      {sub && <p className="mt-0.5 text-[11.5px] text-navy-400 dark:text-zinc-500">{sub}</p>}
    </div>
  );
}

function AlertRow({
  label, count, href, severity, customValue,
}: {
  label: string; count: number; href: string;
  severity: "danger" | "warning" | "info"; customValue?: string;
}) {
  const colors = {
    danger: "bg-red-50 text-red-600 ring-red-100",
    warning: "bg-amber-50 text-amber-600 ring-amber-100",
    info: "bg-sky-50 text-sky-600 ring-sky-100",
  };
  return (
    <li>
      <Link href={href} className="group flex items-center justify-between px-6 py-4 transition-colors hover:bg-navy-50 dark:hover:bg-zinc-800/50/60">
        <span className="text-[13.5px] font-medium text-navy-700 dark:text-zinc-300 group-hover:text-navy-900 dark:text-white">{label}</span>
        <span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[11px] font-bold tabular-nums ring-1 ring-inset ${colors[severity]}`}>
          {customValue || count}
        </span>
      </Link>
    </li>
  );
}

function QuickLink({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <Link href={href} className="
      group flex items-center gap-3 rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4
      shadow-[0_1px_2px_rgba(10,25,41,0.04)] transition-all duration-200
      hover:-translate-y-[1px] hover:border-brand-green/30 hover:shadow-[0_8px_24px_-12px_rgba(0,200,150,0.2)]
    ">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy-600 dark:text-zinc-400 ring-1 ring-inset ring-navy-100 transition-colors group-hover:bg-brand-green/10 group-hover:text-brand-green group-hover:ring-brand-green/20">
        {icon}
      </span>
      <span className="text-[13.5px] font-medium text-navy-700 dark:text-zinc-300 group-hover:text-navy-900 dark:text-white">{label}</span>
    </Link>
  );
}

function DailyBriefingCard() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchBriefing() {
      try {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError(true);
          return;
        }

        const res = await fetch(`/api/agent/daily-briefing`);
        if (!res.ok) throw new Error("Briefing request failed");
        
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error("Failed to load daily briefing:", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchBriefing();
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 animate-pulse">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-6 w-6 rounded-full bg-navy-100 dark:bg-zinc-800" />
          <div className="h-5 w-32 rounded bg-navy-100 dark:bg-zinc-800" />
        </div>
        <div className="space-y-2 mb-6">
          <div className="h-4 w-full rounded bg-navy-50 dark:bg-zinc-800" />
          <div className="h-4 w-3/4 rounded bg-navy-50 dark:bg-zinc-800" />
        </div>
        <div className="flex gap-3">
          <div className="h-8 w-24 rounded-lg bg-navy-100 dark:bg-zinc-800" />
          <div className="h-8 w-24 rounded-lg bg-navy-100 dark:bg-zinc-800" />
          <div className="h-8 w-24 rounded-lg bg-navy-100 dark:bg-zinc-800" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 p-6 dark:border-red-900/30 dark:bg-red-900/10">
        <p className="text-[14px] font-medium text-red-800 dark:text-red-400">
          No se ha podido cargar tu resumen diario.
        </p>
      </div>
    );
  }

  const { summary, modules, module_status } = data;
  const isAllDisconnected = !modules || (!modules.gmail?.connected && !modules.calendar?.connected && !modules.sheets?.connected);

  if (isAllDisconnected) {
    return (
      <div className="rounded-2xl border border-brand-green/20 bg-brand-green/5 p-6 shadow-sm dark:border-brand-green/10 dark:bg-brand-green/5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-semibold text-navy-900 dark:text-white flex items-center gap-2 mb-1">
            <span className="text-xl">✨</span> Resumen de Inteligencia
          </h2>
          <p className="text-[13.5px] text-navy-600 dark:text-zinc-400">
            Aún no tienes el agente conectado. Integra tu correo, calendario y datos para ver tu resumen de hoy.
          </p>
        </div>
        <Link 
          href="/dashboard/settings/integrations" 
          className="shrink-0 px-4 py-2 rounded-lg bg-brand-green text-white hover:bg-brand-green/90 text-sm font-medium transition-colors"
        >
          Conectar herramientas
        </Link>
      </div>
    );
  }

  // --- Siguiente mejor acción heurística ---
  let nextAction = null;
  if (modules?.sheets && modules.sheets.connected && !modules.sheets.spreadsheet_id) {
    nextAction = {
      message: "💡 Configura una hoja para que el agente pueda analizar ventas o stock.",
      actionLabel: "Configurar hoja",
      actionUrl: "/dashboard/settings/integrations",
      isInternal: true
    };
  } else if (modules?.gmail && modules.gmail.connected && modules.gmail.priority_threads?.length > 0) {
    nextAction = {
      message: `🚨 Tienes ${modules.gmail.priority_threads.length} correos urgentes sin leer.`,
      actionLabel: "Abrir Gmail",
      actionUrl: "https://mail.google.com/mail/u/0/#inbox",
      isInternal: false
    };
  } else if (modules?.calendar && modules.calendar.connected && (modules.calendar.daily_agenda?.free_hours || 0) >= 2) {
    nextAction = {
      message: `⏱️ Hoy tienes ${modules.calendar.daily_agenda.free_hours} horas libres.`,
      actionLabel: "Ver agenda",
      actionUrl: "https://calendar.google.com",
      isInternal: false
    };
  } else {
    nextAction = {
      message: "✅ El día está bajo control. ¡Sigue así!",
      actionLabel: null,
      actionUrl: null,
      isInternal: false
    };
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-brand-green/20 bg-gradient-to-br from-white to-brand-green/5 shadow-sm dark:border-brand-green/20 dark:from-zinc-900 dark:to-brand-green/5">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">✨</span>
          <h2 className="text-[16px] font-semibold text-navy-900 dark:text-white">Resumen de hoy</h2>
        </div>
        
        <p className="text-[15px] leading-relaxed text-navy-800 dark:text-zinc-300 mb-6">
          {summary}
        </p>

        {/* --- Badges Estáticos --- */}
        <div className="flex flex-wrap gap-3 mb-6">
          <ModuleBadge 
            name="Gmail" 
            status={module_status?.gmail} 
            connected={modules?.gmail?.connected}
            value={modules?.gmail?.unread_count !== undefined ? `${modules.gmail.unread_count} sin leer` : "No conectado"} 
          />
          <ModuleBadge 
            name="Calendar" 
            status={module_status?.calendar} 
            connected={modules?.calendar?.connected}
            value={modules?.calendar?.today_events?.length !== undefined ? `${modules.calendar.today_events.length} eventos` : "No conectado"} 
          />
          <ModuleBadge 
            name="Sheets" 
            status={modules?.sheets?.connected && !modules?.sheets?.spreadsheet_name ? "warning" : module_status?.sheets} 
            connected={modules?.sheets?.connected}
            value={modules?.sheets?.spreadsheet_name ? modules.sheets.spreadsheet_name : "Sin hoja configurada"} 
          />
        </div>

        {/* --- Siguiente mejor acción --- */}
        <div className="bg-white/60 dark:bg-zinc-800/60 rounded-xl p-4 border border-navy-100 dark:border-zinc-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-[14px] font-medium text-navy-900 dark:text-white">
            {nextAction.message}
          </p>
          {nextAction.actionLabel && (
            nextAction.isInternal ? (
              <Link href={nextAction.actionUrl} className="shrink-0 px-4 py-1.5 text-sm font-medium bg-brand-green text-white rounded-lg hover:bg-brand-green/90 transition-colors">
                {nextAction.actionLabel}
              </Link>
            ) : (
              <a href={nextAction.actionUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 px-4 py-1.5 text-sm font-medium bg-brand-green text-white rounded-lg hover:bg-brand-green/90 transition-colors">
                {nextAction.actionLabel}
              </a>
            )
          )}
        </div>
      </div>
      
      {/* --- Acciones rápidas adicionales --- */}
      <div className="bg-navy-50/50 dark:bg-zinc-800/30 px-6 py-4 border-t border-brand-green/10 flex flex-wrap items-center gap-3">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-500 mr-2">
          Enlaces rápidos:
        </span>
        
        {modules?.gmail?.connected && (
          <a href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-navy-700 hover:text-brand-green dark:text-zinc-300 transition-colors">
            Abrir Gmail
          </a>
        )}
        
        {modules?.calendar?.connected && (
          <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-navy-700 hover:text-brand-green dark:text-zinc-300 transition-colors">
            Ver Agenda
          </a>
        )}
        
        {modules?.sheets?.connected && modules.sheets.spreadsheet_id ? (
          <a href={`https://docs.google.com/spreadsheets/d/${modules.sheets.spreadsheet_id}`} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-navy-700 hover:text-brand-green dark:text-zinc-300 transition-colors">
            Abrir Hoja
          </a>
        ) : (
          <Link href="/dashboard/settings/integrations" className="text-[13px] font-medium text-navy-700 hover:text-brand-green dark:text-zinc-300 transition-colors">
            Integraciones
          </Link>
        )}
      </div>
    </section>
  );
}

function ModuleBadge({ name, status, connected, value }: { name: string, status?: string, connected?: boolean, value: string }) {
  const isError = status === "error" || !connected;
  const isWarning = status === "warning";
  
  const bgClass = isError ? "bg-red-50 dark:bg-red-900/10" : isWarning ? "bg-amber-50 dark:bg-amber-900/10" : "bg-white dark:bg-zinc-800/50";
  const borderClass = isError ? "border-red-200 dark:border-red-800/50" : isWarning ? "border-amber-200 dark:border-amber-800/50" : "border-navy-100 dark:border-zinc-700/50";
  const dotClass = isError ? "bg-red-500" : isWarning ? "bg-amber-400" : "bg-brand-green";
  const textClass = isError ? "text-red-700 dark:text-red-400" : isWarning ? "text-amber-700 dark:text-amber-400" : "text-navy-700 dark:text-zinc-300";

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${bgClass} ${borderClass} shadow-sm`}>
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      <span className={`text-[12px] font-medium ${textClass}`}>
        {name}: <span className="opacity-80 font-normal">{!connected ? "No conectado" : value}</span>
      </span>
    </div>
  );
}
