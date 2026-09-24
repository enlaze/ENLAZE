import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PORTAL_PATH_PLACEHOLDER,
  isPortalPath,
  redactPortalDeep,
  redactPortalPath,
} from "../lib/portal-path-redaction.ts";
import { portalScrubbingOptions } from "../lib/sentry-portal-scrubbing.ts";

/* ─────────────────────────────────────────────────────────────────────
 *  /portal/<secreto> es una URL portadora: quien la tiene, entra.
 *
 *  No puede salir hacia PostHog, Sentry, Session Replay, la consola ni el
 *  almacenamiento del navegador. Aquí se comprueba la pieza que lo impide
 *  y que los tres `Sentry.init` y PostHog la tienen enchufada.
 *
 *  El aislamiento extremo a extremo, con la página real en un navegador,
 *  está en portal-telemetry-isolation.browser.test.mjs.
 * ───────────────────────────────────────────────────────────────────── */

const SENTINEL = "s3nt1nel-9f4c-4b2a-8e77-por7alt0k3n";
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("redactPortalPath enmascara el secreto viva donde viva", () => {
  const casos = [
    [`/portal/${SENTINEL}`, "/portal/[token]"],
    [`/portal/${SENTINEL}/`, "/portal/[token]/"],
    [`/portal/${SENTINEL}?utm=x`, "/portal/[token]?utm=x"],
    [`/portal/${SENTINEL}#seccion`, "/portal/[token]#seccion"],
    [`https://app.enlaze.es/portal/${SENTINEL}`, "https://app.enlaze.es/portal/[token]"],
    [`https://app.enlaze.es/portal/${SENTINEL}?a=1&b=2`, "https://app.enlaze.es/portal/[token]?a=1&b=2"],
    // Incrustada en el texto de un error, que es como llega a Sentry.
    [`Failed to fetch https://app.enlaze.es/portal/${SENTINEL} (500)`,
     "Failed to fetch https://app.enlaze.es/portal/[token] (500)"],
    // Varias en la misma cadena: se redactan todas, no solo la primera.
    [`de /portal/${SENTINEL} a /portal/${SENTINEL}b`, "de /portal/[token] a /portal/[token]"],
    // Mayúsculas en la ruta: el enmascarado no depende de la caja.
    [`/PORTAL/${SENTINEL}`, "/portal/[token]"],
  ];
  for (const [entrada, esperado] of casos) {
    const salida = redactPortalPath(entrada);
    assert.equal(salida, esperado, `entrada: ${entrada}`);
    assert.equal(salida.includes(SENTINEL), false, "el centinela no sobrevive");
  }
});

test("redactar es idempotente y no toca rutas ajenas", () => {
  assert.equal(redactPortalPath(PORTAL_PATH_PLACEHOLDER), PORTAL_PATH_PLACEHOLDER,
    "el marcador ya redactado se queda igual, no se anida");
  assert.equal(redactPortalPath(redactPortalPath(`/portal/${SENTINEL}`)), PORTAL_PATH_PLACEHOLDER);
  for (const intacta of [
    "/dashboard/projects/abc-123",
    "/dashboard/budgets/44444444-4444-4444-8444-444444444444",
    "/login",
    "/portalero/no-es-el-portal",
    "",
  ]) {
    assert.equal(redactPortalPath(intacta), intacta, `no debe tocarse: ${intacta}`);
  }
});

test("isPortalPath reconoce la ruta del portal y solo esa", () => {
  for (const si of [`/portal/${SENTINEL}`, "/portal", "/portal/", "/PORTAL/x",
    `https://app.enlaze.es/portal/${SENTINEL}`]) {
    assert.equal(isPortalPath(si), true, si);
  }
  for (const no of ["/dashboard", "/portalero/x", "/dashboard/portal/x", "", null, undefined]) {
    assert.equal(isPortalPath(no), false, String(no));
  }
});

test("redactPortalDeep limpia claves, valores, arrays y anidamiento", () => {
  const evento = {
    request: { url: `https://app.enlaze.es/portal/${SENTINEL}`, headers: { Referer: `/portal/${SENTINEL}` } },
    breadcrumbs: [
      { data: { to: `/portal/${SENTINEL}` } },
      { message: `navegó a /portal/${SENTINEL}` },
    ],
    // La URL como clave filtraría igual que como valor.
    [`/portal/${SENTINEL}`]: 1,
    // Valores que no son texto se conservan tal cual.
    numero: 42, booleano: true, nulo: null, indefinido: undefined,
  };
  const limpio = redactPortalDeep(evento);
  assert.equal(JSON.stringify(limpio).includes(SENTINEL), false, "no queda rastro del centinela");
  assert.equal(limpio.request.url, "https://app.enlaze.es/portal/[token]");
  assert.equal(limpio.request.headers.Referer, PORTAL_PATH_PLACEHOLDER);
  assert.equal(limpio.breadcrumbs[0].data.to, PORTAL_PATH_PLACEHOLDER);
  assert.equal(Object.keys(limpio).includes(PORTAL_PATH_PLACEHOLDER), true, "la clave también");
  assert.equal(limpio.numero, 42);
  assert.equal(limpio.booleano, true);
  assert.equal(limpio.nulo, null);
});

test("el mismo objeto colgando de dos claves se redacta las dos veces", () => {
  // Un Set de "ya visto" global se saltaría la segunda. Debe ser detección de
  // ciclos por rama, no memoria de todo lo recorrido.
  const compartido = { url: `/portal/${SENTINEL}` };
  const limpio = redactPortalDeep({ a: compartido, b: compartido });
  assert.equal(limpio.a.url, PORTAL_PATH_PLACEHOLDER);
  assert.equal(limpio.b.url, PORTAL_PATH_PLACEHOLDER, "la segunda referencia no puede quedar sucia");
});

test("una estructura cíclica no cuelga ni revienta la telemetría", () => {
  const ciclo = { url: `/portal/${SENTINEL}` };
  ciclo.self = ciclo;
  const limpio = redactPortalDeep(ciclo);
  assert.equal(limpio.url, PORTAL_PATH_PLACEHOLDER);
});

test("los cuatro hooks de Sentry redactan el centinela", () => {
  const entradas = {
    beforeSend: { request: { url: `https://app.enlaze.es/portal/${SENTINEL}` },
      exception: { values: [{ value: `fallo en /portal/${SENTINEL}` }] } },
    beforeSendTransaction: { transaction: `/portal/${SENTINEL}`, contexts: {} },
    beforeBreadcrumb: { category: "navigation", data: { to: `/portal/${SENTINEL}` } },
    beforeSendLog: { body: `render de /portal/${SENTINEL}`, attributes: {} },
  };
  for (const [hook, entrada] of Object.entries(entradas)) {
    const salida = portalScrubbingOptions[hook](entrada);
    assert.notEqual(salida, null, `${hook} no debe descartar un evento sano`);
    assert.equal(JSON.stringify(salida).includes(SENTINEL), false,
      `${hook} dejó salir el centinela`);
  }
});

test("si el saneado fallara, el evento se descarta en vez de salir sucio", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    // Un getter que lanza rompe el recorrido a mitad.
    const veneno = { request: {} };
    Object.defineProperty(veneno, "boom", {
      enumerable: true, get() { throw new Error("no se puede leer"); },
    });
    assert.equal(portalScrubbingOptions.beforeSend(veneno), null,
      "ante la duda no se envía nada");
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1, "se avisa por consola, no por la propia telemetría");
  assert.equal(warnings[0].includes("descartado"), true);
});

test("los tres Sentry.init enchufan el saneado", () => {
  for (const archivo of ["instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts"]) {
    const texto = source(archivo);
    assert.match(texto, /\.\.\.portalScrubbingOptions/,
      `${archivo} debe expandir los hooks de redacción`);
    assert.match(texto, /from "@\/lib\/sentry-portal-scrubbing"/, `${archivo} debe importarlos`);
  }
});

test("Session Replay no graba en el portal", () => {
  const cliente = source("instrumentation-client.ts");
  assert.match(cliente, /onPortal\s*\?\s*\[\]\s*:\s*\[Sentry\.replayIntegration\(\)\]/,
    "la integración de Replay no puede cargarse en el portal");
  assert.match(cliente, /replaysSessionSampleRate:\s*onPortal\s*\?\s*0\s*:/);
  assert.match(cliente, /replaysOnErrorSampleRate:\s*onPortal\s*\?\s*0\s*:/);
  // Y la salvaguarda para quien llegue al portal navegando dentro de la app.
  assert.match(source("components/AnalyticsProvider.tsx"), /stopReplayOnPortal\(\)/);
  assert.match(source("lib/replay-portal-guard.ts"), /replay\?\.stop\?\.\(\)/,
    "hay que parar la grabación, no vaciarla: flush() la enviaría");
});

test("PostHog no captura la URL real por su cuenta", () => {
  const analytics = source("lib/analytics.ts");
  assert.match(analytics, /capture_pageview:\s*false/,
    "el pageview automático captura window.location.href antes de que nada lo sanee");
  assert.equal(/capture_pageview:\s*true/.test(analytics), false);
  assert.match(analytics, /sanitize_properties:/,
    "red de seguridad para $pageleave, $initial_current_url y lo que añada el SDK");
  assert.match(analytics, /if \(isPortalPath\(window\.location\.pathname\)\) return;/,
    "en el portal no se inicializa PostHog en absoluto: persiste la URL en localStorage y cookie");
});
