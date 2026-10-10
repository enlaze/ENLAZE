import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getServiceRoleClient } from "@/lib/supabase-service-role";
import { getStripe } from "@/lib/stripe";
import { ensurePortalTaxConfiguration } from "@/lib/billing-sessions";

/**
 * POST → { url } del Customer Portal de Stripe, donde el cliente cancela,
 * cambia de plan o actualiza la tarjeta, la dirección y los datos fiscales.
 * Los cambios de suscripción vuelven por webhook
 * (customer.subscription.updated / deleted).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const stripe = getStripe();
  const admin = getServiceRoleClient();
  if (!stripe || !admin) {
    return NextResponse.json({ error: "El portal de facturación no está disponible ahora mismo" }, { status: 503 });
  }

  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .single();
  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: "Todavía no tienes una suscripción de pago", code: "no_customer" }, { status: 404 });
  }

  const configuration = await ensurePortalTaxConfiguration(stripe.billingPortal.configurations);
  if (!configuration) {
    console.error("[billing/portal] falta una configuración predeterminada activa en Stripe");
    return NextResponse.json({ error: "El portal de facturación no está disponible ahora mismo" }, { status: 503 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    configuration,
    return_url: `${siteUrl}/dashboard/settings/plan`,
  });
  return NextResponse.json({ url: session.url });
}
