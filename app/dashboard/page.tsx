"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import KpiCard from "@/components/dashboard/KpiCard";
import BudgetsTable, { BudgetRow } from "@/components/dashboard/BudgetsTable";
import { BudgetStatus } from "@/components/dashboard/StatusBadge";

/* ── Icons (inline, sin dependencias) ───────────────────────────────── */

function IconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function IconEuro() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10h12" />
      <path d="M4 14h9" />
      <path d="M19 6a7.5 7.5 0 1 0 0 12" />
    </svg>
  );
}

function IconTrend() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17 9 11l4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────── */

const euro = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const euroFull = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
});

const dateFmt = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buenos días";
  if (h < 21) return "Buenas tardes";
  return "Buenas noches";
}

function firstName(user: { user_metadata?: { full_name?: string; name?: string }; email?: string } | null) {
  if (!user) return "";
  const full = user.user_metadata?.full_name || user.user_metadata?.name;
  if (full) return full.split(" ")[0];
  if (user.email) return user.email.split("@")[0].split(".")[0];
  return "";
}

/* ── Types ──────────────────────────────────────────────────────────── */

type Budget = {
  id: string;
  client_name: string | null;
  reference: string | null;
  total: number | null;
  status: string | null;
  created_at: string;
};

type Client = { id: string; status: string | null; created_at: string };

/* ── Page ───────────────────────────────────────────────────────────── */

export default function DashboardHomePage() {
  const supabase = createClient();
  const [user, setUser] = useState<any>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      const [clientsRes, budgetsRes] = await Promise.all([
        supabase.from("clients").select("id, status, created_at"),
        supabase
          .from("budgets")
          .select("id, client_name, reference, total, status, created_at")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      if (clientsRes.data) setClients(clientsRes.data as Client[]);
      if (budgetsRes.data) setBudgets(budgetsRes.data as Budget[]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── KPIs ─────────────────────────────────────────────────────────── */

  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const activeClients = clients.filter(
      (c) => (c.status ?? "active") !== "inactive"
    ).length;

    const sentThisMonth = budgets.filter(
      (b) => new Date(b.created_at) >= monthStart
    ).length;
    const sentPrevMonth = budgets.filter((b) => {
      const d = new Date(b.created_at);
      return d >= prevMonthStart && d <= prevMonthEnd;
    }).length;

    const incomeThisMonth = budgets
      .filter(
        (b) =>
          (b.status === "accepted" || b.status === "aceptado") &&
          new Date(b.created_at) >= monthStart
      )
      .reduce((sum, b) => sum + (b.total ?? 0), 0);
    const incomePrevMonth = budgets
      .filter((b) => {
        const d = new Date(b.created_at);
        return (
          (b.status === "accepted" || b.status === "aceptado") &&
          d >= prevMonthStart &&
          d <= prevMonthEnd
        );
      })
      .reduce((sum, b) => sum + (b.total ?? 0), 0);

    const decided = budgets.filter((b) =>
      ["accepted", "aceptado", "rejected", "rechazado"].includes(b.status ?? "")
    );
    const accepted = decided.filter((b) =>
      ["accepted", "aceptado"].includes(b.status ?? "")
    );
    const conversion = decided.length === 0 ? 0 : (accepted.length / decided.length) * 100;

    const sentTrend =
      sentPrevMonth === 0
        ? sentThisMonth > 0
          ? 100
          : 0
        : ((sentThisMonth - sentPrevMonth) / sentPrevMonth) * 100;

    const incomeTrend =
      incomePrevMonth === 0
        ? incomeThisMonth > 0
          ? 100
          : 0
        : ((incomeThisMonth - incomePrevMonth) / incomePrevMonth) * 100;

    return {
      activeClients,
      sentThisMonth,
      sentTrend,
      incomeThisMonth,
      incomeTrend,
      conversion,
    };
  }, [clients, budgets]);

  /* ── Recent budgets rows ──────────────────────────────────────────── */

  const rows: BudgetRow[] = useMemo(() => {
    const normalize = (s: string | null): BudgetStatus => {
      if (!s) return "pending";
      if (["accepted", "aceptado"].includes(s)) return "accepted";
      if (["rejected", "rechazado"].includes(s)) return "rejected";
      return "pending";
    };
    return budgets.slice(0, 5).map((b) => ({
      id: b.id,
      client: b.client_name || "Sin cliente",
      reference: b.reference ?? undefined,
      date: dateFmt.format(new Date(b.created_at)),
      amount: euroFull.format(b.total ?? 0),
      status: normalize(b.status),
    }));
  }, [budgets]);

  /* ── Fallback de ejemplo si la cuenta está vacía ──────────────────── */

  const sampleRows: BudgetRow[] = [
    {
      id: "sample-1",
      client: "Construcciones López SL",
      reference: "PRE-2026-0042",
      date: "8 abr 2026",
      amount: euroFull.format(3240),
      status: "accepted",
    },
    {
      id: "sample-2",
      client: "Inmobiliaria Duero",
      reference: "PRE-2026-0041",
      date: "7 abr 2026",
      amount: euroFull.format(1180),
      status: "pending",
    },
    {
      id: "sample-3",
      client: "Taller Mecánico Ruiz",
      reference: "PRE-2026-0040",
      date: "5 abr 2026",
      amount: euroFull.format(870),
      status: "rejected",
    },
    {
      id: "sample-4",
      client: "Café del Puerto",
      reference: "PRE-2026-0039",
      date: "4 abr 2026",
      amount: euroFull.format(2560),
      status: "accepted",
    },
    {
      id: "sample-5",
      client: "Clínica Vida",
      reference: "PRE-2026-0038",
      date: "2 abr 2026",
      amount: euroFull.format(1925),
      status: "pending",
    },
  ];

  const tableRows = rows.length > 0 ? rows : sampleRows;
  const name = firstName(user) || "Dani";

  /* ── Render ───────────────────────────────────────────────────────── */

  return (
    <div className="relative mx-auto max-w-7xl">
      {/* Atmósfera detrás del header — crea profundidad sin ruido */}
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-x-0 -top-12 h-[360px]
          bg-[radial-gradient(ellipse_at_top_left,rgba(0,200,150,0.08),transparent_55%),radial-gradient(ellipse_at_top_right,rgba(10,25,41,0.06),transparent_60%)]
        "
      />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="relative flex flex-col gap-8 pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-navy-100 bg-white/70 px-3 py-1 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-green shadow-[0_0_0_3px_rgba(0,200,150,0.15)]" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-600">
              Panel principal
            </span>
          </div>
          <h1 className="mt-5 text-[2.25rem] font-semibold leading-[1.1] tracking-[-0.02em] text-navy-900 sm:text-[2.75rem]">
            {greeting()}, {name}{" "}
            <span aria-hidden className="inline-block">👋</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-navy-500">
            Este es el resumen de tu actividad en Enlaze. Ánimo con los presupuestos de hoy.
          </p>
        </div>

        <Link
          href="/dashboard/budgets/new"
          className="
            group inline-flex shrink-0 items-center justify-center gap-2
            rounded-xl bg-brand-green px-6 py-3.5 text-[14px] font-semibold text-white
            shadow-[0_8px_24px_-8px_rgba(0,200,150,0.5),0_2px_4px_-2px_rgba(0,200,150,0.4),inset_0_1px_0_rgba(255,255,255,0.15)]
            ring-1 ring-inset ring-white/10
            transition-all duration-200 ease-out
            hover:-translate-y-[1.5px] hover:bg-brand-green-dark
            hover:shadow-[0_14px_32px_-10px_rgba(0,200,150,0.6),0_2px_4px_-2px_rgba(0,200,150,0.4),inset_0_1px_0_rgba(255,255,255,0.2)]
            focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:ring-offset-2
            focus:ring-offset-navy-50
            active:translate-y-0
          "
        >
          <IconPlus />
          <span>Nuevo presupuesto</span>
          <span
            aria-hidden
            className="
              -mr-1 ml-0.5 inline-flex opacity-80
              transition-transform duration-200 group-hover:translate-x-0.5
            "
          >
            →
          </span>
        </Link>
      </header>

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <section
        aria-label="Indicadores clave"
        className="relative mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiCard
          label="Clientes activos"
          value={loading ? "—" : String(stats.activeClients)}
          icon={<IconUsers />}
          hint="Total de contactos activos"
        />
        <KpiCard
          label="Presupuestos enviados"
          value={loading ? "—" : String(stats.sentThisMonth)}
          icon={<IconSend />}
          trend={{ value: stats.sentTrend, label: "vs. mes anterior" }}
        />
        <KpiCard
          variant="featured"
          label="Ingresos del mes"
          value={loading ? "—" : euro.format(stats.incomeThisMonth)}
          icon={<IconEuro />}
          trend={{ value: stats.incomeTrend, label: "vs. mes anterior" }}
        />
        <KpiCard
          label="Tasa de conversión"
          value={loading ? "—" : `${stats.conversion.toFixed(1)}%`}
          icon={<IconTrend />}
          hint="Aceptados / decididos"
        />
      </section>

      {/* ── Tabla presupuestos recientes ───────────────────────────── */}
      <section className="relative mt-16">
        <BudgetsTable
          rows={tableRows}
          footerHref="/dashboard/budgets"
          footerLabel="Ver todos los presupuestos"
        />
      </section>
    </div>
  );
}
