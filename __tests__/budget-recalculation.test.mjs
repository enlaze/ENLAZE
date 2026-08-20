import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provider = fs.readFileSync(
  path.join(root, "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx"),
  "utf8",
);
const itemsStep = fs.readFileSync(
  path.join(root, "app/dashboard/budgets/generate/_components/steps/ItemsStep.tsx"),
  "utf8",
);
const apiRoute = fs.readFileSync(
  path.join(root, "app/api/agent/budget-analysis/route.ts"),
  "utf8",
);

test("the recalculate button forces tracker refresh and confirms completion", () => {
  assert.match(itemsStep, /analyzeWithAI\(true\)/);
  assert.match(provider, /forceRefresh:\s*forceRegenerate/);
  assert.match(provider, /toast\.success\("Presupuesto recalculado"/);
  assert.match(provider, /recalculatedAt:\s*new Date\(\)\.toISOString\(\)/);
});

test("budget generation falls back locally when Claude or the API is unavailable", () => {
  assert.match(apiRoute, /buildDeterministicBudgetAnalysis/);
  assert.match(apiRoute, /usando motor determinista/);
  assert.match(provider, /buildDeterministicBudgetAnalysis/);
  assert.match(provider, /El servicio de IA no respondió/);
});
