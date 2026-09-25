// E4 lote 2 — conducta real del gestor de enlaces en Chromium.
//
// Se monta el componente de producción y solo se dobla el transporte Supabase,
// las confirmaciones y los avisos. Si el componente intentara usar .from(),
// escribir almacenamiento o sacar un secreto por consola, la prueba falla.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXISTING_SECRET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ISSUED_SECRET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROTATED_SECRET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const projectId = "11111111-1111-4111-8111-111111111111";

const virtualModules = {
  "@/lib/supabase-browser": `
    const existing = {
      id: "old-token", project_id: "${projectId}", permissions: ["read"],
      label: "Cliente original", created_at: "2026-09-20T10:00:00.000Z",
      expires_at: "2026-12-20T10:00:00.000Z", is_active: true,
      revoked_at: null, is_live: true,
    };
    let rows = [existing];
    let issuedCount = 0;
    window.__rpcCalls = [];
    window.__existingSecret = "${EXISTING_SECRET}";
    const issued = (secret, id, label, permissions) => ({
      id, project_id: "${projectId}", token: secret, permissions,
      label, created_at: "2026-09-24T10:00:00.000Z",
      expires_at: "2026-12-23T10:00:00.000Z", is_active: true, revoked_at: null,
    });
    export function createClient() {
      return {
        rpc: async (name, args) => {
          window.__rpcCalls.push({ name, args });
          if (name === "portal_list_tokens") {
            return { data: { items: structuredClone(rows), next_cursor: null }, error: null };
          }
          if (name === "portal_issue_token") {
            issuedCount += 1;
            const fresh = issued("${ISSUED_SECRET}", "issued-token-" + issuedCount,
              args.p_label, args.p_permissions);
            rows = [{ ...fresh, token: undefined, is_live: true }, ...rows]
              .map(({ token, ...metadata }) => metadata);
            return { data: fresh, error: null };
          }
          if (name === "portal_rotate_token") {
            rows = rows.map((row) => row.id === args.p_token_id
              ? { ...row, is_active: false, is_live: false, revoked_at: "2026-09-24T11:00:00.000Z" }
              : row);
            const fresh = issued("${ROTATED_SECRET}", "rotated-token", "Cliente renovado", ["read"]);
            rows = [{ ...fresh, is_live: true }, ...rows].map(({ token, ...metadata }) => metadata);
            return { data: { issued: fresh, revoked: rows.find((row) => row.id === args.p_token_id) }, error: null };
          }
          if (name === "portal_revoke_token") {
            rows = rows.map((row) => row.id === args.p_token_id
              ? { ...row, is_active: false, is_live: false, revoked_at: "2026-09-24T12:00:00.000Z" }
              : row);
            return { data: rows.find((row) => row.id === args.p_token_id), error: null };
          }
          return { data: null, error: { code: "XX000", message: "RPC inesperada: " + name } };
        },
      };
    }
  `,
  "@/components/ui/toast": `
    const api = {
      success: (title, options) => window.__toasts.push({ kind: "success", title, options }),
      error: (title, options) => window.__toasts.push({ kind: "error", title, options }),
      warning: (title, options) => window.__toasts.push({ kind: "warning", title, options }),
    };
    export function useToast() {
      return api;
    }
  `,
  "@/components/ui/confirm-dialog": `
    export function useConfirm() {
      return async (options) => { window.__confirms.push(options); return true; };
    }
  `,
};

const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import PortalLinksDialog from "@/app/dashboard/projects/_components/PortalLinksDialog";
  window.__toasts = [];
  window.__confirms = [];
  window.__copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (value) => window.__copied.push(value) },
  });
  const root = createRoot(document.getElementById("root"));
  window.__mount = () => root.render(React.createElement(PortalLinksDialog, {
    projectId: "${projectId}", projectName: "Obra segura", onClose: () => root.render(null),
  }));
  window.__mount();
`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: "portal-links-harness.tsx", loader: "tsx" },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    process: JSON.stringify({ env: { NODE_ENV: "production" } }),
  },
  plugins: [{
    name: "portal-links-test-dependencies",
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

const clickText = (page, text) => page.evaluate((wanted) => {
  const button = [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === wanted);
  if (!button) throw new Error(`No se encontró el botón ${wanted}`);
  button.click();
}, text);

try {
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleMessages = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => consoleMessages.push(message.text()));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (new URL(request.url()).origin === origin) request.continue();
    else request.abort();
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => document.body.innerText.includes("Cliente original"), { timeout: 15000 });
  } catch (error) {
    const body = await page.evaluate(() => document.body.innerText.slice(0, 1200));
    throw new Error(`El gestor no terminó de montar. body=${JSON.stringify(body)} pageErrors=${JSON.stringify(pageErrors)} console=${JSON.stringify(consoleMessages)}`, { cause: error });
  }

  assert.equal((await page.evaluate(() => document.body.innerText)).includes(EXISTING_SECRET), false,
    "el listado nunca pinta un secreto existente");
  assert.deepEqual(await page.evaluate(() => window.__rpcCalls.map((call) => call.name)), ["portal_list_tokens"]);

  await clickText(page, "Crear enlace");
  await page.type("#portal-link-label", "Dirección facultativa");
  await page.select("#portal-link-lifetime", "30");
  const optional = await page.$$('fieldset input[type="checkbox"]');
  await optional[1].click();
  await clickText(page, "Crear y copiar");
  await page.waitForFunction(() => document.querySelector('[aria-label="Enlace recién emitido"]') !== null);
  const issuedUrl = await page.$eval('[aria-label="Enlace recién emitido"]', (node) => node.value);
  assert.equal(issuedUrl, `${origin}/portal/${ISSUED_SECRET}`);
  assert.equal((await page.evaluate(() => window.__copied.at(-1))), issuedUrl,
    "el secreto se copia en el momento de emisión");
  const issueCall = await page.evaluate(() => window.__rpcCalls.find((call) => call.name === "portal_issue_token"));
  assert.deepEqual(issueCall.args.p_permissions, ["read", "approve_changes"]);
  assert.equal(issueCall.args.p_label, "Dirección facultativa");

  const storage = await page.evaluate(() => JSON.stringify({
    local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie,
  }));
  assert.equal(storage.includes(ISSUED_SECRET), false, "el secreto no se persiste en el navegador");

  await clickText(page, "Cerrar");
  await page.waitForFunction((secret) => !document.body.innerText.includes(secret), {}, ISSUED_SECRET);
  await page.evaluate(() => window.__mount());
  await page.waitForFunction(() => document.body.innerText.includes("Dirección facultativa"));
  assert.equal((await page.evaluate(() => document.body.innerText)).includes(ISSUED_SECRET), false,
    "al reabrir solo vuelve el metadato");

  await clickText(page, "Renovar");
  await page.waitForFunction((secret) => document.querySelector('[aria-label="Enlace recién emitido"]')?.value.includes(secret), {}, ROTATED_SECRET);
  assert.equal((await page.evaluate(() => window.__copied.at(-1))), `${origin}/portal/${ROTATED_SECRET}`);
  assert.match((await page.evaluate(() => window.__confirms.at(-1).title)), /Renovar enlace/);

  await clickText(page, "Revocar");
  await page.waitForFunction(() => window.__rpcCalls.some((call) => call.name === "portal_revoke_token"));
  await page.waitForFunction(() => document.querySelector('[aria-label="Enlace recién emitido"]') === null);
  assert.match((await page.evaluate(() => window.__confirms.at(-1).title)), /Revocar enlace/);

  const rpcNames = await page.evaluate(() => window.__rpcCalls.map((call) => call.name));
  assert.equal(rpcNames.every((name) => [
    "portal_list_tokens", "portal_issue_token", "portal_rotate_token", "portal_revoke_token",
  ].includes(name)), true, "la interfaz solo usa las RPC autorizadas");
  assert.equal(consoleMessages.join("\n").includes(ISSUED_SECRET), false, "el secreto emitido no sale por consola");
  assert.equal(consoleMessages.join("\n").includes(ROTATED_SECRET), false, "el secreto rotado no sale por consola");
  assert.deepEqual(pageErrors, []);
  await page.close();
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
