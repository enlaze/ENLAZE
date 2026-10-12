// Real store -> real PostgREST -> private, disposable PostgreSQL 17.
// The only replacement is TIME inside this owned cluster; production SQL,
// subscriptions, stripe_events, RLS, paywall and RPC callers stay real.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import Stripe from "stripe";
import { startBillingBench } from "./lib/billing-webhook-bench.mjs";
import { BILLING_GRACE_DAYS, planCatalogRows } from "../lib/plans.ts";

const mutant = process.env.BILLING_GRACE_MUTANT;
assert.ok(!mutant || /^[a-z-]+$/.test(mutant));
const ROOT = new URL("../", import.meta.url);
const sourceRoot = mutant ? new URL(`.test-out/billing-grace-mutants/${mutant}/`, ROOT) : ROOT;
const { createSupabaseBillingStore, handleStripeWebhook } = await import(new URL("lib/billing-webhook.ts", sourceRoot));
const migrationPath = "supabase/migrations/20261012170000_billing_payment_grace.sql";
const migration = await readFile(new URL(migrationPath, sourceRoot), "utf8");
const checks = await readFile(new URL("docs/fase2/CHECKS.sql", ROOT), "utf8");
const rollbacks = await readFile(new URL("docs/fase2/ROLLBACK.sql", ROOT), "utf8");
const block = (text, name) => text.split(`-- BEGIN ${name}\n`)[1].split(`-- END ${name}`)[0];
const precheck = block(checks, "CHECK_BILLING_GRACE_PRECHECK");
const audit = block(checks, "CHECK_BILLING_GRACE_AUDIT");
const rollback = block(rollbacks, "ROLLBACK_BILLING_GRACE");
const userId = "11111111-1111-4111-8111-111111111111";
const legacyId = "22222222-2222-4222-8222-222222222222";
const subscriptionId = "sub_grace_disposable";
const customerId = "cus_grace_disposable";
const start = Date.parse("2030-10-12T01:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const firstEnd = start + 5 * day; // Spec independently of the implementation constant.
const SECRET = "whsec_grace_synthetic_local_only";
const stripe = new Stripe("sk_test_grace_synthetic_local_only", {
  httpClient: { getClientName: () => "forbidden", makeRequest: () => { throw new Error("Stripe HTTP forbidden"); } },
});
const activeSub = { id: subscriptionId, customer: customerId, status: "active", metadata: { user_id: userId },
  cancel_at_period_end: false, cancel_at: null,
  items: { data: [{ price: { id: "price_grace_local_basico" }, current_period_end: 2000000000 }] } };
// Stripe HTTP is forbidden: only the external subscription response is a fixture.
// No BillingStore or database operation is substituted.
stripe.subscriptions.retrieve = async id => { assert.equal(id, subscriptionId); return activeSub; };
const iso = ms => new Date(ms).toISOString();

function payload(type, id) {
  const object = type === "invoice.payment_failed" ? {
    id: "in_grace_disposable", customer: customerId,
    parent: { subscription_details: { subscription: subscriptionId } },
  } : { ...activeSub, status: type.endsWith("deleted") ? "canceled" : "active" };
  return JSON.stringify({ id, object: "event", type, livemode: false, data: { object } });
}

test("billing grace / real PostgreSQL 17 + real server access", { timeout: 120000 }, async t => {
  let clock = start, beforeRows, auditedSql, beforeCount;
  const bench = await startBillingBench({ beforeRest: async db => {
    for (const row of planCatalogRows()) await db.query(`insert into public.plan_catalog(plan,trial_days,limits,features)
      values($1,$2,$3,$4) on conflict(plan) do update set trial_days=excluded.trial_days,
      limits=excluded.limits,features=excluded.features`, [row.plan, row.trial_days, row.limits, row.features]);
    await db.query("insert into auth.users(id) values($1),($2)", [userId, legacyId]);
    await db.query(`update public.subscriptions set plan='basico',status='active',billing_interval='month',
      stripe_customer_id=$2,stripe_subscription_id=$3 where user_id=$1`, [userId, customerId, subscriptionId]);
    await db.query("update public.subscriptions set plan='basico',status='past_due' where user_id=$1", [legacyId]);
    beforeRows = (await db.query("select to_jsonb(s) as row from public.subscriptions s order by user_id")).rows;
    await db.query(`create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key);
      grant insert on public.clients to authenticated;
      create table billing_bench.clock(instant timestamptz not null);
      insert into billing_bench.clock values('2030-10-12T01:00:00Z');
      -- Safe ONLY after the helper verified ownership of the entire disposable cluster.
      -- Replace the clock, not the permission function, so its real body is exercised.
      -- Built-in OIDs use the C fast path even after CREATE OR REPLACE.
      -- Rename, then create a new OID; existing defaults keep their original clock.
      alter function pg_catalog.now() rename to billing_bench_original_now;
      create function pg_catalog.now() returns timestamptz
        language sql stable security definer set search_path='' as $$
          select instant from billing_bench.clock $$;`);
    const pre = (await db.query(precheck)).rows[0];
    assert.equal(pre.veredicto, "OK", JSON.stringify(pre));
    beforeCount = Number(pre.subscriptions_precheck);
    auditedSql = audit.replace("-1::bigint as subscriptions_precheck", `${beforeCount}::bigint as subscriptions_precheck`);
    assert.match((await db.query(auditedSql)).rows[0].veredicto, /^ABORTAR/, "audit must refuse unapplied schema");
    assert.doesNotMatch(migration, /^\s*(?:begin|commit)\s*;/im, "no top-level transaction control");
    assert.doesNotMatch(rollback, /^\s*(?:begin|commit)\s*;/im);
    await db.query("begin");
    try {
      await db.query(migration);
      await db.query("insert into supabase_migrations.schema_migrations values('20261012170000')");
      await db.query("commit");
    } catch (error) { await db.query("rollback"); throw error; }
  } });
  t.after(bench.close);
  const { db, admin } = bench;
  const localEnv = { NEXT_PUBLIC_SUPABASE_URL: bench.origin, SUPABASE_SERVICE_ROLE_KEY: bench.jwt,
    STRIPE_PRICE_BASICO_MONTHLY: "price_grace_local_basico" };
  for (const [key, value] of Object.entries(localEnv)) {
    assert.equal(process.env[key], undefined, `Refusing existing ${key}`);
    process.env[key] = value;
  }
  t.after(() => { for (const key of Object.keys(localEnv)) delete process.env[key]; });
  // Import and call the REAL server adapter, with its cached service-role client
  // pointed only at the bench; global fetch forbids every other destination.
  const { getAccessLevel, requireWriteAccess } = await import("../lib/subscription.ts");
  const store = createSupabaseBillingStore(admin());
  const setClock = async value => { clock = value; await db.query("update billing_bench.clock set instant=$1", [iso(value)]);
    assert.equal((await db.query("select now() as instant")).rows[0].instant.toISOString(), iso(value), "SQL fixed clock");
  };
  const row = async (id = userId) => (await db.query("select * from public.subscriptions where user_id=$1", [id])).rows[0];
  const deadline = async () => (await row()).past_due_grace_ends_at?.toISOString() ?? null;
  const deliver = async (type, id) => {
    const raw = payload(type, id);
    const result = await handleStripeWebhook(raw, stripe.webhooks.generateTestHeaderString({ payload: raw, secret: SECRET }),
      { stripe, secret: SECRET, store, now: () => clock });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.body.outcome, "applied");
    assert.ok((await db.query("select processed_at from public.stripe_events where id=$1", [id])).rows[0].processed_at);
  };
  const access = async (expected, id = userId) => {
    assert.equal((await db.query("select billing_internal.access_level($1) as access", [id])).rows[0].access, expected, "SQL access");
    assert.equal(await getAccessLevel(id), expected, "lib/subscription.ts real RPC");
    const response = await requireWriteAccess(id);
    assert.equal(response?.status ?? null, expected === "full" ? null : 402, "server write gate");
    const { data, error } = await admin().rpc("billing_usage_summary", { p_user_id: id });
    assert.equal(error, null);
    assert.equal(data.access_level, expected, "browser summary must match the server");
    // Browser direct writes: run with the real JWT claims and authenticated role.
    await db.query("begin");
    try {
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
      await db.query("set local role authenticated");
      const write = () => db.query("insert into public.clients(id,user_id) values('33333333-3333-4333-8333-333333333333',$1)", [id]);
      if (expected === "full") await write();
      else await assert.rejects(write, error => error.code === "PT402" && JSON.parse(error.detail).reason === "read_only");
    } finally { await db.query("rollback"); }
  };

  await t.test("migration gates: no backfill, no permission drift, fail closed", { skip: !!mutant }, async () => {
    assert.deepEqual((await db.query("select to_jsonb(s)-'past_due_grace_ends_at' as row from public.subscriptions s order by user_id")).rows, beforeRows);
    assert.equal(await deadline(), null);
    assert.equal((await db.query(auditedSql)).rows[0].veredicto, "OK");
    assert.match((await db.query(precheck)).rows[0].veredicto, /^ABORTAR/);
    await db.query("begin");
    try { await assert.rejects(() => db.query(migration), /precheck incompatible/); }
    finally { await db.query("rollback"); }
    for (const change of [
      "alter table public.subscriptions alter column past_due_grace_ends_at set default now()",
      "alter table public.subscriptions disable trigger trg_preserve_past_due_grace",
      "grant execute on function billing_internal.preserve_past_due_grace() to authenticated",
      "grant update on public.subscriptions to authenticated",
    ]) {
      await db.query("begin");
      try { await db.query(change); assert.match((await db.query(auditedSql)).rows[0].veredicto, /^ABORTAR/, change); }
      finally { await db.query("rollback"); }
    }
    assert.match((await db.query(audit)).rows[0].veredicto, /^ABORTAR/, "audit requires precheck count");
  });
  await t.test("first failure opens exactly five days; five retries never move the deadline", async () => {
    assert.equal(BILLING_GRACE_DAYS, 5);
    for (const [i, elapsed] of [0, 3600000, 2*day, 3*day, 4*day].entries()) {
      await setClock(start + elapsed);
      await deliver("invoice.payment_failed", `evt_grace_retry_${i}`);
      const subscription = await row();
      assert.equal(subscription.status, "past_due");
      assert.equal(subscription.plan, "basico");
      assert.equal(await deadline(), iso(firstEnd), `retry ${i} must preserve the FIRST deadline`);
      await access("full");
    }
  });
  await t.test("duplicate delivery cannot reapply the failure after recovery", async () => {
    await deliver("customer.subscription.updated", "evt_grace_duplicate_recovery");
    const before = await row();
    const raw = payload("invoice.payment_failed", "evt_grace_retry_0");
    const result = await handleStripeWebhook(raw, stripe.webhooks.generateTestHeaderString({ payload: raw, secret: SECRET }),
      { stripe, secret: SECRET, store, now: () => clock });
    assert.equal(result.body.duplicate, true);
    assert.deepEqual(await row(), before);
  });
  await t.test("boundary: full minus 1ms, read_only at equality and plus 1ms", async () => {
    await setClock(start);
    await deliver("invoice.payment_failed", "evt_grace_boundary");
    for (const [offset, expected] of [[-1,"full"],[0,"read_only"],[1,"read_only"]]) {
      await setClock(firstEnd + offset);
      await access(expected);
      assert.equal((await row()).status, "past_due", "time derives permission without flipping stored status");
      assert.equal(await deadline(), iso(firstEnd));
    }
  });
  await t.test("active recovery clears deadline and restores full access", async () => {
    await setClock(firstEnd - day);
    await deliver("customer.subscription.updated", "evt_grace_recovered");
    assert.equal((await row()).status, "active");
    assert.equal(await deadline(), null, "recovered payment must leave no stale grace date");
    await access("full");
  });
  await t.test("later second failure opens a NEW five-day grace", async () => {
    const secondStart = firstEnd + 2 * day;
    await setClock(secondStart);
    await deliver("invoice.payment_failed", "evt_grace_second_failure");
    assert.equal(await deadline(), iso(secondStart + 5 * day));
    assert.notEqual(await deadline(), iso(firstEnd));
    await access("full");
  });
  await t.test("legacy past_due with NULL has no grace and remains read_only", async () => {
    assert.equal((await row(legacyId)).past_due_grace_ends_at, null);
    await access("read_only", legacyId);
  });
  await t.test("deleted subscription cuts immediately even inside grace", async () => {
    assert.equal((await row()).status, "past_due");
    await access("full");
    await deliver("customer.subscription.deleted", "evt_grace_deleted");
    assert.equal((await row()).status, "canceled");
    assert.equal(await deadline(), null);
    await access("read_only");
  });
  await t.test("concurrent subscription writes keep one initial deadline", async () => {
    await deliver("customer.subscription.updated", "evt_grace_concurrent_recovery");
    const holder = new Client(bench.dbConfig);
    await holder.connect();
    try {
      await holder.query("begin");
      // First writer owns the row; the actual store's HTTP update must wait.
      await holder.query("update public.subscriptions set status='past_due',past_due_grace_ends_at=$2 where user_id=$1", [userId, iso(firstEnd)]);
      const later = store.updateSubscription({ subscriptionId }, { status: "past_due", past_due_grace_ends_at: iso(firstEnd + day) });
      // Deterministic barrier: don't commit until PostgreSQL reports the waiter.
      let blocked = false;
      for (let i=0;i<100;i++) {
        blocked = (await db.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid()) as blocked")).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(blocked, "second real store update must be blocked behind first writer");
      await holder.query("commit");
      await later;
      assert.equal(await deadline(), iso(firstEnd), "the waiting update must recheck the committed first deadline");
    } finally { await holder.query("rollback"); await holder.end(); }
  });
  await t.test("rollback requires acknowledgement and restores old access and schema", { skip: !!mutant }, async () => {
    await setClock(firstEnd - 1);
    await access("full");
    const rollbackRows = (await db.query("select to_jsonb(s)-'past_due_grace_ends_at' as row from public.subscriptions s order by user_id")).rows;
    await db.query("begin");
    try { await assert.rejects(() => db.query(rollback), /acknowledgement/); }
    finally { await db.query("rollback"); }
    await db.query("begin");
    try {
      await db.query("select set_config('enlaze.allow_billing_grace_rollback','remove_payment_grace',true)");
      await db.query(rollback);
      assert.equal((await db.query("select to_regprocedure('billing_internal.preserve_past_due_grace()') as f")).rows[0].f, null);
      assert.equal((await db.query("select exists(select 1 from pg_attribute where attrelid='public.subscriptions'::regclass and attname='past_due_grace_ends_at' and not attisdropped) as present")).rows[0].present, false);
      assert.equal((await db.query("select billing_internal.access_level($1) as access", [userId])).rows[0].access, "read_only");
      assert.equal((await db.query("select count(*)::int as n from public.subscriptions")).rows[0].n, beforeCount);
      assert.deepEqual((await db.query("select to_jsonb(s) as row from public.subscriptions s order by user_id")).rows, rollbackRows, "rollback preserves every other stored field");
      await db.query("delete from supabase_migrations.schema_migrations where version='20261012170000'");
      assert.equal((await db.query(precheck)).rows[0].veredicto, "OK");
    } finally { await db.query("rollback"); }
  });
});
