/**
 * Un solo formato de importes en toda la app: «2.819,30 €».
 *
 *   node --import tsx --test __tests__/money-format.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { formatAmount, formatEur, formatEurCompact } from "../lib/money.ts";

const root = path.resolve(import.meta.dirname, "..");

test("punto de miles también con 4 cifras, coma decimal y € detrás", () => {
  assert.equal(formatEur(2819.3), "2.819,30 €");
  assert.equal(formatEur(630), "630,00 €");
  assert.equal(formatEur(1234567.891), "1.234.567,89 €");
  assert.equal(formatEur(-1240), "-1.240,00 €");
  assert.equal(formatAmount(1834.51), "1.834,51");
});

test("acepta lo que llega de la base: texto, null, NaN", () => {
  assert.equal(formatEur("1064.80"), "1.064,80 €");
  assert.equal(formatEur(null), "0,00 €");
  assert.equal(formatEur(undefined), "0,00 €");
  assert.equal(formatEur(Number.NaN), "0,00 €");
});

test("versión corta para etiquetas de gráficos", () => {
  assert.equal(formatEurCompact(2819.3).replace(/\u00a0/g, " "), "2,8 mil €");
});

test("ya no quedan importes con el € delante ni en formato inglés", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name) || entry.name === "money.ts") continue;
      const src = fs.readFileSync(full, "utf8");
      const bad = [
        /€\$\{/,                                   // `€${x}`
        /€\{[^}]*toLocaleString/,                  // JSX €{x.toLocaleString()}
        /toFixed\(2\)\}\s?(€|&euro;)/,             // {x.toFixed(2)} €
        /style: "currency", currency: "EUR"/,      // Intl sin agrupar los miles
        /toFixed\(2\)\.replace\(\/\\B/,            // 1,234.56 del PDF antiguo
      ];
      if (bad.some((rx) => rx.test(src))) offenders.push(path.relative(root, full));
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(path.join(root, dir));
  assert.deepEqual(offenders, []);
});
