// Endurecimiento E4 — aislamiento de telemetría en /portal/<secreto>.
//
// Monta el AnalyticsProvider real en Chromium sobre loopback, con un secreto
// centinela en la ruta, y comprueba que ese centinela no acaba en ningún sitio
// desde el que pueda salir del navegador: eventos de PostHog, eventos de
// Sentry, consola, errores no capturados, localStorage, sessionStorage ni
// cookies.
//
// Los dobles sustituyen el transporte (posthog-js y @sentry/nextjs), no la
// lógica: la decisión de no inicializar, el saneado y la parada de Replay son
// el código de producción.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SENTINEL = "s3nt1nel-9f4c-4b2a-8e77-por7alt0k3n";

const virtualModules = {
  "next/navigation": `
    export function usePathname() { return window.__pathname; }
    export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() {} }; }
  `,
  "posthog-js": `
    // Doble del transporte. Registra todo y, como el posthog real, escribe en
    // localStorage lo que se le pase en init para poder auditar el almacenamiento.
    const calls = [];
    const api = {
      init(key, options) {
        calls.push({ kind: "init", key, options });
        window.__posthogOptions = options;
        try {
          localStorage.setItem("ph_fake_initial_url", String(window.location.href));
        } catch {}
        options?.loaded?.(api);
      },
      capture(event, properties) {
        // Igual que el SDK: sanitize_properties corre antes de enviar.
        const hook = window.__posthogOptions?.sanitize_properties;
        calls.push({ kind: "capture", event, properties: hook ? hook(properties, event) : properties });
      },
      identify(id, traits) { calls.push({ kind: "identify", id, traits }); },
      reset() { calls.push({ kind: "reset" }); },
      debug() {},
    };
    window.__posthogCalls = calls;
    export default api;
  `,
  "@sentry/nextjs": `
    // Doble del transporte de Sentry: aplica los hooks reales del proyecto y
    // guarda lo que de verdad se enviaría.
    import { portalScrubbingOptions } from ${JSON.stringify(path.join(root, "lib/sentry-portal-scrubbing.ts"))};
    window.__sentryEvents = [];
    window.__replayStopped = false;
    const replay = { name: "Replay", stop() { window.__replayStopped = true; } };
    export function getClient() {
      return { getIntegrationByName: (name) => (name === "Replay" && window.__replayRunning ? replay : undefined) };
    }
    export function setUser(user) { window.__sentryEvents.push({ kind: "user", user }); }
    export function withScope(run) { run({ setTag() {}, setExtras() {} }); }
    export function captureException(error) {
      const event = portalScrubbingOptions.beforeSend({
        exception: { values: [{ value: String(error?.message ?? error) }] },
        request: { url: window.location.href },
        breadcrumbs: [{ category: "navigation", data: { to: window.location.pathname } }],
      });
      if (event) window.__sentryEvents.push({ kind: "event", event });
    }
    export function replayIntegration() { return replay; }
  `,
  "@/lib/supabase-browser": `
    export function createClient() {
      return { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
    }
  `,
};

const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import AnalyticsProvider from "@/components/AnalyticsProvider";
  import { captureException } from "@/lib/sentry";
  window.__mount = () => createRoot(document.getElementById("root"))
    .render(React.createElement(AnalyticsProvider, null, React.createElement("p", null, "hola")));
  window.__captureException = captureException;
`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: "telemetry-harness.tsx", loader: "tsx" },
  bundle: true, write: false, format: "iife", platform: "browser", target: "chrome120",
  jsx: "automatic",
  define: { "process.env.NEXT_PUBLIC_POSTHOG_KEY": JSON.stringify("phc_test_key"),
            "process.env.NEXT_PUBLIC_POSTHOG_HOST": JSON.stringify("http://127.0.0.1:1/never"),
            "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [{
    name: "isolated-telemetry-dependencies",
    setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path: specifier }) => {
        if (Object.hasOwn(virtualModules, specifier)) return { path: specifier, namespace: "isolated" };
        if (!specifier.startsWith("@/")) return null;
        const base = path.join(root, specifier.slice(2));
        const resolved = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`,
          path.join(base, "index.ts")].find((candidate) => existsSync(candidate));
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

async function open(pathname, { replayRunning = false } = {}) {
  const page = await browser.newPage();
  const console_ = [];
  const pageErrors = [];
  page.on("console", (message) => console_.push(message.text()));
  page.on("pageerror", (error) => pageErrors.push(`${error.message}\n${error.stack ?? ""}`));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    // Nada sale de este servidor local: si la telemetría intentara mandar algo
    // de verdad, se vería aquí como petición abortada.
    const url = request.url();
    if (new URL(url).origin === origin) request.continue();
    else { page.__escapes.push(url); request.abort(); }
  });
  page.__escapes = [];
  page.__console = console_;
  page.__pageErrors = pageErrors;
  // La URL real del navegador lleva el centinela, igual que en producción.
  await page.goto(`${origin}${pathname}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((args) => {
    window.__pathname = args.pathname;
    window.__replayRunning = args.replayRunning;
  }, { pathname, replayRunning });
  await page.evaluate(() => window.__mount());
  await page.waitForFunction(() => document.querySelector("#root p") !== null, { timeout: 15000 });
  return page;
}

const storageDump = (page) => page.evaluate(() => {
  const read = (store) => { try { return JSON.stringify(Object.entries({ ...store })); } catch { return ""; } };
  return [read(localStorage), read(sessionStorage), document.cookie].join("\n");
});

try {
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });

  // ── El portal: nada de lo que se recoge puede llevar el centinela ────────
  const portal = await open(`/portal/${SENTINEL}`, { replayRunning: true });
  // Un error real en la página del portal, que es el caso peligroso: Sentry
  // adjunta request.url y breadcrumbs de navegación.
  await portal.evaluate(() => window.__captureException(
    new Error(`fallo cargando ${window.location.href}`)));

  // posthog-js se carga con import dinámico dentro de initAnalytics. Si el
  // módulo ni siquiera llegó a evaluarse, es que se volvió antes: en el portal
  // no hay SDK cargado, no solo eventos filtrados.
  const calls = await portal.evaluate(() => window.__posthogCalls ?? null);
  assert.equal(calls, null,
    "en el portal no se carga ni el SDK de PostHog: initAnalytics vuelve antes del import");

  const sentryEvents = await portal.evaluate(() => JSON.stringify(window.__sentryEvents));
  assert.equal(sentryEvents.includes(SENTINEL), false, "el centinela no sale en ningún evento de Sentry");
  assert.match(sentryEvents, /\/portal\/\[token\]/, "y lo que sale es la ruta enmascarada");

  assert.equal(await portal.evaluate(() => window.__replayStopped), true,
    "Session Replay se para al entrar en el portal");

  const almacenamiento = await storageDump(portal);
  assert.equal(almacenamiento.includes(SENTINEL), false,
    "ni localStorage, ni sessionStorage, ni cookies guardan el centinela");

  assert.equal(portal.__console.join("\n").includes(SENTINEL), false,
    "el centinela no se escribe en consola");
  assert.deepEqual(portal.__pageErrors, [], "la página no lanza");
  assert.deepEqual(portal.__escapes, [], "no se intenta enviar nada fuera del loopback");
  await portal.close();

  // ── Control: fuera del portal la telemetría sigue funcionando ────────────
  // Sin esto, el test pasaría igual si la telemetría estuviera rota del todo.
  const dashboard = await open("/dashboard/projects/abc-123");
  // El pageview llega tras resolverse el import dinámico del SDK.
  await dashboard.waitForFunction(
    () => window.__posthogCalls?.some((c) => c.kind === "capture" && c.event === "$pageview"),
    { timeout: 10000 });
  const dashCalls = await dashboard.evaluate(() => window.__posthogCalls);
  assert.equal(dashCalls.some((c) => c.kind === "init"), true, "fuera del portal sí se inicializa");
  const pageview = dashCalls.find((c) => c.kind === "capture" && c.event === "$pageview");
  assert.ok(pageview, "y sí se emite el pageview");
  assert.equal(pageview.properties.$current_url, "/dashboard/projects/abc-123");
  assert.equal(await dashboard.evaluate(() => window.__posthogOptions.capture_pageview), false,
    "el pageview automático sigue desactivado: capturaría la URL cruda");
  assert.equal(await dashboard.evaluate(() => window.__replayStopped), false,
    "y fuera del portal no se para la grabación");
  assert.deepEqual(dashboard.__pageErrors, []);
  await dashboard.close();

  // ── Control: aunque un evento llevara la URL del portal, se redacta ──────
  const mixed = await open("/dashboard/projects/abc-123");
  const redacted = await mixed.evaluate((sentinel) => {
    const hook = window.__posthogOptions.sanitize_properties;
    return JSON.stringify(hook({ $current_url: `/portal/${sentinel}`, referrer: `/portal/${sentinel}` }));
  }, SENTINEL);
  assert.equal(redacted.includes(SENTINEL), false,
    "sanitize_properties limpia cualquier propiedad que traiga la ruta del portal");
  await mixed.close();

  console.log("PASS: /portal/<secreto> no llega a PostHog, Sentry, Replay, consola ni almacenamiento");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
