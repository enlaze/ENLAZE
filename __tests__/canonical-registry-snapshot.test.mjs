/**
 * Fase 2D-1b · Carga por lotes del vocabulario canónico.
 *
 * Estos tests no comprueban que la resolución acierte —eso es canonical-resolver— sino
 * tres cosas distintas:
 *
 *   1. que el número de consultas dependa del volumen de evidencia distinta y NUNCA
 *      del número de partidas;
 *   2. que trocear las consultas no cambie ni un bit del resultado;
 *   3. que una avería de infraestructura se distinga de "no hay coincidencias".
 *
 * El fake de Supabase emula de verdad los filtros de PostgREST que el loader genera
 * (`in`, `is`, y los `or=(...)` de tenant y de source_ref). Si sólo contase llamadas,
 * los tests de aislamiento y de filtrado no demostrarían nada.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { createInMemoryRegistry, DEFAULT_ALIAS_SOURCES, canonicalNormalize } = await import(
  path.join(root, "lib/canonical/registry.ts")
);
const {
  loadCanonicalRegistrySnapshot,
  isCanonicalSnapshotError,
  CanonicalSnapshotError,
  ALIAS_SELECT,
  CONCEPT_SELECT,
  SOURCE_SELECT,
} = await import(path.join(root, "lib/canonical/registry-snapshot.ts"));
const { classifyBudgetItems } = await import(
  path.join(root, "lib/canonical/classify-budget-items.ts")
);

const COMPANY_A = "0f9b6c1e-3f2a-4c7d-9b1e-2a8c6d4f0e11";
const COMPANY_B = "7c4d2a80-91f5-4b3e-8d6a-1e0f5b2c9a33";

// ─── Fake de Supabase instrumentado ───────────────────────────────────────────

/** Parte por comas de primer nivel: "a.is.null,b.in.(x,y)" → ["a.is.null","b.in.(x,y)"]. */
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

/** Emula `or=(...)` de PostgREST para las tres formas que el loader genera. */
function orPredicate(expr) {
  const predicates = splitTopLevel(expr).map((part) => {
    const match = /^([a-z_]+)\.(is|eq|in)\.(.*)$/.exec(part);
    assert.ok(match, `filtro or no reconocido: '${part}'`);
    const [, column, op, raw] = match;
    if (op === "is") {
      assert.equal(raw, "null", `'is' sólo se usa con null, llegó '${raw}'`);
      return (row) => row[column] === null;
    }
    if (op === "eq") return (row) => row[column] === raw;
    const values = new Set(raw.replace(/^\(|\)$/g, "").split(","));
    return (row) => row[column] !== null && values.has(row[column]);
  });
  return (row) => predicates.some((p) => p(row));
}

/**
 * @param tables  { [tabla]: filas[] }
 * @param options { failures?: { [tabla]: mensaje }, leakyTables?: string[] }
 */
function fakeSupabase(tables, options = {}) {
  const failures = options.failures ?? {};
  const leaky = new Set(options.leakyTables ?? []);

  const stats = {
    queryCount: 0,
    queriesByTable: {},
    log: [],
    reset() {
      stats.queryCount = 0;
      stats.queriesByTable = {};
      stats.log = [];
    },
  };

  function from(table) {
    const filters = [];
    const described = [];
    let selected = null;

    const builder = {
      select(columns) {
        selected = columns;
        return builder;
      },
      eq(column, value) {
        described.push(`${column}.eq.${value}`);
        filters.push((row) => row[column] === value);
        return builder;
      },
      is(column) {
        described.push(`${column}.is.null`);
        filters.push((row) => row[column] === null);
        return builder;
      },
      in(column, values) {
        described.push(`${column}.in.(${values.length})`);
        const set = new Set(values);
        filters.push((row) => set.has(row[column]));
        return builder;
      },
      or(expr) {
        described.push(`or(${expr})`);
        filters.push(orPredicate(expr));
        return builder;
      },
      limit() {
        return builder;
      },
      then(onfulfilled) {
        stats.queryCount += 1;
        stats.queriesByTable[table] = (stats.queriesByTable[table] ?? 0) + 1;
        stats.log.push({ table, filters: [...described], select: selected });

        if (failures[table] !== undefined) {
          return Promise.resolve(onfulfilled({ data: null, error: { message: failures[table] } }));
        }

        const rows = tables[table] ?? [];
        const kept = leaky.has(table) ? rows : rows.filter((row) => filters.every((f) => f(row)));
        // Copia defensiva: el loader no debe poder mutar la "base de datos".
        return Promise.resolve(
          onfulfilled({ data: kept.map((row) => ({ ...row })), error: null })
        );
      },
    };

    return builder;
  }

  return { client: { from }, stats };
}

// ─── Datos ────────────────────────────────────────────────────────────────────

function makeConcept(i) {
  return {
    id: `c0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    canonical_id: `WORK.GEN.C${i}`,
    kind: "WORK",
    domain: "EDIF",
    family: "GEN",
    concept: `C${i}`,
    variant: null,
    display_name_es: `Concepto ${i}`,
    definition_es: `Definición del concepto ${i}`,
    default_unit: "m2",
    default_price_type: "LABOR_AND_MATERIAL",
    // Alternar permite que los tests de price_type sigan teniendo sentido aguas abajo.
    allowed_price_types:
      i % 2 === 0 ? ["LABOR_AND_MATERIAL"] : ["LABOR_ONLY", "LABOR_AND_MATERIAL"],
    status: "active",
    superseded_by: null,
    version: 1,
  };
}

// El id se deriva del contenido, no de un contador de invocaciones: dos llamadas
// a buildDb() con los mismos datos tienen que producir exactamente las mismas
// filas. Con un contador global, comparar dos cargas comparaba también el orden
// en que el fichero de test construyó sus fixtures, que no es lo que se mide.
const aliasIds = new Map();
function aliasId(row) {
  const key = JSON.stringify([
    row.canonical_id,
    row.alias_kind,
    row.source,
    row.source_ref,
    row.company_id,
    row.alias_value,
    row.confidence,
  ]);
  let id = aliasIds.get(key);
  if (id === undefined) {
    id = `a0000000-0000-4000-8000-${String(aliasIds.size + 1).padStart(12, "0")}`;
    aliasIds.set(key, id);
  }
  return id;
}

function makeAlias(canonical_id, value, opts = {}) {
  const row = {
    canonical_id,
    alias_kind: opts.kind ?? "exact",
    source: opts.source ?? "curated",
    source_ref: opts.source_ref ?? null,
    company_id: opts.company_id ?? null,
    alias_value: value,
    alias_norm: canonicalNormalize(value),
    confidence: opts.confidence ?? 1,
  };
  return { id: aliasId(row), ...row };
}

const TEXT = (i) => `Partida generica numero ${i}`;

/** Base de N conceptos, cada uno con su alias global exacto. */
function buildDb(n, extraAliases = [], extraConcepts = []) {
  const concepts = [];
  const aliases = [];
  for (let i = 0; i < n; i += 1) {
    concepts.push(makeConcept(i));
    aliases.push(makeAlias(`WORK.GEN.C${i}`, TEXT(i)));
  }
  return {
    canonical_alias_sources: [...DEFAULT_ALIAS_SOURCES],
    canonical_aliases: [...aliases, ...extraAliases],
    canonical_concepts: [...concepts, ...extraConcepts],
  };
}

function makeLines(n, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    concept: TEXT(i),
    description: `Descripción ${i}`,
    quantity: 10 + i,
    unit: "m2",
    unit_price: 15.64,
    subtotal: Math.round((10 + i) * 15.64 * 100) / 100,
    canonical_origin: "free_text",
    ...extra,
  }));
}

// ─── Consultas observadas ─────────────────────────────────────────────────────

describe("Fase 2D-1b · snapshot loader", () => {
  test("QUERIES — 1, 10 y 100 líneas cuestan lo mismo: 3 consultas", async () => {
    const observado = [];

    for (const n of [1, 10, 100]) {
      const db = buildDb(120);
      const fake = fakeSupabase(db);

      const snapshot = await loadCanonicalRegistrySnapshot({
        supabase: fake.client,
        lines: makeLines(n),
        companyId: COMPANY_A,
      });

      observado.push({
        lineas: n,
        D: snapshot.stats.distinctNorms,
        C: snapshot.stats.distinctCanonicalIds,
        total: fake.stats.queryCount,
        porTabla: { ...fake.stats.queriesByTable },
      });

      // El contador del loader y el del fake deben coincidir: si divergen, alguien
      // está emitiendo consultas por un camino que el loader no instrumenta.
      assert.equal(snapshot.stats.queries.total, fake.stats.queryCount);

      assert.equal(fake.stats.queryCount, 3, `${n} líneas costaron ${fake.stats.queryCount}`);
      assert.deepEqual(fake.stats.queriesByTable, {
        canonical_alias_sources: 1,
        canonical_aliases: 1,
        canonical_concepts: 1,
      });
      assert.equal(snapshot.stats.distinctNorms, n);
      assert.equal(snapshot.stats.distinctCanonicalIds, n);
    }

    // El coste NO crece con las partidas. Queda escrito en la salida del test.
    console.log("    consultas observadas:", JSON.stringify(observado));
    assert.deepEqual(
      observado.map((o) => o.total),
      [3, 3, 3]
    );
  });

  test("QUERIES — con chunkSize pequeño el coste es 1 + ceil(D/k) + ceil(C/k)", async () => {
    const db = buildDb(120);
    const fake = fakeSupabase(db);

    const snapshot = await loadCanonicalRegistrySnapshot({
      supabase: fake.client,
      lines: makeLines(100),
      companyId: COMPANY_A,
      chunkSize: 7,
    });

    const esperadoAliases = Math.ceil(100 / 7); // 15
    const esperadoConceptos = Math.ceil(100 / 7); // 15

    assert.equal(snapshot.stats.chunks.aliasNorms, esperadoAliases);
    assert.equal(snapshot.stats.chunks.sourceRefs, 1);
    assert.equal(snapshot.stats.chunks.canonicalIds, esperadoConceptos);

    assert.deepEqual(fake.stats.queriesByTable, {
      canonical_alias_sources: 1,
      canonical_aliases: esperadoAliases,
      canonical_concepts: esperadoConceptos,
    });
    assert.equal(fake.stats.queryCount, 1 + esperadoAliases + esperadoConceptos); // 31

    console.log(
      "    troceado k=7 sobre 100 líneas:",
      JSON.stringify({ total: fake.stats.queryCount, porTabla: fake.stats.queriesByTable })
    );
  });

  // ─── Troceado invisible ─────────────────────────────────────────────────────

  test("CHUNKING — el resultado es idéntico con k=200 y con k=3", async () => {
    const lines = makeLines(20);

    const grande = fakeSupabase(buildDb(40));
    const pequeno = fakeSupabase(buildDb(40));

    const a = await loadCanonicalRegistrySnapshot({
      supabase: grande.client,
      lines,
      companyId: COMPANY_A,
      chunkSize: 200,
    });
    const b = await loadCanonicalRegistrySnapshot({
      supabase: pequeno.client,
      lines,
      companyId: COMPANY_A,
      chunkSize: 3,
    });

    assert.equal(grande.stats.queryCount, 3);
    assert.ok(pequeno.stats.queryCount > 3, "k=3 debía trocear");

    assert.deepEqual(b.data, a.data, "trocear cambió los datos cargados");
    assert.equal(JSON.stringify(b.data), JSON.stringify(a.data), "cambió el orden");

    // Y la clasificación resultante también es idéntica.
    const clasA = await classifyBudgetItems(lines, a.registry, { companyId: COMPANY_A });
    const clasB = await classifyBudgetItems(lines, b.registry, { companyId: COMPANY_A });
    assert.deepEqual(clasB.lines, clasA.lines);
  });

  test("CHUNKING — trocear source_refs no duplica ni pierde aliases", async () => {
    const refs = ["cype_2026", "bc3_publico", "banco_a", "banco_b", "banco_c"];
    const extra = refs.map((ref, i) =>
      makeAlias(`WORK.GEN.C${i}`, TEXT(i), { source: "import", source_ref: ref })
    );

    // Una línea por banco, todas con procedencia import válida.
    const lines = refs.map((ref, i) => ({
      concept: TEXT(i),
      quantity: 1,
      unit: "ud",
      unit_price: 100,
      subtotal: 100,
      canonical_origin: "import",
      canonical_source_ref: ref,
    }));

    const entero = fakeSupabase(buildDb(10, extra));
    const troceado = fakeSupabase(buildDb(10, extra));

    const a = await loadCanonicalRegistrySnapshot({
      supabase: entero.client,
      lines,
      companyId: COMPANY_A,
      chunkSize: 200,
    });
    const b = await loadCanonicalRegistrySnapshot({
      supabase: troceado.client,
      lines,
      companyId: COMPANY_A,
      chunkSize: { aliasNorms: 200, sourceRefs: 2, canonicalIds: 200 },
    });

    assert.equal(a.stats.distinctSourceRefs, 5);
    assert.equal(a.stats.chunks.sourceRefs, 1);
    assert.equal(b.stats.chunks.sourceRefs, Math.ceil(5 / 2)); // 3

    // 1 sources + (1 normChunk × 3 refChunks) + 1 concepts
    assert.equal(troceado.stats.queryCount, 1 + 3 + 1);

    // Los aliases sin source_ref vuelven en los tres fragmentos: la deduplicación por
    // id es lo único que impide que aparezcan por triplicado.
    assert.deepEqual(b.data.aliases, a.data.aliases, "el troceado de refs duplicó o perdió filas");
    assert.equal(
      new Set(b.data.aliases.map((x) => x.id)).size,
      b.data.aliases.length,
      "hay aliases repetidos en el snapshot"
    );
  });

  // ─── Tenant ─────────────────────────────────────────────────────────────────

  test("TENANT — el snapshot trae globales y los privados de la empresa, nunca los ajenos", async () => {
    const privadoA = makeAlias("WORK.GEN.C0", "Nombre interno de A", {
      source: "manual",
      company_id: COMPANY_A,
    });
    const privadoB = makeAlias("WORK.GEN.C1", "Nombre interno de B", {
      source: "manual",
      company_id: COMPANY_B,
    });

    const db = buildDb(5, [privadoA, privadoB]);
    const lines = [
      { concept: "Nombre interno de A", quantity: 1, unit: "ud", unit_price: 1, subtotal: 1, canonical_origin: "free_text" },
      { concept: "Nombre interno de B", quantity: 1, unit: "ud", unit_price: 1, subtotal: 1, canonical_origin: "free_text" },
      { concept: TEXT(0), quantity: 1, unit: "ud", unit_price: 1, subtotal: 1, canonical_origin: "free_text" },
    ];

    const paraA = await loadCanonicalRegistrySnapshot({
      supabase: fakeSupabase(db).client,
      lines,
      companyId: COMPANY_A,
    });
    const idsA = paraA.data.aliases.map((x) => x.id);
    assert.ok(idsA.includes(privadoA.id), "faltó el alias privado de la propia empresa");
    assert.ok(!idsA.includes(privadoB.id), "se coló un alias privado de otra empresa");

    const paraB = await loadCanonicalRegistrySnapshot({
      supabase: fakeSupabase(db).client,
      lines,
      companyId: COMPANY_B,
    });
    const idsB = paraB.data.aliases.map((x) => x.id);
    assert.ok(idsB.includes(privadoB.id));
    assert.ok(!idsB.includes(privadoA.id));

    // Sin empresa, sólo vocabulario global.
    const global = await loadCanonicalRegistrySnapshot({
      supabase: fakeSupabase(db).client,
      lines,
      companyId: null,
    });
    assert.ok(global.data.aliases.every((x) => x.company_id === null));
  });

  test("TENANT — si la RLS y el predicado fallasen, la aserción en memoria lo atrapa", async () => {
    const ajeno = makeAlias("WORK.GEN.C0", TEXT(0), { source: "manual", company_id: COMPANY_B });
    const db = buildDb(5, [ajeno]);
    // leakyTables simula service_role con el predicado roto: el filtro no se aplica.
    const fake = fakeSupabase(db, { leakyTables: ["canonical_aliases"] });

    await assert.rejects(
      () =>
        loadCanonicalRegistrySnapshot({
          supabase: fake.client,
          lines: makeLines(1),
          companyId: COMPANY_A,
        }),
      (error) => {
        assert.equal(error.name, "CanonicalError");
        assert.equal(error.code, "TENANT_LEAK");
        // Y NO se confunde con una avería de infraestructura.
        assert.equal(isCanonicalSnapshotError(error), false);
        return true;
      }
    );
  });

  // ─── source_ref ─────────────────────────────────────────────────────────────

  test("SOURCE_REF — sólo se trae la evidencia documental que el presupuesto declara", async () => {
    const deCype = makeAlias("WORK.GEN.C0", TEXT(0), { source: "import", source_ref: "cype_2026" });
    const deOtro = makeAlias("WORK.GEN.C0", TEXT(0), { source: "import", source_ref: "otro_banco" });
    const db = buildDb(5, [deCype, deOtro]);

    const snapshot = await loadCanonicalRegistrySnapshot({
      supabase: fakeSupabase(db).client,
      lines: [
        {
          concept: TEXT(0),
          quantity: 1,
          unit: "ud",
          unit_price: 1,
          subtotal: 1,
          canonical_origin: "import",
          canonical_source_ref: "cype_2026",
        },
      ],
      companyId: COMPANY_A,
    });

    const ids = snapshot.data.aliases.map((x) => x.id);
    assert.ok(ids.includes(deCype.id), "faltó la evidencia del banco declarado");
    assert.ok(!ids.includes(deOtro.id), "se trajo un banco que el presupuesto no declara");
    // Los aliases sin instancia documental siempre entran.
    assert.ok(snapshot.data.aliases.some((x) => x.source_ref === null));
  });

  test("SOURCE_REF — una procedencia degradada no aporta refs a la consulta", async () => {
    const db = buildDb(5);
    const snapshot = await loadCanonicalRegistrySnapshot({
      supabase: fakeSupabase(db).client,
      lines: [
        {
          concept: TEXT(0),
          quantity: 1,
          unit: "ud",
          unit_price: 1,
          subtotal: 1,
          canonical_origin: "import",
          canonical_source_ref: null, // degradada por normalizeProvenance
        },
      ],
      companyId: COMPANY_A,
    });

    assert.equal(snapshot.stats.distinctSourceRefs, 0);
    assert.equal(snapshot.stats.chunks.sourceRefs, 1);
  });

  // ─── El loader no decide nada ───────────────────────────────────────────────

  test("SUPERCONJUNTO — el loader no aplica las reglas semánticas del resolver", async () => {
    // Un alias 'engine' PRIVADO. El resolver no lo usará en el nivel 1 porque engine
    // es global-only, pero sigue siendo alcanzable en el nivel 2. Si el loader lo
    // podase "para optimizar", cambiaría el resultado de la resolución.
    const engineePrivado = makeAlias("WORK.GEN.C3", TEXT(0), {
      source: "engine",
      company_id: COMPANY_A,
    });
    const db = buildDb(5, [engineePrivado]);

    const snapshot = await loadCanonicalRegistrySnapshot({
      supabase: fakeSupabase(db).client,
      lines: [{ concept: TEXT(0), quantity: 1, unit: "ud", unit_price: 1, subtotal: 1, canonical_origin: "engine" }],
      companyId: COMPANY_A,
    });

    assert.ok(
      snapshot.data.aliases.some((x) => x.id === engineePrivado.id),
      "el loader podó evidencia aplicando una regla que pertenece al resolver"
    );
  });

  test("SUPERCONJUNTO — todavía no se cargan relaciones", async () => {
    const fake = fakeSupabase(buildDb(5));
    await loadCanonicalRegistrySnapshot({
      supabase: fake.client,
      lines: makeLines(3),
      companyId: COMPANY_A,
    });
    assert.equal(fake.stats.queriesByTable.canonical_concept_relations, undefined);
  });

  // ─── Equivalencia con el fixture de siempre ─────────────────────────────────

  test("EQUIVALENCIA — resolver contra el snapshot da lo mismo que contra el registry completo", async () => {
    const privado = makeAlias("WORK.GEN.C7", "Nuestro nombre para el tabique", {
      source: "manual",
      company_id: COMPANY_A,
    });
    const sinonimo = makeAlias("WORK.GEN.C4", "Casi como la partida cuatro", {
      kind: "synonym",
      confidence: 0.72,
    });
    const db = buildDb(40, [privado, sinonimo]);

    const lines = [
      ...makeLines(30),
      { concept: "Nuestro nombre para el tabique", quantity: 2, unit: "m2", unit_price: 40, subtotal: 80, canonical_origin: "free_text" },
      { concept: "Casi como la partida cuatro", quantity: 3, unit: "m2", unit_price: 12, subtotal: 36, canonical_origin: "free_text" },
      { concept: "Texto que no existe en el vocabulario", quantity: 1, unit: "ud", unit_price: 9, subtotal: 9, canonical_origin: "free_text" },
    ];

    const fake = fakeSupabase(db);
    const snapshot = await loadCanonicalRegistrySnapshot({
      supabase: fake.client,
      lines,
      companyId: COMPANY_A,
    });

    // Registry construido a mano con TODO el vocabulario, sin pasar por el loader.
    const completo = createInMemoryRegistry({
      concepts: db.canonical_concepts,
      aliases: db.canonical_aliases,
      sources: db.canonical_alias_sources,
    });

    const conSnapshot = await classifyBudgetItems(lines, snapshot.registry, {
      companyId: COMPANY_A,
    });
    const conCompleto = await classifyBudgetItems(lines, completo, { companyId: COMPANY_A });

    assert.deepEqual(
      conSnapshot.lines,
      conCompleto.lines,
      "el snapshot dejó fuera evidencia que sí cambiaba una resolución"
    );

    // Y las resoluciones no son todas triviales: si lo fueran, el test no probaría nada.
    const resueltas = conSnapshot.lines.filter((l) => l.canonical_status === "resolved").length;
    const revision = conSnapshot.lines.filter((l) => l.canonical_status === "review").length;
    assert.ok(resueltas >= 31, `sólo ${resueltas} resueltas`);
    assert.equal(revision, 1);
  });

  test("CERO I/O — clasificar contra el snapshot no emite ninguna consulta", async () => {
    const fake = fakeSupabase(buildDb(120));
    const lines = makeLines(100);

    const snapshot = await loadCanonicalRegistrySnapshot({
      supabase: fake.client,
      lines,
      companyId: COMPANY_A,
    });
    assert.equal(fake.stats.queryCount, 3);

    fake.stats.reset();

    const { lines: clasificadas } = await classifyBudgetItems(lines, snapshot.registry, {
      companyId: COMPANY_A,
    });

    assert.equal(clasificadas.length, 100);
    assert.equal(
      fake.stats.queryCount,
      0,
      `la clasificación emitió ${fake.stats.queryCount} consultas después del snapshot`
    );
    assert.deepEqual(fake.stats.queriesByTable, {});
  });

  // ─── Errores ────────────────────────────────────────────────────────────────

  test("ERRORES — un fallo de Supabase se propaga tipado, tabla por tabla", async () => {
    for (const tabla of ["canonical_alias_sources", "canonical_aliases", "canonical_concepts"]) {
      const fake = fakeSupabase(buildDb(5), { failures: { [tabla]: "connection reset by peer" } });

      await assert.rejects(
        () =>
          loadCanonicalRegistrySnapshot({
            supabase: fake.client,
            lines: makeLines(3),
            companyId: COMPANY_A,
          }),
        (error) => {
          assert.ok(isCanonicalSnapshotError(error), `${tabla}: error no tipado`);
          assert.ok(error instanceof CanonicalSnapshotError);
          assert.equal(error.table, tabla);
          assert.match(error.message, /connection reset by peer/);
          return true;
        },
        `${tabla} debía propagar el fallo, no devolver un snapshot vacío`
      );
    }
  });

  test("ERRORES — cero evidencia NO es un error y se distingue de una avería", async () => {
    const fake = fakeSupabase(buildDb(5));

    const snapshot = await loadCanonicalRegistrySnapshot({
      supabase: fake.client,
      lines: [
        { concept: "Nada de esto existe en el vocabulario", quantity: 1, unit: "ud", unit_price: 1, subtotal: 1, canonical_origin: "free_text" },
      ],
      companyId: COMPANY_A,
    });

    assert.equal(snapshot.data.aliases.length, 0);
    assert.equal(snapshot.data.concepts.length, 0);
    assert.equal(snapshot.stats.distinctCanonicalIds, 0);
    // Sin canonical_id que buscar, la consulta de conceptos no llega a emitirse.
    assert.equal(snapshot.stats.chunks.canonicalIds, 0);
    assert.equal(fake.stats.queriesByTable.canonical_concepts, undefined);
    assert.equal(fake.stats.queryCount, 2);

    // El registry existe y funciona: devuelve unmatched, no explota.
    const { lines } = await classifyBudgetItems(
      [{ concept: "Nada de esto existe en el vocabulario", canonical_origin: "free_text" }],
      snapshot.registry,
      { companyId: COMPANY_A }
    );
    assert.equal(lines[0].canonical_status, "unmatched");
  });

  test("ERRORES — un companyId con caracteres de filtro se rechaza antes de consultar", async () => {
    const fake = fakeSupabase(buildDb(5));
    await assert.rejects(
      () =>
        loadCanonicalRegistrySnapshot({
          supabase: fake.client,
          lines: makeLines(1),
          companyId: "abc,company_id.eq.otra",
        }),
      /caracteres no admitidos/
    );
    assert.equal(fake.stats.queryCount, 0, "se llegó a consultar con un filtro manipulado");
  });

  // ─── Higiene ────────────────────────────────────────────────────────────────

  test("HIGIENE — la entrada no se muta", async () => {
    const lines = makeLines(10);
    const copia = JSON.parse(JSON.stringify(lines));

    await loadCanonicalRegistrySnapshot({
      supabase: fakeSupabase(buildDb(20)).client,
      lines,
      companyId: COMPANY_A,
    });

    assert.deepEqual(JSON.parse(JSON.stringify(lines)), copia);
  });

  test("HIGIENE — dos cargas idénticas producen el mismo snapshot, bit a bit", async () => {
    const lines = makeLines(25);
    const db = buildDb(50);

    const a = await loadCanonicalRegistrySnapshot({
      supabase: fakeSupabase(db).client,
      lines,
      companyId: COMPANY_A,
    });
    // Segunda carga con las filas en otro orden: el snapshot debe salir igual.
    const barajado = {
      ...db,
      canonical_aliases: [...db.canonical_aliases].reverse(),
      canonical_concepts: [...db.canonical_concepts].reverse(),
    };
    const b = await loadCanonicalRegistrySnapshot({
      supabase: fakeSupabase(barajado).client,
      lines,
      companyId: COMPANY_A,
    });

    assert.equal(
      JSON.stringify(b.data),
      JSON.stringify(a.data),
      "el snapshot depende del orden en que la base devuelve las filas"
    );
    assert.deepEqual(b.stats, a.stats);
  });

  test("HIGIENE — las columnas seleccionadas cubren todos los campos de cada interfaz", async () => {
    const cubre = (select, row, nombre) => {
      const columnas = new Set(select.split(",").map((c) => c.trim()));
      for (const campo of Object.keys(row)) {
        assert.ok(columnas.has(campo), `${nombre}: el SELECT no pide '${campo}'`);
      }
    };

    cubre(ALIAS_SELECT, makeAlias("WORK.GEN.C0", "x"), "canonical_aliases");
    cubre(CONCEPT_SELECT, makeConcept(0), "canonical_concepts");
    cubre(SOURCE_SELECT, DEFAULT_ALIAS_SOURCES[0], "canonical_alias_sources");
  });
});
