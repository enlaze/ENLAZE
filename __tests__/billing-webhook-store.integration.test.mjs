// Real Supabase BillingStore -> real PostgREST -> disposable PostgreSQL 17.
// Stripe is used only for local signature generation/verification; no Stripe HTTP.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import Stripe from "stripe";
import { startBillingBench } from "./lib/billing-webhook-bench.mjs";

const mutant = process.env.BILLING_WEBHOOK_MUTANT;
assert.ok(!mutant || /^[a-z-]+$/.test(mutant), "Invalid local mutation name");
const moduleUrl = mutant
  ? new URL(`../.test-out/billing-webhook-mutants/${mutant}/lib/billing-webhook.ts`, import.meta.url)
  : new URL("../lib/billing-webhook.ts", import.meta.url);
const { createSupabaseBillingStore, handleStripeWebhook } = await import(moduleUrl.href);
const SECRET = "whsec_disposable_billing_regression_only";
const stripe = new Stripe("sk_test_synthetic_billing_regression_only", {
  httpClient: { getClientName: () => "network-forbidden", makeRequest: () => {
    throw new Error("Stripe network is forbidden in this bench");
  } },
});
const userId = "11111111-1111-4111-8111-111111111111";
const customerId = "cus_disposable_billing";
const subscriptionId = "sub_disposable_billing";

function event(type, id) {
  const object = type === "invoice.payment_failed" ? {
    id: "in_disposable_billing", object: "invoice", customer: customerId,
    parent: { type: "subscription_details", subscription_details: { subscription: subscriptionId } },
  } : {
    id: subscriptionId, object: "subscription", customer: customerId,
    metadata: { user_id: userId }, status: "canceled",
  };
  return JSON.stringify({ id, object: "event", type, livemode: false,
    api_version: "2026-08-26.dahlia", data: { object } });
}

test("billing webhook / real PostgreSQL 17 store", { timeout: 120000 }, async t => {
  const bench = await startBillingBench({ beforeRest: async db => {
    await db.query(await readFile(new URL("../supabase/migrations/20261012170000_billing_payment_grace.sql", import.meta.url), "utf8"));
  } });
  t.after(bench.close);
  const { db, admin } = bench;
  const store = createSupabaseBillingStore(admin());
  await db.query("insert into auth.users(id) values($1)", [userId]);
  const resetPlan = async () => db.query(`update public.subscriptions set plan='basico',status='active',
    billing_interval='month',stripe_customer_id=$2,stripe_subscription_id=$3,
    current_period_end='2030-01-01T00:00:00Z',cancel_at_period_end=false,past_due_grace_ends_at=null where user_id=$1`,
  [userId, customerId, subscriptionId]);
  const snapshot = async () => (await db.query(`select to_jsonb(s) as subscription,
    billing_internal.access_level(s.user_id) as access,
    (select count(*)::int from billing_bench.writes where table_name='subscriptions'
      and row_id=s.user_id::text) as writes from public.subscriptions s where user_id=$1`, [userId])).rows[0];
  const eventRow = async id => (await db.query("select * from public.stripe_events where id=$1", [id])).rows[0];
  const eventWrites = async id => (await db.query(`select count(*)::int as n from billing_bench.writes
    where table_name='stripe_events' and row_id=$1`, [id])).rows[0].n;
  const deliver = async (type, id, targetStore = store) => {
    const body = event(type, id);
    return handleStripeWebhook(body, stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET }),
      { stripe, secret: SECRET, store: targetStore });
  };
  const pending = async (id, age) => db.query(`insert into public.stripe_events(id,type,received_at)
    values($1,'invoice.payment_failed',clock_timestamp()-($2 * interval '1 minute'))`, [id, age]);

  await t.test("1 duplicate: new once, duplicate later, no second database write", async () => {
    await resetPlan();
    const before = await snapshot();
    assert.equal(before.access, "full");
    const claims = [];
    const observedStore = createSupabaseBillingStore(admin());
    const claim = observedStore.claimEvent;
    // Observe the real store's result; no database operation is substituted.
    observedStore.claimEvent = async (...args) => { const result = await claim(...args); claims.push(result); return result; };
    const id = "evt_duplicate_billing";
    const first = await deliver("invoice.payment_failed", id, observedStore);
    assert.deepEqual(claims, ["new"]);
    const applied = await snapshot();
    assert.equal(applied.subscription.status, "past_due");
    assert.equal(applied.subscription.plan, "basico");
    assert.equal(applied.access, "full");
    assert.ok(Date.parse(applied.subscription.past_due_grace_ends_at) > Date.now(), "first payment failure opens grace");
    assert.equal(applied.writes, before.writes + 1);
    const processed = await eventRow(id);
    assert.ok(processed.processed_at instanceof Date);
    assert.equal(first.status, 200);
    assert.equal(first.body.outcome, "applied");
    // Independent newer state: replaying the old failed invoice must not undo it.
    await resetPlan();
    const newer = await snapshot();
    const second = await deliver("invoice.payment_failed", id, observedStore);
    assert.deepEqual(await snapshot(), newer, "duplicate must not overwrite the newer active plan or audit trail");
    assert.deepEqual(await eventRow(id), processed, "duplicate must not rewrite processed_at");
    assert.deepEqual(claims, ["new", "duplicate"]);
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(await eventWrites(id), 1);
  });

  await t.test("2 stale: abandoned unprocessed row is reclaimed and refreshed", async () => {
    const id = "evt_abandoned_billing";
    await pending(id, 10);
    const before = await eventRow(id);
    assert.equal(await store.claimEvent(id, "invoice.payment_failed"), "new");
    const after = await eventRow(id);
    assert.ok(after.received_at > before.received_at, "the claim timestamp must actually change in PostgreSQL");
    assert.ok(Date.now() - after.received_at.getTime() < 60000);
    assert.equal(after.processed_at, null);
    assert.equal(await eventWrites(id), 1);
    assert.equal(await store.claimEvent(id, "invoice.payment_failed"), "in_progress");
    assert.deepEqual(await eventRow(id), after);
  });

  await t.test("2 recent: in_progress, 409 delivery, database untouched", async () => {
    await resetPlan();
    const id = "evt_recent_billing";
    await pending(id, 0);
    const before = await eventRow(id), plan = await snapshot();
    assert.equal(await store.claimEvent(id, "invoice.payment_failed"), "in_progress");
    const response = await deliver("invoice.payment_failed", id);
    assert.deepEqual(await snapshot(), plan);
    assert.deepEqual(await eventRow(id), before);
    assert.equal(await eventWrites(id), 0);
    assert.equal(response.status, 409);
  });

  await t.test("2 processed during read: reclamation cannot overwrite a completed event", async () => {
    const id = "evt_completed_during_read";
    await pending(id, 10);
    let completed;
    const raced = createSupabaseBillingStore(admin(async (url, init) => {
      if (init.method === "GET" && url.pathname.endsWith("/stripe_events") && url.searchParams.get("id") === `eq.${id}`) {
        // The real HTTP response contains the older NULL; finish in PostgreSQL
        // before the caller attempts the conditional reclamation UPDATE.
        await store.markProcessed(id);
        completed = await eventRow(id);
      }
    }));
    assert.equal(await raced.claimEvent(id, "invoice.payment_failed"), "in_progress");
    assert.ok(completed.processed_at instanceof Date);
    assert.deepEqual(await eventRow(id), completed);
    assert.equal(await eventWrites(id), 1);
    assert.equal(await store.claimEvent(id, "invoice.payment_failed"), "duplicate");
  });

  await t.test("3 concurrent: two stale readers, exactly one new claim and one SQL update", async () => {
    // Repeat the forced interleaving; never rely on scheduling or sleeps.
    for (let round = 0; round < 10; round++) {
      const id = `evt_concurrent_billing_${round}`;
      await pending(id, 10);
      const before = await eventRow(id);
      let reads = 0, release;
      const barrier = new Promise(resolve => { release = resolve; });
      const synchronize = async (url, init) => {
        if (init.method === "GET" && url.pathname.endsWith("/stripe_events") && url.searchParams.get("id") === `eq.${id}`) {
          if (++reads === 2) release();
          await barrier;
        }
      };
      const a = createSupabaseBillingStore(admin(synchronize));
      const b = createSupabaseBillingStore(admin(synchronize));
      let timer;
      try {
        const result = await Promise.race([
          Promise.all([a.claimEvent(id, "invoice.payment_failed"), b.claimEvent(id, "invoice.payment_failed")]),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("both real stale reads must reach the barrier")), 10000); }),
        ]);
        assert.equal(reads, 2);
        assert.deepEqual(result.sort(), ["in_progress", "new"], `race ${round}: only one winner`);
        assert.equal(await eventWrites(id), 1, `race ${round}: PostgreSQL must update exactly one row once`);
        const after = await eventRow(id);
        assert.ok(after.received_at > before.received_at);
        assert.equal(after.processed_at, null);
      } finally { clearTimeout(timer); release(); }
    }
  });

  await t.test("4 deleted: canceled subscription, retained plan, read-only access", async () => {
    await resetPlan();
    await db.query("update public.subscriptions set cancel_at_period_end=true where user_id=$1", [userId]);
    const before = await snapshot();
    assert.equal(before.access, "full");
    const id = "evt_deleted_billing";
    const response = await deliver("customer.subscription.deleted", id);
    const after = await snapshot();
    assert.equal(after.subscription.status, "canceled");
    assert.equal(after.subscription.plan, "basico");
    assert.equal(after.subscription.cancel_at_period_end, false);
    assert.equal(after.access, "read_only");
    assert.equal(after.writes, before.writes + 1);
    assert.equal(after.subscription.stripe_subscription_id, subscriptionId);
    assert.deepEqual(after.subscription.current_period_end, before.subscription.current_period_end);
    assert.ok((await eventRow(id)).processed_at instanceof Date);
    assert.equal(response.status, 200);
    assert.equal(response.body.outcome, "applied");
  });

  await t.test("4 payment_failed: past_due with grace, no cancellation or plan downgrade", async () => {
    await resetPlan();
    const before = await snapshot();
    assert.equal(before.access, "full");
    const id = "evt_failed_billing";
    const response = await deliver("invoice.payment_failed", id);
    const after = await snapshot();
    assert.equal(after.subscription.status, "past_due");
    assert.equal(after.access, "full");
    assert.ok(Date.parse(after.subscription.past_due_grace_ends_at) > Date.now());
    assert.equal(after.writes, before.writes + 1);
    const stableFields = ["plan", "billing_interval", "current_period_end", "cancel_at_period_end",
      "stripe_subscription_id", "stripe_customer_id"];
    for (const field of stableFields) assert.deepEqual(after.subscription[field], before.subscription[field], field);
    assert.ok((await eventRow(id)).processed_at instanceof Date);
    assert.equal(response.status, 200);
    assert.equal(response.body.outcome, "applied");
  });
});
