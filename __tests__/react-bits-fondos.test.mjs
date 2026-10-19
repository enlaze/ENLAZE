// b13: fondos de React Bits (TS + Tailwind) a prueba en la landing clara:
// Web Threads y Ghost Fibers, a elegir con ?fondo=threads|fibras|no.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACKGROUNDS, backgroundOpacity, pickBackground } from "../components/landing/LandingBackground.tsx";

const threads = readFileSync("components/react-bits/WebThreads.tsx", "utf8");
const fibers = readFileSync("components/react-bits/GhostFibers.tsx", "utf8");

test("los dos unen las clases con espacios (el CLI de shadcn lo rompía)", () => {
  assert.match(threads, /\[ROOT, className\]\.filter\(Boolean\)\.join\(' '\)/);
  assert.match(fibers, /\['relative h-full w-full overflow-hidden', className\]\.filter\(Boolean\)\.join\(' '\)/);
});

test("los dos traen de serie la pausa con la pestaña oculta y el respeto a reducir movimiento", () => {
  assert.match(threads, /if \(!state\.visible \|\| document\.hidden\) \{/);
  assert.match(threads, /prefers-reduced-motion: reduce/);
  assert.match(fibers, /if \(!alive \|\| !visible \|\| document\.hidden\) return;/);
  assert.match(fibers, /const moving = !s\.paused && !reduce;/);
});

test("el fondo se elige con ?fondo= y por defecto son los hilos", () => {
  assert.equal(pickBackground(""), "threads");
  assert.equal(pickBackground("?fondo=threads"), "threads");
  assert.equal(pickBackground("?fondo=fibras"), "fibras");
  assert.equal(pickBackground("?fondo=loquesea"), "threads");
  assert.equal(pickBackground("?fondo=no"), null);
});

test("más visible en la portada y muy tenue en el resto", () => {
  for (const kind of Object.keys(BACKGROUNDS)) {
    const { hero, rest } = BACKGROUNDS[kind];
    assert.ok(rest < hero / 3, kind);
    assert.ok(Math.abs(backgroundOpacity(0, 800, kind) - hero) < 1e-9, kind);
    assert.ok(Math.abs(backgroundOpacity(5000, 800, kind) - rest) < 1e-9, kind);
  }
});

test("colores de marca en modo claro y el fondo montado en un <main> aislado", () => {
  const bg = readFileSync("components/landing/LandingBackground.tsx", "utf8");
  assert.match(bg, /const NAVY = "#0f1b2d";/);
  assert.match(bg, /const GREEN = "#00c896";/);
  assert.match(bg, /colors=\{\[NAVY, GREEN\]\}\s+coreColor=\{GREEN\}/);
  assert.equal(bg.match(/\blightMode\b/g)?.length, 2);
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /isolate min-h-screen/);
  assert.match(page, /<LandingBackground \/>/);
  assert.match(page, /<section id="portada"/);
});
