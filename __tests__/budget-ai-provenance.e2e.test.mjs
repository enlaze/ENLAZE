// Isolated application E2E: real POST, React wizard, normalization, resolver
// adoption and revision writer. External services and RPC storage are fixtures;
// this test does not exercise PostgreSQL or apply migrations.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { generateInternalPDFHTML, generateBudgetPDFHTML } from "../lib/pdf-generator.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const budgetId = "11111111-1111-4111-8111-111111111111";
const quoteDate = "2026-10-08T10:00:00.000Z";
const label = "Estimación IA · sin fuente técnica";
const budget = { budget_number: "G3-E2E", title: "Pintura", service_type: "reforma",
  status: "borrador", created_at: quoteDate, subtotal: 100, iva_percent: 21, iva_amount: 21, total: 121 };

const proposal = {
  summary: "Pintura de 40 m2", confidence_score: 90,
  // Even a forged source from the model is not resolver evidence.
  suggested_items: [...Array.from({ length: 7 }, (_, i) => ({
    concept: i === 0 ? "Preparación técnica" : `Pintura pared ${i}`,
    description: "Preparación y acabado", quantity: 40, unit: "m2", unit_cost: 9 + i,
    category: "mano_obra", chapter: "pintura", estimated_hours: 4,
    ...(i === 6 ? { price_source_type: "technical_bank", price_confidence: 1 } : {}),
  })), { concept: "Referencia mercado G3", description: "Estimación con respaldo de mercado",
    quantity: 40, unit: "m2", unit_cost: 12, category: "mano_obra", chapter: "pintura" }],
  suggested_materials: [{ concept: "Pintura sin coincidencia", quantity: 2, unit: "ud", unit_cost: 20 }],
};

function isolatedModules(modules) {
  return {
    name: "g3-isolated-services",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path: specifier }) => {
        if (Object.hasOwn(modules, specifier)) return { path: specifier, namespace: "fixture" };
        if (!specifier.startsWith("@/")) return;
        const base = path.join(root, specifier.slice(2));
        const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, "index.ts")]
          .find(candidate => existsSync(candidate));
        assert.ok(resolved, `local module ${specifier}`);
        return { path: resolved };
      });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: specifier }) => ({
        contents: modules[specifier], loader: "js",
      }));
    },
  };
}

const emptyQuery = `
  function query() {
    const result = { data: [], error: null, count: 8 };
    const q = { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }) };
    for (const name of ["select", "eq", "gt", "gte", "is", "in", "limit", "order"])
      q[name] = () => q;
    return q;
  }
`;

test("G3 E2E: IA → asistente → guardado sin NULL, resolutor y edición manual", { timeout: 90000 }, async () => {
  const routeBundle = await build({
    stdin: { contents: `
      export { POST } from "@/app/api/agent/budget-analysis/route";
      export { POST as PDF_POST } from "@/app/api/budgets/pdf/route";
    `, resolveDir: root, sourcefile: "g3-routes.ts", loader: "ts" },
    bundle: true, write: false, platform: "node", format: "esm",
    define: { "process.env.ANTHROPIC_API_KEY": '"synthetic-never-sent"',
      "process.env.SUPABASE_SERVICE_ROLE_KEY": "undefined" },
    plugins: [isolatedModules({
      "@supabase/ssr": `${emptyQuery}
        export const createServerClient = () => ({ from(table) {
          const q = query();
          if (table === "budgets") q.single = async () => ({ data: globalThis.__g3SavedBudget, error: null });
          if (table === "budget_items") q.then = (resolve, reject) =>
            Promise.resolve({ data: globalThis.__g3SavedItems, error: null }).then(resolve, reject);
          return q;
        },
          auth: { getUser: async () => ({ data: { user: { id: "test-user" } } }) } });`,
      "@supabase/supabase-js": `export function createClient() { throw Error("Unexpected service client"); }`,
      "next/headers": `export async function cookies() { return { get() {} }; }`,
      "next/server": `export const NextResponse = Response;`,
      "@/lib/subscription": `export async function reserveUsage() { return null; }`,
      "@/lib/ai-logger": `export async function hashText() { return "fixture"; }
        export async function logAiRun() {}`,
      "@anthropic-ai/sdk": `export default class Anthropic {
        messages = { create: async () => {
          if (globalThis.__g3ModelUnavailable) throw Error("Model fixture unavailable");
          return { content: [{ type: "text", text: JSON.stringify(globalThis.__g3Proposal) }],
            usage: { input_tokens: 1, output_tokens: 1 } };
        } };
      }`,
    })],
  });
  const { POST, PDF_POST } = await import(`data:text/javascript;base64,${Buffer.from(routeBundle.outputFiles[0].contents).toString("base64")}`);
  const browserBundle = await build({
    stdin: { contents: `
      import React, { useEffect } from "react";
      import { createRoot } from "react-dom/client";
      import { BudgetGenerateProvider, useBudgetGenerate } from "@/app/dashboard/budgets/generate/_components/BudgetGenerateProvider";
      import { ItemsStep } from "@/app/dashboard/budgets/generate/_components/steps/ItemsStep";
      import { ProvidersStep } from "@/app/dashboard/budgets/generate/_components/steps/ProvidersStep";
      function Probe() {
        const context = useBudgetGenerate();
        useEffect(() => { window.harness = context; });
        return <><ItemsStep /><ProvidersStep /></>;
      }
      createRoot(document.getElementById("root")).render(<BudgetGenerateProvider><Probe /></BudgetGenerateProvider>);
    `, sourcefile: "g3-browser.tsx", loader: "tsx", resolveDir: root },
    bundle: true, write: false, platform: "browser", format: "iife",
    plugins: [isolatedModules({
      "@/lib/supabase-browser": `${emptyQuery}
        export function createClient() { return { from: query,
          auth: { getUser: async () => ({ data: { user: { id: "test-user" } }, error: null }) },
          rpc: async (fn, params) => (await fetch("/fixture/rpc/" + fn, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params)
          })).json(),
        }; }`,
      "@/components/ui/toast": `export function useToast() { return { success() {}, error() {} }; }`,
      "@/lib/activity-log": `export function logActivity() {}`,
      "@/lib/analytics": `export const analytics = { budgetFinalized() {} };`,
    })],
  });

  let scenario = "ai", rows = [], writes = [], analysisResults = [], version = 0;
  const serverErrors = [], browserErrors = [], deniedRequests = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const reply = (value, status = 200) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.url === "/api/agent/budget-analysis") {
        if (scenario === "offline") return reply({ error: "fixture offline" }, 503);
        globalThis.__g3Proposal = structuredClone(proposal);
        globalThis.__g3ModelUnavailable = scenario === "deterministic";
        const result = await POST(new Request("http://localhost/api/agent/budget-analysis", {
          method: "POST", headers: { "content-type": "application/json" }, body,
        }));
        const json = await result.json();
        analysisResults.push(json);
        return reply(json, result.status);
      }
      if (request.url === "/api/prices/resolve") {
        const input = JSON.parse(body);
        const resolved = input.materials.map(item => {
          const technical = item.materialName === "Preparación técnica";
          const market = item.materialName === "Referencia mercado G3";
          const sourced = technical || (input.includeCommercialCatalog && scenario !== "retained-material");
          return { materialName: item.materialName, normalizedName: item.materialName.toLowerCase(),
            selectedPrice: market ? 14.5 : sourced ? 12.5 : item.referenceUnitPrice,
            sourceType: market ? "market_estimate" : technical ? "technical_bank" : sourced ? "provider_updated" : "estimated",
            confidenceScore: market ? 0.35 : sourced ? 0.82 : 0.05, capturedAt: quoteDate,
            selectedSupplier: sourced ? "Proveedor de prueba" : "Sin fuente",
            selectedProductName: item.materialName, sourceUrl: "https://supplier.example/fixture",
            isAvailable: true, alternatives: [], qualityTier: "media", unit: item.unit };
        });
        return reply({ ok: true, resolved, summary: { total: resolved.length, fromUserCatalog: 0,
          fromEnlaze: 0, fromN8n: 0, fromWebSearch: 0, fromCache: 0, estimated: 0,
          webSearchesPerformed: 0, webSearchesSuccessful: 0 }, cachedUntil: "" });
      }
      if (request.url === "/api/budgets/pdf") {
        const result = await PDF_POST(new Request("http://localhost/api/budgets/pdf", {
          method: "POST", headers: { "content-type": "application/json" }, body,
        }));
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(await result.text());
        return;
      }
      if (request.url.startsWith("/fixture/rpc/")) {
        const fn = request.url.split("/").at(-1);
        assert.ok(["create_budget_with_items", "save_budget"].includes(fn));
        const params = JSON.parse(body);
        // Fixture storage models SQL NULL for absent provenance. It never
        // supplies ai_estimate: removing the route assignment must reach here.
        rows = structuredClone(params.p_items).map(item => ({ ...item,
          price_source_type: item.price_source_type ?? null,
          price_confidence: item.price_confidence ?? null, price_checked_at: item.price_checked_at ?? null }));
        writes.push({ fn, rows });
        globalThis.__g3SavedItems = rows;
        globalThis.__g3SavedBudget = { ...budget, ...params.p_budget_data, id: budgetId };
        return reply({ data: { budget_id: budgetId, lock_version: ++version, version: 1,
          status: "borrador", previous_status: null, items_count: rows.length }, error: null });
      }
      if (request.url === "/bundle.js") {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(browserBundle.outputFiles[0].contents);
        return;
      }
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
        return;
      }
      response.writeHead(404); response.end();
    } catch (error) {
      serverErrors.push(String(error)); response.writeHead(500); response.end(String(error));
    }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-background-networking",
      "--disable-extensions", "--disable-sync", "--no-first-run"] });
    for (scenario of ["ai", "retained-material", "deterministic", "offline"]) {
      rows = []; writes = []; analysisResults = []; version = 0;
      const page = await browser.newPage();
      page.on("pageerror", error => browserErrors.push(error.message));
      await page.setRequestInterception(true);
      page.on("request", request => {
        if (new URL(request.url()).origin === origin) request.continue();
        else { deniedRequests.push(request.url()); request.abort(); }
      });
      await page.goto(origin);
      await page.waitForFunction(() => Boolean(window.harness));
      await page.evaluate(sector => window.harness.updateState({ title: "Pintura 40 m2", sector,
        serviceType: "reforma", description: "Pintura de paredes y techos",
        sectorData: { superficie_m2: 40, num_banos: 0, incluye_cocina: false,
          incluye_ventanas: false, incluye_climatizacion: false, actuaciones: ["pintura"],
          calidad: "media", ubicacion: "Madrid", estancias: [] } }),
      scenario === "retained-material" ? "comercio_local" : "construccion");
      await page.waitForFunction(() => window.harness.state.title === "Pintura 40 m2");
      const startedAt = Date.now();
      assert.equal(await page.evaluate(() => window.harness.analyzeWithAI(true)), true);
      await page.waitForFunction(() => !window.harness.state.isAnalyzing && window.harness.state.partidas.length >= 5);
      assert.equal(await page.evaluate(() => window.harness.saveDraft(true)), budgetId);
      assert.ok(writes.length > 0 && rows.length >= 5, "must reach the real revision writer");
      const missing = rows.filter(row => row.price_source_type === null).map(row => row.concept);
      assert.deepEqual(missing, [], `NULL en partidas NUEVAS guardadas (${scenario}): ${missing.join(", ")}`);
      const state = await page.evaluate(() => window.harness.state);
      if (scenario === "ai" || scenario === "retained-material") {
        const aiRows = rows.filter(row => row.price_source_type === "ai_estimate");
        assert.ok(aiRows.length >= 6, "the model's unresolved lines retain ai_estimate");
        for (const row of aiRows) {
          assert.equal(row.price_confidence, 0.20);
          assert.ok(Date.parse(row.price_checked_at) >= startedAt);
          assert.ok(Date.parse(row.price_checked_at) <= Date.now());
        }
        for (const item of [...analysisResults[0].suggested_items, ...analysisResults[0].suggested_materials]) {
          assert.equal(item.price_source_type, "ai_estimate", "a model cannot forge resolver evidence");
          assert.equal(item.price_confidence, 0.20);
        }
        const market = rows.find(row => row.concept === "Referencia mercado G3");
        assert.equal(market.price_source_type, "market_estimate");
        assert.equal(market.price_confidence, 0.35);
        assert.equal(market.price_checked_at, quoteDate);
        assert.equal(market.unit_price_cost, 14.5);
        const resolved = rows.find(row => row.concept === "Preparación técnica");
        assert.equal(resolved.price_source_type, "technical_bank");
        assert.equal(resolved.price_confidence, 0.82);
        assert.equal(resolved.price_checked_at, quoteDate);
        assert.equal(resolved.unit_price_cost, 12.5);
        assert.ok((await page.$eval("body", body => body.innerText)).includes(label));
        const savedMaterials = globalThis.__g3SavedBudget.wizard_state.materials;
        assert.ok(savedMaterials.length > 0, "material basket must reach the writer");
        assert.ok(savedMaterials.every(item => item.price_source_type != null && item.price_confidence != null && item.price_checked_at != null));
        if (scenario === "ai") {
          assert.ok(savedMaterials.some(row => row.price_source_type === "provider_updated"));
          assert.match(generateInternalPDFHTML(budget, state.internalView), /Estimación IA · sin fuente técnica/);
        } else {
          assert.equal(savedMaterials.find(row => row.name === "Pintura sin coincidencia").price_source_type, "ai_estimate");
          const retained = savedMaterials.find(row => row.name === "Pintura sin coincidencia");
          assert.equal(retained.sourceType, "ai_estimate");
          assert.equal(retained.confidenceScore, 0.20);
          assert.equal(retained.priceCheckedAt, retained.price_checked_at);
        }
        const clientHTML = generateBudgetPDFHTML(budget, rows, "client");
        assert.ok(!clientHTML.includes(label));
        assert.doesNotMatch(clientHTML, /ai_estimate|technical_bank|provider_updated/);
        for (const mode of ["internal", "client"]) {
          const pdf = await fetch(`${origin}/api/budgets/pdf`, { method: "POST",
            headers: { "content-type": "application/json" }, body: JSON.stringify({ budgetId, mode }) });
          assert.equal(pdf.status, 200);
          assert.equal(pdf.headers.get("X-Enlaze-PDF-Variant"), mode);
          const html = await pdf.text();
          assert.equal(html.includes(label), mode === "internal", `saved budget PDF: ${mode}`);
        }
        const target = state.partidas.find(item => item.price_source_type === "ai_estimate");
        await page.evaluate(id => window.harness.updatePartida(id, { unit_price: 37.5 }), target.id);
        await page.waitForFunction(id => window.harness.state.partidas.find(item => item.id === id)?.price_source_type === "user_edited", {}, target.id);
        assert.equal(await page.evaluate(() => window.harness.saveDraft(true)), budgetId);
        const edited = rows.find(row => row.concept === target.concept);
        assert.equal(edited.price_source_type, "user_edited");
        assert.equal(edited.price_confidence, 0.95);
        assert.equal(edited.unit_price_cost, 37.5);
        assert.ok(writes.some(write => write.fn === "save_budget"));
      } else {
        assert.ok(rows.every(row => row.price_source_type !== "ai_estimate"), "deterministic output is not AI");
        assert.ok(rows.some(row => row.price_source_type === "estimated" && row.price_confidence === 0.05));
      }
      console.log(`PASS ${scenario}: ${rows.length} líneas guardadas, 0 NULL`);
      await page.close();
    }
    assert.deepEqual(serverErrors, []);
    assert.deepEqual(browserErrors, []);
    assert.deepEqual(deniedRequests, [], "the application must not attempt external requests");
  } finally {
    delete globalThis.__g3Proposal;
    delete globalThis.__g3ModelUnavailable;
    delete globalThis.__g3SavedBudget;
    delete globalThis.__g3SavedItems;
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
