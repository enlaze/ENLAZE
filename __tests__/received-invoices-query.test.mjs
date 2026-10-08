import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { getReceivedInvoices, getAllReceivedInvoices } from "../lib/suppliers.ts";

function client(fetch) {
  return createClient("https://test.invalid", "test-anon", {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
  });
}

test("recibidas: filtros fiscales usan issue_date y conservan obra, cliente y categoría", async () => {
  let params;
  const db = client(async (input) => {
    const url = new URL(input);
    assert.equal(url.pathname, "/rest/v1/received_invoices");
    params = url.searchParams;
    return new Response("[]", { headers: { "content-range": "*/0" } });
  });
  await getReceivedInvoices(db, {
    project_id: "obra", client_id: "cliente", category: "material",
    issue_date_from: "2026-07-01", issue_date_to: "2026-09-30", limit: 50,
  });
  assert.equal(params.get("project_id"), "eq.obra");
  assert.equal(params.get("client_id"), "eq.cliente");
  assert.equal(params.get("category"), "eq.material");
  assert.deepEqual(params.getAll("issue_date"), ["gte.2026-07-01", "lte.2026-09-30"]);
  assert.equal(params.get("deleted_at"), "is.null");
  assert.match(params.get("select"), /projects\(name\)/);
  assert.equal(params.has("quarter"), false);
});

test("exportar carga más de 50 y 1000 filas, incluso con un tope menor en el servidor", async () => {
  const rows = Array.from({ length: 1203 }, (_, i) => ({ id: String(i) }));
  const offsets = [];
  const db = client(async (input) => {
    const params = new URL(input).searchParams;
    assert.equal(params.get("category"), "eq.seguro");
    const offset = Number(params.get("offset"));
    offsets.push(offset);
    const page = rows.slice(offset, offset + 300);
    return new Response(JSON.stringify(page), {
      headers: { "content-range": `${offset}-${offset + page.length - 1}/${rows.length}` },
    });
  });
  const result = await getAllReceivedInvoices(db, { category: "seguro" });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, rows);
  assert.deepEqual(offsets, [0, 300, 600, 900, 1200]);
});

test("un error intermedio no entrega un CSV parcial", async () => {
  let calls = 0;
  const db = client(async () => ++calls === 1
    ? new Response('[{"id":"1"}]', { headers: { "content-range": "0-0/2" } })
    : new Response('{"message":"fallo de lectura","code":"XX000"}', { status: 400 }));
  const result = await getAllReceivedInvoices(db);
  assert.ok(result.error);
  assert.deepEqual(result.data, []);
});
