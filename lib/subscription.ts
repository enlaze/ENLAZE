import "server-only";
import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase-service-role";
import {
  FEATURE_LABELS,
  PLAN_LABELS,
  RESOURCE_LABELS,
  planHasFeature,
  type Feature,
  type LimitedResource,
  type PlanId,
} from "@/lib/plans";

/**
 * Muro de pago en servidor.
 *
 * El cálculo vive en UN solo sitio: las funciones de Postgres
 * billing_internal.* (las mismas que usa el trigger trg_billing_guard_write
 * sobre las tablas que se escriben desde el navegador). Aquí solo se llaman
 * por RPC con service_role y se traducen a respuestas 402.
 *
 * Nivel de acceso:
 *   'trialing' y trial_ends_at sin pasar → full
 *   'active'                             → full
 *   todo lo demás                        → read_only
 */

export type AccessLevel = "full" | "read_only";

export interface BillingDecision {
  ok: boolean;
  reason: null | "read_only" | "feature" | "limit";
  access_level: AccessLevel;
  plan: PlanId | null;
  status: string | null;
  resource: LimitedResource | null;
  feature: Feature | null;
  used?: number;
  limit?: number | null;
  period?: "stock" | "month" | "trial";
  message?: string;
}

export class BillingUnavailableError extends Error {}

function admin() {
  const client = getServiceRoleClient();
  if (!client) throw new BillingUnavailableError("Falta SUPABASE_SERVICE_ROLE_KEY: no se puede comprobar la suscripción.");
  return client;
}

async function rpc(fn: string, params: Record<string, unknown>): Promise<BillingDecision> {
  const { data, error } = await admin().rpc(fn, params);
  if (error) throw new BillingUnavailableError(`${fn}: ${error.message}`);
  return data as BillingDecision;
}

export async function getAccessLevel(userId: string): Promise<AccessLevel> {
  return (await rpc("billing_check", { p_user_id: userId, p_resource: null, p_amount: 0 })).access_level;
}

/** Plan actual del usuario (null si no tiene fila de suscripción). */
export async function getPlan(userId: string): Promise<PlanId | null> {
  return (await rpc("billing_check", { p_user_id: userId, p_resource: null, p_amount: 0 })).plan;
}

/**
 * ¿Incluye el plan del usuario esta función? Mira solo el plan, no si la
 * cuenta está en solo lectura (para eso, getAccessLevel / requireWriteAccess).
 */
export async function hasFeature(userId: string, feature: Feature): Promise<boolean> {
  const plan = await getPlan(userId);
  return plan !== null && planHasFeature(plan, feature);
}

/**
 * ¿Puede el usuario usar ahora esta función? Cuenta con acceso completo Y
 * plan que la incluye. Para procesos de sistema (cron, avisos) que actúan en
 * su nombre sin petición suya.
 */
export async function featureActive(userId: string, feature: Feature): Promise<boolean> {
  const d = await rpc("billing_check", { p_user_id: userId, p_resource: null, p_amount: 0, p_feature: feature });
  return d.ok;
}

/** Comprueba sin registrar nada: acceso, función (opcional) y límite. */
export async function checkLimit(
  userId: string,
  resource: LimitedResource,
  amount = 1,
  feature?: Feature,
): Promise<BillingDecision> {
  return rpc("billing_check", { p_user_id: userId, p_resource: resource, p_amount: amount, p_feature: feature ?? null });
}

/**
 * Comprueba y, si cabe, RESERVA el cupo en la misma transacción (con bloqueo
 * por usuario y recurso: dos peticiones simultáneas no se cuelan las dos).
 * Si luego la operación falla, devuélvelo con releaseUsage.
 */
export async function consumeUsage(
  userId: string,
  resource: LimitedResource,
  amount = 1,
  opts: { feature?: Feature; source?: string } = {},
): Promise<BillingDecision> {
  return rpc("billing_consume", {
    p_user_id: userId,
    p_resource: resource,
    p_amount: amount,
    p_feature: opts.feature ?? null,
    p_source: opts.source ?? null,
  });
}

export async function releaseUsage(userId: string, resource: LimitedResource, amount: number, source?: string) {
  if (amount <= 0) return;
  const { error } = await admin().rpc("billing_release", {
    p_user_id: userId,
    p_resource: resource,
    p_amount: amount,
    p_source: source ?? "release",
  });
  if (error) console.error("[billing] no se pudo devolver cupo:", error.message);
}

// ── Traducción a HTTP ────────────────────────────────────────────────────

/** Mensaje claro para el usuario: qué límite o función ha tocado. */
export function billingMessage(d: BillingDecision): string {
  const plan = d.plan ? PLAN_LABELS[d.plan] : "tu plan";
  if (d.reason === "read_only") {
    return "Tu cuenta está en modo solo lectura: la prueba ha terminado o la suscripción no está activa. "
      + "Puedes consultar y exportar todos tus datos, pero no crear ni enviar nada nuevo.";
  }
  if (d.reason === "feature" && d.feature) {
    return `«${FEATURE_LABELS[d.feature]}» no está incluido en el plan ${plan}.`;
  }
  if (d.reason === "limit" && d.resource) {
    const when = d.period === "month" ? " este mes" : d.period === "trial" ? " durante la prueba" : "";
    return `Has llegado al límite de ${d.limit} ${RESOURCE_LABELS[d.resource]}${when} del plan ${plan} (llevas ${d.used}).`;
  }
  return d.message || "Operación no permitida por tu plan.";
}

export function paymentRequired(d: BillingDecision): NextResponse {
  return NextResponse.json(
    {
      error: billingMessage(d),
      code: d.reason === "read_only" ? "read_only" : d.reason === "feature" ? "feature_not_in_plan" : "plan_limit_reached",
      billing: {
        plan: d.plan,
        status: d.status,
        resource: d.resource,
        feature: d.feature,
        used: d.used,
        limit: d.limit,
        period: d.period,
      },
    },
    { status: 402 },
  );
}

function unavailable(e: unknown): NextResponse {
  console.error("[billing]", e);
  // Si no podemos comprobar la suscripción, no dejamos pasar (fallo cerrado).
  return NextResponse.json({ error: "No se pudo comprobar tu suscripción. Inténtalo de nuevo." }, { status: 503 });
}

/**
 * Guarda para rutas que escriben. Devuelve una respuesta 402/503 si hay que
 * cortar, o null si puede seguir.
 *
 *   const blocked = await requireWriteAccess(user.id);
 *   if (blocked) return blocked;
 */
export async function requireWriteAccess(userId: string, feature?: Feature): Promise<NextResponse | null> {
  try {
    const d = await rpc("billing_check", { p_user_id: userId, p_resource: null, p_amount: 0, p_feature: feature ?? null });
    return d.ok ? null : paymentRequired(d);
  } catch (e) {
    return unavailable(e);
  }
}

/** Solo la función del plan (para lecturas que son la función en sí, p. ej. el briefing). */
export async function requireFeature(userId: string, feature: Feature): Promise<NextResponse | null> {
  try {
    const d = await rpc("billing_check", { p_user_id: userId, p_resource: null, p_amount: 0 });
    if (d.plan && planHasFeature(d.plan, feature)) return null;
    return paymentRequired({ ...d, ok: false, reason: "feature", feature });
  } catch (e) {
    return unavailable(e);
  }
}

/**
 * Reserva cupo antes de hacer algo que cuesta (enviar, llamar a la IA).
 * Devuelve la respuesta 402/503 si no cabe, o null si queda reservado.
 */
export async function reserveUsage(
  userId: string,
  resource: LimitedResource,
  amount = 1,
  opts: { feature?: Feature; source?: string } = {},
): Promise<NextResponse | null> {
  try {
    const d = await consumeUsage(userId, resource, amount, opts);
    return d.ok ? null : paymentRequired(d);
  } catch (e) {
    return unavailable(e);
  }
}
