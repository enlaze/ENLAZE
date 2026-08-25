/**
 * FASE 2D-2b · El origen `ai`.
 *
 * Protege tres afirmaciones que no se sostienen solas:
 *
 *   1. `suggested_items` NO siempre viene del modelo. Cuando el enriquecimiento externo
 *      falla, ese mismo campo lo rellena el motor determinista. El discriminador debe
 *      distinguirlos con las dos señales que emite el propio fallback, y con ninguna otra.
 *
 *   2. `ai` describe procedencia, no fiabilidad, y NO otorga privilegio. Una línea `ai`
 *      no puede ganar un concepto por el NIVEL 1 como si fuera `engine`. Esta propiedad
 *      no está escrita en ninguna condición del resolver: emerge de que `ai` esté fuera
 *      de ALIAS_SOURCES. Al ser emergente es frágil, y por eso se prueba de frente.
 *
 *   3. El sello se pone al nacer y no se repone. Atravesar el motor no reetiqueta.
 *
 * Dos estrategias, según lo que se pueda ejecutar. `lib/canonical/*` y
 * `lib/budget-engine.ts` se ejecutan de verdad. BudgetGenerateProvider.tsx no puede
 * importarse en node:test, así que se afirma sobre su texto fuente, siguiendo la
 * convención ya usada en budget-integrity y budget-provenance.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { originForBudgetAnalysis } = await import(path.join(root, "lib/canonical/analysis-origin.ts"));
const { RESOLUTION_ORIGINS, ALIAS_SOURCES, EXACT_SOURCES, originAsAliasSource } = await import(
  path.join(root, "lib/types/canonical.ts")
);
const { normalizeProvenance } = await import(path.join(root, "lib/canonical/classify-budget-items.ts"));
const { canonicalNormalize, createInMemoryRegistry } = await import(
  path.join(root, "lib/canonical/registry.ts")
);
const { resolveCanonical } = await import(path.join(root, "lib/canonical/resolver.ts"));
const { buildDeterministicBudgetAnalysis } = await import(path.join(root, "lib/budget-analysis-fallback.ts"));
const {
  normalizeBudgetItemsToScope,
  calculateItemCostBreakdown,
  applyMaterialBasketToItems,
  adjustToMarket,
  buildScopeMaterials,
} = await import(path.join(root, "lib/budget-engine.ts"));

const providerSrc = fs.readFileSync(
  path.join(root, "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx"),
  "utf8"
);
const engineSrc = fs.readFileSync(path.join(root, "lib/budget-engine.ts"), "utf8");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MARGIN = 1.25;

const scope = () => ({
  superficie_m2: 80,
  ubicacion: "Madrid",
  project_context: "existing_renovation",
  existing_condition: "fair",
  conservation_strategy: "balanced",
  num_banos: 1,
  incluye_cocina: true,
});

/** Una línea nacida de la IA, tal y como sale del `.map()` de suggested_items. */
const lineaIA = (over = {}) => ({
  id: "ai-p-0",
  concept: "Pintura plástica en paredes",
  description: "",
  quantity: 10,
  unit: "m2",
  category: "mano_obra",
  chapter: "revestimientos",
  unit_price: 12,
  subtotal_cost: 120,
  unit_price_client: 15,
  subtotal_client: 150,
  status: "incluida",
  canonical_origin: "ai",
  canonical_source_ref: null,
  ...over,
});

const buscar = (items, id) => {
  const found = items.find((i) => i.id === id);
  assert.ok(found, `la línea ${id} debe seguir existiendo`);
  return found;
};

// ═══ 1 · El discriminador ═════════════════════════════════════════════════════

test("un análisis externo enriquecido nace ai", () => {
  assert.equal(
    originForBudgetAnalysis({ analysis_mode: "external_enhanced", data_sources: { using_ai_fallback: false } }),
    "ai"
  );
});

test("el fallback determinista, con sus dos señales, nace engine", () => {
  assert.equal(
    originForBudgetAnalysis({
      analysis_mode: "deterministic_engine",
      data_sources: { using_ai_fallback: true },
    }),
    "engine"
  );
});

test("deterministic_engine con la bandera incoherente cae en ai", () => {
  assert.equal(
    originForBudgetAnalysis({
      analysis_mode: "deterministic_engine",
      data_sources: { using_ai_fallback: false },
    }),
    "ai",
    "si las dos señales del mismo emisor se contradicen, se pierde el privilegio"
  );
});

test("deterministic_engine sin data_sources cae en ai", () => {
  assert.equal(originForBudgetAnalysis({ analysis_mode: "deterministic_engine" }), "ai");
  assert.equal(originForBudgetAnalysis({ analysis_mode: "deterministic_engine", data_sources: null }), "ai");
  assert.equal(
    originForBudgetAnalysis({ analysis_mode: "deterministic_engine", data_sources: {} }),
    "ai"
  );
});

test("un analysis_mode desconocido cae en ai", () => {
  for (const modo of ["", "engine", "ENGINE", "deterministic", "deterministic_engine_v2", "otra_cosa"]) {
    assert.equal(
      originForBudgetAnalysis({ analysis_mode: modo, data_sources: { using_ai_fallback: true } }),
      "ai",
      `"${modo}" no es la señal exacta y no debe conceder engine`
    );
  }
});

test("un payload ausente o vacío cae en ai", () => {
  assert.equal(originForBudgetAnalysis(null), "ai");
  assert.equal(originForBudgetAnalysis(undefined), "ai");
  assert.equal(originForBudgetAnalysis({}), "ai");
});

test("la bandera se compara idéntica: 'true', 1 o 'yes' no son true", () => {
  for (const valor of ["true", 1, "yes", {}, [] ]) {
    assert.equal(
      originForBudgetAnalysis({ analysis_mode: "deterministic_engine", data_sources: { using_ai_fallback: valor } }),
      "ai",
      `un valor sólo truthy (${JSON.stringify(valor)}) no acredita el fallback`
    );
  }
});

test("el discriminador no mira price_source ni los textos ni el número de líneas", () => {
  // Payload de IA que imita al motor en TODO lo que el discriminador tiene prohibido mirar.
  const disfrazado = {
    analysis_mode: "external_enhanced",
    source: "enlaze_deterministic_engine",
    data_sources: { using_ai_fallback: false, tracker_products_count: 0 },
    suggested_items: Array.from({ length: 30 }, () => ({
      concept: "Contenedor y transporte a gestor autorizado",
      price_source: "engine_scope",
      chapter: "gestion_residuos",
    })),
  };
  assert.equal(originForBudgetAnalysis(disfrazado), "ai");

  // Y al revés: el motor sigue siendo motor aunque el payload parezca pobre.
  assert.equal(
    originForBudgetAnalysis({
      analysis_mode: "deterministic_engine",
      data_sources: { using_ai_fallback: true },
      suggested_items: [],
      source: "cualquier_cosa",
    }),
    "engine"
  );
});

test("CONTRATO REAL — el payload que fabrica buildDeterministicBudgetAnalysis da engine", () => {
  const data = buildDeterministicBudgetAnalysis({
    sector: "construccion",
    serviceType: "reforma",
    scope: scope(),
    reason: "El servicio de IA no respondió; cálculo realizado por el motor técnico ENLAZE.",
  });
  assert.ok(data.suggested_items.length > 0, "el fixture debe traer líneas, si no el test es vacío");
  assert.equal(
    originForBudgetAnalysis(data),
    "engine",
    "este es el caso que impide etiquetar como ai unas líneas que fabricó el motor"
  );
});

// ═══ 2 · El nacimiento en el provider ═════════════════════════════════════════

const entre = (desde, hasta) => {
  const i = providerSrc.indexOf(desde);
  assert.notEqual(i, -1, `no se encuentra el anclaje "${desde}"`);
  const j = providerSrc.indexOf(hasta, i);
  assert.notEqual(j, -1, `no se encuentra el cierre "${hasta}"`);
  return providerSrc.slice(i, j);
};

test("el provider decide el origen UNA vez, antes del map de suggested_items", () => {
  const decision = providerSrc.indexOf("const analysisOrigin = originForBudgetAnalysis(data)");
  const mapa = providerSrc.indexOf("(data.suggested_items || []).map(");
  assert.notEqual(decision, -1, "debe existir la decisión única");
  assert.notEqual(mapa, -1);
  assert.ok(decision < mapa, "la decisión debe preceder al map, no repetirse dentro");

  const cuerpo = entre("(data.suggested_items || []).map(", "// Map materials");
  assert.equal(
    (cuerpo.match(/originForBudgetAnalysis/g) || []).length,
    0,
    "dentro del map no se vuelve a preguntar: dos líneas hermanas no pueden discrepar"
  );
});

test("el map de suggested_items sella el origen calculado y source_ref null", () => {
  const cuerpo = entre("(data.suggested_items || []).map(", "// Map materials");
  assert.match(cuerpo, /canonical_origin:\s*analysisOrigin/);
  assert.match(cuerpo, /canonical_source_ref:\s*null/);
});

test("el map NO escribe la constante 'ai' a mano", () => {
  const cuerpo = entre("(data.suggested_items || []).map(", "// Map materials");
  assert.doesNotMatch(
    cuerpo,
    /canonical_origin:\s*["']ai["']/,
    "sellar la constante saltándose el discriminador etiquetaría de IA las líneas del motor"
  );
});

test("siguen existiendo exactamente DOS puntos de nacimiento engine en el motor", () => {
  assert.equal(
    (engineSrc.match(/canonical_origin:\s*"engine"/g) || []).length,
    2,
    "2D-2b no debe haber añadido ni movido puntos de nacimiento en budget-engine"
  );
});

test("el provider mantiene su único nacimiento free_text en addPartida", () => {
  assert.equal(
    (providerSrc.match(/canonical_origin:\s*partida\.canonical_origin\s*\?\?\s*"free_text"/g) || []).length,
    1
  );
});

// ═══ 3 · El sello sobrevive a las transformaciones ════════════════════════════

test("una línea ai atraviesa el motor entero y sigue siendo ai", () => {
  const s = scope();
  let items = normalizeBudgetItemsToScope(s, [lineaIA()], MARGIN);
  assert.equal(buscar(items, "ai-p-0").canonical_origin, "ai", "normalizeBudgetItemsToScope");

  items = items.map((i) => calculateItemCostBreakdown(i, s, 25));
  assert.equal(buscar(items, "ai-p-0").canonical_origin, "ai", "calculateItemCostBreakdown");

  const materiales = buildScopeMaterials(s);
  items = applyMaterialBasketToItems(items, materiales, MARGIN);
  assert.equal(buscar(items, "ai-p-0").canonical_origin, "ai", "applyMaterialBasketToItems");

  items = adjustToMarket(s, items, materiales, "reforma_integral", MARGIN, true).items;
  const final = buscar(items, "ai-p-0");
  assert.equal(final.canonical_origin, "ai", "adjustToMarket");
  assert.equal(final.canonical_source_ref, null, "ai nunca adquiere instancia documental por el camino");
});

test("CONTROL NEGATIVO — la comprobación anterior detectaría de verdad la avería", () => {
  const salida = normalizeBudgetItemsToScope(scope(), [lineaIA()], MARGIN).map((i) => ({
    ...i,
    canonical_origin: "engine",
  }));
  assert.throws(
    () => assert.equal(buscar(salida, "ai-p-0").canonical_origin, "ai"),
    assert.AssertionError,
    "el oráculo debe distinguir 'nació de la IA' de 'pasó por el motor'"
  );
});

test("price_source cambia y canonical_origin no se entera", () => {
  const s = scope();
  // Precio bajísimo para forzar el escalado de adjustToMarket, que es quien reescribe.
  const barata = lineaIA({ unit_price: 1, price_source: "engine_scope" });
  let items = normalizeBudgetItemsToScope(s, [barata], MARGIN);
  items = items.map((i) => calculateItemCostBreakdown(i, s, 25));
  const antes = buscar(items, "ai-p-0").unit_price;

  const materiales = buildScopeMaterials(s);
  const despues = buscar(
    adjustToMarket(s, items, materiales, "reforma_integral", MARGIN, true).items,
    "ai-p-0"
  );
  assert.notEqual(despues.unit_price, antes, "el ajuste debe haber movido el precio, si no el test es vacío");
  assert.equal(despues.canonical_origin, "ai", "el PRECIO cambió de fuente; el NACIMIENTO no");
});

test("una línea histórica sin procedencia sigue sin procedencia", () => {
  const { canonical_origin, canonical_source_ref, ...historica } = lineaIA();
  const items = normalizeBudgetItemsToScope(scope(), [historica], MARGIN);
  const salida = buscar(items, "ai-p-0");
  assert.equal(salida.canonical_origin, undefined, "no se convierte en ai, ni en engine, ni en legacy");
  assert.equal(salida.canonical_source_ref, undefined);
});

// ═══ 4 · Vocabulario: ai existe como origen y NO como procedencia de alias ════

test("ai está en RESOLUTION_ORIGINS y fuera de ALIAS_SOURCES", () => {
  assert.ok(RESOLUTION_ORIGINS.includes("ai"));
  assert.ok(!ALIAS_SOURCES.includes("ai"), "añadirlo aquí concedería NIVEL 1 en silencio");
});

test("no existe exact_ai", () => {
  assert.ok(!EXACT_SOURCES.includes("exact_ai"), "ck_budget_items_canonical_source lo rechazaría");
});

test("originAsAliasSource('ai') es null, y por eso no hay NIVEL 1", () => {
  assert.equal(originAsAliasSource("ai"), null);
  assert.equal(originAsAliasSource("engine"), "engine", "el contraste importa: engine SÍ lo es");
});

// ═══ 5 · normalizeProvenance ══════════════════════════════════════════════════

test("ai se normaliza a (ai, null)", () => {
  assert.deepEqual(normalizeProvenance({ canonical_origin: "ai", canonical_source_ref: null }, null), {
    origin: "ai",
    sourceRef: null,
  });
});

test("ai con un source_ref sobrante pierde el source_ref, NO el origen", () => {
  for (const ref of ["cype", "public_bc3", "BASURA MAL FORMADA", ""]) {
    assert.deepEqual(
      normalizeProvenance({ canonical_origin: "ai", canonical_source_ref: ref }, null),
      { origin: "ai", sourceRef: null },
      `un adorno sobrante (${JSON.stringify(ref)}) no desmiente dónde nació la línea`
    );
  }
});

test("import sí se degrada sin source_ref: la asimetría se mantiene", () => {
  assert.deepEqual(normalizeProvenance({ canonical_origin: "import", canonical_source_ref: null }, null), {
    origin: null,
    sourceRef: null,
  });
});

test("ai vale también como defaultOrigin", () => {
  assert.deepEqual(normalizeProvenance({}, "ai"), { origin: "ai", sourceRef: null });
});

// ═══ 6 · El resolver: ai sin privilegio, con tenant legítimo ══════════════════

const EMPRESA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPRESA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function alias({
  canonical_id,
  alias_value,
  alias_kind = "exact",
  source = "engine",
  source_ref = null,
  company_id = null,
  confidence = 1,
}) {
  return {
    id: uid(),
    canonical_id,
    alias_kind,
    source,
    source_ref,
    company_id,
    alias_value,
    alias_norm: canonicalNormalize(alias_value),
    confidence,
  };
}

const LITERAL = "Contenedor y transporte a gestor autorizado";

const ALIASES = [
  // engine global (rank 3) — el literal real del motor.
  alias({ canonical_id: "WORK.WASTE.CONTAINER.HAUL", alias_value: LITERAL }),
  // manual privado de A (rank 1) — A subcontrata: para ella es un SERVICIO comprado.
  alias({ canonical_id: "SRV.WASTE.CONTAINER.HAUL", alias_value: LITERAL, source: "manual", company_id: EMPRESA_A }),
  // manual privado de B sobre otro literal, para el test de aislamiento.
  alias({
    canonical_id: "WORK.PAINT.EMULSION.CEILING.2COATS",
    alias_value: "Pintura plástica en paredes",
    source: "manual",
    company_id: EMPRESA_B,
  }),
  alias({ canonical_id: "WORK.PAINT.EMULSION.WALL.2COATS", alias_value: "Pintura plástica en paredes" }),
  // Dos bancos con evidencia documental, sólo alcanzables por source_ref.
  alias({ canonical_id: "WORK.PAINT.EMULSION.CEILING.2COATS", alias_value: "Pintura al temple liso", source: "import", source_ref: "cype" }),
  alias({ canonical_id: "WORK.PAINT.EMULSION.WALL.2COATS", alias_value: "Pintura al temple liso", source: "import", source_ref: "public_bc3" }),
  // Sinónimo curado global.
  alias({ canonical_id: "WORK.WASTE.CONTAINER.HAUL", alias_value: "Retirada de escombros", alias_kind: "synonym", source: "curated", confidence: 0.7 }),
  // Empate exacto entre conceptos distintos dentro de la misma prioridad.
  alias({ canonical_id: "WORK.WASTE.FEE.DISPOSAL", alias_value: "Partida de residuos sin detallar", source: "curated" }),
  alias({ canonical_id: "WORK.WASTE.MANAGEMENT.FULL", alias_value: "Partida de residuos sin detallar", source: "curated" }),
];

const registry = createInMemoryRegistry({ aliases: ALIASES });
const registryLeaky = createInMemoryRegistry({ aliases: ALIASES }, { leaky: true });
const ctx = (origin, company_id = null, source_ref = null) => ({ company_id, origin, source_ref });

test("CONTROL DISCRIMINANTE — el mismo literal, engine gana por NIVEL 1 y ai no", async () => {
  // engine: el NIVEL 1 se queda dentro de su propia procedencia y gana el concepto del
  // motor, por delante de la curación privada de A.
  const comoEngine = await resolveCanonical(LITERAL, ctx("engine", EMPRESA_A), registry);
  assert.equal(comoEngine.status, "resolved");
  assert.equal(comoEngine.canonical_id, "WORK.WASTE.CONTAINER.HAUL");
  assert.equal(comoEngine.source, "exact_engine");

  // ai: mismo texto, misma empresa, mismo registro. Sin NIVEL 1, cae al ranking general
  // y gana manual (rank 1) sobre engine (rank 3). El resultado DEBE ser otro concepto.
  const comoIA = await resolveCanonical(LITERAL, ctx("ai", EMPRESA_A), registry);
  assert.equal(comoIA.status, "resolved");
  assert.equal(comoIA.canonical_id, "SRV.WASTE.CONTAINER.HAUL", "manual rank 1 gana a engine rank 3");
  assert.equal(comoIA.source, "exact_manual");

  assert.notEqual(
    comoIA.canonical_id,
    comoEngine.canonical_id,
    "si coincidieran, este test no probaría nada: la diferencia ES el privilegio"
  );
});

test("ai no obtiene NIVEL 1 de import/provider ni aunque le pasen un source_ref", async () => {
  // Con origin=import y el banco declarado, el NIVEL 1 resuelve.
  const comoImport = await resolveCanonical("Pintura al temple liso", ctx("import", null, "cype"), registry);
  assert.equal(comoImport.status, "resolved");
  assert.equal(comoImport.canonical_id, "WORK.PAINT.EMULSION.CEILING.2COATS");

  // Con origin=ai el source_ref es ruido: no hay procedencia acreditada que consultar y
  // el NIVEL 2 excluye a las fuentes que exigen instancia documental.
  const comoIA = await resolveCanonical("Pintura al temple liso", ctx("ai", null, "cype"), registry);
  assert.equal(comoIA.status, "unmatched");
  assert.equal(comoIA.canonical_id, null);
});

test("ai SÍ resuelve por el NIVEL 2 general legítimo", async () => {
  const r = await resolveCanonical("Pintura plástica en paredes", ctx("ai", null), registry);
  assert.equal(r.status, "resolved");
  assert.equal(r.canonical_id, "WORK.PAINT.EMULSION.WALL.2COATS");
  assert.equal(r.source, "exact_engine", "gana el alias engine por ranking, no por privilegio de origen");
});

test("ai conserva su empresa y usa el alias privado propio", async () => {
  const r = await resolveCanonical(LITERAL, ctx("ai", EMPRESA_A), registry);
  assert.equal(r.canonical_id, "SRV.WASTE.CONTAINER.HAUL");
  assert.equal(r.source, "exact_manual", "a diferencia de legacy, ai no anula el company_id");
});

test("ai nunca ve el alias privado de otra empresa", async () => {
  const desdeA = await resolveCanonical("Pintura plástica en paredes", ctx("ai", EMPRESA_A), registry);
  assert.equal(desdeA.canonical_id, "WORK.PAINT.EMULSION.WALL.2COATS", "A no alcanza la curación de B");

  const desdeB = await resolveCanonical("Pintura plástica en paredes", ctx("ai", EMPRESA_B), registry);
  assert.equal(desdeB.canonical_id, "WORK.PAINT.EMULSION.CEILING.2COATS", "B sí ve la suya");
  assert.equal(desdeB.source, "exact_manual");
});

test("con acceso sin RLS, una línea ai también detiene la fuga con TENANT_LEAK", async () => {
  await assert.rejects(
    () => resolveCanonical("Pintura plástica en paredes", ctx("ai", EMPRESA_A), registryLeaky),
    (err) => {
      assert.equal(err.name, "CanonicalError");
      assert.equal(err.code, "TENANT_LEAK");
      return true;
    }
  );
});

test("la ambigüedad sigue funcionando para ai", async () => {
  const r = await resolveCanonical("Partida de residuos sin detallar", ctx("ai", EMPRESA_A), registry);
  assert.equal(r.status, "ambiguous");
  assert.equal(r.canonical_id, null, "ante un empate no se elige, tampoco viniendo de la IA");
  assert.equal(r.confidence, null);
});

test("los sinónimos siguen dando review para ai", async () => {
  const r = await resolveCanonical("Retirada de escombros", ctx("ai", EMPRESA_A), registry);
  assert.equal(r.status, "review");
  assert.equal(r.canonical_id, "WORK.WASTE.CONTAINER.HAUL");
  assert.equal(r.confidence, 0.7);
  assert.equal(r.source, "synonym");
});

test("NO REGRESIÓN — engine, free_text y legacy resuelven como antes", async () => {
  const e = await resolveCanonical(LITERAL, ctx("engine", EMPRESA_A), registry);
  assert.equal(e.canonical_id, "WORK.WASTE.CONTAINER.HAUL");
  assert.equal(e.source, "exact_engine");

  const f = await resolveCanonical(LITERAL, ctx("free_text", EMPRESA_A), registry);
  assert.equal(f.canonical_id, "SRV.WASTE.CONTAINER.HAUL");
  assert.equal(f.source, "exact_manual");

  const l = await resolveCanonical(LITERAL, ctx("legacy", EMPRESA_A), registry);
  assert.equal(l.canonical_id, "WORK.WASTE.CONTAINER.HAUL", "legacy anula la empresa: sólo aliases globales");
});

// ═══ 7 · El dinero no se mueve ════════════════════════════════════════════════

test("sellar ai no altera cantidades ni importes", () => {
  const s = scope();
  const conSello = lineaIA();
  const { canonical_origin, canonical_source_ref, ...sinSello } = lineaIA();

  const huella = (items) =>
    items
      .map((i) => [i.id, i.quantity, i.unit_price, i.subtotal_cost, i.unit_price_client, i.subtotal_client].join("|"))
      .sort();

  assert.deepEqual(
    huella(normalizeBudgetItemsToScope(s, [conSello], MARGIN)),
    huella(normalizeBudgetItemsToScope(s, [sinSello], MARGIN)),
    "la procedencia es metadato: no puede tocar un solo importe"
  );
});

test("el análisis determinista produce los mismos importes se lea o no su origen", () => {
  const a = buildDeterministicBudgetAnalysis({ scope: scope(), serviceType: "reforma" });
  originForBudgetAnalysis(a);
  const b = buildDeterministicBudgetAnalysis({ scope: scope(), serviceType: "reforma" });
  assert.deepEqual(
    a.suggested_items.map((i) => [i.concept, i.quantity, i.unit_cost]),
    b.suggested_items.map((i) => [i.concept, i.quantity, i.unit_cost]),
    "el discriminador es puro: leer el payload no lo modifica"
  );
});
