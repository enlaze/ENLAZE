import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ─────────────────────────────────────────────────────────────────────
 *  El vocabulario de `budget_items.category` vive en cuatro sitios y
 *  tienen que decir lo mismo.
 *
 *  El defecto que motiva esto: el prompt del generador ofrecía cuatro
 *  categorías —incluida `maquinaria`— y el CHECK admitía tres. Nada las
 *  reconciliaba, así que una partida de maquinaria moría con 23514 al
 *  guardarse. En producción, 0 de 911 partidas eran maquinaria.
 *
 *  Estas comprobaciones impiden que los cuatro sitios vuelvan a divergir,
 *  en cualquier dirección.
 * ───────────────────────────────────────────────────────────────────── */

const CANONICAS = ["mano_obra", "maquinaria", "material", "otros"];

const leer = (ruta) => readFileSync(ruta, "utf8");
const migracion = leer("supabase/migrations/20260927120000_budget_items_allow_maquinaria.sql");
const bootstrap = leer("__tests__/support/bootstrap-budget-schema.sql");
const prompt = leer("app/api/agent/budget-analysis/route.ts");
const formulario = leer("app/dashboard/budgets/_components/budget-form.tsx");

/** Extrae los literales entre comillas de un fragmento y los ordena. */
const literales = (fragmento) =>
  [...fragmento.matchAll(/["'`]([a-z_]+)["'`]/g)].map((m) => m[1]).sort();

test("la migración amplía a las cuatro y sigue rechazando lo desconocido", () => {
  const nuevo = migracion.slice(migracion.indexOf("add constraint budget_items_category_check"));
  assert.deepEqual(literales(nuevo.slice(0, nuevo.indexOf(";"))).filter((v) => CANONICAS.includes(v)),
    CANONICAS, "el CHECK nuevo enumera exactamente las cuatro");
  assert.match(migracion, /check \(category = any \(array\[/i,
    "sigue siendo una lista cerrada, no un CHECK relajado");
  // El guard exige el vocabulario de partida exacto antes de tocar nada.
  assert.match(migracion, /unexpected budget_items_category_check definition/,
    "aborta si el CHECK de partida no es el previsto");
  assert.match(migracion, /category outside the new vocabulary/,
    "y aborta si alguna fila quedara fuera del vocabulario nuevo");
  assert.equal(/\b(update|delete|truncate)\s+(?:from\s+)?public\.budget_items\b/i.test(migracion), false,
    "no toca ninguna de las 911 filas");
});

test("el bootstrap de pruebas dice lo mismo que la migración", () => {
  const linea = bootstrap.slice(bootstrap.indexOf("budget_items_category_check check"));
  assert.deepEqual(literales(linea.slice(0, linea.indexOf(";"))).filter((v) => CANONICAS.includes(v)),
    CANONICAS, "el banco desechable reproduce el vocabulario real");
});

test("el prompt del generador ofrece exactamente el vocabulario válido", () => {
  const linea = prompt.split("\n").find((l) => l.includes("- category:"));
  assert.ok(linea, "el prompt sigue enumerando las categorías");
  assert.deepEqual(literales(linea), CANONICAS,
    "ni una categoría de más —que la base rechazaría— ni una de menos");
});

test("el formulario manual ofrece exactamente el vocabulario válido", () => {
  const bloque = formulario.slice(formulario.indexOf("const categoryOptions"),
                                  formulario.indexOf("const ivaOptions"));
  const valores = [...bloque.matchAll(/value:\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(valores, CANONICAS,
    "quien clasifica a mano puede elegir lo mismo que el generador");
});

test("los cuatro sitios coinciden entre sí, no solo con la constante", () => {
  // Comparación cruzada: si alguien cambia la constante de esta prueba y un
  // solo sitio, las demás comparaciones lo delatan igual.
  const delCheck = literales(migracion.slice(migracion.indexOf("add constraint")).split(";")[0])
    .filter((v) => CANONICAS.includes(v));
  const delBootstrap = literales(bootstrap.slice(bootstrap.indexOf("budget_items_category_check check")).split(";")[0])
    .filter((v) => CANONICAS.includes(v));
  const delPrompt = literales(prompt.split("\n").find((l) => l.includes("- category:")));
  const delFormulario = [...formulario
    .slice(formulario.indexOf("const categoryOptions"), formulario.indexOf("const ivaOptions"))
    .matchAll(/value:\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(delBootstrap, delCheck, "bootstrap frente a migración");
  assert.deepEqual(delPrompt, delCheck, "prompt frente a migración");
  assert.deepEqual(delFormulario, delCheck, "formulario frente a migración");
});

test("maquinaria no se confunde con el subsector del banco de precios", () => {
  // `maquinaria` también existe como business_subsector de pb_products, con su
  // propia lista más larga. Son vocabularios distintos y el defecto original
  // nació de mezclarlos, así que conviene dejar constancia de que no son el
  // mismo conjunto.
  const banco = leer("lib/price-defaults.ts");
  const subsectores = [...banco.matchAll(/value:\s*"([a-z_]+)",\s*label:/g)].map((m) => m[1]);
  assert.ok(subsectores.includes("maquinaria"),
    "el banco de precios tiene su maquinaria, y es otra cosa");
  assert.ok(subsectores.length > CANONICAS.length,
    "su vocabulario es más amplio: no debe copiarse al de partidas");
});
