import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { safeTelemetry } from "../lib/telemetry-safe.ts";
import { CONTENT_SECURITY_POLICY } from "../lib/security-headers.ts";

/* ─────────────────────────────────────────────────────────────────────
 *  Un fallo de telemetría nunca puede tirar ni recargar la app.
 *
 *  Regresión: `instrumentation-client.ts` se evalúa como parte del bundle
 *  de cliente. Si algo dentro (Sentry, su worker de Replay bloqueado por
 *  la CSP, un JSON.parse sobre un valor vacío…) lanza, el módulo entero
 *  revienta, React nunca hidrata y la app queda muerta: el <form> del
 *  login pasa a hacer submit nativo (GET), la página se recarga con la
 *  animación del logo y hay que volver a meter las credenciales.
 * ───────────────────────────────────────────────────────────────────── */

function readSource(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("safeTelemetry se traga cualquier excepción de la telemetría", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    assert.doesNotThrow(() =>
      safeTelemetry(() => {
        JSON.parse("");
      })
    );
    assert.equal(
      safeTelemetry(() => {
        throw new Error("Sentry worker blocked by CSP");
      }),
      undefined
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 2, "cada fallo se reporta una vez por consola");
});

test("safeTelemetry devuelve el valor cuando la telemetría funciona", () => {
  assert.equal(
    safeTelemetry(() => "ok"),
    "ok"
  );
});

test("la CSP permite el worker de Sentry Replay desde blob:", () => {
  const workerSrc = CONTENT_SECURITY_POLICY.split("; ").find((directive) =>
    directive.startsWith("worker-src")
  );

  assert.ok(
    workerSrc,
    "worker-src debe declararse explícitamente: sin él el navegador cae en script-src y bloquea el worker de Replay"
  );
  assert.match(workerSrc, /\bblob:/);
});

test("la CSP sigue siendo restrictiva en lo demás", () => {
  assert.match(CONTENT_SECURITY_POLICY, /^default-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  // blob: solo se abre para workers, nunca como origen de <script src>.
  const scriptSrc = CONTENT_SECURITY_POLICY.split("; ").find((directive) =>
    directive.startsWith("script-src")
  );
  assert.doesNotMatch(scriptSrc, /\bblob:/);
});

test("proxy.ts usa la CSP compartida en vez de una copia propia", () => {
  const proxySource = readSource("proxy.ts");
  assert.match(proxySource, /from "\.\/lib\/security-headers"/);
  assert.doesNotMatch(
    proxySource,
    /"Content-Security-Policy"\s*,\s*\[/,
    "la CSP no debe duplicarse dentro del proxy"
  );
});

test("todo punto de entrada de telemetría pasa por safeTelemetry", () => {
  for (const file of [
    "instrumentation-client.ts",
    "instrumentation.ts",
    "lib/sentry.ts",
    "app/global-error.tsx",
  ]) {
    assert.match(
      readSource(file),
      /safeTelemetry\(/,
      `${file} debe aislar sus llamadas a Sentry con safeTelemetry`
    );
  }
});

test("instrumentation-client no deja ninguna llamada a Sentry sin aislar", () => {
  const source = readSource("instrumentation-client.ts");
  // Toda referencia a `Sentry.` vive dentro de un callback de safeTelemetry.
  for (const match of source.matchAll(/Sentry\.\w+/g)) {
    const before = source.slice(0, match.index);
    const guardIndex = before.lastIndexOf("safeTelemetry(");
    assert.notEqual(
      guardIndex,
      -1,
      `${match[0]} se evalúa fuera de safeTelemetry y puede tirar el bundle de cliente`
    );
  }
});
