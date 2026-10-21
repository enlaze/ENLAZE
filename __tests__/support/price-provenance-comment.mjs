import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8");

/** Read-only contract check; the pending COMMENT migration is never executed. */
export function assertCurrentPriceComment() {
  const sql = read("supabase/migrations/20261015090000_budget_items_ai_estimate_comment.sql");
  const match = sql.trim().match(/^comment on column public\.budget_items\.price_source_type is\s*'([^']*)';$/i);
  assert.ok(match, "la migración contiene únicamente un COMMENT ON COLUMN");
  const latest = read("supabase/migrations/20261021120000_received_invoice_prices.sql");
  const current = latest.match(/comment on column public\.budget_items\.price_source_type is\s*'([^']*)';/i);
  assert.ok(current, "la migración de facturas documenta los tipos actuales");
  const description = current[1];
  const allowed = new Set(description.split("Valores esperados:")[1].split(".")[0]
    .split(",").map(value => value.trim()));
  const resolver = read("lib/price-resolver-v2.ts");
  const emitted = new Set([...resolver.matchAll(/source_type:\s*"([^"]+)"/g)].map(match => match[1]));
  assert.ok(emitted.size >= 11, "la prueba lee la escalera real del resolutor");
  for (const name of ["lib/budget-price-provenance.ts", "app/api/agent/budget-analysis/route.ts"]) {
    for (const match of read(name).matchAll(/\bprice_source_type\s*[:=]\s*"([^"]+)"/g)) emitted.add(match[1]);
  }
  emitted.add("user_supplied");
  assert.ok(emitted.has("ai_estimate") && emitted.has("user_edited"));
  for (const source of emitted) assert.ok(allowed.has(source), `${source} falta del comentario`);
  assert.match(description, /NULL en una partida antigua = anterior a G3/);
  assert.match(description, /NULL en una partida nueva = fallo/);
}
