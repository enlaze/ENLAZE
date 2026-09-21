// Structural regression guard for the wizard's E2 writer adoption.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const provider = readFileSync(join(root,
  "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx"), "utf8");
const page = readFileSync(join(root, "app/dashboard/budgets/generate/page.tsx"), "utf8");

describe("budget wizard uses the atomic E2 revision contract", () => {
  test("create, save and finalize use the dedicated RPC client", () => {
    assert.match(provider, /await createBudgetWithItems\(/);
    assert.match(provider, /await saveBudgetRevision\(/);
    assert.match(provider, /await finalizeBudgetRevision\(/);
    assert.doesNotMatch(provider, /\.from\("budgets"\)\.insert\(/);
    assert.doesNotMatch(provider, /\.from\("budgets"\)\.update\(/);
    assert.doesNotMatch(provider, /replaceBudgetItems/);
    assert.doesNotMatch(provider, /saveDocumentVersion|getNextVersion/);
  });

  test("every saved revision retains the returned lock version", () => {
    assert.match(provider, /lockVersion: number \| null/);
    assert.match(provider, /lockVersionRef\.current \?\? state\.lockVersion/);
    assert.ok((provider.match(/lockVersionRef\.current = result\.lock_version/g) || []).length >= 3);
    assert.match(provider, /if \(!lockVersion\) throw new Error/);
  });

  test("partidas and materials share one ordered payload with normalized units", () => {
    const start = provider.indexOf("const revisionItems = () => {");
    const end = provider.indexOf("const revisionPayload = (", start);
    assert.ok(start >= 0 && end > start);
    const block = provider.slice(start, end);
    assert.equal((block.match(/normalizeBudgetItemUnit\(/g) || []).length, 2);
    assert.match(block, /return \[\.\.\.partidas, \.\.\.materials\]/);
    assert.doesNotMatch(block, /budget_id:|sort_order:/);
  });

  test("errors and conflicts cannot be mistaken for a successful save", () => {
    assert.ok((provider.match(/budgetRevisionErrorMessage\(err\)/g) || []).length >= 2);
    assert.match(provider, /if \(savedDraftId\) \{\s*lastSavedSignature\.current = signatureBeingSaved/);
    assert.match(provider, /if \(!budgetId\) throw new Error/);
  });

  test("finalizing an existing draft performs one atomic revision, not save then finalize", () => {
    const start = provider.indexOf("const finalizeBudget = async (): Promise<string | null> => {");
    const end = provider.indexOf("const isFirstRender", start);
    assert.ok(start >= 0 && end > start);
    const body = provider.slice(start, end);
    assert.match(body, /if \(revisionSaveInFlight\.current\) await revisionSaveInFlight\.current/);
    assert.match(body, /if \(!budgetId\) \{[\s\S]*await saveDraftOrThrow\(false\)/);
    assert.match(body, /await finalizeBudgetRevision\(/);
    assert.equal((body.match(/await saveDraftOrThrow\(false\)/g) || []).length, 1);
  });
});

describe("autosave waits for draft hydration", () => {
  test("the loader installs a baseline before enabling autosave", () => {
    const baseline = provider.indexOf("lastSavedSignature.current = autosaveSignature;");
    const ready = provider.indexOf("autosaveReady.current = true", baseline);
    assert.ok(baseline >= 0 && ready > baseline);
    assert.match(provider, /pendingHydration\.current = true/);
    assert.match(provider, /if \(!autosaveReady\.current \|\| isFinalizingRef\.current \|\| isFinalizedRef\.current\) return;/);
    assert.match(provider, /has\("budgetId"\) &&\s*!autosaveReady\.current/);
  });

  test("database lock_version overrides stale wizard_state values", () => {
    assert.match(page, /\.\.\.saved,[\s\S]*draftId: budget\.id,[\s\S]*lockVersion: Number\(budget\.lock_version\)/);
    assert.match(page, /wizard_state, lock_version/);
    assert.match(page, /lockVersion: Number\(d\.lock_version\)/);
  });
});
