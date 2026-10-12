import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SUPPLIER_COLUMNS } from "../lib/suppliers.ts";

/* Columnas reales de public.suppliers, leídas de information_schema el
   2026-10-12 (solo lectura). Si cambia la tabla, cambia aquí y en lib. */
const REAL_COLUMNS = [
  "address", "contact_person", "created_at", "email", "hourly_rate", "id",
  "name", "nif", "notes", "phone", "rating", "specialty", "status", "trade",
  "type", "updated_at", "user_id",
];

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

/** Cada cadena `.from("suppliers")…;` del código, hasta el final de la sentencia. */
function supplierQueries() {
  return ["app", "components", "lib"].flatMap(sourceFiles).flatMap((file) => {
    const src = readFileSync(file, "utf8");
    const found = [];
    for (const m of src.matchAll(/\.from\("suppliers"\)/g)) {
      // Hasta el fin de la sentencia o la siguiente consulta (en un Promise.all
      // van seguidas, separadas solo por comas).
      const rest = src.slice(m.index + m[0].length);
      const end = rest.search(/;|\.from\(|Promise\.resolve/);
      found.push({ file, chain: rest.slice(0, end === -1 ? 400 : end) });
    }
    return found;
  });
}

function columnsUsed(chain) {
  const cols = [];
  for (const [, list] of chain.matchAll(/\.select\("([^"]*)"/g)) {
    for (const c of list.split(",").map((s) => s.trim())) if (c && c !== "*") cols.push(c);
  }
  for (const [, filter] of chain.matchAll(/\.or\(`([^`]*)`/g)) {
    for (const [, c] of filter.matchAll(/(\w+)\.ilike\./g)) cols.push(c);
  }
  for (const [, c] of chain.matchAll(/\.(?:eq|neq|order|ilike|in|is)\("(\w+)"/g)) cols.push(c);
  return cols;
}

test("SUPPLIER_COLUMNS coincide con las columnas reales de suppliers", () => {
  assert.deepEqual([...SUPPLIER_COLUMNS].sort(), REAL_COLUMNS);
});

test("la interfaz Supplier declara exactamente las columnas reales", () => {
  const src = readFileSync("lib/suppliers.ts", "utf8");
  const body = src.match(/export interface Supplier \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const keys = [...body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), REAL_COLUMNS);
});

test("ninguna consulta a suppliers pide o filtra por una columna que no existe", () => {
  const queries = supplierQueries();
  assert.ok(queries.length >= 10, `se esperaban al menos 10 consultas, hay ${queries.length}`);
  const unknown = queries.flatMap(({ file, chain }) =>
    columnsUsed(chain).filter((c) => !REAL_COLUMNS.includes(c)).map((c) => `${file}: ${c}`),
  );
  assert.deepEqual(unknown, []);
});

test("el estado de un proveedor solo puede ser active o inactive, como exige la base", () => {
  const src = readFileSync("lib/suppliers.ts", "utf8");
  assert.match(src, /status: "active" \| "inactive";/);
  assert.doesNotMatch(src, /blocked/);
});
