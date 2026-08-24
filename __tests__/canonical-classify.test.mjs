/**
 * Fase 2D · Paso 1 — Capa pura de clasificación canónica.
 *
 * Lo que estos tests protegen NO es que la clasificación acierte: eso ya lo cubre
 * canonical-resolver. Protegen que clasificar sea INOCUO. Un presupuesto que pasa por
 * esta capa debe salir con exactamente el mismo dinero, las mismas líneas y el mismo
 * orden que entró, y con siete columnas nuevas. Ni una más, ni una distinta.
 *
 * No se toca Supabase. Todo corre contra un registry en memoria.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { canonicalNormalize, createInMemoryRegistry, DEFAULT_ALIAS_SOURCES } = await import(
  path.join(root, "lib/canonical/registry.ts")
);
const { classifyBudgetItems, normalizeProvenance, CANONICAL_COLUMN_KEYS } = await import(
  path.join(root, "lib/canonical/classify-budget-items.ts")
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_A = "0f9b6c1e-3f2a-4c7d-9b1e-2a8c6d4f0e11";
const COMPANY_B = "7c4d2a80-91f5-4b3e-8d6a-1e0f5b2c9a33";

const PAINT_WALL = "WORK.PAINT.EMULSION.WALL.2COATS";
const PAINT_MAT = "MAT.PAINT.EMULSION.INTERIOR_MATT";
const WASTE_HAUL = "WORK.WASTE.CONTAINER.HAUL";
const PRIMER = "WORK.PAINT.PRIMER.APPLY";

function concept(canonical_id, kind, allowed, def, id) {
  return {
    id,
    canonical_id,
    kind,
    domain: "EDIF",
    family: "ACAB",
    concept: canonical_id,
    variant: null,
    display_name_es: canonical_id,
    definition_es: `Definición de ${canonical_id}`,
    default_unit: kind === "MAT" ? "ud" : "m2",
    default_price_type: def,
    allowed_price_types: allowed,
    status: "active",
    superseded_by: null,
    version: 1,
  };
}

const CONCEPTS = [
  // Varios allowed_price_types → price_type debe quedar NULL.
  concept(PAINT_WALL, "WORK", ["LABOR_ONLY", "LABOR_AND_MATERIAL"], "LABOR_AND_MATERIAL",
    "b1a2c3d4-0001-4a00-9000-000000000001"),
  // Un único allowed_price_type → price_type debe asignarse.
  concept(PAINT_MAT, "MAT", ["MATERIAL_ONLY"], "MATERIAL_ONLY",
    "b1a2c3d4-0002-4a00-9000-000000000002"),
  concept(WASTE_HAUL, "WORK", ["SERVICE", "LABOR_AND_MATERIAL"], "SERVICE",
    "b1a2c3d4-0003-4a00-9000-000000000003"),
  concept(PRIMER, "WORK", ["LABOR_AND_MATERIAL"], "LABOR_AND_MATERIAL",
    "b1a2c3d4-0004-4a00-9000-000000000004"),
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
  alias(WASTE_HAUL, "Contenedor y transporte a gestor autorizado"),
  alias(PRIMER, "Imprimación de paredes y techos", { source: "import", source_ref: "cype_2026" }),
];

function baseRegistry(extraAliases = []) {
  return createInMemoryRegistry({
    concepts: CONCEPTS,
    aliases: [...ALIASES, ...extraAliases],
    sources: DEFAULT_ALIAS_SOURCES,
  });
}

/** Registry que cuenta llamadas reales, para auditar el N+1 desde fuera del memoizador. */
function countingRegistry(inner) {
  const calls = { listAliasSources: 0, findAliases: 0, getConceptByCanonicalId: 0 };
  return {
    calls,
    registry: {
      listAliasSources() {
        calls.listAliasSources += 1;
        return inner.listAliasSources();
      },
      findAliases(q) {
        calls.findAliases += 1;
        return inner.findAliases(q);
      },
      getConceptByCanonicalId(id) {
        calls.getConceptByCanonicalId += 1;
        return inner.getConceptByCanonicalId(id);
      },
      getConceptById: (id) => inner.getConceptById(id),
      listRelations: (id) => inner.listRelations(id),
    },
  };
}

/**
 * Línea económica realista. Los importes son los del presupuesto de pintura real
 * usado en Fase 2C, no números redondos inventados: si la capa tocase un céntimo,
 * se vería.
 */
function line(concept, quantity, unit, unit_price, subtotal, extra = {}) {
  return {
    concept,
    description: `${concept} — ejecución completa`,
    quantity,
    unit,
    category: "mano_obra",
    chapter: "pintura",
    unit_price,
    subtotal,
    ...extra,
  };
}

const PRESUPUESTO = [
  line("Pintura plástica en paredes", 58, "m2", 15.64, 906.89, { canonical_origin: "engine" }),
  line("Pintura plástica blanca mate interior 15 L", 3, "cubos", 52.8, 158.4, {
    canonical_origin: "engine",
    category: "material",
  }),
  line("Contenedor y transporte a gestor autorizado", 6, "ud", 717.5, 4305.02, {
    canonical_origin: "engine",
    chapter: "residuos",
  }),
  line("Un concepto que no está en el vocabulario", 12, "ml", 9.31, 111.72, {
    canonical_origin: "free_text",
  }),
];

/** Todas las claves que NO son canónicas. Es lo que debe salir intacto. */
function economicView(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (CANONICAL_COLUMN_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

// ─── TEST 1 — Equivalencia económica valor por valor ──────────────────────────

describe("Fase 2D · clasificación inocua", () => {
  test("TEST 1 — antes y después son idénticos salvo las siete columnas canónicas", async () => {
    const entrada = PRESUPUESTO.map((l) => ({ ...l }));
    const copiaIntacta = JSON.parse(JSON.stringify(entrada));

    const { lines } = await classifyBudgetItems(entrada, baseRegistry(), {
      companyId: COMPANY_A,
    });

    assert.equal(lines.length, copiaIntacta.length, "el número de líneas económicas cambió");

    for (let i = 0; i < lines.length; i += 1) {
      const antes = economicView(copiaIntacta[i]);
      const despues = economicView(lines[i]);
      assert.deepEqual(despues, antes, `la línea ${i} cambió fuera de las columnas canónicas`);

      // Comparación explícita de los campos que mueven dinero, por si algún día
      // economicView se relaja por error.
      assert.equal(lines[i].quantity, copiaIntacta[i].quantity);
      assert.equal(lines[i].unit, copiaIntacta[i].unit);
      assert.equal(lines[i].unit_price, copiaIntacta[i].unit_price);
      assert.equal(lines[i].subtotal, copiaIntacta[i].subtotal);
      assert.equal(lines[i].concept, copiaIntacta[i].concept);
      assert.equal(lines[i].description, copiaIntacta[i].description);
    }

    // El total tampoco se mueve.
    const total = (rows) => rows.reduce((acc, r) => acc + r.subtotal, 0);
    assert.equal(total(lines), total(copiaIntacta));

    // Y la entrada no se ha mutado in situ.
    assert.deepEqual(JSON.parse(JSON.stringify(entrada)), copiaIntacta);
  });

  // ─── TEST 2 — Determinismo ──────────────────────────────────────────────────

  test("TEST 2 — clasificar dos veces produce exactamente el mismo resultado", async () => {
    const a = await classifyBudgetItems(PRESUPUESTO, baseRegistry(), { companyId: COMPANY_A });
    const b = await classifyBudgetItems(PRESUPUESTO, baseRegistry(), { companyId: COMPANY_A });

    assert.deepEqual(b.lines, a.lines);
    assert.deepEqual(
      JSON.stringify(b.lines),
      JSON.stringify(a.lines),
      "la serialización difiere: hay orden de claves o valores no deterministas"
    );
  });

  // ─── TEST 3 — Registry cargado una sola vez ─────────────────────────────────

  test("TEST 3 — el contrato de procedencias se carga una vez por presupuesto", async () => {
    const counted = countingRegistry(baseRegistry());

    // Presupuesto con repeticiones: es el caso real de una reforma.
    const muchas = [...PRESUPUESTO, ...PRESUPUESTO, ...PRESUPUESTO];

    const { stats } = await classifyBudgetItems(muchas, counted.registry, {
      companyId: COMPANY_A,
    });

    assert.equal(
      counted.calls.listAliasSources,
      1,
      `listAliasSources se llamó ${counted.calls.listAliasSources} veces; debe ser 1`
    );
    assert.equal(stats.listAliasSources, 1);

    // La deduplicación colapsa las 12 líneas en 4 resoluciones distintas.
    assert.equal(stats.resolutions, 4, "la deduplicación por (norm, origin, source_ref, company) falló");

    // Y cada concepto resuelto se lee una sola vez.
    assert.ok(
      counted.calls.getConceptByCanonicalId <= 3,
      `getConceptByCanonicalId se llamó ${counted.calls.getConceptByCanonicalId} veces`
    );
  });

  // ─── TEST 4 — FAIL-OPEN: el registry entero falla ───────────────────────────

  test("TEST 4 — si el registry no responde, todo queda unmatched y no se lanza", async () => {
    const roto = {
      async listAliasSources() {
        throw new Error("Supabase no disponible");
      },
      async findAliases() {
        throw new Error("no debería llegar aquí");
      },
      async getConceptByCanonicalId() {
        throw new Error("no debería llegar aquí");
      },
      async getConceptById() {
        throw new Error("no debería llegar aquí");
      },
      async listRelations() {
        throw new Error("no debería llegar aquí");
      },
    };

    const { lines, stats } = await classifyBudgetItems(PRESUPUESTO, roto, {
      companyId: COMPANY_A,
    });

    assert.equal(stats.registryUnavailable, true);
    assert.equal(lines.length, PRESUPUESTO.length, "el fallo del registry perdió líneas");

    for (const [i, row] of lines.entries()) {
      assert.equal(row.canonical_status, "unmatched");
      assert.equal(row.canonical_id, null);
      assert.equal(row.canonical_confidence, null);
      assert.equal(row.canonical_source, null);
      assert.equal(row.price_type, null);
      // La procedencia NO depende del registry: se conserva.
      assert.equal(row.canonical_origin, PRESUPUESTO[i].canonical_origin);
      // Y el dinero sigue intacto.
      assert.equal(row.unit_price, PRESUPUESTO[i].unit_price);
      assert.equal(row.subtotal, PRESUPUESTO[i].subtotal);
    }
  });

  // ─── TEST 5 — FAIL-OPEN: falla la resolución de UNA línea ───────────────────

  test("TEST 5 — el fallo de una línea no arrastra al resto del presupuesto", async () => {
    const inner = baseRegistry();
    const normVenenoso = canonicalNormalize("Contenedor y transporte a gestor autorizado");

    const parcial = {
      listAliasSources: () => inner.listAliasSources(),
      async findAliases(q) {
        if (q.norm === normVenenoso) throw new Error("timeout consultando aliases");
        return inner.findAliases(q);
      },
      getConceptByCanonicalId: (id) => inner.getConceptByCanonicalId(id),
      getConceptById: (id) => inner.getConceptById(id),
      listRelations: (id) => inner.listRelations(id),
    };

    const { lines, stats } = await classifyBudgetItems(PRESUPUESTO, parcial, {
      companyId: COMPANY_A,
    });

    assert.equal(stats.registryUnavailable, false);
    assert.equal(stats.failedLines, 1);
    assert.equal(lines.length, PRESUPUESTO.length);

    // La línea 2 (contenedor) cae a unmatched...
    assert.equal(lines[2].canonical_status, "unmatched");
    assert.equal(lines[2].canonical_id, null);
    assert.equal(lines[2].canonical_origin, "engine");
    assert.equal(lines[2].subtotal, 4305.02, "una línea que falló al clasificar cambió de importe");

    // ...pero las demás se clasifican con normalidad.
    assert.equal(lines[0].canonical_id, PAINT_WALL);
    assert.equal(lines[0].canonical_status, "resolved");
    assert.equal(lines[1].canonical_id, PAINT_MAT);
    assert.equal(lines[1].canonical_status, "resolved");
  });

  // ─── TEST 6 — Sin timestamps ni campos no deterministas ─────────────────────

  test("TEST 6 — sólo aparecen las siete claves canónicas, sin marcas de tiempo", async () => {
    const { lines } = await classifyBudgetItems(PRESUPUESTO, baseRegistry(), {
      companyId: COMPANY_A,
    });

    for (const [i, row] of lines.entries()) {
      const antes = new Set(Object.keys(PRESUPUESTO[i]));
      const nuevas = Object.keys(row).filter((k) => !antes.has(k));

      for (const k of nuevas) {
        assert.ok(
          CANONICAL_COLUMN_KEYS.includes(k),
          `la capa añadió una clave no autorizada: '${k}'`
        );
      }

      // Ninguna clave del resultado huele a timestamp.
      for (const k of Object.keys(row)) {
        assert.ok(
          !/_at$|timestamp|classified|generated_on/i.test(k),
          `clave sospechosa de no determinismo: '${k}'`
        );
      }

      // Ningún valor es una fecha ni un ISO 8601.
      for (const v of Object.values(row)) {
        assert.ok(!(v instanceof Date), "la capa escribió un objeto Date");
        if (typeof v === "string") {
          assert.ok(
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v),
            `la capa escribió una fecha ISO: '${v}'`
          );
        }
      }
    }
  });

  // ─── TEST 7 — `engine` no usa aliases privados en el nivel 1 ────────────────

  test("TEST 7 — origin 'engine' no se resuelve con el vocabulario privado de la empresa", async () => {
    // Mismo texto, dos conceptos: uno por un alias PRIVADO de procedencia engine,
    // otro por un alias GLOBAL curated. Si el nivel 1 usara el privado, ganaría el
    // primero. Como engine es global-only, el nivel 1 no lo ve y decide el nivel 2,
    // donde curated (rank 2) manda sobre engine (rank 3).
    const registry = baseRegistry([
      alias(WASTE_HAUL, "Retirada de escombros", { source: "engine", company_id: COMPANY_A }),
      alias(PRIMER, "Retirada de escombros", { source: "curated" }),
    ]);

    const { lines } = await classifyBudgetItems(
      [line("Retirada de escombros", 1, "ud", 250, 250, { canonical_origin: "engine" })],
      registry,
      { companyId: COMPANY_A }
    );

    assert.equal(lines[0].canonical_status, "resolved");
    assert.equal(
      lines[0].canonical_id,
      PRIMER,
      "el nivel 1 usó un alias privado pese a que 'engine' es global-only"
    );
    assert.equal(lines[0].canonical_source, "exact_curated");
  });

  // ─── TEST 8 — `free_text` respeta el tenant ─────────────────────────────────

  test("TEST 8 — un alias privado de una empresa no resuelve para otra", async () => {
    const registry = baseRegistry([
      alias(PAINT_WALL, "Nuestro nombre interno para pintar", {
        source: "manual",
        company_id: COMPANY_A,
      }),
    ]);

    const entrada = [
      line("Nuestro nombre interno para pintar", 20, "m2", 14.2, 284, {
        canonical_origin: "free_text",
      }),
    ];

    const propia = await classifyBudgetItems(entrada, registry, { companyId: COMPANY_A });
    assert.equal(propia.lines[0].canonical_status, "resolved");
    assert.equal(propia.lines[0].canonical_id, PAINT_WALL);
    assert.equal(propia.lines[0].canonical_source, "exact_manual");

    const ajena = await classifyBudgetItems(entrada, registry, { companyId: COMPANY_B });
    assert.equal(
      ajena.lines[0].canonical_status,
      "unmatched",
      "el vocabulario privado de una empresa se filtró a otra"
    );
    assert.equal(ajena.lines[0].canonical_id, null);
  });

  // ─── TEST 9 — `source_ref` se conserva ──────────────────────────────────────

  test("TEST 9 — source_ref viaja con la línea y decide el nivel 1", async () => {
    const entrada = [
      line("Imprimación de paredes y techos", 160, "m2", 5.59, 894.72, {
        canonical_origin: "import",
        canonical_source_ref: "cype_2026",
      }),
    ];

    const { lines } = await classifyBudgetItems(entrada, baseRegistry(), {
      companyId: COMPANY_A,
    });

    assert.equal(lines[0].canonical_origin, "import");
    assert.equal(lines[0].canonical_source_ref, "cype_2026");
    assert.equal(lines[0].canonical_status, "resolved");
    assert.equal(lines[0].canonical_id, PRIMER);
    assert.equal(lines[0].canonical_source, "exact_import");
  });

  test("TEST 9b — 'import' sin source_ref degrada a (NULL, NULL) en vez de romper ck_origin_source_ref", async () => {
    const entrada = [
      line("Imprimación de paredes y techos", 160, "m2", 5.59, 894.72, {
        canonical_origin: "import",
        canonical_source_ref: null,
      }),
    ];

    const { lines } = await classifyBudgetItems(entrada, baseRegistry(), {
      companyId: COMPANY_A,
    });

    assert.equal(lines[0].canonical_origin, null);
    assert.equal(lines[0].canonical_source_ref, null);
    assert.equal(lines[0].canonical_status, "unmatched");
    assert.equal(lines[0].subtotal, 894.72);
  });

  // ─── TEST 9c / 9d — Las dos reglas de sanitización, por separado ────────────

  test("TEST 9c — engine/free_text/legacy con source_ref sobrante: CONSERVAN origin y se clasifican", async () => {
    // Regla A. El origen es válido; lo único que sobra es la instancia documental,
    // que ck_origin_source_ref prohíbe para estas tres procedencias. Se descarta el
    // source_ref y la clasificación continúa con total normalidad.
    for (const origin of ["engine", "free_text", "legacy"]) {
      assert.deepEqual(
        normalizeProvenance({ canonical_origin: origin, canonical_source_ref: "cype_2026" }, null),
        { origin, sourceRef: null },
        `'${origin}' no conservó su origen al descartar el source_ref sobrante`
      );
    }

    // Y de extremo a extremo: la línea NO cae a unmatched por llevar basura en el ref.
    const entrada = [
      line("Pintura plástica en paredes", 58, "m2", 15.64, 906.89, {
        canonical_origin: "engine",
        canonical_source_ref: "cype_2026", // sobrante
      }),
    ];

    const { lines } = await classifyBudgetItems(entrada, baseRegistry(), {
      companyId: COMPANY_A,
    });

    assert.equal(lines[0].canonical_origin, "engine", "se perdió un origen perfectamente válido");
    assert.equal(lines[0].canonical_source_ref, null);
    assert.equal(lines[0].canonical_status, "resolved", "la clasificación se abortó sin motivo");
    assert.equal(lines[0].canonical_id, PAINT_WALL);
    assert.equal(lines[0].canonical_source, "exact_curated");
  });

  test("TEST 9d — import/provider sin source_ref válido: degradan a (NULL, NULL) y unmatched", async () => {
    // Regla B. Sin instancia documental el origen es inutilizable: el nivel 1 no
    // tiene banco donde buscar y el nivel 2 excluye a las procedencias que la exigen.
    for (const origin of ["import", "provider"]) {
      assert.deepEqual(
        normalizeProvenance({ canonical_origin: origin, canonical_source_ref: null }, null),
        { origin: null, sourceRef: null },
        `'${origin}' sin source_ref debía degradar`
      );
      // Formato inválido para ck_budget_items_source_ref_format.
      assert.deepEqual(
        normalizeProvenance({ canonical_origin: origin, canonical_source_ref: "CYPE 2026" }, null),
        { origin: null, sourceRef: null },
        `'${origin}' con source_ref mal formado debía degradar`
      );
    }

    const entrada = [
      line("Imprimación de paredes y techos", 160, "m2", 5.59, 894.72, {
        canonical_origin: "provider",
        canonical_source_ref: "Leroy Merlin 2026", // espacios y mayúsculas: inválido
      }),
    ];

    const { lines } = await classifyBudgetItems(entrada, baseRegistry(), {
      companyId: COMPANY_A,
    });

    assert.equal(lines[0].canonical_origin, null);
    assert.equal(lines[0].canonical_source_ref, null);
    assert.equal(lines[0].canonical_status, "unmatched");
    assert.equal(lines[0].canonical_id, null);
    assert.equal(lines[0].canonical_confidence, null);
    assert.equal(lines[0].canonical_source, null);
    assert.equal(lines[0].price_type, null);
    assert.equal(lines[0].subtotal, 894.72, "una línea degradada cambió de importe");
  });

  test("TEST 9e — sin procedencia declarada ni por defecto: (NULL, NULL)", () => {
    assert.deepEqual(normalizeProvenance({}, null), { origin: null, sourceRef: null });
    assert.deepEqual(normalizeProvenance({}, "free_text"), { origin: "free_text", sourceRef: null });
    // Un valor que no pertenece a RESOLUTION_ORIGINS no se cuela.
    assert.deepEqual(
      normalizeProvenance({ canonical_origin: "inventado" }, null),
      { origin: null, sourceRef: null }
    );
  });

  // ─── TEST 10 y 11 — price_type ──────────────────────────────────────────────

  test("TEST 10 — un único allowed_price_type se asigna", async () => {
    const { lines } = await classifyBudgetItems(PRESUPUESTO, baseRegistry(), {
      companyId: COMPANY_A,
    });

    assert.equal(lines[1].canonical_id, PAINT_MAT);
    assert.equal(lines[1].price_type, "MATERIAL_ONLY");
  });

  test("TEST 11 — varios allowed_price_types dejan price_type en NULL", async () => {
    const { lines } = await classifyBudgetItems(PRESUPUESTO, baseRegistry(), {
      companyId: COMPANY_A,
    });

    // Pintura en paredes admite LABOR_ONLY y LABOR_AND_MATERIAL: no hay un hecho.
    assert.equal(lines[0].canonical_id, PAINT_WALL);
    assert.equal(lines[0].price_type, null);

    // Contenedor admite SERVICE y LABOR_AND_MATERIAL: tampoco.
    assert.equal(lines[2].canonical_id, WASTE_HAUL);
    assert.equal(lines[2].price_type, null);

    // Y una línea sin concepto no puede tener price_type bajo ninguna circunstancia.
    assert.equal(lines[3].canonical_status, "unmatched");
    assert.equal(lines[3].price_type, null);
  });

  test("TEST 11c — 'review' NO recibe price_type aunque el concepto sólo admita uno", async () => {
    // PAINT_MAT admite un único allowed_price_type ('MATERIAL_ONLY'). Aun así, un
    // vínculo en revisión es una hipótesis: no puede producir un dato firme.
    const registry = baseRegistry([
      alias(PAINT_MAT, "Pintura blanca para interiores", { kind: "synonym", confidence: 0.7 }),
    ]);

    const { lines } = await classifyBudgetItems(
      [line("Pintura blanca para interiores", 3, "cubos", 52.8, 158.4, {
        canonical_origin: "free_text",
      })],
      registry,
      { companyId: COMPANY_A }
    );

    assert.equal(lines[0].canonical_status, "review");
    assert.equal(lines[0].canonical_id, PAINT_MAT);
    assert.equal(lines[0].canonical_confidence, 0.7);
    assert.equal(lines[0].canonical_source, "synonym");
    assert.equal(
      lines[0].price_type,
      null,
      "un vínculo en revisión no puede escribir price_type"
    );
  });

  test("TEST 11d — 'ambiguous' tampoco recibe price_type", async () => {
    const registry = baseRegistry([
      alias(PAINT_MAT, "Trabajo con nombre ambiguo"),
      alias(WASTE_HAUL, "Trabajo con nombre ambiguo"),
    ]);

    const { lines } = await classifyBudgetItems(
      [line("Trabajo con nombre ambiguo", 1, "ud", 100, 100, { canonical_origin: "free_text" })],
      registry,
      { companyId: COMPANY_A }
    );

    assert.equal(lines[0].canonical_status, "ambiguous");
    assert.equal(lines[0].canonical_id, null);
    assert.equal(lines[0].canonical_confidence, null);
    assert.equal(lines[0].canonical_source, "exact_curated");
    assert.equal(lines[0].price_type, null);
  });

  test("TEST 11b — default_price_type NO se usa como sustituto", async () => {
    // PAINT_WALL tiene default_price_type 'LABOR_AND_MATERIAL'. Si alguien decidiera
    // "rellenar" con el default, este test lo vería.
    const { lines } = await classifyBudgetItems(PRESUPUESTO, baseRegistry(), {
      companyId: COMPANY_A,
    });
    assert.notEqual(lines[0].price_type, "LABOR_AND_MATERIAL");
    assert.equal(lines[0].price_type, null);
  });
});
