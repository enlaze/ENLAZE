/**
 * RLS del banco de precios contra la base REAL (migración
 * 20260924140000_close_price_bank_write_hole). Crea un usuario desechable y
 * lo borra al final; todo lo que inserta es suyo y se limpia.
 *
 *   npm run test:price-bank-rls
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) throw new Error("Faltan variables de Supabase");

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const email = `pb-rls-test-${randomUUID()}@example.com`;
const password = `Pw-${randomUUID()}`;
let userId;
let user;
let ownProviderId;
const createdProductIds = [];

before(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(error, null, error?.message);
  userId = data.user.id;
  user = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await user.auth.signInWithPassword({ email, password });
  assert.equal(s.error, null);
});

after(async () => {
  if (createdProductIds.length) await admin.from("pb_products").delete().in("id", createdProductIds);
  if (userId) {
    await admin.from("pb_products").delete().in(
      "provider_id",
      ((await admin.from("pb_providers").select("id").eq("company_id", userId)).data ?? []).map((r) => r.id),
    );
    await admin.from("pb_providers").delete().eq("company_id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
});

async function globalProduct() {
  const { data } = await admin
    .from("pb_products")
    .select("id, commercial_name, provider_id, pb_providers!inner(company_id)")
    .is("pb_providers.company_id", null)
    .limit(1)
    .single();
  return data;
}

test("anon: no lee ni escribe el banco de precios", async () => {
  for (const t of ["pb_providers", "pb_products", "pb_price_current", "pb_price_sources", "pb_sync_runs"]) {
    const r = await anon.from(t).select("*", { count: "exact", head: true });
    assert.ok(r.error || r.count === 0, `${t}: anon ve ${r.count} filas`);
  }
  const ins = await anon.from("pb_providers").insert({ name: "__anon__", country: "ES" });
  assert.ok(ins.error, "anon no puede insertar proveedores");
  const g = await globalProduct();
  const upd = await anon.from("pb_products").update({ commercial_name: "HACKED" }).eq("id", g.id).select();
  assert.ok(upd.error || upd.data.length === 0);
  assert.equal((await globalProduct()).commercial_name, g.commercial_name);
});

test("con sesión: sigue viendo el catálogo global (los presupuestos lo usan)", async () => {
  const r = await user.from("pb_products").select("*", { count: "exact", head: true });
  assert.equal(r.error, null);
  assert.ok(r.count > 1000, `solo ve ${r.count} productos`);
  const runs = await user.from("pb_sync_runs").select("id").limit(1);
  assert.equal(runs.error, null, "pb/sync/status lee pb_sync_runs con la sesión");
});

test("con sesión: NO puede modificar ni borrar el catálogo global", async () => {
  const g = await globalProduct();
  const upd = await user.from("pb_products").update({ commercial_name: "HACKED" }).eq("id", g.id).select();
  assert.ok(upd.error || upd.data.length === 0, "no modifica productos globales");
  const del = await user.from("pb_products").delete().eq("id", g.id).select();
  assert.ok(del.error || del.data.length === 0, "no borra productos globales");
  const cur = await user.from("pb_price_current").delete().gt("created_at", "1970-01-01").select();
  assert.ok(cur.error || cur.data.length === 0, "no borra precios actuales");
  const prov = await user.from("pb_providers").update({ name: "HACKED" }).is("company_id", null).select();
  assert.ok(prov.error || prov.data.length === 0, "no modifica proveedores globales");
  assert.equal((await globalProduct()).commercial_name, g.commercial_name);
});

test("pantalla de precios: 'Nuevo proveedor' (sin company_id) funciona y queda PRIVADO", async () => {
  const r = await user
    .from("pb_providers")
    .insert({ name: `Proveedor prueba ${randomUUID()}`, country: "ES", is_active: true })
    .select("id, company_id")
    .single();
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data.company_id, userId, "company_id se rellena solo con el usuario");
  ownProviderId = r.data.id;
  const visibleToOthers = await anon.from("pb_providers").select("id").eq("id", ownProviderId);
  assert.equal((visibleToOthers.data ?? []).length, 0);
});

test("pantalla de precios: añadir producto a SU proveedor y editarlo funciona", async () => {
  const r = await user
    .from("pb_products")
    .insert({ provider_id: ownProviderId, commercial_name: "Producto propio", unit_price: 10, region: "ES" })
    .select("id")
    .single();
  assert.equal(r.error, null, r.error?.message);
  createdProductIds.push(r.data.id);
  const upd = await user.from("pb_products").update({ unit_price: 12 }).eq("id", r.data.id).select();
  assert.equal(upd.error, null);
  assert.equal(upd.data.length, 1);
});

test("pantalla de precios: añadir producto al proveedor global 'Referencia mercado ES' sigue funcionando", async () => {
  const { data: ref } = await admin
    .from("pb_providers").select("id").eq("name", "Referencia mercado ES").is("company_id", null).limit(1).single();
  assert.ok(ref, "existe el proveedor global de referencia");
  const r = await user
    .from("pb_products")
    .insert({ provider_id: ref.id, commercial_name: "Producto a catálogo", unit_price: 5, region: "ES" })
    .select("id")
    .single();
  assert.equal(r.error, null, r.error?.message);
  createdProductIds.push(r.data.id);
});

test("no puede colgar productos de un proveedor privado de OTRO usuario", async () => {
  const other = await admin.auth.admin.createUser({ email: `pb-other-${randomUUID()}@example.com`, password, email_confirm: true });
  const otherId = other.data.user.id;
  try {
    const { data: otherProv } = await admin
      .from("pb_providers").insert({ name: "Privado ajeno", country: "ES", company_id: otherId }).select("id").single();
    const r = await user.from("pb_products").insert({ provider_id: otherProv.id, commercial_name: "x", unit_price: 1, region: "ES" });
    assert.ok(r.error, "rechazado");
    const seen = await user.from("pb_providers").select("id").eq("id", otherProv.id);
    assert.equal(seen.data.length, 0, "tampoco lo ve");
  } finally {
    await admin.from("pb_providers").delete().eq("company_id", otherId);
    await admin.auth.admin.deleteUser(otherId);
  }
});

test("sector_data y n8n_updates: sin sesión ni se leen ni se escriben (20260924160000)", async () => {
  for (const t of ["sector_data", "n8n_updates"]) {
    const r = await anon.from(t).select("*", { count: "exact", head: true });
    assert.ok(r.error || r.count === 0, `${t}: anon ve ${r.count} filas`);
  }
  const w1 = await anon.from("sector_data").insert({ sector: "__anon__", data_type: "news", title: "__anon__" });
  assert.ok(w1.error, "anon no escribe sector_data");
  const w2 = await anon.from("n8n_updates").insert({ sector: "__anon__", update_type: "x", data: {}, status: "processing" });
  assert.ok(w2.error, "anon no escribe n8n_updates");
});

test("sector_data: con sesión se lee (los presupuestos la usan) pero no se escribe; n8n_updates no se ve", async () => {
  const r = await user.from("sector_data").select("*", { count: "exact", head: true });
  assert.equal(r.error, null);
  assert.ok(r.count > 0, "los generadores de presupuestos necesitan leerla");
  const w = await user.from("sector_data").insert({ sector: "__user__", data_type: "news", title: "__user__" });
  assert.ok(w.error, "un usuario no escribe datos de mercado");
  const n = await user.from("n8n_updates").select("*", { count: "exact", head: true });
  assert.ok(n.error || n.count === 0, "n8n_updates es solo de sistema");
});
