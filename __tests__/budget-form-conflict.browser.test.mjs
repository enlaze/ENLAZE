// FASE 2F-2 · F3 lote 2 — el formulario manual ante un PT409.
//
// Monta el componente real en Chromium sobre loopback, con las dependencias
// externas sustituidas por dobles: lo que se ejercita es la conducta del
// formulario, no una expresión regular sobre su código. El detector de
// conflictos es el de verdad, importado del escritor.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const budgetId = "11111111-1111-4111-8111-111111111111";
const realWriter = path.join(root, "lib/budget-revision-writer.ts");

const virtualModules = {
  "next/navigation": `
    export function useRouter() {
      return { push: (href) => window.__navigations.push(href), replace() {}, refresh() {}, back() {} };
    }
  `,
  "next/link": `
    import React from "react";
    export default function Link({ children, href }) {
      return React.createElement("a", { href }, children);
    }
  `,
  "@/lib/sector-context": `
    // Mismo contrato que lib/sector-context: son funciones, no colecciones.
    export function useSector() {
      return {
        serviceTypes: () => [{ value: "reforma", label: "Reforma" }],
        budgetCategories: () => [{ value: "material", label: "Material" }],
        options: () => [],
      };
    }
  `,
  "@/components/ui/page-header": `
    import React from "react";
    export default function PageHeader({ title }) { return React.createElement("h1", null, title); }
  `,
  "@/components/ui/card": `
    import React from "react";
    export function Card({ children }) { return React.createElement("section", null, children); }
    export function StatCard() { return null; }
  `,
  "@/components/ui/toast": `
    export function useToast() {
      return {
        success: (message, extra) => window.__toasts.push({ kind: "success", message, extra }),
        error: (message, extra) => window.__toasts.push({ kind: "error", message, extra }),
      };
    }
  `,
  "@/lib/analytics": `export const analytics = { budgetCreated() {}, budgetStatusChanged() {} };`,
  "@/lib/supabase-browser": `
    const budget = {
      id: "${budgetId}", user_id: "user-1", lock_version: 7, title: "Presupuesto base",
      client_id: null, project_id: null, client_name: "Cliente", client_email: "", client_phone: "",
      client_address: "", service_type: "reforma", valid_until: null, iva_percent: 21, notes: "",
      deposit_percent: 30, payment_method: "Transferencia bancaria", payment_iban: "",
      discount_type: "percent", discount_percent: 0, discount_amount: 0, payment_schedule: [],
      warranty_text: "", execution_deadline_text: "", observations: "", conditions_text: "",
    };
    const items = [{
      id: "item-1", concept: "Partida existente", description: "", quantity: 2, unit: "ud",
      category: "material", unit_price: 100, subtotal: 200, sort_order: 0,
    }];
    const rows = { clients: [], projects: [], fiscal_settings: { iban: "" }, budgets: budget, budget_items: items };
    function chain(table) {
      const value = rows[table];
      const q = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: () => Promise.resolve({ data: Array.isArray(value) ? value[0] ?? null : value, error: null }),
        single: () => Promise.resolve({ data: Array.isArray(value) ? value[0] ?? null : value, error: null }),
        then: (resolve, reject) =>
          Promise.resolve({ data: Array.isArray(value) ? value : [value], error: null }).then(resolve, reject),
      };
      return q;
    }
    export function createClient() {
      return {
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
        from: chain,
      };
    }
  `,
  "@/lib/budget-revision-writer": `
    // Detección y traducción reales: el doble solo sustituye el transporte.
    export { budgetRevisionErrorMessage, isBudgetRevisionConflict } from ${JSON.stringify(realWriter)};
    export async function saveBudgetRevision(_client, id, version) {
      window.__attempts.push({ id, version });
      const mode = window.__saveMode;
      if (mode === "conflict") {
        const error = new Error("Budget revision conflict");
        error.code = "PT409";
        throw error;
      }
      if (mode === "generic") {
        const error = new Error("Boom de red");
        error.code = "XX000";
        throw error;
      }
      return { budget_id: id, lock_version: version + 1, version: 1, status: "pendiente", previous_status: "pendiente", items_count: 1 };
    }
    export async function createBudgetWithItems() { throw Error("Unexpected create"); }
    export async function finalizeBudgetRevision() { throw Error("Unexpected finalize"); }
  `,
};

const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { BudgetForm } from "@/app/dashboard/budgets/_components/budget-form";
  window.__attempts = [];
  window.__toasts = [];
  window.__navigations = [];
  window.__saveMode = "ok";
  createRoot(document.getElementById("root")).render(
    React.createElement(BudgetForm, { editBudgetId: ${JSON.stringify(budgetId)} })
  );
`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: "form-harness.tsx", loader: "tsx" },
  bundle: true, write: false, format: "iife", platform: "browser", target: "chrome120",
  jsx: "automatic",
  plugins: [{
    name: "isolated-form-dependencies",
    setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path: specifier }) => {
        if (Object.hasOwn(virtualModules, specifier)) return { path: specifier, namespace: "isolated" };
        if (!specifier.startsWith("@/")) return null;
        const base = path.join(root, specifier.slice(2));
        const resolved = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, path.join(base, "index.ts")]
          .find((candidate) => existsSync(candidate));
        if (!resolved) throw new Error(`Cannot resolve local module: ${specifier}`);
        return { path: resolved };
      });
      build.onLoad({ filter: /.*/, namespace: "isolated" }, ({ path: specifier }) => ({
        // resolveDir permite que el doble importe react y el escritor real.
        contents: virtualModules[specifier], loader: "jsx", resolveDir: root,
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

async function openForm(mode) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.browserErrors = pageErrors;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    // Nada puede salir de este servidor local.
    if (new URL(request.url()).origin === origin) request.continue();
    else request.abort();
  });
  await page.goto(`${origin}/${mode}`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => document.querySelector('button[type="submit"]') !== null, { timeout: 15000 });
  } catch (error) {
    const text = await page.evaluate(() => document.body.innerText.slice(0, 400));
    throw Error(`El formulario no renderizó. texto=${JSON.stringify(text)} pageErrors=${JSON.stringify(pageErrors)}`, { cause: error });
  }
  await page.evaluate((next) => { window.__saveMode = next; }, mode);
  return page;
}
const submit = (page) => page.evaluate(() => document.querySelector('button[type="submit"]').click());
const dialog = (page) => page.evaluate(() => {
  const node = document.querySelector('[role="alertdialog"]');
  if (!node) return null;
  return {
    modal: node.getAttribute("aria-modal"),
    labelled: document.getElementById(node.getAttribute("aria-labelledby"))?.textContent ?? null,
    described: document.getElementById(node.getAttribute("aria-describedby"))?.textContent ?? null,
    action: [...node.querySelectorAll("button")].map((b) => b.textContent.trim()),
  };
});
const disabled = (page) => page.evaluate(() => document.querySelector('button[type="submit"]').disabled);

try {
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });

  // --- PT409 -------------------------------------------------------------
  const conflict = await openForm("conflict");
  await submit(conflict);
  await conflict.waitForFunction(() => document.querySelector('[role="alertdialog"]') !== null, { timeout: 10000 });
  const shown = await dialog(conflict);
  assert.equal(shown.modal, "true", "el diálogo debe ser modal");
  assert.match(shown.labelled, /Este presupuesto cambió en otra sesión/);
  assert.match(shown.described, /recargar la versión más reciente/i);
  assert.match(shown.described, /descartarán los cambios sin guardar/i);
  assert.deepEqual(shown.action, ["Recargar versión más reciente"], "una sola acción, explícita");
  assert.deepEqual(await conflict.evaluate(() => window.__navigations), [], "no se navega a la ficha");
  assert.deepEqual(
    await conflict.evaluate(() => window.__toasts.filter((t) => t.kind === "success")), [],
    "no se comunica éxito",
  );
  assert.equal((await conflict.evaluate(() => window.__attempts)).length, 1, "un solo intento");
  assert.equal(await disabled(conflict), true, "el guardado queda bloqueado");
  // Un segundo envío desde la pestaña obsoleta no vuelve a llamar al escritor.
  await conflict.evaluate(() => document.querySelector("form").requestSubmit());
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await conflict.evaluate(() => window.__attempts)).length, 1, "no se reintenta");
  assert.equal(
    (await conflict.evaluate(() => window.__attempts))[0].version, 7,
    "no se adopta otra revisión: se conserva la que cargó la pestaña",
  );
  assert.deepEqual(conflict.browserErrors, []);
  await conflict.close();

  // --- Error genérico: conducta anterior intacta ---------------------------
  const generic = await openForm("generic");
  await submit(generic);
  await generic.waitForFunction(() => window.__toasts.some((t) => t.kind === "error"), { timeout: 10000 });
  assert.equal(await dialog(generic), null, "un error corriente no abre el diálogo de conflicto");
  const genericToast = (await generic.evaluate(() => window.__toasts)).at(-1);
  assert.equal(genericToast.message, "No se pudieron guardar los cambios");
  assert.match(genericToast.extra.description, /Boom de red/);
  assert.deepEqual(await generic.evaluate(() => window.__navigations), [], "tampoco navega");
  assert.equal(await disabled(generic), false, "el botón vuelve a estar disponible");
  assert.deepEqual(generic.browserErrors, []);
  await generic.close();

  // --- Guardado correcto ---------------------------------------------------
  const ok = await openForm("ok");
  await submit(ok);
  await ok.waitForFunction(() => window.__navigations.length === 1, { timeout: 10000 });
  assert.equal(await dialog(ok), null, "sin conflicto no hay diálogo");
  assert.deepEqual(await ok.evaluate(() => window.__navigations), [`/dashboard/budgets/${budgetId}`]);
  assert.ok(
    (await ok.evaluate(() => window.__toasts)).some((t) => t.kind === "success" && /actualizado/i.test(t.message)),
    "el guardado correcto sí comunica éxito",
  );
  assert.equal((await ok.evaluate(() => window.__attempts))[0].version, 7, "envía la revisión cargada");
  assert.deepEqual(ok.browserErrors, []);
  await ok.close();

  console.log("PASS: el formulario bloquea la pestaña obsoleta tras PT409, conserva su revisión y mantiene el resto de errores igual");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
