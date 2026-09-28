import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getServiceRoleClient } from "@/lib/supabase-service-role";
import type { BillingStatus } from "@/lib/billing-status";

/**
 * GET → el plan del usuario, su estado y el uso del periodo frente a los
 * límites (Ajustes → Plan y facturación y el aviso del dashboard).
 *
 * El uso sale de public.billing_usage_summary, que cuenta con
 * billing_internal.current_usage: los mismos contadores que aplica el muro.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const admin = getServiceRoleClient();
  if (!admin) return NextResponse.json({ error: "No se pudo comprobar tu plan" }, { status: 503 });

  const [{ data: sub, error: subError }, { data: summary, error: sumError }] = await Promise.all([
    admin
      .from("subscriptions")
      .select("plan, status, billing_interval, trial_ends_at, current_period_end, cancel_at_period_end, stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle(),
    admin.rpc("billing_usage_summary", { p_user_id: user.id }),
  ]);
  if (subError || sumError || !sub || !summary) {
    console.error("[billing/status]", subError?.message ?? sumError?.message ?? "sin fila de subscriptions");
    return NextResponse.json({ error: "No se pudo comprobar tu plan" }, { status: 503 });
  }

  const body: BillingStatus = {
    plan: sub.plan,
    status: sub.status,
    interval: sub.billing_interval ?? null,
    access_level: summary.access_level,
    trial_ends_at: sub.trial_ends_at,
    current_period_end: sub.current_period_end,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    has_stripe_customer: !!sub.stripe_customer_id,
    usage: summary.usage,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
