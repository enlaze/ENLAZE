import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import {
  BUDGET_AUTOSAVE_EDITABLE_KEYS,
  buildAutosaveSignature,
} from "../lib/budget-autosave-signature.ts";

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
const NON_EDITABLE_BUDGET_STATE_KEYS = [
  "draftId",
  "lockVersion",
  "lastSavedAt",
  "endDate",
  "configuredMarginPercent",
  "validationError",
  "providerOptions",
  "allFetchedMaterials",
  "baseAIMaterials",
  "isRealDataMode",
  "totals",
  "isAnalyzing",
  "analysisError",
  "lastAnalysisHash",
  "aiInsights",
  "priceVerification",
  "realismAudit",
  "materialsFromAI",
  "analysisDirty",
  "isUndervalued",
  "marketAdjustMessage",
  "realisticTimeline",
  "clientView",
  "internalView",
  "isSavingDraft",
  "isFinalizing",
  "hasRevisionConflict",
  "saveError",
  "finalizeError",
];

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

test("autosave cannot retrigger itself or write before draft hydration", () => {
  assert.match(provider, /const autosaveSignature = useMemo\(\(\) => buildAutosaveSignature\(state\), \[state\]\)/);
  assert.match(provider, /\}, \[autosaveSignature, hydrationRevision\]\);/);
  assert.doesNotMatch(provider, /\}, \[state\]\);/);
  assert.match(provider, /if \(autosaveSignature === lastSavedSignature\.current\) return/);
  assert.match(provider, /if \(!autosaveReady\.current \|\| revisionConflictRef\.current \|\| isFinalizingRef\.current \|\| isFinalizedRef\.current\) return/);
  assert.match(provider, /if \(pendingHydration\.current\) \{[\s\S]*lastSavedSignature\.current = autosaveSignature/);
  assert.match(provider, /await saveBudgetRevision\(/);
  assert.doesNotMatch(provider, /replaceBudgetItems\(/);
  assert.doesNotMatch(provider, /AUTOSAVE_IGNORED_KEYS|Object\.keys\(state\)/);
});

test("autosave uses an explicit allowlist of editable budget fields", () => {
  assert.deepEqual(BUDGET_AUTOSAVE_EDITABLE_KEYS, [
    "currentStep",
    "sector",
    "title",
    "clientId",
    "clientName",
    "clientEmail",
    "clientPhone",
    "clientCompany",
    "projectId",
    "serviceType",
    "startDate",
    "description",
    "validUntil",
    "depositPercent",
    "paymentMethod",
    "paymentIban",
    "discountType",
    "discountPercent",
    "discountAmount",
    "paymentSchedule",
    "warrantyText",
    "executionDeadlineText",
    "observations",
    "conditionsText",
    "internalNotes",
    "ivaPercent",
    "marginPercent",
    "sectorData",
    "partidas",
    "selectedProviderId",
    "materials",
    "useSuggestedMaterials",
  ]);

  const editable = Object.fromEntries(
    BUDGET_AUTOSAVE_EDITABLE_KEYS.map((key, index) => [key, `value-${index}`]),
  );
  const baseline = buildAutosaveSignature(editable);

  for (const key of BUDGET_AUTOSAVE_EDITABLE_KEYS) {
    assert.notEqual(
      buildAutosaveSignature({ ...editable, [key]: `changed-${key}` }),
      baseline,
      `${key} must trigger autosave`,
    );
  }
});

test("derived, fetched and transient state cannot trigger autosave", () => {
  const editable = Object.fromEntries(
    BUDGET_AUTOSAVE_EDITABLE_KEYS.map((key, index) => [key, `value-${index}`]),
  );
  const baseline = buildAutosaveSignature(editable);
  for (const key of [...NON_EDITABLE_BUDGET_STATE_KEYS, "futureDerivedField"]) {
    assert.equal(
      buildAutosaveSignature({ ...editable, [key]: { changed: key } }),
      baseline,
      `${key} must not trigger autosave`,
    );
  }
});

test("every BudgetState field is deliberately classified", () => {
  const source = ts.createSourceFile(
    "BudgetGenerateProvider.tsx",
    provider,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declaration = source.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === "BudgetState",
  );
  assert.ok(declaration && ts.isInterfaceDeclaration(declaration), "BudgetState interface not found");

  const stateKeys = declaration.members.map((member) => {
    assert.ok(member.name, "BudgetState contains an unnamed member");
    return member.name.getText(source).replace(/^['"]|['"]$/g, "");
  }).sort();
  const editable = new Set(BUDGET_AUTOSAVE_EDITABLE_KEYS);
  const nonEditable = new Set(NON_EDITABLE_BUDGET_STATE_KEYS);

  assert.deepEqual(
    [...editable].filter((key) => nonEditable.has(key)),
    [],
    "a BudgetState field cannot be both editable and derived",
  );
  assert.deepEqual(
    [...new Set([...editable, ...nonEditable])].sort(),
    stateKeys,
    "classify every new BudgetState field before it can affect autosave",
  );
});
