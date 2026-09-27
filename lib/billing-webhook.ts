/**
 * Lógica del webhook de Stripe, separada de la ruta para poder probarla sin
 * Next (sin cookies ni `server-only`). La ruta app/api/billing/webhook solo
 * lee el cuerpo crudo y la cabecera, y llama a handleStripeWebhook.
 */
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planForStripePrice } from "./stripe-prices";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface SubscriptionPatch {
  plan?: string;
  status?: SubscriptionStatus;
  billing_interval?: "month" | "year";
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
}

/** Dónde encontrar la fila: por usuario (checkout) o por ids de Stripe (resto). */
export interface SubscriptionTarget {
  userId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
}

export interface BillingStore {
  /** 'new' = procésalo; 'duplicate' = ya aplicado; 'in_progress' = otra entrega lo está procesando. */
  claimEvent(id: string, type: string): Promise<"new" | "duplicate" | "in_progress">;
  markProcessed(id: string): Promise<void>;
  /** Libera un evento cuyo procesamiento falló, para que el reintento de Stripe lo vuelva a aplicar. */
  releaseEvent(id: string): Promise<void>;
  /** Aplica el cambio; lanza si no encuentra la fila. */
  updateSubscription(target: SubscriptionTarget, patch: SubscriptionPatch): Promise<void>;
}

export interface WebhookDeps {
  stripe: Stripe | null;
  secret: string | undefined;
  store: BillingStore;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Estado de Stripe → estado de Enlaze. null = no tocar (pago inicial aún sin completar). */
export function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus | null {
  switch (status) {
    case "active":
    case "trialing": // no usamos pruebas de Stripe; si llegara una, cuenta como pagada
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default: // incomplete: el primer cobro está pendiente (p. ej. 3D Secure)
      return null;
  }
}

/** Traduce una suscripción de Stripe al cambio que hay que guardar. */
export function patchFromSubscription(sub: Stripe.Subscription): SubscriptionPatch {
  const item = sub.items.data[0];
  const patch: SubscriptionPatch = {
    stripe_subscription_id: sub.id,
    stripe_customer_id: idOf(sub.customer) ?? undefined,
    // El portal programa la baja con cancel_at (en el final del periodo) y deja
    // cancel_at_period_end en false: cualquiera de los dos significa que no renueva.
    cancel_at_period_end: sub.cancel_at_period_end || sub.cancel_at != null,
  };

  const status = mapStripeStatus(sub.status);
  if (status === null) return patch; // ni plan ni estado hasta que se complete el pago

  const mapped = planForStripePrice(item?.price?.id);
  if (!mapped) {
    // Precio que no está en las variables de entorno: mejor fallar (Stripe
    // reintentará) que guardar un plan equivocado.
    throw new Error(`Price ID desconocido en la suscripción ${sub.id}: ${item?.price?.id ?? "(sin items)"}`);
  }
  patch.plan = mapped.plan;
  patch.billing_interval = mapped.interval;
  patch.status = status;
  patch.current_period_end = item?.current_period_end
    ? new Date(item.current_period_end * 1000).toISOString()
    : null;
  return patch;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription ?? null);
}

async function applyEvent(event: Stripe.Event, deps: WebhookDeps & { stripe: Stripe }) {
  const { stripe, store } = deps;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") return "ignored";
      const userId = session.client_reference_id ?? session.metadata?.user_id ?? null;
      const subscriptionId = idOf(session.subscription);
      if (!userId || !subscriptionId) {
        console.warn(`[billing] checkout ${session.id} sin usuario o sin suscripción; se ignora`);
        return "ignored";
      }
      // Se lee la suscripción fresca: no depende del orden en que lleguen los eventos.
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      await store.updateSubscription({ userId }, patchFromSubscription(sub));
      return "applied";
    }

    case "customer.subscription.updated": {
      const sub = await stripe.subscriptions.retrieve(event.data.object.id);
      await store.updateSubscription(
        { subscriptionId: sub.id, customerId: idOf(sub.customer), userId: sub.metadata?.user_id },
        patchFromSubscription(sub),
      );
      return "applied";
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object;
      await store.updateSubscription(
        { subscriptionId: sub.id, customerId: idOf(sub.customer), userId: sub.metadata?.user_id },
        { status: "canceled", cancel_at_period_end: false, stripe_subscription_id: sub.id },
      );
      return "applied";
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subscriptionId = invoiceSubscriptionId(invoice);
      if (!subscriptionId) return "ignored"; // factura suelta, no de suscripción
      await store.updateSubscription(
        { subscriptionId, customerId: idOf(invoice.customer) },
        { status: "past_due" },
      );
      return "applied";
    }

    default:
      return "ignored";
  }
}

export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
  deps: WebhookDeps,
): Promise<WebhookResult> {
  // Sin secreto no se procesa NADA. Sin valor por defecto, a propósito.
  if (!deps.secret) {
    console.error("[billing] STRIPE_WEBHOOK_SECRET no está definida: webhook desactivado");
    return { status: 500, body: { error: "Webhook no configurado" } };
  }
  if (!deps.stripe) {
    console.error("[billing] STRIPE_SECRET_KEY no está definida (o es una clave real sin STRIPE_LIVE_MODE=1)");
    return { status: 500, body: { error: "Stripe no configurado" } };
  }
  if (!signature) return { status: 400, body: { error: "Falta la firma" } };

  let event: Stripe.Event;
  try {
    event = deps.stripe.webhooks.constructEvent(rawBody, signature, deps.secret);
  } catch {
    return { status: 400, body: { error: "Firma no válida" } };
  }

  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) {
    return { status: 200, body: { received: true, ignored: event.type } };
  }

  const claim = await deps.store.claimEvent(event.id, event.type);
  if (claim === "duplicate") return { status: 200, body: { received: true, duplicate: true } };
  if (claim === "in_progress") {
    // Otra entrega del mismo evento está en curso: que Stripe reintente luego.
    return { status: 409, body: { error: "Evento en proceso" } };
  }

  try {
    const outcome = await applyEvent(event, { ...deps, stripe: deps.stripe });
    await deps.store.markProcessed(event.id);
    return { status: 200, body: { received: true, outcome } };
  } catch (e) {
    console.error(`[billing] fallo procesando ${event.type} ${event.id}:`, e);
    await deps.store.releaseEvent(event.id);
    return { status: 500, body: { error: "Fallo procesando el evento" } };
  }
}

// ── Almacén real: Supabase con service_role ─────────────────────────────

/** Tras este tiempo, un evento "en curso" se da por abandonado y se puede reprocesar. */
const STALE_CLAIM_MS = 5 * 60 * 1000;

export function createSupabaseBillingStore(admin: SupabaseClient): BillingStore {
  return {
    async claimEvent(id, type) {
      const { error } = await admin.from("stripe_events").insert({ id, type });
      if (!error) return "new";
      if (error.code !== "23505") throw new Error(`stripe_events: ${error.message}`);

      const { data, error: readError } = await admin
        .from("stripe_events")
        .select("processed_at, received_at")
        .eq("id", id)
        .single();
      if (readError) throw new Error(`stripe_events: ${readError.message}`);
      if (data.processed_at) return "duplicate";

      // Reclama un intento abandonado (proceso caído sin liberar).
      const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
      const { data: reclaimed, error: reclaimError } = await admin
        .from("stripe_events")
        .update({ received_at: new Date().toISOString() })
        .eq("id", id)
        .is("processed_at", null)
        .lt("received_at", staleBefore)
        .select("id");
      if (reclaimError) throw new Error(`stripe_events: ${reclaimError.message}`);
      return reclaimed && reclaimed.length > 0 ? "new" : "in_progress";
    },

    async markProcessed(id) {
      const { error } = await admin
        .from("stripe_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`stripe_events: ${error.message}`);
    },

    async releaseEvent(id) {
      const { error } = await admin.from("stripe_events").delete().eq("id", id).is("processed_at", null);
      if (error) console.error("[billing] no se pudo liberar el evento", id, error.message);
    },

    async updateSubscription(target, patch) {
      const row = { ...patch, updated_at: new Date().toISOString() };
      // Orden de preferencia: la suscripción de Stripe, el cliente de Stripe, el usuario.
      const attempts: [string, string | null | undefined][] = [
        ["stripe_subscription_id", target.subscriptionId],
        ["stripe_customer_id", target.customerId],
        ["user_id", target.userId],
      ];
      for (const [column, value] of attempts) {
        if (!value) continue;
        const { data, error } = await admin.from("subscriptions").update(row).eq(column, value).select("user_id");
        if (error) throw new Error(`subscriptions: ${error.message}`);
        if (data && data.length > 0) return;
      }
      throw new Error(`No hay fila de subscriptions para ${JSON.stringify(target)}`);
    },
  };
}
