/**
 * FASE 2D-8 — Cableado canónico de la DUPLICACIÓN de presupuestos.
 *
 * ALCANCE, y sólo ése: `duplicateBudget()` en `app/dashboard/budgets/[id]/page.tsx`.
 * `saveDraft`, `finalizeBudget`, la edición y el alta manual ya clasificaban; la
 * duplicación copiaba las partidas fila a fila con ocho columnas económicas y ni una
 * sola canónica, tirando además el `{ error }` de cada insert sin mirarlo.
 *
 * QUÉ HACE DISTINTO ESTE CAMINO. Es el único cuyas líneas NO nacen aquí: son la copia
 * de partidas que ya existían. De ahí las dos decisiones que esta suite fija:
 *
 *   1. La procedencia se TRANSPORTA, no se inventa. Duplicar no vuelve a nacer una
 *      línea: la copia de una partida nacida `ai` sigue teniendo ese origen. No se pasa
 *      `defaultOrigin` y no se fabrica `free_text` para las que llegan sin él.
 *
 *   2. Las cinco DERIVADAS se recalculan. Copiarlas de la fila vieja importaría un
 *      veredicto emitido contra el vocabulario canónico de otro momento; y en las filas
 *      anteriores a la Fase 2 ese `unmatched` ni siquiera es un veredicto, es el default
 *      de la columna. Se derivan al persistir, como en los otros cuatro writers.
 *
 * LA GUARDA ECONÓMICA NO COMPARA CONTRA `budgets.subtotal`. Ese campo y la suma de las
 * líneas no cuadran en los presupuestos anteriores al contrato de totales v2 —guardaban
 * los materiales como líneas económicas además de las partidas— y el cuadre se exige con
 * delta cero. Gatear contra él convertiría la duplicación en un validador de datos
 * históricos y dejaría sin poder duplicarse a casi todo lo que existe. La invariante
 * correcta aquí es otra: la copia debe ser económicamente idéntica al ORIGINAL. Eso es
 * lo único que la capa canónica podría romper, y es lo que se comprueba.
 *
 * QUÉ SE PRUEBA AQUÍ, Y CÓMO:
 *
 *   EN EJECUCIÓN — se replica el cableado real paso a paso (misma proyección, mismo
 *   `resolveTenant`, mismo `enrichForPersistence`, misma puerta de cuadre, mismo INSERT)
 *   contra un cliente falso que registra lo que recibe `insert()`. Las averías se
 *   provocan de verdad: el snapshot lanza, el clasificador lanza, el clasificador
 *   corrompe importes, `getUser()` devuelve error, el INSERT falla.
 *
 *   SOBRE EL FICHERO — sólo lo que un doble de JavaScript no puede ver: el ORDEN de los
 *   pasos, que el bucle fila a fila ya no exista, que las cinco derivadas no entren en el
 *   estado de React y que no haya DELETE compensatorio.
 *
 * Y un control negativo: si se salta el enriquecimiento, parte de esta suite tiene que
 * caerse. Un test de cableado que sigue verde sin el cableado no mide nada.
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
const { computeBudgetTotals, assertBudgetTotalsConsistent } = await import(
  path.join(root, "lib/budget-totals.ts")
);
const { normalizeBudgetItemUnit } = await import(path.join(root, "lib/budget-units.ts"));
const { isResolutionOrigin } = await import(path.join(root, "lib/types/canonical.ts"));

const PAGE_PATH = "app/dashboard/budgets/[id]/page.tsx";
const pageSrc = fs.readFileSync(path.join(root, PAGE_PATH), "utf8");

/**
 * El fichero SIN comentarios. Hace falta para poder afirmar que algo NO está: la página
 * explica en prosa lo que deliberadamente no hace, así que buscar un nombre a pelo
 * encuentra la explicación y da un falso positivo.
 */
function sinComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((linea) => linea.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const pageCodigo = sinComentarios(pageSrc);

/** El cuerpo entero de `duplicateBudget()`, del `async function` a la siguiente sentencia. */
function bloqueDeDuplicacion(src) {
  const iInicio = src.indexOf("async function duplicateBudget()");
  assert.ok(iInicio > 0, "no se encuentra duplicateBudget");

  const iFin = src.indexOf("const [exportingPDF", iInicio);
  assert.ok(iFin > iInicio, "no se encuentra el final de duplicateBudget");

  return src.slice(iInicio, iFin);
}

/** El cuerpo de `loadBudget()`, para auditar qué entra en el estado de React. */
function bloqueDeCarga(src) {
  const iInicio = src.indexOf("async function loadBudget()");
  assert.ok(iInicio > 0, "no se encuentra loadBudget");

  const iFin = src.indexOf("async function updateStatus", iInicio);
  assert.ok(iFin > iInicio, "no se encuentra el final de loadBudget");

  return src.slice(iInicio, iFin);
}

// ─── Tenant y vocabulario ─────────────────────────────────────────────────────

const EMPRESA = "7c3d1f0a-9b2e-4d5c-8a71-6e0f3b2c4d90";
const COPIA_ID = "c0c0c0c0-0000-4000-8000-0000000000cc";

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
 * `Retirada de escombros del chalet` sólo existe para `EMPRESA`. Es la sonda del
 * aislamiento de tenant: si una caída de auth acabase usando un `company_id` residual,
 * este alias se vería y la línea saldría `resolved`.
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
    exito: false,
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
                  : { data: { id: COPIA_ID, ...rows[0] }, error: null },
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

// ─── El presupuesto ORIGINAL, tal y como sale de la base de datos ─────────────

let filaSeq = 0;

/**
 * Una fila de `budget_items` ya persistida, con las SIETE columnas canónicas puestas.
 *
 * Es importante que el fixture las traiga todas: el original que se duplica viene de un
 * `select("*")`, así que en tiempo de ejecución llegan las siete. Lo que esta suite
 * comprueba es que sólo dos de ellas se transporten y las otras cinco se recalculen; si
 * el fixture no las trajera, esa diferencia sería inobservable.
 */
function filaOriginal(concept, quantity, unit, unit_price, extra = {}) {
  filaSeq += 1;
  const { derivadas = {}, ...resto } = extra;
  return {
    id: `f0000000-0000-4000-8000-${String(filaSeq).padStart(12, "0")}`,
    concept,
    description: `${concept} — ejecución completa`,
    quantity,
    unit,
    category: "mano_obra",
    unit_price,
    subtotal: Math.round(quantity * unit_price * 100) / 100,
    canonical_origin: null,
    canonical_source_ref: null,
    // Las cinco derivadas de la fila VIEJA. Valores deliberadamente distintos de los que
    // produciría clasificar hoy, para que copiarlas se note.
    canonical_id: "CONCEPTO.VIEJO.QUE.YA.NO.EXISTE",
    canonical_status: "resolved",
    canonical_confidence: 0.42,
    canonical_source: "curated",
    price_type: "SERVICE",
    ...derivadas,
    ...resto,
  };
}

/**
 * El original TAL Y COMO ESTÁ HOY EN LA BASE DE DATOS: cinco partidas sin procedencia.
 *
 * Que ninguna la traiga no es un descuido del fixture, es el estado real del producto:
 * las 807 filas del remoto están en `(canonical_origin NULL, canonical_status
 * 'unmatched')`, que es el default de la columna. Como `normalizeProvenance` degrada a
 * (NULL, NULL) todo lo que no declara un origen válido, estas cinco salen `unmatched`.
 */
function originalSinSellar() {
  filaSeq = 0;
  return [
    filaOriginal("Pintura plástica en paredes", 58, "m2", 15.64),
    filaOriginal("Pintura plástica blanca mate interior 15 L", 3, "unidades", 52.8, {
      category: "material",
    }),
    filaOriginal("Pintura blanca para interiores", 2, "ud", 47.31, { category: "material" }),
    filaOriginal("Trabajo con nombre ambiguo", 1, "ud", 133.07),
    filaOriginal("Un concepto que no está en el vocabulario", 12, "ml", 9.31),
  ];
}

/**
 * Las MISMAS cinco filas, con la procedencia sellada.
 *
 * Hace falta para medir el cableado de verdad. Sin origen no hay clasificación posible
 * —y entonces "las siete columnas llegan" se cumpliría con siete nulos, que es lo que ya
 * escribía la tabla por defecto—, así que con `originalSinSellar()` a solas esta suite no
 * podría distinguir un clasificador conectado de uno ausente.
 *
 * Los cuatro estados quedan cubiertos: alias exacto → resolved, sinónimo flojo → review,
 * texto con dos conceptos → ambiguous, texto ausente del vocabulario → unmatched.
 */
function originalSellado() {
  return originalSinSellar().map((f, i) => ({
    ...f,
    canonical_origin: i === 0 ? "ai" : "free_text",
  }));
}

/** La cabecera del presupuesto original. */
function presupuestoOriginal(overrides = {}) {
  return {
    id: "b0b0b0b0-0000-4000-8000-0000000000bb",
    title: "Reforma del chalet",
    subtotal: 1234.56,
    iva_percent: 21,
    iva_amount: 259.26,
    total: 1493.82,
    ...overrides,
  };
}

// ─── El cableado real, replicado paso a paso ─────────────────────────────────

/**
 * La proyección de `loadBudget()`: lo que de verdad acaba en el estado de React.
 *
 * Se replica aquí porque la duplicación no relee la base de datos, duplica lo que hay en
 * `items`. Si la proyección dejase pasar las cinco derivadas, la duplicación las tendría
 * a mano y podría copiarlas sin que nadie lo notase.
 */
function proyectarACargarEnEstado(filas) {
  return filas.map((row) => ({
    id: String(row.id ?? ""),
    concept: String(row.concept ?? ""),
    description: String(row.description ?? ""),
    quantity: Number(row.quantity ?? 0),
    unit: String(row.unit ?? ""),
    category: String(row.category ?? ""),
    unit_price: Number(row.unit_price ?? 0),
    subtotal: Number(row.subtotal ?? 0),
    canonical_origin: row.canonical_origin ?? null,
    canonical_source_ref: row.canonical_source_ref ?? null,
  }));
}

/**
 * RÉPLICA de `duplicateBudget()`, en el mismo orden.
 *
 * El orden ES el contrato: proyectar → economía del original → resolver tenant →
 * enriquecer → CUADRAR → crear la fila de `budgets` → insertar las partidas. Que el
 * cuadre vaya antes del primer INSERT es lo que impide que un descuadre deje una copia
 * huérfana.
 *
 * `opciones.sinEnriquecer` es el control negativo: escribe la proyección cruda, que es
 * literalmente lo que hacía el código antes de 2D-8.
 * `opciones.copiandoDerivadas` es el otro control: escribe las filas del original tal
 * cual, que es la alternativa de diseño que se descartó.
 */
async function duplicar(filasOriginal, opciones = {}) {
  const { client, stats } = fakeSupabase(DB, opciones);
  const budget = opciones.budget ?? presupuestoOriginal();
  const authResponse =
    opciones.authResponse ?? { data: { user: { id: EMPRESA } }, error: null };

  const items = proyectarACargarEnEstado(filasOriginal);

  const partidasCopiadas = items.map((item) => ({
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

  let tenant;
  try {
    tenant = resolveTenant(authResponse);
  } catch (err) {
    tenant = resolveTenant({ error: err });
  }

  const { items: clasificadas, report } = await enrichForPersistence({
    items: partidasCopiadas,
    tenant,
    context: "duplicateBudget",
    supabase: client,
    ...(opciones.classify ? { classify: opciones.classify } : {}),
    ...(opciones.loadSnapshot ? { loadSnapshot: opciones.loadSnapshot } : {}),
    ...(opciones.log ? { log: opciones.log } : {}),
  });

  let aEscribir = clasificadas;
  if (opciones.sinEnriquecer) aEscribir = partidasCopiadas;
  if (opciones.copiandoDerivadas) aEscribir = filasOriginal.map(({ id, ...resto }) => resto);

  const salida = {
    items,
    partidasCopiadas,
    clasificadas,
    report,
    stats,
    tenant,
    economiaOriginal,
    filasOriginal,
  };

  try {
    assertBudgetTotalsConsistent(
      economiaOriginal.subtotal,
      computeBudgetTotals({ lines: aEscribir }),
      "duplicateBudget",
    );
  } catch (mismatch) {
    stats.toastsError.push("No se pudo duplicar: los importes de la copia no coinciden");
    salida.mismatch = mismatch;
    return salida;
  }

  const { data: copia, error } = await client
    .from("budgets")
    .insert({
      title: budget.title + " (copia)",
      status: "pendiente",
      subtotal: budget.subtotal,
      iva_percent: budget.iva_percent,
      iva_amount: budget.iva_amount,
      total: budget.total,
    })
    .select()
    .single();

  if (error || !copia) {
    stats.toastsError.push("Error al duplicar");
    return salida;
  }
  salida.copia = copia;

  if (aEscribir.length > 0) {
    const { error: itemsError } = await client
      .from("budget_items")
      .insert(aEscribir.map((row) => ({ ...row, budget_id: copia.id })));

    if (itemsError) {
      stats.itemsError = itemsError;
      stats.toastsError.push("El presupuesto se duplicó, pero las partidas no se copiaron");
      stats.navegacion = `/dashboard/budgets/${copia.id}`;
      return salida;
    }
  }

  stats.exito = true;
  stats.navegacion = `/dashboard/budgets/${copia.id}`;
  return salida;
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

describe("2D-8 · A — el INSERT de la copia recibe las siete columnas canónicas", () => {
  test("CASO 1 — cada fila copiada lleva las siete claves, sin faltar ninguna", async () => {
    const { stats } = await duplicar(originalSellado());
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

  test("CASO 2 — sin enriquecer no llega ni una: el control negativo mide", async () => {
    const { stats } = await duplicar(originalSellado(), { sinEnriquecer: true });
    const filas = filasEscritas(stats);

    const derivadas = CANONICAL_COLUMN_KEYS.filter(
      (k) => k !== "canonical_origin" && k !== "canonical_source_ref",
    );
    for (const fila of filas) {
      for (const clave of derivadas) {
        assert.ok(
          !Object.prototype.hasOwnProperty.call(fila, clave),
          `'${clave}' aparece sin enriquecer: el control negativo no discrimina`,
        );
      }
    }
  });

  test("CASO 3 — el original de HOY (sin sellar) sale entero unmatched, y es correcto", async () => {
    // No es un fallo del cableado: es el estado real del dato. Las 807 filas del remoto
    // están sin procedencia, y `normalizeProvenance` degrada a (NULL, NULL) todo lo que
    // no declara un origen válido. Se mide para que quede escrito, no para celebrarlo.
    const { stats } = await duplicar(originalSinSellar());
    const filas = filasEscritas(stats);

    for (const fila of filas) {
      assert.equal(fila.canonical_status, "unmatched");
      assert.equal(fila.canonical_id, null);
      assert.equal(fila.canonical_origin, null);
    }
  });

  test("CASO 4 — con procedencia sellada la clasificación SÍ ocurre", async () => {
    const { stats } = await duplicar(originalSellado());
    const estados = filasEscritas(stats).map((f) => f.canonical_status);

    assert.ok(estados.includes("resolved"), "no resolvió ni una: el clasificador no está puesto");
    assert.deepEqual(estados.length, 5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B · Los cuatro estados canónicos, y las derivadas que les corresponden
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-8 · B — los cuatro estados salen coherentes", () => {
  const porConcepto = (filas, concept) => filas.find((f) => f.concept === concept);

  test("CASO 5 — resolved: id, confianza y fuente puestos, y la confianza no es la vieja", async () => {
    const { stats } = await duplicar(originalSellado());
    const fila = porConcepto(filasEscritas(stats), "Pintura plástica en paredes");

    assert.equal(fila.canonical_status, "resolved");
    assert.equal(fila.canonical_id, PAINT_WALL);
    assert.equal(typeof fila.canonical_confidence, "number");
    assert.notEqual(
      fila.canonical_confidence,
      0.42,
      "se transportó la confianza de la fila vieja en vez de recalcularla",
    );
    assert.notEqual(
      fila.canonical_id,
      "CONCEPTO.VIEJO.QUE.YA.NO.EXISTE",
      "se copió el canonical_id de la fila vieja",
    );
  });

  test("CASO 6 — resolved con un solo allowed_price_type: price_type con valor", async () => {
    const { stats } = await duplicar(originalSellado());
    const fila = porConcepto(filasEscritas(stats), "Pintura plástica blanca mate interior 15 L");

    assert.equal(fila.canonical_status, "resolved");
    assert.equal(fila.canonical_id, PAINT_MAT);
    assert.equal(fila.price_type, "MATERIAL_ONLY");
  });

  test("CASO 7 — resolved con varios allowed_price_types: price_type NULL, no el viejo", async () => {
    const { stats } = await duplicar(originalSellado());
    const fila = porConcepto(filasEscritas(stats), "Pintura plástica en paredes");

    assert.equal(
      fila.price_type,
      null,
      "con dos tipos permitidos el contrato no deja elegir uno, y el viejo era 'SERVICE'",
    );
  });

  test("CASO 8 — review: vínculo propuesto, price_type NULL por decisión", async () => {
    const { stats } = await duplicar(originalSellado());
    const fila = porConcepto(filasEscritas(stats), "Pintura blanca para interiores");

    assert.equal(fila.canonical_status, "review");
    assert.equal(fila.canonical_id, PAINT_MAT);
    assert.equal(fila.price_type, null, "un vínculo en revisión no fija price_type");
  });

  test("CASO 9 — ambiguous: sin canonical_id y sin price_type", async () => {
    const { stats } = await duplicar(originalSellado());
    const fila = porConcepto(filasEscritas(stats), "Trabajo con nombre ambiguo");

    assert.equal(fila.canonical_status, "ambiguous");
    assert.equal(fila.canonical_id, null);
    assert.equal(fila.price_type, null);
  });

  test("CASO 10 — unmatched: las cinco derivadas apagadas, no las de la fila vieja", async () => {
    const { stats } = await duplicar(originalSellado());
    const fila = porConcepto(filasEscritas(stats), "Un concepto que no está en el vocabulario");

    assert.equal(fila.canonical_status, "unmatched");
    assert.equal(fila.canonical_id, null);
    assert.equal(fila.canonical_confidence, null);
    assert.equal(fila.price_type, null);
  });

  test("CASO 11 — copiar las derivadas viejas produce otra cosa: la decisión se nota", async () => {
    // El control de la decisión de diseño. Si reclasificar y copiar dieran lo mismo, la
    // discusión sobre cuál de los dos hacer sería retórica y esta suite no mediría nada.
    const original = originalSellado();
    const reclasificado = await duplicar(original);
    const copiado = await duplicar(original, { copiandoDerivadas: true });

    const a = filasEscritas(reclasificado.stats).map((f) => f.canonical_status);
    const b = filasEscritas(copiado.stats).map((f) => f.canonical_status);

    assert.notDeepEqual(a, b, "reclasificar y copiar dan lo mismo: el fixture no discrimina");
    assert.ok(b.every((s) => s === "resolved"), "el fixture viejo debería venir todo resolved");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C · Procedencia: se transporta, no se inventa
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-8 · C — la copia hereda la procedencia del original", () => {
  test("CASO 12 — un original nacido `ai` produce una copia `ai`", async () => {
    const { stats } = await duplicar(originalSellado());
    const fila = filasEscritas(stats)[0];

    assert.equal(fila.canonical_origin, "ai");
  });

  test("CASO 13 — `import` con source_ref válido conserva las dos columnas", async () => {
    const entrada = [
      filaOriginal("Imprimación de paredes y techos", 41, "m2", 6.13, {
        canonical_origin: "import",
        canonical_source_ref: "cype_2026",
      }),
    ];
    const { stats } = await duplicar(entrada);
    const fila = filasEscritas(stats)[0];

    assert.equal(fila.canonical_origin, "import");
    assert.equal(fila.canonical_source_ref, "cype_2026");
    assert.equal(fila.canonical_status, "resolved");
  });

  test("CASO 14 — `engine`, `free_text` y `provider` viajan cada uno con el suyo", async () => {
    const entrada = [
      filaOriginal("Pintura plástica en paredes", 10, "m2", 12, { canonical_origin: "engine" }),
      filaOriginal("Pintura blanca para interiores", 2, "ud", 30, {
        canonical_origin: "free_text",
      }),
      filaOriginal("Imprimación de paredes y techos", 4, "m2", 6, {
        canonical_origin: "provider",
        canonical_source_ref: "cype_2026",
      }),
    ];
    const { stats } = await duplicar(entrada);
    const filas = filasEscritas(stats);

    assert.deepEqual(
      filas.map((f) => f.canonical_origin),
      ["engine", "free_text", "provider"],
    );
  });

  test("CASO 15 — a una línea sin procedencia NO se le inventa ninguna", async () => {
    // Ni `free_text` ni nada. Duplicar no vuelve a nacer una línea, así que no puede
    // afirmar un origen que nadie selló.
    const { stats } = await duplicar(originalSinSellar());

    for (const fila of filasEscritas(stats)) {
      assert.equal(fila.canonical_origin, null, `se inventó '${fila.canonical_origin}'`);
      assert.equal(fila.canonical_source_ref, null);
    }
  });

  test("CASO 16 — el fichero real no pasa defaultOrigin en la duplicación", async () => {
    const bloque = bloqueDeDuplicacion(pageCodigo);
    assert.doesNotMatch(
      bloque,
      /defaultOrigin/,
      "la duplicación está inventando una procedencia por defecto",
    );
    assert.doesNotMatch(bloque, /"free_text"|'free_text'/, "hay un free_text inventado");
  });

  test("CASO 17 — un origen no reconocido en la base de datos degrada a NULL", async () => {
    const entrada = [
      filaOriginal("Pintura plástica en paredes", 10, "m2", 12, {
        canonical_origin: "procedencia_que_no_existe",
      }),
    ];
    const { stats } = await duplicar(entrada);
    const fila = filasEscritas(stats)[0];

    assert.equal(fila.canonical_origin, null);
    assert.equal(fila.canonical_source_ref, null);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D · Invariantes: duplicar no cambia el presupuesto
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-8 · D — la copia es idéntica al original salvo en las canónicas", () => {
  test("CASO 18 — mismo número de partidas", async () => {
    const original = originalSellado();
    const { stats } = await duplicar(original);

    assert.equal(filasEscritas(stats).length, original.length);
  });

  test("CASO 19 — mismo ORDEN, concepto a concepto", async () => {
    const original = originalSellado();
    const { stats } = await duplicar(original);

    assert.deepEqual(
      filasEscritas(stats).map((f) => f.concept),
      original.map((f) => f.concept),
    );
  });

  test("CASO 20 — misma economía línea a línea", async () => {
    const original = originalSellado();
    const { stats } = await duplicar(original);
    const filas = filasEscritas(stats);

    for (let i = 0; i < original.length; i += 1) {
      assert.equal(filas[i].quantity, original[i].quantity);
      assert.equal(filas[i].unit_price, original[i].unit_price);
      assert.equal(filas[i].subtotal, original[i].subtotal);
    }
  });

  test("CASO 21 — mismos textos, categoría y unidad normalizada", async () => {
    const original = originalSellado();
    const { stats } = await duplicar(original);
    const filas = filasEscritas(stats);

    for (let i = 0; i < original.length; i += 1) {
      assert.equal(filas[i].concept, original[i].concept);
      assert.equal(filas[i].description, original[i].description);
      assert.equal(filas[i].category, original[i].category);
      assert.equal(filas[i].unit, normalizeBudgetItemUnit(original[i].unit));
    }
  });

  test("CASO 22 — el cuadre de la copia contra el original se cumple con delta cero", async () => {
    const original = originalSellado();
    const { stats, economiaOriginal } = await duplicar(original);

    assert.doesNotThrow(() =>
      assertBudgetTotalsConsistent(
        economiaOriginal.subtotal,
        computeBudgetTotals({ lines: filasEscritas(stats) }),
        "duplicateBudget",
      ),
    );
  });

  test("CASO 23 — un original descuadrado con su propio subtotal SE PUEDE duplicar igual", async () => {
    // El caso real: 15 de los 16 presupuestos del remoto tienen `budgets.subtotal`
    // distinto de la suma de sus líneas, porque son anteriores al contrato de totales v2
    // y guardaban los materiales como líneas económicas. Si la guarda comparase contra
    // `budget.subtotal`, ninguno de ellos podría duplicarse nunca más.
    const budget = presupuestoOriginal({ subtotal: 0 });
    const { stats, mismatch } = await duplicar(originalSellado(), { budget });

    assert.equal(mismatch, undefined, "un descuadre heredado está bloqueando la duplicación");
    assert.equal(filasEscritas(stats).length, 5);
    assert.equal(stats.exito, true);
  });

  test("CASO 24 — la cabecera copiada conserva la economía del original tal cual", async () => {
    const budget = presupuestoOriginal({ subtotal: 4321.09, total: 5228.52 });
    const { stats } = await duplicar(originalSellado(), { budget });
    const cabecera = stats.inserts.find((i) => i.table === "budgets").rows[0];

    assert.equal(cabecera.subtotal, 4321.09);
    assert.equal(cabecera.total, 5228.52);
  });

  test("CASO 25 — el fichero real no compara la copia contra budget.subtotal", async () => {
    const bloque = bloqueDeDuplicacion(pageCodigo);
    const iAssert = bloque.indexOf("assertBudgetTotalsConsistent");
    assert.ok(iAssert > 0, "no hay guarda de cuadre en la duplicación");

    // La etiqueta de contexto aparece antes, en la llamada a `enrichForPersistence`, así
    // que se busca la ocurrencia POSTERIOR al assert; anclar en la primera dejaría el
    // recorte vacío y el test pasaría sin haber mirado nada.
    const iEtiqueta = bloque.indexOf('"duplicateBudget"', iAssert);
    assert.ok(iEtiqueta > iAssert, "la guarda de cuadre no lleva el contexto de duplicación");

    const argumentos = bloque.slice(iAssert, bloque.indexOf(")", iEtiqueta));
    assert.doesNotMatch(
      argumentos,
      /budget\.subtotal/,
      "la guarda compara contra budget.subtotal: los presupuestos heredados dejarían de duplicarse",
    );
    assert.match(argumentos, /economiaOriginal/, "la guarda no compara contra el original");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// E · El estado de React no es fuente de verdad de las derivadas
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-8 · E — las cinco derivadas no entran en el estado de React", () => {
  const derivadas = ["canonical_id", "canonical_status", "canonical_confidence", "canonical_source", "price_type"];

  test("CASO 26 — la proyección de carga descarta las cinco derivadas", async () => {
    const items = proyectarACargarEnEstado(originalSellado());

    for (const item of items) {
      for (const clave of derivadas) {
        assert.ok(
          !Object.prototype.hasOwnProperty.call(item, clave),
          `'${clave}' entró en el estado desde la carga`,
        );
      }
    }
  });

  test("CASO 27 — pero las dos aportadas SÍ entran, que si no no hay qué transportar", async () => {
    const items = proyectarACargarEnEstado(originalSellado());

    assert.equal(items[0].canonical_origin, "ai");
    for (const item of items) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, "canonical_source_ref"));
    }
  });

  test("CASO 28 — el `loadBudget` real proyecta, no vuelca el select('*') entero", async () => {
    const carga = bloqueDeCarga(pageCodigo);

    assert.doesNotMatch(
      carga,
      /setItems\(\s*bi\s*\|\|\s*\[\]\s*\)/,
      "se está volcando la fila entera al estado: las cinco derivadas entran con ella",
    );
    for (const clave of derivadas) {
      assert.doesNotMatch(
        carga,
        new RegExp(`\\b${clave}(?![_a-zA-Z0-9])`),
        `'${clave}' aparece en la carga: no debería entrar en el estado`,
      );
    }
  });

  test("CASO 29 — el resultado clasificado no vuelve a setItems", async () => {
    const bloque = bloqueDeDuplicacion(pageCodigo);
    assert.doesNotMatch(
      bloque,
      /setItems\(/,
      "la duplicación devuelve la clasificación al estado: se convierte en fuente de verdad",
    );
  });

  test("CASO 30 — la interfaz BudgetItem no declara ninguna derivada", async () => {
    const iInicio = pageCodigo.indexOf("interface BudgetItem {");
    const iFin = pageCodigo.indexOf("}", iInicio);
    const cuerpo = pageCodigo.slice(iInicio, iFin);

    for (const clave of derivadas) {
      assert.doesNotMatch(
        cuerpo,
        new RegExp(`\\b${clave}(?![_a-zA-Z0-9])`),
        `BudgetItem declara '${clave}'`,
      );
    }
    assert.match(cuerpo, /canonical_origin/);
    assert.match(cuerpo, /canonical_source_ref/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// F · Una sola carga de vocabulario, un solo INSERT
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-8 · F — el coste de duplicar no crece con el número de partidas", () => {
  test("CASO 31 — el snapshot se carga UNA vez por duplicación", async () => {
    let cargas = 0;
    const { loadCanonicalRegistrySnapshot } = await import(
      path.join(root, "lib/canonical/registry-snapshot.ts")
    );

    const { report } = await duplicar(originalSellado(), {
      loadSnapshot: async (opts) => {
        cargas += 1;
        return loadCanonicalRegistrySnapshot(opts);
      },
    });

    assert.equal(cargas, 1, `el snapshot se cargó ${cargas} veces`);
    assert.equal(report.snapshotLoads, 1);
  });

  test("CASO 32 — doblar las partidas no dobla las cargas de snapshot", async () => {
    let cargas = 0;
    const { loadCanonicalRegistrySnapshot } = await import(
      path.join(root, "lib/canonical/registry-snapshot.ts")
    );
    const spy = async (opts) => {
      cargas += 1;
      return loadCanonicalRegistrySnapshot(opts);
    };

    await duplicar([...originalSellado(), ...originalSellado()], { loadSnapshot: spy });

    assert.equal(cargas, 1, "el snapshot se está cargando por partida: ha vuelto el N+1");
  });

  test("CASO 33 — las partidas se escriben en UN solo INSERT, no una por fila", async () => {
    const { stats } = await duplicar(originalSellado());
    const escrituras = stats.inserts.filter((i) => i.table === "budget_items");

    assert.equal(escrituras.length, 1, "ha vuelto el bucle fila a fila");
    assert.equal(escrituras[0].rows.length, 5);
  });

  test("CASO 34 — el bucle `for (const item of items)` con insert dentro ya no existe", async () => {
    const bloque = bloqueDeDuplicacion(pageCodigo);

    assert.doesNotMatch(
      bloque,
      /for\s*\(\s*const\s+item\s+of\s+items\s*\)/,
      "sigue ahí el writer sin cablear: el bucle de inserts fila a fila",
    );
    assert.match(
      bloque,
      /partidasClasificadas\.map\(\s*\(row\)\s*=>/,
      "el INSERT no escribe las filas clasificadas",
    );
  });

  test("CASO 35 — la cabecera se escribe ANTES que las partidas", async () => {
    const { stats } = await duplicar(originalSellado());
    const tablas = stats.inserts.map((i) => i.table);

    assert.deepEqual(tablas, ["budgets", "budget_items"]);
  });

  test("CASO 36 — el ORDEN del fichero real: cuadrar antes de crear nada", async () => {
    const bloque = bloqueDeDuplicacion(pageCodigo);

    const iProyeccion = bloque.indexOf("const partidasCopiadas");
    const iTenant = bloque.indexOf("resolveTenant");
    const iEnriquecer = bloque.indexOf("enrichForPersistence");
    const iCuadre = bloque.indexOf("assertBudgetTotalsConsistent");
    const iBudgets = bloque.indexOf('.from("budgets")');
    const iItems = bloque.indexOf('.from("budget_items")');

    assert.ok(iProyeccion > 0 && iTenant > iProyeccion, "el tenant se resuelve antes de proyectar");
    assert.ok(iEnriquecer > iTenant, "se enriquece antes de resolver el tenant");
    assert.ok(iCuadre > iEnriquecer, "se cuadra antes de enriquecer");
    assert.ok(iBudgets > iCuadre, "se crea el presupuesto antes de cuadrar");
    assert.ok(iItems > iBudgets, "las partidas se escriben antes que la cabecera");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G · Fail-open: una avería canónica nunca impide duplicar
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-8 · G — la copia se hace aunque la capa canónica se rompa", () => {
  const snapshotRoto = async () => {
    throw new Error("snapshot caído");
  };
  const clasificadorRoto = async () => {
    throw new Error("clasificador roto");
  };

  test("CASO 37 — el snapshot se avería: se duplica igual, todo unmatched", async () => {
    const { stats, report } = await duplicar(originalSellado(), { loadSnapshot: snapshotRoto });
    const filas = filasEscritas(stats);

    assert.equal(report.degraded, "snapshot");
    assert.equal(filas.length, 5);
    assert.equal(stats.exito, true);
    for (const fila of filas) assert.equal(fila.canonical_status, "unmatched");
  });

  test("CASO 38 — la avería de snapshot NO borra la procedencia transportada", async () => {
    const entrada = [
      filaOriginal("Imprimación de paredes y techos", 41, "m2", 6.13, {
        canonical_origin: "import",
        canonical_source_ref: "cype_2026",
      }),
    ];
    const { stats } = await duplicar(entrada, { loadSnapshot: snapshotRoto });
    const fila = filasEscritas(stats)[0];

    assert.equal(fila.canonical_origin, "import");
    assert.equal(fila.canonical_source_ref, "cype_2026");
  });

  test("CASO 39 — el clasificador LANZA: se duplica igual", async () => {
    const { stats, report } = await duplicar(originalSellado(), { classify: clasificadorRoto });

    assert.equal(report.degraded, "classifier");
    assert.equal(filasEscritas(stats).length, 5);
    assert.equal(stats.exito, true);
  });

  test("CASO 40 — la economía sobrevive intacta a las dos averías", async () => {
    const original = originalSellado();
    for (const opciones of [{ loadSnapshot: snapshotRoto }, { classify: clasificadorRoto }]) {
      const { stats, economiaOriginal } = await duplicar(original, opciones);
      const filas = filasEscritas(stats);

      for (let i = 0; i < original.length; i += 1) {
        assert.equal(filas[i].quantity, original[i].quantity);
        assert.equal(filas[i].unit_price, original[i].unit_price);
        assert.equal(filas[i].subtotal, original[i].subtotal);
      }
      assert.doesNotThrow(() =>
        assertBudgetTotalsConsistent(
          economiaOriginal.subtotal,
          computeBudgetTotals({ lines: filas }),
          "duplicateBudget",
        ),
      );
    }
  });

  test("CASO 41 — el clasificador ALTERA la economía: se escriben los importes del original", async () => {
    // No lanza, no falla, no avisa: miente. La guarda de integridad económica de
    // `classifyForPersistence` tiene que descubrirlo comparando, tirar la clasificación
    // entera y devolver las líneas originales. Si no lo hiciera, o bien la copia saldría
    // con importes distintos del original, o bien el cuadre reventaría y una avería del
    // OBSERVADOR impediría duplicar.
    const saboteador = async (lines) => ({
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

    const original = originalSellado();
    const { stats, report, mismatch } = await duplicar(original, { classify: saboteador });
    const filas = filasEscritas(stats);

    assert.equal(mismatch, undefined, "la avería del observador impidió duplicar");
    assert.equal(report.degraded, "economic_integrity");
    assert.equal(report.failureKind, "value:unit_price");
    for (let i = 0; i < original.length; i += 1) {
      assert.equal(filas[i].unit_price, original[i].unit_price, "se escribió el precio corrupto");
      assert.equal(filas[i].subtotal, original[i].subtotal, "se escribió el subtotal corrupto");
      assert.equal(filas[i].canonical_id, null, "se escribió la clasificación mentirosa");
      assert.equal(filas[i].canonical_status, "unmatched");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// H · El INSERT que falla: ni se traga ni se cuenta como éxito
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-8 · H — un fallo de persistencia se ve", () => {
  test("CASO 42 — el error del INSERT de partidas se LEE, se avisa y no se da por bueno", async () => {
    // Tres cosas distintas, y las tres importan:
    //   1. el error se LEE (antes se descartaba el resultado de cada insert del bucle);
    //   2. se AVISA, porque la copia ya existe y está vacía;
    //   3. NO se sigue por la rama de éxito.
    const { stats } = await duplicar(originalSellado(), {
      insertErrors: { budget_items: { message: "violates check constraint" } },
    });

    assert.ok(stats.itemsError, "el error del INSERT se descartó");
    assert.equal(stats.itemsError.message, "violates check constraint");
    assert.equal(stats.toastsError.length, 1);
    assert.equal(stats.exito, false, "un INSERT fallido sigue contando como duplicación correcta");
    assert.equal(stats.navegacion, `/dashboard/budgets/${COPIA_ID}`);
  });

  test("CASO 43 — la duplicación que va bien sí se cuenta: el caso anterior mide", async () => {
    const { stats } = await duplicar(originalSellado());

    assert.equal(stats.itemsError, undefined);
    assert.deepEqual(stats.toastsError, []);
    assert.equal(stats.exito, true);
  });

  test("CASO 44 — el fichero real trata el error y no sigue por la rama de éxito", async () => {
    const bloque = bloqueDeDuplicacion(pageCodigo);

    const iError = bloque.indexOf("if (itemsError)");
    assert.ok(iError > 0, "el error del INSERT de partidas no se comprueba");

    const iCierre = bloque.lastIndexOf("router.push");
    assert.ok(
      bloque.slice(iError, iCierre).includes("return;"),
      "la rama de error no corta el flujo",
    );
    assert.ok(bloque.slice(iError, iCierre).includes("toast.error"), "la rama de error no avisa");
  });

  test("CASO 45 — no hay DELETE compensatorio del presupuesto padre", async () => {
    const bloque = bloqueDeDuplicacion(pageCodigo);

    assert.doesNotMatch(
      bloque,
      /\.delete\(/,
      "hay un DELETE compensatorio de cliente: eso no da atomicidad, añade otro modo de fallo",
    );

    const { stats } = await duplicar(originalSellado(), {
      insertErrors: { budget_items: { message: "boom" } },
    });
    assert.equal(stats.deletes, 0);
  });

  test("CASO 46 — si falla la cabecera no se intenta escribir ni una partida", async () => {
    const { stats } = await duplicar(originalSellado(), {
      insertErrors: { budgets: { message: "duplicate key" } },
    });

    assert.equal(stats.inserts.filter((i) => i.table === "budget_items").length, 0);
    assert.equal(stats.exito, false);
    assert.deepEqual(stats.toastsError, ["Error al duplicar"]);
  });

  test("CASO 47 — un presupuesto sin partidas no lanza un INSERT vacío", async () => {
    const { stats } = await duplicar([]);

    assert.equal(stats.inserts.filter((i) => i.table === "budget_items").length, 0);
    assert.equal(stats.exito, true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// I · Auth: perder el tenant degrada la clasificación, nunca la escala
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-8 · I — un fallo de auth no puede escalar privilegios", () => {
  test("CASO 48 — auth con error y user residual: companyId nulo y contexto unavailable", async () => {
    const { tenant, report } = await duplicar(originalSellado(), {
      authResponse: { data: { user: { id: EMPRESA } }, error: { message: "session expired" } },
    });

    assert.equal(tenant.companyId, null, "se usó como tenant un user que auth no verificó");
    assert.equal(tenant.tenantContext, "unavailable");
    assert.equal(report.tenant_context, "unavailable");
  });

  test("CASO 49 — sin sesión: unavailable con code:no_session", async () => {
    const { tenant, report } = await duplicar(originalSellado(), {
      authResponse: { data: { user: null }, error: null },
    });

    assert.equal(tenant.companyId, null);
    assert.equal(tenant.tenantContext, "unavailable");
    assert.equal(report.tenantFailureKind, "code:no_session");
  });

  test("CASO 50 — perder el tenant NO da acceso al vocabulario privado de la empresa", async () => {
    // La sonda: `Retirada de escombros del chalet` sólo existe como alias de EMPRESA.
    // Va SELLADA: sin origen no resolvería ni con tenant ni sin él, y los dos lados
    // saldrían `unmatched` por el motivo equivocado.
    const entrada = [
      filaOriginal("Retirada de escombros del chalet", 1, "ud", 220, {
        canonical_origin: "free_text",
      }),
    ];

    const conTenant = await duplicar(entrada);
    assert.equal(
      filasEscritas(conTenant.stats)[0].canonical_status,
      "resolved",
      "la sonda no está midiendo: el alias privado no resuelve ni con tenant",
    );

    const sinTenant = await duplicar(entrada, {
      authResponse: { data: { user: { id: EMPRESA } }, error: { message: "expired" } },
    });
    assert.equal(
      filasEscritas(sinTenant.stats)[0].canonical_status,
      "unmatched",
      "se leyó vocabulario privado con una identidad no verificada",
    );
  });

  test("CASO 51 — pero se sigue clasificando con el vocabulario global", async () => {
    const { stats } = await duplicar(originalSellado(), {
      authResponse: { data: { user: null }, error: null },
    });
    const estados = filasEscritas(stats).map((f) => f.canonical_status);

    assert.ok(
      estados.includes("resolved"),
      "sin tenant no se clasificó nada: se perdió también el vocabulario global",
    );
  });

  test("CASO 52 — una excepción de getUser() se trata como error de auth, y se duplica igual", async () => {
    const { stats } = await duplicar(originalSellado(), {
      authResponse: {
        get data() {
          throw new Error("network down");
        },
      },
    });

    assert.equal(filasEscritas(stats).length, 5);
    assert.equal(stats.exito, true);
  });

  test("CASO 53 — el fichero real envuelve getUser() en try/catch", async () => {
    const bloque = bloqueDeDuplicacion(pageCodigo);
    const iTry = bloque.indexOf("try {");
    const iGetUser = bloque.indexOf("supabase.auth.getUser()");

    assert.ok(iGetUser > iTry && iTry > 0, "getUser() no está protegido");
    assert.match(
      bloque.slice(iGetUser, iGetUser + 300),
      /catch\s*\([\s\S]{0,20}\)\s*\{[\s\S]{0,120}resolveTenant\(\s*\{\s*error/,
      "una excepción de getUser() no se traduce a un tenant no disponible",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J · Control negativo
// ══════════════════════════════════════════════════════════════════════════════

describe("2D-8 · J — sin el cableado esta suite se cae", () => {
  test("CASO 54 — quitar el enriquecimiento rompe los cuatro estados", async () => {
    const { stats } = await duplicar(originalSellado(), { sinEnriquecer: true });
    const filas = filasEscritas(stats);

    for (const fila of filas) {
      assert.equal(
        fila.canonical_status,
        undefined,
        "sin enriquecer sigue habiendo estado canónico: el control no mide",
      );
    }
  });

  test("CASO 55 — y rompe también el transporte de las derivadas al INSERT", async () => {
    const conCableado = await duplicar(originalSellado());
    const sinCableado = await duplicar(originalSellado(), { sinEnriquecer: true });

    const clavesCon = new Set(Object.keys(filasEscritas(conCableado.stats)[0]));
    const clavesSin = new Set(Object.keys(filasEscritas(sinCableado.stats)[0]));

    assert.equal(clavesCon.size - clavesSin.size, 5, "la diferencia no son las cinco derivadas");
  });

  test("CASO 56 — el contexto `duplicateBudget` existe en la capa canónica", async () => {
    const src = fs.readFileSync(
      path.join(root, "lib/canonical/finalize-classification.ts"),
      "utf8",
    );
    assert.match(src, /\|\s*"duplicateBudget"/, "la duplicación no tiene contexto propio");

    // Y viaja de verdad hasta el informe, que es lo que permitirá distinguir en el log
    // una degradación de la duplicación de una del alta o de la edición.
    const etiquetas = [];
    await duplicar(originalSellado(), {
      log: (_report, context) => etiquetas.push(context),
    });

    assert.deepEqual(etiquetas, ["duplicateBudget"]);

    const bloque = bloqueDeDuplicacion(pageCodigo);
    assert.match(bloque, /context:\s*"duplicateBudget"/, "el writer real no etiqueta su contexto");
  });
});
