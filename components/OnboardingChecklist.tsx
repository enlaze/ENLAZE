"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";

/* ─── Step definition ──────────────────────────────────────────────── */

interface Step {
  id: string;
  label: string;
  description: string;
  href: string;
  checkFn: (ctx: CheckContext) => boolean;
}

interface CheckContext {
  hasClients: boolean;
  hasBudgets: boolean;
  hasPrices: boolean;
  hasSuppliers: boolean;
  profileComplete: boolean;
}

const STEPS: Step[] = [
  {
    id: "profile",
    label: "Completa tu perfil",
    description: "Añade tus datos y logotipo para que aparezcan en tus documentos.",
    href: "/dashboard/settings",
    checkFn: (ctx) => ctx.profileComplete,
  },
  {
    id: "client",
    label: "Crea tu primer cliente",
    description: "Da de alta un cliente para empezar a trabajar con él.",
    href: "/dashboard/clientes",
    checkFn: (ctx) => ctx.hasClients,
  },
  {
    id: "prices",
    label: "Configura tu banco de precios",
    description: "Sube tus precios para generar presupuestos al instante.",
    href: "/dashboard/prices",
    checkFn: (ctx) => ctx.hasPrices,
  },
  {
    id: "budget",
    label: "Envía tu primer presupuesto",
    description: "Genera y envía un presupuesto a un cliente.",
    href: "/dashboard/budgets",
    checkFn: (ctx) => ctx.hasBudgets,
  },
  {
    id: "supplier",
    label: "Añade un proveedor",
    description: "Registra proveedores para controlar costes y pedidos.",
    href: "/dashboard/suppliers",
    checkFn: (ctx) => ctx.hasSuppliers,
  },
];

const COLLAPSED_KEY = "enlaze_onboarding_collapsed";

/* Progress ring geometry: r = 24 → circumference = 2πr ≈ 150.8 */
const RING_CIRCUMFERENCE = 150.8;

/* ─── Lucide icons (inline, strokeWidth 2) ─────────────────────────── */

function RocketIcon({ size = 22, color = "#00c896" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function ChevronDown({ size = 15, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronUp({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

/* ─── Component ────────────────────────────────────────────────────── */

export default function OnboardingChecklist() {
  const supabase = createClient();
  const [ctx, setCtx] = useState<CheckContext | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [openIndex, setOpenIndex] = useState<number>(-1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function check() {
      // Restore collapsed preference
      try {
        if (window.sessionStorage.getItem(COLLAPSED_KEY) === "true") {
          setCollapsed(true);
        }
      } catch {
        // ignore
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const [clients, budgets, prices, suppliers, { data: profile }] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("budgets").select("id", { count: "exact", head: true }),
        supabase.from("price_items").select("id", { count: "exact", head: true }),
        supabase.from("suppliers").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("full_name, business_name").eq("id", user.id).maybeSingle(),
      ]);

      const profileComplete = !!(profile?.full_name && profile?.business_name);

      const nextCtx: CheckContext = {
        hasClients: (clients.count ?? 0) > 0,
        hasBudgets: (budgets.count ?? 0) > 0,
        hasPrices: (prices.count ?? 0) > 0,
        hasSuppliers: (suppliers.count ?? 0) > 0,
        profileComplete,
      };
      setCtx(nextCtx);
      // Open the first pending step by default
      setOpenIndex(STEPS.findIndex((s) => !s.checkFn(nextCtx)));
      setLoading(false);
    }

    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.sessionStorage.setItem(COLLAPSED_KEY, next ? "true" : "false");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const toggleStep = useCallback((index: number) => {
    setOpenIndex((prev) => (prev === index ? -1 : index));
  }, []);

  if (loading || !ctx) return null;

  const completed = STEPS.filter((s) => s.checkFn(ctx));
  const remaining = STEPS.filter((s) => !s.checkFn(ctx));

  // All done → don't show
  if (remaining.length === 0) return null;

  const doneCount = completed.length;
  const pct = Math.round((doneCount / STEPS.length) * 100);
  const ringOffset = (RING_CIRCUMFERENCE * (1 - pct / 100)).toFixed(1);

  /* ─── Collapsed: small pill ──────────────────────────────────────── */
  if (collapsed) {
    return (
      <button
        onClick={toggleCollapsed}
        className="flex items-center gap-2.5 rounded-full border border-[#e5eae8] bg-white px-4 py-2.5 text-[13.5px] font-semibold text-[#3d4f48] shadow-[0_1px_3px_rgba(15,30,26,0.04)] transition-colors hover:border-[#c8f0e2] hover:bg-[#fbfefd] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-brand-green/40 dark:hover:bg-zinc-800"
      >
        <RocketIcon size={16} />
        Primeros pasos
        <span className="rounded-full bg-[#e6faf4] px-2 py-0.5 text-[11px] font-bold text-brand-green-dark dark:bg-brand-green/15 dark:text-brand-green">
          {pct}%
        </span>
        <ChevronDown size={15} className="text-[#9aa8a2] dark:text-zinc-500" />
      </button>
    );
  }

  /* ─── Expanded card ──────────────────────────────────────────────── */
  return (
    <section className="rounded-2xl border border-[#e5eae8] bg-white px-[26px] pt-[26px] pb-[18px] shadow-[0_1px_3px_rgba(15,30,26,0.04)] dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
      {/* Header */}
      <div className="flex items-start gap-4 px-1 pt-1">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e6faf4] dark:bg-brand-green/15">
          <RocketIcon size={22} />
        </div>
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="text-[17px] font-bold text-[#0f1e1a] dark:text-white">
            Primeros pasos con Enlaze
          </div>
          <div className="text-[14px] text-[#6b7d76] dark:text-zinc-400">
            Completa estos pasos para sacar el máximo partido a tu cuenta.
          </div>
        </div>

        {/* Progress ring */}
        <div className="relative h-14 w-14 shrink-0">
          <svg width="56" height="56" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="24" fill="none" className="stroke-[#eef2f0] dark:stroke-zinc-800" strokeWidth="5" />
            <circle
              cx="28"
              cy="28"
              r="24"
              fill="none"
              stroke="#00c896"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={ringOffset}
              transform="rotate(-90 28 28)"
              style={{ transition: "stroke-dashoffset 0.4s ease" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-[#0f1e1a] dark:text-white">
            {pct}%
          </div>
        </div>

        {/* Collapse */}
        <button
          onClick={toggleCollapsed}
          title="Ocultar esta sección"
          aria-label="Ocultar esta sección"
          className="-mr-1.5 -mt-1 shrink-0 rounded-lg p-1.5 text-[#9aa8a2] transition-colors hover:bg-[#f0f4f2] hover:text-[#3d4f48] dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <ChevronUp size={18} />
        </button>
      </div>

      <div className="mt-3.5 px-1 text-[13px] font-semibold text-brand-green-dark dark:text-brand-green">
        {doneCount} de {STEPS.length} completados
      </div>

      {/* Steps */}
      <div className="mt-3 flex flex-col gap-2">
        {STEPS.map((step, index) => {
          const done = step.checkFn(ctx);

          /* Completed */
          if (done) {
            return (
              <div
                key={step.id}
                className="flex items-center gap-3.5 rounded-xl bg-[#f7fbf9] px-3.5 py-3 dark:bg-brand-green/[0.06]"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="#00c896" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <circle cx="12" cy="12" r="10" stroke="none" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <div className="flex-1 text-[15px] font-medium text-[#9aa8a2] line-through dark:text-zinc-500">
                  {step.label}
                </div>
                <div className="rounded-full bg-[#e6faf4] px-2.5 py-0.5 text-[12px] font-semibold text-brand-green-dark dark:bg-brand-green/15 dark:text-brand-green">
                  Hecho
                </div>
              </div>
            );
          }

          const isOpen = openIndex === index;

          /* Active (expanded) */
          if (isOpen) {
            return (
              <div
                key={step.id}
                onClick={() => toggleStep(index)}
                className="flex cursor-pointer items-start gap-3.5 rounded-xl border-[1.5px] border-brand-green bg-white p-3.5 shadow-[0_2px_8px_rgba(0,200,150,0.10)] dark:bg-zinc-900"
              >
                <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 border-brand-green text-[11px] font-bold text-brand-green-dark dark:text-brand-green">
                  {index + 1}
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <div className="text-[15px] font-semibold text-[#0f1e1a] dark:text-white">
                    {step.label}
                  </div>
                  <div className="text-[14px] leading-relaxed text-[#6b7d76] dark:text-zinc-400">
                    {step.description}
                  </div>
                  <Link
                    href={step.href}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 inline-flex items-center gap-1.5 self-start rounded-[9px] bg-[#0f1e1a] px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#22332d] dark:bg-brand-green dark:text-zinc-950 dark:hover:bg-brand-green-light"
                  >
                    Empezar
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </Link>
                </div>
                <ChevronUp size={17} className="mt-0.5 shrink-0 text-[#9aa8a2] dark:text-zinc-500" />
              </div>
            );
          }

          /* Pending (collapsed) */
          return (
            <div
              key={step.id}
              onClick={() => toggleStep(index)}
              className="flex cursor-pointer items-center gap-3.5 rounded-xl border border-[#eef2f0] bg-white px-3.5 py-3 transition-colors hover:border-[#c8f0e2] hover:bg-[#fbfefd] dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-brand-green/30 dark:hover:bg-zinc-800/50"
            >
              <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 border-[#d4ddd9] text-[11px] font-bold text-[#9aa8a2] dark:border-zinc-700 dark:text-zinc-500">
                {index + 1}
              </div>
              <div className="flex-1 text-[15px] font-medium text-[#3d4f48] dark:text-zinc-200">
                {step.label}
              </div>
              <ChevronDown size={17} className="shrink-0 text-[#9aa8a2] dark:text-zinc-500" />
            </div>
          );
        })}
      </div>
    </section>
  );
}
