/**
 * Fase 2D-4 — Cableado del enriquecimiento canónico en el AUTOGUARDADO.
 *
 * La diferencia con 2D-3 no es el código canónico, que es exactamente el mismo: es la
 * FRECUENCIA. `finalizeBudget` se ejecuta una vez por presupuesto; `saveDraft` se
 * ejecuta cada vez que el usuario deja de teclear un segundo y medio. Cablear aquí lo
 * mismo que allí sin pensar en el coste convertiría cada pausa del cursor en una carga
 * de vocabulario y un DELETE + INSERT de la tabla entera.
 *
 * Por eso esta suite protege DOS contratos a la vez:
 *
 *   1. el de 2D-3 —ni un céntimo, ni un orden, ni un bloqueo— aplicado al borrador;
 *   2. y uno nuevo: que un autoguardado sin cambios económicos cueste exactamente
 *      cero. Cero consultas de vocabulario, cero DELETE, cero INSERT. Y sobre todo,
 *      que la metadata canónica no pueda provocar por sí sola un autoguardado, que
 *      sería un bucle: clasificar → ver que el resultado cambió → volver a guardar.
 *
 * Los tests corren contra `syncClassifiedBudgetItems` con un cliente falso que ADEMÁS
 * de leer escribe, para poder contar los DELETE y los INSERT y mirar las filas que de
 * verdad acabaron en la tabla. No se toca Supabase.
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
const { CANONICAL_COLUMN_KEYS, classifyBudgetItems } = await import(
  path.join(root, "lib/canonical/classify-budget-items.ts")
);
const { resolveTenant } = await import(path.join(root, "lib/canonical/finalize-classification.ts"));
const { persistenceSignature, syncClassifiedBudgetItems } = await import(
  path.join(root, "lib/canonical/persist-budget-items.ts")
);
const { normalizeBudgetItemUnit } = await import(path.join(root, "lib/budget-units.ts"));
const { computeBudgetTotals, assertBudgetTotalsConsistent } = await import(
  path.join(root, "lib/budget-totals.ts")
);

const providerSrc = fs.readFileSync(
  path.join(root, "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx"),
  "utf8"
);

// ─── Tenant ───────────────────────────────────────────────────────────────────

const EMPRESA = "0f9b6c1e-3f2a-4c7d-9b1e-2a8c6d4f0e11";
const BORRADOR_ID = "c1d2e3f4-0000-4000-8000-0000000000dd";

// ─── Vocabulario ──────────────────────────────────────────────────────────────
//
// Idéntico al de 2D-3 a propósito: si las dos suites compartiesen fixtures por
// importación, tocar el borrador podría romper la finalización y al revés. Duplicar
// aquí las cuatro entradas cuesta veinte líneas y desacopla las dos suites.

const PAINT_WALL = "WORK.PAINT.EMULSION.WALL.2COATS";
const PAINT_MAT = "MAT.PAINT.EMULSION.INTERIOR_MATT";
const WASTE_HAUL = "WORK.WASTE.CONTAINER.HAUL";
const PRIMER = "WORK.PAINT.PRIMER.APPLY";

function concepto(canonical_id, kind, allowed, i) {
  return {
    id: `b1a2c3d4-${String(i).padStart(4, "0")}-4a00-9000-${String(i).padStart(12, "0")}`,
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
    id: `a0000000-0000-4000-8000-${String(aliasSeq).padStart(12, "0")}`,
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
  // Alias PRIVADO de la empresa. Existe para que "perder el tenant usa globals" sea
  // comprobable: sin él, un borrador clasificado sin empresa daría el mismo resultado
  // que uno clasificado con ella y el test pasaría sin demostrar nada.
  alias(WASTE_HAUL, "Saca de escombros del cliente", { company_id: EMPRESA }),
];

const DB = {
  canonical_alias_sources: DEFAULT_ALIAS_SOURCES.map((s) => ({ ...s })),
  canonical_aliases: ALIASES,
  canonical_concepts: CONCEPTOS,
};

// ─── Cliente Supabase falso, ahora también de ESCRITURA ───────────────────────

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
 * El mismo doble de lectura de 2D-3 más `delete().eq()` e `insert()` sobre una tabla
 * `budget_items` en memoria.
 *
 * `stats` separa deliberadamente las tres cosas que hay que contar por separado:
 *   - `queryCount`  → lecturas de vocabulario, es decir, el coste del snapshot
 *   - `deletes` / `inserts` → escrituras, es decir, el coste en disco
 * Un autoguardado sin cambios tiene que dejar los tres a cero.
 */
function fakeSupabase(tables, options = {}) {
  const failures = options.failures ?? {};
  const stats = { queryCount: 0, byTable: {}, deletes: 0, inserts: 0, insertedRows: [] };
  const rows = { budget_items: [] };

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
          if (options.deleteError) return Promise.resolve({ error: options.deleteError });
          rows[table] = (rows[table] ?? []).filter((r) => r[column] !== value);
          return Promise.resolve({ error: null });
        },
      }),
      insert(newRows) {
        stats.inserts += 1;
        stats.insertedRows = newRows.map((r) => ({ ...r }));
        if (options.insertError) return Promise.resolve({ error: options.insertError });
        rows[table] = [...(rows[table] ?? []), ...newRows.map((r) => ({ ...r }))];
        return Promise.resolve({ error: null });
      },
      then(onfulfilled) {
        stats.queryCount += 1;
        stats.byTable[table] = (stats.byTable[table] ?? 0) + 1;
        if (failures[table] !== undefined) {
          return Promise.resolve(onfulfilled({ data: null, error: { message: failures[table] } }));
        }
        const found = (tables[table] ?? rows[table] ?? []).filter((row) =>
          filters.every((f) => f(row))
        );
        return Promise.resolve(onfulfilled({ data: found.map((r) => ({ ...r })), error: null }));
      },
    };
    return builder;
  }

  return { client: { from }, stats, rows };
}

// ─── El estado del asistente ──────────────────────────────────────────────────

/**
 * Una partida tal y como vive en `state.partidas`: precios de CLIENTE en
 * `unit_price_client` / `subtotal_client`, y un `status` que decide si entra.
 */
function partida(concept, quantity, unit, unit_price_client, subtotal_client, extra = {}) {
  return {
    id: `p-${concept.slice(0, 12)}`,
    concept,
    description: `${concept} — ejecución completa`,
    quantity,
    unit,
    category: "mano_obra",
    chapter: "pintura",
    unit_price_client,
    subtotal_client,
    status: "incluida",
    canonical_origin: null,
    canonical_source_ref: null,
    ...extra,
  };
}

/** Siete partidas que cubren los cuatro estados y las cinco procedencias vivas. */
function partidas() {
  return [
    partida("Pintura plástica en paredes", 58, "m2", 15.64, 906.89, { canonical_origin: "ai" }),
    partida("Pintura plástica blanca mate interior 15 L", 3, "ud", 52.8, 158.4, {
      canonical_origin: "engine",
      category: "material",
    }),
    partida("Pintura blanca para interiores", 2, "ud", 47.31, 94.62, {
      canonical_origin: "free_text",
    }),
    partida("Trabajo con nombre ambiguo", 1, "ud", 133.07, 133.07, {
      canonical_origin: "free_text",
    }),
    partida("Un concepto que no está en el vocabulario", 12, "ml", 9.31, 111.72, {
      canonical_origin: "ai",
    }),
    partida("Imprimación de paredes y techos", 41, "m2", 6.13, 251.33, {
      canonical_origin: "import",
      canonical_source_ref: "cype_2026",
    }),
    partida("Contenedor y transporte a gestor autorizado", 6, "ud", 717.5, 4305.0, {
      canonical_origin: "provider",
      canonical_source_ref: null,
    }),
  ];
}

/**
 * RÉPLICA LITERAL del bloque de `saveDraft`, incluido el orden de las claves.
 *
 * El orden importa porque `persistenceSignature` proyecta con `Object.entries`, que
 * conserva el orden de inserción: si aquí se escribiesen las claves en otro orden, la
 * cadena de la firma sería distinta de la que produce el provider y los tests de
 * "misma firma" estarían midiendo otra cosa.
 */
function construirFilas(state) {
  return state.partidas
    .filter((p) => p.status !== "opcional")
    .map((p) => ({
      budget_id: state.draftId,
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

/** Réplica exacta de la puerta que usan tanto saveDraft como finalizeBudget. */
function assertPersistedTotalsMatch(lines, displayedSubtotal, context) {
  const recomputed = computeBudgetTotals({ lines });
  assertBudgetTotalsConsistent(displayedSubtotal, recomputed, context);
  return recomputed;
}

function estado(overrides = {}) {
  const lista = overrides.partidas ?? partidas();
  const filas = construirFilas({ draftId: BORRADOR_ID, partidas: lista });
  return {
    draftId: BORRADOR_ID,
    partidas: lista,
    totals: { clientPrice: computeBudgetTotals({ lines: filas }).subtotal },
    ...overrides,
  };
}

/**
 * El autoguardado completo, con la MISMA secuencia que el provider:
 *
 *   getUser()  ← ya existía antes de 2D-4: la fila de `budgets` siempre se actualiza
 *   construir filas económicas + procedencia sellada
 *   puerta de cuadre sobre las filas sin clasificar   ← ya existía
 *   syncClassifiedBudgetItems(...)                     ← 2D-4
 *
 * `sesion` es lo que persiste entre autoguardados: la firma del último volcado que sí
 * llegó a escribirse (`lastSyncedItemsSignature` en el provider, un `useRef`).
 */
async function autoguardar(sesion, state, options = {}) {
  const supabase = sesion.supabase;

  // El provider guarda la respuesta ENTERA de auth y se la pasa a `resolveTenant`.
  sesion.authCalls += 1;
  const authResponse = sesion.authResponse;

  const itemsToInsert = construirFilas(state);

  assertPersistedTotalsMatch(itemsToInsert, state.totals.clientPrice, "saveDraft");

  const sync = await syncClassifiedBudgetItems({
    budgetId: state.draftId,
    items: itemsToInsert,
    previousSignature: sesion.lastSignature,
    tenant: resolveTenant(authResponse),
    supabase,
    context: "saveDraft",
    verifyTotals: (rows) =>
      assertPersistedTotalsMatch(rows, state.totals.clientPrice, "saveDraft"),
    log: (report, context) => sesion.logs.push({ report, context }),
    ...options,
  });

  sesion.lastSignature = sync.signature;
  return { ...sync, itemsToInsert };
}

function sesionNueva(options = {}) {
  const { client, stats, rows } = fakeSupabase(DB, options);
  return {
    supabase: client,
    stats,
    rows,
    logs: [],
    authCalls: 0,
    lastSignature: null,
    authResponse: options.authResponse ?? { data: { user: { id: EMPRESA } }, error: null },
  };
}

/** Todo lo que NO es canónico. Es lo que tiene que salir intacto, valor por valor. */
function vistaEconomica(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (CANONICAL_COLUMN_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

const ORIGENES_VALIDOS = ["engine", "ai", "import", "provider", "free_text", "legacy"];
function assertRestriccionesDeProcedencia(row, contexto) {
  const o = row.canonical_origin;
  const ref = row.canonical_source_ref;
  assert.ok(
    o === null || ORIGENES_VALIDOS.includes(o),
    `${contexto}: ck_budget_items_canonical_origin rechazaría '${o}'`
  );
  if (o === "import" || o === "provider") {
    assert.notEqual(ref, null, `${contexto}: ${o} exige canonical_source_ref`);
  } else {
    assert.equal(ref, null, `${contexto}: ck_origin_source_ref prohíbe source_ref con '${o}'`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE A — Un borrador normal guarda las siete columnas
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-4 · el borrador se guarda clasificado", () => {
  test("CASO 1 — las filas que llegan a budget_items traen las siete columnas canónicas", async () => {
    const sesion = sesionNueva();
    const { skipped } = await autoguardar(sesion, estado());

    assert.equal(skipped, false, "el primer autoguardado no puede saltarse");
    assert.equal(sesion.rows.budget_items.length, 7, "no se escribieron las siete líneas");

    for (const [i, row] of sesion.rows.budget_items.entries()) {
      for (const clave of CANONICAL_COLUMN_KEYS) {
        assert.ok(clave in row, `la fila ${i} llegó a la tabla sin la columna '${clave}'`);
      }
    }
  });

  test("CASO 2 — resolved: un alias exacto y curado deja la línea resuelta", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const fila = sesion.rows.budget_items[0];

    assert.equal(fila.canonical_status, "resolved");
    assert.equal(fila.canonical_id, PAINT_WALL);
    assert.equal(fila.canonical_confidence, 1);
    // Dos allowed_price_types → no hay uno solo que deducir.
    assert.equal(fila.price_type, null);
  });

  test("CASO 3 — review: un sinónimo por debajo de 1 no se da por bueno", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const fila = sesion.rows.budget_items[2];

    assert.equal(fila.canonical_status, "review");
    assert.equal(fila.canonical_id, PAINT_MAT);
    assert.ok(fila.canonical_confidence < 1, "un 'review' con confianza 1 sería una contradicción");
  });

  test("CASO 4 — ambiguous: dos conceptos con el mismo literal no eligen ganador", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const fila = sesion.rows.budget_items[3];

    assert.equal(fila.canonical_status, "ambiguous");
    assert.equal(fila.canonical_id, null, "una línea ambigua no puede llevarse un canonical_id");
  });

  test("CASO 5 — unmatched: lo que no está en el vocabulario se guarda igual", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const fila = sesion.rows.budget_items[4];

    assert.equal(fila.canonical_status, "unmatched");
    assert.equal(fila.canonical_id, null);
    assert.equal(fila.canonical_confidence, null);
    assert.equal(fila.price_type, null);
    // Y sigue siendo una línea del presupuesto con su dinero intacto.
    assert.equal(fila.unit_price, 9.31);
    assert.equal(fila.subtotal, 111.72);
  });

  test("CASO 6 — el precio deducible se rellena, el no deducible no se inventa", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());

    // Un solo allowed_price_type → se puede deducir sin ambigüedad.
    assert.equal(sesion.rows.budget_items[1].price_type, "MATERIAL_ONLY");
    // Varios → dejarlo en null es la respuesta honesta.
    assert.equal(sesion.rows.budget_items[0].price_type, null);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE B — La procedencia sobrevive al autoguardado
//
// `canonical_origin` dice DÓNDE NACIÓ la línea; `canonical_source` dice de dónde
// salió la coincidencia. Son cosas distintas y el cable no puede confundirlas. La
// procedencia se sella una vez, al nacer, y ningún autoguardado posterior la reescribe.
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-4 · la procedencia se conserva, no se recalcula", () => {
  test("CASO 7 — 'ai' sobrevive tanto si la línea resuelve como si no", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const filas = sesion.rows.budget_items;

    // Línea 0: nacida del modelo y RESUELTA.
    assert.equal(filas[0].canonical_origin, "ai");
    assert.equal(filas[0].canonical_status, "resolved");
    // Línea 4: nacida del modelo y SIN resolver. 'ai' describe procedencia, no fiabilidad.
    assert.equal(filas[4].canonical_origin, "ai");
    assert.equal(filas[4].canonical_status, "unmatched");
  });

  test("CASO 8 — 'engine' sobrevive", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    assert.equal(sesion.rows.budget_items[1].canonical_origin, "engine");
    assert.equal(sesion.rows.budget_items[1].canonical_source_ref, null);
  });

  test("CASO 9 — 'free_text' sobrevive en review y en ambiguous", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    assert.equal(sesion.rows.budget_items[2].canonical_origin, "free_text");
    assert.equal(sesion.rows.budget_items[3].canonical_origin, "free_text");
  });

  test("CASO 10 — 'import' con instancia documental conserva su source_ref", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const fila = sesion.rows.budget_items[5];

    assert.equal(fila.canonical_origin, "import");
    assert.equal(fila.canonical_source_ref, "cype_2026");
    assertRestriccionesDeProcedencia(fila, "línea importada");
  });

  test("CASO 11 — 'provider' SIN source_ref degrada la pareja entera a (null, null)", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const fila = sesion.rows.budget_items[6];

    // `ck_origin_source_ref` rechazaría ('provider', null) en Postgres. Guardar sólo el
    // origin no es "medio dato": es un dato que la tabla no admite, así que se tira.
    assert.equal(fila.canonical_origin, null);
    assert.equal(fila.canonical_source_ref, null);
  });

  test("CASO 12 — ninguna fila escrita viola las restricciones reales de la tabla", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    for (const [i, row] of sesion.rows.budget_items.entries()) {
      assertRestriccionesDeProcedencia(row, `autoguardado, línea ${i}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE C — Fail-open: nada canónico puede impedir guardar el borrador
//
// Perder el trabajo del usuario porque un catálogo de vocabulario no respondió sería
// el peor fallo posible de esta fase, y encima uno que sólo aparecería el día que el
// catálogo se caiga. Aquí se le rompe a propósito.
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-4 · el sistema canónico no puede impedir guardar", () => {
  test("CASO 13 — el snapshot se avería y el borrador se guarda igual", async () => {
    const sesion = sesionNueva({ failures: { canonical_aliases: "conexión perdida" } });
    const { report, skipped } = await autoguardar(sesion, estado());

    assert.equal(skipped, false);
    assert.equal(report.degraded, "snapshot");
    assert.equal(sesion.rows.budget_items.length, 7, "una avería de lectura tiró el borrador");
    for (const row of sesion.rows.budget_items) {
      assert.equal(row.canonical_status, "unmatched");
      assert.equal(row.canonical_id, null);
    }
    // Y la procedencia, que no depende del vocabulario, sigue ahí.
    assert.equal(sesion.rows.budget_items[0].canonical_origin, "ai");
    assert.equal(sesion.rows.budget_items[5].canonical_source_ref, "cype_2026");
  });

  test("CASO 14 — el clasificador lanza y el borrador se guarda igual", async () => {
    const sesion = sesionNueva();
    const { report } = await autoguardar(sesion, estado(), {
      classify: async () => {
        throw new TypeError("undefined no es una función");
      },
    });

    assert.equal(report.degraded, "classifier");
    assert.equal(report.failureKind, "TypeError");
    assert.equal(sesion.rows.budget_items.length, 7);
    assert.equal(sesion.stats.inserts, 1, "el INSERT no llegó a ocurrir");
  });

  test("CASO 15 — el informe de la avería no filtra el mensaje del error", async () => {
    const sesion = sesionNueva();
    const { report } = await autoguardar(sesion, estado(), {
      classify: async () => {
        throw new TypeError("fallo en tabla canonical_aliases de la empresa " + EMPRESA);
      },
    });

    const serializado = JSON.stringify(report);
    assert.ok(!serializado.includes(EMPRESA), "el informe filtró el identificador de la empresa");
    assert.ok(!serializado.includes("fallo en tabla"), "el informe filtró el mensaje del error");
    assert.equal(report.failureKind, "TypeError");
  });

  test("CASO 16 — un clasificador que corrompe un unit_price degrada, no bloquea", async () => {
    const sesion = sesionNueva();
    const testigo = construirFilas(estado());

    const { report } = await autoguardar(sesion, estado(), {
      classify: async (lines, registry, options) => {
        const out = await classifyBudgetItems(lines, registry, options);
        out.lines[0].unit_price = out.lines[0].unit_price + 0.01;
        return out;
      },
    });

    assert.equal(report.degraded, "economic_integrity");
    assert.equal(report.failureKind, "value:unit_price");
    // El céntimo no llegó a la tabla: lo que se escribió son las líneas ORIGINALES.
    assert.equal(sesion.rows.budget_items[0].unit_price, testigo[0].unit_price);
    assert.deepEqual(
      sesion.rows.budget_items.map(vistaEconomica),
      testigo.map(vistaEconomica),
      "el borrador guardado ya no es el que el usuario está editando"
    );
    // Y se guardó: una avería del observador no puede costarle el trabajo al usuario.
    assert.equal(sesion.rows.budget_items.length, 7);
  });

  test("CASO 17 — un clasificador que ELIMINA una línea degrada, no bloquea", async () => {
    const sesion = sesionNueva();
    const { report } = await autoguardar(sesion, estado(), {
      classify: async (lines, registry, options) => {
        const out = await classifyBudgetItems(lines, registry, options);
        out.lines.splice(2, 1);
        return out;
      },
    });

    assert.equal(report.degraded, "economic_integrity");
    assert.equal(report.failureKind, "line_count");
    assert.equal(sesion.rows.budget_items.length, 7, "se perdió una partida del borrador");
  });

  test("CASO 18 — un clasificador que AÑADE una línea degrada, no bloquea", async () => {
    const sesion = sesionNueva();
    const { report } = await autoguardar(sesion, estado(), {
      classify: async (lines, registry, options) => {
        const out = await classifyBudgetItems(lines, registry, options);
        out.lines.push({ ...out.lines[0] });
        return out;
      },
    });

    assert.equal(report.degraded, "economic_integrity");
    assert.equal(report.failureKind, "line_count");
    assert.equal(sesion.rows.budget_items.length, 7, "se coló una partida que nadie escribió");
  });

  test("CASO 19 — un clasificador que REORDENA degrada, no bloquea", async () => {
    const sesion = sesionNueva();
    const orden = construirFilas(estado()).map((f) => f.concept);

    const { report } = await autoguardar(sesion, estado(), {
      classify: async (lines, registry, options) => {
        const out = await classifyBudgetItems(lines, registry, options);
        out.lines.reverse();
        return out;
      },
    });

    assert.equal(report.degraded, "economic_integrity");
    assert.deepEqual(
      sesion.rows.budget_items.map((f) => f.concept),
      orden,
      "el orden de las partidas es el del documento; reordenarlo cambia el presupuesto"
    );
  });

  test("CASO 20 — un clasificador que toca quantity o chapter degrada, no bloquea", async () => {
    for (const [clave, valor] of [
      ["quantity", 999],
      ["chapter", "demoliciones"],
    ]) {
      const sesion = sesionNueva();
      const { report } = await autoguardar(sesion, estado(), {
        classify: async (lines, registry, options) => {
          const out = await classifyBudgetItems(lines, registry, options);
          out.lines[0][clave] = valor;
          return out;
        },
      });

      assert.equal(report.degraded, "economic_integrity", `sabotaje de ${clave}`);
      assert.equal(report.failureKind, `value:${clave}`, `sabotaje de ${clave}`);
      assert.notEqual(
        sesion.rows.budget_items[0][clave],
        valor,
        `el sabotaje de ${clave} llegó a la tabla`
      );
      assert.equal(sesion.rows.budget_items.length, 7, `sabotaje de ${clave}`);
    }
  });

  test("CONTROL — la puerta de cuadre SIGUE deteniendo un descuadre económico real", async () => {
    // Es el único caso en el que el autoguardado debe abortar: los importes que el
    // usuario ve y los que se iban a escribir no son los mismos. Sin este control, los
    // ocho casos de arriba podrían estar pasando porque la puerta murió, no porque la
    // guarda funcione.
    const sesion = sesionNueva();
    const state = estado();
    state.totals.clientPrice = state.totals.clientPrice + 0.42;

    await assert.rejects(
      () => autoguardar(sesion, state),
      /BUDGET_TOTAL_MISMATCH|no cuadr|mismatch/i,
      "se guardó un borrador cuyas líneas no suman lo que el usuario tiene delante"
    );
    assert.equal(sesion.stats.deletes, 0, "se borraron las filas antes de detectar el descuadre");
    assert.equal(sesion.stats.inserts, 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE D — El tenant: perderlo degrada la clasificación, no la anula
//
// La convención del proyecto es `company_id = auth.uid()`. Si auth no responde, la
// respuesta correcta NO es marcar el borrador entero como unmatched —eso sería tratar
// una molestia como una catástrofe— sino clasificar sólo con el vocabulario GLOBAL,
// que es público y seguro para cualquiera. Lo que no puede pasar bajo ningún concepto
// es que un `user.id` que Supabase no ha podido verificar entre en el filtro
// `company_id` del snapshot y le enseñe a un usuario los alias privados de otro.
// ══════════════════════════════════════════════════════════════════════════════

/** El borrador de arriba más una línea que SÓLO resuelve con el alias privado. */
function estadoConLineaPrivada() {
  const lista = [
    ...partidas(),
    partida("Saca de escombros del cliente", 4, "ud", 88.4, 353.6, {
      canonical_origin: "free_text",
    }),
  ];
  return estado({ partidas: lista });
}

describe("2D-4 · perder el tenant usa globals, nunca un id sin verificar", () => {
  test("CONTROL POSITIVO — con la sesión sana, el alias privado SÍ resuelve", async () => {
    const sesion = sesionNueva();
    const { report } = await autoguardar(sesion, estadoConLineaPrivada());

    assert.equal(report.tenant_context, "resolved");
    assert.equal(report.tenantFailureKind, null);
    assert.equal(sesion.rows.budget_items[7].canonical_status, "resolved");
    assert.equal(sesion.rows.budget_items[7].canonical_id, WASTE_HAUL);
  });

  test("CASO 21 — auth devuelve error Y un user residual: se usa companyId null", async () => {
    // El borde de 2D-3, ahora en el camino del borrador. Aunque `data.user` venga
    // poblado, un `error` significa que esa identidad no está verificada.
    // `AuthApiError` de supabase-js extiende Error, así que el doble también.
    const err = new Error(`jwt expired for ${EMPRESA}`);
    err.name = "AuthApiError";
    const sesion = sesionNueva({
      authResponse: { data: { user: { id: EMPRESA } }, error: err },
    });
    const { report } = await autoguardar(sesion, estadoConLineaPrivada());

    assert.equal(report.tenant_context, "unavailable");
    assert.equal(
      sesion.rows.budget_items[7].canonical_status,
      "unmatched",
      "el alias privado se usó con un user.id que auth no había verificado"
    );
    // Las líneas globales siguen clasificándose: degradar no es apagar.
    assert.equal(sesion.rows.budget_items[0].canonical_status, "resolved");
    assert.equal(report.degraded, null, "perder el tenant no es una avería del cable");

    // Y el informe no dice ni quién ni por qué.
    const serializado = JSON.stringify(report);
    assert.ok(!serializado.includes(EMPRESA), "el informe filtró el user.id sin verificar");
    assert.ok(!serializado.includes("jwt expired"), "el informe filtró el mensaje de auth");
    assert.equal(report.tenantFailureKind, "AuthApiError");
  });

  test("CASO 22 — sin sesión se clasifica con el vocabulario global", async () => {
    const sesion = sesionNueva({ authResponse: { data: { user: null }, error: null } });
    const { report } = await autoguardar(sesion, estadoConLineaPrivada());

    assert.equal(report.tenant_context, "unavailable");
    assert.equal(report.tenantFailureKind, "code:no_session");
    // Lo global funciona...
    assert.equal(sesion.rows.budget_items[0].canonical_status, "resolved");
    assert.equal(sesion.rows.budget_items[2].canonical_status, "review");
    assert.ok(report.resolved > 0, "sin sesión no debe caer toda la clasificación");
    // ...y lo privado no.
    assert.equal(sesion.rows.budget_items[7].canonical_status, "unmatched");
    // Y el borrador se guarda entero de todas formas.
    assert.equal(sesion.rows.budget_items.length, 8);
  });

  test("CASO 23 — el borrador se guarda aunque auth falle: es lo que no puede perderse", async () => {
    const retry = new Error("fetch failed");
    retry.name = "AuthRetryableFetchError";
    const sesion = sesionNueva({ authResponse: { data: null, error: retry } });
    const state = estadoConLineaPrivada();
    const testigo = construirFilas(state);

    const { skipped } = await autoguardar(sesion, state);

    assert.equal(skipped, false);
    assert.deepEqual(
      sesion.rows.budget_items.map(vistaEconomica),
      testigo.map(vistaEconomica),
      "un fallo de auth cambió el contenido económico del borrador"
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE E — Un autoguardado sin cambios económicos cuesta CERO
//
// Éste es el bloque propio de 2D-4. `finalizeBudget` ocurre una vez; `saveDraft`
// ocurre cada segundo y medio de pausa. Si la salida temprana por firma no fuese
// ANTERIOR al trabajo canónico, mover el cursor por el asistente pagaría el
// vocabulario entero para acabar descubriendo que no había nada que guardar.
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-4 · la misma firma económica no cuesta nada", () => {
  test("CASO 24 — segundo autoguardado idéntico: skipped y ni una consulta de vocabulario", async () => {
    const sesion = sesionNueva();
    const state = estado();

    const primero = await autoguardar(sesion, state);
    const consultasTrasElPrimero = sesion.stats.queryCount;
    assert.equal(primero.skipped, false);
    assert.ok(consultasTrasElPrimero > 0, "el primero no leyó el vocabulario: fixture inútil");

    const segundo = await autoguardar(sesion, estado());

    assert.equal(segundo.skipped, true, "se reclasificó un borrador que no había cambiado");
    assert.equal(
      sesion.stats.queryCount,
      consultasTrasElPrimero,
      "el segundo autoguardado volvió a cargar el vocabulario"
    );
    assert.equal(segundo.report, null, "no hubo clasificación, luego no puede haber informe");
    assert.equal(sesion.logs.length, 1, "se emitió observabilidad de una clasificación que no ocurrió");
  });

  test("CASO 25 — la misma firma NO carga el snapshot", async () => {
    const sesion = sesionNueva();
    let cargas = 0;
    const espia = async (...args) => {
      cargas += 1;
      const { loadCanonicalRegistrySnapshot } = await import(
        path.join(root, "lib/canonical/registry-snapshot.ts")
      );
      return loadCanonicalRegistrySnapshot(...args);
    };

    await autoguardar(sesion, estado(), { loadSnapshot: espia });
    assert.equal(cargas, 1, "el primer autoguardado debe cargar el vocabulario una vez");

    await autoguardar(sesion, estado(), { loadSnapshot: espia });
    assert.equal(cargas, 1, "la salida por firma ocurre DESPUÉS de cargar el snapshot");
  });

  test("CASO 26 — la misma firma NO ejecuta el DELETE", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    assert.equal(sesion.stats.deletes, 1);

    await autoguardar(sesion, estado());
    assert.equal(sesion.stats.deletes, 1, "se reescribió la tabla sin que nada hubiera cambiado");
  });

  test("CASO 27 — la misma firma NO ejecuta el INSERT", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    assert.equal(sesion.stats.inserts, 1);

    await autoguardar(sesion, estado());
    assert.equal(sesion.stats.inserts, 1);
    assert.equal(sesion.rows.budget_items.length, 7, "las filas se duplicaron");
  });

  test("CASO 28 — el cable canónico no añade ni una llamada a auth", async () => {
    // Matiz importante y deliberado: `saveDraft` YA llamaba a `getUser()` antes de
    // 2D-4, porque la fila de `budgets` se actualiza siempre. El wiring canónico reusa
    // esa respuesta en vez de pedir otra, así que el coste de auth por autoguardado es
    // el mismo que antes de esta fase: exactamente uno. Y cuando la firma no cambia,
    // el sistema canónico no consulta auth en absoluto.
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    assert.equal(sesion.authCalls, 1);

    const segundo = await autoguardar(sesion, estado());
    assert.equal(segundo.skipped, true);
    assert.equal(sesion.authCalls, 2, "un autoguardado sigue costando una sola llamada a auth");
    // Y esa segunda llamada no la provocó el sistema canónico, que ni llegó a mirarla:
    // no hubo informe, luego no hubo `resolveTenant` con consecuencias.
    assert.equal(segundo.report, null);
  });

  test("CASO 29 — un cambio económico real SÍ vuelve a escribir", async () => {
    // Control de sensibilidad de todo el bloque: si la firma se quedase pegada, los
    // cinco casos de arriba pasarían por el motivo equivocado.
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());

    const lista = partidas();
    lista[0].quantity = 59;
    lista[0].subtotal_client = 922.53;
    const tercero = await autoguardar(sesion, estado({ partidas: lista }));

    assert.equal(tercero.skipped, false, "cambiar una cantidad no provocó un guardado");
    assert.equal(sesion.stats.deletes, 2);
    assert.equal(sesion.stats.inserts, 2);
    assert.equal(sesion.rows.budget_items[0].quantity, 59);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE F — La regla fundamental: lo que el clasificador DERIVA no provoca escrituras
//
// La firma cubre lo que el ESTADO APORTA a la fila y excluye lo que el CLASIFICADOR
// DERIVA de ella.
//
// Si las cinco derivadas —canonical_id, canonical_status, canonical_confidence,
// canonical_source, price_type— entrasen en la firma, el sistema canónico podría
// dispararse a sí mismo: clasificar → ver que el resultado cambió respecto a lo
// guardado → volver a guardar → clasificar otra vez. Un bucle de escrituras nacido del
// observador, que es exactamente lo que la firma existe para impedir.
//
// La procedencia (canonical_origin, canonical_source_ref) está al otro lado de esa
// línea: la aporta el asistente, se persiste y es mutable. Fuera de la firma podría
// quedarse desincronizada PARA SIEMPRE, porque la salida temprana impediría el UPDATE
// que la corrige. Por eso entra. Ver la revisión de la fase y `persistenceSignature`.
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-4 · la firma cubre lo aportado y excluye lo derivado", () => {
  test("CASO 30 — la firma excluye EXACTAMENTE las cinco columnas derivadas", async () => {
    // Se comprueba columna a columna, no por la lista: cambiar una derivada no puede
    // mover la firma, y cambiar una aportada tiene que moverla. Así, si algún día
    // alguien mueve una columna de un lado a otro, este test lo dice.
    const DERIVADAS = [
      "canonical_id",
      "canonical_status",
      "canonical_confidence",
      "canonical_source",
      "price_type",
    ];
    const APORTADAS = ["canonical_origin", "canonical_source_ref"];

    // La fila de partida ya clasificada, tal y como sale del cable hacia la tabla.
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const base = sesion.rows.budget_items.map((f) => ({ ...f }));
    const firmaBase = persistenceSignature(BORRADOR_ID, base);

    for (const clave of DERIVADAS) {
      const tocada = base.map((f, i) => (i === 0 ? { ...f, [clave]: "VALOR-INVENTADO" } : f));
      assert.equal(
        persistenceSignature(BORRADOR_ID, tocada),
        firmaBase,
        `'${clave}' entró en la firma: el clasificador puede provocar escrituras por su cuenta`
      );
    }

    for (const clave of APORTADAS) {
      const tocada = base.map((f, i) => (i === 0 ? { ...f, [clave]: "engine" } : f));
      assert.notEqual(
        persistenceSignature(BORRADOR_ID, tocada),
        firmaBase,
        `'${clave}' quedó fuera de la firma: podría desincronizarse para siempre`
      );
    }

    // Y las nueve columnas económicas siguen dentro, por si acaso.
    const conOtroImporte = base.map((f, i) => (i === 0 ? { ...f, unit_price: 999.99 } : f));
    assert.notEqual(persistenceSignature(BORRADOR_ID, conOtroImporte), firmaBase);
  });

  test("CASO 31 — cambiar SÓLO la procedencia SÍ reescribe la tabla", async () => {
    // Antes de la revisión este test exigía lo contrario (`skipped === true`). Estaba
    // protegiendo un fallo: la procedencia se persiste, así que si cambia y no se
    // reescribe, la fila de `budget_items` conserva el valor viejo y —al no volver a
    // cambiar la economía— NO hay nada que la corrija nunca.
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    assert.equal(sesion.rows.budget_items[0].canonical_origin, "ai");

    const lista = partidas();
    lista[0].canonical_origin = "engine"; // era "ai"; los importes no se tocan
    const segundo = await autoguardar(sesion, estado({ partidas: lista }));

    assert.equal(segundo.skipped, false, "un cambio de procedencia no llegó a la tabla");
    assert.equal(sesion.stats.inserts, 2);
    assert.equal(
      sesion.rows.budget_items[0].canonical_origin,
      "engine",
      "la tabla se quedó con la procedencia vieja"
    );

    // Y no ha cambiado ni un céntimo por el camino.
    assert.equal(
      computeBudgetTotals({ lines: sesion.rows.budget_items }).subtotal,
      estado({ partidas: lista }).totals.clientPrice
    );
  });

  test("CASO 31b — reclasificar sin tocar nada NO reescribe: no hay bucle", async () => {
    // El contrapunto del anterior. Es el bucle en su forma más pura: si el resultado
    // del clasificador contase, el segundo autoguardado idéntico volvería a escribir.
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const consultasTrasElPrimero = sesion.stats.queryCount;

    const segundo = await autoguardar(sesion, estado());

    assert.equal(segundo.skipped, true, "un autoguardado sin cambios escribió en disco");
    assert.equal(sesion.stats.deletes, 1);
    assert.equal(sesion.stats.inserts, 1);
    assert.equal(
      sesion.stats.queryCount,
      consultasTrasElPrimero,
      "el segundo autoguardado cargó vocabulario aunque no había nada que guardar"
    );
  });

  test("CASO 32 — la firma se calcula de la ENTRADA, nunca de lo escrito", async () => {
    // Aquí está la razón exacta por la que meter la procedencia en la firma no monta
    // un bucle, aunque la clasificación PUEDA cambiarla.
    //
    // `normalizeProvenance` degrada a (null, null) las procedencias que Postgres
    // rechazaría —`provider`/`import` sin un source_ref válido—, así que la fila
    // escrita no siempre trae la misma procedencia que la fila de entrada. Si la firma
    // se calculase de lo ESCRITO, esa fila diría "cambió" en cada guardado y
    // tendríamos el bucle. Se calcula de la ENTRADA, que es estado de React puro y
    // sólo cambia cuando el usuario cambia algo. Por eso no lo hay.
    const sesion = sesionNueva();
    const { signature, itemsToInsert } = await autoguardar(sesion, estado());

    const escritas = sesion.rows.budget_items;
    for (const clave of CANONICAL_COLUMN_KEYS) {
      assert.ok(clave in escritas[0], `fixture inútil: las filas escritas no traen '${clave}'`);
    }

    assert.equal(
      persistenceSignature(BORRADOR_ID, itemsToInsert),
      signature,
      "la firma recordada no es la de las filas que se le pasaron al cable"
    );

    // Y el fixture contiene de verdad una fila que la normalización degrada, para que
    // este test no pase por casualidad el día que alguien cambie las fixtures.
    const degradada = escritas.findIndex((f, i) => f.canonical_origin !== itemsToInsert[i].canonical_origin);
    assert.notEqual(
      degradada,
      -1,
      "fixture inútil: ninguna fila ejercita la normalización de procedencia"
    );
    assert.equal(itemsToInsert[degradada].canonical_origin, "provider");
    assert.equal(itemsToInsert[degradada].canonical_source_ref, null);
    assert.equal(escritas[degradada].canonical_origin, null);

    // Y aun así, volver a guardar lo mismo sale temprano: no hay bucle.
    const segundo = await autoguardar(sesion, estado());
    assert.equal(segundo.skipped, true, "la normalización de procedencia provocó una reescritura");
  });

  test("CASO 33 — el resultado del clasificador no se retroalimenta a state.partidas", async () => {
    const sesion = sesionNueva();
    const state = estado();
    const testigo = JSON.parse(JSON.stringify(state.partidas));

    await autoguardar(sesion, state);

    assert.deepEqual(
      state.partidas,
      testigo,
      "el estado de React ganó columnas canónicas: la próxima firma de autoguardado ya no es la misma"
    );
    for (const p of state.partidas) {
      assert.ok(!("canonical_status" in p), "una partida del asistente ganó canonical_status");
      assert.ok(!("canonical_id" in p), "una partida del asistente ganó canonical_id");
      assert.ok(!("price_type" in p), "una partida del asistente ganó price_type");
    }
  });

  test("CASO 34 — el array de entrada no se muta: el cable copia", async () => {
    const sesion = sesionNueva();
    const state = estado();
    const itemsToInsert = construirFilas(state);
    const testigo = JSON.parse(JSON.stringify(itemsToInsert));

    await syncClassifiedBudgetItems({
      budgetId: state.draftId,
      items: itemsToInsert,
      previousSignature: null,
      tenant: resolveTenant(sesion.authResponse),
      supabase: sesion.supabase,
      context: "saveDraft",
      verifyTotals: () => {},
    });

    assert.deepEqual(itemsToInsert, testigo, "el cable mutó las filas que le pasaron");
  });

  test("CASO 35 — mismo número, mismo orden y mismos importes antes y después", async () => {
    const sesion = sesionNueva();
    const state = estado();
    const antes = construirFilas(state);

    await autoguardar(sesion, state);
    const despues = sesion.rows.budget_items;

    assert.equal(despues.length, antes.length);
    assert.deepEqual(
      despues.map((f) => f.concept),
      antes.map((f) => f.concept),
      "el orden de las partidas cambió al atravesar el cable"
    );
    assert.deepEqual(
      despues.map(vistaEconomica),
      antes.map(vistaEconomica),
      "alguna clave no canónica cambió de valor"
    );
    // Y el subtotal que suman las filas escritas es el que el usuario tenía delante.
    assert.equal(computeBudgetTotals({ lines: despues }).subtotal, state.totals.clientPrice);
  });

  test("CASO 36 — las partidas opcionales siguen sin persistirse", async () => {
    // No es canónico, pero el `.map()` que sella la procedencia es el mismo que filtra:
    // si el cable hubiera tocado ese filtro, se colarían líneas que el cliente no ha
    // aceptado y el presupuesto guardado dejaría de cuadrar con el mostrado.
    const lista = partidas();
    lista[4].status = "opcional";
    const state = estado({ partidas: lista });

    const sesion = sesionNueva();
    await autoguardar(sesion, state);

    assert.equal(sesion.rows.budget_items.length, 6);
    assert.ok(
      !sesion.rows.budget_items.some((f) => f.concept === lista[4].concept),
      "una partida opcional acabó en budget_items"
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE G — Observabilidad
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-4 · el informe distingue el borrador de la finalización", () => {
  test("CASO 37 — el contexto emitido es 'saveDraft'", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());

    assert.equal(sesion.logs.length, 1);
    assert.equal(sesion.logs[0].context, "saveDraft");
  });

  test("CASO 38 — el informe son contadores, no contenido del presupuesto", async () => {
    const sesion = sesionNueva();
    const state = estado();
    await autoguardar(sesion, state);

    const { report } = sesion.logs[0];
    assert.equal(report.attempted, 7);
    assert.equal(report.resolved + report.review + report.ambiguous + report.unmatched, 7);

    // Un log de presupuestos no debe permitir reconstruir el presupuesto.
    const serializado = JSON.stringify(report);
    for (const p of state.partidas) {
      assert.ok(!serializado.includes(p.concept), `el informe cita el concepto '${p.concept}'`);
      assert.ok(
        !serializado.includes(String(p.unit_price_client)),
        `el informe cita el importe ${p.unit_price_client}`
      );
    }
    assert.ok(!serializado.includes(BORRADOR_ID), "el informe cita el id del presupuesto");
    assert.ok(!serializado.includes(EMPRESA), "el informe cita el id de la empresa");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE H — El provider está cableado a esto y no a otra cosa
//
// Comprobaciones SECUNDARIAS. Todo lo de arriba prueba comportamiento contra el módulo
// real; esto sólo verifica que `saveDraft` llama a ese módulo y no a una copia paralela
// que se quedaría sin los contratos de arriba el día que alguien la toque.
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-4 · saveDraft usa el módulo que esta suite protege", () => {
  test("CASO 39 — saveDraft delega en syncClassifiedBudgetItems", () => {
    assert.ok(
      providerSrc.includes("syncClassifiedBudgetItems({"),
      "saveDraft ya no llama al sincronizador que estos tests protegen"
    );
    assert.ok(providerSrc.includes('context: "saveDraft"'));
  });

  test("CASO 40 — no queda un DELETE/INSERT de budget_items suelto en saveDraft", () => {
    // Si volviera a existir un camino de escritura propio dentro de `saveDraft`, las
    // filas se guardarían sin clasificar y sin salida temprana por firma.
    const inicio = providerSrc.indexOf("const saveDraft");
    const fin = providerSrc.indexOf("const finalizeBudget");
    assert.ok(inicio > 0 && fin > inicio, "no se localizó el cuerpo de saveDraft");
    const cuerpo = providerSrc.slice(inicio, fin);

    assert.ok(
      !cuerpo.includes('from("budget_items").delete()'),
      "saveDraft volvió a borrar budget_items por su cuenta"
    );
    assert.ok(
      !cuerpo.includes('from("budget_items").insert('),
      "saveDraft volvió a insertar en budget_items por su cuenta"
    );
  });

  test("CASO 41 — el tenant sale de la respuesta de auth que saveDraft ya pidió", () => {
    const inicio = providerSrc.indexOf("const saveDraft");
    const fin = providerSrc.indexOf("const finalizeBudget");
    const cuerpo = providerSrc.slice(inicio, fin);

    assert.ok(cuerpo.includes("resolveTenant(authResponse)"), "el tenant no reusa la respuesta");
    assert.equal(
      (cuerpo.match(/auth\.getUser\(\)/g) ?? []).length,
      1,
      "el wiring canónico añadió una segunda llamada a auth en el camino del autoguardado"
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE I — La firma sólo avanza tras una escritura que ha terminado bien
//
// El contrato completo, en orden:
//
//   calcular firma → comparar → clasificar → cuadrar → DELETE → INSERT → y SÓLO
//   ENTONCES recordar la firma nueva.
//
// Si algo de en medio falla, el llamante NO recibe firma nueva que recordar, con lo
// que el siguiente intento del MISMO contenido vuelve a sincronizar en vez de salir
// temprano. Sin esto, un fallo de red durante un autoguardado dejaría el borrador
// desincronizado hasta que el usuario tocase un importe: la firma habría avanzado y
// todos los guardados siguientes del mismo contenido saldrían por la salida temprana.
//
// LO QUE ESTA FASE NO ARREGLA: DELETE + INSERT no es atómico. Si el DELETE va bien y
// el INSERT falla, la tabla queda vacía. Lo que se garantiza aquí es el REINTENTO,
// no la atomicidad. La transaccionalidad es un problema aparte (una RPC), y meterla
// aquí sería exactamente la sobreingeniería que esta fase evita.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Captura lo que lanza `fn`, sea lo que sea.
 *
 * No se usa `assert.rejects` con una expresión regular a propósito: supabase-js NO
 * devuelve instancias de `Error`, sino objetos planos `{ message, code, ... }`, y el
 * módulo relanza EXACTAMENTE lo que recibe. Emparejar eso con una regexp obligaría a
 * falsear el doble como si supabase lanzara errores de verdad, que es justo lo que no
 * hace y la razón por la que hay que comprobar `{ error }` a mano.
 */
async function capturar(fn) {
  const NADA = Symbol("no lanzó");
  try {
    await fn();
    return NADA;
  } catch (e) {
    return e;
  }
}

describe("2D-4 · un fallo de escritura no avanza la firma", () => {
  test("CASO 42 — DELETE falla → el autoguardado falla → la firma no avanza → se reintenta", async () => {
    // Nota sobre la premisa: antes de esta revisión el error del DELETE NO se
    // comprobaba —ni aquí ni en el código pre-2D-4 del que salió este módulo—. No es
    // que "fallase como antes": es que ANTES NO FALLABA. Se seguía hasta el INSERT
    // sobre una tabla que no se había vaciado (filas duplicadas) y la firma avanzaba,
    // congelando la duplicación. Este test fija el comportamiento corregido.
    const opciones = { deleteError: { message: "conexión perdida durante el DELETE" } };
    const sesion = sesionNueva(opciones);

    const lanzado = await capturar(() => autoguardar(sesion, estado()));
    assert.equal(
      lanzado?.message,
      "conexión perdida durante el DELETE",
      "el fallo del DELETE se tragó en silencio"
    );

    assert.equal(sesion.stats.deletes, 1, "no se intentó el DELETE");
    assert.equal(
      sesion.stats.inserts,
      0,
      "se insertó sobre una tabla que no se había vaciado: filas duplicadas"
    );
    assert.equal(sesion.lastSignature, null, "la firma avanzó pese a que no se escribió nada");

    // Segundo intento, MISMO contenido y ahora sin avería.
    opciones.deleteError = null;
    const reintento = await autoguardar(sesion, estado());

    assert.equal(reintento.skipped, false, "el reintento salió por firma: el borrador se perdió");
    assert.equal(sesion.stats.deletes, 2, "el reintento no volvió a ejecutar el DELETE");
    assert.equal(sesion.stats.inserts, 1);
    assert.equal(sesion.rows.budget_items.length, 7);
    assert.equal(
      computeBudgetTotals({ lines: sesion.rows.budget_items }).subtotal,
      estado().totals.clientPrice
    );
  });

  test("CASO 43 — DELETE bien + INSERT falla → la firma no avanza → se reclasifica y reintenta", async () => {
    const opciones = { insertError: { message: "timeout en el INSERT" } };
    const sesion = sesionNueva(opciones);

    const lanzado = await capturar(() => autoguardar(sesion, estado()));
    assert.equal(
      lanzado?.message,
      "timeout en el INSERT",
      "el fallo del INSERT se tragó en silencio"
    );

    assert.equal(sesion.stats.deletes, 1);
    assert.equal(sesion.stats.inserts, 1);
    assert.equal(sesion.lastSignature, null, "la firma avanzó pese a que el INSERT falló");
    // El DELETE sí se ejecutó: aquí se ve que la operación NO es atómica. Que la tabla
    // quede vacía es aceptable porque el reintento está garantizado; lo que no sería
    // aceptable es que además la firma impidiese ese reintento.
    assert.equal(sesion.rows.budget_items.length, 0);

    const consultasTrasElFallo = sesion.stats.queryCount;

    opciones.insertError = null;
    const reintento = await autoguardar(sesion, estado());

    assert.equal(
      reintento.skipped,
      false,
      "el reintento salió temprano por firma: el borrador se quedaría vacío para siempre"
    );
    assert.ok(
      sesion.stats.queryCount > consultasTrasElFallo,
      "el reintento no volvió a clasificar: las filas se escribirían sin vocabulario"
    );
    assert.equal(sesion.stats.deletes, 2);
    assert.equal(sesion.stats.inserts, 2);
    assert.equal(sesion.rows.budget_items.length, 7, "el reintento no repobló la tabla");
    for (const clave of CANONICAL_COLUMN_KEYS) {
      assert.ok(clave in sesion.rows.budget_items[0], `el reintento escribió sin '${clave}'`);
    }
  });

  test("CASO 44 — un descuadre económico tampoco avanza la firma, y no toca la tabla", async () => {
    // La otra puerta que puede detener la escritura. A diferencia de las dos de
    // arriba, ésta lanza ANTES del DELETE: un presupuesto descuadrado deja intacto lo
    // que ya había guardado en vez de dejarlo a medias.
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const firmaBuena = sesion.lastSignature;
    const guardadoBueno = sesion.rows.budget_items.map((f) => ({ ...f }));

    const lista = partidas();
    lista[0].quantity = 59; // cambia la economía, pero el total mostrado se queda viejo
    const stateDescuadrado = {
      draftId: BORRADOR_ID,
      partidas: lista,
      totals: { clientPrice: estado().totals.clientPrice },
    };

    await assert.rejects(() => autoguardar(sesion, stateDescuadrado));

    assert.equal(sesion.lastSignature, firmaBuena, "un descuadre avanzó la firma");
    assert.equal(sesion.stats.deletes, 1, "un descuadre llegó a borrar la tabla");
    assert.equal(sesion.stats.inserts, 1);
    assert.deepEqual(sesion.rows.budget_items, guardadoBueno, "el guardado anterior se dañó");
  });

  test("CASO 45 — la salida temprana no escribe, no clasifica y no pide auth de más", async () => {
    // El control positivo de todo el bloque: cuando NO hay nada que hacer, el orden
    // (firma → comparar → clasificar) hace que el autoguardado cueste cero consultas.
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const consultas = sesion.stats.queryCount;

    const segundo = await autoguardar(sesion, estado());

    assert.equal(segundo.skipped, true);
    assert.equal(segundo.report, null, "se clasificó sin necesidad");
    assert.equal(sesion.stats.queryCount, consultas, "la salida temprana cargó vocabulario");
    assert.equal(sesion.stats.deletes, 1);
    assert.equal(sesion.stats.inserts, 1);
    assert.equal(sesion.logs.length, 1, "la salida temprana emitió un informe vacío");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE J — Auditoría de mutabilidad de la procedencia, hecha ejecutable
//
// CONCLUSIÓN DE LA AUDITORÍA: la procedencia NO es inmutable. Existen caminos que la
// cambian —o la pierden— sin cambiar ni un céntimo de la economía:
//
//   1. `updatePartida(id, updates: Partial<Partida>)` hace `{ ...p, ...updates }` y
//      `Partida` declara las dos columnas, así que son asignables por tipo.
//   2. Dos proyecciones del asistente que reconstruyen `partidas` clave a clave NO
//      copian la procedencia, mientras sus hermanas de EnginePartida sí lo hacen.
//
// De ahí la decisión: la procedencia entra en `persistenceSignature`. Estos tests
// demuestran los dos caminos y, sobre todo, que con la firma nueva la tabla SE
// CORRIGE sola en el siguiente guardado en vez de quedarse desincronizada para
// siempre.
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-4 · la procedencia es mutable, y la firma lo absorbe", () => {
  test("CASO 46 — la forma de updatePartida permite cambiar la procedencia sin tocar la economía", async () => {
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    const economicoAntes = sesion.rows.budget_items.map(vistaEconomica);

    // La transformación EXACTA de `updatePartida`, aplicada sólo a la procedencia.
    const lista = partidas().map((p) =>
      p.id === partidas()[3].id
        ? { ...p, ...{ canonical_origin: "import", canonical_source_ref: "cype_2026" } }
        : p
    );

    const segundo = await autoguardar(sesion, estado({ partidas: lista }));

    assert.equal(segundo.skipped, false, "el cambio de procedencia no llegó a la tabla");
    assert.deepEqual(
      sesion.rows.budget_items.map(vistaEconomica),
      economicoAntes,
      "cambiar la procedencia movió algún importe"
    );
    assert.equal(sesion.rows.budget_items[3].canonical_origin, "import");
    assert.equal(sesion.rows.budget_items[3].canonical_source_ref, "cype_2026");
    for (const fila of sesion.rows.budget_items) {
      assertRestriccionesDeProcedencia(fila, "tras updatePartida");
    }
  });

  test("CASO 47 — una proyección que PIERDE la procedencia se corrige en el guardado siguiente", async () => {
    // Éste es el defecto real: hay proyecciones en el asistente que reconstruyen las
    // partidas clave a clave y se dejan la procedencia por el camino. La fase 2D-4 no
    // los arregla —está fuera de su alcance—, pero con la firma nueva el resultado es
    // una fila que cae a `null` Y SE ESCRIBE, no una fila que se queda con el valor
    // viejo y ya nunca se toca. Es la diferencia entre un dato desactualizado y un
    // dato desactualizado INDETECTABLE.
    const sesion = sesionNueva();
    await autoguardar(sesion, estado());
    assert.equal(sesion.rows.budget_items[0].canonical_origin, "ai");

    // La proyección con pérdida, tal cual: mismas claves económicas, sin las canónicas.
    const proyectadas = partidas().map((p) => ({
      id: p.id,
      concept: p.concept,
      description: p.description,
      quantity: p.quantity,
      unit: p.unit,
      category: p.category,
      chapter: p.chapter,
      unit_price_client: p.unit_price_client,
      subtotal_client: p.subtotal_client,
      status: p.status,
    }));

    const segundo = await autoguardar(sesion, estado({ partidas: proyectadas }));

    assert.equal(
      segundo.skipped,
      false,
      "la pérdida de procedencia pasó desapercibida: la tabla conservaría 'ai' para siempre"
    );
    for (const fila of sesion.rows.budget_items) {
      assert.equal(fila.canonical_origin, null);
      assert.equal(fila.canonical_source_ref, null);
    }
    // Y la economía sigue exactamente igual: la pérdida era SÓLO de procedencia.
    assert.equal(
      computeBudgetTotals({ lines: sesion.rows.budget_items }).subtotal,
      estado().totals.clientPrice
    );
  });

  test("CASO 48 — la clasificación conserva la procedencia salvo cuando Postgres la rechazaría", async () => {
    // La otra mitad de la auditoría: qué toca el clasificador y qué no.
    //
    // Conserva la procedencia SIEMPRE, con una única excepción deliberada:
    // `normalizeProvenance` degrada a (null, null) las parejas que
    // `ck_origin_source_ref` rechazaría —`import`/`provider` sin source_ref válido—,
    // porque escribirlas haría fallar el INSERT entero. Es la ÚNICA transformación de
    // procedencia de todo el camino, y está en un solo sitio.
    const sesion = sesionNueva();
    const { itemsToInsert } = await autoguardar(sesion, estado());

    const escritas = sesion.rows.budget_items;
    assert.equal(escritas.length, itemsToInsert.length);

    const EXIGEN_REF = ["import", "provider"];
    let degradadas = 0;

    for (let i = 0; i < escritas.length; i += 1) {
      const entrada = itemsToInsert[i];
      const rechazable =
        EXIGEN_REF.includes(entrada.canonical_origin) && entrada.canonical_source_ref === null;

      if (rechazable) {
        degradadas += 1;
        assert.equal(escritas[i].canonical_origin, null, `fila ${i}: pareja inválida escrita`);
        assert.equal(escritas[i].canonical_source_ref, null);
      } else {
        assert.equal(
          escritas[i].canonical_origin,
          entrada.canonical_origin,
          `la clasificación cambió canonical_origin de la fila ${i}`
        );
        assert.equal(
          escritas[i].canonical_source_ref,
          entrada.canonical_source_ref,
          `la clasificación cambió canonical_source_ref de la fila ${i}`
        );
      }
      assertRestriccionesDeProcedencia(escritas[i], `fila ${i}`);
    }

    assert.equal(degradadas, 1, "fixture inútil: ninguna fila ejercita la degradación");
  });
});
