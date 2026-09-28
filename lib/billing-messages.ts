/**
 * Frases que ve el usuario cuando el muro de pago le para.
 *
 * Las usan el servidor (el `error` del 402 de las rutas) y el navegador (el
 * PT402 del trigger cuando se escribe directo contra Supabase), así que un
 * bloqueo se explica igual venga de donde venga. Todo sale de lib/plans.ts.
 */

import {
  FEATURES,
  FEATURE_LABELS,
  LIMITED_RESOURCES,
  PLAN_IDS,
  PLAN_LABELS,
  RESOURCE_LABELS,
  cheapestPlanWith,
  type Feature,
  type LimitedResource,
  type PlanId,
} from "@/lib/plans";

export type BlockReason = "read_only" | "feature" | "limit";

/** Lo mínimo que hace falta para explicar un bloqueo. */
export interface BillingBlockInfo {
  reason: BlockReason | null;
  plan?: PlanId | null;
  status?: string | null;
  resource?: LimitedResource | null;
  feature?: Feature | null;
  used?: number | null;
  limit?: number | null;
  period?: "stock" | "month" | "trial" | null;
}

export function blockMessage(d: BillingBlockInfo): string {
  if (d.reason === "read_only") {
    return `${readOnlyCause(d.status)} Puedes ver y exportar tus datos. ${readOnlyNextStep(d.status)}`;
  }
  if (d.reason === "feature" && d.feature) {
    const plan = d.plan ? PLAN_LABELS[d.plan] : "tuyo";
    return `${FEATURE_LABELS[d.feature]} no entra en el plan ${plan}. Lo tienes en el plan ${PLAN_LABELS[cheapestPlanWith(d.feature)]}.`;
  }
  if (d.reason === "limit" && d.resource) {
    const plan = d.plan ? PLAN_LABELS[d.plan] : "tuyo";
    const when = d.period === "month" ? " este mes" : d.period === "trial" ? " durante la prueba" : "";
    const what = RESOURCE_LABELS[d.resource];
    const until = d.period === "month" ? " El mes que viene vuelves a tener cupo, o puedes subir de plan ya." : " Sube de plan para seguir.";
    return `Has llegado al límite de ${d.limit} ${what}${when} del plan ${plan}.${until}`;
  }
  return "Tu plan no permite hacer esto ahora mismo.";
}

/** Por qué la cuenta está en solo lectura, según el estado de la suscripción. */
export function readOnlyCause(status: string | null | undefined): string {
  if (status === "canceled") return "Tu suscripción está cancelada y la cuenta ha pasado a solo lectura.";
  if (status === "past_due") return "No hemos podido cobrar tu suscripción y la cuenta ha pasado a solo lectura.";
  return "Tu prueba ha terminado y la cuenta ha pasado a solo lectura.";
}

export function readOnlyNextStep(status: string | null | undefined): string {
  return status === "past_due"
    ? "Revisa la tarjeta en «Gestionar suscripción» para seguir trabajando."
    : "Elige un plan para seguir trabajando.";
}

/**
 * Lee un bloqueo de lo que devuelva un fallo:
 *  - el error de supabase-js cuando salta el trigger (code 'PT402', y en
 *    `details` el JSON de billing_internal.evaluate),
 *  - el cuerpo JSON de un 402 de nuestras rutas ({ code, billing }).
 * Devuelve null si no es un bloqueo del plan.
 */
export function parseBillingBlock(value: unknown): BillingBlockInfo | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  // Trigger de la base de datos.
  if (v.code === "PT402") {
    let detail: Record<string, unknown> = {};
    if (typeof v.details === "string") {
      try { detail = JSON.parse(v.details) as Record<string, unknown>; } catch { /* sin detalle */ }
    }
    return normalize(detail, { read_only: "read_only", feature: "feature", limit: "limit" });
  }

  // 402 de una ruta de la API.
  if (v.code === "read_only" || v.code === "feature_not_in_plan" || v.code === "plan_limit_reached") {
    const billing = (v.billing && typeof v.billing === "object" ? v.billing : {}) as Record<string, unknown>;
    const reason: BlockReason = v.code === "read_only" ? "read_only" : v.code === "feature_not_in_plan" ? "feature" : "limit";
    return normalize({ ...billing, reason }, { read_only: "read_only", feature: "feature", limit: "limit" });
  }
  return null;
}

function normalize(raw: Record<string, unknown>, reasons: Record<string, BlockReason>): BillingBlockInfo {
  const pick = <T extends string>(list: readonly T[], x: unknown): T | null =>
    typeof x === "string" && (list as readonly string[]).includes(x) ? (x as T) : null;
  const num = (x: unknown) => (typeof x === "number" ? x : null);
  return {
    reason: typeof raw.reason === "string" ? reasons[raw.reason] ?? null : null,
    plan: pick(PLAN_IDS, raw.plan),
    status: typeof raw.status === "string" ? raw.status : null,
    resource: pick(LIMITED_RESOURCES, raw.resource),
    feature: pick(FEATURES, raw.feature),
    used: num(raw.used),
    limit: num(raw.limit),
    period: pick(["stock", "month", "trial"] as const, raw.period),
  };
}
