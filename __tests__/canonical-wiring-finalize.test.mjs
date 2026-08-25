/**
 * Fase 2D-3 — Cableado del enriquecimiento canónico en la finalización.
 *
 * Lo que se protege aquí NO es que la clasificación acierte (eso es canonical-resolver)
 * ni que la capa pura sea inocua (eso es canonical-classify). Se protege el CABLE: que
 * conectar el sistema canónico al camino de escritura de un presupuesto no cambie ni un
 * céntimo, no reordene ni pierda ninguna línea, y no pueda impedir que se finalice.
 *
 * Estos tests corren contra `classifyForPersistence` con las dependencias inyectadas,
 * no contra cadenas de texto del provider. Un test que comprueba que algo está ESCRITO
 * no comprueba que FUNCIONE, y es justo el fail-open —el código que sólo se ejecuta
 * cuando algo ya ha fallado— lo que nunca se prueba solo. Aquí se hace fallar de verdad
 * al snapshot y al clasificador y se mira qué sale.
 *
 * No se toca Supabase. La "base de datos" es un objeto en memoria.
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
const { loadCanonicalRegistrySnapshot } = await import(
  path.join(root, "lib/canonical/registry-snapshot.ts")
);
const { classifyForPersistence, enrichForPersistence, resolveTenant } = await import(
  path.join(root, "lib/canonical/finalize-classification.ts")
);
const { computeBudgetTotals, computeBudgetTotalsFromSubtotal, assertBudgetTotalsConsistent } =
  await import(path.join(root, "lib/budget-totals.ts"));

const providerSrc = fs.readFileSync(
  path.join(root, "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx"),
  "utf8"
);

// ─── Tenant ───────────────────────────────────────────────────────────────────

const EMPRESA = "0f9b6c1e-3f2a-4c7d-9b1e-2a8c6d4f0e11";
const PRESUPUESTO_ID = "d4c3b2a1-0000-4000-8000-000000000099";

// ─── Vocabulario ──────────────────────────────────────────────────────────────

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
  // Dos allowed_price_types → resolved SIN price_type.
  concepto(PAINT_WALL, "WORK", ["LABOR_ONLY", "LABOR_AND_MATERIAL"], 1),
  // Uno solo → resolved CON price_type.
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
  // Sinónimo por debajo de 1 → 'review'.
  alias(PAINT_MAT, "Pintura blanca para interiores", { kind: "synonym", confidence: 0.7 }),
  // Dos conceptos distintos con el mismo literal exacto → 'ambiguous'.
  alias(PAINT_MAT, "Trabajo con nombre ambiguo"),
  alias(WASTE_HAUL, "Trabajo con nombre ambiguo"),
  alias(PRIMER, "Imprimación de paredes y techos", { source: "import", source_ref: "cype_2026" }),
];

const DB = {
  canonical_alias_sources: DEFAULT_ALIAS_SOURCES.map((s) => ({ ...s })),
  canonical_aliases: ALIASES,
  canonical_concepts: CONCEPTOS,
};

// ─── Cliente Supabase falso ───────────────────────────────────────────────────

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
 * Cuenta TODAS las consultas que se le piden. Es el instrumento con el que se mide
 * que la clasificación posterior al snapshot no vuelve a la red: si volviera, este
 * contador subiría después de que el loader haya terminado.
 */
function fakeSupabase(tables, options = {}) {
  const failures = options.failures ?? {};
  const stats = { queryCount: 0, byTable: {} };

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
      then(onfulfilled) {
        stats.queryCount += 1;
        stats.byTable[table] = (stats.byTable[table] ?? 0) + 1;
        if (failures[table] !== undefined) {
          return Promise.resolve(onfulfilled({ data: null, error: { message: failures[table] } }));
        }
        const rows = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
        return Promise.resolve(onfulfilled({ data: rows.map((r) => ({ ...r })), error: null }));
      },
    };
    return builder;
  }

  return { client: { from }, stats };
}

// ─── El presupuesto ───────────────────────────────────────────────────────────

/**
 * Fila tal y como `finalizeBudget` la construye: las nueve columnas económicas más
 * las dos de procedencia. Los importes NO son redondos a propósito; si el cable
 * tocase un céntimo, la comparación lo vería.
 */
function fila(concept, quantity, unit, unit_price, subtotal, extra = {}) {
  return {
    budget_id: PRESUPUESTO_ID,
    concept,
    description: `${concept} — ejecución completa`,
    quantity,
    unit,
    category: "mano_obra",
    chapter: "pintura",
    unit_price,
    subtotal,
    canonical_origin: null,
    canonical_source_ref: null,
    ...extra,
  };
}

/** Siete líneas que cubren los cuatro estados y las cinco procedencias vivas. */
function presupuesto() {
  return [
    // resolved, dos allowed_price_types → price_type null
    fila("Pintura plástica en paredes", 58, "m2", 15.64, 906.89, { canonical_origin: "ai" }),
    // resolved, un solo allowed_price_type → price_type MATERIAL_ONLY
    fila("Pintura plástica blanca mate interior 15 L", 3, "ud", 52.8, 158.4, {
      canonical_origin: "engine",
      category: "material",
    }),
    // review (sinónimo 0.7)
    fila("Pintura blanca para interiores", 2, "ud", 47.31, 94.62, {
      canonical_origin: "free_text",
    }),
    // ambiguous (dos conceptos con el mismo literal exacto)
    fila("Trabajo con nombre ambiguo", 1, "ud", 133.07, 133.07, { canonical_origin: "free_text" }),
    // unmatched, nacida del modelo
    fila("Un concepto que no está en el vocabulario", 12, "ml", 9.31, 111.72, {
      canonical_origin: "ai",
    }),
    // resolved por un alias de importación, con instancia documental válida
    fila("Imprimación de paredes y techos", 41, "m2", 6.13, 251.33, {
      canonical_origin: "import",
      canonical_source_ref: "cype_2026",
    }),
    // provider SIN source_ref: procedencia inutilizable, debe degradarse a (null, null)
    fila("Contenedor y transporte a gestor autorizado", 6, "ud", 717.5, 4305.0, {
      canonical_origin: "provider",
      canonical_source_ref: null,
    }),
  ];
}

const IVA = 21;

/** Todo lo que NO es canónico. Es lo que tiene que salir intacto, valor por valor. */
function vistaEconomica(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (CANONICAL_COLUMN_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

async function clasificar(overrides = {}) {
  const { client, stats } = fakeSupabase(DB);
  const items = overrides.items ?? presupuesto();
  const result = await classifyForPersistence({
    items,
    companyId: EMPRESA,
    supabase: client,
    ...overrides.options,
  });
  return { ...result, stats, entrada: items };
}

/**
 * Réplica en JS de las dos restricciones reales de la tabla, tal y como quedaron tras
 * la migración 20260825094545. Se comprueban aquí porque el fail-open escribe filas de
 * verdad: si construyera una pareja (origin, source_ref) prohibida, el rechazo no
 * llegaría hasta Postgres, es decir, hasta producción.
 */
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
// BLOQUE A — Equivalencia económica (casos 1, 2, 3, 4, 19, 20, 21)
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-3 · el cable no toca el dinero", () => {
  test("CASO 1 — antes y después son idénticos salvo las siete columnas canónicas", async () => {
    const entrada = presupuesto();
    const copia = JSON.parse(JSON.stringify(entrada));

    const { items } = await clasificar({ items: entrada });

    assert.deepEqual(
      items.map(vistaEconomica),
      copia.map(vistaEconomica),
      "alguna clave no canónica cambió al atravesar el cable"
    );
    assert.deepEqual(entrada, copia, "el cable mutó el array de entrada en vez de copiarlo");
  });

  test("CASO 2 — misma longitud", async () => {
    const { items, entrada } = await clasificar();
    assert.equal(items.length, entrada.length);
    assert.equal(items.length, 7);
  });

  test("CASO 3 — mismo orden", async () => {
    const { items, entrada } = await clasificar();
    assert.deepEqual(
      items.map((i) => i.concept),
      entrada.map((i) => i.concept),
      "el orden de las partidas es el del documento; reordenar cambia el presupuesto"
    );
  });

  test("CASO 4 — sólo aparecen las siete claves canónicas, ni una más", async () => {
    const entrada = presupuesto();
    const { items } = await clasificar({ items: entrada });

    for (let i = 0; i < items.length; i += 1) {
      const antes = new Set(Object.keys(entrada[i]));
      const nuevas = Object.keys(items[i]).filter((k) => !antes.has(k));
      for (const k of nuevas) {
        assert.ok(
          CANONICAL_COLUMN_KEYS.includes(k),
          `la línea ${i} ganó la clave '${k}', que no es canónica y no existe en budget_items`
        );
      }
      // Y ninguna clave desaparece.
      for (const k of antes) {
        assert.ok(k in items[i], `la línea ${i} perdió la clave '${k}'`);
      }
    }
  });

  test("CASO 19 — ninguna cantidad, precio unitario ni subtotal cambia", async () => {
    const entrada = presupuesto();
    const { items } = await clasificar({ items: entrada });

    for (let i = 0; i < items.length; i += 1) {
      assert.equal(items[i].quantity, entrada[i].quantity, `quantity línea ${i}`);
      assert.equal(items[i].unit_price, entrada[i].unit_price, `unit_price línea ${i}`);
      assert.equal(items[i].subtotal, entrada[i].subtotal, `subtotal línea ${i}`);
      assert.equal(items[i].unit, entrada[i].unit, `unit línea ${i}`);
    }
  });

  test("CASO 20 — subtotal, IVA y total son idénticos antes y después", async () => {
    const entrada = presupuesto();
    const { items } = await clasificar({ items: entrada });

    const antes = computeBudgetTotals({ lines: entrada });
    const despues = computeBudgetTotals({ lines: items });
    assert.deepEqual(despues, antes, "la base imponible recalculada cambió");

    const finAntes = computeBudgetTotalsFromSubtotal(antes.subtotal, IVA, "none", 0, 0);
    const finDespues = computeBudgetTotalsFromSubtotal(despues.subtotal, IVA, "none", 0, 0);
    assert.deepEqual(finDespues, finAntes, "IVA o total cambiaron");
    assert.equal(finDespues.ivaAmount, finAntes.ivaAmount);
    assert.equal(finDespues.total, finAntes.total);
  });

  test("CASO 21 — no añade ni elimina partidas, tampoco en los bordes", async () => {
    // Lote vacío: ni una línea, ni una consulta.
    const vacio = await clasificar({ items: [] });
    assert.equal(vacio.items.length, 0);
    assert.equal(vacio.stats.queryCount, 0, "un presupuesto sin líneas no debe consultar nada");
    assert.equal(vacio.report.snapshotLoads, 0);

    // Líneas repetidas: la deduplicación interna es de CONSULTAS, no de filas.
    const repetida = fila("Pintura plástica en paredes", 58, "m2", 15.64, 906.89, {
      canonical_origin: "ai",
    });
    const conDuplicados = await clasificar({ items: [repetida, { ...repetida }, { ...repetida }] });
    assert.equal(conDuplicados.items.length, 3, "deduplicar consultas no puede deduplicar líneas");
    assert.equal(conDuplicados.report.resolved, 3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE B — Procedencia y estados (casos 5, 6, 7, 8, 9, 10, 11)
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-3 · lo que se persiste en las siete columnas", () => {
  test("CASO 5 — una línea 'ai' se persiste como 'ai'", async () => {
    const { items } = await clasificar();
    // La primera resuelve, la quinta no. Las dos nacieron del modelo, y el estado de
    // la clasificación no puede alterar la procedencia: son dimensiones distintas.
    assert.equal(items[0].canonical_origin, "ai");
    assert.equal(items[0].canonical_status, "resolved");
    assert.equal(items[4].canonical_origin, "ai");
    assert.equal(items[4].canonical_status, "unmatched");
  });

  test("CASO 6 — una línea 'engine' se persiste como 'engine'", async () => {
    const { items } = await clasificar();
    assert.equal(items[1].canonical_origin, "engine");
    assert.equal(items[1].canonical_source_ref, null);
  });

  test("CASO 7 — una línea 'free_text' se persiste como 'free_text'", async () => {
    const { items } = await clasificar();
    assert.equal(items[2].canonical_origin, "free_text");
    assert.equal(items[3].canonical_origin, "free_text");
  });

  test("CASO 8 — 'resolved' persiste canonical_id, confidence y source", async () => {
    const { items } = await clasificar();

    assert.equal(items[0].canonical_status, "resolved");
    assert.equal(items[0].canonical_id, PAINT_WALL);
    assert.equal(items[0].canonical_confidence, 1);
    assert.equal(items[0].canonical_source, "exact_curated");
    // Dos allowed_price_types: no hay dato firme que escribir.
    assert.equal(items[0].price_type, null);

    // Un único allowed_price_type sí produce price_type.
    assert.equal(items[1].canonical_status, "resolved");
    assert.equal(items[1].canonical_id, PAINT_MAT);
    assert.equal(items[1].price_type, "MATERIAL_ONLY");

    // Y una línea 'import' con instancia documental válida conserva las dos cosas.
    assert.equal(items[5].canonical_status, "resolved");
    assert.equal(items[5].canonical_id, PRIMER);
    assert.equal(items[5].canonical_origin, "import");
    assert.equal(items[5].canonical_source_ref, "cype_2026");
  });

  test("CASO 9 — 'review' persiste price_type = null", async () => {
    const { items } = await clasificar();
    assert.equal(items[2].canonical_status, "review");
    assert.equal(items[2].canonical_id, PAINT_MAT);
    assert.equal(items[2].canonical_confidence, 0.7);
    assert.equal(items[2].canonical_source, "synonym");
    assert.equal(
      items[2].price_type,
      null,
      "un vínculo en revisión es una hipótesis: no puede escribir un dato firme"
    );
  });

  test("CASO 10 — 'ambiguous' persiste canonical_id = null", async () => {
    const { items } = await clasificar();
    assert.equal(items[3].canonical_status, "ambiguous");
    assert.equal(items[3].canonical_id, null);
    assert.equal(items[3].canonical_confidence, null);
    assert.equal(items[3].price_type, null);
  });

  test("CASO 11 — 'unmatched' persiste los nulos correctos y conserva la procedencia", async () => {
    const { items } = await clasificar();
    const l = items[4];
    assert.equal(l.canonical_status, "unmatched");
    assert.equal(l.canonical_id, null);
    assert.equal(l.canonical_confidence, null);
    assert.equal(l.canonical_source, null);
    assert.equal(l.price_type, null);
    assert.equal(l.canonical_origin, "ai", "no encontrar concepto no borra dónde nació la línea");
    assert.equal(l.canonical_source_ref, null);

    // 'provider' sin source_ref es una procedencia INUTILIZABLE, no un adorno: se
    // degrada entera a (null, null) porque ck_origin_source_ref rechazaría la fila.
    const sinRef = items[6];
    assert.equal(sinRef.canonical_origin, null);
    assert.equal(sinRef.canonical_source_ref, null);
    assert.equal(sinRef.canonical_status, "unmatched");
  });

  test("todas las filas resultantes satisfacen las dos restricciones reales", async () => {
    const { items } = await clasificar();
    items.forEach((row, i) => assertRestriccionesDeProcedencia(row, `camino normal, línea ${i}`));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE C — Coste de I/O (casos 12, 13)
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-3 · una carga y ni una consulta más", () => {
  test("CASO 12 — el snapshot se carga UNA sola vez por finalización", async () => {
    const { client } = fakeSupabase(DB);
    let cargas = 0;
    const loader = (opts) => {
      cargas += 1;
      return loadCanonicalRegistrySnapshot(opts);
    };

    const { report } = await classifyForPersistence({
      items: presupuesto(),
      companyId: EMPRESA,
      supabase: client,
      loadSnapshot: loader,
    });

    assert.equal(cargas, 1, "siete partidas no pueden costar siete cargas de vocabulario");
    assert.equal(report.snapshotLoads, 1);
    assert.ok(report.snapshotQueries > 0, "el informe debe declarar lo que costó");
  });

  test("CASO 13 — durante la clasificación posterior se hacen 0 consultas", async () => {
    const { client, stats } = fakeSupabase(DB);

    let alTerminarLaCarga = null;
    const loader = async (opts) => {
      const snap = await loadCanonicalRegistrySnapshot(opts);
      alTerminarLaCarga = stats.queryCount;
      return snap;
    };

    const { report } = await classifyForPersistence({
      items: presupuesto(),
      companyId: EMPRESA,
      supabase: client,
      loadSnapshot: loader,
    });

    assert.notEqual(alTerminarLaCarga, null, "el loader no llegó a ejecutarse");
    assert.equal(
      stats.queryCount - alTerminarLaCarga,
      0,
      "la clasificación volvió a la red; el registry del snapshot debe ser de memoria"
    );
    assert.equal(
      report.snapshotQueries,
      alTerminarLaCarga,
      "el coste declarado y el real deben ser el mismo número"
    );
    // Coste de ESTE fixture, no garantía general. Lo que el snapshot promete es
    // O(fragmentos de evidencia DISTINTA), no O(partidas) y tampoco una constante:
    // las evidencias se trocean de 200 en 200, así que un presupuesto con más
    // alias_norm, source_ref o canonical_id distintos costará legítimamente más
    // tandas. Con estas siete líneas caben todas en una: 1 consulta de procedencias
    // + 1 tanda de aliases (7 alias_norm distintos y 1 source_ref) + 1 tanda de
    // conceptos (4 canonical_id distintos) = 3.
    //
    // Se fija el número exacto y no un "menor que siete", que seguiría pasando si
    // mañana costase seis. Lo que este número vigila es que el coste no empiece a
    // crecer con las partidas; si un cambio legítimo del loader lo mueve, hay que
    // recalcularlo a mano y entender por qué, no relajarlo.
    assert.equal(
      stats.queryCount,
      3,
      `siete partidas costaron ${stats.queryCount} consultas; para este fixture son 3`
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE D — Fail-open (casos 14, 15, 16, 17)
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-3 · el sistema canónico no puede impedir finalizar", () => {
  test("CASO 14 — si el snapshot falla, la finalización continúa", async () => {
    const { client } = fakeSupabase(DB, {
      failures: { canonical_aliases: "connection terminated unexpectedly" },
    });

    const entrada = presupuesto();
    const { items, report } = await classifyForPersistence({
      items: entrada,
      companyId: EMPRESA,
      supabase: client,
    });

    assert.equal(items.length, entrada.length, "no se pierde ninguna partida");
    assert.equal(report.degraded, "snapshot");
    assert.equal(report.unmatched, entrada.length);
    assert.equal(report.snapshotLoads, 0);
    assert.deepEqual(items.map(vistaEconomica), entrada.map(vistaEconomica));
    for (const l of items) assert.equal(l.canonical_status, "unmatched");
  });

  test("CASO 15 — si el clasificador lanza, la finalización continúa", async () => {
    const { client } = fakeSupabase(DB);
    const entrada = presupuesto();

    const { items, report } = await classifyForPersistence({
      items: entrada,
      companyId: EMPRESA,
      supabase: client,
      classify: async () => {
        throw new TypeError("defecto imprevisto dentro de la clasificación");
      },
    });

    assert.equal(items.length, entrada.length);
    assert.equal(report.degraded, "classifier");
    assert.equal(report.failureKind, "TypeError");
    assert.deepEqual(items.map(vistaEconomica), entrada.map(vistaEconomica));
  });

  test("CASO 16 — el fail-open conserva la procedencia verdadera", async () => {
    const { client } = fakeSupabase(DB, {
      failures: { canonical_alias_sources: "permission denied for table" },
    });

    const { items } = await classifyForPersistence({
      items: presupuesto(),
      companyId: EMPRESA,
      supabase: client,
    });

    // Que Supabase no responda no desmiente dónde nació la línea.
    assert.equal(items[0].canonical_origin, "ai");
    assert.equal(items[1].canonical_origin, "engine");
    assert.equal(items[2].canonical_origin, "free_text");
    assert.equal(items[5].canonical_origin, "import");
    assert.equal(items[5].canonical_source_ref, "cype_2026");
    // Y la que era inutilizable sigue siéndolo: degradar mal en el fallback sería
    // escribir una fila que la tabla rechaza justo cuando ya hay una avería.
    assert.equal(items[6].canonical_origin, null);
  });

  test("CASO 17 — ninguna fila del fail-open viola ck_origin_source_ref", async () => {
    const escenarios = [
      { nombre: "falla canonical_alias_sources", failures: { canonical_alias_sources: "x" } },
      { nombre: "falla canonical_aliases", failures: { canonical_aliases: "x" } },
      { nombre: "falla canonical_concepts", failures: { canonical_concepts: "x" } },
    ];

    for (const esc of escenarios) {
      const { client } = fakeSupabase(DB, { failures: esc.failures });
      const { items, report } = await classifyForPersistence({
        items: presupuesto(),
        companyId: EMPRESA,
        supabase: client,
      });
      assert.equal(items.length, 7, esc.nombre);
      assert.notEqual(report.degraded, null, `${esc.nombre}: debería haberse degradado`);
      items.forEach((row, i) => assertRestriccionesDeProcedencia(row, `${esc.nombre}, línea ${i}`));
    }

    // Y también el camino del clasificador roto.
    const { client } = fakeSupabase(DB);
    const { items } = await classifyForPersistence({
      items: presupuesto(),
      companyId: EMPRESA,
      supabase: client,
      classify: async () => {
        throw new Error("boom");
      },
    });
    items.forEach((row, i) => assertRestriccionesDeProcedencia(row, `classifier roto, línea ${i}`));
  });

  test("el informe es sólo de contadores: no puede reconstruir el presupuesto", async () => {
    const { client } = fakeSupabase(DB, { failures: { canonical_aliases: "x" } });
    const { report } = await classifyForPersistence({
      items: presupuesto(),
      companyId: EMPRESA,
      supabase: client,
    });

    const serializado = JSON.stringify(report);
    for (const l of presupuesto()) {
      assert.ok(!serializado.includes(l.concept), "el informe cita el texto de una partida");
      assert.ok(
        !serializado.includes(String(l.unit_price)),
        "el informe cita un precio"
      );
    }
    assert.ok(!serializado.includes(EMPRESA), "el informe cita el identificador de tenant");
    for (const v of Object.values(report)) {
      assert.ok(
        typeof v === "number" || v === null || typeof v === "string",
        "el informe sólo admite escalares"
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE E — La puerta de cuadre (caso 18 + CONTROL NEGATIVO)
// ══════════════════════════════════════════════════════════════════════════════

/** Réplica exacta de la puerta que usa finalizeBudget. */
function assertPersistedTotalsMatch(lines, displayedSubtotal, context) {
  const recomputed = computeBudgetTotals({ lines });
  assertBudgetTotalsConsistent(displayedSubtotal, recomputed, context);
  return recomputed;
}

describe("2D-3 · la puerta de cuadre corre después del enriquecimiento", () => {
  test("CASO 18 — assertPersistedTotalsMatch sigue pasando sobre las líneas enriquecidas", async () => {
    const entrada = presupuesto();
    const subtotalMostrado = computeBudgetTotals({ lines: entrada }).subtotal;

    const { items } = await clasificar({ items: entrada });

    assert.doesNotThrow(() =>
      assertPersistedTotalsMatch(items, subtotalMostrado, "finalizeBudget")
    );
    assert.equal(
      assertPersistedTotalsMatch(items, subtotalMostrado, "finalizeBudget").subtotal,
      subtotalMostrado
    );
  });

  test("la puerta sigue siendo capaz de detener un descuadre: control de sensibilidad", () => {
    // La puerta se queda DETRÁS de la guarda como última barrera, así que conviene
    // demostrar que sigue viva: si `assertBudgetTotalsConsistent` dejase de detectar
    // un céntimo, los casos de abajo pasarían por el motivo equivocado —"nada falla"
    // en vez de "la guarda lo arregló"— y no nos enteraríamos.
    const lineas = presupuesto();
    const subtotalMostrado = computeBudgetTotals({ lines: lineas }).subtotal;
    const manipuladas = lineas.map((l, i) =>
      i === 0 ? { ...l, unit_price: l.unit_price + 0.01, subtotal: l.subtotal + 0.58 } : l
    );
    assert.throws(
      () => assertPersistedTotalsMatch(manipuladas, subtotalMostrado, "finalizeBudget"),
      /BUDGET_TOTAL_MISMATCH|no cuadr|mismatch/i,
      "la puerta dejó pasar un presupuesto cuyas líneas ya no suman lo que se mostró"
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE E-bis — La guarda de integridad económica
//
// El sistema canónico OBSERVA. La consecuencia incómoda de esa frase es que ni
// siquiera puede bloquear cuando el averiado es él mismo: un clasificador que
// devuelve líneas distintas de las que recibió tiene que producir una clasificación
// PEOR, jamás un presupuesto económico distinto y jamás una finalización abortada.
//
// De ahí que la reacción correcta no sea dejar que el destrozo llegue a la puerta de
// cuadre —eso sería bloquear— sino detectarlo dentro del orquestador, tirar la
// clasificación entera y devolver las líneas originales con metadatos seguros.
//
// Estos controles saboteen lo que saboteen esperan siempre lo mismo:
//   degraded = "economic_integrity" · líneas originales · misma cantidad y orden ·
//   todo `unmatched` · procedencia conservada · la puerta pasa.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * El esqueleto de los seis controles. Recibe un sabotaje que recibe la salida legítima
 * del clasificador y devuelve la salida corrompida, y comprueba el contrato entero.
 */
async function sabotaje(nombre, corromper) {
  const entrada = presupuesto();
  const testigo = JSON.parse(JSON.stringify(entrada));
  const subtotalMostrado = computeBudgetTotals({ lines: entrada }).subtotal;
  const { client } = fakeSupabase(DB);

  const { items, report } = await classifyForPersistence({
    items: entrada,
    companyId: EMPRESA,
    supabase: client,
    classify: async (lines, registry, options) => {
      const out = await classifyBudgetItems(lines, registry, options);
      return corromper(out);
    },
  });

  // 1. Se detectó, y se detectó como lo que es.
  assert.equal(report.degraded, "economic_integrity", `${nombre}: la guarda no lo vio`);
  assert.ok(
    typeof report.failureKind === "string" && report.failureKind.length > 0,
    `${nombre}: la guarda no dijo qué se rompió`
  );
  // La etiqueta nombra columnas, nunca valores.
  for (const l of testigo) {
    assert.ok(
      !report.failureKind.includes(String(l.unit_price)),
      `${nombre}: la etiqueta de la avería cita un importe`
    );
  }

  // 2. Lo que sale es el presupuesto ORIGINAL: mismo número, mismo orden, mismos
  //    valores en toda clave no canónica.
  assert.equal(items.length, testigo.length, `${nombre}: cambió el número de líneas`);
  assert.deepEqual(
    items.map(vistaEconomica),
    testigo.map(vistaEconomica),
    `${nombre}: el presupuesto persistido ya no es el que se aprobó`
  );

  // 3. Metadatos seguros, y procedencia conservada: una avería de lectura no desmiente
  //    dónde nació una línea.
  for (const [i, row] of items.entries()) {
    assert.equal(row.canonical_status, "unmatched", `${nombre}: línea ${i}`);
    assert.equal(row.canonical_id, null, `${nombre}: línea ${i}`);
    assert.equal(row.canonical_confidence, null, `${nombre}: línea ${i}`);
    assert.equal(row.canonical_source, null, `${nombre}: línea ${i}`);
    assert.equal(row.price_type, null, `${nombre}: línea ${i}`);
    assertRestriccionesDeProcedencia(row, `${nombre}, línea ${i}`);
  }
  assert.equal(items[0].canonical_origin, "ai");
  assert.equal(items[1].canonical_origin, "engine");
  assert.equal(items[5].canonical_origin, "import");
  assert.equal(items[5].canonical_source_ref, "cype_2026");
  assert.equal(report.unmatched, testigo.length);

  // 4. Y por tanto la puerta pasa: finalizeBudget puede continuar.
  assert.doesNotThrow(
    () => assertPersistedTotalsMatch(items, subtotalMostrado, "finalizeBudget"),
    `${nombre}: una avería del observador bloqueó la finalización`
  );

  return { items, report, testigo, subtotalMostrado };
}

describe("2D-3 · un clasificador corrupto degrada, nunca bloquea", () => {
  test("CONTROL NEGATIVO — el clasificador sube un céntimo un unit_price", async () => {
    const { items, report, testigo, subtotalMostrado } = await sabotaje(
      "unit_price +0.01",
      (out) => {
        out.lines[0].unit_price = out.lines[0].unit_price + 0.01;
        return out;
      }
    );

    // Lo específico de este control: el céntimo NO llegó a la salida. Antes este test
    // demostraba que la puerta de cuadre reventaba; eso contradecía el fail-open, así
    // que ahora demuestra lo contrario: el precio vuelve a ser el original.
    assert.equal(report.failureKind, "value:unit_price");
    assert.equal(items[0].unit_price, testigo[0].unit_price, "el céntimo llegó a persistirse");
    assert.equal(items[0].subtotal, testigo[0].subtotal);
    assert.equal(
      assertPersistedTotalsMatch(items, subtotalMostrado, "finalizeBudget").subtotal,
      subtotalMostrado
    );
  });

  test("el clasificador ELIMINA una línea", async () => {
    const { report } = await sabotaje("drop", (out) => {
      out.lines.splice(3, 1);
      return out;
    });
    assert.equal(report.failureKind, "line_count");
  });

  test("el clasificador AÑADE una línea", async () => {
    const { report } = await sabotaje("add", (out) => {
      out.lines.push({ ...out.lines[0] });
      return out;
    });
    assert.equal(report.failureKind, "line_count");
  });

  test("el clasificador REORDENA las líneas", async () => {
    // Mismo número de líneas y mismo total: una permutación no altera ninguna suma.
    // Es justo el caso que un control basado sólo en el importe dejaría pasar, y sin
    // embargo cambia el documento que firma el cliente.
    const { report } = await sabotaje("reorder", (out) => {
      const t = out.lines[0];
      out.lines[0] = out.lines[1];
      out.lines[1] = t;
      return out;
    });
    assert.ok(
      report.failureKind.startsWith("value:"),
      `una permutación debe aparecer como diferencia de valor, no como '${report.failureKind}'`
    );
  });

  test("el clasificador modifica una quantity", async () => {
    const { report, items, testigo } = await sabotaje("quantity", (out) => {
      out.lines[2].quantity = out.lines[2].quantity + 1;
      return out;
    });
    assert.equal(report.failureKind, "value:quantity");
    assert.equal(items[2].quantity, testigo[2].quantity);
  });

  test("el clasificador modifica un chapter (campo no canónico sin efecto en ninguna suma)", async () => {
    // Cero impacto en el subtotal. La puerta de cuadre no lo vería NUNCA, ni antes ni
    // ahora: por eso la guarda compara clave a clave y no importe a importe.
    const { report, items, testigo } = await sabotaje("chapter", (out) => {
      out.lines[4].chapter = "albanileria";
      return out;
    });
    assert.equal(report.failureKind, "value:chapter");
    assert.equal(items[4].chapter, testigo[4].chapter);
  });

  test("el clasificador borra una clave no canónica", async () => {
    const { report, items } = await sabotaje("delete key", (out) => {
      delete out.lines[1].description;
      return out;
    });
    assert.equal(report.failureKind, "missing_key:description");
    assert.ok("description" in items[1]);
  });

  test("el clasificador inventa una columna que la tabla no tiene", async () => {
    // Un `extra_key` no cambia ningún importe pero hace fallar el INSERT entero con
    // PGRST204. Degradar es preferible a que el presupuesto no se pueda guardar.
    const { report, items } = await sabotaje("extra key", (out) => {
      out.lines[0].columna_inventada = 1;
      return out;
    });
    assert.equal(report.failureKind, "extra_key:columna_inventada");
    assert.ok(!("columna_inventada" in items[0]));
  });

  test("un clasificador que MUTA sus propias entradas no engaña a la guarda", async () => {
    // El caso que obliga a que la guarda compare contra una copia y no contra el array
    // recibido: si mutase los objetos de entrada, salida y referencia se corromperían a
    // la vez y coincidirían perfectamente. La foto se toma antes de entregar nada.
    const entrada = presupuesto();
    const testigo = JSON.parse(JSON.stringify(entrada));
    const { client } = fakeSupabase(DB);

    const { items, report } = await classifyForPersistence({
      items: entrada,
      companyId: EMPRESA,
      supabase: client,
      classify: async (lines, registry, options) => {
        const out = await classifyBudgetItems(lines, registry, options);
        // Se ensucia el array ORIGINAL, no sólo la salida.
        lines[0].unit_price = 0.01;
        out.lines[0].unit_price = 0.01;
        return out;
      },
    });

    assert.equal(report.degraded, "economic_integrity");
    assert.equal(
      items[0].unit_price,
      testigo[0].unit_price,
      "la guarda comparó contra algo que el clasificador podía tocar"
    );
    assert.deepEqual(items.map(vistaEconomica), testigo.map(vistaEconomica));
  });

  test("una clasificación honrada NO se degrada: la guarda no es un rechazo de todo", async () => {
    // Control de sensibilidad al revés. Sin él, una guarda rota que degradase siempre
    // haría pasar los ocho casos de arriba.
    const { report } = await clasificar();
    assert.equal(report.degraded, null);
    assert.ok(report.resolved > 0, "el camino feliz dejó de clasificar nada");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE E-ter — Observabilidad del contexto de empresa
//
// Que auth falle no degrada la clasificación: sin `company_id` se consulta sólo el
// vocabulario global, que es SEGURO —jamás puede devolver aliases de otra empresa— y
// desde luego no es motivo para impedir finalizar. Lo que sí cambia es lo que el
// informe puede afirmar: sin esta distinción, una caída de auth produce un log
// indistinguible del de una clasificación perfectamente normal, y lo que se pierde en
// silencio es toda la curación manual que la empresa haya hecho.
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-3 · perder el tenant no bloquea, pero se nota en el informe", () => {
  test("con tenant resuelto el informe lo declara resuelto", async () => {
    const { report } = await clasificar();
    assert.equal(report.tenant_context, "resolved");
    assert.equal(report.tenantFailureKind, null);
  });

  test("un null legítimo de tenant NO se marca como avería", async () => {
    // Sólo quien resolvió el tenant sabe distinguir los dos casos. Marcar de oficio
    // como averiado todo `companyId` nulo llenaría el log de ruido.
    const { client } = fakeSupabase(DB);
    const { report } = await classifyForPersistence({
      items: presupuesto(),
      companyId: null,
      supabase: client,
    });
    assert.equal(report.tenant_context, "resolved");
    assert.equal(report.tenantFailureKind, null);
    assert.equal(report.degraded, null, "sin tenant se clasifica igual, contra los globales");
  });

  test("si auth falló, el informe lo dice y la clasificación continúa contra los globales", async () => {
    const { client } = fakeSupabase(DB);
    const entrada = presupuesto();
    const { items, report } = await classifyForPersistence({
      items: entrada,
      companyId: null,
      supabase: client,
      tenantContext: "unavailable",
      tenantFailure: new TypeError("fetch failed"),
    });

    assert.equal(report.tenant_context, "unavailable");
    assert.equal(report.tenantFailureKind, "TypeError");
    // Y lo importante: NO se degrada nada más. Usar globales es seguro.
    assert.equal(report.degraded, null, "una caída de auth no puede degradar la clasificación");
    assert.ok(report.resolved > 0, "los alias globales debían seguir resolviendo");
    assert.equal(items.length, entrada.length);
    assert.deepEqual(items.map(vistaEconomica), entrada.map(vistaEconomica));
  });

  test("el código de una sesión ausente se registra como tal", async () => {
    const { client } = fakeSupabase(DB);
    const { report } = await classifyForPersistence({
      items: presupuesto(),
      companyId: null,
      supabase: client,
      tenantContext: "unavailable",
      tenantFailure: { code: "no_session" },
    });
    assert.equal(report.tenant_context, "unavailable");
    assert.equal(report.tenantFailureKind, "code:no_session");
  });

  test("la etiqueta de auth no filtra nada sensible", async () => {
    // Los mensajes de Supabase citan valores; los nombres y códigos no. El informe
    // acaba en un log, y un log de presupuestos no debe poder reconstruir nada.
    const { client } = fakeSupabase(DB);
    const fuga = `JWT del usuario ${EMPRESA} expirado`;
    const err = new Error(fuga);
    err.name = "AuthApiError";

    const { report } = await classifyForPersistence({
      items: presupuesto(),
      companyId: null,
      supabase: client,
      tenantContext: "unavailable",
      tenantFailure: err,
    });

    assert.equal(report.tenantFailureKind, "AuthApiError");
    const serializado = JSON.stringify(report);
    assert.ok(!serializado.includes(EMPRESA), "el informe filtró el identificador de tenant");
    assert.ok(!serializado.includes(fuga), "el informe filtró el mensaje del error de auth");
  });

  test("el tenant se declara también por los caminos degradados", async () => {
    // Si el informe perdiese `tenant_context` justo cuando algo se rompe, faltaría
    // precisamente donde más se necesita para diagnosticar.
    const { client } = fakeSupabase(DB, { failures: { canonical_aliases: "x" } });
    const { report } = await classifyForPersistence({
      items: presupuesto(),
      companyId: null,
      supabase: client,
      tenantContext: "unavailable",
      tenantFailure: { code: "no_session" },
    });
    assert.equal(report.degraded, "snapshot");
    assert.equal(report.tenant_context, "unavailable");
    assert.equal(report.tenantFailureKind, "code:no_session");
  });

  test("el envoltorio traslada el tenant entero al orquestador", async () => {
    // Desde 2D-4 el provider ya no desmonta el tenant campo a campo: le pasa el objeto
    // `ResolvedTenant` a `enrichForPersistence`, que es quien lo despliega. El contrato
    // es MÁS estricto que antes —ya no es posible mandar un `companyId` olvidándose de
    // declarar el `tenantContext` que lo acompaña— y además es comprobable de verdad,
    // porque el envoltorio sí se puede importar aquí.
    const err = new Error("jwt expired");
    err.name = "AuthApiError";
    const { client } = fakeSupabase(DB);

    const { report } = await enrichForPersistence({
      items: presupuesto(),
      tenant: resolveTenant({ data: { user: { id: EMPRESA } }, error: err }),
      supabase: client,
      context: "finalizeBudget",
      log: () => {},
    });

    assert.equal(report.tenant_context, "unavailable");
    assert.equal(report.tenantFailureKind, "AuthApiError");
  });

  test("el provider resuelve el tenant antes de clasificar", () => {
    // Comprobación de cableado, no de comportamiento: el provider es un componente de
    // React que no puede importarse aquí. El comportamiento se prueba arriba y, para
    // las cuatro ramas de auth, en el bloque siguiente sobre `resolveTenant`.
    assert.match(providerSrc, /tenant:\s*canonicalTenant/);
    assert.match(providerSrc, /resolveTenant\(await supabase\.auth\.getUser\(\)\)/);
    assert.match(providerSrc, /canonicalTenant = resolveTenant\(\{ error: authErr \}\)/);
    // Y que no queda ningún camino que lea el id por su cuenta saltándose la decisión.
    // Esa lectura suelta es justo la que tenía el fallo.
    assert.ok(
      !/canonicalUser\?\.id/.test(providerSrc),
      "el provider vuelve a leer user.id directamente, esquivando resolveTenant"
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE E-quater — Las cuatro ramas de `resolveTenant`
//
// La rama peligrosa es la primera. Si `getUser()` devuelve `error`, lo que venga en
// `data.user` no es una identidad verificada: puede ser una sesión caducada que la
// librería no llegó a validar. Ese `id` entra directamente en el filtro `company_id`
// del snapshot, así que adoptarlo no produciría una clasificación peor sino una
// lectura de evidencia privada bajo una identidad de la que acabamos de enterarnos de
// que no podemos afirmar quién es.
// ══════════════════════════════════════════════════════════════════════════════

const COMPANY_A = EMPRESA;

describe("2D-3 · un error de auth nunca deja pasar un company_id", () => {
  test("error CON user poblado: el id se descarta", () => {
    // La respuesta artificial que describe el borde: las dos cosas a la vez.
    const err = new Error("JWT expired");
    err.name = "AuthApiError";
    const t = resolveTenant({ data: { user: { id: COMPANY_A } }, error: err });

    assert.equal(t.companyId, null, "se adoptó como tenant un usuario no verificado");
    assert.equal(t.tenantContext, "unavailable");
    assert.equal(t.tenantFailure, err);
  });

  test("sin user y sin error: no_session", () => {
    const t = resolveTenant({ data: { user: null } });
    assert.equal(t.companyId, null);
    assert.equal(t.tenantContext, "unavailable");
    assert.deepEqual(t.tenantFailure, { code: "no_session" });

    // Y las formas degeneradas que la librería puede devolver.
    const degeneradas = [{}, { data: null }, { data: { user: {} } }, { data: { user: { id: "" } } }];
    for (const respuesta of degeneradas) {
      const r = resolveTenant(respuesta);
      assert.equal(r.companyId, null, JSON.stringify(respuesta));
      assert.equal(r.tenantContext, "unavailable", JSON.stringify(respuesta));
    }
  });

  test("user válido sin error: resolved", () => {
    const t = resolveTenant({ data: { user: { id: COMPANY_A } }, error: null });
    assert.equal(t.companyId, COMPANY_A);
    assert.equal(t.tenantContext, "resolved");
    assert.equal(t.tenantFailure, undefined);
  });

  test("excepción: se traduce a la rama de error", () => {
    const boom = new TypeError("fetch failed");
    const t = resolveTenant({ error: boom });
    assert.equal(t.companyId, null);
    assert.equal(t.tenantContext, "unavailable");
    assert.equal(t.tenantFailure, boom);
  });

  test("el snapshot recibe companyId null, y el informe lo declara, sin filtrar nada", async () => {
    // El recorrido entero con la respuesta artificial: se observa qué `companyId` llega
    // de verdad al loader, que es donde se convierte en el filtro de la consulta.
    const err = new Error(`JWT del usuario ${COMPANY_A} expirado`);
    err.name = "AuthApiError";
    const tenant = resolveTenant({ data: { user: { id: COMPANY_A } }, error: err });

    const { client } = fakeSupabase(DB);
    let companyIdVisto = "sin observar";
    const entrada = presupuesto();

    const { items, report } = await classifyForPersistence({
      items: entrada,
      companyId: tenant.companyId,
      supabase: client,
      tenantContext: tenant.tenantContext,
      tenantFailure: tenant.tenantFailure,
      loadSnapshot: (opts) => {
        companyIdVisto = opts.companyId;
        return loadCanonicalRegistrySnapshot(opts);
      },
    });

    assert.equal(companyIdVisto, null, "el snapshot se filtró por un tenant no verificado");
    assert.equal(report.tenant_context, "unavailable");
    assert.equal(report.tenantFailureKind, "AuthApiError");

    // Ni el id ni el mensaje asoman por el informe.
    const serializado = JSON.stringify(report);
    assert.ok(!serializado.includes(COMPANY_A), "el informe filtró user.id");
    assert.ok(!serializado.includes("JWT"), "el informe filtró el mensaje del error de auth");
    assert.ok(!serializado.includes("expirado"), "el informe filtró el mensaje del error de auth");

    // Y, como siempre: no se bloquea nada. Sólo globales es una clasificación peor, no
    // una incorrecta, y el presupuesto sale intacto.
    assert.equal(report.degraded, null);
    assert.equal(items.length, entrada.length);
    assert.deepEqual(items.map(vistaEconomica), entrada.map(vistaEconomica));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE F — Convivencia con saveDraft (caso 22)
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-3 · lo que queda tras finalizar es el INSERT clasificado", () => {
  test("CASO 22a — DELETE + INSERT deja únicamente las filas clasificadas", async () => {
    // Tabla en memoria que se comporta como budget_items respecto a este flujo.
    const tabla = [];
    const db = {
      insert: (rows) => tabla.push(...rows.map((r) => ({ ...r }))),
      deleteByBudget: (id) => {
        for (let i = tabla.length - 1; i >= 0; i -= 1) {
          if (tabla[i].budget_id === id) tabla.splice(i, 1);
        }
      },
    };

    const entrada = presupuesto();

    // 1) saveDraft(false): escribe filas SIN clasificar, como hoy.
    db.insert(entrada.map(({ canonical_origin, canonical_source_ref, ...eco }) => eco));
    assert.equal(tabla.length, 7);
    assert.ok(
      tabla.every((r) => r.canonical_status === undefined),
      "el borrador no lleva clasificación: es la premisa del caso"
    );

    // 2) finalizeBudget: borra y vuelve a insertar, ya clasificado.
    db.deleteByBudget(PRESUPUESTO_ID);
    assert.equal(tabla.length, 0, "el DELETE debe llevarse TODAS las filas del borrador");

    const { items } = await clasificar({ items: entrada });
    db.insert(items);

    assert.equal(tabla.length, 7, "ni una fila de más: no conviven borrador y definitivo");
    assert.ok(
      tabla.every((r) => r.canonical_status !== undefined),
      "sobrevivió alguna fila del borrador sin clasificar"
    );
    assert.deepEqual(
      tabla.map((r) => r.canonical_status),
      ["resolved", "resolved", "review", "ambiguous", "unmatched", "resolved", "unmatched"]
    );
    // Y el dinero de lo que queda es el del presupuesto mostrado.
    assert.equal(
      computeBudgetTotals({ lines: tabla }).subtotal,
      computeBudgetTotals({ lines: entrada }).subtotal
    );
  });

  test("CASO 22b — finalizeBudget mantiene el orden borrar → clasificar → cuadrar → insertar", () => {
    // Complemento estructural del caso anterior. Lo que se comprueba es la SECUENCIA
    // dentro del provider, que es lo único que no puede ejecutarse desde node:test
    // porque es un componente de React. El comportamiento ya está probado arriba.
    const cuerpo = providerSrc.slice(providerSrc.indexOf("const finalizeBudget"));

    const iDelete = cuerpo.indexOf('.from("budget_items").delete()');
    const iClasificar = cuerpo.indexOf("enrichForPersistence({");
    const iCuadre = cuerpo.indexOf('assertPersistedTotalsMatch(classifiedItems');
    const iInsert = cuerpo.indexOf('.from("budget_items").insert(classifiedItems)');

    assert.ok(iDelete > 0, "no se encuentra el DELETE de finalizeBudget");
    assert.ok(iClasificar > iDelete, "se clasifica antes de limpiar las filas del borrador");
    assert.ok(iCuadre > iClasificar, "el cuadre debe correr DESPUÉS del enriquecimiento");
    assert.ok(iInsert > iCuadre, "se insertaría sin haber pasado la puerta de cuadre");

    // Y lo que se inserta es el resultado clasificado, no el array previo.
    assert.doesNotMatch(
      cuerpo.slice(iDelete, iInsert + 80),
      /\.insert\(itemsToInsert\)/,
      "finalizeBudget sigue insertando las líneas sin clasificar"
    );
  });

  test("CASO 22c — el borrador se clasifica por el sincronizador, nunca por el orquestador", () => {
    // En 2D-3 este caso comprobaba que `saveDraft` NO clasificaba, porque su cableado
    // pertenecía a la fase siguiente. En 2D-4 ya clasifica, así que dejarlo como estaba
    // habría sido un test verde por el motivo equivocado. Lo que protege ahora es el
    // límite NUEVO: el borrador clasifica sólo a través de `syncClassifiedBudgetItems`.
    //
    // La diferencia no es de estilo. Llamar al orquestador en directo desde `saveDraft`
    // saltaría la comparación de firma, y entonces cada pausa del cursor cargaría el
    // vocabulario entero para acabar descubriendo que no había nada que guardar.
    const inicio = providerSrc.indexOf("const saveDraft");
    const fin = providerSrc.indexOf("const finalizeBudget");
    assert.ok(inicio > 0 && fin > inicio);
    const cuerpo = providerSrc.slice(inicio, fin);

    assert.match(cuerpo, /syncClassifiedBudgetItems\(\{/);
    assert.doesNotMatch(
      cuerpo,
      /classifyForPersistence|enrichForPersistence/,
      "saveDraft clasifica saltándose la salida temprana por firma"
    );
  });
});
