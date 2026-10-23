/**
 * «Tu precio» no se ofrece en presupuestos enviados o con respuesta: la base
 * (budget_internal.save_core) los rechaza, y antes el precio se quedaba
 * guardado en Precios con la partida sin cambiar.
 *
 *   node --import tsx --test __tests__/budget-own-price-sent.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DRAFT_EDITABLE_BUDGET_STATUSES, isBudgetEditableAsDraft } from "../lib/budget-editable.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("solo borrador y pendiente se editan como borrador", () => {
  for (const s of ["borrador", "draft", "pendiente", "pending"]) assert.equal(isBudgetEditableAsDraft(s), true, s);
  for (const s of ["enviado", "sent", "aceptado", "accepted", "rechazado", "rejected", null, undefined, ""]) {
    assert.equal(isBudgetEditableAsDraft(s), false, String(s));
  }
});

test("la lista es la misma que comprueba la base en save_core", () => {
  const sql = read("supabase/migrations/20260915160000_budget_revision_rpcs.sql");
  const core = sql.slice(sql.indexOf("function budget_internal.save_core"));
  const m = core.match(/b\.status not in \(([^)]*)\)/);
  assert.ok(m, "no se encuentra la comprobación de estado en save_core");
  const fromSql = m[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual([...DRAFT_EDITABLE_BUDGET_STATUSES].sort(), fromSql);
});

test("la ficha oculta el campo y no guarda en Precios si no es editable", () => {
  const page = read("app/dashboard/budgets/[id]/page.tsx");
  assert.match(page, /isEstimateSourceType\(item\.price_source_type\) && isBudgetEditableAsDraft\(budget\.status\) && \(\s*<OwnPriceInput/);
  const fn = page.slice(page.indexOf("async function supplyOwnPrice"));
  const guard = fn.indexOf("isBudgetEditableAsDraft(budget.status)");
  const save = fn.indexOf("saveManualPrice(");
  assert.ok(guard > -1 && save > -1 && guard < save, "la comprobación tiene que ir antes de guardar en Precios");
});
