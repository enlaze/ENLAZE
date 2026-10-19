// b13: portada «El caos que se ordena» (diseño de Claude Design, 19-10-2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTO_ORDER_SECONDS,
  PIECE_LAYOUT,
  SLOT_ORDER,
  SLOTS,
  piecesFor,
  slotDelays,
} from "../components/landing/chaosOrder.ts";

const hero = readFileSync("components/landing/ChaosHero.tsx", "utf8");

test("las cuatro franjas cubren la captura entera, sin huecos ni solapes", () => {
  let top = 0;
  for (const id of SLOT_ORDER) {
    assert.ok(Math.abs(SLOTS[id].top - top) < 1e-9, id);
    top += SLOTS[id].height;
  }
  assert.ok(Math.abs(top - 100) < 1e-9);
});

test("la ventana final es la captura real del resumen, no un dibujo", () => {
  assert.match(hero, /src="\/landing\/resumen\.png"/);
  assert.match(hero, /width=\{1826\}\s+height=\{1322\}/);
  assert.doesNotMatch(hero, /resumen-diario\.webp|base64/);
});

test("escritorio con las 11 piezas del diseño y móvil con 6 o 7, y cada franja recibe alguna", () => {
  const desktop = piecesFor(false);
  const mobile = piecesFor(true);
  assert.equal(desktop.length, PIECE_LAYOUT.length);
  assert.equal(desktop.length, 11);
  assert.ok(mobile.length >= 6 && mobile.length <= 7, `móvil: ${mobile.length}`);
  for (const placed of [desktop, mobile]) {
    for (const id of SLOT_ORDER) assert.ok(placed.some((p) => p.slot === id), `franja ${id} sin piezas`);
  }
  // Los tipos que pidió Daniil siguen en el móvil.
  const ids = mobile.map((p) => p.id);
  for (const id of ["inv", "wa2", "tk1", "pi", "em", "amt2", "ag"]) assert.ok(ids.includes(id), id);
});

test("encajan pieza a pieza y cada franja aparece después de su última pieza", () => {
  for (const mobile of [false, true]) {
    const placed = piecesFor(mobile);
    placed.forEach((p, k) => assert.equal(p.k, k));
    for (let i = 1; i < placed.length; i++) {
      assert.ok(placed[i].delay > placed[i - 1].delay);
      assert.ok(SLOT_ORDER.indexOf(placed[i].slot) >= SLOT_ORDER.indexOf(placed[i - 1].slot));
    }
    const delays = slotDelays(placed);
    for (const p of placed) assert.ok(delays[p.slot] > p.delay, p.id);
  }
});

test("se ordena sola a los 2-3 segundos o al bajar, con muelles y framer-motion", () => {
  assert.ok(AUTO_ORDER_SECONDS >= 2 && AUTO_ORDER_SECONDS <= 3);
  assert.match(hero, /from "framer-motion"/);
  assert.match(hero, /window\.setTimeout\(fire, AUTO_ORDER_SECONDS \* 1000\)/);
  for (const ev of ["scroll", "wheel", "touchmove"]) assert.match(hero, new RegExp(`addEventListener\\("${ev}", onUserScroll`));
});

test("con reducir movimiento se pinta el estado final, sin animación", () => {
  assert.match(hero, /useMediaQuery\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(hero, /if \(reduce\) \{[\s\S]*?v\.q\.set\(1\);[\s\S]*?v\.o\.set\(0\);[\s\S]*?values\.win\.set\(1\);\s*return;/);
});

test("«el papeleo» pasa de gris a #00c896 cuando todo encaja", () => {
  assert.match(hero, /useTransform\(order, \[0, 1\], \["#98a1ac", "#00c896"\]\)/);
});
