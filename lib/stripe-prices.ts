import {
  BILLING_INTERVALS,
  PAID_PLAN_IDS,
  stripePriceEnvVar,
  type BillingInterval,
  type PaidPlanId,
} from "./plans";

/** Price ID de Stripe para un plan y periodicidad (solo desde variables de entorno). */
export function stripePriceId(plan: PaidPlanId, interval: BillingInterval): string | null {
  return process.env[stripePriceEnvVar(plan, interval)] || null;
}

/** Traduce un price ID de Stripe de vuelta a plan y periodicidad. */
export function planForStripePrice(
  priceId: string | null | undefined,
): { plan: PaidPlanId; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const plan of PAID_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      if (stripePriceId(plan, interval) === priceId) return { plan, interval };
    }
  }
  return null;
}
