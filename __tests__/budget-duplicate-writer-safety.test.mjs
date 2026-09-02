// FASE 2E-1 · corrección del writer de duplicación
//
// Contexto: la duplicacion en produccion fallaba con HTTP 403 / SQLSTATE 42501
// ("new row violates row-level security policy for table budgets") porque el
// INSERT de la cabecera no incluia user_id, y la politica de INSERT exige
// auth.uid() = user_id. Ademas las partidas se insertaban una a una sin
// comprobar el error, lo que permitia una copia parcial silenciosa.
//
// Alcance: SOLO duplicateBudget() en la pagina de detalle. No se toca el lector,
// no se toca la RPC, no se tocan migraciones ni el resto de escritores.
//
// BLOQUE A: proyeccion en memoria de la numeracion del lote.
// BLOQUE B: inspeccion del codigo fuente real, para que el test falle si
//           alguien revierte cualquiera de las garantias sin tocar este fichero.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (p) => readFileSync(join(RAIZ, p), "utf8");
const norm = (s) => s.replace(/\s+/g, " ");

const F_DETALLE = "app/dashboard/budgets/[id]/page.tsx";

// Aisla el cuerpo de duplicateBudget() para que las aserciones no puedan
// satisfacerse por casualidad con codigo de otra funcion del mismo fichero.
function cuerpoDuplicate(src) {
  const inicio = src.indexOf("async function duplicateBudget()");
  assert.notEqual(inicio, -1, "no se encontro duplicateBudget() en el fichero");
  const siguiente = src.indexOf("const [exportingPDF", inicio);
  assert.notEqual(siguiente, -1, "no se encontro el final de duplicateBudget()");
  return src.slice(inicio, siguiente);
}

// ---------------------------------------------------------------------------
// BLOQUE A — proyeccion de la numeracion del lote
// ---------------------------------------------------------------------------

// La copia ignora el sort_order historico del origen: el original puede ser
// antiguo, no retrollenado, o simplemente no contiguo. Se renumera siempre.
const ORIGEN_SUCIO = [
  { concept: "Partida A", sort_order: 7 },
  { concept: "Partida B", sort_order: null },
  { concept: "Partida C", sort_order: 7 },
];

const loteDeLaCopia = (items) =>
  items.map((item, idx) => ({ concept: item.concept, sort_order: idx }));

const posiciones = (filas) => filas.map((f) => f.sort_order);
const esContiguoDesdeCero = (p) => p.every((v, i) => v === i);

describe("FASE 2E-1 · corrección del writer de duplicación · BLOQUE A — numeracion del lote duplicado", () => {
  test("CASO 1 — renumera desde cero segun el orden del array items", () => {
    assert.deepEqual(posiciones(loteDeLaCopia(ORIGEN_SUCIO)), [0, 1, 2]);
  });

  test("CASO 2 — ignora el sort_order historico del origen", () => {
    const copia = loteDeLaCopia(ORIGEN_SUCIO);
    assert.deepEqual(
      copia.map((f) => f.concept),
      ["Partida A", "Partida B", "Partida C"],
      "el orden de conceptos debe ser el del array de origen",
    );
    assert.ok(
      !posiciones(copia).includes(7),
      "ningun sort_order del origen debe sobrevivir a la copia",
    );
    assert.ok(
      !posiciones(copia).includes(null),
      "un sort_order nulo del origen no debe propagarse",
    );
  });

  test("CASO 3 — el resultado es contiguo y sin duplicados", () => {
    const p = posiciones(loteDeLaCopia(ORIGEN_SUCIO));
    assert.ok(esContiguoDesdeCero(p), `esperado contiguo desde cero, obtenido ${p}`);
    assert.equal(new Set(p).size, p.length, "no debe haber posiciones repetidas");
  });

  test("CASO 4 — control negativo: conservar el origen romperia la invariante", () => {
    const copiaIngenua = ORIGEN_SUCIO.map((i) => ({ sort_order: i.sort_order }));
    const p = posiciones(copiaIngenua);
    assert.deepEqual(p, [7, null, 7]);
    assert.ok(
      !esContiguoDesdeCero(p),
      "el control negativo debe fallar la invariante; si pasa, la proyeccion no prueba nada",
    );
  });

  test("CASO 5 — un origen vacio produce un lote vacio", () => {
    assert.deepEqual(loteDeLaCopia([]), []);
  });
});

// ---------------------------------------------------------------------------
// BLOQUE B — inspeccion del codigo fuente real
// ---------------------------------------------------------------------------

describe("FASE 2E-1 · corrección del writer de duplicación · BLOQUE B — duplicateBudget() real", () => {
  test("CASO 6 — obtiene el usuario con supabase.auth.getUser()", () => {
    const plano = norm(cuerpoDuplicate(leer(F_DETALLE)));
    assert.match(
      plano,
      /await supabase\.auth\.getUser\(\)/,
      "debe resolver el usuario autenticado con el cliente Supabase ya creado",
    );
  });

  test("CASO 7 — sale antes de escribir nada si no hay sesion", () => {
    const cuerpo = cuerpoDuplicate(leer(F_DETALLE));
    const plano = norm(cuerpo);

    assert.match(
      plano,
      /if \(authError \|\| !user\) \{ toast\.error\([^)]*\); return; \}/,
      "sin usuario debe avisar y retornar",
    );

    // La guarda tiene que preceder a cualquier escritura, no solo existir.
    const guarda = cuerpo.indexOf("if (authError || !user)");
    const insertCabecera = cuerpo.indexOf('.from("budgets")');
    const insertPartidas = cuerpo.indexOf('.from("budget_items")');
    const navegacion = cuerpo.indexOf("router.push");

    assert.ok(guarda > -1, "no se encontro la guarda de sesion");
    assert.ok(guarda < insertCabecera, "la guarda debe preceder al INSERT de la cabecera");
    assert.ok(guarda < insertPartidas, "la guarda debe preceder al INSERT de partidas");
    assert.ok(guarda < navegacion, "la guarda debe preceder a cualquier navegacion");
  });

  test("CASO 8 — la cabecera se escribe con user_id del usuario autenticado", () => {
    const plano = norm(cuerpoDuplicate(leer(F_DETALLE)));
    assert.match(plano, /user_id: user\.id,/, "el INSERT debe incluir user_id: user.id");
    assert.ok(
      !/user_id: budget\./.test(plano),
      "el propietario no debe tomarse de los datos del presupuesto de origen",
    );
  });

  test("CASO 9 — la cabecera conserva project_id del origen", () => {
    const plano = norm(cuerpoDuplicate(leer(F_DETALLE)));
    assert.match(
      plano,
      /project_id: budget\.project_id \?\? null,/,
      "el INSERT debe propagar project_id, con null explicito si no hay proyecto",
    );
  });

  test("CASO 10 — construye un array de partidas numerado con sort_order: idx", () => {
    const plano = norm(cuerpoDuplicate(leer(F_DETALLE)));
    assert.match(
      plano,
      /const itemsToInsert = items\.map\(\(item, idx\) => \(\{/,
      "las partidas deben construirse como array con .map((item, idx) => ...)",
    );
    assert.match(plano, /sort_order: idx,/, "cada fila debe llevar sort_order: idx");
  });

  test("CASO 11 — un unico INSERT del lote, y no si esta vacio", () => {
    const cuerpo = cuerpoDuplicate(leer(F_DETALLE));
    const plano = norm(cuerpo);

    const inserts = cuerpo.match(/\.from\("budget_items"\)/g) ?? [];
    assert.equal(
      inserts.length,
      1,
      `debe haber exactamente un acceso a budget_items, encontrados ${inserts.length}`,
    );

    assert.match(
      plano,
      /if \(itemsToInsert\.length > 0\) \{/,
      "no debe lanzarse el INSERT con un lote vacio",
    );
    assert.match(
      plano,
      /\.from\("budget_items"\) \.insert\(itemsToInsert\)/,
      "el INSERT debe recibir el array completo, no una fila suelta",
    );
  });

  test("CASO 12 — comprueba explicitamente el error del lote y lo muestra", () => {
    const plano = norm(cuerpoDuplicate(leer(F_DETALLE)));
    assert.match(
      plano,
      /const \{ error: itemsError \} = await supabase/,
      "el error del lote debe desestructurarse",
    );
    assert.match(plano, /if \(itemsError\) \{/, "el error del lote debe comprobarse");
    assert.match(
      plano,
      /if \(itemsError\) \{[^}]*toast\.error\(/,
      "el fallo del lote debe comunicarse al usuario",
    );
  });

  test("CASO 13 — el aviso no niega la cabecera y remite a la copia", () => {
    const cuerpo = cuerpoDuplicate(leer(F_DETALLE));
    const plano = norm(cuerpo);

    assert.match(
      plano,
      /toast\.error\(\s*`Se creó el presupuesto \$\{newNumber\} pero no se copiaron sus partidas/,
      "el mensaje debe reconocer que la cabecera si se creo",
    );

    // Tras el fallo del lote se navega igualmente a la cabecera creada, para que
    // nadie repita la duplicacion creyendo que no ocurrio nada.
    const fallo = cuerpo.indexOf("if (itemsError)");
    const navegacionTrasFallo = cuerpo.indexOf("router.push", fallo);
    const cierreDelFallo = cuerpo.indexOf("return;", fallo);
    assert.ok(fallo > -1, "no se encontro la rama de fallo del lote");
    assert.ok(
      navegacionTrasFallo > -1 && navegacionTrasFallo < cierreDelFallo,
      "la rama de fallo debe navegar a la cabecera creada antes de retornar",
    );
  });

  test("CASO 14 — no queda el antiguo bucle de INSERT individual", () => {
    const plano = norm(cuerpoDuplicate(leer(F_DETALLE)));
    assert.ok(
      !/for \(const \[idx, item\] of items\.entries\(\)\) \{ await supabase/.test(plano),
      "el bucle de inserciones silenciosas una a una debe haber desaparecido",
    );
    assert.ok(
      !/await supabase\.from\("budget_items"\)\.insert\(\{/.test(plano),
      "no debe quedar ningun INSERT de una sola fila sin comprobar su error",
    );
  });

  test("CASO 15 — no se borra la cabecera automaticamente si falla el lote", () => {
    const plano = norm(cuerpoDuplicate(leer(F_DETALLE)));
    assert.ok(
      !/\.delete\(\)/.test(plano),
      "la atomicidad cabecera-partidas exige diseño transaccional, no un rollback improvisado",
    );
  });

  test("CASO 16 — el presupuesto original no se modifica en la duplicacion", () => {
    const plano = norm(cuerpoDuplicate(leer(F_DETALLE)));
    assert.ok(
      !/\.update\(/.test(plano),
      "duplicar no debe escribir sobre el presupuesto de origen",
    );
    assert.ok(
      !/\.eq\("id", budget\.id\)/.test(plano),
      "duplicar no debe apuntar a la fila del origen",
    );
  });

  test("CASO 17 — no se introduce RPC, SQL ni migraciones en el escritor", () => {
    const plano = norm(cuerpoDuplicate(leer(F_DETALLE)));
    for (const prohibido of [/\.rpc\(/, /create or replace function/i, /alter table/i]) {
      assert.ok(!prohibido.test(plano), `el escritor no debe contener ${prohibido}`);
    }
  });
});
