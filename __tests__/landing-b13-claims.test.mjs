// b13: la landing no promete lo que no existe, es siempre clara, saca los
// precios de lib/plans.ts y solo enseña capturas que están en el repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const page = readFileSync("app/page.tsx", "utf8");
const nav = readFileSync("components/landing/LandingNav.tsx", "utf8");
const hero = readFileSync("components/landing/ChaosHero.tsx", "utf8");
const visible = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "") // comentarios de bloque
    .replace(/^\s*\/\/.*$/gm, ""); // comentarios de línea

test("sin promesas de normas ni de varios usuarios", () => {
  for (const src of [visible(page), visible(nav), visible(hero)]) {
    for (const banned of [/verifactu/i, /certificad/i, /firmad/i, /\bcumple\b/i, /normativa/i, /\bley\b/i, /varios usuarios/i, /multiusuario/i, /equipo ilimitado/i]) {
      assert.doesNotMatch(src, banned, String(banned));
    }
  }
});

test("sin emojis", () => {
  assert.doesNotMatch(page + nav + hero, /\p{Emoji_Presentation}/u);
});

test("siempre clara: ninguna variante dark:", () => {
  assert.doesNotMatch(visible(page), /\bdark:/);
  assert.doesNotMatch(visible(nav), /\bdark:/);
  assert.doesNotMatch(visible(hero), /\bdark:/);
});

test("los precios salen de lib/plans.ts, no escritos a mano", () => {
  assert.match(page, /from "@\/lib\/plans"/);
  assert.match(page, /priceCents\(plan, "month"\)/);
  assert.match(page, /VAT_SUFFIX/);
  assert.match(page, /TRIAL_DAYS/);
  // Ninguna cifra en euros escrita en el JSX.
  assert.doesNotMatch(visible(page), /\b\d+(?:[.,]\d+)?\s?€/);
});

test("el titular, el subtítulo y el botón son los que pidió Daniil (portada del 19-10)", () => {
  assert.match(hero, /Tú haces el trabajo\./);
  assert.match(hero, /Enlaze hace <motion\.span[^>]*>el papeleo<\/motion\.span>\./);
  assert.match(hero, /El asistente con IA que hace el trabajo de oficina de autónomos y pymes\./);
  assert.match(hero, /Prueba \{trialDays\} días gratis/);
  assert.match(hero, />\s*Sin tarjeta\s*</);
  assert.match(page, /<ChaosHero trialDays=\{TRIAL_DAYS\} \/>/);
  // El título y la imagen para compartir dicen lo mismo que la portada.
  const layout = readFileSync("app/layout.tsx", "utf8");
  const og = readFileSync("app/opengraph-image.tsx", "utf8");
  for (const src of [layout, og]) {
    assert.match(src, /Tú haces el trabajo\. Enlaze hace el papeleo\./);
    assert.doesNotMatch(src, /Ocúpate de tu oficio/);
  }
});

test("cada captura existe y no hay fotos de stock", () => {
  const srcs = [...(page + hero).matchAll(/src[=:]\s*"([^"]+\.(?:png|jpe?g|webp))"/g)].map((m) => m[1]);
  assert.ok(srcs.length >= 5, `solo ${srcs.length} capturas`);
  for (const src of srcs) {
    assert.ok(src.startsWith("/landing/"), src);
    assert.ok(existsSync(`public${src}`), `falta public${src}`);
  }
  assert.doesNotMatch(page, /unsplash|pexels|stock/i);
});

test("la página avisa de que las capturas son de una cuenta de demostración", () => {
  assert.match(hero, /cuenta de demostración con datos inventados/);
});

test("un único fondo para toda la landing, definido como token", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const section = readFileSync("components/landing/Section.tsx", "utf8");
  assert.match(css, /--color-landing-paper: #[0-9a-f]{6};/i);
  assert.match(page, /<main className=\{`[^`]*\bbg-landing-paper\b/);
  // Ni colores sueltos del fondo ni franjas: las secciones heredan el de <main>.
  for (const src of [page, nav, section]) assert.doesNotMatch(src, /#F6F8F7/i);
  assert.doesNotMatch(section, /bg-/);
  for (const m of page.matchAll(/<(?:Section|section|footer)\b[^>]*>/g)) {
    assert.doesNotMatch(m[0], /\bbg-|border-y\b/, m[0]);
  }
});
