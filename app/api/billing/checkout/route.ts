import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getServiceRoleClient } from "@/lib/supabase-service-role";
import { getStripe } from "@/lib/stripe";
import { stripePriceId } from "@/lib/stripe-prices";
import { BILLING_INTERVALS, PAID_PLAN_IDS, type BillingInterval, type PaidPlanId } from "@/lib/plans";

/**
 * POST { plan: 'basico'|'profesional'|'empresa', interval: 'month'|'year' }
 * → { url } de una sesión de Stripe Checkout.
 *
 * La suscripción NO se activa aquí: la activa el webhook cuando Stripe
 * confirma el pago (checkout.session.completed).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const plan = body?.plan as PaidPlanId;
  const interval = (body?.interval ?? "month") as BillingInterval;
  if (!PAID_PLAN_IDS.includes(plan) || !BILLING_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: "Plan o periodicidad no válidos" }, { status: 400 });
  }

  const stripe = getStripe();
  const admin = getServiceRoleClient();
  const priceId = stripePriceId(plan, interval);
  if (!stripe || !admin || !priceId) {
    console.error("[billing/checkout] configuración incompleta", { stripe: !!stripe, admin: !!admin, priceId: !!priceId });
    return NextResponse.json({ error: "El pago no está disponible ahora mismo" }, { status: 503 });
  }

  const { data: sub, error: subError } = await admin
    .from("subscriptions")
    .select("status, stripe_customer_id, stripe_subscription_id")
    .eq("user_id", user.id)
    .single();
  if (subError || !sub) {
    console.error("[billing/checkout] sin fila de subscriptions", user.id, subError?.message);
    return NextResponse.json({ error: "No se encontró tu suscripción" }, { status: 500 });
  }

  // Ya paga: los cambios de plan van por el portal, no por un segundo checkout
  // (evita tener dos suscripciones cobrando a la vez).
  if (sub.stripe_subscription_id && (sub.status === "active" || sub.status === "past_due")) {
    return NextResponse.json(
      { error: "Ya tienes una suscripción. Cambia de plan desde el portal de facturación.", code: "use_portal" },
      { status: 409 },
    );
  }

  let customerId = sub.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create(
      { email: user.email ?? undefined, metadata: { user_id: user.id } },
      // Dos clics seguidos no crean dos clientes en Stripe.
      { idempotencyKey: `enlaze-customer-${user.id}` },
    );
    customerId = customer.id;
    const { error } = await admin
      .from("subscriptions")
      .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (error) {
      console.error("[billing/checkout] no se pudo guardar stripe_customer_id", error.message);
      return NextResponse.json({ error: "No se pudo preparar el pago" }, { status: 500 });
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id, plan, interval } },
    metadata: { user_id: user.id, plan, interval },
    integration_identifier: "enlaze-suscripciones-qmxvtrla",
    success_url: `${siteUrl}/dashboard/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/dashboard/settings?billing=cancel`,
  });

  return NextResponse.json({ url: session.url });
}
