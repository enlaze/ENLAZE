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
    import { useSyncExternalStore } from "react";
    // Suscripción a los cambios que provoca __navigate, como haría el router.
    const listeners = new Set();
    window.__routeChanged = () => listeners.forEach((l) => l());
    const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
    export function usePathname() {
      return useSyncExternalStore(subscribe, () => window.__pathname, () => window.__pathname);
    }
    export function useSearchParams() {
      const query = useSyncExternalStore(
        subscribe, () => window.location.search, () => window.location.search);
      return new URLSearchParams(query);
    }
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
      // Lo que el SDK real haría al cambiar de ruta si capture_pageleave
      // estuviera activo. Aquí solo se dispara si la opción lo permite.
      __maybePageleave() {
        if (!window.__posthogOptions?.capture_pageleave) return;
        api.capture("$pageleave", { $current_url: String(window.location.href) });
      },
      identify(id, traits) { calls.push({ kind: "identify", id, traits }); },
      reset() { calls.push({ kind: "reset" }); },
      debug() {},
    };
    window.__posthogCalls = calls;
    window.__posthogApi = api;
    export default api;
  `,
  "@sentry/nextjs": `
    // Doble del transporte de Sentry: aplica los hooks reales del proyecto y
    // guarda lo que de verdad se enviaría.
    import { portalScrubbingOptions } from ${JSON.stringify(path.join(root, "lib/sentry-portal-scrubbing.ts"))};
    window.__sentryEvents = [];
    export function getClient() { return { getIntegrationByName: () => undefined }; }
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
  `,
  "@/lib/supabase-browser": `
    export function createClient() {
      return { auth: { getUser: () => new Promise((resolve) => {
        const user = window.__user ?? null;
        // Con __holdGetUser la respuesta queda pendiente hasta que la prueba la
        // suelta: así se puede navegar al portal mientras está en vuelo.
        if (window.__holdGetUser) window.__releaseGetUser = () =>
          resolve({ data: { user }, error: null });
        else resolve({ data: { user }, error: null });
      }) } };
    }
  `,
};

const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import AnalyticsProvider from "@/components/AnalyticsProvider";
  import { captureException } from "@/lib/sentry";
  import { analytics, identifyUser } from "@/lib/analytics";
  let root;
  const paint = () => root.render(
    React.createElement(AnalyticsProvider, null, React.createElement("p", null, "hola")));
  window.__mount = () => { root = createRoot(document.getElementById("root")); paint(); };
  /* Navegación SPA: el router cambia la URL con history.pushState y vuelve a
     renderizar con el pathname nuevo. No hay recarga, así que ni el bundle ni
     Sentry ni PostHog se reinicializan: ese es justo el caso a cubrir. */
  window.__navigate = (next) => {
    history.pushState({}, "", next);
    window.__pathname = new URL(next, location.origin).pathname;
    const ph = window.__posthogCalls && window.__posthogApi;
    if (ph) window.__posthogApi.__maybePageleave();
    window.__routeChanged();
    paint();
  };
  // Intento explícito de emitir un evento de producto, venga de donde venga.
  window.__emitProductEvent = () => analytics.clientCreated();
  window.__identify = () => identifyUser("user-forzado", { email: "x@y.z" });
  window.__captureException = captureException;
`;

/* ESM con splitting, no IIFE: así el `import("posthog-js")` de lib/analytics
   sigue siendo un import dinámico de verdad, que el navegador pide por red. El
   servidor de abajo puede retener ese chunk y dejar la inicialización en vuelo
   mientras la pestaña navega al portal, que es el caso que hay que probar. */
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: "telemetry-harness.tsx", loader: "tsx" },
  bundle: true, write: false, format: "esm", splitting: true, outdir: "/out",
  platform: "browser", target: "chrome120",
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

// Cada salida de esbuild por su nombre. La entrada es stdin.js.
const chunks = new Map(bundle.outputFiles.map((f) => [path.posix.basename(f.path), f.contents]));
const entryName = [...chunks.keys()].find((n) => n.startsWith("stdin"));
// El chunk que contiene el SDK: el que menciona la marca del doble.
const posthogChunk = [...chunks.entries()]
  .find(([name, body]) => name !== entryName && Buffer.from(body).includes("__posthogApi"))?.[0];

/* Cuando está puesto, el servidor no responde el chunk del SDK hasta que la
   prueba lo suelte. Es el único modo de dejar el import dinámico realmente en
   vuelo mientras se navega. */
let holdPosthogChunk = null;

const server = createServer(async (request, response) => {
  const name = path.posix.basename((request.url ?? "/").split("?")[0]);
  if (chunks.has(name)) {
    if (name === posthogChunk && holdPosthogChunk) await holdPosthogChunk;
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(Buffer.from(chunks.get(name)));
  } else {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><body><div id="root"></div>` +
      `<script type="module" src="/${entryName}"></script></body></html>`);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

async function open(pathname, { query = "", user = null, holdGetUser = false } = {}) {
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
  await page.goto(`${origin}${pathname}${query}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((args) => {
    window.__pathname = args.pathname;
    window.__user = args.user;
    window.__holdGetUser = args.holdGetUser;
  }, { pathname, user, holdGetUser });
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
  const portal = await open(`/portal/${SENTINEL}`);
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
  assert.match(pageview.properties.$current_url, /^http:\/\/127\.0\.0\.1:\d+\/dashboard\/projects\/abc-123$/,
    "URL completa, como mandaba la captura automática que esto sustituye");
  assert.equal(pageview.properties.$pathname, "/dashboard/projects/abc-123");
  assert.equal(await dashboard.evaluate(() => window.__posthogOptions.capture_pageview), false,
    "el pageview automático sigue desactivado: capturaría la URL cruda");
  assert.equal(dashCalls.filter((c) => c.kind === "init").length, 1,
    "exactamente un posthog.init: los dos efectos llaman a initAnalytics en el " +
    "mismo tick y `initialized` solo se pone a true tras el import dinámico");
  assert.deepEqual(dashboard.__pageErrors, []);
  await dashboard.close();

  // ── El pageview conserva host, query y UTM, como la captura automática ───
  const utm = await open("/dashboard/projects/abc-123",
    { query: "?utm_source=boletin&utm_campaign=marzo&ref=x" });
  await utm.waitForFunction(
    () => window.__posthogCalls?.some((c) => c.kind === "capture" && c.event === "$pageview"),
    { timeout: 10000 });
  const utmView = (await utm.evaluate(() => window.__posthogCalls))
    .find((c) => c.kind === "capture" && c.event === "$pageview");
  assert.match(utmView.properties.$current_url, /^http:\/\/127\.0\.0\.1:\d+\/dashboard\/projects\/abc-123\?/,
    "$current_url es la URL completa con host, no el pathname suelto");
  assert.match(utmView.properties.$current_url, /utm_source=boletin/, "la atribución de campaña sobrevive");
  assert.match(utmView.properties.$current_url, /utm_campaign=marzo/);
  assert.equal(utmView.properties.$pathname, "/dashboard/projects/abc-123");
  assert.equal(await utm.evaluate(() => window.__posthogOptions.capture_pageview), false);
  await utm.close();

  // ── Control: aunque un evento llevara la URL del portal, se redacta ──────
  const mixed = await open("/dashboard/projects/abc-123");
  const redacted = await mixed.evaluate((sentinel) => {
    const hook = window.__posthogOptions.sanitize_properties;
    return JSON.stringify(hook({ $current_url: `/portal/${sentinel}`, referrer: `/portal/${sentinel}` }));
  }, SENTINEL);
  assert.equal(redacted.includes(SENTINEL), false,
    "sanitize_properties limpia cualquier propiedad que traiga la ruta del portal");
  await mixed.close();

  // ── Navegación SPA: dashboard → portal en la MISMA pestaña ──────────────
  /* El caso que faltaba. Al llegar al portal con una carga completa, PostHog no
     se inicializa nunca. Pero si el usuario ya estaba en el dashboard, el SDK
     está inicializado y el bundle no se vuelve a evaluar: la decisión sobre
     Replay y sobre PostHog ya se tomó con la ruta anterior. */
  const spa = await open("/dashboard/projects/abc-123");
  await spa.waitForFunction(
    () => window.__posthogCalls?.some((c) => c.kind === "capture" && c.event === "$pageview"),
    { timeout: 10000 });
  assert.equal(
    (await spa.evaluate(() => window.__posthogCalls)).filter((c) => c.kind === "init").length, 1,
    "el dashboard inicializa PostHog una sola vez");

  const antes = (await spa.evaluate(() => window.__posthogCalls)).length;
  await spa.evaluate((sentinel) => window.__navigate(`/portal/${sentinel}`), SENTINEL);
  // Margen para que cualquier efecto tardío llegue a emitir algo.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const tras = await spa.evaluate(() => window.__posthogCalls);
  assert.equal(tras.length, antes,
    "desde el portal no sale ningún evento: ni pageview, ni pageleave, ni nada");
  assert.equal(tras.filter((c) => c.kind === "init").length, 1,
    "y no se reinicializa al navegar");
  assert.equal(await spa.evaluate(() => window.__posthogOptions.capture_pageleave), false,
    "pageleave desactivado: si no, el SDK emitiría desde /portal/<secreto>");

  /* Intento explícito de emitir un evento de producto y de identificar, con
     PostHog YA inicializado en el dashboard. Es el caso en que `initialized`
     vale true y lo único que puede frenarlo es la comprobación de ruta dentro
     de trackEvent e identifyUser. */
  await spa.evaluate(() => window.__emitProductEvent());
  await spa.evaluate(() => window.__identify());
  await new Promise((resolve) => setTimeout(resolve, 200));
  const trasForzar = await spa.evaluate(() => window.__posthogCalls);
  assert.equal(trasForzar.length, antes,
    "con el SDK vivo, un evento de producto forzado desde el portal tampoco sale");
  assert.deepEqual(trasForzar.filter((c) => c.kind === "identify"), [],
    "ni se identifica a nadie desde el portal");

  // El centinela está en la URL real de la pestaña, así que la prueba es real.
  assert.match(await spa.evaluate(() => window.location.pathname), new RegExp(SENTINEL),
    "la barra de direcciones lleva de verdad el secreto");

  // Y un error en el portal tras la navegación tampoco lo filtra.
  await spa.evaluate(() => window.__captureException(
    new Error(`fallo tras navegar a ${window.location.href}`)));

  const huella = [
    JSON.stringify(tras),
    JSON.stringify(await spa.evaluate(() => window.__sentryEvents)),
    await storageDump(spa),
    spa.__console.join("\n"),
    spa.__pageErrors.join("\n"),
    spa.__escapes.join("\n"),
  ].join("\n");
  assert.equal(huella.includes(SENTINEL), false,
    "ni eventos, ni Sentry, ni almacenamiento, ni consola, ni errores, ni peticiones");
  assert.deepEqual(spa.__escapes, [], "nada intenta salir del loopback");
  assert.deepEqual(spa.__pageErrors, []);
  assert.equal(await spa.evaluate(() => window.__posthogOptions.capture_pageview), false);
  await spa.close();

  // ── Navegación al portal MIENTRAS la inicialización está pendiente ──────
  /* initAnalytics mira la ruta antes del import dinámico de posthog-js. Ese
     import tarda, y la pestaña puede navegar al portal mientras está en vuelo:
     el init llegaría estando ya en /portal/<secreto> y escribiría
     $initial_current_url —con el secreto— en localStorage y en la cookie del
     cliente final.

     Aquí el import se retiene de verdad: el servidor no entrega el chunk del
     SDK hasta que esta prueba lo suelte. */
  assert.ok(posthogChunk, "hace falta identificar el chunk del SDK para retenerlo");
  let soltarChunk;
  holdPosthogChunk = new Promise((resolve) => { soltarChunk = resolve; });
  const enVuelo = await open("/dashboard/projects/abc-123");
  // El SDK no ha podido cargarse todavía.
  assert.equal(await enVuelo.evaluate(() => window.__posthogCalls ?? null), null,
    "el import sigue en vuelo: el SDK aún no se ha evaluado");

  // Con la inicialización a medias, la pestaña se va al portal.
  await enVuelo.evaluate((sentinel) => window.__navigate(`/portal/${sentinel}`), SENTINEL);
  soltarChunk();
  holdPosthogChunk = null;
  await new Promise((resolve) => setTimeout(resolve, 600));

  const trasVuelo = await enVuelo.evaluate(() => window.__posthogCalls ?? []);
  assert.deepEqual(trasVuelo.filter((c) => c.kind === "init"), [],
    "el init llegó tarde y se abortó: no se inicializa estando ya en el portal");
  assert.equal([
    JSON.stringify(trasVuelo), await storageDump(enVuelo), enVuelo.__console.join("\n"),
  ].join("\n").includes(SENTINEL), false,
    "y no queda el secreto ni en el almacenamiento ni en la consola");

  // Forzar un evento o una identificación desde el portal tampoco sale.
  await enVuelo.evaluate(() => window.__emitProductEvent());
  await enVuelo.evaluate(() => window.__identify());
  assert.equal((await enVuelo.evaluate(() => window.__posthogCalls ?? [])).length,
    trasVuelo.length,
    "un evento de producto forzado desde el portal no sale, ni identificar tampoco");

  // Y al volver a una pantalla normal, la inicialización sí puede ocurrir:
  // abortar no debe dejar initPromise memoizada para siempre.
  await enVuelo.evaluate(() => window.__navigate("/dashboard/projects/abc-123"));
  await enVuelo.waitForFunction(
    () => window.__posthogCalls?.some((c) => c.kind === "init"), { timeout: 10000 });
  assert.equal(
    (await enVuelo.evaluate(() => window.__posthogCalls)).filter((c) => c.kind === "init").length, 1,
    "al salir del portal se inicializa, y una sola vez");
  await enVuelo.close();

  // ── getUser() que resuelve TARDE, ya dentro del portal ──────────────────
  const tardio = await open("/dashboard/projects/abc-123",
    { user: { id: "user-1", email: "duenyo@enlaze.es" }, holdGetUser: true });
  await tardio.waitForFunction(() => typeof window.__releaseGetUser === "function",
    { timeout: 10000 });
  await tardio.evaluate((sentinel) => window.__navigate(`/portal/${sentinel}`), SENTINEL);
  // Ahora sí responde la sesión: ya estamos en el portal.
  await tardio.evaluate(() => window.__releaseGetUser());
  await new Promise((resolve) => setTimeout(resolve, 400));

  const llamadas = await tardio.evaluate(() => window.__posthogCalls ?? []);
  assert.deepEqual(llamadas.filter((c) => c.kind === "identify"), [],
    "una respuesta tardía de getUser no identifica al usuario dentro del portal");
  const sentryTardio = await tardio.evaluate(() => window.__sentryEvents);
  assert.deepEqual(sentryTardio.filter((e) => e.kind === "user"), [],
    "ni se fija el usuario en Sentry estando en el portal");
  assert.equal(
    [JSON.stringify(llamadas), JSON.stringify(sentryTardio), await storageDump(tardio),
     tardio.__console.join("\n")].join("\n").includes(SENTINEL), false);
  await tardio.close();

  // ── Control positivo: fuera del portal sí se identifica y sí se emite ───
  /* Sin esto, todo lo anterior pasaría igual si identificación y eventos
     estuvieran rotos del todo. */
  const normal = await open("/dashboard/projects/abc-123",
    { user: { id: "user-1", email: "duenyo@enlaze.es" } });
  await normal.waitForFunction(
    () => window.__posthogCalls?.some((c) => c.kind === "identify"), { timeout: 10000 });
  const idCall = (await normal.evaluate(() => window.__posthogCalls))
    .find((c) => c.kind === "identify");
  assert.equal(idCall.id, "user-1", "fuera del portal sí se identifica");
  assert.equal(idCall.traits.email, "duenyo@enlaze.es");
  assert.ok((await normal.evaluate(() => window.__sentryEvents))
    .some((e) => e.kind === "user" && e.user?.id === "user-1"), "y Sentry también");

  const antesEvento = (await normal.evaluate(() => window.__posthogCalls)).length;
  await normal.evaluate(() => window.__emitProductEvent());
  const trasEvento = await normal.evaluate(() => window.__posthogCalls);
  assert.equal(trasEvento.length, antesEvento + 1, "y un evento de producto sí sale");
  assert.equal(trasEvento.at(-1).event, "client_created");

  // ── Navegación SPA que cambia SOLO la query ─────────────────────────────
  /* usePathname no incluye la query, así que ir de ?page=1 a ?page=2 no
     cambiaba nada y el pageview se perdía. Con el capture_pageview automático
     apagado no hay nadie detrás que lo recupere. */
  const pageviews = () => normal.evaluate(() =>
    window.__posthogCalls.filter((c) => c.kind === "capture" && c.event === "$pageview"));
  const antesQuery = (await pageviews()).length;
  await normal.evaluate(() =>
    window.__navigate("/dashboard/projects/abc-123?page=2&utm_source=boletin"));
  await normal.waitForFunction(
    (previos) => window.__posthogCalls.filter(
      (c) => c.kind === "capture" && c.event === "$pageview").length > previos,
    { timeout: 10000 }, antesQuery);
  const soloQuery = (await pageviews()).at(-1);
  assert.match(soloQuery.properties.$current_url, /\?page=2&utm_source=boletin$/,
    "cambiar solo la query emite pageview, con la query y el UTM intactos");
  assert.equal(soloQuery.properties.$pathname, "/dashboard/projects/abc-123");

  // Y un segundo cambio de query también cuenta.
  const antesSegundo = (await pageviews()).length;
  await normal.evaluate(() => window.__navigate("/dashboard/projects/abc-123?page=3"));
  await normal.waitForFunction(
    (previos) => window.__posthogCalls.filter(
      (c) => c.kind === "capture" && c.event === "$pageview").length > previos,
    { timeout: 10000 }, antesSegundo);
  assert.match((await pageviews()).at(-1).properties.$current_url, /\?page=3$/);

  // Re-renderizar sin cambiar nada NO debe duplicar el pageview.
  const antesRepintar = (await pageviews()).length;
  await normal.evaluate(() => window.__navigate("/dashboard/projects/abc-123?page=3"));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await pageviews()).length, antesRepintar,
    "la misma URL no emite un pageview de más");
  assert.deepEqual(normal.__pageErrors, []);
  await normal.close();

  console.log("PASS: /portal/<secreto> no llega a PostHog, Sentry, Replay, consola ni almacenamiento");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
