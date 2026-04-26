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
    description: "Añade el nombre de tu empresa, logo y datos de contacto.",
    href: "/dashboard/settings",
    checkFn: (ctx) => ctx.profileComplete,
  },
  {
    id: "client",
    label: "Crea tu primer cliente",
    description: "Añade un cliente para empezar a gestionar presupuestos.",
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
    description: "Crea y envía un presupuesto profesional a un cliente.",
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

const DISMISSED_KEY = "enlaze_onboarding_dismissed";

/* ─── Component ────────────────────────────────────────────────────── */

export default function OnboardingChecklist() {
  const supabase = createClient();
  const [ctx, setCtx] = useState<CheckContext | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [collapsedSteps, setCollapsedSteps] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check local dismissal
    try {
      if (typeof window !== "undefined" && window.sessionStorage.getItem(DISMISSED_KEY) === "true") {
        setDismissed(true);
        setLoading(false);
        return;
      }
    } catch {
      // ignore
    }

    async function check() {
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

      setCtx({
        hasClients: (clients.count ?? 0) > 0,
        hasBudgets: (budgets.count ?? 0) > 0,
        hasPrices: (prices.count ?? 0) > 0,
        hasSuppliers: (suppliers.count ?? 0) > 0,
        profileComplete,
      });
      setLoading(false);
    }

    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // ignore
    }
  }, []);

  const toggleStep = useCallback((id: string) => {
    setCollapsedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (loading || dismissed || !ctx) return null;

  const completed = STEPS.filter((s) => s.checkFn(ctx));
  const remaining = STEPS.filter((s) => !s.checkFn(ctx));

  // All done → don't show
  if (remaining.length === 0) return null;

  const progress = Math.round((completed.length / STEPS.length) * 100);

  return (
    <section className="overflow-hidden rounded-2xl border border-brand-green/20 bg-gradient-to-br from-brand-green/[0.04] to-white shadow-[0_1px_2px_rgba(10,25,41,0.04)] dark:border-brand-green/25 dark:from-brand-green/[0.06] dark:to-zinc-900 dark:shadow-none">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 py-5">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden>🚀</span>
            <h2 className="text-[15px] font-semibold text-navy-900 dark:text-white">
              Primeros pasos con Enlaze
            </h2>
          </div>
          <p className="mt-1 text-[13px] text-navy-500 dark:text-zinc-400">
            Completa estos pasos para sacar el máximo partido a tu cuenta.
          </p>
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1.5 text-navy-400 transition-colors hover:bg-navy-100 hover:text-navy-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label="Cerrar guía"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-6 pb-4">
        <div className="flex items-center justify-between text-[11px] font-medium">
          <span className="text-navy-500 dark:text-zinc-400">{completed.length} de {STEPS.length} completados</span>
          <span className="text-brand-green">{progress}%</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-navy-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-brand-green transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <ul className="border-t border-navy-100/60 dark:border-zinc-800">
        {STEPS.map((step) => {
          const done = step.checkFn(ctx);
          const isOpen = !done && !collapsedSteps.has(step.id);

          return (
            <li
              key={step.id}
              className={`border-b border-navy-100/40 last:border-b-0 dark:border-zinc-800/60 ${
                done ? "bg-brand-green/[0.03] dark:bg-brand-green/[0.06]" : ""
              }`}
            >
              <button
                onClick={() => !done && toggleStep(step.id)}
                className="flex w-full items-center gap-3 px-6 py-3.5 text-left transition-colors hover:bg-navy-50/50 dark:hover:bg-zinc-800/50"
              >
                {/* Check circle */}
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                    done
                      ? "border-brand-green bg-brand-green text-white"
                      : "border-navy-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                  }`}
                >
                  {done && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </span>

                {/* Label */}
                <span
                  className={`flex-1 text-[13.5px] font-medium ${
                    done ? "text-navy-400 line-through dark:text-zinc-500" : "text-navy-800 dark:text-zinc-100"
                  }`}
                >
                  {step.label}
                </span>

                {/* Expand chevron */}
                {!done && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`text-navy-400 transition-transform dark:text-zinc-500 ${isOpen ? "rotate-180" : ""}`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                )}
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-6 pb-4 pl-[3.25rem]">
                  <p className="text-[12.5px] text-navy-500 dark:text-zinc-400">{step.description}</p>
                  <Link
                    href={step.href}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 dark:bg-brand-green dark:text-zinc-950 dark:hover:bg-brand-green-light"
                  >
                    Empezar
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
