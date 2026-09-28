/**
 * Estado del plan tal como lo ve el navegador (lo devuelve /api/billing/status)
 * y las cuentas de fechas que se enseñan con él. Sin dependencias de servidor.
 */

import { parseBillingBlock, type BillingBlockInfo } from "@/lib/billing-messages";
import type { BillingInterval, LimitedResource, LimitPeriod, PlanId } from "@/lib/plans";

export interface UsageLine {
  used: number;
  limit: number | null;
  period: LimitPeriod;
}

export interface BillingStatus {
  plan: PlanId;
  status: "trialing" | "active" | "past_due" | "canceled" | string;
  interval: BillingInterval | null;
  access_level: "full" | "read_only";
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  has_stripe_customer: boolean;
  usage: Partial<Record<LimitedResource, UsageLine>>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Días de prueba que quedan, redondeando hacia arriba (queda «1 día» hasta el final). */
export function trialDaysLeft(s: Pick<BillingStatus, "trial_ends_at">, now = Date.now()): number {
  if (!s.trial_ends_at) return 0;
  return Math.max(0, Math.ceil((new Date(s.trial_ends_at).getTime() - now) / DAY_MS));
}

export function isInTrial(s: BillingStatus): boolean {
  return s.status === "trialing" && s.access_level === "full";
}

/** «25 de octubre de 2026». */
export function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  });
}

export function daysLeftText(days: number): string {
  if (days <= 0) return "Hoy termina tu prueba";
  return days === 1 ? "Te queda 1 día de prueba" : `Te quedan ${days} días de prueba`;
}

/**
 * ¿Es este fallo un bloqueo del plan? Mira el propio error y, si es un
 * envoltorio (BudgetRevisionError y similares), el error original.
 */
export function billingBlockOf(error: unknown): BillingBlockInfo | null {
  const direct = parseBillingBlock(error);
  if (direct) return direct;
  if (error && typeof error === "object" && "original" in error) {
    return parseBillingBlock((error as { original: unknown }).original);
  }
  return null;
}
