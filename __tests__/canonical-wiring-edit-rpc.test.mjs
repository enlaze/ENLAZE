/**
 * FASE 2D-5 — Cableado canónico de la EDICIÓN CLÁSICA vía RPC.
 *
 * Este camino no se parece a los otros dos. `saveDraft` y `finalizeBudget` escriben
 * desde el cliente: clasifican, borran y vuelven a insertar con tres llamadas de red
 * distintas, y entre el DELETE y el INSERT hay un hueco real en el que el presupuesto
 * no existe. `budget-form.tsx` no: le entrega las filas a la RPC
 * `update_budget_with_items`, que hace el UPDATE de `budgets`, el DELETE de las
 * partidas y el INSERT de las nuevas dentro de una única función de PostgreSQL, y por
 * tanto dentro de una única transacción.
 *
 * Eso reparte el contrato en dos mitades que hay que proteger por separado:
 *
 *   EN JAVASCRIPT — que las filas lleguen a la RPC ya enriquecidas, con la economía
 *   intacta, en el mismo número y el mismo orden, y que ninguna avería canónica
 *   impida guardar. Se comprueba ejecutando el cableado real contra un cliente falso
 *   que registra lo que recibe `rpc()`.
 *
 *   EN SQL — que la función de destino LISTE las siete columnas canónicas y no toque
 *   ninguna económica. Una fila perfectamente enriquecida no sirve de nada si el
 *   INSERT de la RPC no la nombra: se perdería en el último centímetro, en silencio y
 *   sin error. Eso no se puede comprobar con un doble de JavaScript, así que se
 *   comprueba sobre el SQL de la migración, con un control negativo que exige que
 *   quitar cualquiera de las siete rompa la suite.
 *
 * No se toca Supabase.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
const { computeBudgetTotals, assertBudgetTotalsConsistent } = await import(
  path.join(root, "lib/budget-totals.ts")
);

const FORM_PATH = "app/dashboard/budgets/_components/budget-form.tsx";
const MIGRACION_PATH =
  "supabase/migrations/20260826103500_update_budget_with_items_canonical.sql";

const formSrc = fs.readFileSync(path.join(root, FORM_PATH), "utf8");
const migracionSrc = fs.readFileSync(path.join(root, MIGRACION_PATH), "utf8");

/**
 * El fichero SIN comentarios.
 *
 * Hace falta para poder afirmar que algo NO está en el código. Estos ficheros explican
 * en prosa lo que deliberadamente no hacen —"llamar a `syncClassifiedBudgetItems` aquí
 * habría devuelto el DELETE + INSERT al cliente"—, así que buscar el nombre a pelo
 * encuentra la explicación y da un falso positivo. Lo que importa es si se INVOCA.
 */
function sinComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((linea) => linea.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const formCodigo = sinComentarios(formSrc);

/** El bloque de edición DENTRO de `handleSubmit`, no el de la carga inicial. */
function bloqueDeEdicion(src) {
  const iSubmit = src.indexOf("async function handleSubmit");
  assert.ok(iSubmit > 0, "no se encuentra handleSubmit");

  const iInicio = src.indexOf("if (editBudgetId) {", iSubmit);
  assert.ok(iInicio > iSubmit, "no se encuentra el bloque de edición dentro de handleSubmit");

  const iFin = src.indexOf("const year = new Date().getFullYear();", iInicio);
  assert.ok(iFin > iInicio, "no se encuentra el final del bloque de edición");

  return src.slice(iInicio, iFin);
}

// ─── Tenant y vocabulario ─────────────────────────────────────────────────────

const EMPRESA = "0f9b6c1e-3f2a-4c7d-9b1e-2a8c6d4f0e11";
const PRESUPUESTO_ID = "e5f6a7b8-0000-4000-8000-0000000000ee";

const PAINT_WALL = "WORK.PAINT.EMULSION.WALL.2COATS";
const PAINT_MAT = "MAT.PAINT.EMULSION.INTERIOR_MATT";
const WASTE_HAUL = "WORK.WASTE.CONTAINER.HAUL";
const PRIMER = "WORK.PAINT.PRIMER.APPLY";

function concepto(canonical_id, kind, allowed, i) {
  return {
    id: `c1a2c3d4-${String(i).padStart(4, "0")}-4a00-9000-${String(i).padStart(12, "0")}`,
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
    id: `a1000000-0000-4000-8000-${String(aliasSeq).padStart(12, "0")}`,
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

// ─── Cliente falso: lee vocabulario y expone `rpc()` ──────────────────────────

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
 * `stats` cuenta por separado las lecturas de vocabulario y las llamadas a la RPC,
 * y guarda el `p_items` EXACTO que recibió. Ahí es donde se lee todo lo que este
 * camino promete: no hay tabla en memoria porque el cliente ya no escribe filas.
 *
 * `deletes` e `inserts` existen para poder afirmar que valen CERO: si alguien
 * volviese a meter un DELETE + INSERT de cliente en este camino, se perdería la
 * atomicidad de la RPC y estos contadores lo delatarían.
 */
function fakeSupabase(tables, options = {}) {
  const failures = options.failures ?? {};
  const stats = {
    queryCount: 0,
    byTable: {},
    deletes: 0,
    inserts: 0,
    rpcCalls: [],
  };

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
        eq() {
          stats.deletes += 1;
          return Promise.resolve({ error: null });
        },
      }),
      insert() {
        stats.inserts += 1;
        return Promise.resolve({ error: null });
      },
      then(onfulfilled) {
        stats.queryCount += 1;
        stats.byTable[table] = (stats.byTable[table] ?? 0) + 1;
        if (failures[table] !== undefined) {
          return Promise.resolve(onfulfilled({ data: null, error: { message: failures[table] } }));
        }
        const found = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
        return Promise.resolve(onfulfilled({ data: found.map((r) => ({ ...r })), error: null }));
      },
    };
    return builder;
  }

  function rpc(name, params) {
    stats.rpcCalls.push({ name, params });
    if (options.rpcError) return Promise.resolve({ data: null, error: options.rpcError });
    return Promise.resolve({ data: { id: PRESUPUESTO_ID, version: 2 }, error: null });
  }

  return { client: { from, rpc }, stats };
}

// ─── El estado del formulario clásico ────────────────────────────────────────

/**
 * Una partida tal y como vive en el estado de `budget-form.tsx`. A diferencia del
 * asistente, aquí `unit_price` y `subtotal` son los campos reales —no hay
 * `unit_price_client`— y no existe `status`: en el formulario clásico todas las
 * partidas entran.
 */
function partida(concept, quantity, unit, unit_price, extra = {}) {
  return {
    concept,
    description: `${concept} — ejecución completa`,
    quantity,
    unit,
    category: "mano_obra",
    unit_price,
    subtotal: Math.round(quantity * unit_price * 100) / 100,
    canonical_origin: null,
    canonical_source_ref: null,
    ...extra,
  };
}

/** Seis partidas que cubren los cuatro estados y las cinco procedencias vivas. */
function partidas() {
  return [
    partida("Pintura plástica en paredes", 58, "m2", 15.64, { canonical_origin: "ai" }),
    partida("Pintura plástica blanca mate interior 15 L", 3, "ud", 52.8, {
      canonical_origin: "engine",
      category: "material",
    }),
    partida("Pintura blanca para interiores", 2, "ud", 47.31, {
      canonical_origin: "free_text",
    }),
    partida("Trabajo con nombre ambiguo", 1, "ud", 133.07, {
      canonical_origin: "free_text",
    }),
    partida("Un concepto que no está en el vocabulario", 12, "ml", 9.31, {
      canonical_origin: "import",
      canonical_source_ref: "cype_2026",
    }),
    partida("Imprimación de paredes y techos", 41, "m2", 6.13, {
      canonical_origin: "provider",
      canonical_source_ref: "leroy_2026",
    }),
  ];
}

// ─── El cableado real, replicado paso a paso ─────────────────────────────────

/**
 * RÉPLICA del bloque de edición de `handleSubmit`, en el mismo orden.
 *
 * El orden ES el contrato: `resolveTenant` antes de enriquecer, el enriquecimiento
 * antes del cuadre, y el cuadre antes de la RPC. Cambiar cualquiera de los tres
 * cambia lo que pasa cuando algo se avería, y por eso hay más abajo un test que
 * comprueba ese mismo orden sobre el fichero real.
 */
async function editar(entrada, opciones = {}) {
  const { client, stats } = fakeSupabase(DB, opciones);
  const authResponse =
    opciones.authResponse ?? { data: { user: { id: EMPRESA } }, error: null };

  const subtotalMostrado = entrada.reduce((sum, p) => sum + p.subtotal, 0);

  let tenant;
  try {
    tenant = resolveTenant(authResponse);
  } catch (err) {
    tenant = resolveTenant({ error: err });
  }

  const { items, report } = await enrichForPersistence({
    items: entrada,
    tenant,
    context: "editBudget",
    supabase: client,
    ...(opciones.classify ? { classify: opciones.classify } : {}),
    ...(opciones.loadSnapshot ? { loadSnapshot: opciones.loadSnapshot } : {}),
  });

  assertBudgetTotalsConsistent(
    subtotalMostrado,
    computeBudgetTotals({ lines: items }),
    "editBudget",
  );

  const { error } = await client.rpc("update_budget_with_items", {
    p_budget_id: PRESUPUESTO_ID,
    p_budget_data: { title: "Reforma", iva_percent: 21 },
    p_items: items,
  });

  return { items, report, stats, error, tenant, subtotalMostrado, entrada };
}

/**
 * "Estas líneas suman lo que se mostró", comprobado como lo comprueba el código real.
 *
 * NO se usa igualdad estricta contra la suma en coma flotante del formulario. El
 * formulario acumula con `+` (y da 1656.2599999999998) mientras que
 * `computeBudgetTotals` trabaja en céntimos (y da 1656.26). La diferencia es del
 * orden de 10⁻¹³ €: es el error de coma flotante que `lib/budget-totals` existe
 * precisamente para no propagar, y la puerta real —`assertBudgetTotalsConsistent`,
 * que compara céntimos— la tolera. Exigir igualdad estricta aquí no habría medido el
 * cuadre del presupuesto: habría medido que dos formas de sumar coinciden bit a bit,
 * que no es el contrato y que además es falso a propósito.
 */
function assertCuadra(lineas, subtotalMostrado, mensaje) {
  assert.doesNotThrow(
    () => assertBudgetTotalsConsistent(subtotalMostrado, computeBudgetTotals({ lines: lineas }), "editBudget"),
    mensaje,
  );
}

/** Lo que la RPC recibió de verdad como `p_items`. */
function itemsEnviados(stats) {
  assert.equal(stats.rpcCalls.length, 1, "se esperaba exactamente una llamada a la RPC");
  assert.equal(stats.rpcCalls[0].name, "update_budget_with_items");
  return stats.rpcCalls[0].params.p_items;
}

// ══════════════════════════════════════════════════════════════════════════════
// A · Las siete columnas llegan a la RPC
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-5 · A — la RPC recibe las siete columnas canónicas", () => {
  test("CASO 1 — cada fila enviada lleva las siete claves, sin faltar ninguna", async () => {
    const { stats } = await editar(partidas());
    const enviados = itemsEnviados(stats);

    assert.equal(CANONICAL_COLUMN_KEYS.length, 7, "el contrato canónico ya no son siete columnas");

    for (const fila of enviados) {
      for (const clave of CANONICAL_COLUMN_KEYS) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(fila, clave),
          `la fila '${fila.concept}' llegó a la RPC sin la columna '${clave}'`,
        );
      }
    }
  });

  test("CASO 2 — los cuatro estados canónicos llegan a la RPC", async () => {
    const { stats } = await editar(partidas());
    const estados = new Set(itemsEnviados(stats).map((f) => f.canonical_status));

    for (const esperado of ["resolved", "review", "ambiguous", "unmatched"]) {
      assert.ok(
        estados.has(esperado),
        `el fixture dejó de ejercitar el estado '${esperado}': los tests de estado ya no prueban nada`,
      );
    }
  });

  test("CASO 3 — una fila 'resolved' llega con id, confianza y fuente coherentes", async () => {
    const { stats } = await editar(partidas());
    const resueltas = itemsEnviados(stats).filter((f) => f.canonical_status === "resolved");

    assert.ok(resueltas.length > 0);
    for (const fila of resueltas) {
      assert.ok(fila.canonical_id, "resolved sin canonical_id: rompería ck_canonical_coherence");
      assert.equal(Number(fila.canonical_confidence), 1);
      assert.ok(fila.canonical_source, "resolved sin canonical_source");
    }
  });

  test("CASO 4 — una fila 'unmatched' llega con las tres derivadas a null", async () => {
    const { stats } = await editar(partidas());
    const sinCasar = itemsEnviados(stats).filter((f) => f.canonical_status === "unmatched");

    assert.ok(sinCasar.length > 0);
    for (const fila of sinCasar) {
      // Es exactamente lo que exige ck_canonical_coherence para 'unmatched'.
      assert.equal(fila.canonical_id, null);
      assert.equal(fila.canonical_confidence, null);
      assert.equal(fila.canonical_source, null);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B · La procedencia sobrevive al viaje
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-5 · B — la procedencia se conserva hasta la RPC", () => {
  test("CASO 5 — ai, engine y free_text llegan intactos", async () => {
    const entrada = partidas();
    const { stats } = await editar(entrada);
    const enviados = itemsEnviados(stats);

    for (const origen of ["ai", "engine", "free_text"]) {
      const esperadas = entrada.filter((p) => p.canonical_origin === origen);
      assert.ok(esperadas.length > 0, `el fixture ya no contiene ninguna fila '${origen}'`);

      for (const original of esperadas) {
        const enviada = enviados.find((f) => f.concept === original.concept);
        assert.equal(
          enviada.canonical_origin,
          origen,
          `'${original.concept}' salió como '${enviada.canonical_origin}' en vez de '${origen}'`,
        );
        // Estos tres orígenes NO admiten source_ref: ck_origin_source_ref lo exige nulo.
        assert.equal(enviada.canonical_source_ref, null);
      }
    }
  });

  test("CASO 6 — import conserva su source_ref", async () => {
    const { stats } = await editar(partidas());
    const fila = itemsEnviados(stats).find(
      (f) => f.concept === "Un concepto que no está en el vocabulario",
    );

    assert.equal(fila.canonical_origin, "import");
    assert.equal(fila.canonical_source_ref, "cype_2026");
  });

  test("CASO 7 — provider conserva su source_ref", async () => {
    const { stats } = await editar(partidas());
    const fila = itemsEnviados(stats).find((f) => f.concept === "Imprimación de paredes y techos");

    assert.equal(fila.canonical_origin, "provider");
    assert.equal(fila.canonical_source_ref, "leroy_2026");
  });

  test("CASO 8 — una fila sin procedencia sigue sin procedencia: no se inventa", async () => {
    const entrada = [partida("Concepto huérfano sin origen", 4, "ud", 25)];
    const { stats } = await editar(entrada);
    const fila = itemsEnviados(stats)[0];

    assert.equal(fila.canonical_origin, null, "se inventó una procedencia que nadie selló");
    assert.equal(fila.canonical_source_ref, null);
  });

  test("CASO 9 — el par (origin, source_ref) enviado siempre satisface ck_origin_source_ref", async () => {
    const { stats } = await editar(partidas());

    // El constraint real de la tabla, replicado. Si una sola fila lo violase, la RPC
    // fallaría entera y la edición se perdería: esto es lo que impide que el
    // enriquecimiento pueda BLOQUEAR un guardado.
    const exigenRef = new Set(["import", "provider"]);
    const prohibenRef = new Set(["engine", "ai", "free_text", "legacy"]);

    for (const fila of itemsEnviados(stats)) {
      const { canonical_origin: origen, canonical_source_ref: ref } = fila;
      if (origen === null) {
        assert.equal(ref, null, `'${fila.concept}': origin nulo con source_ref`);
      } else if (exigenRef.has(origen)) {
        assert.ok(ref, `'${fila.concept}': '${origen}' exige source_ref y llegó sin él`);
        assert.match(ref, /^[a-z0-9][a-z0-9_-]*$/, `'${fila.concept}': source_ref con formato inválido`);
      } else {
        assert.ok(prohibenRef.has(origen), `'${fila.concept}': origen '${origen}' fuera del dominio`);
        assert.equal(ref, null, `'${fila.concept}': '${origen}' no admite source_ref`);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C · La economía no se toca
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-5 · C — misma economía, mismo número de líneas, mismo orden", () => {
  test("CASO 10 — el número de líneas enviadas es el mismo que el del formulario", async () => {
    const entrada = partidas();
    const { stats } = await editar(entrada);

    assert.equal(itemsEnviados(stats).length, entrada.length);
  });

  test("CASO 11 — el orden se conserva línea a línea", async () => {
    const entrada = partidas();
    const { stats } = await editar(entrada);
    const enviados = itemsEnviados(stats);

    assert.deepEqual(
      enviados.map((f) => f.concept),
      entrada.map((p) => p.concept),
      "el enriquecimiento reordenó las partidas del presupuesto",
    );
  });

  test("CASO 12 — cantidad, precio y subtotal llegan idénticos", async () => {
    const entrada = partidas();
    const { stats } = await editar(entrada);
    const enviados = itemsEnviados(stats);

    entrada.forEach((original, i) => {
      assert.equal(enviados[i].quantity, original.quantity, `cantidad alterada en '${original.concept}'`);
      assert.equal(enviados[i].unit_price, original.unit_price, `precio alterado en '${original.concept}'`);
      assert.equal(enviados[i].subtotal, original.subtotal, `subtotal alterado en '${original.concept}'`);
    });
  });

  test("CASO 13 — el subtotal recalculado sobre lo enviado es el que se mostró", async () => {
    const entrada = partidas();
    const { stats, subtotalMostrado } = await editar(entrada);

    assertCuadra(
      itemsEnviados(stats),
      subtotalMostrado,
      "las líneas que llegaron a la RPC ya no suman lo que se le mostró al usuario",
    );
    // Y el subtotal de las líneas enviadas es el de las originales, al céntimo.
    assert.equal(
      computeBudgetTotals({ lines: itemsEnviados(stats) }).subtotal,
      computeBudgetTotals({ lines: entrada }).subtotal,
    );
  });

  test("CASO 14 — el concepto, la unidad y la categoría no se reescriben", async () => {
    const entrada = partidas();
    const { stats } = await editar(entrada);
    const enviados = itemsEnviados(stats);

    entrada.forEach((original, i) => {
      assert.equal(enviados[i].concept, original.concept);
      assert.equal(enviados[i].unit, original.unit);
      assert.equal(enviados[i].category, original.category);
      assert.equal(enviados[i].description, original.description);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D · Fail-open: una avería canónica no impide guardar
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-5 · D — fail-open canónico: la RPC siempre se llama", () => {
  /** Comprueba de una vez las tres cosas que definen el fail-open. */
  async function esperarFailOpen(nombre, opciones, causaEsperada) {
    const entrada = partidas();
    const { stats, report, subtotalMostrado } = await editar(entrada, opciones);
    const enviados = itemsEnviados(stats);

    assert.equal(stats.rpcCalls.length, 1, `${nombre}: la avería impidió llamar a la RPC`);
    assert.equal(report.degraded, causaEsperada, `${nombre}: el informe no señala la avería`);

    // Economía intacta: la RPC recibe siempre un presupuesto que cuadra.
    assertCuadra(enviados, subtotalMostrado, `${nombre}: la avería descuadró el presupuesto`);
    assert.equal(enviados.length, entrada.length);
    entrada.forEach((original, i) => {
      assert.equal(enviados[i].subtotal, original.subtotal);
      assert.equal(enviados[i].concept, original.concept);
    });

    return { enviados, report, entrada };
  }

  test("CASO 15 — el snapshot se avería: se guarda igual, todo unmatched", async () => {
    const { enviados } = await esperarFailOpen(
      "snapshot",
      { failures: { canonical_aliases: "conexión perdida" } },
      "snapshot",
    );

    for (const fila of enviados) {
      assert.equal(fila.canonical_status, "unmatched");
    }
  });

  test("CASO 16 — la avería de snapshot NO borra la procedencia", async () => {
    const entrada = partidas();
    const { stats } = await editar(entrada, {
      failures: { canonical_aliases: "conexión perdida" },
    });
    const enviados = itemsEnviados(stats);

    // La procedencia la aporta el estado, no el clasificador: que el vocabulario se
    // caiga no puede borrar de dónde nació la línea.
    entrada.forEach((original, i) => {
      assert.equal(
        enviados[i].canonical_origin,
        original.canonical_origin,
        `'${original.concept}': la avería del snapshot se llevó por delante la procedencia`,
      );
      assert.equal(enviados[i].canonical_source_ref, original.canonical_source_ref);
    });
  });

  test("CASO 17 — el clasificador LANZA: se guarda igual", async () => {
    const { enviados } = await esperarFailOpen(
      "clasificador",
      {
        classify: () => {
          throw new Error("el clasificador reventó");
        },
      },
      "classifier",
    );

    for (const fila of enviados) {
      assert.equal(fila.canonical_status, "unmatched");
    }
  });

  test("CASO 18 — el clasificador ALTERA la economía: se envían los importes originales", async () => {
    const entrada = partidas();
    const { stats, report } = await editar(entrada, {
      // Sabotaje realista: una clasificación que además "corrige" un precio.
      classify: (lines) => ({
        lines: lines.map((l, i) => ({
          ...l,
          unit_price: i === 0 ? l.unit_price * 2 : l.unit_price,
          canonical_id: null,
          canonical_status: "unmatched",
          canonical_confidence: null,
          canonical_source: null,
          canonical_origin: l.canonical_origin ?? null,
          canonical_source_ref: l.canonical_source_ref ?? null,
          price_type: null,
        })),
        stats: {},
      }),
    });

    assert.equal(report.degraded, "economic_integrity", "la guarda de integridad no detectó el destrozo");

    const enviados = itemsEnviados(stats);
    assert.equal(
      enviados[0].unit_price,
      entrada[0].unit_price,
      "el precio manipulado por el clasificador llegó hasta la RPC",
    );
    assert.equal(stats.rpcCalls.length, 1, "una avería canónica bloqueó la edición");
  });

  test("CASO 19 — auth falla pero devuelve un user residual: companyId nulo", async () => {
    const entrada = partidas();
    const { tenant, stats } = await editar(entrada, {
      // Éste es el caso peligroso: `getUser()` devuelve error Y un user. Ese user no
      // es una identidad verificada y no puede acabar filtrando alias privados.
      authResponse: { data: { user: { id: EMPRESA } }, error: { message: "token caducado" } },
    });

    assert.equal(tenant.companyId, null, "una identidad no verificada acabó en el filtro de tenant");
    assert.equal(tenant.tenantContext, "unavailable");
    assert.equal(stats.rpcCalls.length, 1, "un fallo de auth impidió guardar la edición");
  });

  test("CASO 20 — un fallo de auth sigue permitiendo clasificar con vocabulario global", async () => {
    const { report } = await editar(partidas(), {
      authResponse: { data: { user: { id: EMPRESA } }, error: { message: "token caducado" } },
    });

    assert.equal(report.tenant_context, "unavailable");
    assert.ok(report.resolved > 0, "sin tenant no se clasificó nada, ni siquiera con alias globales");
  });

  test("CASO 21 — un descuadre económico REAL sí detiene el guardado", async () => {
    // Control de sensibilidad. El fail-open no puede ser tan permisivo que deje
    // pasar un presupuesto cuyas líneas no suman lo que se le mostró al usuario.
    const entrada = partidas();
    const { client } = fakeSupabase(DB);

    const { items } = await enrichForPersistence({
      items: entrada,
      tenant: resolveTenant({ data: { user: { id: EMPRESA } }, error: null }),
      context: "editBudget",
      supabase: client,
    });

    assert.throws(
      () =>
        assertBudgetTotalsConsistent(
          entrada.reduce((s, p) => s + p.subtotal, 0) + 100,
          computeBudgetTotals({ lines: items }),
          "editBudget",
        ),
      /BUDGET_TOTAL_MISMATCH|no cuadr|mismatch/i,
      "la puerta dejó pasar un presupuesto descuadrado",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// E · La RPC es el único escritor
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-5 · E — el cliente no escribe: escribe PostgreSQL", () => {
  test("CASO 22 — el cableado no hace ningún DELETE ni INSERT de cliente", async () => {
    const { stats } = await editar(partidas());

    assert.equal(stats.deletes, 0, "hay un DELETE de cliente: se pierde la atomicidad de la RPC");
    assert.equal(stats.inserts, 0, "hay un INSERT de cliente: se pierde la atomicidad de la RPC");
    assert.equal(stats.rpcCalls.length, 1);
  });

  test("CASO 23 — el formulario llama a la RPC y no sincroniza desde el cliente", () => {
    assert.match(formCodigo, /supabase\.rpc\(\s*\n?\s*"update_budget_with_items"/);
    // Se mira el código, no los comentarios: el fichero EXPLICA por qué no usa
    // `syncClassifiedBudgetItems`, así que el nombre aparece en prosa a propósito.
    assert.ok(
      !formCodigo.includes("syncClassifiedBudgetItems"),
      "budget-form invoca syncClassifiedBudgetItems: eso devuelve el DELETE + INSERT al cliente",
    );
  });

  test("CASO 24 — el segundo escritor directo del formulario sigue intacto (queda para 2D-7)", () => {
    // El bucle de creación inserta partidas fila a fila y NO se toca en esta fase.
    // Este test no lo aprueba: fija que sigue ahí, para que 2D-7 encuentre lo que espera.
    assert.match(formSrc, /for \(const p of partidas\) \{[\s\S]*?from\("budget_items"\)\.insert\(/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// F · El resultado clasificado no vuelve al estado de React
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-5 · F — la clasificación es de PERSISTENCIA, no de estado", () => {
  test("CASO 25 — enriquecer no muta los objetos del estado del formulario", async () => {
    const entrada = partidas();
    const copiaPrevia = JSON.parse(JSON.stringify(entrada));

    await editar(entrada);

    assert.deepEqual(
      JSON.parse(JSON.stringify(entrada)),
      copiaPrevia,
      "el enriquecimiento mutó `partidas`: la clasificación se filtró al estado de React",
    );
  });

  test("CASO 26 — las cinco derivadas no aparecen en el estado del formulario", async () => {
    const entrada = partidas();
    await editar(entrada);

    for (const fila of entrada) {
      for (const derivada of [
        "canonical_id",
        "canonical_status",
        "canonical_confidence",
        "canonical_source",
        "price_type",
      ]) {
        assert.ok(
          !Object.prototype.hasOwnProperty.call(fila, derivada),
          `'${derivada}' se coló en el estado: es DERIVADA y volvería a clasificarse sobre sí misma`,
        );
      }
    }
  });

  test("CASO 27 — el formulario no llama a setPartidas con el resultado clasificado", () => {
    assert.ok(
      !/setPartidas\(\s*classifiedPartidas/.test(formSrc),
      "el resultado de la clasificación vuelve al estado: eso es el bucle que 2D-4 evitó",
    );
  });

  test("CASO 28 — el tipo Partida sólo declara las dos columnas APORTADAS", () => {
    const bloque = /interface Partida \{([\s\S]*?)\n\}/.exec(formSrc);
    assert.ok(bloque, "no se encuentra la interfaz Partida");

    assert.match(bloque[1], /canonical_origin\?:/);
    assert.match(bloque[1], /canonical_source_ref\?:/);
    for (const derivada of ["canonical_id", "canonical_status", "canonical_confidence", "price_type"]) {
      assert.ok(
        !bloque[1].includes(derivada),
        `Partida declara '${derivada}', que es DERIVADA y no debe vivir en el estado`,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G · La lectura tampoco puede perder la procedencia
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-5 · G — la carga del formulario conserva la procedencia", () => {
  test("CASO 29 — la proyección de carga copia las dos columnas aportadas", () => {
    // Sin esto, cerrar la escritura no habría servido de nada: el formulario tiraba la
    // procedencia AL LEER, así que la RPC no habría tenido nunca nada que conservar.
    const bloque = /existingItems\.map\(\(item\) => \(\{([\s\S]*?)\}\)\)/.exec(formSrc);
    assert.ok(bloque, "no se encuentra la proyección de carga de partidas");

    assert.match(bloque[1], /canonical_origin: \(item\.canonical_origin \?\? null\)/);
    assert.match(bloque[1], /canonical_source_ref: \(item\.canonical_source_ref \?\? null\)/);
  });

  test("CASO 30 — la carga sigue trayendo la fila entera", () => {
    // `select("*")` es lo que hace que las dos columnas estén disponibles.
    assert.match(
      formSrc,
      /from\("budget_items"\)\s*\n?\s*\.select\("\*"\)/,
      "la carga dejó de traer todas las columnas: la procedencia ya no estaría disponible",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// H · El orden del cableado
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-5 · H — el orden de los pasos es el contrato", () => {
  test("CASO 31 — resolveTenant → enrichForPersistence → cuadre → rpc", () => {
    const iTenant = formSrc.indexOf("resolveTenant(await supabase.auth.getUser())");
    const iEnriquecer = formSrc.indexOf("await enrichForPersistence({");
    const iCuadre = formSrc.indexOf("assertBudgetTotalsConsistent(");
    const iRpc = formSrc.indexOf('"update_budget_with_items"');

    assert.ok(iTenant > 0, "no se encuentra la resolución de tenant en el formulario");
    assert.ok(iEnriquecer > iTenant, "se enriquece antes de resolver el tenant");
    assert.ok(iCuadre > iEnriquecer, "el cuadre corre ANTES del enriquecimiento: deja sin vigilar el código nuevo");
    assert.ok(iRpc > iCuadre, "se llama a la RPC sin haber pasado la puerta de cuadre");
  });

  test("CASO 32 — se envían las filas enriquecidas, no las del estado", () => {
    assert.match(
      formSrc,
      /p_items: classifiedPartidas/,
      "la RPC recibe `partidas` en crudo: el enriquecimiento no llega a persistirse",
    );
  });

  test("CASO 33 — el contexto declarado es 'editBudget'", async () => {
    const { report } = await editar(partidas());
    assert.equal(report.tenant_context, "resolved");
    assert.match(formSrc, /context: "editBudget"/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// I · El contrato SQL de la migración
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Extrae la lista de columnas del INSERT final en `budget_items` de la migración.
 *
 * Se localiza por el DELETE que lo precede para no confundirlo con ningún otro
 * INSERT del cuerpo (el del snapshot escribe en `budget_snapshots`).
 */
function insertDeBudgetItems(sql) {
  const iDelete = sql.indexOf("delete from public.budget_items");
  assert.ok(iDelete > 0, "no se encuentra el DELETE de budget_items en la migración");

  const marca = "insert into public.budget_items (";
  const iInsert = sql.indexOf(marca, iDelete);
  assert.ok(iInsert > 0, "no se encuentra el INSERT de budget_items posterior al DELETE");

  const iCierre = sql.indexOf(")", iInsert + marca.length);
  const columnas = sql
    .slice(iInsert + marca.length, iCierre)
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const iFrom = sql.indexOf("from jsonb_array_elements(p_items)", iCierre);
  assert.ok(iFrom > 0, "el INSERT no lee de p_items");

  return { columnas, cuerpo: sql.slice(iCierre, iFrom) };
}

describe("2D-5 · I — la función SQL transporta las siete columnas", () => {
  test("CASO 34 — el INSERT nombra las siete columnas canónicas", () => {
    const { columnas } = insertDeBudgetItems(migracionSrc);

    for (const clave of CANONICAL_COLUMN_KEYS) {
      assert.ok(
        columnas.includes(clave),
        `el INSERT de la RPC no nombra '${clave}': esa columna se perdería en silencio`,
      );
    }
  });

  test("CASO 35 — CONTROL NEGATIVO: quitar cualquiera de las siete rompe el test", () => {
    // Sin este control, el CASO 34 podría estar comprobando una lista que ya no es la
    // que importa. Aquí se mutila el SQL una vez por columna y se exige que la
    // comprobación falle EXACTAMENTE en la columna eliminada.
    for (const clave of CANONICAL_COLUMN_KEYS) {
      // Se contemplan las dos formas porque la ÚLTIMA columna de la lista va sin coma
      // final. Sin esta rama, la mutación de `price_type` no borraba nada y el control
      // negativo pasaba sin haber probado nada: exactamente el falso positivo que
      // este test existe para descartar.
      const mutilado = migracionSrc
        .split("\n")
        .filter((linea) => linea.trim() !== `${clave},` && linea.trim() !== clave)
        .join("\n");

      assert.notEqual(mutilado, migracionSrc, `la mutación de '${clave}' no cambió nada`);

      const { columnas } = insertDeBudgetItems(mutilado);
      assert.ok(
        !columnas.includes(clave),
        `quitar '${clave}' del INSERT no se detecta: el CASO 34 no protege nada`,
      );
    }
  });

  test("CASO 36 — las nueve columnas económicas siguen ahí y en el mismo orden", () => {
    const { columnas } = insertDeBudgetItems(migracionSrc);

    assert.deepEqual(
      columnas.slice(0, 9),
      [
        "budget_id",
        "concept",
        "description",
        "quantity",
        "unit",
        "category",
        "chapter",
        "unit_price",
        "subtotal",
      ],
      "cambió la parte económica del INSERT: esta fase sólo debía añadir transporte canónico",
    );
    assert.equal(columnas.length, 16, "el INSERT ya no son 9 económicas + 7 canónicas");
  });

  test("CASO 37 — el subtotal se sigue calculando igual", () => {
    const { cuerpo } = insertDeBudgetItems(migracionSrc);
    assert.match(
      cuerpo,
      /round\(\(item->>'quantity'\)::numeric \* \(item->>'unit_price'\)::numeric, 2\)/,
      "cambió el cálculo del subtotal de la línea",
    );
  });

  test("CASO 38 — canonical_status replica el default 'unmatched' de la columna", () => {
    // Al nombrar la columna en el INSERT, su DEFAULT deja de aplicarse. Sin este
    // coalesce, un p_items sin la clave insertaría NULL y rompería el NOT NULL, es
    // decir, rompería el flujo antiguo que sí funcionaba.
    const { cuerpo } = insertDeBudgetItems(migracionSrc);
    assert.match(cuerpo, /coalesce\(nullif\(item->>'canonical_status', ''\), 'unmatched'\)/);
  });

  test("CASO 39 — la RPC no clasifica: sólo transporta", () => {
    const { cuerpo } = insertDeBudgetItems(migracionSrc);

    for (const clave of CANONICAL_COLUMN_KEYS) {
      if (clave === "canonical_status") continue;
      assert.match(
        cuerpo,
        new RegExp(`item->>'${clave}'`),
        `'${clave}' no se lee de p_items: la RPC la estaría deduciendo por su cuenta`,
      );
    }

    // Un segundo sistema de clasificación dentro de SQL es justo lo que no debe haber.
    assert.ok(
      !/canonical_aliases|canonical_concepts|canonical_normalize/.test(migracionSrc),
      "la migración consulta el vocabulario canónico: eso es un segundo clasificador",
    );
  });

  test("CASO 40 — la migración conserva firma, retorno y modelo de seguridad", () => {
    assert.match(migracionSrc, /create or replace function public\.update_budget_with_items\(/);
    assert.match(migracionSrc, /p_budget_id uuid,\s*\n\s*p_budget_data jsonb,\s*\n\s*p_items jsonb/);
    assert.match(migracionSrc, /returns jsonb/);
    assert.match(migracionSrc, /language plpgsql/);
    assert.match(migracionSrc, /security definer/);
    assert.match(migracionSrc, /set search_path = public, pg_temp/);
  });

  test("CASO 41 — la migración no toca tablas ni datos", () => {
    const sinComentarios = migracionSrc
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");

    assert.ok(!/alter table/i.test(sinComentarios), "la migración altera una tabla");
    assert.ok(!/drop table|truncate/i.test(sinComentarios), "la migración destruye datos");
    // El único UPDATE/DELETE/INSERT permitido es el que vive DENTRO del cuerpo de la
    // función, que ya existía. No puede haber backfill al nivel de la migración.
    const cuerpoFuera = sinComentarios.split("as $$")[0] + sinComentarios.split("$$;")[1];
    assert.ok(!/update |delete |insert /i.test(cuerpoFuera), "hay un backfill fuera de la función");
  });

  test("CASO 42 — la migración fija la ACL de forma absoluta, no heredada", () => {
    // Invertido en 2D-5a. Antes este test exigía que NO hubiera grants, apoyándose en
    // que `create or replace` conserva la ACL. Eso es cierto en producción y falso en
    // una base nueva, que no tiene nada que conservar: los dos caminos divergían.
    // Ahora la migración declara el estado final y este test lo custodia.
    const codigo = migracionSrc
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");

    const FIRMA = "public\\.update_budget_with_items\\(uuid, jsonb, jsonb\\)";
    for (const rol of ["public", "anon", "service_role"]) {
      assert.ok(
        new RegExp(`revoke all on function\\s+${FIRMA}\\s+from ${rol};`, "i").test(codigo),
        `falta 'revoke all ... from ${rol}': la ACL volvería a depender del estado previo`,
      );
    }
    assert.ok(
      new RegExp(`grant execute on function\\s+${FIRMA}\\s+to authenticated;`, "i").test(codigo),
      "falta el grant a authenticated: el único llamador real se quedaría sin permiso",
    );
  });

  test("CASO 42b — la ACL se aplica DESPUÉS de crear la función y antes del notify final", () => {
    // Si el bloque fuese antes del `create or replace`, la creación de la función en una
    // base limpia volvería a dejar el EXECUTE por defecto a PUBLIC y el revoke no habría
    // servido de nada.
    //
    // El fichero NO lleva `begin;`/`commit;` a propósito: el runner del CLI agrupa todos
    // los statements en un único lote junto con el INSERT en `schema_migrations`, y ese
    // lote ya es la transacción. Cualquier control de transacción explícito lo degrada a
    // la ruta serie y separa el cambio de esquema de su registro en el historial. Por eso
    // el cierre que se exige aquí no es un `commit;` sino el `notify pgrst` final, que es
    // el último statement normal del fichero. La comprobación rigurosa (tokenizando SQL de
    // verdad, sin confundir el `begin`/`end` plpgsql del cuerpo) vive en
    // `__tests__/migration-transaction-control.test.mjs`.
    const iFuncion = migracionSrc.indexOf("create or replace function");
    const iRevoke = migracionSrc.search(/^revoke all on function/m);
    const iGrant = migracionSrc.search(/^grant execute on function/m);
    const iNotify = migracionSrc.search(/^notify pgrst, 'reload schema';/m);

    assert.ok(iFuncion > 0, "no se encuentra la función");
    assert.ok(iRevoke > iFuncion, "los revoke están antes de crear la función");
    assert.ok(iGrant > iRevoke, "el grant está antes de los revoke: se anularía");
    assert.ok(iNotify > iGrant, "el notify final no cierra el fichero después de la ACL");

    // Nada después del notify salvo espacio en blanco: la ACL no puede quedar colgando
    // detrás del recargado del esquema.
    assert.equal(
      migracionSrc.slice(iNotify).replace(/^notify pgrst, 'reload schema';/, "").trim(),
      "",
      "hay statements después del `notify pgrst, 'reload schema';`",
    );

    // Y el fichero no reintroduce control de transacción. Aquí sólo se vigilan las formas
    // que no pueden confundirse con plpgsql: `end;` sí aparece en columna 0 cerrando el
    // cuerpo de la función, y distinguirlo exige tokenizar, que es lo que hace el test
    // dedicado.
    assert.doesNotMatch(
      migracionSrc,
      /^[ \t]*(begin|commit|start transaction|abort|rollback)[ \t]*;/im,
      "el fichero ha vuelto a llevar control de transacción de nivel superior",
    );
  });

  test("CASO 42c — control negativo: quitar cualquier línea de la ACL rompe CASO 42", () => {
    const lineas = [
      /revoke all on function\s+public\.update_budget_with_items\(uuid, jsonb, jsonb\)\s+from public;/i,
      /revoke all on function\s+public\.update_budget_with_items\(uuid, jsonb, jsonb\)\s+from anon;/i,
      /revoke all on function\s+public\.update_budget_with_items\(uuid, jsonb, jsonb\)\s+from service_role;/i,
      /grant execute on function\s+public\.update_budget_with_items\(uuid, jsonb, jsonb\)\s+to authenticated;/i,
    ];
    for (const re of lineas) {
      assert.match(migracionSrc, re, `CASO 42 no está midiendo: no existe ${re}`);
      const mutilado = migracionSrc.replace(re, "");
      assert.notEqual(mutilado, migracionSrc, `la mutación de ${re} no cambió nada`);
      assert.doesNotMatch(mutilado, re, "la mutación no eliminó realmente la línea");
    }
  });

  test("CASO 42d — nada vuelve a conceder a anon, service_role ni PUBLIC", () => {
    // El objetivo es un estado final, no una lista de órdenes. Un `grant ... to anon`
    // añadido más abajo dejaría los revoke sin efecto y CASO 42 seguiría pasando.
    const codigo = migracionSrc
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const rol of ["anon", "service_role", "public"]) {
      assert.ok(
        !new RegExp(`grant\\s+[^;]*\\s+to\\s+${rol}\\s*;`, "i").test(codigo),
        `la migración concede permisos a '${rol}', que debía quedarse sin EXECUTE`,
      );
    }
  });

  test("CASO 43 — la migración conserva el bloque de descuentos de PRODUCCIÓN", () => {
    // La función desplegada está por delante del repositorio: tiene descuentos y
    // calendario de pagos que ninguna migración del repo introduce. Regenerar desde el
    // repo los habría revertido y habría cambiado importes de presupuestos vivos.
    for (const marca of [
      "v_discount_type",
      "v_discount_percent",
      "v_discount_amount",
      "v_taxable_base",
      "v_payment_schedule",
    ]) {
      assert.ok(
        migracionSrc.includes(marca),
        `la migración perdió '${marca}': revertiría el cálculo económico de producción`,
      );
    }
    assert.match(
      migracionSrc,
      /iva_amount = round\(v_taxable_base \* v_iva_percent \/ 100, 2\)/,
      "el IVA volvió a calcularse sobre el subtotal en vez de sobre la base imponible",
    );
  });

  test("CASO 43b — el UPDATE de budgets sigue escribiendo las cinco columnas económicas", () => {
    // CASO 43 comprueba que existen las VARIABLES. Esto es distinto: comprueba que su
    // valor llega a la tabla. Una migración podría declarar `v_discount_amount`,
    // calcularlo y luego no asignarlo, y CASO 43 pasaría igualmente.
    const iUpdate = migracionSrc.indexOf("update public.budgets");
    assert.ok(iUpdate > 0, "no se encuentra el UPDATE de budgets");
    const iFin = migracionSrc.indexOf("returning * into v_budget", iUpdate);
    assert.ok(iFin > iUpdate, "no se encuentra el final del UPDATE de budgets");
    const setUpdate = migracionSrc.slice(iUpdate, iFin);

    for (const [columna, valor] of [
      ["discount_type", "v_discount_type"],
      ["discount_percent", "v_discount_percent"],
      ["discount_amount", "v_discount_amount"],
      ["payment_schedule", "v_payment_schedule"],
    ]) {
      assert.ok(
        new RegExp(`\\b${columna}\\s*=\\s*${valor}\\b`).test(setUpdate),
        `el UPDATE dejó de escribir '${columna}': se perdería al editar`,
      );
    }

    // `taxable_base` no es una columna: es la base imponible que alimenta a las dos
    // que sí lo son. Se comprueba por su efecto.
    assert.ok(
      /\btotal\s*=\s*round\(v_taxable_base/.test(setUpdate),
      "el total dejó de calcularse sobre la base imponible",
    );
  });

  test("CASO 43c — control negativo: quitar cualquiera de las cinco rompe CASO 43b", () => {
    // Sin esto, CASO 43b podría estar comprobando expresiones que ya no existen y pasar
    // por vacío. Se mutila la migración y se exige que la mutilación se note.
    for (const columna of [
      "discount_type",
      "discount_percent",
      "discount_amount",
      "payment_schedule",
    ]) {
      const mutilado = migracionSrc.replace(
        new RegExp(`\\b${columna}\\s*=\\s*v_${columna}\\b`),
        "",
      );
      assert.notEqual(
        mutilado,
        migracionSrc,
        `la mutación de '${columna}' no cambió nada: CASO 43b no está midiendo lo que dice`,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// I-ter · FASE 2D-5a · el historial de migraciones no vuelve a perder esos ficheros
// ══════════════════════════════════════════════════════════════════════════════
//
// Las dos migraciones que introdujeron los descuentos, el calendario de pagos y el
// IBAN se aplicaron desde el panel de Supabase y nunca se versionaron. Producción
// las tenía registradas; el repositorio no las tenía en absoluto. Se han recuperado
// de `supabase_migrations.schema_migrations.statements` y escrito byte a byte.
//
// Los md5 de abajo son los que devuelve la propia base de datos sobre el SQL que
// ejecutó. Si alguien reescribe, reformatea o borra estos ficheros, una instalación
// limpia dejaría de reproducir producción y este test lo dice antes de que ocurra.
describe("FASE 2D-5a · migraciones históricas recuperadas de producción", () => {
  const RECUPERADAS = [
    {
      fichero:
        "supabase/migrations/20260807165809_add_budget_discount_payment_schedule_and_iban.sql",
      md5: "f1dfcb6529b7153a3af0c1429417854c",
      bytes: 778,
    },
    {
      fichero:
        "supabase/migrations/20260807165902_update_budget_with_items_discount_and_schedule.sql",
      md5: "ba6aaa7deb6bf714fbfab6ec5f12461f",
      bytes: 9456,
    },
  ];

  for (const { fichero, md5, bytes } of RECUPERADAS) {
    const version = path.basename(fichero).split("_")[0];

    test(`CASO 51/${version} — el fichero existe y es byte a byte el SQL que corrió producción`, () => {
      const ruta = path.join(root, fichero);
      assert.ok(fs.existsSync(ruta), `falta ${fichero}: el historial vuelve a ser irreproducible`);
      const contenido = fs.readFileSync(ruta);
      assert.equal(contenido.length, bytes, `${fichero} ha cambiado de tamaño`);
      assert.equal(
        crypto.createHash("md5").update(contenido).digest("hex"),
        md5,
        `${fichero} ya no coincide con el SQL registrado en producción`,
      );
    });
  }

  test("CASO 52 — las columnas que 2D-5 da por hechas las crea una migración anterior", () => {
    // Una instalación limpia no puede llegar a 20260826103500 y encontrarse sin
    // `discount_type` o `payment_schedule`: la RPC las escribe en el UPDATE.
    const dir = path.join(root, "supabase/migrations");
    const ficheros = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const objetivo = "20260826103500_update_budget_with_items_canonical.sql";
    const anteriores = ficheros.slice(0, ficheros.indexOf(objetivo));
    assert.ok(anteriores.length > 0, "no se encuentra la migración de 2D-5 en el directorio");

    const previo = anteriores.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");

    for (const columna of [
      "discount_type",
      "discount_percent",
      "discount_amount",
      "payment_schedule",
    ]) {
      assert.ok(
        new RegExp(`add column if not exists ${columna}\\b`, "i").test(previo),
        `ninguna migración anterior crea budgets.${columna}: una instalación limpia fallaría`,
      );
    }
    assert.ok(
      /add column if not exists iban\b/i.test(previo),
      "ninguna migración anterior crea fiscal_settings.iban",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// I-bis · Equivalencia con producción, demostrada por hash
// ══════════════════════════════════════════════════════════════════════════════
//
// Los tests de arriba comprueban que ciertas cosas SIGUEN ahí. Éste comprueba lo
// contrario y es mucho más fuerte: que no hay NADA MÁS. Se normaliza la función de
// la migración, se le restan las dos únicas diferencias que esta fase se permite
// —las siete columnas canónicas y las siete expresiones que las extraen— y lo que
// queda tiene que ser, byte a byte, la función desplegada en producción.
//
// El hash se obtuvo aplicando ESTAS MISMAS reglas dentro de PostgreSQL sobre
// `pg_get_functiondef()`. Si alguien toca la migración en cualquier otro sitio
// —un redondeo, un coalesce, un `where`, el orden de un `case`— este test falla y
// dice exactamente eso.
describe("FASE 2D-5 · la única diferencia con producción son las siete columnas", () => {
  const MD5_PRODUCCION_NORMALIZADA = "aafc5e2ca7c0491ad606a49828247cd0";
  const LONGITUD_PRODUCCION_NORMALIZADA = 7847;

  /** Las mismas reglas que se aplicaron en SQL. Sólo tocan mayúsculas y espacios. */
  function normalizaFuncion(sql) {
    const i = sql.indexOf("create or replace function");
    const j = sql.lastIndexOf("$$;");
    assert.ok(i >= 0 && j > i, "no se encuentra la función en la migración");
    let s = sql.slice(i, j + 2);
    s = s.toLowerCase();
    s = s.replace(/--[^\n]*/g, "");
    s = s.replace(/\s+/g, " ");
    s = s.replace(/\$function\$/g, "$$$$");
    s = s.replace(
      "set search_path to 'public', 'pg_temp'",
      "set search_path = public, pg_temp",
    );
    s = s.replace(/\(\s+/g, "(");
    s = s.replace(/\s+\)/g, ")");
    return s.trim();
  }

  const CANONICAS = [
    "canonical_id",
    "canonical_status",
    "canonical_confidence",
    "canonical_source",
    "canonical_origin",
    "canonical_source_ref",
    "price_type",
  ];
  const COLUMNAS_ANADIDAS = ", " + CANONICAS.join(", ") + ")";
  const EXPRESIONES_ANADIDAS =
    ", nullif(item->>'canonical_id', '')" +
    ", coalesce(nullif(item->>'canonical_status', ''), 'unmatched')" +
    ", (nullif(item->>'canonical_confidence', ''))::numeric" +
    ", nullif(item->>'canonical_source', '')" +
    ", nullif(item->>'canonical_origin', '')" +
    ", nullif(item->>'canonical_source_ref', '')" +
    ", nullif(item->>'price_type', '') from";

  const md5 = (s) => crypto.createHash("md5").update(s, "utf8").digest("hex");

  test("CASO 48 — restadas las siete columnas, la función es la de producción", () => {
    const b = normalizaFuncion(migracionSrc);

    assert.ok(
      b.includes(COLUMNAS_ANADIDAS),
      "no se localizan las siete columnas canónicas en la lista del INSERT",
    );
    assert.ok(
      b.includes(EXPRESIONES_ANADIDAS),
      "no se localizan las siete expresiones canónicas del SELECT",
    );

    const bSin = b
      .replace(COLUMNAS_ANADIDAS, ")")
      .replace(EXPRESIONES_ANADIDAS, " from");

    assert.equal(
      bSin.length,
      LONGITUD_PRODUCCION_NORMALIZADA,
      "la migración difiere de producción en algo más que las siete columnas canónicas",
    );
    assert.equal(
      md5(bSin),
      MD5_PRODUCCION_NORMALIZADA,
      "la migración difiere de producción en algo más que las siete columnas canónicas",
    );
  });

  test("CASO 49 — control negativo: cualquier cambio ajeno rompe CASO 48", () => {
    // Un solo carácter fuera de las siete columnas tiene que notarse. Se cambia el
    // redondeo del IVA, que es la clase de error que este test existe para atrapar.
    const saboteada = migracionSrc.replace(
      "round(v_taxable_base * v_iva_percent / 100, 2)",
      "round(v_taxable_base * v_iva_percent / 100, 4)",
    );
    assert.notEqual(saboteada, migracionSrc, "el sabotaje no cambió nada");

    const b = normalizaFuncion(saboteada);
    const bSin = b
      .replace(COLUMNAS_ANADIDAS, ")")
      .replace(EXPRESIONES_ANADIDAS, " from");

    assert.notEqual(
      md5(bSin),
      MD5_PRODUCCION_NORMALIZADA,
      "CASO 48 no detectaría un cambio en el redondeo del IVA",
    );
  });

  test("CASO 50 — control negativo: quitar una columna canónica rompe CASO 48", () => {
    // El otro lado del control. Si se cae una de las siete, la resta ya no encaja y
    // el residuo deja de ser producción.
    for (const clave of CANONICAS) {
      const mutilada = migracionSrc
        .split("\n")
        .filter((l) => l.trim() !== `${clave},` && l.trim() !== clave)
        .join("\n");
      assert.notEqual(mutilada, migracionSrc, `la mutación de '${clave}' no cambió nada`);

      const b = normalizaFuncion(mutilada);
      assert.ok(
        !b.includes(COLUMNAS_ANADIDAS),
        `quitar '${clave}' de la lista de columnas no se detecta`,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J · Atomicidad
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-5 · J — la atomicidad la da PostgreSQL, no el cliente", () => {
  test("CASO 44 — el DELETE y el INSERT viven en el mismo cuerpo de función", () => {
    const iInicio = migracionSrc.indexOf("as $$");
    const iFin = migracionSrc.indexOf("$$;");
    const cuerpo = migracionSrc.slice(iInicio, iFin);

    const iDelete = cuerpo.indexOf("delete from public.budget_items");
    const iInsert = cuerpo.indexOf("insert into public.budget_items (");

    assert.ok(iDelete > 0, "el DELETE salió del cuerpo de la función");
    assert.ok(iInsert > iDelete, "el INSERT no viene después del DELETE dentro de la función");
  });

  test("CASO 45 — la función no controla la transacción por su cuenta", () => {
    const iInicio = migracionSrc.indexOf("as $$");
    const iFin = migracionSrc.indexOf("$$;");
    const cuerpo = migracionSrc
      .slice(iInicio, iFin)
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");

    // Una FUNCTION no puede emitir COMMIT/ROLLBACK en PostgreSQL, y ésta tampoco lo
    // intenta. Sin transacción autónoma no hay forma de que el DELETE sobreviva a un
    // INSERT fallido: la excepción sube y revierte la llamada entera.
    assert.ok(!/\bcommit\b/i.test(cuerpo), "la función emite COMMIT");
    assert.ok(!/\brollback\b/i.test(cuerpo), "la función emite ROLLBACK");
    assert.ok(!/set +transaction/i.test(cuerpo), "la función manipula la transacción");
    assert.ok(!/dblink|pg_background/i.test(cuerpo), "hay una vía de transacción autónoma");
  });

  test("CASO 46 — el único bloque exception es el reintento del snapshot", () => {
    const iInicio = migracionSrc.indexOf("as $$");
    const iFin = migracionSrc.indexOf("$$;");
    const cuerpo = migracionSrc.slice(iInicio, iFin);

    const bloques = cuerpo.match(/exception when [a-z_]+/gi) ?? [];
    assert.equal(bloques.length, 1, "apareció un segundo bloque exception");
    assert.match(bloques[0], /unique_violation/i);

    // Y está ANTES del DELETE: no envuelve ni al DELETE ni al INSERT de partidas, así
    // que un constraint canónico no puede quedar tragado por un `exception when`.
    assert.ok(
      cuerpo.indexOf("exception when unique_violation") <
        cuerpo.indexOf("delete from public.budget_items"),
      "el bloque exception envuelve la sincronización de partidas: se tragaría el fallo",
    );
  });

  test("CASO 47 — el cliente no intenta compensar a mano un fallo parcial", () => {
    // Si alguien añadiese aquí un try/catch que reinsertara filas, estaría
    // reintroduciendo desde el cliente el problema que la RPC ya resuelve.
    const bloque = bloqueDeEdicion(formCodigo);

    assert.ok(
      !/from\("budget_items"\)/.test(bloque),
      "el camino de edición toca budget_items desde el cliente",
    );
    assert.ok(!/\.delete\(\)/.test(bloque), "el camino de edición borra filas desde el cliente");
  });
});
