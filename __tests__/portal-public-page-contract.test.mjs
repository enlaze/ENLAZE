import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ─────────────────────────────────────────────────────────────────────
 *  S3.2 — la página pública del portal lee por una sola vía.
 *
 *  Tenía un fallback, loadLegacyPortal(), para la ventana entre desplegar
 *  la página y aplicar 20260915150000. Esa ventana se cerró el 2026-09-15,
 *  pero el código seguía ahí y hacía dos cosas que hoy no puede hacer:
 *  leer portal_tokens —anon perdió el privilegio con 20260925110000— y
 *  traerse projects con select("*"), que incluye access_token, el secreto
 *  del enlace heredado, al navegador de un visitante anónimo.
 *
 *  Estas comprobaciones impiden que vuelva.
 * ───────────────────────────────────────────────────────────────────── */

const portal = readFileSync("app/portal/[token]/page.tsx", "utf8");
// Solo el código, sin comentarios: si no, un comentario que mencione el
// fallback haría fallar la prueba por hablar de él.
const codigo = portal
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

test("el portal público no vuelve a tener un lector alternativo", () => {
  assert.equal(/loadLegacyPortal/.test(codigo), false,
    "el fallback heredado no puede reaparecer");
  assert.equal(/PGRST202[\s\S]{0,200}?loadLegacy|loadLegacy[\s\S]{0,200}?PGRST202/.test(codigo), false,
    "ni la rama que lo invocaba cuando faltaba la función");
});

test("el portal público no toca ninguna tabla directamente para leer", () => {
  assert.equal(/\.from\(\s*["'`]portal_tokens["'`]\s*\)/.test(codigo), false,
    "portal_tokens no es legible por anon desde 20260925110000");
  assert.equal(/\.from\(\s*["'`]projects["'`]\s*\)/.test(codigo), false,
    "los datos del proyecto llegan por portal_read_snapshot, no por la tabla");
  assert.equal(/select\(\s*["'`]\*["'`]\s*\)/.test(codigo), false,
    'select("*") sobre projects arrastraría access_token al navegador anónimo');
  assert.equal(/access_token/.test(codigo), false,
    "el secreto del enlace heredado no se nombra en el cliente");
});

test("la única lectura es portal_read_snapshot", () => {
  const rpcs = [...codigo.matchAll(/\.rpc\(\s*["'`]([a-z_]+)["'`]/g)].map((m) => m[1]);
  assert.ok(rpcs.includes("portal_read_snapshot"), "lee por la RPC");
  const lecturas = rpcs.filter((r) => r.endsWith("_snapshot") || r.startsWith("portal_read"));
  assert.deepEqual([...new Set(lecturas)], ["portal_read_snapshot"],
    "no hay una segunda vía de lectura");
  // Las dos RPC de escritura sí siguen, y son las esperadas.
  assert.deepEqual([...new Set(rpcs)].sort(),
    ["portal_read_snapshot", "portal_respond_to_budget", "portal_respond_to_change"],
    "el portal habla con la base por exactamente tres RPC");
});

test("un enlace inválido sigue mostrando 'no encontrado', no una página vacía", () => {
  // Al quitar el fallback, el único camino cuando la RPC no devuelve proyecto
  // tiene que seguir siendo setNotFound(true).
  const cuerpo = codigo.slice(codigo.indexOf("async function loadPortal"),
                              codigo.indexOf("async function handleBudgetAction"));
  assert.match(cuerpo, /if \(error \|\| !data \|\| typeof data !== "object" \|\| !data\.project\) \{\s*setNotFound\(true\);/,
    "error, respuesta vacía o sin proyecto llevan a no encontrado");
  assert.match(cuerpo, /catch \{\s*setNotFound\(true\);/,
    "y una excepción también, en vez de dejar la página a medias");
  assert.match(cuerpo, /finally \{\s*setLoading\(false\);/,
    "el estado de carga se cierra pase lo que pase");
});

test("las escrituras siguen negándose si falta su RPC, sin caer a la tabla", () => {
  // Contraparte de lo anterior: PENDING_WRITER sí debe seguir existiendo.
  assert.match(portal, /PGRST202/,
    "una función de escritura ausente se sigue detectando");
  assert.match(portal, /PENDING_WRITER/,
    "y se traduce en una negativa explícita, no en un escrito directo a la tabla");
});
