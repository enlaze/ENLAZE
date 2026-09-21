// FASE 2F-2 · la duplicación se efectúa de forma atómica dentro de E2.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const detail = read("app/dashboard/budgets/[id]/page.tsx");
const writer = read("lib/budget-revision-writer.ts");
const migration = read("supabase/migrations/20260915160000_budget_revision_rpcs.sql");

function duplicateBody(source) {
  const start = source.indexOf("async function duplicateBudget()");
  const end = source.indexOf("const [exportingPDF", start);
  assert.ok(start >= 0 && end > start, "no se encontró el escritor de duplicación");
  return source.slice(start, end);
}

function sqlBody(name) {
  const start = migration.indexOf(`create function public.${name}(`);
  assert.ok(start >= 0, `falta ${name}`);
  const end = migration.indexOf("end $fn$;", start);
  assert.ok(end > start, `falta el cierre de ${name}`);
  return migration.slice(start, end + "end $fn$;".length);
}

describe("FASE 2F-2 · duplicación atómica E2", () => {
  test("el cliente llama a la RPC y solo navega tras su resultado válido", () => {
    const body = duplicateBody(detail);
    assert.match(body, /await duplicateBudgetRevision\(supabase, budget\.id\)/);
    assert.match(body, /router\.push\(`\/dashboard\/budgets\/\$\{result\.budget_id\}`\)/);
    assert.ok(body.indexOf("await duplicateBudgetRevision") < body.indexOf("router.push"));
    assert.doesNotMatch(body, /\.from\("budgets"\)|\.from\("budget_items"\)|\.insert\(/);
    assert.match(body, /catch \(error\) \{[\s\S]*budgetRevisionErrorMessage\(error\)/);
    assert.match(writer, /return call\(client, "duplicate_budget", \{\s*p_budget_id: budgetId/);
  });

  test("la base valida propietario y proyecto antes de crear la copia", () => {
    const body = sqlBody("duplicate_budget");
    assert.match(body, /v_owner uuid := auth\.uid\(\)/);
    assert.match(body, /perform budget_internal\.lock_owner\(v_owner\)/);
    assert.match(body, /where id = p_budget_id and user_id = v_owner and deleted_at is null for update/);
    assert.match(body, /where id = b\.client_id and user_id = v_owner for share/);
    assert.match(body, /where id = b\.project_id and user_id = v_owner for share/);
    assert.match(body, /values \(v_owner, b\.title \|\| ' \(copia\)'/);
    assert.match(body, /project_id = b\.project_id/);
    assert.doesNotMatch(body, /update public\.budgets[\s\S]*where id = p_budget_id/);
  });

  test("partidas y cabecera se copian en una sola transacción con posiciones contiguas", () => {
    const body = sqlBody("duplicate_budget");
    assert.match(body, /insert into public\.budgets\(/);
    assert.match(body, /insert into public\.budget_items\(/);
    assert.match(body, /\(row_number\(\) over\(order by i\.sort_order, i\.id\) - 1\)::integer/);
    assert.match(body, /from public\.budget_items i where budget_id = p_budget_id/);
    assert.match(body, /return budget_internal\.result\(v_id, null\)/);
  });
});
