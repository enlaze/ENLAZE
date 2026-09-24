/**
 * Webhook de Stripe: firma y deduplicación, sin red ni base de datos (almacén
 * en memoria). La deduplicación contra la tabla real stripe_events se prueba
 * en billing.integration.test.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { handleStripeWebhook, mapStripeStatus } from "../lib/billing-webhook.ts";

const SECRET = "whsec_test_unit_only";
// Clave falsa: constructEvent no llama a la red.
const stripe = new Stripe("sk_test_unit_only_not_a_real_key");

function memoryStore() {
  const events = new Map();
  const updates = [];
  let failNextUpdate = false;
  return {
    events,
    updates,
    failOnce() { failNextUpdate = true; },
    async claimEvent(id) {
      const e = events.get(id);
      if (!e) { events.set(id, { processed: false }); return "new"; }
      return e.processed ? "duplicate" : "in_progress";
    },
    async markProcessed(id) { events.get(id).processed = true; },
    async releaseEvent(id) { if (!events.get(id)?.processed) events.delete(id); },
    async updateSubscription(target, patch) {
      if (failNextUpdate) { failNextUpdate = false; throw new Error("fallo simulado"); }
      updates.push({ target, patch });
    },
  };
}

function paymentFailedEvent(id = "evt_test_payment_failed") {
  return JSON.stringify({
    id,
    object: "event",
    type: "invoice.payment_failed",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: "in_test_1",
        object: "invoice",
        customer: "cus_test_1",
        parent: { type: "subscription_details", subscription_details: { subscription: "sub_test_1" } },
      },
    },
  });
}

function sign(payload, secret = SECRET) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret });
}

test("sin STRIPE_WEBHOOK_SECRET: 500 y no procesa nada", async () => {
  const store = memoryStore();
  const body = paymentFailedEvent();
  const res = await handleStripeWebhook(body, sign(body), { stripe, secret: undefined, store });
  assert.equal(res.status, 500);
  assert.equal(store.events.size, 0);
  assert.equal(store.updates.length, 0);
});

test("firma inválida → 400 y no se toca nada", async () => {
  const store = memoryStore();
  const body = paymentFailedEvent();
  const res = await handleStripeWebhook(body, sign(body, "whsec_otro_secreto"), { stripe, secret: SECRET, store });
  assert.equal(res.status, 400);
  assert.equal(store.events.size, 0);
  assert.equal(store.updates.length, 0);
});

test("cuerpo alterado tras firmar → 400", async () => {
  const store = memoryStore();
  const body = paymentFailedEvent();
  const header = sign(body);
  const res = await handleStripeWebhook(body.replace("cus_test_1", "cus_attacker"), header, { stripe, secret: SECRET, store });
  assert.equal(res.status, 400);
  assert.equal(store.updates.length, 0);
});

test("sin cabecera de firma → 400", async () => {
  const store = memoryStore();
  const res = await handleStripeWebhook(paymentFailedEvent(), null, { stripe, secret: SECRET, store });
  assert.equal(res.status, 400);
});

test("evento repetido → se procesa UNA sola vez", async () => {
  const store = memoryStore();
  const body = paymentFailedEvent();
  const first = await handleStripeWebhook(body, sign(body), { stripe, secret: SECRET, store });
  const second = await handleStripeWebhook(body, sign(body), { stripe, secret: SECRET, store });
  assert.equal(first.status, 200);
  assert.equal(first.body.outcome, "applied");
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(store.updates.length, 1);
  assert.deepEqual(store.updates[0], {
    target: { subscriptionId: "sub_test_1", customerId: "cus_test_1" },
    patch: { status: "past_due" },
  });
});

test("si el procesamiento falla, el evento se libera y el reintento de Stripe sí se aplica", async () => {
  const store = memoryStore();
  store.failOnce();
  const body = paymentFailedEvent("evt_test_retry");
  const first = await handleStripeWebhook(body, sign(body), { stripe, secret: SECRET, store });
  assert.equal(first.status, 500);
  assert.equal(store.events.has("evt_test_retry"), false);
  const retry = await handleStripeWebhook(body, sign(body), { stripe, secret: SECRET, store });
  assert.equal(retry.status, 200);
  assert.equal(store.updates.length, 1);
});

test("eventos no gestionados se aceptan sin tocar nada", async () => {
  const store = memoryStore();
  const body = JSON.stringify({ id: "evt_other", object: "event", type: "customer.created", data: { object: {} } });
  const res = await handleStripeWebhook(body, sign(body), { stripe, secret: SECRET, store });
  assert.equal(res.status, 200);
  assert.equal(store.events.size, 0);
});

test("estados de Stripe → estados de Enlaze", () => {
  assert.equal(mapStripeStatus("active"), "active");
  assert.equal(mapStripeStatus("past_due"), "past_due");
  assert.equal(mapStripeStatus("unpaid"), "past_due");
  assert.equal(mapStripeStatus("canceled"), "canceled");
  assert.equal(mapStripeStatus("incomplete_expired"), "canceled");
  assert.equal(mapStripeStatus("incomplete"), null);
});
