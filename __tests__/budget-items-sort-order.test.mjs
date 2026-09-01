/**
 * FASE 2E — ORDEN DETERMINISTA DE `budget_items`.
 *
 * EL DEFECTO. `budget_items.sort_order` existe desde el primer día y nadie lo ha
 * escrito nunca: las 807 filas de producción están a 0. El orden de las partidas lo
 * decidían cuatro lectores con `ORDER BY created_at ASC` y sin desempate. Pero las
 * filas de un presupuesto se escriben TODAS en el mismo INSERT, con el mismo `now()`:
 * en 12 de los 12 presupuestos con partidas, `created_at` es constante dentro del
 * presupuesto. Ordenar por una columna constante no ordena — devuelve el orden que el
 * plan de ejecución tenga a mano. En producción salía bien casi siempre por accidente,
 * y mal sin avisar cuando el montón se reorganizaba.
 *
 * EL CONTRATO QUE ESTA SUITE FIJA:
 *
 *   - `sort_order` es un entero, base 0, contiguo, único dentro de cada `budget_id`.
 *   - Lo asigna el WRITER desde el índice del array que persiste. El array ES la
 *     intención del usuario; `created_at` no lo es y nunca lo fue.
 *   - Los lectores ordenan por `sort_order ASC, id ASC`. El desempate es `id`, no
 *     `created_at`, porque `created_at` está demostrado constante y no puede desempatar
 *     nada.
 *   - Reordenar partidas cambia `sort_order` y NADA más. No es un evento económico.
 *
 * CÓMO SE PRUEBA. Los casos principales se EJECUTAN: replican cada writer paso a paso
 * contra el `enrichForPersistence` y el `syncClassifiedBudgetItems` de verdad, con un
 * cliente falso que registra las filas exactas que recibe `insert()`. La única
 * excepción es la RPC de edición, que vive en SQL: allí se replica en JavaScript la
 * proyección REAL leída del fichero de migración, de modo que el test mide el SQL que
 * hay y no el que a uno le gustaría que hubiese.
 *
 * Y dos controles negativos, porque un test de orden que sigue verde sin el orden no
 * mide nada: ordenar sólo por `created_at` tiene que caerse, y omitir `sort_order` en
 * un writer tiene que caerse.
 *
 * No se toca Supabase.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { canonicalNormalize, DEFAULT_ALIAS_SOURCES } = await import(
  path.join(root, "lib/canonical/registry.ts")
);
const { CANONICAL_COLUMN_KEYS } = await import(
  path.join(root, "lib/canonical/classify-budget-items.ts")
);
const { enrichForPersistence, resolveTenant } = await import(
  path.join(root, "lib/canonical/finalize-classification.ts")
);
const { persistenceSignature, syncClassifiedBudgetItems } = await import(
  path.join(root, "lib/canonical/persist-budget-items.ts")
);
const { computeBudgetTotals, assertBudgetTotalsConsistent } = await import(
  path.join(root, "lib/budget-totals.ts")
);
const { normalizeBudgetItemUnit } = await import(path.join(root, "lib/budget-units.ts"));
const { isResolutionOrigin } = await import(path.join(root, "lib/types/canonical.ts"));

// ─── El contrato, en constantes ───────────────────────────────────────────────

/** Base 0. Es la convención del resto del código (`order_lines`, `delivery_note_lines`,
 *  `issued_invoice_lines`, hitos y capítulos de proyecto, todos `sort_order: idx`), es
 *  el DEFAULT que ya tiene la columna —un 0 es una primera posición válida, un 1 no— y
 *  es el índice que JavaScript entrega gratis en cada `.map()`. */
const BASE = 0;

/** El desempate. `created_at` NO sirve: está demostrado constante dentro de cada
 *  presupuesto, así que no puede romper un empate. `id` es un uuid, único por
 *  construcción, y desempata siempre. */
const DESEMPATE = "id";

// ─── Tenant y vocabulario ─────────────────────────────────────────────────────

const EMPRESA = "5e0d3a1c-7b48-4f2e-9a06-1c3d5b7f9e20";
const PRESUPUESTO = "50570000-0000-4000-8000-000000000001";

const PAINT_WALL = "WORK.PAINT.EMULSION.WALL.2COATS";
const PAINT_MAT = "MAT.PAINT.EMULSION.INTERIOR_MATT";
const WASTE_HAUL = "WORK.WASTE.CONTAINER.HAUL";
const PRIMER = "WORK.PAINT.PRIMER.APPLY";

function concepto(canonical_id, kind, allowed, i) {
  return {
    id: `50c00000-${String(i).padStart(4, "0")}-4a00-9000-${String(i).padStart(12, "0")}`,
    canonical_id,
    kind,
    domain: "EDIF",
    family: "ACAB",
    concept: canonical_id,
    variant: null,
    display_name_es: canonical_id,
    definition_es: `Definición de ${canonical_id}`,
    default_unit: kind === "MAT" ? "ud" : "m2",
    default_price_type: allowed[0],
    allowed_price_types: allowed,
    status: "active",
    superseded_by: null,
    version: 1,
  };
}

const CONCEPTOS = [
  concepto(PAINT_WALL, "WORK", ["LABOR_ONLY", "LABOR_AND_MATERIAL"], 1),
  concepto(PAINT_MAT, "MAT", ["MATERIAL_ONLY"], 2),
  concepto(WASTE_HAUL, "WORK", ["SERVICE", "LABOR_AND_MATERIAL"], 3),
  concepto(PRIMER, "WORK", ["LABOR_AND_MATERIAL"], 4),
];

let aliasSeq = 0;
function alias(canonical_id, value, opts = {}) {
  aliasSeq += 1;
  return {
    id: `50a00000-0000-4000-8000-${String(aliasSeq).padStart(12, "0")}`,
    canonical_id,
    alias_kind: opts.kind ?? "exact",
    source: opts.source ?? "curated",
    source_ref: opts.source_ref ?? null,
    company_id: opts.company_id ?? null,
    alias_value: value,
    alias_norm: canonicalNormalize(value),
    confidence: opts.confidence ?? 1,
  };
}

const ALIASES = [
  alias(PAINT_WALL, "Pintura plástica en paredes"),
  alias(PAINT_MAT, "Pintura plástica blanca mate interior 15 L"),
  alias(PAINT_MAT, "Pintura blanca para interiores", { kind: "synonym", confidence: 0.7 }),
  alias(PAINT_MAT, "Trabajo con nombre ambiguo"),
  alias(WASTE_HAUL, "Trabajo con nombre ambiguo"),
  alias(PRIMER, "Imprimación de paredes y techos", { source: "import", source_ref: "cype_2026" }),
];

const DB = {
  canonical_alias_sources: DEFAULT_ALIAS_SOURCES.map((s) => ({ ...s })),
  canonical_aliases: ALIASES,
  canonical_concepts: CONCEPTOS,
};

const AUTH_OK = { data: { user: { id: EMPRESA } }, error: null };

// ─── Cliente falso: lee vocabulario, registra escrituras ──────────────────────

function splitTopLevel(expr) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of expr) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current !== "") parts.push(current);
  return parts;
}

function orPredicate(expr) {
  const predicates = splitTopLevel(expr).map((part) => {
    const match = /^([a-z_]+)\.(is|eq|in)\.(.*)$/.exec(part);
    assert.ok(match, `filtro or no reconocido: '${part}'`);
    const [, column, op, raw] = match;
    if (op === "is") return (row) => row[column] === null;
    if (op === "eq") return (row) => row[column] === raw;
    const values = new Set(raw.replace(/^\(|\)$/g, "").split(","));
    return (row) => row[column] !== null && values.has(row[column]);
  });
  return (row) => predicates.some((p) => p(row));
}

/**
 * Además de leer el vocabulario, esta versión ESCRIBE: mantiene una tabla
 * `budget_items` en memoria para poder mirar, al final, en qué orden y con qué
 * `sort_order` quedaron las filas. Sin tabla real, "el orden se conserva" sería una
 * afirmación sobre el payload y no sobre lo persistido.
 */
function fakeSupabase(tables) {
  const tabla = [];
  const stats = { inserts: [], deletes: 0, queryCount: 0 };

  function from(table) {
    const filters = [];
    const builder = {
      select: () => builder,
      eq(c, v) {
        filters.push((row) => row[c] === v);
        return builder;
      },
      is(c) {
        filters.push((row) => row[c] === null);
        return builder;
      },
      in(c, values) {
        const set = new Set(values);
        filters.push((row) => set.has(row[c]));
        return builder;
      },
      or(expr) {
        filters.push(orPredicate(expr));
        return builder;
      },
      limit: () => builder,
      delete: () => ({
        eq(column, value) {
          stats.deletes += 1;
          if (table === "budget_items") {
            for (let i = tabla.length - 1; i >= 0; i -= 1) {
              if (tabla[i][column] === value) tabla.splice(i, 1);
            }
          }
          return Promise.resolve({ error: null });
        },
      }),
      insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        stats.inserts.push({ table, rows: rows.map((r) => ({ ...r })) });
        if (table === "budget_items") {
          // Postgres asigna el `id` y el `created_at`. El `created_at` es el MISMO para
          // todas las filas del INSERT: eso no es una simplificación del doble, es el
          // hecho que provocó esta fase entera. Y el `id` es un uuid que NO sigue el
          // orden de inserción, por eso se genera desordenado a propósito.
          const instante = "2026-09-01T10:00:00.000Z";
          rows.forEach((r, i) => {
            tabla.push({
              id: uuidDesordenado(tabla.length + i),
              created_at: instante,
              sort_order: r.sort_order ?? 0,
              ...r,
            });
          });
        }
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: PRESUPUESTO, ...rows[0] }, error: null }),
          }),
          then: (onfulfilled) => Promise.resolve(onfulfilled({ data: null, error: null })),
        };
      },
      then(onfulfilled) {
        stats.queryCount += 1;
        const found = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
        return Promise.resolve(onfulfilled({ data: found.map((r) => ({ ...r })), error: null }));
      },
    };
    return builder;
  }

  return { client: { from }, stats, tabla };
}

/**
 * Un uuid cuyo orden alfabético NO coincide con el de inserción. Es deliberado: si los
 * ids saliesen crecientes, `ORDER BY id` reproduciría el orden de inserción por
 * casualidad y los controles negativos no podrían distinguir un lector correcto de uno
 * que simplemente tuvo suerte.
 */
function uuidDesordenado(i) {
  const mezcla = [7, 3, 9, 1, 5, 0, 8, 2, 6, 4];
  const n = mezcla[i % mezcla.length] * 100 + i;
  return `5011${String(n).padStart(4, "0")}-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

// ─── Las partidas ─────────────────────────────────────────────────────────────

/**
 * Cinco partidas en el orden en que el usuario las tiene delante. Los conceptos son
 * distintos entre sí a propósito: la posición tiene que poder seguirse por el nombre.
 */
function partidasDelUsuario() {
  return [
    linea("Pintura plástica en paredes", 58, "m2", 15.64, "mano_obra", "ai"),
    linea("Imprimación de paredes y techos", 58, "m2", 4.2, "mano_obra", "free_text"),
    linea("Pintura plástica blanca mate interior 15 L", 3, "unidades", 52.8, "material", "free_text"),
    linea("Trabajo con nombre ambiguo", 1, "ud", 133.07, "mano_obra", "free_text"),
    linea("Un concepto que no está en el vocabulario", 12, "ml", 9.31, "otros", "free_text"),
  ];
}

function linea(concept, quantity, unit, unit_price, category, origin) {
  const subtotal = Math.round(quantity * unit_price * 100) / 100;
  return {
    concept,
    description: `${concept} — ejecución completa`,
    quantity,
    unit,
    category,
    chapter: category,
    unit_price,
    unit_price_client: unit_price,
    subtotal,
    subtotal_client: subtotal,
    status: "incluida",
    canonical_origin: origin,
    canonical_source_ref: null,
  };
}

const ORDEN_ESPERADO = partidasDelUsuario().map((p) => p.concept);

// ─── Los cinco writers, replicados ────────────────────────────────────────────
//
// `opciones.omitirSortOrder` es el CONTROL NEGATIVO 14: reproduce exactamente el código
// anterior a esta fase, el que no escribía la columna. Todo writer tiene el interruptor
// para que el caso 14 pueda demostrar que la suite lo detecta en los cinco.

/** La proyección de `saveDraft` y de `finalizeBudget`. Son la MISMA, campo por campo:
 *  de eso depende que las dos firmas de persistencia sean intercambiables (2D-9). */
function proyectarDelAsistente(partidas, budgetId, opciones = {}) {
  return partidas
    .filter((p) => p.status !== "opcional")
    .map((p, idx) => ({
      budget_id: budgetId,
      ...(opciones.omitirSortOrder ? {} : { sort_order: idx + BASE }),
      concept: p.concept,
      description: p.description,
      quantity: p.quantity,
      unit: normalizeBudgetItemUnit(p.unit),
      category: p.category,
      chapter: p.chapter || p.category || "otros",
      unit_price: p.unit_price_client,
      subtotal: p.subtotal_client,
      canonical_origin: p.canonical_origin ?? null,
      canonical_source_ref: p.canonical_source_ref ?? null,
    }));
}

/** WRITER 1 — autoguardado. Corre el sincronizador REAL, no una imitación: la salida
 *  temprana por firma es parte del contrato que aquí se mide. */
async function autoguardar(partidas, opciones = {}) {
  const { client, stats, tabla } = fakeSupabase(DB);
  const filas = proyectarDelAsistente(partidas, PRESUPUESTO, opciones);
  const economia = computeBudgetTotals({ lines: filas });

  const resultado = await syncClassifiedBudgetItems({
    budgetId: PRESUPUESTO,
    items: filas,
    tenant: resolveTenant(AUTH_OK),
    supabase: client,
    context: "saveDraft",
    previousSignature: opciones.previousSignature ?? null,
    verifyTotals: (clasificadas) =>
      assertBudgetTotalsConsistent(
        economia.subtotal,
        computeBudgetTotals({ lines: clasificadas }),
        "saveDraft",
      ),
  });

  return { filas, tabla, stats, resultado, economia };
}

/** WRITER 2 — finalización. Misma proyección, y por eso mismo se comprueba aparte que
 *  las dos producen filas idénticas: si una llevase `sort_order` y la otra no, las
 *  firmas dejarían de ser intercambiables. */
async function finalizar(partidas, opciones = {}) {
  const { client, stats, tabla } = fakeSupabase(DB);
  const filas = proyectarDelAsistente(partidas, PRESUPUESTO, opciones);
  const economia = computeBudgetTotals({ lines: filas });

  const { items: clasificadas } = await enrichForPersistence({
    items: filas,
    tenant: resolveTenant(AUTH_OK),
    context: "finalizeBudget",
    supabase: client,
  });

  assertBudgetTotalsConsistent(
    economia.subtotal,
    computeBudgetTotals({ lines: clasificadas }),
    "finalizeBudget",
  );

  await client.from("budget_items").delete().eq("budget_id", PRESUPUESTO);
  await client.from("budget_items").insert(clasificadas);

  const firma = persistenceSignature(PRESUPUESTO, clasificadas);
  return { filas, clasificadas, tabla, stats, firma, economia };
}

/** WRITER 3 — alta manual (`budget-form.tsx`, camino de creación). */
async function altaManual(partidas, opciones = {}) {
  const { client, stats, tabla } = fakeSupabase(DB);

  const nuevasPartidas = partidas.map((p, idx) => ({
    ...(opciones.omitirSortOrder ? {} : { sort_order: idx + BASE }),
    concept: p.concept,
    description: p.description,
    quantity: p.quantity,
    unit: normalizeBudgetItemUnit(p.unit),
    category: p.category,
    unit_price: p.unit_price,
    subtotal: p.subtotal,
    canonical_origin: p.canonical_origin ?? null,
    canonical_source_ref: p.canonical_source_ref ?? null,
  }));

  const { items: clasificadas } = await enrichForPersistence({
    items: nuevasPartidas,
    tenant: resolveTenant(AUTH_OK),
    context: "createBudget",
    supabase: client,
  });

  await client
    .from("budget_items")
    .insert(clasificadas.map((row) => ({ ...row, budget_id: PRESUPUESTO })));

  return { nuevasPartidas, clasificadas, tabla, stats };
}

/** WRITER 4 — duplicación (`[id]/page.tsx`). Renumera 0..N-1 en el orden en que las
 *  partidas llegaron a la pantalla; no copia el `sort_order` del original. */
async function duplicar(items, opciones = {}) {
  const { client, stats, tabla } = fakeSupabase(DB);

  const partidasCopiadas = items.map((item, idx) => ({
    ...(opciones.omitirSortOrder ? {} : { sort_order: idx + BASE }),
    concept: item.concept,
    description: item.description,
    quantity: item.quantity,
    unit: normalizeBudgetItemUnit(item.unit),
    category: item.category,
    unit_price: item.unit_price,
    subtotal: item.subtotal,
    canonical_origin: isResolutionOrigin(item.canonical_origin) ? item.canonical_origin : null,
    canonical_source_ref: item.canonical_source_ref ?? null,
  }));

  const economiaOriginal = computeBudgetTotals({ lines: partidasCopiadas });

  const { items: clasificadas } = await enrichForPersistence({
    items: partidasCopiadas,
    tenant: resolveTenant(AUTH_OK),
    context: "duplicateBudget",
    supabase: client,
  });

  assertBudgetTotalsConsistent(
    economiaOriginal.subtotal,
    computeBudgetTotals({ lines: clasificadas }),
    "duplicateBudget",
  );

  await client
    .from("budget_items")
    .insert(clasificadas.map((row) => ({ ...row, budget_id: PRESUPUESTO })));

  return { partidasCopiadas, clasificadas, tabla, stats, economiaOriginal };
}

// ─── WRITER 5 — la RPC de edición, leída del SQL de verdad ────────────────────

/**
 * La RPC no se lee de un fichero fijo, sino de la ÚLTIMA migración que la redefine.
 *
 * Fijar el nombre a mano funcionó mientras hubo una sola: en cuanto la FASE 2E-2 añadió
 * `20260901120000_budget_items_sort_order.sql`, el fichero fijo pasó a ser una versión
 * histórica de la función, y esta suite habría seguido midiendo una RPC que ya no es la
 * que corre en producción. Las migraciones se aplican por orden de nombre, así que la
 * última que contiene el `create or replace` es la que está en vigor.
 */
function migracionDeLaRpcVigente() {
  const dir = path.join(root, "supabase/migrations");
  const candidatas = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      /create or replace function public\.update_budget_with_items/.test(
        fs.readFileSync(path.join(dir, f), "utf8"),
      ),
    );

  assert.ok(
    candidatas.length > 0,
    "ninguna migración define public.update_budget_with_items",
  );
  return path.join("supabase/migrations", candidatas[candidatas.length - 1]);
}

const RPC_SQL_PATH = migracionDeLaRpcVigente();
const rpcSql = fs.readFileSync(path.join(root, RPC_SQL_PATH), "utf8");

/**
 * Las columnas que la RPC inserta de verdad, extraídas del fichero de migración.
 *
 * Leerlas en vez de escribirlas a mano es lo que impide que este test mida una RPC
 * imaginaria. La proyección de la edición clásica se replica abajo usando ESTA lista:
 * si la migración no nombra `sort_order`, la réplica lo pierde, exactamente como lo
 * pierde producción.
 */
function columnasQueInsertaLaRpc(sql) {
  const i = sql.indexOf("insert into public.budget_items");
  assert.ok(i > 0, "no se encuentra el INSERT de budget_items en la RPC");
  const abre = sql.indexOf("(", i);
  const cierra = sql.indexOf(")", abre);
  assert.ok(abre > 0 && cierra > abre, "no se encuentra la lista de columnas del INSERT");
  return sql
    .slice(abre + 1, cierra)
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** `true` si el INSERT recorre el array con `with ordinality`, que es la única forma de
 *  que la RPC conozca la posición de cada elemento de `p_items`. */
function laRpcConoceLaPosicion(sql) {
  const i = sql.indexOf("insert into public.budget_items");
  return /with\s+ordinality/i.test(sql.slice(i, i + 2000));
}

/**
 * RÉPLICA en JavaScript de `update_budget_with_items`: `jsonb_array_elements(p_items)`
 * proyectado sobre la lista de columnas REAL. Lo que no esté en esa lista se pierde,
 * que es justo lo que hace Postgres.
 */
function rpcEdicion(pItems, columnas, conOrdinalidad) {
  return pItems.map((item, idx) => {
    const fila = {};
    for (const col of columnas) {
      if (col === "budget_id") {
        fila.budget_id = PRESUPUESTO;
        continue;
      }
      if (col === "sort_order") {
        // `with ordinality` es base 1 en Postgres; el contrato es base 0. La resta es
        // parte de la migración, no un detalle del test.
        fila.sort_order = conOrdinalidad ? idx + 1 - 1 + BASE : (item.sort_order ?? 0);
        continue;
      }
      fila[col] = item[col] ?? null;
    }
    return fila;
  });
}

/** El camino completo de la edición clásica: el formulario sella la posición sobre el
 *  array que persiste, y la RPC lo transporta (o no). */
async function editar(partidas, opciones = {}) {
  const { client } = fakeSupabase(DB);

  const partidasOrdenadas = partidas.map((p, idx) =>
    opciones.omitirSortOrder ? { ...p } : { ...p, sort_order: idx + BASE },
  );

  const { items: clasificadas } = await enrichForPersistence({
    items: partidasOrdenadas,
    tenant: resolveTenant(AUTH_OK),
    context: "editBudget",
    supabase: client,
  });

  const columnas = opciones.columnas ?? columnasQueInsertaLaRpc(rpcSql);
  const ordinalidad = opciones.conOrdinalidad ?? laRpcConoceLaPosicion(rpcSql);

  return {
    partidasOrdenadas,
    clasificadas,
    columnas,
    ordinalidad,
    persistidas: rpcEdicion(clasificadas, columnas, ordinalidad),
  };
}

// ─── Los lectores ─────────────────────────────────────────────────────────────

/**
 * Lo que hace `ORDER BY` sobre un conjunto de filas que Postgres devuelve en un orden
 * cualquiera. `modo: "created_at"` es el lector ANTERIOR a esta fase; `"contrato"` es
 * el propuesto.
 *
 * `filasComoLasDevuelveElPlan` no es una licencia poética: sin `ORDER BY` efectivo,
 * Postgres devuelve lo que el plan tenga a mano, y eso no es el orden de inserción.
 */
function leer(filas, modo) {
  const copia = filas.map((f) => ({ ...f }));
  if (modo === "created_at") {
    // Sort estable sobre una clave constante: no reordena nada. Ése es el defecto.
    return copia.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
  return copia.sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      String(a[DESEMPATE]).localeCompare(String(b[DESEMPATE])),
  );
}

/** Simula que el plan devuelve las filas revueltas. Es el escenario que el contrato
 *  tiene que sobrevivir; el orden de inserción no está garantizado en la lectura. */
function comoLasDevuelveElPlan(tabla) {
  return [...tabla].reverse();
}

// ─── Huellas ──────────────────────────────────────────────────────────────────

/** Todo lo que NO es la posición. Si esto cambia, el cambio no era un reordenamiento. */
function huellaEconomica(filas) {
  return filas
    .map((f) =>
      [f.concept, f.quantity, f.unit, f.category, f.unit_price, f.subtotal].join("|"),
    )
    .sort()
    .join("\n");
}

function huellaCanonica(filas) {
  return filas
    .map((f) => [f.concept, ...CANONICAL_COLUMN_KEYS.map((k) => String(f[k] ?? "∅"))].join("|"))
    .sort()
    .join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE A · El contrato y los cinco writers
// ══════════════════════════════════════════════════════════════════════════════

describe("2E · el writer asigna la posición, y la asigna contigua desde la base", () => {
  test("CASO 1 — las filas persistidas llevan 0..N-1 sin huecos y sin repetidos", async () => {
    const e = await autoguardar(partidasDelUsuario());

    const posiciones = e.tabla.map((f) => f.sort_order);
    assert.deepEqual(
      posiciones,
      [0, 1, 2, 3, 4],
      "el contrato es base 0, contiguo y en el orden del array",
    );
    assert.equal(new Set(posiciones).size, posiciones.length, "hay posiciones repetidas");
    assert.ok(
      posiciones.every((p) => Number.isInteger(p) && p >= BASE),
      "hay posiciones que no son enteros >= 0",
    );
  });

  test("CASO 1b — descartar una partida opcional NO deja un hueco en la numeración", async () => {
    // El índice se toma DESPUÉS del filtro. Si se tomase antes, quitar la opcional
    // dejaría un salto, y un salto rompería la contigüidad que el contrato promete.
    const partidas = partidasDelUsuario();
    partidas[2].status = "opcional";

    const e = await autoguardar(partidas);

    assert.deepEqual(e.tabla.map((f) => f.sort_order), [0, 1, 2, 3]);
    assert.deepEqual(e.tabla.map((f) => f.concept), [
      ORDEN_ESPERADO[0],
      ORDEN_ESPERADO[1],
      ORDEN_ESPERADO[3],
      ORDEN_ESPERADO[4],
    ]);
  });

  test("CASO 2 — saveDraft conserva el orden del array a través del clasificador", async () => {
    const e = await autoguardar(partidasDelUsuario());

    assert.equal(e.resultado.skipped, false, "el autoguardado no llegó a escribir");
    assert.deepEqual(
      leer(comoLasDevuelveElPlan(e.tabla), "contrato").map((f) => f.concept),
      ORDEN_ESPERADO,
      "el orden del usuario no sobrevivió al viaje de ida y vuelta",
    );
  });

  test("CASO 3 — finalizeBudget conserva el orden, y su proyección es idéntica a la del borrador", async () => {
    const partidas = partidasDelUsuario();
    const fin = await finalizar(partidas);

    assert.deepEqual(
      leer(comoLasDevuelveElPlan(fin.tabla), "contrato").map((f) => f.concept),
      ORDEN_ESPERADO,
    );

    // La invariante de 2D-9: las dos proyecciones tienen que ser intercambiables. Si
    // una llevase la posición y la otra no, finalizar dejaría una firma que el
    // autoguardado siguiente no sabe reproducir, y volvería a escribir la tabla entera.
    const borrador = await autoguardar(partidas);
    assert.deepEqual(
      Object.keys(borrador.filas[0]),
      Object.keys(fin.filas[0]),
      "las dos proyecciones ya no tienen las mismas llaves en el mismo orden",
    );
    assert.equal(
      persistenceSignature(PRESUPUESTO, borrador.filas),
      persistenceSignature(PRESUPUESTO, fin.filas),
      "las firmas de borrador y finalización han dejado de ser intercambiables",
    );
  });

  test("CASO 4 — la edición clásica sella la posición sobre el array que persiste", async () => {
    const e = await editar(partidasDelUsuario());

    assert.deepEqual(
      e.partidasOrdenadas.map((p) => p.sort_order),
      [0, 1, 2, 3, 4],
      "el formulario no numeró las partidas antes de mandarlas a la RPC",
    );
    // `enrichForPersistence` no puede perderla: devuelve `{ ...line, ...columnas }`.
    assert.deepEqual(
      e.clasificadas.map((p) => p.sort_order),
      [0, 1, 2, 3, 4],
      "el clasificador perdió la posición por el camino",
    );
  });

  test("CASO 4b — la RPC de edición transporta la posición, que es lo que la migración vino a arreglar", async () => {
    // Este caso mide el SQL que hay, no el que querríamos, y por eso tiene dos ramas:
    // la de antes de la FASE 2E-2 y la de después. Se escribió cuando la viva era la
    // primera. La edición clásica hace DELETE + INSERT de todas las partidas: mientras
    // la RPC no nombró `sort_order`, cada edición devolvía el presupuesto entero al
    // default 0 y destruía el orden que los writers acababan de escribir. Desde
    // `20260901120000_budget_items_sort_order.sql` la rama viva es la segunda.
    //
    // Las dos se conservan: la primera es la que documenta, con una aserción ejecutable
    // y no con un comentario, qué pasaba antes y por qué la migración era obligatoria.
    const e = await editar(partidasDelUsuario());

    const transporta = e.columnas.includes("sort_order");
    if (!transporta) {
      assert.ok(
        e.persistidas.every((f) => f.sort_order === undefined || f.sort_order === 0),
        "la RPC no nombra sort_order: las filas tienen que caer al default",
      );
      assert.equal(
        e.ordinalidad,
        false,
        "hay `with ordinality` sin columna `sort_order`: eso es una migración a medias",
      );
    } else {
      // Cuando la migración entre, esta rama pasa a ser la viva y exige las dos mitades
      // a la vez: la columna en la lista Y la ordinalidad que la alimenta.
      assert.equal(
        e.ordinalidad,
        true,
        "la RPC inserta `sort_order` pero no recorre `p_items` con `with ordinality`: " +
          "estaría escribiendo la posición que venga en el JSON sin garantía de orden",
      );
      assert.deepEqual(e.persistidas.map((f) => f.sort_order), [0, 1, 2, 3, 4]);
    }
  });

  test("CASO 5 — el alta manual conserva el orden del formulario", async () => {
    const e = await altaManual(partidasDelUsuario());

    assert.deepEqual(e.tabla.map((f) => f.sort_order), [0, 1, 2, 3, 4]);
    assert.deepEqual(
      leer(comoLasDevuelveElPlan(e.tabla), "contrato").map((f) => f.concept),
      ORDEN_ESPERADO,
    );
  });

  test("CASO 6 — la duplicación renumera 0..N-1 y no hereda el sort_order del original", async () => {
    // El original es una fila histórica: todas sus partidas están a 0, que es el estado
    // real de las 807 filas de producción. Copiar ese valor daría cinco ceros.
    const original = partidasDelUsuario().map((p) => ({ ...p, sort_order: 0 }));

    const e = await duplicar(original);

    assert.deepEqual(
      e.tabla.map((f) => f.sort_order),
      [0, 1, 2, 3, 4],
      "la copia heredó el sort_order del original en vez de renumerar",
    );
    assert.deepEqual(
      leer(comoLasDevuelveElPlan(e.tabla), "contrato").map((f) => f.concept),
      ORDEN_ESPERADO,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE B · Los lectores
// ══════════════════════════════════════════════════════════════════════════════

describe("2E · los lectores ordenan por la posición, no por el reloj", () => {
  test("CASO 7 — ORDER BY sort_order reconstruye el orden del usuario aunque el plan devuelva las filas revueltas", async () => {
    const e = await autoguardar(partidasDelUsuario());

    const revueltas = comoLasDevuelveElPlan(e.tabla);
    assert.notDeepEqual(
      revueltas.map((f) => f.concept),
      ORDEN_ESPERADO,
      "el fixture no está revuelto: el test no probaría nada",
    );

    assert.deepEqual(leer(revueltas, "contrato").map((f) => f.concept), ORDEN_ESPERADO);
  });

  test("CASO 8 — el empate se rompe por id, y el desempate es total", async () => {
    // Mientras el histórico no tenga garantía fuerte, dos filas pueden compartir
    // posición. El lector no puede quedarse indeciso: tiene que dar SIEMPRE el mismo
    // resultado. Se comprueba corriéndolo sobre varias permutaciones de entrada.
    const empatadas = [
      { id: "b", sort_order: 0, created_at: "T", concept: "beta" },
      { id: "a", sort_order: 0, created_at: "T", concept: "alfa" },
      { id: "c", sort_order: 1, created_at: "T", concept: "gamma" },
    ];

    const permutaciones = [
      empatadas,
      [...empatadas].reverse(),
      [empatadas[2], empatadas[0], empatadas[1]],
    ];

    for (const p of permutaciones) {
      assert.deepEqual(
        leer(p, "contrato").map((f) => f.concept),
        ["alfa", "beta", "gamma"],
        "el desempate no es determinista: la entrada cambia el resultado",
      );
    }

    // Y el desempate elegido tiene que poder desempatar de verdad. `created_at` no:
    // está demostrado constante dentro del presupuesto.
    assert.equal(
      new Set(empatadas.map((f) => f.created_at)).size,
      1,
      "el fixture debe reproducir el created_at constante del histórico",
    );
    assert.equal(
      new Set(empatadas.map((f) => f[DESEMPATE])).size,
      empatadas.length,
      `'${DESEMPATE}' no es único, no sirve como desempate`,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE C · Reordenar no es un evento económico
// ══════════════════════════════════════════════════════════════════════════════

describe("2E · mover una partida cambia la posición y nada más", () => {
  test("CASO 9 — reordenar el array cambia sort_order y deja la economía intacta", async () => {
    const antes = await autoguardar(partidasDelUsuario());

    const movidas = partidasDelUsuario();
    movidas.unshift(movidas.pop()); // la última pasa a ser la primera
    const despues = await autoguardar(movidas);

    assert.deepEqual(
      despues.tabla.map((f) => f.concept),
      [ORDEN_ESPERADO[4], ...ORDEN_ESPERADO.slice(0, 4)],
      "el reordenamiento no llegó a la tabla",
    );
    assert.equal(
      huellaEconomica(despues.tabla),
      huellaEconomica(antes.tabla),
      "reordenar alteró algún importe",
    );
    assert.equal(
      despues.economia.subtotal,
      antes.economia.subtotal,
      "reordenar movió el subtotal",
    );
  });

  test("CASO 9b — un reordenamiento SÍ tiene que guardarse: la firma lo ve", async () => {
    // Es la otra mitad de la decisión de meter `sort_order` dentro de la firma. Si
    // quedase fuera, mover una partida sin tocar un importe no cambiaría la firma, la
    // salida temprana descartaría el guardado y el orden nuevo se perdería en silencio.
    const primera = await autoguardar(partidasDelUsuario());

    const movidas = partidasDelUsuario();
    movidas.unshift(movidas.pop());
    const filasMovidas = proyectarDelAsistente(movidas, PRESUPUESTO);

    assert.notEqual(
      persistenceSignature(PRESUPUESTO, filasMovidas),
      primera.resultado.signature,
      "la firma no distingue un reordenamiento: la salida temprana lo tiraría",
    );

    const segunda = await autoguardar(movidas, { previousSignature: primera.resultado.signature });
    assert.equal(segunda.resultado.skipped, false, "el reordenamiento salió por la puerta temprana");
  });

  test("CASO 9c — guardar dos veces lo mismo sigue costando cero", async () => {
    const primera = await autoguardar(partidasDelUsuario());
    const segunda = await autoguardar(partidasDelUsuario(), {
      previousSignature: primera.resultado.signature,
    });

    assert.equal(segunda.resultado.skipped, true, "añadir la posición ha roto la salida temprana");
    assert.equal(segunda.stats.deletes, 0);
    assert.equal(segunda.stats.inserts.length, 0);
    assert.equal(segunda.stats.queryCount, 0, "se cargó vocabulario para no escribir nada");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE D · El backfill histórico
// ══════════════════════════════════════════════════════════════════════════════

/**
 * El histórico, tal y como está hoy: todas las filas a 0, todas con el mismo
 * `created_at`, e ids que no siguen el orden de inserción.
 */
function historico() {
  return partidasDelUsuario().map((p, i) => ({
    id: uuidDesordenado(i),
    budget_id: PRESUPUESTO,
    created_at: "2026-03-14T09:12:44.510Z",
    sort_order: 0,
    concept: p.concept,
    description: p.description,
    quantity: p.quantity,
    unit: p.unit,
    category: p.category,
    chapter: p.chapter,
    unit_price: p.unit_price,
    subtotal: p.subtotal,
    canonical_id: null,
    canonical_status: "unmatched",
    canonical_confidence: null,
    canonical_source: null,
    canonical_origin: null,
    canonical_source_ref: null,
    price_type: null,
  }));
}

/**
 * RÉPLICA del backfill propuesto.
 *
 * La posición histórica se toma de `wizard_state.partidas`, que es el único registro
 * que conserva el orden que el usuario vio: se emparejan por `concept`, que es único
 * dentro de cada presupuesto en los 12 presupuestos con partidas. Lo que no aparezca
 * en el wizard cae al final, ordenado por `id` — no por `created_at`, que es constante
 * y no ordena nada.
 *
 * Y el paso clave: sólo toca presupuestos cuyas filas están TODAS a 0. Así es
 * idempotente y no puede pisar lo que los writers nuevos ya hayan escrito. No inventa
 * una verdad histórica que no exista; donde no hay wizard, admite que el orden es
 * arbitrario y se limita a hacerlo estable.
 */
function backfill(filas, wizardPartidas) {
  const todasACero = filas.every((f) => (f.sort_order ?? 0) === 0);
  if (!todasACero) return filas.map((f) => ({ ...f }));

  const posicionConocida = new Map(
    (wizardPartidas ?? []).map((p, i) => [p.concept, i]),
  );

  const conocidas = filas.filter((f) => posicionConocida.has(f.concept));
  const resto = filas.filter((f) => !posicionConocida.has(f.concept));

  conocidas.sort((a, b) => posicionConocida.get(a.concept) - posicionConocida.get(b.concept));
  resto.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return [...conocidas, ...resto].map((f, i) => ({ ...f, sort_order: i + BASE }));
}

/** Todos los campos de la fila MENOS la posición. Es la prueba de que el backfill no
 *  toca nada más: se compara literalmente todo lo demás, no una selección. */
function todoMenosLaPosicion(fila) {
  const { sort_order, ...resto } = fila;
  return resto;
}

describe("2E · el backfill estabiliza el orden sin tocar el contenido", () => {
  test("CASO 10 — el backfill no cambia NINGÚN campo salvo sort_order", () => {
    const antes = historico();
    const wizard = partidasDelUsuario().map((p) => ({ concept: p.concept }));
    const despues = backfill(antes, wizard);

    assert.equal(despues.length, antes.length, "el backfill cambió el número de filas");

    const porId = new Map(antes.map((f) => [f.id, f]));
    assert.equal(new Set(despues.map((f) => f.id)).size, antes.length, "hay ids duplicados o perdidos");

    for (const fila of despues) {
      const original = porId.get(fila.id);
      assert.ok(original, `el backfill inventó una fila: ${fila.id}`);
      assert.deepEqual(
        todoMenosLaPosicion(fila),
        todoMenosLaPosicion(original),
        `el backfill modificó algo más que la posición en la fila ${fila.id}`,
      );
    }

    // Y sí cambió lo que tenía que cambiar.
    assert.deepEqual(despues.map((f) => f.sort_order).sort((a, b) => a - b), [0, 1, 2, 3, 4]);
    assert.notDeepEqual(
      despues.map((f) => f.sort_order),
      antes.map((f) => f.sort_order),
      "el backfill no hizo nada",
    );
  });

  test("CASO 10b — el backfill es idempotente y no pisa lo que ya escribió un writer", async () => {
    const wizard = partidasDelUsuario().map((p) => ({ concept: p.concept }));
    const unaVez = backfill(historico(), wizard);
    const dosVeces = backfill(unaVez, wizard);

    assert.deepEqual(dosVeces, unaVez, "correr el backfill dos veces no da lo mismo");

    // Un presupuesto ya numerado por el writer nuevo, con el orden invertido respecto
    // del wizard viejo. El backfill NO puede tocarlo.
    const yaNumerado = historico().map((f, i) => ({ ...f, sort_order: 4 - i }));
    assert.deepEqual(
      backfill(yaNumerado, wizard),
      yaNumerado,
      "el backfill pisó un presupuesto que ya tenía posiciones escritas",
    );
  });

  test("CASO 10c — sin wizard_state el backfill no inventa un orden: lo hace estable", () => {
    const antes = historico();
    const despues = backfill(antes, null);

    assert.deepEqual(
      despues.map((f) => f.sort_order),
      [0, 1, 2, 3, 4],
      "el orden resultante tiene que ser válido aunque sea arbitrario",
    );
    // Estable quiere decir: repetible. Da igual en qué orden lleguen las filas.
    assert.deepEqual(
      backfill([...antes].reverse(), null).map((f) => f.id),
      despues.map((f) => f.id),
      "el orden inferido depende de cómo lleguen las filas: no es estable",
    );
  });

  test("CASO 11 — las huellas económicas son idénticas antes y después", () => {
    const antes = historico();
    const wizard = partidasDelUsuario().map((p) => ({ concept: p.concept }));
    const despues = backfill(antes, wizard);

    assert.equal(huellaEconomica(despues), huellaEconomica(antes));
    assert.equal(
      computeBudgetTotals({ lines: despues }).subtotal,
      computeBudgetTotals({ lines: antes }).subtotal,
      "el subtotal del presupuesto se movió",
    );
  });

  test("CASO 12 — la metadata canónica es idéntica antes y después", () => {
    const antes = historico();
    const wizard = partidasDelUsuario().map((p) => ({ concept: p.concept }));
    const despues = backfill(antes, wizard);

    assert.equal(huellaCanonica(despues), huellaCanonica(antes));

    // `sort_order` no es una columna canónica y no debe colarse en ese conjunto: si lo
    // hiciera, el clasificador podría creerse con derecho a derivarla.
    assert.ok(
      !CANONICAL_COLUMN_KEYS.includes("sort_order"),
      "sort_order se ha colado entre las columnas canónicas",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE E · Controles negativos
// ══════════════════════════════════════════════════════════════════════════════
//
// Un test de orden que sigue verde sin el orden no mide nada. Estos dos casos vuelven a
// poner el código roto y exigen que la suite se caiga.

describe("2E · controles negativos", () => {
  test("CASO 13 — ordenar sólo por created_at NO reconstruye el orden, y el CASO 7 lo detecta", async () => {
    const e = await autoguardar(partidasDelUsuario());

    // Requisito del control: todas las filas comparten instante, como en producción.
    assert.equal(
      new Set(e.tabla.map((f) => f.created_at)).size,
      1,
      "el fixture debe reproducir el created_at constante que tiene el histórico",
    );

    const revueltas = comoLasDevuelveElPlan(e.tabla);
    const porReloj = leer(revueltas, "created_at").map((f) => f.concept);

    assert.notDeepEqual(
      porReloj,
      ORDEN_ESPERADO,
      "el lector viejo acertó: el control negativo no está midiendo nada",
    );
    // Y deja las filas exactamente como llegaron: no ordena, sólo las devuelve.
    assert.deepEqual(porReloj, revueltas.map((f) => f.concept));

    // El lector del contrato, sobre las mismas filas, sí acierta.
    assert.deepEqual(leer(revueltas, "contrato").map((f) => f.concept), ORDEN_ESPERADO);
  });

  test("CASO 14 — omitir sort_order en cualquiera de los writers rompe la suite", async () => {
    const partidas = partidasDelUsuario();

    const escenarios = [
      ["saveDraft", (await autoguardar(partidas, { omitirSortOrder: true })).tabla],
      ["finalizeBudget", (await finalizar(partidas, { omitirSortOrder: true })).tabla],
      ["createBudget", (await altaManual(partidas, { omitirSortOrder: true })).tabla],
      ["duplicateBudget", (await duplicar(partidas, { omitirSortOrder: true })).tabla],
    ];

    for (const [nombre, tabla] of escenarios) {
      const posiciones = tabla.map((f) => f.sort_order);
      assert.deepEqual(
        posiciones,
        [0, 0, 0, 0, 0],
        `${nombre}: sin la columna explícita las filas tienen que caer al default 0`,
      );

      // Y eso es exactamente lo que hace fallar al CASO 1 y al CASO 7.
      assert.throws(
        () => assert.deepEqual(posiciones, [0, 1, 2, 3, 4]),
        `${nombre}: el CASO 1 seguiría verde sin la columna`,
      );
      assert.throws(
        () =>
          assert.deepEqual(
            leer(comoLasDevuelveElPlan(tabla), "contrato").map((f) => f.concept),
            ORDEN_ESPERADO,
          ),
        `${nombre}: el CASO 7 seguiría verde sin la columna`,
      );
    }

    // La edición clásica se rompe de la misma forma, aunque su fallo viva en el SQL.
    const ed = await editar(partidas, {
      omitirSortOrder: true,
      columnas: [...columnasQueInsertaLaRpc(rpcSql), "sort_order"],
      conOrdinalidad: false,
    });
    assert.deepEqual(
      ed.persistidas.map((f) => f.sort_order),
      [0, 0, 0, 0, 0],
      "editBudget: sin numerar el array, la RPC escribe ceros aunque tenga la columna",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE F · Que la columna esté de verdad en los writers de producción
// ══════════════════════════════════════════════════════════════════════════════
//
// Auxiliar, no principal: todo lo anterior se ejecuta. Esto sólo ata las réplicas de
// arriba a los ficheros reales, porque una réplica correcta con un original sin cablear
// daría una suite verde sobre un producto roto.

describe("2E · los writers reales escriben la columna", () => {
  const WRITERS = [
    ["saveDraft y finalizeBudget", "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx", 2],
    ["alta manual y edición clásica", "app/dashboard/budgets/_components/budget-form.tsx", 2],
    ["duplicación", "app/dashboard/budgets/[id]/page.tsx", 1],
  ];

  for (const [nombre, fichero, esperados] of WRITERS) {
    test(`CASO 15 — ${nombre}: la posición se escribe desde el índice del array`, () => {
      const src = fs.readFileSync(path.join(root, fichero), "utf8");
      const codigo = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
        .join("\n");

      const asignaciones = codigo.match(/sort_order:\s*idx\b/g) ?? [];
      assert.equal(
        asignaciones.length,
        esperados,
        `${fichero}: se esperaban ${esperados} asignaciones \`sort_order: idx\` y hay ${asignaciones.length}`,
      );
      assert.ok(
        !/sort_order:\s*(created_at|Date\.|new Date)/.test(codigo),
        `${fichero}: la posición no puede derivarse del reloj`,
      );
    });
  }
});
