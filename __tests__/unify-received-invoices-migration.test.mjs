import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { detectarControlTransaccion, trocearStatements } from "./lib/sql-toplevel.mjs";

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const migration = read("20261009120000_unify_received_invoices.sql");
const previous = read("20260929100000_portal_rpcs_drop_legacy_token.sql");
const snapshot = (sql) => sql.match(/create or replace function public\.portal_read_snapshot[\s\S]*?as \$\$([\s\S]*?)\$\$;/i)[1];

test("unificación: la migración y su registro comparten transacción", () => {
  assert.deepEqual(detectarControlTransaccion(migration), []);
  assert.ok(trocearStatements(migration).length > 15);
  assert.ok(!/^-- pg-delta: transaction=false$/m.test(migration));
});

test("portal: solo cambia la fuente y el mapeo de facturas, conserva visibilidad y capacidades", () => {
  const expected = snapshot(previous)
    .replace("declare\n", "-- Facturas unificadas 20261007; contrato JSON y visibilidad de S3.3(b) intactos.\ndeclare\n")
    .replace("'invoice_date',i.invoice_date", "'invoice_date',i.issue_date")
    .replace("'base_amount',i.base_amount", "'base_amount',i.subtotal")
    .replace("'total_amount',i.total_amount", "'total_amount',i.total")
    .replace("'payment_status',i.payment_status", "'payment_status',i.status")
    .replace("order by i.invoice_date desc,i.id", "order by i.issue_date desc,i.id")
    .replace("from public.invoices i", "from public.received_invoices i");
  assert.equal(snapshot(migration), expected);
  for (const body of [snapshot(previous), expected]) {
    assert.ok(migration.includes(createHash("md5").update(body).digest("hex")), "guard reconoce exactamente el cuerpo previo o ya migrado");
  }
  assert.match(migration, /pg_get_functiondef/);
  assert.doesNotMatch(migration, /create or replace function public\.portal_respond/);
  assert.doesNotMatch(migration, /(?:grant|revoke).*function/i);
});

test("traslado conserva ids y fechas recuperables; no almacena periodos ni borra tablas", () => {
  assert.match(migration, /SELECT\s+i\.id, i\.user_id/);
  assert.match(migration, /SIN-NUMERO-/);
  assert.match(migration, /COALESCE\(i\.invoice_date, i\.created_at::date\)/);
  assert.match(migration, /WHERE NOT EXISTS \(SELECT 1 FROM public\.received_invoices ri WHERE ri\.id = i\.id\)/);
  assert.match(migration, /REFERENCES public\.received_invoices\(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(migration, /DROP TABLE|ADD COLUMN[^;]*(?:quarter|fiscal_year)/i);
  assert.match(migration, /REVOKE INSERT, UPDATE ON public\.invoices, public\.invoice_items FROM anon, authenticated/);
});
