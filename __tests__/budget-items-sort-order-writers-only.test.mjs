// FASE 2E-1 — Escritores de sort_order (backport sobre origin/main)
//
// Alcance: SOLO la escritura de sort_order en las cinco rutas actuales.
// No se toca el lector, no se toca la RPC, no se toca la migracion.
//
// BLOQUE A: proyecciones en memoria de la logica de numeracion.
// BLOQUE B: inspeccion del codigo fuente real, para que el test falle si
//           alguien revierte la escritura sin tocar este fichero.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (p) => readFileSync(join(RAIZ, p), "utf8");
const norm = (s) => s.replace(/\s+/g, " ");

const F_PROVIDER = "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx";
const F_FORM = "app/dashboard/budgets/_components/budget-form.tsx";
const F_DETALLE = "app/dashboard/budgets/[id]/page.tsx";

// ---------------------------------------------------------------------------
// BLOQUE A — proyecciones de la logica de numeracion
// ---------------------------------------------------------------------------

// Escenario deliberadamente sucio: incluye una partida "opcional" y un material
// no incluido, que los escritores reales filtran ANTES de numerar.
const ESCENARIO = {
  marginPercent: 10,
  partidas: [
    { concept: "Demolicion", status: "aceptada", quantity: 2, unit_price_client: 100, subtotal_client: 200 },
    { concept: "Alicatado", status: "aceptada", quantity: 3, unit_price_client: 50, subtotal_client: 150 },
    { concept: "Sauna", status: "opcional", quantity: 1, unit_price_client: 900, subtotal_client: 900 },
    { concept: "Pintura", status: "aceptada", quantity: 4, unit_price_client: 25, subtotal_client: 100 },
  ],
  materials: [
    { name: "Cemento", included: true, quantity: 10, unit_price: 8, subtotal: 80 },
    { name: "Plomo", included: false, quantity: 1, unit_price: 500, subtotal: 500 },
    { name: "Azulejo", included: true, quantity: 20, unit_price: 4, subtotal: 80 },
  ],
};

// Proyeccion de saveDraft / finalizeBudget: filtrar, concatenar, numerar.
function itemsDelWizard(estado) {
  const mult = 1 + estado.marginPercent / 100;
  const partidas = estado.partidas
    .filter((p) => p.status !== "opcional")
    .map((p) => ({ concept: p.concept, unit_price: p.unit_price_client, subtotal: p.subtotal_client }));
  const materiales = estado.materials
    .filter((m) => m.included)
    .map((m) => ({ concept: m.name, unit_price: m.unit_price * mult, subtotal: m.subtotal * mult }));
  return [...partidas, ...materiales].map((row, idx) => ({ ...row, sort_order: idx }));
}

// Proyeccion del alta manual y de la edicion clasica: numerar el array tal cual.
const itemsNumeradosEnOrden = (partidas) => partidas.map((p, idx) => ({ ...p, sort_order: idx }));

// Proyeccion de la duplicacion: renumerar SIEMPRE, ignorando el sort_order origen.
const itemsDeLaDuplicacion = (items) =>
  items.map((item, idx) => ({ concept: item.concept, sort_order: idx }));

// Control negativo: numerar cada coleccion por separado produce duplicados.
function itemsNumeradosPorSeparado(estado) {
  const partidas = estado.partidas
    .filter((p) => p.status !== "opcional")
    .map((p, idx) => ({ concept: p.concept, sort_order: idx }));
  const materiales = estado.materials
    .filter((m) => m.included)
    .map((m, idx) => ({ concept: m.name, sort_order: idx }));
  return [...partidas, ...materiales];
}

const posiciones = (filas) => filas.map((f) => f.sort_order);
const esContiguoDesdeCero = (filas) =>
  posiciones(filas).every((v, i) => v === i) && filas.length === new Set(posiciones(filas)).size;

describe("FASE 2E-1 · BLOQUE A — numeracion en memoria", () => {
  test("CASO 1 — la asignacion es contigua desde cero y sin huecos", () => {
    const filas = itemsDelWizard(ESCENARIO);
    assert.equal(filas.length, 5, "3 partidas aceptadas + 2 materiales incluidos");
    assert.deepEqual(posiciones(filas), [0, 1, 2, 3, 4]);
    assert.ok(esContiguoDesdeCero(filas));
  });

  test("CASO 2 — cero duplicados: partidas y materiales comparten una sola secuencia", () => {
    const filas = itemsDelWizard(ESCENARIO);
    assert.equal(new Set(posiciones(filas)).size, filas.length);

    // Control negativo: numerar por separado SI duplica. Si esta asercion
    // deja de fallar, el test de arriba habria dejado de medir nada.
    const malas = itemsNumeradosPorSeparado(ESCENARIO);
    assert.notEqual(new Set(posiciones(malas)).size, malas.length);
    assert.deepEqual(posiciones(malas), [0, 1, 2, 0, 1]);
  });

  test("CASO 3 — cero negativos y cero nulos", () => {
    for (const filas of [itemsDelWizard(ESCENARIO), itemsNumeradosEnOrden(ESCENARIO.partidas)]) {
      for (const f of filas) {
        assert.equal(typeof f.sort_order, "number");
        assert.ok(Number.isInteger(f.sort_order) && f.sort_order >= 0, `sort_order invalido: ${f.sort_order}`);
      }
    }
  });

  test("CASO 4 — se numera DESPUES de filtrar: los excluidos no consumen posicion", () => {
    const filas = itemsDelWizard(ESCENARIO);
    assert.ok(!filas.some((f) => f.concept === "Sauna"), "la partida opcional no se inserta");
    assert.ok(!filas.some((f) => f.concept === "Plomo"), "el material no incluido no se inserta");
    // Pintura va 3.a pese a ser la 4.a del array de origen: Sauna no reserva hueco.
    assert.equal(filas.find((f) => f.concept === "Pintura").sort_order, 2);
    assert.equal(filas.find((f) => f.concept === "Cemento").sort_order, 3);
  });

  test("CASO 5 — el orden es partidas primero, materiales despues", () => {
    const filas = itemsDelWizard(ESCENARIO);
    assert.deepEqual(
      filas.map((f) => f.concept),
      ["Demolicion", "Alicatado", "Pintura", "Cemento", "Azulejo"],
    );
  });

  test("CASO 6 — la numeracion no altera ningun otro campo", () => {
    const mult = 1.1;
    const filas = itemsDelWizard(ESCENARIO);
    const cemento = filas.find((f) => f.concept === "Cemento");
    assert.equal(cemento.unit_price, 8 * mult);
    assert.equal(cemento.subtotal, 80 * mult);
    // Economia total intacta respecto a la misma proyeccion sin sort_order.
    const suma = (xs) => xs.reduce((a, b) => a + b.subtotal, 0);
    const sinNumerar = [
      ...ESCENARIO.partidas.filter((p) => p.status !== "opcional").map((p) => ({ subtotal: p.subtotal_client })),
      ...ESCENARIO.materials.filter((m) => m.included).map((m) => ({ subtotal: m.subtotal * mult })),
    ];
    assert.equal(suma(filas), suma(sinNumerar));
  });

  test("CASO 7 — la duplicacion renumera desde cero e ignora el origen", () => {
    // Origen deliberadamente degenerado: todo a cero, como una fila historica.
    const origen = [
      { concept: "A", sort_order: 0 },
      { concept: "B", sort_order: 0 },
      { concept: "C", sort_order: 0 },
    ];
    const copia = itemsDeLaDuplicacion(origen);
    assert.deepEqual(posiciones(copia), [0, 1, 2]);
    assert.ok(esContiguoDesdeCero(copia));
    // El origen no se muta.
    assert.deepEqual(posiciones(origen), [0, 0, 0]);
  });

  test("CASO 8 — coleccion vacia: no se inserta nada y no se rompe", () => {
    assert.deepEqual(itemsDelWizard({ marginPercent: 0, partidas: [], materials: [] }), []);
    assert.deepEqual(itemsNumeradosEnOrden([]), []);
    assert.deepEqual(itemsDeLaDuplicacion([]), []);
  });
});

// ---------------------------------------------------------------------------
// BLOQUE B — inspeccion del codigo fuente real
// ---------------------------------------------------------------------------

describe("FASE 2E-1 · BLOQUE B — los cinco escritores reales", () => {
  test("CASO 9 — saveDraft numera y lo hace ANTES de itemsSignature", () => {
    const src = leer(F_PROVIDER);
    const plano = norm(src);

    assert.match(
      plano,
      /const itemsToInsert = \[\.\.\.partidasToInsert, \.\.\.materialsToInsert\] \.map\(\(row, idx\) => \(\{ \.\.\.row, sort_order: idx \}\)\);/,
      "itemsToInsert debe numerarse con .map((row, idx) => ({ ...row, sort_order: idx }))",
    );

    // Orden relativo: la numeracion precede al calculo de la firma.
    const iNumerado = src.indexOf("sort_order: idx");
    const iFirma = src.indexOf("const itemsSignature");
    assert.ok(iNumerado > -1 && iFirma > -1, "faltan los anclajes de saveDraft");
    assert.ok(
      iNumerado < iFirma,
      "la firma debe calcularse sobre las filas ya numeradas, no antes",
    );
  });

  test("CASO 10 — hay dos escritores numerados en el wizard (saveDraft y finalizeBudget)", () => {
    const src = leer(F_PROVIDER);
    const numerados = norm(src).match(
      /\[\.\.\.partidasToInsert, \.\.\.materialsToInsert\] \.map\(\(row, idx\) => \(\{ \.\.\.row, sort_order: idx \}\)\)/g,
    );
    assert.equal(numerados?.length, 2, "saveDraft y finalizeBudget deben numerar ambos");

    // Y no queda ninguna concatenacion sin numerar.
    const sinNumerar = norm(src).match(
      /const itemsToInsert = \[\.\.\.partidasToInsert, \.\.\.materialsToInsert\];/g,
    );
    assert.equal(sinNumerar, null, "no debe quedar ningun itemsToInsert sin numerar");
  });

  test("CASO 11 — la edicion clasica envia a la RPC el array numerado", () => {
    const plano = norm(leer(F_FORM));
    assert.match(
      plano,
      /const itemsForRpc = partidas\.map\(\(p, idx\) => \(\{ \.\.\.p, sort_order: idx \}\)\);/,
      "debe construirse itemsForRpc numerado",
    );
    assert.match(plano, /p_items: itemsForRpc,/, "p_items debe recibir el array numerado");
    assert.doesNotMatch(plano, /p_items: partidas,/, "p_items ya no debe recibir partidas en crudo");
  });

  test("CASO 12 — el snapshot de version sigue guardando partidas sin tocar", () => {
    // Cambio deliberadamente acotado: la RPC recibe lo numerado, el snapshot no.
    assert.match(norm(leer(F_FORM)), /items: partidas,/);
  });

  test("CASO 13 — el alta manual escribe sort_order en cada insert", () => {
    const plano = norm(leer(F_FORM));
    assert.match(
      plano,
      /for \(const \[idx, p\] of partidas\.entries\(\)\)/,
      "el bucle debe iterar con indice",
    );
    assert.match(
      plano,
      /subtotal: p\.subtotal, sort_order: idx, \}\);/,
      "el insert manual debe incluir sort_order: idx",
    );
  });

  test("CASO 14 — la duplicacion escribe sort_order en cada fila del lote", () => {
    const plano = norm(leer(F_DETALLE));
    assert.match(
      plano,
      /const itemsToInsert = items\.map\(\(item, idx\) => \(\{/,
      "el lote duplicado debe construirse con items.map((item, idx) => ...)",
    );
    assert.match(
      plano,
      /subtotal: item\.subtotal, sort_order: idx, \}\)\);/,
      "cada fila del lote duplicado debe incluir sort_order: idx",
    );
    assert.match(
      plano,
      /\.from\("budget_items"\) \.insert\(itemsToInsert\)/,
      "las partidas duplicadas deben insertarse como un unico lote",
    );
    assert.ok(
      !/for \(const \[idx, item\] of items\.entries\(\)\)/.test(plano),
      "el antiguo bucle de INSERT individual no debe reaparecer",
    );
  });

  test("CASO 15 — el LECTOR sigue ordenando por created_at (fuera de alcance)", () => {
    const plano = norm(leer(F_DETALLE));
    assert.match(
      plano,
      /\.order\("created_at", \{ ascending: true \}\)/,
      "esta fase NO cambia el criterio de lectura",
    );
    assert.doesNotMatch(
      plano,
      /\.order\("sort_order"/,
      "leer por sort_order es la fase siguiente, no esta",
    );
  });

  test("CASO 16 — no se ha tocado la migracion ni la RPC desde el codigo", () => {
    // Ningun fichero de aplicacion define ni altera la columna.
    for (const f of [F_PROVIDER, F_FORM, F_DETALLE]) {
      const plano = norm(leer(f));
      assert.doesNotMatch(plano, /alter table/i, `${f} no debe contener DDL`);
      assert.doesNotMatch(plano, /create or replace function/i, `${f} no debe redefinir la RPC`);
    }
  });
});
