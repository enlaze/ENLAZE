"use client";

/**
 * Las piezas visibles del plan dentro del dashboard:
 *  - PlanBanner: el aviso discreto de arriba (solo en prueba o en solo lectura).
 *  - PlanBlockNotice: el bloqueo explicado dentro de un formulario.
 *  - LockedFeature: lo que se ve en una sección que no entra en el plan.
 * Todo el texto de planes y funciones sale de lib/plans.ts.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PLANS_HREF, useBilling } from "@/components/billing/BillingProvider";
import { blockMessage, readOnlyCause, readOnlyNextStep, type BillingBlockInfo } from "@/lib/billing-messages";
import { daysLeftText, isInTrial, trialDaysLeft } from "@/lib/billing-status";
import { FEATURE_LABELS, PLAN_LABELS, cheapestPlanWith, planHasFeature, type Feature } from "@/lib/plans";

const BTN =
  "inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-green px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-green-dark dark:text-zinc-950";

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.6v.2" />
    </svg>
  );
}

function LockIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Aviso fino bajo la cabecera. Nada en planes activos; nunca tapa el trabajo. */
export function PlanBanner() {
  const { status } = useBilling();
  const pathname = usePathname();
  if (!status || pathname === PLANS_HREF) return null;

  if (isInTrial(status)) {
    return (
      <div
        role="status"
        className="mx-6 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-brand-green/25 bg-brand-green/[0.07] px-4 py-2.5 text-[13.5px] text-navy-800 md:mx-12 dark:border-brand-green/20 dark:bg-brand-green/[0.06] dark:text-zinc-200"
      >
        <span className="flex flex-1 items-center gap-2.5 text-brand-green-ink dark:text-success-ink">
          <InfoIcon />
          <span className="text-navy-800 dark:text-zinc-200">
            <strong className="font-semibold">{daysLeftText(trialDaysLeft(status))}.</strong>{" "}
            Tienes todo desbloqueado hasta entonces.
          </span>
        </span>
        <Link href={PLANS_HREF} className={BTN}>
          Elegir plan
        </Link>
      </div>
    );
  }

  if (status.access_level === "read_only") {
    return (
      <div
        role="status"
        className="mx-6 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-warning/30 bg-warning/[0.08] px-4 py-3 text-[13.5px] md:mx-12"
      >
        <span className="flex flex-1 items-start gap-2.5 text-warning-ink">
          <LockIcon />
          <span className="text-navy-800 dark:text-zinc-200">
            <strong className="font-semibold">{readOnlyCause(status.status)}</strong>{" "}
            Puedes ver y exportar tus datos. {readOnlyNextStep(status.status)}
          </span>
        </span>
        <Link href={PLANS_HREF} className={BTN}>
          {status.status === "past_due" ? "Revisar pago" : "Elegir plan"}
        </Link>
      </div>
    );
  }

  return null;
}

/** El bloqueo, explicado dentro del propio formulario, con enlace a los planes. */
export function PlanBlockNotice({ block, className = "" }: { block: BillingBlockInfo; className?: string }) {
  return (
    <div
      role="alert"
      className={`flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/[0.08] px-4 py-3 text-[13.5px] sm:flex-row sm:items-center ${className}`}
    >
      <span className="flex flex-1 items-start gap-2.5 text-warning-ink">
        <LockIcon />
        <span className="text-navy-800 dark:text-zinc-200">{blockMessage(block)}</span>
      </span>
      <Link href={PLANS_HREF} className={BTN}>
        Ver planes
      </Link>
    </div>
  );
}

/**
 * ¿Incluye el plan esta función? Mientras no se sabe (o si no se pudo leer),
 * responde que sí: el servidor sigue aplicando el muro igualmente.
 */
export function useFeature(feature: Feature): boolean {
  const { status } = useBilling();
  return !status || planHasFeature(status.plan, feature);
}

/**
 * Envuelve una sección que depende de una función del plan. Si el plan la
 * incluye, pinta `children`; si no, explica qué hace y en qué plan está.
 * Mientras no se sabe el plan, no pinta nada (ni la sección ni el candado).
 */
export function FeatureGate({
  feature,
  description,
  children,
  compact = false,
}: {
  feature: Feature;
  description: string;
  children: ReactNode;
  compact?: boolean;
}) {
  const { status, loading } = useBilling();
  if (loading && !status) return null;
  // Si no se pudo leer el plan, se deja ver: el servidor sigue aplicando el muro.
  if (!status || planHasFeature(status.plan, feature)) return <>{children}</>;
  return <LockedFeature feature={feature} description={description} compact={compact} />;
}

export function LockedFeature({
  feature,
  description,
  compact = false,
}: {
  feature: Feature;
  description: string;
  compact?: boolean;
}) {
  const plan = PLAN_LABELS[cheapestPlanWith(feature)];
  return (
    <div
      className={`flex flex-col items-start gap-4 rounded-2xl border border-navy-100 bg-white sm:flex-row sm:items-center dark:border-zinc-800 dark:bg-zinc-900 ${
        compact ? "px-5 py-4" : "px-6 py-[22px]"
      }`}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy-500 dark:bg-zinc-800 dark:text-zinc-400">
        <LockIcon size={20} />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[16px] font-bold text-navy-900 dark:text-white">{FEATURE_LABELS[feature]}</h2>
          <span className="rounded-full border border-brand-green/30 px-2.5 py-[3px] text-[11px] font-bold uppercase tracking-[0.06em] text-brand-green-ink dark:border-brand-green/25 dark:text-success-ink">
            Disponible en {plan}
          </span>
        </div>
        <p className="text-[14px] leading-relaxed text-navy-500 dark:text-zinc-400">{description}</p>
      </div>
      <Link href={PLANS_HREF} className={BTN}>
        Pasar a {plan}
      </Link>
    </div>
  );
}
