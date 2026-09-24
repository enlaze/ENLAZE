/**
 * Muro de pago contra la base de datos REAL (y, si hay servidor, contra las
 * rutas HTTP). Crea un usuario desechable, lo recorre por los estados y lo
 * borra al final.
 *
 *   npm run test:billing-integration
 *
 * Necesita NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (se leen de .env.local). Las pruebas HTTP usan
 * BILLING_TEST_BASE_URL (por defecto http://localhost:3000) y se saltan —
 * avisándolo — si no hay servidor.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import Stripe from "stripe";
import { createSupabaseBillingStore, handleStripeWebhook } from "../lib/billing-webhook.ts";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.BILLING_TEST_BASE_URL || "http://localhost:3000";
if (!URL || !ANON || !SERVICE) throw new Error("Faltan variables de Supabase para la prueba de integración");

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const email = `billing-test-${randomUUID()}@example.com`;
const password = `Pw-${randomUUID()}`;
let userId;
let userClient;

async function setSubscription(patch) {
  const { error } = await admin.from("subscriptions").update(patch).eq("user_id", userId);
  assert.equal(error, null, error?.message);
}
async function getSubscription() {
  const { data, error } = await admin.from("subscriptions").select("*").eq("user_id", userId).single();
  assert.equal(error, null, error?.message);
  return data;
}
async function wipeUserData() {
  await admin.from("clients").delete().eq("user_id", userId);
  await admin.from("usage_events").delete().eq("user_id", userId);
}

before(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(error, null, error?.message);
  userId = data.user.id;
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
  assert.equal(signInError, null, signInError?.message);
});

after(async () => {
  if (!userId) return;
  await admin.from("clients").delete().eq("user_id", userId);
  await admin.from("stripe_events").delete().like("id", "evt_integration_%");
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) console.error("⚠ no se pudo borrar el usuario de prueba", userId, error.message);
});

// ── Alta ────────────────────────────────────────────────────────────────

test("al registrarse se crea su fila en 'trialing' con 5 días de prueba", async () => {
  const sub = await getSubscription();
  assert.equal(sub.status, "trialing");
  assert.equal(sub.plan, "prueba");
  assert.equal(sub.is_internal, false);
  const days = (new Date(sub.trial_ends_at) - new Date(sub.trial_started_at)) / 86_400_000;
  assert.ok(Math.abs(days - 5) < 0.001, `la prueba dura ${days} días`);
});

// ── RLS ─────────────────────────────────────────────────────────────────

test("RLS: el dueño LEE su fila de subscriptions", async () => {
  const { data, error } = await userClient.from("subscriptions").select("user_id, status");
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0].user_id, userId);
});

test("RLS: el usuario NO puede cambiarse el status con la anon key (ni UPDATE, ni UPSERT, ni DELETE)", async () => {
  const upd = await userClient.from("subscriptions").update({ status: "active", plan: "empresa" }).eq("user_id", userId).select();
  assert.ok(upd.error || (upd.data ?? []).length === 0, "el UPDATE no debe afectar a ninguna fila");

  const ups = await userClient.from("subscriptions").upsert({ user_id: userId, plan: "empresa", status: "active" });
  assert.ok(ups.error, "el UPSERT debe fallar");

  const del = await userClient.from("subscriptions").delete().eq("user_id", userId).select();
  assert.ok(del.error || (del.data ?? []).length === 0, "el DELETE no debe afectar a ninguna fila");

  const sub = await getSubscription();
  assert.equal(sub.status, "trialing", "el status sigue intacto en la base de datos");
  assert.equal(sub.plan, "prueba");
});

test("RLS: sin escritura en usage_events, plan_catalog ni stripe_events; sin RPC de billing", async () => {
  const usage = await userClient.from("usage_events").insert({ user_id: userId, resource: "clientes", amount: -1000 });
  assert.ok(usage.error, "no puede regalarse cupo");
  const catalog = await userClient.from("plan_catalog").update({ features: [] }).eq("plan", "prueba").select();
  assert.ok(catalog.error || (catalog.data ?? []).length === 0);
  const events = await userClient.from("stripe_events").insert({ id: "evt_integration_forged", type: "x" });
  assert.ok(events.error);
  const rpc = await userClient.rpc("billing_release", { p_user_id: userId, p_resource: "whatsapp", p_amount: 1000 });
  assert.ok(rpc.error, "billing_release solo para service_role");
});

// ── Límites (plan de prueba) ────────────────────────────────────────────

test("prueba: el décimo cliente entra y el undécimo se rechaza con 402 y mensaje claro", async () => {
  await wipeUserData();
  for (let i = 1; i <= 10; i++) {
    const { error, status } = await userClient.from("clients").insert({ user_id: userId, name: `Cliente ${i}` });
    assert.equal(error, null, `el cliente ${i} debería entrar: ${error?.message}`);
    assert.equal(status, 201);
  }
  const eleventh = await userClient.from("clients").insert({ user_id: userId, name: "Cliente 11" });
  assert.equal(eleventh.status, 402);
  assert.equal(eleventh.error.code, "PT402");
  assert.match(eleventh.error.message, /límite/);
  assert.match(eleventh.error.message, /10 de 10 clientes/);

  const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("user_id", userId);
  assert.equal(count, 10);
});

test("clientes es un stock: borrar uno libera hueco", async () => {
  const { data } = await admin.from("clients").select("id").eq("user_id", userId).limit(1);
  const del = await userClient.from("clients").delete().eq("id", data[0].id);
  assert.equal(del.error, null);
  const again = await userClient.from("clients").insert({ user_id: userId, name: "Cliente 11 bis" });
  assert.equal(again.error, null, again.error?.message);
});

test("lote de clientes en una sola sentencia: no se cuela por encima del límite", async () => {
  await wipeUserData();
  const rows = Array.from({ length: 12 }, (_, i) => ({ user_id: userId, name: `Lote ${i}` }));
  const res = await userClient.from("clients").insert(rows);
  assert.equal(res.status, 402);
  const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("user_id", userId);
  assert.equal(count, 0, "la sentencia entera se revierte");
});

test("ventana (WhatsApp): 20 en la prueba y el 21 se rechaza; lo reservado y fallido se devuelve", async () => {
  await wipeUserData();
  const ok = await admin.rpc("billing_consume", { p_user_id: userId, p_resource: "whatsapp", p_amount: 20 });
  assert.equal(ok.data.ok, true);
  const over = await admin.rpc("billing_consume", { p_user_id: userId, p_resource: "whatsapp", p_amount: 1 });
  assert.equal(over.data.ok, false);
  assert.equal(over.data.reason, "limit");
  assert.equal(over.data.used, 20);
  await admin.rpc("billing_release", { p_user_id: userId, p_resource: "whatsapp", p_amount: 1 });
  const again = await admin.rpc("billing_consume", { p_user_id: userId, p_resource: "whatsapp", p_amount: 1 });
  assert.equal(again.data.ok, true);
});

// ── Funciones por plan ──────────────────────────────────────────────────

test("funciones: básico no programa envíos (trigger 402); la prueba sí tiene la función", async () => {
  const prueba = await admin.rpc("billing_check", { p_user_id: userId, p_feature: "programacion_envios" });
  assert.equal(prueba.data.ok, true);

  await setSubscription({ plan: "basico", status: "active" });
  const basico = await admin.rpc("billing_check", { p_user_id: userId, p_feature: "programacion_envios" });
  assert.equal(basico.data.ok, false);
  assert.equal(basico.data.reason, "feature");
  const briefing = await admin.rpc("billing_check", { p_user_id: userId, p_feature: "briefing_diario" });
  assert.equal(briefing.data.reason, "feature");
  const firma = await admin.rpc("billing_check", { p_user_id: userId, p_feature: "firma" });
  assert.equal(firma.data.ok, true);

  const insert = await userClient.from("scheduled_messages").insert({
    user_id: userId, channel: "whatsapp", body: "hola", schedule_type: "once",
  });
  assert.equal(insert.status, 402);
  assert.equal(insert.error.code, "PT402");

  await setSubscription({ plan: "prueba", status: "trialing" });
});

// ── Solo lectura ────────────────────────────────────────────────────────

test("prueba caducada → solo lectura: no crea ni edita (402), pero LEE y BORRA", async () => {
  await wipeUserData();
  const seed = await userClient.from("clients").insert({ user_id: userId, name: "Antes de caducar" }).select("id").single();
  assert.equal(seed.error, null);

  await setSubscription({ trial_ends_at: new Date(Date.now() - 60_000).toISOString() });

  const create = await userClient.from("clients").insert({ user_id: userId, name: "Después" });
  assert.equal(create.status, 402);
  assert.match(create.error.message, /solo lectura/);

  const edit = await userClient.from("clients").update({ name: "Editado" }).eq("id", seed.data.id);
  assert.equal(edit.status, 402);

  const read = await userClient.from("clients").select("id, name");
  assert.equal(read.error, null);
  assert.equal(read.status, 200);
  assert.equal(read.data.length, 1);

  const del = await userClient.from("clients").delete().eq("id", seed.data.id);
  assert.equal(del.error, null, "borrar sus datos siempre se permite");
});

// ── HTTP: 402 en escritura, 200 en lectura ──────────────────────────────

async function sessionCookieHeader() {
  const jar = new Map();
  const ssr = createServerClient(URL, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await ssr.auth.signInWithPassword({ email, password });
  assert.equal(error, null);
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function serverUp() {
  try {
    await fetch(BASE_URL, { method: "HEAD", signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

test("HTTP (solo lectura): rutas de escritura → 402; lectura y exportación → 200", async (t) => {
  if (!(await serverUp())) {
    t.skip(`No hay servidor en ${BASE_URL}: arranca \`npm run dev\` para esta parte. NO se ha comprobado.`);
    return;
  }
  await setSubscription({ plan: "prueba", status: "trialing", trial_ends_at: new Date(Date.now() - 60_000).toISOString() });
  const cookie = await sessionCookieHeader();
  const post = (path, body) =>
    fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify(body),
    });

  const wa = await post("/api/whatsapp/send", { to: "+34600000000", message: "hola" });
  assert.equal(wa.status, 402, `whatsapp/send respondió ${wa.status}`);
  const waBody = await wa.json();
  assert.equal(waBody.code, "read_only");
  assert.match(waBody.error, /solo lectura/);

  const sched = await post("/api/scheduled-messages", {});
  assert.equal(sched.status, 402, `scheduled-messages respondió ${sched.status}`);

  const ai = await post("/api/generate-budget", { description: "reforma de baño" });
  assert.equal(ai.status, 402, `generate-budget respondió ${ai.status}`);

  const read = await fetch(`${BASE_URL}/api/search?q=cliente`, { headers: { cookie } });
  assert.equal(read.status, 200, `search respondió ${read.status}`);

  const exportCsv = await fetch(`${BASE_URL}/api/contabilidad/download?year=2026&quarter=Q3`, { headers: { cookie } });
  assert.notEqual(exportCsv.status, 402, "exportar nunca se bloquea por el plan");
});

test("HTTP (función fuera del plan): básico → briefing diario 402", async (t) => {
  if (!(await serverUp())) {
    t.skip(`No hay servidor en ${BASE_URL}. NO se ha comprobado.`);
    return;
  }
  await setSubscription({ plan: "basico", status: "active" });
  const cookie = await sessionCookieHeader();
  const res = await fetch(`${BASE_URL}/api/agent/daily-briefing`, { headers: { cookie } });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).code, "feature_not_in_plan");
  await setSubscription({ plan: "prueba", status: "trialing" });
});

// ── n8n: el agente solo se ejecuta para cuentas con briefing ────────────

test("n8n (agent_eligible_users): solo cuentas con el briefing en su plan y acceso completo", async () => {
  const { error: pErr } = await admin
    .from("profiles")
    .update({ agent_enabled: true, business_sector: "comercio_local" })
    .eq("id", userId);
  assert.equal(pErr, null, pErr?.message);

  async function eligible() {
    const { data, error } = await admin.rpc("agent_eligible_users", { p_sector: "comercio_local", p_inactive_days: 0 });
    assert.equal(error, null, error?.message);
    return data.some((u) => u.user_id === userId);
  }

  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  await setSubscription({ plan: "prueba", status: "trialing", trial_ends_at: future });
  assert.equal(await eligible(), true, "prueba en curso → sí");

  await setSubscription({ plan: "basico", status: "active" });
  assert.equal(await eligible(), false, "básico → NO (no tiene briefing)");

  await setSubscription({ plan: "profesional", status: "active" });
  assert.equal(await eligible(), true, "profesional → sí");

  await setSubscription({ plan: "profesional", status: "past_due" });
  assert.equal(await eligible(), false, "impago → NO");

  await setSubscription({ plan: "prueba", status: "trialing", trial_ends_at: past });
  assert.equal(await eligible(), false, "prueba caducada → NO");

  const anonCall = await createClient(URL, ANON, { auth: { persistSession: false } })
    .rpc("agent_eligible_users", { p_sector: "comercio_local", p_inactive_days: 0 });
  assert.ok(anonCall.error, "la lista de cuentas no es pública");
});

// ── Webhook contra la tabla real stripe_events ──────────────────────────

test("webhook con la tabla real: evento repetido → se aplica una sola vez", async () => {
  const secret = "whsec_integration_only";
  const stripe = new Stripe("sk_test_integration_only_not_a_real_key");
  const subId = `sub_integration_${randomUUID()}`;
  const cusId = `cus_integration_${randomUUID()}`;
  await setSubscription({ plan: "basico", status: "active", stripe_subscription_id: subId, stripe_customer_id: cusId });

  const eventId = `evt_integration_${randomUUID()}`;
  const payload = JSON.stringify({
    id: eventId, object: "event", type: "invoice.payment_failed", created: Math.floor(Date.now() / 1000),
    data: { object: { id: "in_integration", object: "invoice", customer: cusId,
      parent: { type: "subscription_details", subscription_details: { subscription: subId } } } },
  });
  const header = () => stripe.webhooks.generateTestHeaderString({ payload, secret });
  const deps = { stripe, secret, store: createSupabaseBillingStore(admin) };

  const first = await handleStripeWebhook(payload, header(), deps);
  assert.equal(first.status, 200);
  assert.equal((await getSubscription()).status, "past_due");

  // Si el segundo envío se reprocesara, volvería a poner past_due.
  await setSubscription({ status: "active" });
  const second = await handleStripeWebhook(payload, header(), deps);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal((await getSubscription()).status, "active", "el evento repetido no se ha vuelto a aplicar");

  const { data } = await admin.from("stripe_events").select("id, processed_at").eq("id", eventId);
  assert.equal(data.length, 1);
  assert.ok(data[0].processed_at);

  const bad = await handleStripeWebhook(payload, stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_mal" }), deps);
  assert.equal(bad.status, 400);
});
