// b13: fondo Web Threads (React Bits, TS + Tailwind) fijo detrás de la landing clara.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { OPACITY, backgroundOpacity, threadSettings } from "../components/landing/LandingBackground.tsx";

const threads = readFileSync("components/react-bits/WebThreads.tsx", "utf8");
const bg = readFileSync("components/landing/LandingBackground.tsx", "utf8");
const page = readFileSync("app/page.tsx", "utf8");

test("WebThreads une las clases con espacios (el CLI de shadcn lo rompía)", () => {
  assert.match(threads, /\[ROOT, className\]\.filter\(Boolean\)\.join\(' '\)/);
});

test("WebThreads trae de serie la pausa con la pestaña oculta y el respeto a reducir movimiento", () => {
  assert.match(threads, /if \(!state\.visible \|\| document\.hidden\) \{/);
  assert.match(threads, /prefers-reduced-motion: reduce/);
});

test("solo hilos verdes en modo claro, sin elegir fondo por la URL ni Ghost Fibers", () => {
  assert.match(bg, /const GREEN = "#00c896";/);
  assert.match(bg, /colors=\{\[GREEN, MINT\]\}\s+coreColor=\{GREEN\}/);
  assert.match(bg, /\blightMode\b/);
  assert.doesNotMatch(bg, /#0f1b2d/i);
  assert.doesNotMatch(bg, /location\.search|URLSearchParams|GhostFibers/);
  assert.ok(!existsSync("components/react-bits/GhostFibers.tsx"));
});

test("en el móvil, versión ligera: menos hilos, resolución 1 y sin seguir al dedo", () => {
  const desktop = threadSettings(false);
  const mobile = threadSettings(true);
  assert.ok(mobile.threadCount < desktop.threadCount);
  assert.equal(mobile.dpr, 1);
  assert.equal(mobile.mouseInteraction, false);
});

test("más visible en la portada y muy tenue en el resto", () => {
  assert.ok(OPACITY.rest < OPACITY.hero / 3);
  assert.ok(Math.abs(backgroundOpacity(0, 800) - OPACITY.hero) < 1e-9);
  assert.ok(Math.abs(backgroundOpacity(5000, 800) - OPACITY.rest) < 1e-9);
});

test("montado en un <main> aislado, con halo del color del fondo detrás del texto de la portada", () => {
  assert.match(page, /isolate min-h-screen/);
  assert.match(page, /<LandingBackground \/>/);
  assert.match(page, /<section id="portada"/);
  assert.match(page, /absolute [^"]*-z-10 [^"]*bg-landing-paper blur-2xl/);
});
