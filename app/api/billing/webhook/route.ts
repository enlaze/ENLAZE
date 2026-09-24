import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getServiceRoleClient } from "@/lib/supabase-service-role";
import { createSupabaseBillingStore, handleStripeWebhook } from "@/lib/billing-webhook";

/**
 * Webhook de Stripe. Público en proxy.ts (Stripe no trae sesión): la
 * autenticación es la firma, verificada con STRIPE_WEBHOOK_SECRET.
 * Sin esa variable responde 500 y no procesa nada — sin valor por defecto.
 */
export async function POST(req: NextRequest) {
  // Cuerpo CRUDO: si se parsea como JSON antes de verificar, la firma no cuadra.
  const rawBody = await req.text();

  const admin = getServiceRoleClient();
  if (!admin) {
    console.error("[billing] falta SUPABASE_SERVICE_ROLE_KEY: webhook desactivado");
    return NextResponse.json({ error: "Webhook no configurado" }, { status: 500 });
  }

  const result = await handleStripeWebhook(rawBody, req.headers.get("stripe-signature"), {
    stripe: getStripe(),
    secret: process.env.STRIPE_WEBHOOK_SECRET,
    store: createSupabaseBillingStore(admin),
  });
  return NextResponse.json(result.body, { status: result.status });
}
