// Proves the disposable-target guard refuses what it must. Needs no database and
// always runs, so a guard that silently stopped checking would fail here first.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORBIDDEN_VARIABLES,
  REST_ORIGIN,
  assertDisposableRestTarget,
  assertNoProductionEnvironment,
  guardedFetch,
} from "./lib/disposable-target-guard.mjs";

// Project refs are public — they sit in every browser bundle — so naming them
// here discloses nothing. They make the refusal concrete rather than generic.
const PRODUCTION = "https://dsgnymebkxxkslyeotee.supabase.co";
const PAUSED = "https://wgiejvfibnqyltplvafm.supabase.co";

test("rechaza la URL de producción, la del proyecto pausado y cualquier Supabase alojado", () => {
  for (const target of [
    PRODUCTION, PAUSED, `${PRODUCTION}/rest/v1`,
    "https://aws-0-eu-west-3.pooler.supabase.com:6543",
    "http://dsgnymebkxxkslyeotee.supabase.co:53002",
  ]) {
    assert.throws(() => assertDisposableRestTarget(target), `debería rechazar ${target}`);
  }
});

test("rechaza hosts que no son loopback y puertos o protocolos distintos del banco", () => {
  for (const target of [
    "http://10.0.0.5:53002", "http://example.com:53002",
    "https://127.0.0.1:53002", "http://127.0.0.1:3000", "http://127.0.0.1:53003",
  ]) {
    assert.throws(() => assertDisposableRestTarget(target), `debería rechazar ${target}`);
  }
  assert.equal(assertDisposableRestTarget(REST_ORIGIN), REST_ORIGIN);
});

test("se niega a correr si el proceso tiene configurado un proyecto real", () => {
  for (const name of FORBIDDEN_VARIABLES) {
    assert.throws(() => assertNoProductionEnvironment({ [name]: "cualquier-cosa" }), name);
  }
  assert.doesNotThrow(() => assertNoProductionEnvironment({ E2_REST_URL: REST_ORIGIN }));
});

test("detecta un Supabase alojado aunque la variable tenga un nombre inocente, sin revelar su valor", () => {
  const secret = "postgres://user:s3cr3t-token@db.dsgnymebkxxkslyeotee.supabase.co:5432/postgres";
  try {
    assertNoProductionEnvironment({ INNOCENT_LOOKING_NAME: secret });
    assert.fail("debería rechazar");
  } catch (error) {
    assert.match(error.message, /INNOCENT_LOOKING_NAME/);
    assert.doesNotMatch(error.message, /s3cr3t-token/, "el valor nunca debe aparecer en el error");
  }
});

test("una petición hacia otro origen se corta antes de salir, no después", async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { sent.push(String(url)); return new Response("{}"); };
  try {
    const safe = guardedFetch(REST_ORIGIN);
    await assert.rejects(() => safe(`${PRODUCTION}/rest/v1/rpc/save_budget`, { method: "POST" }));
    await assert.rejects(() => safe("http://10.0.0.5:53002/rpc/save_budget", { method: "POST" }));
    assert.deepEqual(sent, [], "ninguna petición debe llegar a la red");
    await safe(`${REST_ORIGIN}/rest/v1/rpc/save_budget`, { method: "POST" });
    assert.deepEqual(sent, [`${REST_ORIGIN}/rpc/save_budget`], "la legítima llega, sin el prefijo /rest/v1");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("una redirección no puede sacar la petición del banco", async () => {
  const realFetch = globalThis.fetch;
  let redirectMode;
  globalThis.fetch = async (_url, init) => { redirectMode = init?.redirect; return new Response("{}"); };
  try {
    await guardedFetch(REST_ORIGIN)(`${REST_ORIGIN}/rpc/save_budget`, { method: "POST" });
    assert.equal(redirectMode, "error");
  } finally {
    globalThis.fetch = realFetch;
  }
});
