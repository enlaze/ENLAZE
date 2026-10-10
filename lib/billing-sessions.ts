import type Stripe from "stripe";
import type { BillingInterval, PaidPlanId } from "./plans";

/** Parámetros de Checkout, sin llamadas a Stripe ni a la base de datos. */
export function checkoutSessionParams({
  customerId, userId, priceId, plan, interval, siteUrl,
}: {
  customerId: string;
  userId: string;
  priceId: string;
  plan: PaidPlanId;
  interval: BillingInterval;
  siteUrl: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "subscription",
    customer: customerId,
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    // El cliente siempre existe: la ruta lo crea antes si aún no tenía uno.
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true },
    subscription_data: { metadata: { user_id: userId, plan, interval } },
    metadata: { user_id: userId, plan, interval },
    integration_identifier: "enlaze-suscripciones-qmxvtrla",
    success_url: `${siteUrl}/dashboard/settings/plan?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/dashboard/settings/plan?billing=cancel`,
  };
}

/** Stripe habilita la edición fiscal en la configuración del portal. */
export async function ensurePortalTaxConfiguration(
  configurations: Pick<Stripe["billingPortal"]["configurations"], "list" | "update">,
): Promise<string | null> {
  const { data: [configuration] } = await configurations.list({ active: true, is_default: true, limit: 1 });
  if (!configuration) return null;

  const customerUpdate = configuration.features.customer_update;
  const requiredUpdates = ["name", "address", "tax_id"] as const;
  if (!customerUpdate.enabled || requiredUpdates.some((field) => !customerUpdate.allowed_updates.includes(field))) {
    // Ampliar solo customer_update conserva el resto de funciones del portal.
    await configurations.update(configuration.id, {
      features: {
        customer_update: {
          enabled: true,
          allowed_updates: [...new Set([...customerUpdate.allowed_updates, ...requiredUpdates])],
        },
      },
    });
  }
  return configuration.id;
}
