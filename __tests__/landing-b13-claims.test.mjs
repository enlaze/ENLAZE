// b13: la landing no promete lo que no existe, es siempre clara, saca los
// precios de lib/plans.ts y solo enseña capturas que están en el repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const page = readFileSync("app/page.tsx", "utf8");
const nav = readFileSync("components/landing/LandingNav.tsx", "utf8");
const visible = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "") // comentarios de bloque
    .replace(/^\s*\/\/.*$/gm, ""); // comentarios de línea

test("sin promesas de normas ni de varios usuarios", () => {
  for (const src of [visible(page), visible(nav)]) {
    for (const banned of [/verifactu/i, /certificad/i, /firmad/i, /\bcumple\b/i, /normativa/i, /\bley\b/i, /varios usuarios/i, /multiusuario/i, /equipo ilimitado/i]) {
      assert.doesNotMatch(src, banned, String(banned));
    }
  }
});

test("sin emojis", () => {
  assert.doesNotMatch(page + nav, /\p{Emoji_Presentation}/u);
});

test("siempre clara: ninguna variante dark:", () => {
  assert.doesNotMatch(visible(page), /\bdark:/);
  assert.doesNotMatch(visible(nav), /\bdark:/);
});

test("los precios salen de lib/plans.ts, no escritos a mano", () => {
  assert.match(page, /from "@\/lib\/plans"/);
  assert.match(page, /priceCents\(plan, "month"\)/);
  assert.match(page, /VAT_SUFFIX/);
  assert.match(page, /TRIAL_DAYS/);
  // Ninguna cifra en euros escrita en el JSX.
  assert.doesNotMatch(visible(page), /\b\d+(?:[.,]\d+)?\s?€/);
});

test("el titular y el subtítulo son los que pidió Daniil", () => {
  assert.match(page, /Ocúpate de tu oficio\. Del papeleo nos ocupamos nosotros\./);
  assert.match(page, /Enlaze es el asistente con IA que hace el trabajo de oficina de autónomos y pymes/);
});

test("cada captura existe y no hay fotos de stock", () => {
  const srcs = [...page.matchAll(/src[=:]\s*"([^"]+\.(?:png|jpe?g|webp))"/g)].map((m) => m[1]);
  assert.ok(srcs.length >= 5, `solo ${srcs.length} capturas`);
  for (const src of srcs) {
    assert.ok(src.startsWith("/landing/"), src);
    assert.ok(existsSync(`public${src}`), `falta public${src}`);
  }
  assert.doesNotMatch(page, /unsplash|pexels|stock/i);
});

test("la página avisa de que las capturas son de una cuenta de demostración", () => {
  assert.match(page, /cuenta de demostración con datos inventados/);
});
