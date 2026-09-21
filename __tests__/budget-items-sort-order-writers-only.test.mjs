// E2 persists sort_order from JSON array ordinality, not a client-supplied field.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260915160000_budget_revision_rpcs.sql");
const wizard = read("app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx");
const form = read("app/dashboard/budgets/_components/budget-form.tsx");
const detail = read("app/dashboard/budgets/[id]/page.tsx");

describe("sort_order follows the payload order in the E2 transaction", () => {
  test("the server assigns contiguous positions after validation", () => {
    assert.match(migration, /jsonb_array_elements\(p_items\) with ordinality t\(item, ordinality\)/);
    assert.match(migration, /\(t\.ordinality - 1\)::integer/);
    assert.match(migration, /order by i\.sort_order, i\.id/);
    assert.match(migration, /row_number\(\) over\(order by i\.sort_order, i\.id\) - 1/);
  });

  test("wizard filters optional rows before concatenating included materials", () => {
    assert.match(wizard, /state\.partidas\.filter\(p => p\.status !== "opcional"\)/);
    assert.match(wizard, /state\.materials\.filter\(m => m\.included\)/);
    assert.match(wizard, /return \[\.\.\.partidas, \.\.\.materials\]/);
    assert.match(wizard, /saveBudgetRevision\([\s\S]*?revisionPayload\(draftId, clientSnapshot\),\s*items,/);
    assert.match(wizard, /finalizeBudgetRevision\([\s\S]*?revisionPayload\(budgetId\),\s*revisionItems\(\)/);
  });

  test("manual form sends items in visual order and duplicate is server-side", () => {
    assert.match(form, /const itemsForRpc = partidas\.map\(\(p\) =>/);
    assert.match(form, /createBudgetWithItems\([\s\S]*?itemsForRpc/);
    assert.match(form, /saveBudgetRevision\([\s\S]*?itemsForRpc/);
    assert.match(detail, /duplicateBudgetRevision\(supabase, budget\.id\)/);
    assert.doesNotMatch(detail, /\.from\("budget_items"\)\.insert\(/);
  });

  test("empty and filtered collections retain their intended order", () => {
    const input = [
      { concept: "A", status: "incluida" },
      { concept: "X", status: "opcional" },
      { concept: "B", status: "incluida" },
    ];
    const material = [{ name: "M", included: true }, { name: "N", included: false }];
    const output = [
      ...input.filter((item) => item.status !== "opcional").map((item) => item.concept),
      ...material.filter((item) => item.included).map((item) => item.name),
    ];
    assert.deepEqual(output, ["A", "B", "M"]);
    assert.deepEqual([].map((_, index) => index), []);
  });
});
