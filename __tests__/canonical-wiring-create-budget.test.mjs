/**
 * FASE 2D-7 — Cableado canónico del ALTA MANUAL del formulario clásico.
 *
 * ALCANCE, y sólo ése: `/dashboard/budgets/new`. `saveDraft`, `finalizeBudget` y la
 * edición ya clasificaban; el alta insertaba las partidas fila a fila con ocho columnas
 * y ni una sola canónica. Esto la pone a la altura de las otras tres.
 *
 * NO cubre la duplicación de presupuestos (`app/dashboard/budgets/[id]/page.tsx`), que
 * sigue escribiendo en `budget_items` sin pasar por la capa canónica y con el mismo
 * defecto. Queda para una fase posterior, aparte. Esta suite no dice nada sobre ella.
 *
 * Por qué eso era un defecto y no una carencia: las siete columnas tienen valores por
 * defecto en la tabla, así que la fila no salía vacía, salía `unmatched` con procedencia
 * NULL. Exactamente lo mismo que produce un clasificador que sí miró la línea y no supo
 * resolverla. Dos hechos distintos —"nadie lo intentó" y "se intentó y no se pudo"—
 * escritos igual, y por tanto imposibles de separar después.
 *
 * QUÉ SE PRUEBA AQUÍ, Y CÓMO:
 *
 *   EN EJECUCIÓN — se replica el cableado real paso a paso (misma proyección, mismo
 *   `resolveTenant`, mismo `enrichForPersistence`, misma puerta de cuadre, mismo
 *   INSERT) contra un cliente falso que registra lo que recibe `insert()`. Las averías
 *   se provocan de verdad: el snapshot lanza, el clasificador lanza, el clasificador
 *   corrompe importes, `getUser()` devuelve error. No hay `assert.match` que valga para
 *   ninguna de esas cuatro cosas.
 *
 *   SOBRE EL FICHERO — sólo lo que un doble de JavaScript no puede ver: el ORDEN de los
 *   pasos, que la proyección no gane ni pierda columnas económicas, que el resultado
 *   clasificado no vuelva a `setPartidas` y que no haya vuelto el bucle fila a fila.
 *
 * Y un control negativo: si se salta el enriquecimiento, la mitad de esta suite tiene
 * que caerse. Un test de cableado que sigue verde sin el cableado no mide nada.
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
const { computeBudgetTotals, assertBudgetTotalsConsistent, BudgetTotalMismatchError } =
  await import(path.join(root, "lib/budget-totals.ts"));
const { normalizeBudgetItemUnit } = await import(path.join(root, "lib/budget-units.ts"));

const FORM_PATH = "app/dashboard/budgets/_components/budget-form.tsx";
const formSrc = fs.readFileSync(path.join(root, FORM_PATH), "utf8");

/**
 * El fichero SIN comentarios. Hace falta para poder afirmar que algo NO está: el
 * formulario explica en prosa lo que deliberadamente no hace, así que buscar un nombre
 * a pelo encuentra la explicación y da un falso positivo.
 */
function sinComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((linea) => linea.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const formCodigo = sinComentarios(formSrc);

/** El tramo de ALTA de `handleSubmit`: desde que acaba la edición hasta el `router.push`. */
function bloqueDeAlta(src) {
  const iSubmit = src.indexOf("async function handleSubmit");
  assert.ok(iSubmit > 0, "no se encuentra handleSubmit");

  const iInicio = src.indexOf("const year = new Date().getFullYear();", iSubmit);
  assert.ok(iInicio > iSubmit, "no se encuentra el arranque del alta");

  // El final se ancla en `analytics.budgetCreated`, no en el primer `router.push`: la
  // rama de error del INSERT de partidas navega ella también, y anclar en el primer
  // `router.push` cortaría el bloque justo antes de la salida de éxito.
  const iAnalytics = src.indexOf("analytics.budgetCreated", iInicio);
  assert.ok(iAnalytics > iInicio, "no se encuentra el cierre del alta");

  const iFin = src.indexOf('router.push("/dashboard/budgets/" + budget.id)', iAnalytics);
  assert.ok(iFin > iAnalytics, "no se encuentra el final del alta");

  // El cableado canónico vive ANTES del `const year`, así que el bloque empieza donde
  // empieza la proyección de partidas.
  const iProyeccion = src.lastIndexOf("const nuevasPartidas = partidas.map(", iInicio);
  assert.ok(iProyeccion > iSubmit, "no se encuentra la proyección de partidas del alta");

  return src.slice(iProyeccion, iFin);
}

// ─── Tenant y vocabulario ─────────────────────────────────────────────────────

const EMPRESA = "7c3d1f0a-9b2e-4d5c-8a71-6e0f3b2c4d90";
const PRESUPUESTO_ID = "b1c2d3e4-0000-4000-8000-0000000000bb";

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

/**
 * `PRIVADO` sólo existe para la empresa `EMPRESA`. Es la sonda del aislamiento de
 * tenant: si una caída de auth acabase usando un `company_id` residual, este alias se
 * vería y la línea saldría `resolved`. Ver el caso de escalada de privilegios.
 */
const ALIASES = [
  alias(PAINT_WALL, "Pintura plástica en paredes"),
  alias(PAINT_MAT, "Pintura plástica blanca mate interior 15 L"),
  alias(PAINT_MAT, "Pintura blanca para interiores", { kind: "synonym", confidence: 0.7 }),
  alias(PAINT_MAT, "Trabajo con nombre ambiguo"),
  alias(WASTE_HAUL, "Trabajo con nombre ambiguo"),
  alias(PRIMER, "Imprimación de paredes y techos", { source: "import", source_ref: "cype_2026" }),
  alias(WASTE_HAUL, "Retirada de escombros del chalet", { company_id: EMPRESA }),
];

const DB = {
  canonical_alias_sources: DEFAULT_ALIAS_SOURCES.map((s) => ({ ...s })),
  canonical_aliases: ALIASES,
  canonical_concepts: CONCEPTOS,
};

// ─── Cliente falso ────────────────────────────────────────────────────────────

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
 * Lee vocabulario y registra escrituras.
 *
 * `inserts` guarda `{ table, rows }` con las filas EXACTAS que recibió cada `insert()`.
 * Ahí se lee todo lo que este camino promete: cuántas escrituras hubo (una, no una por
 * partida), en qué orden, y qué columnas llevaba cada fila.
 */
function fakeSupabase(tables, options = {}) {
  const failures = options.failures ?? {};
  const stats = {
    queryCount: 0,
    byTable: {},
    inserts: [],
    deletes: 0,
    toastsError: [],
    analytics: [],
    navegacion: null,
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
      insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        stats.inserts.push({ table, rows });
        const error = options.insertErrors?.[table] ?? null;
        const resultado = { data: null, error };

        // `budgets` se inserta con `.select().single()`; `budget_items` se espera tal
        // cual. El mismo objeto tiene que servir para las dos formas.
        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                error
                  ? { data: null, error }
                  : { data: { id: PRESUPUESTO_ID, ...rows[0] }, error: null },
              ),
          }),
          then: (onfulfilled) => Promise.resolve(onfulfilled(resultado)),
        };
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

  return { client: { from }, stats };
}

// ─── El estado del formulario en un ALTA ──────────────────────────────────────

/**
 * Una partida recién tecleada. En un alta real `canonical_origin` y
 * `canonical_source_ref` llegan SIEMPRE ausentes —`emptyPartida()` no las declara y el
 * buscador del banco de precios tampoco las sella—, así que aquí se omiten a propósito:
 * `undefined`, no `null`. Que la proyección los convierta en NULL es parte del contrato.
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
    ...extra,
  };
}

/**
 * El alta TAL Y COMO ES HOY: cinco partidas tecleadas a mano, ninguna con procedencia.
 *
 * Que ninguna la traiga no es un descuido del fixture, es el estado real del producto:
 * `emptyPartida()` no sella origen y el buscador del banco de precios tampoco. Y como
 * `normalizeProvenance` degrada a (NULL, NULL) todo lo que no declara un origen válido,
 * estas cinco líneas salen las cinco `unmatched`. Es correcto y está medido en el CASO 2.
 */
function partidas() {
  return [
    partida("Pintura plástica en paredes", 58, "m2", 15.64),
    partida("Pintura plástica blanca mate interior 15 L", 3, "unidades", 52.8, {
      category: "material",
    }),
    partida("Pintura blanca para interiores", 2, "ud", 47.31, { category: "material" }),
    partida("Trabajo con nombre ambiguo", 1, "ud", 133.07),
    partida("Un concepto que no está en el vocabulario", 12, "ml", 9.31),
  ];
}

/**
 * Las MISMAS cinco partidas, pero con la procedencia sellada.
 *
 * Hace falta para medir el cableado de verdad. Sin origen no hay clasificación posible
 * —y entonces "las siete columnas llegan" se cumpliría con siete nulos, que es lo que ya
 * escribía la tabla por defecto—, así que con `partidas()` a solas esta suite no podría
 * distinguir un clasificador conectado de uno ausente.
 *
 * No es un escenario inventado: la edición carga partidas que YA traen `canonical_origin`
 * de la fila persistida, el mismo tipo `Partida` declara los dos campos, y la proyección
 * del alta los copia precisamente para que el día que el banco de precios selle su
 * procedencia la clasificación funcione sin volver a tocar este camino. Eso es lo que
 * aquí se fija: que el transporte esté puesto ya, antes de que exista quien lo use.
 *
 * Los cuatro estados quedan cubiertos: alias exacto → resolved, sinónimo flojo → review,
 * texto con dos conceptos → ambiguous, texto ausente del vocabulario → unmatched.
 */
function partidasSelladas() {
  return partidas().map((p, i) => ({
    ...p,
    canonical_origin: i === 0 ? "ai" : "free_text",
  }));
}

// ─── El cableado real, replicado paso a paso ─────────────────────────────────

/**
 * RÉPLICA del tramo de alta de `handleSubmit`, en el mismo orden.
 *
 * El orden ES el contrato: proyectar → resolver tenant → enriquecer → CUADRAR → crear
 * la fila de `budgets` → insertar las partidas. Que el cuadre vaya antes del primer
 * INSERT es lo que impide que un descuadre deje un presupuesto huérfano.
 *
 * `opciones.sinEnriquecer` es el control negativo: escribe la proyección cruda, que es
 * literalmente lo que hacía el código antes de 2D-7.
 */
async function crear(entrada, opciones = {}) {
  const { client, stats } = fakeSupabase(DB, opciones);
  const authResponse =
    opciones.authResponse ?? { data: { user: { id: EMPRESA } }, error: null };

  const subtotalMostrado = entrada.reduce((sum, p) => sum + p.subtotal, 0);

  const nuevasPartidas = entrada.map((p) => ({
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

  let tenant;
  try {
    tenant = resolveTenant(authResponse);
  } catch (err) {
    tenant = resolveTenant({ error: err });
  }

  const { items, report } = await enrichForPersistence({
    items: nuevasPartidas,
    tenant,
    context: "createBudget",
    supabase: client,
    ...(opciones.classify ? { classify: opciones.classify } : {}),
    ...(opciones.loadSnapshot ? { loadSnapshot: opciones.loadSnapshot } : {}),
  });

  const aEscribir = opciones.sinEnriquecer ? nuevasPartidas : items;

  assertBudgetTotalsConsistent(
    subtotalMostrado,
    computeBudgetTotals({ lines: aEscribir }),
    "createBudget",
  );

  const { data: budget, error } = await client
    .from("budgets")
    .insert({ user_id: EMPRESA, title: "Reforma", subtotal: subtotalMostrado })
    .select()
    .single();

  if (error || !budget) return { items, report, stats, tenant, subtotalMostrado, entrada };

  // Los tres efectos que el usuario y el embudo llegan a ver. Se registran porque el
  // caso del INSERT fallido no se cierra sólo con "no se ignoró el error": hay que poder
  // afirmar que se AVISÓ y que NO se contó como un alta correcta.
  if (aEscribir.length > 0) {
    const { error: itemsError } = await client
      .from("budget_items")
      .insert(aEscribir.map((row) => ({ ...row, budget_id: budget.id })));

    if (itemsError) {
      stats.itemsError = itemsError;
      stats.toastsError.push("El presupuesto se creó, pero las partidas no se guardaron");
      stats.navegacion = "/dashboard/budgets/" + budget.id;
      return { items, report, stats, tenant, subtotalMostrado, entrada };
    }
  }

  stats.analytics.push("budgetCreated");
  stats.navegacion = "/dashboard/budgets/" + budget.id;

  return { items, report, stats, tenant, subtotalMostrado, entrada };
}

/** Las filas que de verdad recibió el INSERT de `budget_items`. */
function filasEscritas(stats) {
  const escrituras = stats.inserts.filter((i) => i.table === "budget_items");
  assert.equal(
    escrituras.length,
    1,
    `se esperaba UN insert de budget_items, hubo ${escrituras.length}`,
  );
  return escrituras[0].rows;
}

// ══════════════════════════════════════════════════════════════════════════════
// A · Las siete columnas llegan al writer
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-7 · A — el INSERT del alta recibe las siete columnas canónicas", () => {
  test("CASO 1 — cada fila escrita lleva las siete claves, sin faltar ninguna", async () => {
    const { stats } = await crear(partidas());
    const filas = filasEscritas(stats);

    assert.equal(CANONICAL_COLUMN_KEYS.length, 7, "el contrato canónico ya no son siete columnas");
    assert.equal(filas.length, 5);

    for (const fila of filas) {
      for (const clave of CANONICAL_COLUMN_KEYS) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(fila, clave),
          `falta '${clave}' en la fila '${fila.concept}'`,
        );
      }
    }
  });

  test("CASO 2 — los estados los decide el clasificador, y hoy el alta a mano sale toda unmatched", async () => {
    // Las dos mitades de este caso son el mismo hecho visto desde los dos lados.
    //
    // Con procedencia sellada el clasificador manda: llegan estados DISTINTOS, con
    // `resolved` entre ellos. Si el enriquecimiento no estuviera puesto no habría
    // ninguno, y por eso este caso es el que primero se cae en el control negativo.
    const sellado = await crear(partidasSelladas());
    const estados = filasEscritas(sellado.stats).map((f) => f.canonical_status);

    assert.ok(estados.includes("resolved"), "ninguna línea salió resolved: no se clasificó nada");
    assert.ok(
      new Set(estados).size >= 2,
      `todas las líneas salieron con el mismo estado (${estados[0]}): el clasificador no está mirando`,
    );

    // Sin sellar —el alta de hoy— salen las cinco `unmatched`. NO es un fallo del
    // cableado: `normalizeProvenance` degrada a (NULL, NULL) toda línea sin origen
    // válido, y una línea sin procedencia no se resuelve. Dicho de otro modo: mientras
    // nadie selle el origen al nacer, este camino escribe exactamente los mismos siete
    // valores que ya ponía el default de la tabla. Lo que 2D-7 arregla es estructural
    // —el alta deja de ser el agujero por el que se entra sin pasar por la capa— y se
    // nota el día que el banco de precios selle. Conviene que esta suite lo diga en voz
    // alta en vez de dejar creer que el alta empieza a resolver hoy.
    const aMano = await crear(partidas());
    const estadosAMano = filasEscritas(aMano.stats).map((f) => f.canonical_status);

    assert.deepEqual(
      estadosAMano,
      ["unmatched", "unmatched", "unmatched", "unmatched", "unmatched"],
      "una línea sin procedencia ha resuelto: la degradación de procedencia ha cambiado",
    );
  });

  test("CASO 3 — una fila resolved llega con id, confianza y tipo de precio coherentes", async () => {
    const { stats } = await crear(partidasSelladas());
    const filas = filasEscritas(stats);

    // Concepto con UN solo `allowed_price_type`: el contrato canónico determina el
    // precio sin ambigüedad y el valor tiene que viajar hasta el INSERT.
    const unico = filas.find((f) => f.concept === "Pintura plástica blanca mate interior 15 L");
    assert.equal(unico.canonical_status, "resolved");
    assert.equal(unico.canonical_id, "MAT.PAINT.EMULSION.INTERIOR_MATT");
    assert.equal(unico.canonical_confidence, 1);
    assert.equal(unico.canonical_source, "exact_curated");
    assert.equal(unico.price_type, "MATERIAL_ONLY");

    // Concepto con DOS `allowed_price_types`: resuelto igual, pero el precio sigue sin
    // estar decidido y `price_type` es NULL a propósito. Si aquí llegara un valor, el
    // alta estaría eligiendo por su cuenta algo que el contrato deja abierto.
    const multiple = filas.find((f) => f.concept === "Pintura plástica en paredes");
    assert.equal(multiple.canonical_status, "resolved");
    assert.equal(multiple.canonical_id, "WORK.PAINT.EMULSION.WALL.2COATS");
    assert.equal(
      multiple.price_type,
      null,
      "se ha inventado un price_type para un concepto con varios tipos admitidos",
    );
  });

  test("CASO 4 — una fila unmatched llega con las derivadas a null, no ausentes", async () => {
    // Se mide sobre una línea SELLADA para que el `unmatched` sea el resultado de haber
    // mirado el vocabulario y no haber encontrado nada, que es el caso interesante: la
    // fila conserva su procedencia `free_text` y a la vez declara que no hay concepto.
    const { stats } = await crear(partidasSelladas());
    const fila = filasEscritas(stats).find(
      (f) => f.concept === "Un concepto que no está en el vocabulario",
    );

    assert.equal(fila.canonical_status, "unmatched");
    assert.equal(fila.canonical_id, null);
    assert.equal(fila.canonical_confidence, null);
    assert.equal(fila.canonical_source, null);
    assert.equal(fila.price_type, null);
    assert.equal(fila.canonical_origin, "free_text", "el unmatched se ha llevado por delante la procedencia");
  });

  test("CASO 5 — antes de 2D-7 no llegaba ninguna: el control negativo lo demuestra", async () => {
    const { stats } = await crear(partidas(), { sinEnriquecer: true });
    const filas = filasEscritas(stats);

    const derivadas = ["canonical_id", "canonical_status", "canonical_confidence", "canonical_source", "price_type"];
    for (const fila of filas) {
      for (const clave of derivadas) {
        assert.ok(
          !Object.prototype.hasOwnProperty.call(fila, clave),
          `sin enriquecer no debería existir '${clave}': el control negativo no está midiendo`,
        );
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B · La procedencia se transporta, no se inventa
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-7 · B — procedencia: se conserva la que haya y no se inventa la que no hay", () => {
  test("CASO 6 — un alta a mano no inventa procedencia: NULL es lo que consta", async () => {
    const { stats } = await crear(partidas());

    for (const fila of filasEscritas(stats)) {
      assert.equal(
        fila.canonical_origin,
        null,
        `'${fila.concept}' salió con procedencia '${fila.canonical_origin}' sin que nadie la sellara`,
      );
      assert.equal(fila.canonical_source_ref, null);
    }
  });

  test("CASO 7 — si la partida SÍ trae procedencia, se transporta intacta", async () => {
    // Hoy el formulario no sella procedencia en el alta, pero la proyección la copia
    // para que el día que alguien lo haga llegue sola. Esto fija ese transporte.
    const entrada = [
      partida("Imprimación de paredes y techos", 41, "m2", 6.13, {
        canonical_origin: "import",
        canonical_source_ref: "cype_2026",
      }),
      partida("Pintura plástica en paredes", 10, "m2", 15.64, { canonical_origin: "ai" }),
    ];
    const { stats } = await crear(entrada);
    const filas = filasEscritas(stats);

    assert.equal(filas[0].canonical_origin, "import");
    assert.equal(filas[0].canonical_source_ref, "cype_2026");
    assert.equal(filas[1].canonical_origin, "ai");
    assert.equal(filas[1].canonical_source_ref, null);
  });

  test("CASO 8 — el par (origin, source_ref) escrito satisface ck_origin_source_ref", async () => {
    // La restricción real de la tabla: `import` y `provider` EXIGEN source_ref; el
    // resto de orígenes no pueden llevarlo. Una fila que la incumpla no falla aquí:
    // falla en producción, con el presupuesto ya a medio crear.
    const entrada = [
      ...partidas(),
      partida("Imprimación de paredes y techos", 41, "m2", 6.13, {
        canonical_origin: "import",
        canonical_source_ref: "cype_2026",
      }),
      partida("Pintura blanca para interiores", 4, "ud", 47.31, {
        canonical_origin: "provider",
        canonical_source_ref: "leroy_2026",
      }),
    ];
    const { stats } = await crear(entrada);

    for (const fila of filasEscritas(stats)) {
      const exigeRef = fila.canonical_origin === "import" || fila.canonical_origin === "provider";
      if (exigeRef) {
        assert.equal(
          typeof fila.canonical_source_ref,
          "string",
          `'${fila.canonical_origin}' sin source_ref viola ck_origin_source_ref`,
        );
        assert.ok(fila.canonical_source_ref.length > 0);
      } else {
        assert.equal(
          fila.canonical_source_ref,
          null,
          `origin '${fila.canonical_origin}' no puede llevar source_ref`,
        );
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C · Misma economía, mismas líneas, mismo orden
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-7 · C — la economía escrita es exactamente la del formulario", () => {
  test("CASO 9 — se escribe una fila por partida, ni una más ni una menos", async () => {
    const entrada = partidas();
    const { stats } = await crear(entrada);

    assert.equal(filasEscritas(stats).length, entrada.length);
  });

  test("CASO 10 — el orden se conserva línea a línea", async () => {
    const entrada = partidas();
    const { stats } = await crear(entrada);
    const filas = filasEscritas(stats);

    for (let i = 0; i < entrada.length; i += 1) {
      assert.equal(filas[i].concept, entrada[i].concept, `la línea ${i} cambió de sitio`);
    }
  });

  test("CASO 11 — cantidad, precio unitario y subtotal se escriben idénticos", async () => {
    const entrada = partidas();
    const { stats } = await crear(entrada);
    const filas = filasEscritas(stats);

    for (let i = 0; i < entrada.length; i += 1) {
      assert.equal(filas[i].quantity, entrada[i].quantity);
      assert.equal(filas[i].unit_price, entrada[i].unit_price);
      assert.equal(filas[i].subtotal, entrada[i].subtotal);
    }
  });

  test("CASO 12 — concepto, descripción y categoría no se reescriben", async () => {
    const entrada = partidas();
    const { stats } = await crear(entrada);
    const filas = filasEscritas(stats);

    for (let i = 0; i < entrada.length; i += 1) {
      assert.equal(filas[i].concept, entrada[i].concept);
      assert.equal(filas[i].description, entrada[i].description);
      assert.equal(filas[i].category, entrada[i].category);
    }
  });

  test("CASO 13 — la unidad escrita es la normalizada, igual que antes de 2D-7", async () => {
    const entrada = partidas();
    const { stats } = await crear(entrada);
    const filas = filasEscritas(stats);

    // "unidades" → "ud". El cableado no puede haber cambiado esta conversión: es la que
    // hace que la fila supere `budget_items_unit_check`.
    for (let i = 0; i < entrada.length; i += 1) {
      assert.equal(filas[i].unit, normalizeBudgetItemUnit(entrada[i].unit));
    }
    assert.equal(filas[1].unit, "ud", "la normalización de unidad se ha perdido");
  });

  test("CASO 14 — el subtotal recalculado sobre lo escrito es el que se mostró", async () => {
    const { stats, subtotalMostrado } = await crear(partidas());

    assert.doesNotThrow(
      () =>
        assertBudgetTotalsConsistent(
          subtotalMostrado,
          computeBudgetTotals({ lines: filasEscritas(stats) }),
          "createBudget",
        ),
      "lo escrito ya no suma lo que el formulario enseñó",
    );
  });

  test("CASO 15 — la fila escrita no gana ni pierde columnas económicas", async () => {
    const { stats } = await crear(partidas());
    const fila = filasEscritas(stats)[0];

    const esperadas = new Set([
      "budget_id",
      "concept",
      "description",
      "quantity",
      "unit",
      "category",
      "unit_price",
      "subtotal",
      ...CANONICAL_COLUMN_KEYS,
    ]);

    for (const clave of Object.keys(fila)) {
      assert.ok(esperadas.has(clave), `la fila escribe una columna nueva no acordada: '${clave}'`);
    }
    for (const clave of esperadas) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(fila, clave),
        `la fila ha dejado de escribir '${clave}'`,
      );
    }
  });

  test("CASO 16 — un descuadre económico REAL sí detiene el alta, y antes de escribir nada", async () => {
    // Una partida cuyo `subtotal` no es `quantity * unit_price`. El formulario habría
    // enseñado un total y la base habría guardado otro.
    const entrada = partidas();
    entrada[0] = { ...entrada[0], subtotal: entrada[0].subtotal + 100 };

    await assert.rejects(() => crear(entrada), BudgetTotalMismatchError);
  });

  test("CASO 17 — tras el descuadre no queda ni el presupuesto huérfano", async () => {
    const entrada = partidas();
    entrada[0] = { ...entrada[0], subtotal: entrada[0].subtotal + 100 };

    const { client, stats } = fakeSupabase(DB);
    const subtotalMostrado = entrada.reduce((s, p) => s + p.subtotal, 0);
    const proyectadas = entrada.map((p) => ({
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
    const { items } = await enrichForPersistence({
      items: proyectadas,
      tenant: resolveTenant({ data: { user: { id: EMPRESA } } }),
      context: "createBudget",
      supabase: client,
    });

    assert.throws(
      () =>
        assertBudgetTotalsConsistent(
          subtotalMostrado,
          computeBudgetTotals({ lines: items }),
          "createBudget",
        ),
      BudgetTotalMismatchError,
    );
    assert.equal(
      stats.inserts.length,
      0,
      "el cuadre saltó después de escribir: quedaría un presupuesto huérfano",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D · Una sola carga de vocabulario, un solo INSERT
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-7 · D — el coste del alta no crece con el número de partidas", () => {
  test("CASO 18 — el snapshot se carga UNA vez por alta", async () => {
    let cargas = 0;
    const { loadCanonicalRegistrySnapshot } = await import(
      path.join(root, "lib/canonical/registry-snapshot.ts")
    );

    const { report } = await crear(partidas(), {
      loadSnapshot: async (opts) => {
        cargas += 1;
        return loadCanonicalRegistrySnapshot(opts);
      },
    });

    assert.equal(cargas, 1, `el snapshot se cargó ${cargas} veces`);
    assert.equal(report.snapshotLoads, 1);
  });

  test("CASO 19 — doblar las partidas no dobla las cargas de snapshot", async () => {
    let cargas = 0;
    const { loadCanonicalRegistrySnapshot } = await import(
      path.join(root, "lib/canonical/registry-snapshot.ts")
    );
    const spy = async (opts) => {
      cargas += 1;
      return loadCanonicalRegistrySnapshot(opts);
    };

    await crear([...partidas(), ...partidas()], { loadSnapshot: spy });

    assert.equal(cargas, 1, "el snapshot se está cargando por partida: ha vuelto el N+1");
  });

  test("CASO 20 — las partidas se escriben en UN solo INSERT, no una por fila", async () => {
    const { stats } = await crear(partidas());
    const escrituras = stats.inserts.filter((i) => i.table === "budget_items");

    assert.equal(escrituras.length, 1, "ha vuelto el INSERT fila a fila");
    assert.equal(escrituras[0].rows.length, 5);
  });

  test("CASO 21 — el alta no borra nada: no hay nada que borrar", async () => {
    const { stats } = await crear(partidas());

    assert.equal(stats.deletes, 0, "el alta está haciendo un DELETE sobre un presupuesto nuevo");
  });

  test("CASO 22 — `budgets` se crea antes que sus partidas", async () => {
    const { stats } = await crear(partidas());
    const orden = stats.inserts.map((i) => i.table);

    assert.deepEqual(orden, ["budgets", "budget_items"]);
  });

  test("CASO 23 — cada fila escrita apunta al presupuesto recién creado", async () => {
    const { stats } = await crear(partidas());

    for (const fila of filasEscritas(stats)) {
      assert.equal(fila.budget_id, PRESUPUESTO_ID);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// E · Fail-open: una avería canónica nunca impide crear el presupuesto
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-7 · E — fail-open: el presupuesto se crea aunque la capa canónica se rompa", () => {
  const snapshotRoto = async () => {
    throw new Error("snapshot caído");
  };
  const clasificadorRoto = async () => {
    throw new Error("clasificador roto");
  };

  test("CASO 24 — el snapshot se avería: se crea igual, todo unmatched", async () => {
    const { stats, report } = await crear(partidas(), { loadSnapshot: snapshotRoto });
    const filas = filasEscritas(stats);

    assert.equal(report.degraded, "snapshot");
    assert.equal(filas.length, 5);
    for (const fila of filas) assert.equal(fila.canonical_status, "unmatched");
  });

  test("CASO 25 — la avería de snapshot NO borra la procedencia que traía la línea", async () => {
    const entrada = [
      partida("Imprimación de paredes y techos", 41, "m2", 6.13, {
        canonical_origin: "import",
        canonical_source_ref: "cype_2026",
      }),
    ];
    const { stats } = await crear(entrada, { loadSnapshot: snapshotRoto });
    const fila = filasEscritas(stats)[0];

    assert.equal(fila.canonical_origin, "import");
    assert.equal(fila.canonical_source_ref, "cype_2026");
  });

  test("CASO 26 — el clasificador LANZA: se crea igual", async () => {
    const { stats, report } = await crear(partidas(), { classify: clasificadorRoto });

    assert.equal(report.degraded, "classifier");
    assert.equal(filasEscritas(stats).length, 5);
  });

  test("CASO 27 — la economía sobrevive intacta a las dos averías", async () => {
    const entrada = partidas();
    for (const opciones of [{ loadSnapshot: snapshotRoto }, { classify: clasificadorRoto }]) {
      const { stats, subtotalMostrado } = await crear(entrada, opciones);
      const filas = filasEscritas(stats);

      for (let i = 0; i < entrada.length; i += 1) {
        assert.equal(filas[i].quantity, entrada[i].quantity);
        assert.equal(filas[i].unit_price, entrada[i].unit_price);
        assert.equal(filas[i].subtotal, entrada[i].subtotal);
      }
      assert.doesNotThrow(() =>
        assertBudgetTotalsConsistent(
          subtotalMostrado,
          computeBudgetTotals({ lines: filas }),
          "createBudget",
        ),
      );
    }
  });

  test("CASO 28 — el clasificador ALTERA la economía: se escriben los importes originales", async () => {
    // No lanza, no falla, no avisa: miente. La guarda de integridad económica de
    // `classifyForPersistence` tiene que descubrirlo comparando, tirar la clasificación
    // entera y devolver las líneas originales. Si no lo hiciera, o bien se escribirían
    // importes corruptos, o bien el cuadre reventaría y una avería del OBSERVADOR
    // impediría crear el presupuesto.
    const saboteador = async (lines) =>
      ({
        lines: lines.map((l) => ({
          ...l,
          unit_price: l.unit_price * 2,
          subtotal: l.subtotal * 2,
          canonical_id: "FALSO",
          canonical_status: "resolved",
          canonical_confidence: 1,
          canonical_source: "curated",
          price_type: "LABOR_ONLY",
          canonical_origin: l.canonical_origin ?? null,
          canonical_source_ref: l.canonical_source_ref ?? null,
        })),
        stats: {},
      });

    const entrada = partidas();
    const { stats, report } = await crear(entrada, { classify: saboteador });
    const filas = filasEscritas(stats);

    assert.equal(report.degraded, "economic_integrity");
    assert.equal(report.failureKind, "value:unit_price");
    for (let i = 0; i < entrada.length; i += 1) {
      assert.equal(filas[i].unit_price, entrada[i].unit_price, "se escribió el precio corrupto");
      assert.equal(filas[i].subtotal, entrada[i].subtotal, "se escribió el subtotal corrupto");
      assert.equal(filas[i].canonical_id, null, "se escribió la clasificación mentirosa");
      assert.equal(filas[i].canonical_status, "unmatched");
    }
  });

  test("CASO 29 — un fallo del INSERT de partidas no se traga ni se cuenta como éxito", async () => {
    // Tres cosas distintas, y las tres importan:
    //   1. el error se LEE (antes se descartaba el resultado de cada insert del bucle);
    //   2. se AVISA al usuario, porque el presupuesto padre ya existe y sin partidas;
    //   3. NO se sigue por la rama de éxito: el alta no se contabiliza como completada.
    const { stats } = await crear(partidas(), {
      insertErrors: { budget_items: { message: "violates check constraint" } },
    });

    assert.ok(stats.itemsError, "el error del INSERT se descartó, como antes de 2D-7");
    assert.equal(stats.itemsError.message, "violates check constraint");

    assert.equal(stats.toastsError.length, 1, "el fallo no llega al usuario");

    assert.deepEqual(
      stats.analytics,
      [],
      "se ha contado un alta manual correcta con un presupuesto que se quedó sin partidas",
    );

    // Sí se navega al presupuesto creado: quedarse en el formulario invitaría a pulsar
    // Guardar otra vez y crear un segundo presupuesto vacío.
    assert.equal(stats.navegacion, "/dashboard/budgets/" + PRESUPUESTO_ID);
  });

  test("CASO 29b — el alta que va bien sí se cuenta: el caso anterior mide una diferencia", async () => {
    const { stats } = await crear(partidas());

    assert.equal(stats.itemsError, undefined);
    assert.deepEqual(stats.toastsError, []);
    assert.deepEqual(stats.analytics, ["budgetCreated"]);
  });

  test("CASO 29c — el fichero real trata el error, y no sigue por la rama de éxito", () => {
    const alta = bloqueDeAlta(formCodigo);

    const iError = alta.indexOf("if (itemsError)");
    assert.ok(iError > 0, "el error del INSERT de partidas ya no se comprueba");

    const rama = alta.slice(iError);
    assert.match(rama, /toast\.error\(/, "el fallo del INSERT no se le cuenta al usuario");
    assert.match(rama, /return;/, "la rama de error se funde con la de éxito");

    const iAnalytics = alta.indexOf("analytics.budgetCreated");
    assert.ok(
      iAnalytics > iError,
      "analytics.budgetCreated se ejecuta antes de mirar el error del INSERT",
    );
    assert.ok(
      alta.slice(iError, iAnalytics).includes("return;"),
      "un INSERT fallido sigue contando como alta manual correcta",
    );

    // La compensación que NO se hace: borrar el presupuesto padre desde el cliente.
    assert.doesNotMatch(
      alta,
      /from\("budgets"\)[\s\S]{0,80}\.delete\(/,
      "hay un DELETE compensatorio de cliente: eso no da atomicidad, añade otro modo de fallo",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// F · Auth: perder el tenant degrada la clasificación, nunca la escala
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-7 · F — un fallo de auth no puede escalar privilegios", () => {
  test("CASO 30 — auth con error y user residual: companyId nulo y contexto unavailable", async () => {
    const { tenant, report } = await crear(partidas(), {
      authResponse: {
        data: { user: { id: EMPRESA } },
        error: { message: "session expired" },
      },
    });

    assert.equal(tenant.companyId, null, "se usó como tenant un user que auth no verificó");
    assert.equal(tenant.tenantContext, "unavailable");
    assert.equal(report.tenant_context, "unavailable");
  });

  test("CASO 31 — sin sesión: unavailable con code:no_session, no un error inventado", async () => {
    const { tenant, report } = await crear(partidas(), {
      authResponse: { data: { user: null }, error: null },
    });

    assert.equal(tenant.companyId, null);
    assert.equal(tenant.tenantContext, "unavailable");
    assert.equal(report.tenantFailureKind, "code:no_session");
  });

  test("CASO 32 — perder el tenant NO da acceso al vocabulario privado de la empresa", async () => {
    // La sonda: `Retirada de escombros del chalet` sólo existe como alias de EMPRESA.
    // Con tenant resuelto la línea sale resolved; sin él tiene que salir unmatched. Si
    // saliera resolved en los dos casos, el filtro `company_id` no estaría aplicándose
    // y una caída de auth estaría leyendo evidencia privada.
    // La sonda va SELLADA: sin origen la línea no resolvería ni con tenant ni sin él, y
    // entonces los dos lados saldrían `unmatched` por el mismo motivo equivocado y el
    // test pasaría sin haber mirado el filtro de empresa ni una vez.
    const entrada = [
      partida("Retirada de escombros del chalet", 1, "ud", 220, {
        canonical_origin: "free_text",
      }),
    ];

    const conTenant = await crear(entrada);
    assert.equal(
      filasEscritas(conTenant.stats)[0].canonical_status,
      "resolved",
      "la sonda no está midiendo: el alias privado no resuelve ni con tenant",
    );

    const sinTenant = await crear(entrada, {
      authResponse: { data: { user: { id: EMPRESA } }, error: { message: "expired" } },
    });
    assert.equal(
      filasEscritas(sinTenant.stats)[0].canonical_status,
      "unmatched",
      "se leyó vocabulario privado con una identidad no verificada",
    );
  });

  test("CASO 33 — pero sí se sigue clasificando con el vocabulario global", async () => {
    const { stats } = await crear(partidasSelladas(), {
      authResponse: { data: { user: null }, error: null },
    });
    const estados = filasEscritas(stats).map((f) => f.canonical_status);

    assert.ok(
      estados.includes("resolved"),
      "sin tenant no se clasificó nada: se perdió también el vocabulario global",
    );
  });

  test("CASO 34 — una excepción de getUser() se trata como un error de auth", async () => {
    let tenant;
    try {
      throw new Error("network down");
    } catch (err) {
      tenant = resolveTenant({ error: err });
    }

    assert.equal(tenant.companyId, null);
    assert.equal(tenant.tenantContext, "unavailable");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G · La clasificación es de PERSISTENCIA, no de estado
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-7 · G — el resultado clasificado no vuelve al estado de React", () => {
  test("CASO 35 — crear no muta los objetos del estado del formulario", async () => {
    const entrada = partidas();
    const copiaPrevia = JSON.parse(JSON.stringify(entrada));

    await crear(entrada);

    assert.deepEqual(
      JSON.parse(JSON.stringify(entrada)),
      copiaPrevia,
      "el enriquecimiento ha mutado las partidas del estado",
    );
  });

  test("CASO 36 — ninguna de las cinco derivadas aparece en las partidas del estado", async () => {
    const entrada = partidas();
    await crear(entrada);

    const derivadas = [
      "canonical_id",
      "canonical_status",
      "canonical_confidence",
      "canonical_source",
      "price_type",
    ];
    for (const p of entrada) {
      for (const clave of derivadas) {
        assert.ok(
          !Object.prototype.hasOwnProperty.call(p, clave),
          `'${clave}' se ha colado en el estado del formulario`,
        );
      }
    }
  });

  test("CASO 37 — el alta no llama a setPartidas con el resultado clasificado", () => {
    const alta = bloqueDeAlta(formCodigo);

    assert.ok(
      !alta.includes("setPartidas"),
      "el alta reinyecta el resultado clasificado en el estado: eso abre el bucle",
    );
  });

  test("CASO 38 — el tipo Partida sigue declarando sólo las dos columnas aportadas", () => {
    const inicio = formSrc.indexOf("interface Partida {");
    const fin = formSrc.indexOf("}", formSrc.indexOf("canonical_source_ref", inicio));
    const cuerpo = formSrc.slice(inicio, fin);

    assert.ok(cuerpo.includes("canonical_origin"));
    assert.ok(cuerpo.includes("canonical_source_ref"));
    for (const derivada of [
      "canonical_id",
      "canonical_status",
      "canonical_confidence",
      "canonical_source",
      "price_type",
    ]) {
      // El nombre tiene que terminar AHÍ. Buscar `canonical_source` a pelo encuentra el
      // `canonical_source_ref` que sí debe estar declarado, y el caso fallaría siempre.
      assert.doesNotMatch(
        cuerpo,
        new RegExp(`\\b${derivada}(?![_a-zA-Z0-9])`),
        `'${derivada}' se ha declarado en el estado del formulario`,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// H · El orden de los pasos es el contrato (se lee del fichero real)
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-7 · H — el fichero real cablea los pasos en el orden acordado", () => {
  test("CASO 39 — proyectar → resolveTenant → enrichForPersistence → cuadre → INSERT", () => {
    const alta = bloqueDeAlta(formCodigo);

    const iProyeccion = alta.indexOf("const nuevasPartidas = partidas.map(");
    const iTenant = alta.indexOf("resolveTenant(await supabase.auth.getUser())");
    const iEnrich = alta.indexOf("await enrichForPersistence(");
    const iCuadre = alta.indexOf("assertBudgetTotalsConsistent(");
    const iBudgets = alta.indexOf('.from("budgets")');
    const iItems = alta.indexOf('.from("budget_items")');

    assert.ok(iProyeccion === 0, "la proyección no abre el bloque");
    assert.ok(iTenant > iProyeccion, "el tenant se resuelve antes de proyectar");
    assert.ok(iEnrich > iTenant, "se enriquece antes de resolver el tenant");
    assert.ok(iCuadre > iEnrich, "el cuadre va antes del enriquecimiento: no vigila lo escrito");
    assert.ok(iBudgets > iCuadre, "se crea el presupuesto antes de cuadrar: quedaría huérfano");
    assert.ok(iItems > iBudgets, "las partidas se escriben antes que su presupuesto");
  });

  test("CASO 40 — el alta declara el contexto canónico 'createBudget'", async () => {
    const alta = bloqueDeAlta(formCodigo);

    assert.ok(alta.includes('context: "createBudget"'));

    // Y el contexto existe de verdad en el tipo, no es una cadena suelta.
    const contextos = fs.readFileSync(
      path.join(root, "lib/canonical/finalize-classification.ts"),
      "utf8",
    );
    assert.match(contextos, /CanonicalPersistenceContext[\s\S]*?"createBudget"/);
  });

  test("CASO 41 — se escriben las filas ENRIQUECIDAS, no las del estado", () => {
    const alta = bloqueDeAlta(formCodigo);

    assert.match(
      alta,
      /\.from\("budget_items"\)\s*\n?\s*\.insert\(classifiedNuevas\.map\(/,
      "el INSERT no está usando el resultado del enriquecimiento",
    );
    assert.ok(
      !/\.insert\(\s*nuevasPartidas/.test(alta),
      "el INSERT escribe la proyección cruda: el enriquecimiento no sirve de nada",
    );
  });

  test("CASO 42 — el bucle fila a fila no ha vuelto", () => {
    assert.doesNotMatch(
      formCodigo,
      /for \(const p of partidas\) \{[\s\S]*?from\("budget_items"\)\.insert\(/,
      "ha vuelto el INSERT por partida",
    );
  });

  test("CASO 43 — el error del INSERT se comprueba", () => {
    const alta = bloqueDeAlta(formCodigo);

    assert.match(alta, /const \{ error: itemsError \}/, "el resultado del INSERT se descarta");
    assert.match(alta, /if \(itemsError\)/, "el error del INSERT no se mira");
  });

  test("CASO 44 — el alta no reintroduce un DELETE de cliente", () => {
    const alta = bloqueDeAlta(formCodigo);

    assert.ok(
      !alta.includes(".delete()"),
      "el alta borra partidas de un presupuesto que acaba de nacer",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// I · Control negativo: sin enriquecimiento, esta suite tiene que caerse
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-7 · I — control negativo del cableado", () => {
  test("CASO 45 — quitar el enriquecimiento rompe los casos 1, 2, 3 y 4", async () => {
    // Con las MISMAS partidas selladas que usan esos casos: un control negativo que
    // corriese sobre otra entrada no demostraría nada sobre ellos.
    const { stats } = await crear(partidasSelladas(), { sinEnriquecer: true });
    const filas = filasEscritas(stats);

    // CASO 1
    assert.throws(() => {
      for (const fila of filas) {
        for (const clave of CANONICAL_COLUMN_KEYS) {
          assert.ok(Object.prototype.hasOwnProperty.call(fila, clave));
        }
      }
    }, "CASO 1 seguiría verde sin enriquecer: no está midiendo");

    // CASO 2
    assert.throws(() => {
      const estados = filas.map((f) => f.canonical_status);
      assert.ok(estados.includes("resolved"));
    }, "CASO 2 seguiría verde sin enriquecer");

    // CASO 3
    assert.throws(() => {
      const unico = filas.find((f) => f.concept === "Pintura plástica blanca mate interior 15 L");
      assert.equal(unico.canonical_status, "resolved");
      assert.equal(unico.price_type, "MATERIAL_ONLY");
    }, "CASO 3 seguiría verde sin enriquecer");

    // CASO 4
    assert.throws(() => {
      const fila = filas.find((f) => f.concept === "Un concepto que no está en el vocabulario");
      assert.equal(fila.canonical_status, "unmatched");
    }, "CASO 4 seguiría verde sin enriquecer");
  });

  test("CASO 46 — pero la economía sigue intacta sin enriquecer: mide el cableado, no el dinero", async () => {
    // Contrapunto del anterior. Si al quitar el enriquecimiento también se cayeran los
    // casos económicos, esta suite estaría midiendo dos cosas a la vez y no se sabría
    // cuál de ellas falló.
    const entrada = partidas();
    const { stats, subtotalMostrado } = await crear(entrada, { sinEnriquecer: true });
    const filas = filasEscritas(stats);

    assert.equal(filas.length, entrada.length);
    for (let i = 0; i < entrada.length; i += 1) {
      assert.equal(filas[i].concept, entrada[i].concept);
      assert.equal(filas[i].quantity, entrada[i].quantity);
      assert.equal(filas[i].unit_price, entrada[i].unit_price);
      assert.equal(filas[i].subtotal, entrada[i].subtotal);
    }
    assert.doesNotThrow(() =>
      assertBudgetTotalsConsistent(
        subtotalMostrado,
        computeBudgetTotals({ lines: filas }),
        "createBudget",
      ),
    );
  });

  test("CASO 47 — el enriquecimiento es lo ÚNICO que cambia entre las dos ramas", async () => {
    const entrada = partidas();
    const conCableado = filasEscritas((await crear(entrada)).stats);
    const sinCableado = filasEscritas((await crear(entrada, { sinEnriquecer: true })).stats);

    const derivadas = new Set([
      "canonical_id",
      "canonical_status",
      "canonical_confidence",
      "canonical_source",
      "price_type",
    ]);

    assert.equal(conCableado.length, sinCableado.length);
    for (let i = 0; i < conCableado.length; i += 1) {
      for (const clave of Object.keys(sinCableado[i])) {
        assert.deepEqual(
          conCableado[i][clave],
          sinCableado[i][clave],
          `el cableado ha cambiado '${clave}', que no es suyo`,
        );
      }
      const nuevas = Object.keys(conCableado[i]).filter(
        (k) => !Object.prototype.hasOwnProperty.call(sinCableado[i], k),
      );
      assert.deepEqual(
        new Set(nuevas),
        derivadas,
        "el cableado añade o deja de añadir columnas distintas de las cinco derivadas",
      );
    }
  });
});
