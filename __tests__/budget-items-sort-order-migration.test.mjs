/**
 * FASE 2E-2 — LA MIGRACIÓN QUE HACE DETERMINISTA EL ORDEN DE `budget_items`.
 *
 * La 2E-1 puso a los cinco writers de la aplicación a escribir `sort_order` desde el
 * índice del array, y `__tests__/budget-items-sort-order.test.mjs` la custodia. Pero
 * quedaban dos agujeros que ningún cambio de JavaScript podía tapar:
 *
 *   1. La edición clásica no pasa por el cliente. Entrega las filas a la RPC
 *      `update_budget_with_items`, que hace DELETE + INSERT dentro de PostgreSQL. Si su
 *      INSERT no NOMBRA `sort_order`, cada edición devuelve el presupuesto entero al
 *      `default 0` en silencio, por muy bien numerado que llegase el array.
 *
 *   2. Las 807 filas que ya existen están todas a 0. Ningún writer nuevo las toca.
 *
 * `supabase/migrations/20260901120000_budget_items_sort_order.sql` cierra los dos y
 * añade las constraints que impiden que el orden se vuelva a perder. Esta suite es lo
 * que impide que esa migración diga una cosa y haga otra.
 *
 * CÓMO SE PRUEBA, Y POR QUÉ ASÍ
 * -----------------------------
 * No hay conexión a Supabase: una suite que necesita la base de datos no se ejecuta en
 * CI y acaba no ejecutándose nunca. Así que se ataca por dos frentes distintos:
 *
 *   SOBRE EL TEXTO DE LA MIGRACIÓN, tokenizando SQL de verdad —no con grep— para poder
 *   afirmar cosas NEGATIVAS con fundamento: que no hay control de transacción de nivel
 *   superior, que no se escribe ninguna columna que no sea `sort_order`, que no se toca
 *   otra tabla. El tokenizador es el de la FASE 2D-5b, extraído a
 *   `__tests__/lib/sql-toplevel.mjs`; sus propios casos de control siguen en
 *   `__tests__/migration-transaction-control.test.mjs`.
 *
 *   EJECUTANDO la lógica del backfill, replicada en JavaScript con la MISMA semántica
 *   que el SQL (partidas y luego materiales, `min(posicion)` por clave, `row_number`
 *   con `nulls last` y desempate por `id`), para poder comprobar que produce 0..N-1
 *   completo y único, que es idempotente y que no pisa lo que ya escribió un writer.
 *
 * Y la pieza central: la EQUIVALENCIA. La migración afirma que su RPC es la de 2D-5 con
 * exactamente tres cambios. El CASO M1 deshace esos tres cambios mecánicamente y exige
 * que lo que queda sea, carácter a carácter, la función desplegada en 2D-5. Es la única
 * forma de saber que la migración no ha movido de paso una cifra, un `coalesce` o el
 * snapshot de ciclo de vida.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { trocearStatements, detectarControlTransaccion } from "./lib/sql-toplevel.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIG_2E2 = "supabase/migrations/20260901120000_budget_items_sort_order.sql";
const MIG_2D5 = "supabase/migrations/20260826103500_update_budget_with_items_canonical.sql";

const sql2e2 = fs.readFileSync(path.join(root, MIG_2E2), "utf8");
const sql2d5 = fs.readFileSync(path.join(root, MIG_2D5), "utf8");

const DIRECTIVA_SIN_TRANSACCION = "-- pg-delta: transaction=false";

const FIRMA = "public.update_budget_with_items(uuid, jsonb, jsonb)";

/** Las columnas económicas que el INSERT de la RPC lleva desde el primer día. */
const ECONOMICAS = [
  "concept",
  "description",
  "quantity",
  "unit",
  "category",
  "chapter",
  "unit_price",
  "subtotal",
];

/** Las siete canónicas que añadió la FASE 2D-5. */
const CANONICAS = [
  "canonical_id",
  "canonical_status",
  "canonical_confidence",
  "canonical_source",
  "canonical_origin",
  "canonical_source_ref",
  "price_type",
];

// ─── Utilidades de lectura del SQL ────────────────────────────────────────────

/** El bloque `create or replace function ... $$;` completo. Los `do $etiqueta$` del
 *  backfill llevan etiqueta propia, así que el primer `$$;` cierra la función y sólo
 *  la función. */
function bloqueFuncion(sql) {
  const i = sql.indexOf("create or replace function");
  assert.ok(i >= 0, "no se encuentra el CREATE OR REPLACE FUNCTION");
  const j = sql.indexOf("$$;", i);
  assert.ok(j > i, "no se encuentra el cierre $$; de la función");
  return sql.slice(i, j + 3);
}

/** Quita los comentarios de línea y colapsa los espacios. Comparar así evita que un
 *  reajuste de sangría o un comentario nuevo se lea como un cambio de comportamiento. */
function normalizar(sqlFragmento) {
  return sqlFragmento
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deshace los TRES cambios que la migración declara sobre la RPC de 2D-5:
 *   a) `with ordinality as t(item, ordinality)`  →  `as item`
 *   b) la columna `sort_order` de la lista
 *   c) el valor `(ordinality - 1)::integer`
 *
 * Si la migración hubiese tocado cualquier otra cosa, lo que queda tras deshacer estos
 * tres ya no puede coincidir con el original.
 */
function deshacerLosTresCambios(fn) {
  const conFrom = fn.replace(
    "from jsonb_array_elements(p_items) with ordinality as t(item, ordinality)",
    "from jsonb_array_elements(p_items) as item",
  );
  assert.notEqual(conFrom, fn, "no se encontró el FROM con `with ordinality` que deshacer");

  const lineas = conFrom.split("\n");
  const sinColumna = lineas.filter((l) => l.trim() !== "sort_order,");
  assert.equal(
    lineas.length - sinColumna.length,
    1,
    "se esperaba exactamente una línea `sort_order,` en la lista de columnas",
  );

  const sinValor = sinColumna.filter((l) => l.trim() !== "(ordinality - 1)::integer,");
  assert.equal(
    sinColumna.length - sinValor.length,
    1,
    "se esperaba exactamente una línea `(ordinality - 1)::integer,` en la lista de valores",
  );

  return sinValor.join("\n");
}

/** La lista de columnas del INSERT en `budget_items`, en orden. */
function columnasDelInsert(sql) {
  const i = sql.indexOf("insert into public.budget_items");
  assert.ok(i > 0, "no se encuentra el INSERT de budget_items");
  const abre = sql.indexOf("(", i);
  const cierra = sql.indexOf(")", abre);
  assert.ok(abre > 0 && cierra > abre, "no se encuentra la lista de columnas del INSERT");
  return sql
    .slice(abre + 1, cierra)
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Los statements de nivel superior, ya sin comentarios, en minúsculas y con los
 *  espacios colapsados. Es lo que hay que juzgar cuando se afirma que algo NO ocurre:
 *  la migración explica en prosa lo que deliberadamente no hace, y un grep sobre el
 *  fichero entero encontraría la explicación. */
const statements = trocearStatements(sql2e2);
const statementsPlanos = statements.map((s) => s.replace(/\s+/g, " ").trim().toLowerCase());

/** Todo lo que NO es el cuerpo de la RPC: el backfill, las verificaciones, el DDL y la
 *  ACL. Aquí es donde tiene sentido preguntar si la migración escribe datos. */
const fueraDeLaFuncion = statementsPlanos.filter(
  (s) => !s.startsWith("create or replace function"),
);

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE A · La RPC: tres cambios, ni uno más
// ══════════════════════════════════════════════════════════════════════════════

describe("2E-2 · la RPC es la de 2D-5 con exactamente tres cambios", () => {
  test("CASO M1 — deshacer los tres cambios devuelve la función desplegada en 2D-5", () => {
    const reconstruida = deshacerLosTresCambios(bloqueFuncion(sql2e2));

    assert.equal(
      normalizar(reconstruida),
      normalizar(bloqueFuncion(sql2d5)),
      "la migración ha cambiado algo más que la posición: firma, validaciones, snapshot, " +
        "descuentos, IVA, total o el transporte canónico ya no son los de 2D-5",
    );
  });

  test("CASO M2 — CONTROL NEGATIVO: cualquier retoque del cuerpo rompe el CASO M1", () => {
    // Sin esto, el CASO M1 podría estar comparando dos cadenas que se parecen por
    // casualidad. Cada sabotaje representa una clase de daño distinta: la aritmética,
    // el modelo de seguridad, el default de una columna, el snapshot de ciclo de vida
    // y el transporte canónico.
    const SABOTAJES = [
      ["el redondeo del subtotal de línea", /round\(\(item->>'quantity'\)::numeric \* \(item->>'unit_price'\)::numeric, 2\)/, "round((item->>'quantity')::numeric * (item->>'unit_price')::numeric, 3)"],
      ["el modelo de seguridad", /security definer/, "security invoker"],
      ["el search_path", /set search_path = public, pg_temp/, "set search_path = public"],
      ["el default replicado de canonical_status", /'unmatched'/, "'matched'"],
      ["el snapshot previo al reset de ciclo de vida", /v_reset_lifecycle := v_current_status in \(/, "v_reset_lifecycle := false and v_current_status in ("],
      ["el transporte de canonical_source_ref", /nullif\(item->>'canonical_source_ref', ''\)/, "null"],
      ["el cálculo de la base imponible", /greatest\(0, v_subtotal - v_discount_amount\)/, "greatest(0, v_subtotal)"],
    ];

    const original = normalizar(bloqueFuncion(sql2d5));
    // El sabotaje se aplica al CUERPO de la función, no al fichero entero: la cabecera
    // de la migración menciona en prosa varias de estas expresiones —`security
    // definer`, el redondeo, el default de `canonical_status`— y sabotear el comentario
    // no cambiaría nada, porque `normalizar` los quita. El control negativo quedaría
    // verde sin haber probado nada.
    const fn = bloqueFuncion(sql2e2);

    for (const [nombre, patron, reemplazo] of SABOTAJES) {
      const saboteada = fn.replace(patron, reemplazo);
      assert.notEqual(saboteada, fn, `el sabotaje de ${nombre} no cambió nada`);
      assert.notEqual(
        normalizar(saboteada),
        normalizar(fn),
        `el sabotaje de ${nombre} cayó en un comentario: no toca el cuerpo de la función`,
      );

      const reconstruida = normalizar(deshacerLosTresCambios(saboteada));
      assert.notEqual(
        reconstruida,
        original,
        `sabotear ${nombre} no rompe el CASO M1: la comparación no está midiendo el cuerpo`,
      );
    }
  });

  test("CASO M3 — los tres cambios son exactamente los declarados", () => {
    const columnas = columnasDelInsert(bloqueFuncion(sql2e2));

    assert.deepEqual(
      columnas,
      ["budget_id", "sort_order", ...ECONOMICAS, ...CANONICAS],
      "la lista de columnas del INSERT no es la de 2D-5 con `sort_order` insertada detrás " +
        "de `budget_id`",
    );
    assert.equal(columnas.length, 17, "el INSERT ya no son 9 económicas + 7 canónicas + la posición");

    assert.deepEqual(
      columnasDelInsert(bloqueFuncion(sql2d5)),
      ["budget_id", ...ECONOMICAS, ...CANONICAS],
      "la migración de referencia ha cambiado: este test estaría comparando contra otra cosa",
    );

    assert.match(
      bloqueFuncion(sql2e2),
      /from jsonb_array_elements\(p_items\) with ordinality as t\(item, ordinality\)/,
      "el INSERT no recorre `p_items` con `with ordinality`: la RPC no conoce la posición",
    );
    assert.match(
      bloqueFuncion(sql2e2),
      /\(ordinality - 1\)::integer/,
      "falta la conversión de la ordinalidad base 1 de Postgres al contrato base 0",
    );
  });

  test("CASO M4 — la posición la pone Postgres, no el JSON del cliente", () => {
    // `item->>'sort_order'` vendría del cliente y podría llegar repetido, con huecos o
    // desalineado con el array que lo transporta. La UNIQUE lo rechazaría con un error
    // que el usuario no podría entender. `with ordinality` no puede repetirse.
    const cuerpo = normalizar(bloqueFuncion(sql2e2));
    assert.ok(
      !/item->>'sort_order'/.test(cuerpo),
      "la RPC lee la posición del JSON: eso deja el orden en manos del cliente",
    );
  });

  test("CASO M4b — esta migración es la ÚLTIMA que redefine la RPC", () => {
    // La cadena de custodia de la función es: `canonical-wiring-edit-rpc.test.mjs`
    // custodia la de 2D-5, y el CASO M1 demuestra que la desplegada es aquélla más tres
    // cambios. Esa cadena sólo vale mientras la última migración que redefine la RPC sea
    // ésta. En cuanto alguien añada otra, este caso se pone rojo y avisa de que hay que
    // prolongar la cadena en vez de dejar que las dos suites midan versiones históricas.
    const dir = path.join(root, "supabase/migrations");
    const queRedefinen = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        /create or replace function public\.update_budget_with_items/.test(
          fs.readFileSync(path.join(dir, f), "utf8"),
        ),
      );

    assert.equal(
      queRedefinen[queRedefinen.length - 1],
      path.basename(MIG_2E2),
      "hay una migración posterior que redefine update_budget_with_items: el CASO M1 " +
        "estaría comparando dos versiones históricas y nadie custodiaría la que corre",
    );
    assert.ok(
      queRedefinen.includes(path.basename(MIG_2D5)),
      "ha desaparecido la migración de 2D-5 contra la que se compara",
    );
  });

  test("CASO M5 — la ACL se declara de forma absoluta, no heredada", () => {
    // `create or replace function` CONSERVA la ACL existente. Callarse aquí haría que
    // producción y una instalación limpia divergiesen.
    for (const rol of ["public", "anon", "service_role"]) {
      assert.ok(
        statementsPlanos.includes(`revoke all on function ${FIRMA} from ${rol}`),
        `falta el REVOKE ALL ... FROM ${rol}`,
      );
    }
    assert.ok(
      statementsPlanos.includes(`grant execute on function ${FIRMA} to authenticated`),
      "falta el GRANT EXECUTE ... TO authenticated: el único llamador real se quedaría sin permiso",
    );
    assert.ok(
      !statementsPlanos.some((s) => /^grant\b/.test(s) && / to (anon|service_role|public)$/.test(s)),
      "no debe concederse EXECUTE a anon, service_role ni PUBLIC",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE B · El fichero como migración
// ══════════════════════════════════════════════════════════════════════════════

describe("2E-2 · el fichero entra como un solo cambio o no entra", () => {
  test("CASO M6 — no hay control de transacción de nivel superior", () => {
    // El runner del CLI agrupa todos los statements en un único lote junto con el
    // INSERT en `schema_migrations`. Un `begin;`/`commit;` explícito degrada esa ruta a
    // la serie y separa el cambio de su registro histórico: no añade atomicidad, la
    // quita. Los `begin`/`end` de los cuerpos plpgsql no son control de transacción, y
    // por eso esto se tokeniza en vez de grepearse.
    assert.deepEqual(
      detectarControlTransaccion(sql2e2),
      [],
      "control de transacción prohibido en esta migración: rompería la atomicidad entre " +
        "la RPC, el backfill y las constraints, que NO son separables",
    );
  });

  test("CASO M7 — no lleva la directiva que desactiva el modo transaccional", () => {
    assert.notEqual(
      sql2e2.split("\n")[0].trim(),
      DIRECTIVA_SIN_TRANSACCION,
      "la primera línea no puede ser la directiva pg-delta transaction=false",
    );
    assert.deepEqual(
      sql2e2.split("\n").map((l) => l.trim()).filter((l) => l === DIRECTIVA_SIN_TRANSACCION),
      [],
      "la directiva aparece como línea suelta: alguien podría moverla arriba sin saber qué hace",
    );
  });

  test("CASO M8 — el orden de los statements es el que la migración necesita", () => {
    // No es cosmético. Si la UNIQUE entrase antes de arreglar la RPC, la primera edición
    // de cualquier presupuesto con más de una partida reinsertaría todas sus filas al
    // default 0 y violaría la constraint: la edición clásica quedaría rota en producción.
    const iFuncion = statementsPlanos.findIndex((s) => s.startsWith("create or replace function"));
    const iBackfill = statementsPlanos.findIndex((s) => s.includes("update public.budget_items bi"));
    const iVerificacion = statementsPlanos.findIndex((s) => s.includes("la unique fallaria"));
    const iNotNull = statementsPlanos.findIndex((s) => s.includes("set not null"));
    const iUnique = statementsPlanos.findIndex((s) => s.includes("uq_budget_items_budget_id_sort_order"));
    const iRevoke = statementsPlanos.findIndex((s) => s.startsWith("revoke all on function"));
    const iGrant = statementsPlanos.findIndex((s) => s.startsWith("grant execute on function"));

    for (const [nombre, i] of Object.entries({
      iFuncion, iBackfill, iVerificacion, iNotNull, iUnique, iRevoke, iGrant,
    })) {
      assert.ok(i >= 0, `no se encuentra el statement ${nombre}`);
    }

    assert.ok(iFuncion < iBackfill, "el backfill va antes de arreglar la RPC");
    assert.ok(iBackfill < iVerificacion, "se verifica la tabla antes de haberla arreglado");
    assert.ok(iVerificacion < iNotNull, "el NOT NULL entra sin haber verificado que no hay nulos");
    assert.ok(iNotNull < iUnique, "la UNIQUE entra antes que el NOT NULL");
    assert.ok(iUnique < iRevoke, "la ACL se aplica antes de terminar el DDL");
    assert.ok(iRevoke < iGrant, "el grant va antes de los revoke: se anularía");
    assert.equal(
      statementsPlanos[statementsPlanos.length - 1],
      "notify pgrst, 'reload schema'",
      "el último statement tiene que ser el NOTIFY a PostgREST",
    );
  });

  test("CASO M9 — nada después del NOTIFY", () => {
    const iNotify = sql2e2.search(/^notify pgrst, 'reload schema';/m);
    assert.ok(iNotify > 0, "no se encuentra el notify");
    assert.equal(
      sql2e2.slice(iNotify).replace(/^notify pgrst, 'reload schema';/, "").trim(),
      "",
      "hay statements después del recargado del esquema",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE C · El backfill sólo puede tocar `sort_order`
// ══════════════════════════════════════════════════════════════════════════════

describe("2E-2 · la invariante absoluta está escrita en el SQL, no prometida", () => {
  test("CASO M10 — hay UNA sola escritura de datos, y es un UPDATE de una sola columna", () => {
    const escrituras = fueraDeLaFuncion.filter((s) =>
      /\b(update|insert into|delete from|truncate)\b/.test(s),
    );
    assert.equal(
      escrituras.length,
      1,
      `la migración escribe datos en ${escrituras.length} statements de nivel superior; ` +
        "sólo puede hacerlo en el UPDATE del backfill",
    );

    const [backfill] = escrituras;

    // La tabla escrita es `budget_items` y ninguna otra.
    const tablasEscritas = [...backfill.matchAll(/\b(?:update|insert into|delete from|truncate)\s+([a-z_.]+)/g)]
      .map((m) => m[1]);
    assert.deepEqual(
      [...new Set(tablasEscritas)],
      ["public.budget_items"],
      "el backfill escribe en una tabla que no es budget_items",
    );

    // Y el SET asigna exactamente una columna: `sort_order`. Se localiza a partir del
    // UPDATE, no del primer ` set ` del bloque: antes del UPDATE hay consultas de
    // auditoría que también leen de la tabla temporal.
    const iUpdate = backfill.indexOf("update public.budget_items");
    assert.ok(iUpdate >= 0, "no se encuentra el UPDATE del backfill");
    const set = backfill.slice(iUpdate).replace(/^update public\.budget_items bi /, "");
    assert.match(
      set,
      /^set sort_order = a\.nuevo_sort_order from tmp_2e_asignacion a where /,
      `el UPDATE del backfill asigna algo más que la posición: "${set.slice(0, 160)}"`,
    );
    assert.equal(
      (set.slice(0, set.indexOf(" from ")).match(/=/g) ?? []).length,
      1,
      "el SET del backfill asigna más de una columna",
    );
  });

  test("CASO M11 — la huella cubre la fila entera, sin enumerar columnas", () => {
    // Una lista escrita a mano cubría 17 de las 22 columnas reales de `budget_items` y
    // dejaba fuera `name`, `created_at`, `unit_price_cost` y `subtotal_cost`. Además
    // envejece: la columna que alguien añada mañana no estaría vigilada. `to_jsonb(bi)`
    // menos la clave `sort_order` no puede quedarse corta.
    const huellas = [...sql2e2.matchAll(/md5\(\(to_jsonb\(bi\) - 'sort_order'\)::text\)/g)];
    assert.equal(
      huellas.length,
      2,
      "se esperaban dos huellas completas —una antes de escribir y otra después—, hay " + huellas.length,
    );

    const doBackfill = statements.find((s) => s.includes("tmp_2e_asignacion"));
    assert.ok(
      !/concat_ws\('~'/.test(doBackfill),
      "la huella vuelve a enumerar columnas a mano: dejaría agujeros y envejecería",
    );
  });

  test("CASO M12 — las cuatro guardas de aborto están, y abortan", () => {
    const doBackfill = statements.find((s) => s.includes("tmp_2e_asignacion"));
    assert.ok(doBackfill, "no se encuentra el bloque del backfill");

    const GUARDAS = [
      ["la asignación no es 0..N-1 completa y única", /if v_anomalias > 0 then\s+raise exception/],
      ["ha cambiado el número de filas", /if v_filas_despues <> v_filas_antes then\s+raise exception/],
      ["ha cambiado el conjunto de ids", /if v_ids_despues <> v_ids_antes then\s+raise exception/],
      ["ha cambiado alguna columna que no era sort_order", /if v_huella_despues <> v_huella_antes then\s+raise exception/],
    ];

    for (const [nombre, patron] of GUARDAS) {
      assert.match(doBackfill, patron, `falta la guarda que aborta cuando ${nombre}`);
    }

    // La primera guarda tiene que estar ANTES del UPDATE: si no, la migración escribiría
    // y sólo después descubriría que la asignación era inválida.
    assert.ok(
      doBackfill.indexOf("v_anomalias > 0") < doBackfill.indexOf("update public.budget_items"),
      "la guarda de la asignación se evalúa después de haber escrito",
    );
  });

  test("CASO M13 — CONTROL NEGATIVO: quitar cualquier guarda se detecta", () => {
    const MUTACIONES = [
      "if v_anomalias > 0 then",
      "if v_filas_despues <> v_filas_antes then",
      "if v_ids_despues <> v_ids_antes then",
      "if v_huella_despues <> v_huella_antes then",
      "md5((to_jsonb(bi) - 'sort_order')::text)",
    ];

    for (const marca of MUTACIONES) {
      assert.ok(
        sql2e2.includes(marca),
        `el CASO M12 no está midiendo: la migración no contiene "${marca}"`,
      );
      const mutilada = sql2e2.split(marca).join("");
      assert.notEqual(mutilada, sql2e2, `la mutación de "${marca}" no cambió nada`);
    }
  });

  test("CASO M14 — el orden histórico no se deriva del reloj ni del orden físico", () => {
    // `created_at` es constante dentro del presupuesto: no contiene información de orden.
    // `ctid` coincidía con el asistente en 8 de 9 presupuestos y en el noveno no acertaba
    // NI UNA de sus 58 posiciones. Una fuente que falla en silencio no es una fuente.
    const doBackfill = statements.find((s) => s.includes("tmp_2e_asignacion"));

    assert.ok(!/\bctid\b/.test(doBackfill), "el backfill usa ctid como fuente de orden");
    assert.ok(
      !/order by[^;]*created_at/.test(doBackfill),
      "el backfill ordena por created_at, que está demostrado constante dentro del presupuesto",
    );
    assert.match(
      doBackfill,
      /order by pos\.posicion nulls last, bi\.id/,
      "la asignación ya no ordena por la posición del wizard con desempate por id",
    );
  });

  test("CASO M15 — el backfill es idempotente por construcción", () => {
    const doBackfill = statements.find((s) => s.includes("tmp_2e_asignacion"));

    // Sólo son elegibles los presupuestos que NO están ya 0..N-1. Es lo que impide
    // pisar lo que los writers de la 2E-1 ya estén escribiendo desde la aplicación.
    assert.match(doBackfill, /having not \(/, "el CTE de elegibles ya no filtra por 'no ordenado'");
    for (const trozo of [
      "count(*) filter (where bi.sort_order is null) = 0",
      "min(coalesce(bi.sort_order, -1)) = 0",
      "max(coalesce(bi.sort_order, -1)) = count(*) - 1",
      "count(distinct coalesce(bi.sort_order, -1)) = count(*)",
    ]) {
      assert.ok(
        doBackfill.replace(/\s+/g, " ").includes(trozo),
        `el predicado de "ya ordenado" ha perdido la condición: ${trozo}`,
      );
    }

    // Y el UPDATE sólo alcanza a las filas de la asignación, no a la tabla entera.
    assert.match(
      doBackfill.replace(/\s+/g, " "),
      /update public\.budget_items bi set sort_order = a\.nuevo_sort_order from tmp_2e_asignacion a where a\.id = bi\.id/,
      "el UPDATE del backfill no está restringido a la asignación materializada",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE D · Las constraints que impiden que el orden se vuelva a perder
// ══════════════════════════════════════════════════════════════════════════════

describe("2E-2 · el contrato queda escrito en el esquema", () => {
  test("CASO M16 — NOT NULL, CHECK >= 0, UNIQUE (budget_id, sort_order) y el DEFAULT 0", () => {
    assert.ok(
      statementsPlanos.includes("alter table public.budget_items alter column sort_order set not null"),
      "falta el NOT NULL",
    );
    assert.ok(
      statementsPlanos.includes("alter table public.budget_items alter column sort_order set default 0"),
      "falta la reafirmación del DEFAULT 0: una base creada desde cero divergiría de producción",
    );

    const ck = statementsPlanos.find((s) => s.includes("ck_budget_items_sort_order_non_negative"));
    assert.ok(ck, "falta el CHECK de no negatividad");
    assert.match(ck, /check \(sort_order >= 0\)/, "el CHECK no es `sort_order >= 0`");

    const uq = statementsPlanos.find((s) => s.includes("uq_budget_items_budget_id_sort_order"));
    assert.ok(uq, "falta la UNIQUE");
    assert.match(
      uq,
      /unique \(budget_id, sort_order\)/,
      "la UNIQUE no es sobre (budget_id, sort_order): una UNIQUE sobre sort_order solo " +
        "impediría que dos presupuestos distintos tuviesen una primera partida",
    );

    assert.ok(
      statementsPlanos.some((s) => s.startsWith("comment on column public.budget_items.sort_order is")),
      "la columna se queda sin comentario: el contrato no estaría escrito donde se lee el esquema",
    );
  });

  test("CASO M17 — las dos constraints se añaden bajo guarda: reintentar es un no-op", () => {
    // `add constraint` no admite `if not exists` en línea. Sin la guarda, un reintento
    // de la migración fallaría con `duplicate_object` en vez de no hacer nada.
    for (const nombre of [
      "ck_budget_items_sort_order_non_negative",
      "uq_budget_items_budget_id_sort_order",
    ]) {
      const st = statementsPlanos.find((s) => s.includes(nombre));
      assert.match(
        st,
        new RegExp(`if not exists \\([^)]*pg_constraint[\\s\\S]*conname = '${nombre}'`),
        `la constraint ${nombre} se añade sin guarda: un reintento fallaría`,
      );
    }
  });

  test("CASO M18 — no se crea un índice redundante", () => {
    // La UNIQUE ya crea por debajo el btree sobre (budget_id, sort_order), que es
    // exactamente el que necesita el `order by sort_order` de los lectores. Un segundo
    // índice sería el mismo índice dos veces, con el coste de escritura duplicado.
    assert.ok(
      !fueraDeLaFuncion.some((s) => /create (unique )?index/.test(s)),
      "la migración crea un índice: la UNIQUE ya lo crea",
    );
  });

  test("CASO M19 — la migración no toca ninguna otra tabla ni ningún otro objeto", () => {
    const alteradas = fueraDeLaFuncion
      .filter((s) => s.startsWith("alter table"))
      .map((s) => s.split(/\s+/)[2]);
    assert.deepEqual(
      [...new Set(alteradas)],
      ["public.budget_items"],
      "la migración altera una tabla que no es budget_items",
    );
    assert.ok(
      !fueraDeLaFuncion.some((s) => /\b(drop table|drop column|truncate)\b/.test(s)),
      "la migración destruye estructura o datos",
    );
    assert.ok(
      !/canonical_aliases|canonical_concepts|canonical_normalize/.test(normalizar(sql2e2)),
      "la migración consulta el vocabulario canónico: eso sería un segundo clasificador",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE E · La asignación del backfill, ejecutada
// ══════════════════════════════════════════════════════════════════════════════
//
// Todo lo anterior mide el texto del SQL. Esto mide su LÓGICA: la misma semántica,
// replicada en JavaScript, corriendo sobre fixtures con la forma real del histórico.
// Una migración cuyo texto es impecable pero cuya asignación deja huecos rompería la
// UNIQUE en producción, y ninguna comprobación textual lo vería venir.

/** `min(posicion)` por clave, con las partidas primero y los materiales después: es la
 *  descomposición verificada en los 11 presupuestos con `wizard_state`, donde el número
 *  de filas es exactamente `partidas + materials`. */
function posicionesDelWizard(wizardState) {
  const partidas = Array.isArray(wizardState?.partidas) ? wizardState.partidas : [];
  const materials = Array.isArray(wizardState?.materials) ? wizardState.materials : [];

  const pares = [
    ...partidas.map((e, i) => [e?.concept == null ? null : String(e.concept).trim(), i]),
    ...materials.map((e, i) => [e?.name == null ? null : String(e.name).trim(), partidas.length + i]),
  ].filter(([clave]) => clave !== null);

  const minimos = new Map();
  for (const [clave, posicion] of pares) {
    if (!minimos.has(clave) || posicion < minimos.get(clave)) minimos.set(clave, posicion);
  }
  return minimos;
}

/** El predicado `elegibles` del SQL: un presupuesto está YA ORDENADO si sus filas forman
 *  exactamente 0..N-1 sin nulos ni repetidos. Sólo se toca lo que no lo cumple. */
function estaOrdenado(filas) {
  const valores = filas.map((f) => f.sort_order);
  if (valores.some((v) => v === null || v === undefined)) return false;
  return (
    Math.min(...valores) === 0 &&
    Math.max(...valores) === filas.length - 1 &&
    new Set(valores).size === filas.length
  );
}

/** La asignación completa, con la semántica del `row_number() over (partition by
 *  budget_id order by pos.posicion nulls last, bi.id)`. */
function asignacion(filas, wizardState) {
  if (estaOrdenado(filas)) return filas.map((f) => ({ ...f }));

  const posiciones = posicionesDelWizard(wizardState);
  const conClave = filas.map((f) => ({
    fila: f,
    posicion: posiciones.has(String(f.concept).trim())
      ? posiciones.get(String(f.concept).trim())
      : null,
  }));

  conClave.sort((a, b) => {
    if (a.posicion === null && b.posicion === null) return String(a.fila.id).localeCompare(String(b.fila.id));
    if (a.posicion === null) return 1; // nulls last
    if (b.posicion === null) return -1;
    return a.posicion - b.posicion || String(a.fila.id).localeCompare(String(b.fila.id));
  });

  return conClave.map(({ fila }, i) => ({ ...fila, sort_order: i }));
}

const MISMO_INSTANTE = "2026-03-14T09:12:44.510Z";

/** Un presupuesto histórico: todo a 0, todo con el mismo `created_at` e ids que no
 *  siguen el orden de inserción. Es el estado real de las 807 filas. */
function historico(conceptos) {
  const ids = conceptos.map((_, i) => `${String(9 - (i % 10))}f${i}0000-0000-4000-8000-00000000000${i % 10}`);
  return conceptos.map((concept, i) => ({
    id: ids[i],
    budget_id: "b0000000-0000-4000-8000-000000000001",
    concept,
    created_at: MISMO_INSTANTE,
    sort_order: 0,
    quantity: 1 + i,
    unit_price: 10 + i,
  }));
}

const PARTIDAS = ["Demolición de tabique", "Pintura plástica", "Alicatado de baño"];
const MATERIALES = ["Saco de cemento", "Pintura blanca 15L"];

function wizardCompleto() {
  return {
    partidas: PARTIDAS.map((concept) => ({ concept })),
    materials: MATERIALES.map((name) => ({ name })),
  };
}

describe("2E-2 · la asignación produce 0..N-1 y no inventa nada", () => {
  test("CASO M20 — partidas primero y materiales después, con la forma real del histórico", () => {
    // Se barajan las filas a propósito: el orden en que Postgres las devuelva no puede
    // influir en el resultado.
    const filas = historico([...MATERIALES, ...PARTIDAS].reverse());
    const resultado = asignacion(filas, wizardCompleto());

    assert.deepEqual(
      resultado.slice().sort((a, b) => a.sort_order - b.sort_order).map((f) => f.concept),
      [...PARTIDAS, ...MATERIALES],
      "la asignación no reconstruye el orden que el usuario vio en el asistente",
    );

    const posiciones = resultado.map((f) => f.sort_order).sort((a, b) => a - b);
    assert.deepEqual(posiciones, [0, 1, 2, 3, 4], "la asignación no es 0..N-1 completa");
    assert.equal(new Set(posiciones).size, posiciones.length, "hay posiciones repetidas");
  });

  test("CASO M21 — lo que no aparece en wizard_state va detrás, por id, y es estable", () => {
    const huerfana = "Partida añadida a mano después";
    const filas = historico([...PARTIDAS, huerfana, ...MATERIALES]);
    const resultado = asignacion(filas, wizardCompleto());

    const porPosicion = resultado.slice().sort((a, b) => a.sort_order - b.sort_order);
    assert.equal(
      porPosicion[porPosicion.length - 1].concept,
      huerfana,
      "la fila sin correspondencia en el wizard no quedó detrás",
    );

    // Estable quiere decir repetible: da igual en qué orden lleguen las filas.
    const alReves = asignacion([...filas].reverse(), wizardCompleto());
    assert.deepEqual(
      alReves.slice().sort((a, b) => a.sort_order - b.sort_order).map((f) => f.id),
      porPosicion.map((f) => f.id),
      "el orden depende de cómo lleguen las filas: no es estable",
    );
  });

  test("CASO M22 — sin wizard_state no se inventa un orden: se hace estable", () => {
    const filas = historico(PARTIDAS);
    const resultado = asignacion(filas, null);

    assert.deepEqual(
      resultado.map((f) => f.sort_order).sort((a, b) => a - b),
      [0, 1, 2],
      "el resultado tiene que ser válido aunque el orden sea arbitrario",
    );
    assert.deepEqual(
      asignacion([...filas].reverse(), null).map((f) => f.id).sort(),
      resultado.map((f) => f.id).sort(),
      "no se conserva el mismo conjunto de filas",
    );
  });

  test("CASO M23 — idempotente: correrlo dos veces no mueve nada", () => {
    const filas = historico([...PARTIDAS, ...MATERIALES]);
    const unaVez = asignacion(filas, wizardCompleto());
    const dosVeces = asignacion(unaVez, wizardCompleto());

    assert.deepEqual(dosVeces, unaVez, "la segunda pasada del backfill cambia el resultado");
  });

  test("CASO M24 — no pisa lo que ya escribió un writer de la 2E-1", () => {
    // Un presupuesto ya numerado, con el orden INVERTIDO respecto del wizard viejo:
    // el usuario reordenó sus partidas después. El backfill no puede deshacerlo.
    const yaNumerado = historico([...PARTIDAS, ...MATERIALES]).map((f, i, todas) => ({
      ...f,
      sort_order: todas.length - 1 - i,
    }));

    assert.deepEqual(
      asignacion(yaNumerado, wizardCompleto()),
      yaNumerado,
      "el backfill pisó un presupuesto que ya tenía posiciones escritas",
    );
  });

  test("CASO M25 — la asignación no toca ningún campo que no sea sort_order", () => {
    const filas = historico([...PARTIDAS, ...MATERIALES]);
    const resultado = asignacion(filas, wizardCompleto());

    const porId = new Map(filas.map((f) => [f.id, f]));
    assert.equal(resultado.length, filas.length, "cambió el número de filas");
    assert.equal(new Set(resultado.map((f) => f.id)).size, filas.length, "hay ids duplicados o perdidos");

    for (const fila of resultado) {
      const { sort_order: _s, ...resto } = fila;
      const original = porId.get(fila.id);
      assert.ok(original, `la asignación inventó una fila: ${fila.id}`);
      const { sort_order: _o, ...restoOriginal } = original;
      assert.deepEqual(resto, restoOriginal, `se modificó algo más que la posición en ${fila.id}`);
    }
  });

  test("CASO M26 — CONTROL NEGATIVO: ordenar por created_at no reconstruye nada", () => {
    // El requisito del control: todas las filas comparten instante, como en producción.
    const filas = historico([...MATERIALES, ...PARTIDAS].reverse());
    assert.equal(
      new Set(filas.map((f) => f.created_at)).size,
      1,
      "el fixture debe reproducir el created_at constante del histórico",
    );

    const porReloj = [...filas]
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((f) => f.concept);

    assert.notDeepEqual(
      porReloj,
      [...PARTIDAS, ...MATERIALES],
      "ordenar por el reloj acertó: el control negativo no está midiendo nada",
    );
    // Sort estable sobre una clave constante: devuelve las filas como llegaron.
    assert.deepEqual(porReloj, filas.map((f) => f.concept));
  });
});
