/**
 * Los títulos de capítulo salen tal cual en el PDF del cliente: tienen que
 * estar bien escritos (tildes, eñes) y cubrir todas las claves que el motor
 * guarda en budget_items.chapter, para no imprimir la clave en crudo
 * («diagnostico»).
 *
 *   node --import tsx --test __tests__/budget-chapter-labels.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CHAPTER_LABELS } from "../lib/budget-engine.ts";

const root = path.resolve(import.meta.dirname, "..");

test("cada capítulo que usa el motor tiene título", () => {
  const src = fs.readFileSync(path.join(root, "lib/budget-engine.ts"), "utf8");
  const used = new Set([...src.matchAll(/\badd\("([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(used.size > 10, "no se han encontrado capítulos en el motor");
  for (const chapter of used) {
    assert.ok(CHAPTER_LABELS[chapter], `falta título para «${chapter}»`);
  }
});

test("títulos con la ortografía correcta", () => {
  assert.equal(CHAPTER_LABELS.diagnostico, "Diagnóstico");
  assert.equal(CHAPTER_LABELS.residuos, "Gestión de residuos");
  assert.equal(CHAPTER_LABELS.fontaneria, "Fontanería y saneamiento");
  assert.equal(CHAPTER_LABELS.revestimientos, "Revestimientos cerámicos");
  assert.equal(CHAPTER_LABELS.impermeabilizacion, "Impermeabilización");
  assert.equal(CHAPTER_LABELS.sanitarios, "Sanitarios y grifería");
  assert.equal(CHAPTER_LABELS.albanileria, "Albañilería y tabiquería");
});

test("ningún título empieza en minúscula", () => {
  for (const [key, label] of Object.entries(CHAPTER_LABELS)) {
    assert.match(label, /^\p{Lu}/u, `«${key}» → «${label}»`);
  }
});
