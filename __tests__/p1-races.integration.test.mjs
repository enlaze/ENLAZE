/**
 * Arreglos P1 de 20260924170000_fix_p1_signature_invoice_deletion_races,
 * contra la base REAL. Crea dos usuarios desechables y lo borra todo al final.
 *
 *   npm run test:p1-races
 *
 * (El nº 4, la carrera con el borrado de cuenta, se comprueba en SQL: que el
 * trigger toma el bloqueo por usuario. Ver el comentario de la migración.)
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) throw new Error("Faltan variables de Supabase");

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const password = `Pw-${randomUUID()}`;
const users = {};

async function makeUser(tag) {
  const email = `p1-${tag}-${randomUUID()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(error, null, error?.message);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await client.auth.signInWithPassword({ email, password });
  assert.equal(s.error, null);
  return { id: data.user.id, client };
}

async function signature(ownerId, status) {
  const { data, error } = await admin
    .from("digital_signatures")
    .insert({ user_id: ownerId, entity_type: "budget", entity_id: randomUUID(), signer_name: "Prueba P1", status, signature_image: "ORIGINAL" })
    .select("id")
    .single();
  assert.equal(error, null, error?.message);
  return data.id;
}

before(async () => {
  users.a = await makeUser("a");
  users.b = await makeUser("b");
});

after(async () => {
  for (const u of Object.values(users)) {
    await admin.from("digital_signatures").delete().eq("user_id", u.id);
    await admin.from("received_invoices").delete().eq("user_id", u.id);
    await admin.from("suppliers").delete().eq("user_id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
});

// ── 1. Firma ya firmada: no se sobrescribe ──────────────────────────────

test("1. save_signature_image_locked NO sobrescribe una firma ya firmada", async () => {
  const id = await signature(users.a.id, "signed");
  const { data, error } = await admin.rpc("save_signature_image_locked", {
    p_signature_id: id, p_signature_image: "PISADA", p_ip_address: "1.2.3.4", p_user_agent: "x",
  });
  assert.equal(error, null, error?.message);
  assert.equal(data.ok, false);
  assert.equal(data.reason, "not_pending");
  const { data: row } = await admin.from("digital_signatures").select("signature_image").eq("id", id).single();
  assert.equal(row.signature_image, "ORIGINAL", "la imagen firmada sigue intacta");
});

test("1. save_signature_image_locked sí guarda una firma pendiente", async () => {
  const id = await signature(users.a.id, "pending");
  const { data } = await admin.rpc("save_signature_image_locked", {
    p_signature_id: id, p_signature_image: "NUEVA", p_ip_address: "", p_user_agent: "",
  });
  assert.equal(data.ok, true);
  const { data: row } = await admin.from("digital_signatures").select("signature_image").eq("id", id).single();
  assert.equal(row.signature_image, "NUEVA");
});

test("1. save_signature_image_locked no es invocable por usuarios ni anónimos", async () => {
  const id = await signature(users.a.id, "pending");
  const r = await users.a.client.rpc("save_signature_image_locked", {
    p_signature_id: id, p_signature_image: "X", p_ip_address: "", p_user_agent: "",
  });
  assert.ok(r.error, "solo service_role (la ruta pública) puede llamarla");
});

// ── 2. Editar factura recibida ──────────────────────────────────────────

async function invoiceOf(user) {
  const { data, error } = await admin
    .from("received_invoices")
    .insert({ user_id: user.id, invoice_number: "F-1", supplier_name: "Prov", issue_date: "2026-09-01", total: 100 })
    .select("id")
    .single();
  assert.equal(error, null, error?.message);
  return data.id;
}
const editArgs = (id, over = {}) => ({
  p_invoice_id: id, p_invoice_number: "F-1-corregida", p_supplier_id: null, p_supplier_name: "Prov",
  p_supplier_nif: null, p_issue_date: "2026-09-02", p_due_date: null, p_subtotal: 100, p_iva_percent: 21,
  p_iva_amount: 21, p_irpf_percent: 0, p_irpf_amount: 0, p_total: 121, p_payment_method: null, p_notes: "corregida",
  ...over,
});

test("2. editar una factura recibida propia funciona (antes: la función no existía)", async () => {
  const id = await invoiceOf(users.a);
  const { data, error } = await users.a.client.rpc("update_received_invoice_and_reconcile", editArgs(id));
  assert.equal(error, null, error?.message);
  assert.equal(data.invoice_number, "F-1-corregida");
  assert.equal(Number(data.total), 121);
});

test("2. no se puede editar la factura de otro usuario (ni saber si existe)", async () => {
  const id = await invoiceOf(users.b);
  const { error } = await users.a.client.rpc("update_received_invoice_and_reconcile", editArgs(id));
  assert.ok(error);
  assert.match(error.message, /no encontrada/i);
  const { data: row } = await admin.from("received_invoices").select("invoice_number").eq("id", id).single();
  assert.equal(row.invoice_number, "F-1");
});

test("2. no se puede asignar un proveedor de otro usuario", async () => {
  const id = await invoiceOf(users.a);
  const { data: sup } = await admin.from("suppliers").insert({ user_id: users.b.id, name: "Ajeno" }).select("id").single();
  const { error } = await users.a.client.rpc("update_received_invoice_and_reconcile", editArgs(id, { p_supplier_id: sup.id }));
  assert.ok(error);
  assert.match(error.message, /proveedor/);
});

test("2. anónimo no puede llamarla", async () => {
  const r = await createClient(URL, ANON, { auth: { persistSession: false } })
    .rpc("update_received_invoice_and_reconcile", editArgs(randomUUID()));
  assert.ok(r.error);
});

// ── 3. Rotar enlace de firma ────────────────────────────────────────────

test("3. rotar el enlace de una firma pendiente devuelve un token y guarda su md5", async () => {
  const id = await signature(users.a.id, "pending");
  const { data, error } = await admin.rpc("rotate_signature_public_token_locked", { p_signature_id: id, p_user_id: users.a.id });
  assert.equal(error, null, error?.message);
  assert.equal(data.ok, true);
  assert.match(data.public_token, /^[0-9a-f]{64}$/);
  const { data: row } = await admin.from("digital_signatures").select("public_token_hash").eq("id", id).single();
  assert.equal(row.public_token_hash, createHash("md5").update(data.public_token).digest("hex"), "coincide con lib/signature-token.ts");
});

test("3. no se rota el enlace de una firma ajena ni de una ya firmada", async () => {
  const ajena = await signature(users.b.id, "pending");
  const r1 = await admin.rpc("rotate_signature_public_token_locked", { p_signature_id: ajena, p_user_id: users.a.id });
  assert.equal(r1.data.reason, "not_authorized");
  const firmada = await signature(users.a.id, "signed");
  const r2 = await admin.rpc("rotate_signature_public_token_locked", { p_signature_id: firmada, p_user_id: users.a.id });
  assert.equal(r2.data.reason, "not_pending");
});
