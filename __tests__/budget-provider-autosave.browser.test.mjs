import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const budgetId = "11111111-1111-4111-8111-111111111111";

const virtualModules = {
  "@/lib/supabase-browser": `
    const empty = { data: [], error: null };
    function query() {
      const q = {
        select: () => q, eq: () => q, limit: () => Promise.resolve(empty),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve, reject) => Promise.resolve(empty).then(resolve, reject),
      };
      return q;
    }
    export function createClient() {
      return { auth: { getUser: async () => ({ data: { user: { id: "test-user" } }, error: null }) }, from: query };
    }
  `,
  "@/lib/budget-revision-writer": `
    export function isBudgetRevisionConflict(error) { return error?.code === "PT409"; }
    export function budgetRevisionErrorMessage(error) {
      return isBudgetRevisionConflict(error)
        ? "Este presupuesto ha cambiado en otra pestaña o sesión. Recarga la página antes de volver a guardar."
        : String(error?.message || error);
    }
    export async function createBudgetWithItems(_client, payload, items) {
      window.__attempts.push({ kind: "create" });
      window.__writes.push({ kind: "create", title: payload.title, items: items.length });
      return { budget_id: "${budgetId}", lock_version: 1 };
    }
    export async function saveBudgetRevision(_client, id, version, payload, items) {
      window.__attempts.push({ kind: "save", version });
      if (window.__conflictNextSave) {
        window.__conflictNextSave = false;
        const error = new Error("Budget revision conflict");
        error.code = "PT409";
        throw error;
      }
      window.__writes.push({ kind: "save", id, version, title: payload.title, items: items.length });
      return { budget_id: id, lock_version: version + 1 };
    }
    export async function finalizeBudgetRevision() { throw Error("Unexpected finalization"); }
  `,
  "@/components/ui/toast": `
    export function useToast() { return { success() {}, error() {} }; }
  `,
  "@/lib/activity-log": `export function logActivity() {}`,
  "@/lib/analytics": `export const analytics = { budgetFinalized() {} };`,
};

const entry = `
  import React, { useEffect } from "react";
  import { createRoot } from "react-dom/client";
  import { BudgetGenerateProvider, useBudgetGenerate } from "@/app/dashboard/budgets/generate/_components/BudgetGenerateProvider";
  function Probe() {
    const context = useBudgetGenerate();
    useEffect(() => { window.harness = context; });
    return React.createElement("div", { id: "title" }, context.state.title);
  }
  window.__writes = [];
  window.__attempts = [];
  window.__conflictNextSave = false;
  createRoot(document.getElementById("root")).render(
    React.createElement(BudgetGenerateProvider, null, React.createElement(Probe))
  );
`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: "browser-harness.tsx", loader: "tsx" },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  plugins: [{
    name: "isolated-budget-dependencies",
    setup(build) {
      build.onResolve({ filter: /^@\// }, ({ path: specifier }) => {
        if (Object.hasOwn(virtualModules, specifier)) return { path: specifier, namespace: "isolated" };
        const base = path.join(root, specifier.slice(2));
        const resolved = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, path.join(base, "index.ts")]
          .find((candidate) => existsSync(candidate));
        if (!resolved) throw new Error(`Cannot resolve local module: ${specifier}`);
        return { path: resolved };
      });
      build.onLoad({ filter: /.*/, namespace: "isolated" }, ({ path: specifier }) => ({
        contents: virtualModules[specifier], loader: "js",
      }));
    },
  }],
});

const server = createServer((request, response) => {
  if (request.url?.startsWith("/bundle.js")) {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(bundle.outputFiles[0].contents);
  } else {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

async function localPage(route) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.browserErrors = pageErrors;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === origin) request.continue();
    else request.abort();
  });
  await page.goto(`${origin}${route}`);
  await page.waitForFunction(() => Boolean(window.harness));
  return page;
}

try {
  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-background-networking",
      "--disable-extensions", "--disable-sync", "--no-first-run",
    ],
  });

  const fresh = await localPage("/new");
  await fresh.evaluate(() => window.harness.updateState({ title: "Primero" }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  await fresh.evaluate(() => window.harness.updateState({ title: "Definitivo" }));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(await fresh.evaluate(() => window.__writes.length), 0, "rapid edits must debounce");
  await fresh.waitForFunction(() => window.__writes.length === 1, { timeout: 3000 });
  assert.deepEqual(await fresh.evaluate(() => window.__writes[0]), {
    kind: "create", title: "Definitivo", items: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, 1900));
  assert.equal(await fresh.evaluate(() => window.__writes.length), 1, "save bookkeeping must not loop");
  assert.deepEqual(fresh.browserErrors, [], "new-budget browser errors");
  await fresh.close();

  const existing = await localPage(`/existing?budgetId=${budgetId}`);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.equal(await existing.evaluate(() => window.__writes.length), 0, "blank state must not overwrite an existing budget");
  await existing.evaluate((id) => window.harness.loadDraft(
    { draftId: id, lockVersion: 7, title: "Base" },
    { itemsAuthoritative: true },
  ), budgetId);
  await existing.waitForFunction(() => window.harness.state.title === "Base");
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.equal(await existing.evaluate(() => window.__writes.length), 0, "hydration must establish a baseline without writing");
  await existing.evaluate(() => window.harness.updateState({ title: "Editado" }));
  await existing.waitForFunction(() => window.__writes.length === 1, { timeout: 3000 });
  assert.deepEqual(await existing.evaluate(() => window.__writes[0]), {
    kind: "save", id: budgetId, version: 7, title: "Editado", items: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, 1900));
  assert.equal(await existing.evaluate(() => window.__writes.length), 1, "hydrated save must not repeat");
  await existing.evaluate(() => window.harness.updateState({ title: "Segunda edición" }));
  await existing.waitForFunction(() => window.__writes.length === 2, { timeout: 3000 });
  assert.deepEqual(await existing.evaluate(() => window.__writes[1]), {
    kind: "save", id: budgetId, version: 8, title: "Segunda edición", items: 0,
  }, "a second autosave must use the returned lock_version");

  await existing.evaluate(() => {
    window.__conflictNextSave = true;
    window.harness.updateState({ title: "Edición desde pestaña obsoleta" });
  });
  await existing.waitForFunction(() => window.harness.state.hasRevisionConflict === true, { timeout: 3000 });
  assert.match(
    await existing.evaluate(() => window.harness.state.saveError),
    /otra pestaña o sesión/,
    "the conflict must be visible and actionable",
  );
  assert.equal(await existing.evaluate(() => window.__attempts.length), 3, "the conflict is attempted exactly once");
  assert.equal(await existing.evaluate(() => window.__writes.length), 2, "the conflicting write is not accepted");
  await existing.evaluate(() => window.harness.updateState({ title: "No debe reintentarse" }));
  await new Promise((resolve) => setTimeout(resolve, 1900));
  assert.equal(await existing.evaluate(() => window.__attempts.length), 3, "autosave must stay stopped after PT409");
  assert.equal(await existing.evaluate(() => window.harness.saveDraft(true)), null, "manual save must require a reload after PT409");
  assert.equal(await existing.evaluate(() => window.__attempts.length), 3, "manual save must not retry a stale revision");
  assert.deepEqual(existing.browserErrors, [], "existing-budget browser errors");
  await existing.close();

  const unchangedHydration = await localPage(`/same-signature?budgetId=${budgetId}`);
  await unchangedHydration.evaluate((id) => window.harness.loadDraft(
    { draftId: id, lockVersion: 11 },
    { itemsAuthoritative: true },
  ), budgetId);
  await unchangedHydration.waitForFunction(() => window.harness.state.lockVersion === 11);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await unchangedHydration.evaluate(() => window.harness.updateState({ title: "Primera edición real" }));
  await unchangedHydration.waitForFunction(() => window.__writes.length === 1, { timeout: 3000 });
  assert.deepEqual(await unchangedHydration.evaluate(() => window.__writes[0]), {
    kind: "save", id: budgetId, version: 11, title: "Primera edición real", items: 0,
  }, "an unchanged hydration signature must not consume the first real edit");
  assert.deepEqual(unchangedHydration.browserErrors, [], "same-signature hydration browser errors");
  await unchangedHydration.close();

  console.log("PASS: React provider debounces, baselines hydration, stops stale tabs and chains lock_version");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
