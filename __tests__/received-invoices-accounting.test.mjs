import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createClient } from "@supabase/supabase-js";
import { toFiscalReceivedInvoice } from "../lib/received-invoices.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(root, "node_modules/.cache");
mkdirSync(cache, { recursive: true });
const dir = mkdtempSync(path.join(cache, "received-invoices-api-"));
test.after(() => { rmSync(dir, { recursive: true, force: true }); delete globalThis.__receivedInvoiceTestClient; });
const bundle = path.join(dir, "route.cjs");
await build({
  entryPoints: [path.join(root, "app/api/contabilidad/pdf/route.ts")], outfile: bundle,
  platform: "node", format: "cjs", bundle: true, packages: "external", logLevel: "silent",
  plugins: [{ name: "session-client", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/supabase-server$/ }, () => ({ path: "session", namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export async function createClient() { return globalThis.__receivedInvoiceTestClient; }" }));
  } }],
});
const { GET } = createRequire(import.meta.url)(bundle);
const statuses = ["pending", "approved", "paid", "overdue", "rejected", "partial", "pending"];
const rows = statuses.map((status, i) => ({
  id: `invoice-${i}`, invoice_number: `HUB-${i + 1}`, supplier_name: `Proveedor ${i + 1}`, supplier_nif: null,
  issue_date: `2026-09-${String(i + 1).padStart(2, "0")}`, subtotal: 100, iva_percent: 21, iva_amount: 21,
  irpf_percent: 15, irpf_amount: 15, total: 106, category: "general", status, payment_status: "unpaid",
}));

function session(fetch, authenticated = true) {
  const db = createClient("https://fixture.invalid", "fixture-anon", {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
  });
  db.auth.getUser = async () => ({ data: { user: authenticated ? { id: "tenant-fixture" } : null }, error: null });
  globalThis.__receivedInvoiceTestClient = db;
}

// Synthetic seven-row fixture. This does NOT read or claim to validate production data.
test("las siete recibidas llegan al contrato de Contabilidad y al endpoint del PDF", async () => {
  const mapped = rows.map(toFiscalReceivedInvoice);
  assert.equal(mapped.length, 7);
  assert.equal(mapped.reduce((sum, i) => sum + i.total_amount, 0), 742);
  assert.deepEqual(mapped.map((i) => i.payment_status), statuses);
  const page = readFileSync(path.join(root, "app/dashboard/contabilidad/page.tsx"), "utf8");
  assert.match(page, /getAllReceivedInvoices\(supabase\)/);
  assert.match(page, /setReceived\(recRes.data.map\(toFiscalReceivedInvoice\)\)/);
  assert.doesNotMatch(page, /from\("invoices"\)/);

  let calls = 0;
  session(async (input) => {
    const url = new URL(input);
    if (url.pathname === "/rest/v1/profiles") return new Response(JSON.stringify({ company_name: "Empresa de prueba", nif: "B00000000" }));
    assert.equal(url.pathname, "/rest/v1/received_invoices");
    const p = url.searchParams;
    assert.deepEqual(p.getAll("issue_date"), ["gte.2026-07-01", "lte.2026-09-30"]);
    assert.equal(p.get("deleted_at"), "is.null");
    const offset = Number(p.get("offset"));
    const slice = rows.slice(offset, offset + 3);
    calls++;
    return new Response(JSON.stringify(slice), { headers: { "content-range": `${offset}-${offset + slice.length - 1}/7` } });
  });
  const response = await GET(new Request("https://fixture.invalid/api/contabilidad/pdf?type=received&period=quarter&quarter=3&year=2026"));
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(calls, 3, "incluye todas las páginas de recibidas");
  assert.equal(report.periodLabel, "3T 2026");
  assert.equal(report.received.length, 7);
  assert.deepEqual(new Set(report.received.map((i) => i.number)), new Set(rows.map((i) => i.invoice_number)));
  assert.deepEqual(report.totals.received, { count: 7, base: 700, iva: 147, irpf: 105, total: 742 });
  assert.equal(report.received.find((i) => i.number === "HUB-2").status, "approved");
  assert.equal(report.received[0].iva_pct, 21);
  assert.equal(report.received[0].irpf_pct, 15);
});

test("el informe fiscal no entrega un informe vacío si falla la lectura", async () => {
  session(async () => new Response('{"message":"error de consulta","code":"XX000"}', { status: 400 }));
  const response = await GET(new Request("https://fixture.invalid/api/contabilidad/pdf?type=received&year=2026"));
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /todas las facturas recibidas/);
});

test("el informe fiscal exige sesión", async () => {
  session(() => { throw new Error("no debe consultar tablas"); }, false);
  const response = await GET(new Request("https://fixture.invalid/api/contabilidad/pdf?type=received&year=2026"));
  assert.equal(response.status, 401);
});
