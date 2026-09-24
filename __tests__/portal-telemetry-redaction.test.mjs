import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  PORTAL_PATH_PLACEHOLDER,
  REDACTED_CYCLE,
  REDACTED_DEPTH,
  REDACTED_UNSAFE,
  isPortalPath,
  redactPortalDeep,
  redactPortalPath,
} from "../lib/portal-path-redaction.ts";
import { portalScrubbingOptions } from "../lib/sentry-portal-scrubbing.ts";
import { safeTelemetry } from "../lib/telemetry-safe.ts";

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

test("una estructura cíclica se corta con marcador, no devolviendo el nodo", () => {
  // Devolver el objeto original al detectar el ciclo era fail-open: ese objeto
  // es justo el que lleva el token.
  const ciclo = { url: `/portal/${SENTINEL}` };
  ciclo.self = ciclo;
  const limpio = redactPortalDeep(ciclo);
  assert.equal(limpio.url, PORTAL_PATH_PLACEHOLDER);
  assert.equal(limpio.self, REDACTED_CYCLE, "el nodo repetido no vuelve crudo");
  assert.equal(JSON.stringify(limpio).includes(SENTINEL), false);
});

test("más allá de la profundidad máxima se corta con marcador, no con el valor", () => {
  // Nido de 20 niveles con el token al fondo. Antes se devolvía la rama cruda
  // a partir del nivel 12 y el token salía entero.
  let nodo = { url: `/portal/${SENTINEL}` };
  for (let n = 0; n < 20; n += 1) nodo = { hijo: nodo };
  const limpio = redactPortalDeep(nodo);
  const serializado = JSON.stringify(limpio);
  assert.equal(serializado.includes(SENTINEL), false,
    "el token a profundidad 20 no puede sobrevivir al corte");
  assert.equal(serializado.includes(REDACTED_DEPTH), true, "se ve dónde se cortó");
});

test("un Error se aplana y se redacta entero: nombre, mensaje, stack y cause", () => {
  const causa = new Error(`causa raíz en /portal/${SENTINEL}`);
  const error = new Error(`fallo cargando /portal/${SENTINEL}`, { cause: causa });
  error.name = `Error en /portal/${SENTINEL}`;
  // Un stack fabricado, para no depender del formato del motor.
  error.stack = `Error: fallo\n    at load (https://app.enlaze.es/portal/${SENTINEL}:1:1)`;
  error.requestUrl = `https://app.enlaze.es/portal/${SENTINEL}`;

  const limpio = redactPortalDeep(error);
  const serializado = JSON.stringify(limpio);
  assert.equal(serializado.includes(SENTINEL), false, "ni una de las cuatro partes filtra");
  assert.equal(limpio.name, "Error en /portal/[token]");
  assert.equal(limpio.message, "fallo cargando /portal/[token]");
  assert.match(limpio.stack, /\/portal\/\[token\]/);
  assert.equal(limpio.cause.message, "causa raíz en /portal/[token]");
  assert.equal(limpio.requestUrl, "https://app.enlaze.es/portal/[token]",
    "y las propiedades propias que cuelgue el código también");

  // Y anidado dentro de un evento, no solo suelto.
  const evento = { extra: { original: error }, lista: [error] };
  assert.equal(JSON.stringify(redactPortalDeep(evento)).includes(SENTINEL), false);
});

test("una URL del portal se aplana a su href redactado", () => {
  // Recorrer sus getters devolvería pathname, search y href con el secreto.
  const url = new URL(`https://app.enlaze.es/portal/${SENTINEL}?utm_source=mail`);
  const limpio = redactPortalDeep(url);
  assert.equal(limpio, "https://app.enlaze.es/portal/[token]?utm_source=mail");
  assert.equal(JSON.stringify(redactPortalDeep({ u: url })).includes(SENTINEL), false);
});

test("un objeto opaco no se devuelve intacto", () => {
  class Contexto {
    constructor() { this.destino = `/portal/${SENTINEL}`; }
  }
  const limpio = redactPortalDeep({ ctx: new Contexto() });
  assert.equal(JSON.stringify(limpio).includes(SENTINEL), false,
    "una instancia de clase cualquiera se aplana y se redacta");
  assert.equal(limpio.ctx.destino, PORTAL_PATH_PLACEHOLDER);
});

test("un getter que lanza no filtra el token por el mensaje de su excepción", () => {
  const veneno = { sano: "/dashboard" };
  Object.defineProperty(veneno, "trampa", {
    enumerable: true,
    get() { throw new Error(`no se pudo leer /portal/${SENTINEL}`); },
  });
  const limpio = redactPortalDeep(veneno);
  assert.equal(JSON.stringify(limpio).includes(SENTINEL), false,
    "la excepción del getter ni se mira");
  assert.equal(limpio.trampa, REDACTED_UNSAFE);
  assert.equal(limpio.sano, "/dashboard", "el resto del objeto sí se conserva");
});

test("una función nunca se reenvía: su código fuente podría llevar la URL", () => {
  const limpio = redactPortalDeep({ cb: () => `/portal/${SENTINEL}` });
  assert.equal(limpio.cb, REDACTED_UNSAFE);
  assert.equal(JSON.stringify(limpio).includes(SENTINEL), false);
});

test("Map y Set se recorren en vez de devolverse opacos", () => {
  const limpio = redactPortalDeep({
    m: new Map([["destino", `/portal/${SENTINEL}`]]),
    s: new Set([`/portal/${SENTINEL}`]),
  });
  assert.equal(JSON.stringify(limpio).includes(SENTINEL), false);
  assert.equal(limpio.m.destino, PORTAL_PATH_PLACEHOLDER);
  assert.deepEqual(limpio.s, [PORTAL_PATH_PLACEHOLDER]);
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
    /* Un getter que lanza ya NO rompe el recorrido: se maneja y la clave queda
       con marcador, que es mejor que descartar el evento entero. Para forzar
       un fallo real del saneado hace falta romper el recorrido en sí, que es
       lo que hace un Proxy cuyo ownKeys lanza. */
    const veneno = new Proxy({ request: {} }, {
      ownKeys() { throw new Error("no se pueden enumerar las claves"); },
    });
    assert.equal(portalScrubbingOptions.beforeSend(veneno), null,
      "ante la duda no se envía nada");
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1, "se avisa por consola, no por la propia telemetría");
  assert.equal(warnings[0], "[telemetry] evento descartado: el saneado falló",
    "constante sin datos: el error que rompió el saneado puede llevar el secreto " +
    "en su mensaje o su stack, y con enableLogs esa línea volvería a Sentry");
});

test("safeTelemetry tampoco imprime el error que se traga", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    safeTelemetry(() => { throw new Error(`reventó en /portal/${SENTINEL}`); });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].includes(SENTINEL), false,
    "el mensaje del error no puede acabar en consola ni, con enableLogs, en Sentry");
});

test("los tres Sentry.init enchufan el saneado", () => {
  for (const archivo of ["instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts"]) {
    const texto = source(archivo);
    assert.match(texto, /\.\.\.portalScrubbingOptions/,
      `${archivo} debe expandir los hooks de redacción`);
    assert.match(texto, /from "@\/lib\/sentry-portal-scrubbing"/, `${archivo} debe importarlos`);
  }
});

test("Session Replay no puede activarse en producción", () => {
  /* stop() NO garantiza descartar el búfer: en @sentry/replay 10.66.0 el método
     público hace stop({ forceFlush: recordingMode === "session" }), así que en
     una sesión muestreada pararlo al entrar en el portal ENVIARÍA justo la
     grabación del portal. Mientras el token viaje en la URL, Replay se queda
     apagado en toda la app. */
  for (const archivo of ["instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts"]) {
    const texto = source(archivo);
    assert.equal(/replayIntegration\s*\(/.test(texto), false,
      `${archivo} no puede instanciar la integración de Replay`);
    for (const opcion of ["replaysSessionSampleRate", "replaysOnErrorSampleRate"]) {
      const encontrado = texto.match(new RegExp(`${opcion}\\s*:\\s*([^,\\n]+)`));
      if (encontrado) {
        assert.equal(encontrado[1].trim(), "0",
          `${archivo}: ${opcion} debe ser 0 mientras el token vaya en la URL`);
      }
    }
  }
  // Y que no quede el guard antiguo, que se apoyaba en stop().
  assert.equal(existsSync(new URL("../lib/replay-portal-guard.ts", import.meta.url)), false,
    "el guard basado en stop() se retiró: daba una falsa sensación de seguridad");
});

test("PostHog no captura la URL real por su cuenta", () => {
  const analytics = source("lib/analytics.ts");
  assert.match(analytics, /capture_pageview:\s*false/,
    "el pageview automático captura window.location.href antes de que nada lo sanee");
  assert.equal(/capture_pageview:\s*true/.test(analytics), false);
  assert.match(analytics, /capture_pageleave:\s*false/,
    "con pageleave activo, navegar del dashboard al portal emitiría un evento " +
    "desde /portal/<secreto>: redactado, pero la política es no emitir ninguno");
  assert.equal(/capture_pageleave:\s*true/.test(analytics), false);
  assert.equal(/opt_in_capturing|opt_out_capturing/.test(analytics), false,
    "no se toca el opt-in/opt-out: pisaría una preferencia de privacidad del usuario");
  assert.match(analytics, /sanitize_properties:/,
    "red de seguridad para $initial_current_url y lo que añada el SDK");
  assert.match(analytics, /if \(onPortalNow\(\)\) return Promise\.resolve\(\);/,
    "en el portal no se inicializa PostHog en absoluto: persiste la URL en localStorage y cookie");
  // La comprobación de antes del import no basta: el import tarda.
  assert.match(analytics, /if \(onPortalNow\(\)\) \{\s*\n\s*initPromise = null;\s*\n\s*return;/,
    "segunda comprobación justo antes de posthog.init, soltando initPromise para " +
    "que al salir del portal se pueda inicializar");
  assert.equal((analytics.match(/if \(onPortalNow\(\)\) return;/g) ?? []).length, 2,
    "identifyUser y trackEvent fallan cerradas en el portal aunque PostHog ya " +
    "estuviera inicializado en el dashboard");
  assert.match(analytics, /if \(!initPromise\) initPromise = runInit\(\);/,
    "una sola promesa de inicialización: `initialized` solo se pone a true tras " +
    "el import dinámico, así que dos llamadas concurrentes hacían dos posthog.init");
  assert.match(analytics, /pageViewed: \(url: string, pathname\?: string\)/,
    "el pageview manual manda la URL completa, no solo el path: la captura " +
    "automática que sustituye incluía host, query y UTM");

  // Y el emisor tiene que reaccionar a cambios de query, no solo de pathname.
  const provider = source("components/AnalyticsProvider.tsx");
  assert.match(provider, /useSearchParams/,
    "usePathname no incluye la query: sin esto, ir de ?page=1 a ?page=2 perdía el pageview");
  assert.match(provider, /\}, \[pathname, query\]\);/,
    "el efecto depende también de la query");
  assert.match(provider, /<Suspense fallback=\{null\}>/,
    "useSearchParams se aísla en un hermano bajo Suspense para no sacar del " +
    "prerenderizado a todo el árbol (docs de Next 16, use-search-params)");
  assert.match(provider, /Promise\.all\(\[initAnalytics\(\), supabase\.auth\.getUser\(\)\]\)/,
    "identificar espera al init: si getUser resolvía antes, identifyUser se perdía");
  assert.equal(
    (provider.match(/if \(isPortalPath\(window\.location\.pathname\)\) return;/g) ?? []).length, 2,
    "la ruta se recomprueba al montar y otra vez en la respuesta de getUser");
});
