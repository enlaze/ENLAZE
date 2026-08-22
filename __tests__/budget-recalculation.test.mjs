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
const priceRoute = fs.readFileSync(
  path.join(root, "app/api/prices/resolve/route.ts"),
  "utf8",
);
const priceResolver = fs.readFileSync(
  path.join(root, "lib/price-resolver.ts"),
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

test("recalculation has a bounded retail search and keeps service lines out of it", () => {
  assert.match(provider, /includeCommercialCatalog:\s*false/);
  assert.match(priceRoute, /searchTimeout = setTimeout\(\(\) => searchController\.abort\(\), 18_000\)/);
  assert.match(priceRoute, /\.abortSignal\(searchController\.signal\)/);
  assert.match(priceResolver, /input\.timeoutMs \?\? 25_000/);
});

test("recalculation does not load the complete joined current-price table", () => {
  assert.doesNotMatch(priceRoute, /\.from\("pb_price_current"\)/);
  assert.match(priceRoute, /pb_products already stores the latest authoritative tracker price/);
});

test("commercial and BC3 candidate searches use their full-text indexes", () => {
  assert.match(priceRoute, /\.textSearch\("commercial_name", tokens\.join\(" "\)/);
  assert.match(priceRoute, /\.textSearch\("name", tokens\.join\(" "\)/);
  assert.equal((priceRoute.match(/\.limit\(80\)/g) || []).length, 2);
  assert.doesNotMatch(priceRoute, /commercial_name\.ilike/);
  assert.doesNotMatch(priceRoute, /technical_price_items"\)[\s\S]{0,300}\.select\([^)]*company_id/);
});

test("autosave cannot retrigger itself or rewrite unchanged budget items", () => {
  assert.match(provider, /const autosaveSignature = useMemo\(\(\) => buildAutosaveSignature\(state\), \[state\]\)/);
  assert.match(provider, /\}, \[autosaveSignature\]\);/);
  assert.doesNotMatch(provider, /\}, \[state\]\);/);
  assert.match(provider, /if \(autosaveSignature === lastSavedSignature\.current\) return/);
  assert.match(provider, /const itemsSignature = `\$\{draftId\}:\$\{JSON\.stringify\(itemsToInsert\)\}`/);
  assert.match(provider, /if \(itemsSignature !== lastSyncedItemsSignature\.current\)/);
});
