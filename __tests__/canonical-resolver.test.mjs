/**
 * Fase 2B · Resolver canónico.
 *
 * No toca Supabase. Todos los casos corren sobre createInMemoryRegistry, que aplica la
 * MISMA semántica de filtrado que el registry real. Los datos son los del seed
 * verdadero (20260824115621_canonical_seed_paint_waste.sql) salvo donde se indica que
 * la fila es sintética, y esas se marcan una a una.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { canonicalNormalize, createInMemoryRegistry, DEFAULT_ALIAS_SOURCES } = await import(
  path.join(root, "lib/canonical/registry.ts")
);
const { resolveCanonical } = await import(path.join(root, "lib/canonical/resolver.ts"));

// ─── Utilidades de fixture ────────────────────────────────────────────────────

const EMPRESA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPRESA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

/** alias_norm se calcula, nunca se escribe a mano: en la base de datos es GENERATED. */
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

// ─── Aliases reales del seed ──────────────────────────────────────────────────

const SEED = [
  // engine · literales textuales de lib/budget-engine.ts
  alias({ canonical_id: "WORK.PROTECT.SITE.COVERING", alias_value: "Protección de elementos que se conservan" }),
  alias({ canonical_id: "WORK.PROTECT.SITE.COVERING", alias_value: "Implantación y protecciones de obra" }),
  alias({ canonical_id: "WORK.WASTE.CONTAINER.HAUL", alias_value: "Contenedor y transporte a gestor autorizado" }),
  alias({ canonical_id: "WORK.WASTE.CONTAINER.HAUL", alias_value: "Contenedores y transporte" }),
  alias({ canonical_id: "MAT.PAINT.TOOL.BRUSH", alias_value: "Brocha prensada fibra sintética nº10" }),
  alias({ canonical_id: "WORK.PAINT.EMULSION.WALL.2COATS", alias_value: "Pintura plástica en paredes" }),

  // curated · vocabulario base de Enlaze
  alias({ canonical_id: "WORK.PROTECT.SITE.COVERING", alias_value: "Protección de zonas conservadas", source: "curated" }),
  alias({ canonical_id: "WORK.PAINT.EMULSION.WALL.2COATS", alias_value: "Pintura plástica lavable en paredes", source: "curated" }),

  // curated · sinónimos
  alias({ canonical_id: "WORK.WASTE.CONTAINER.HAUL", alias_value: "Retirada de escombros", alias_kind: "synonym", source: "curated", confidence: 0.7 }),
  alias({ canonical_id: "WORK.PROTECT.SITE.COVERING", alias_value: "Protección de suelos y mobiliario", alias_kind: "synonym", source: "curated", confidence: 0.7 }),
  // Ambigüedad deliberada del seed: el mismo literal designa la cinta y el film.
  alias({ canonical_id: "MAT.PAINT.MASKING.TAPE", alias_value: "Cinta de enmascarar y plastico protector", alias_kind: "synonym", source: "curated", confidence: 0.7 }),
  alias({ canonical_id: "MAT.PAINT.MASKING.FILM", alias_value: "Cinta de enmascarar y plastico protector", alias_kind: "synonym", source: "curated", confidence: 0.7 }),
];

// ─── Aliases sintéticos (no están en el seed; existen sólo para estos tests) ───

// La empresa A ha curado a mano que ELLA subcontrata el contenedor: para A ese literal
// designa el SERVICIO comprado, no la partida facturada.
const MANUAL_A = alias({
  canonical_id: "SRV.WASTE.CONTAINER.HAUL",
  alias_value: "Contenedor y transporte a gestor autorizado",
  source: "manual",
  company_id: EMPRESA_A,
});

// La empresa B ha curado otra cosa distinta bajo un literal que también es de engine.
const MANUAL_B = alias({
  canonical_id: "WORK.PAINT.EMULSION.CEILING.2COATS",
  alias_value: "Pintura plástica en paredes",
  source: "manual",
  company_id: EMPRESA_B,
});

// Dos bancos técnicos que llaman igual a cosas distintas.
const IMPORT_CYPE = alias({
  canonical_id: "WORK.PAINT.EMULSION.CEILING.2COATS",
  alias_value: "Pintura al temple liso",
  source: "import",
  source_ref: "cype",
});
const IMPORT_BC3 = alias({
  canonical_id: "WORK.PAINT.EMULSION.WALL.2COATS",
  alias_value: "Pintura al temple liso",
  source: "import",
  source_ref: "public_bc3",
});

// Conflicto exacto dentro de la MISMA procedencia y el MISMO tenant. En la base de datos
// es imposible: uq_alias_exact es único sobre (company_id, source, source_ref,
// alias_norm) con NULLS NOT DISTINCT. Se construye aquí a propósito para comprobar que,
// si alguna vez llegara a existir, el resolver no elige por orden de consulta.
const CONFLICTO_1 = alias({ canonical_id: "WORK.WASTE.FEE.DISPOSAL", alias_value: "Partida de residuos sin detallar" });
const CONFLICTO_2 = alias({ canonical_id: "WORK.WASTE.MANAGEMENT.FULL", alias_value: "Partida de residuos sin detallar" });

const TODOS = [...SEED, MANUAL_A, MANUAL_B, IMPORT_CYPE, IMPORT_BC3, CONFLICTO_1, CONFLICTO_2];

const registry = createInMemoryRegistry({ aliases: TODOS });
const registryLeaky = createInMemoryRegistry({ aliases: TODOS }, { leaky: true });

const ctx = (origin, company_id = null, source_ref = null) => ({ company_id, origin, source_ref });

// ═══ NIVEL 1 · procedencia conocida ═══════════════════════════════════════════

test("engine exacto resuelve con confianza 1.00", async () => {
  const r = await resolveCanonical("Protección de elementos que se conservan", ctx("engine"), registry);
  assert.equal(r.status, "resolved");
  assert.equal(r.canonical_id, "WORK.PROTECT.SITE.COVERING");
  assert.equal(r.confidence, 1);
  assert.equal(r.source, "exact_engine");
});

test("los dos literales del ternario de protecciones caen en el mismo concepto", async () => {
  const a = await resolveCanonical("Protección de elementos que se conservan", ctx("engine"), registry);
  const b = await resolveCanonical("Implantación y protecciones de obra", ctx("engine"), registry);
  assert.equal(a.canonical_id, b.canonical_id);
  assert.equal(a.canonical_id, "WORK.PROTECT.SITE.COVERING");
});

test("el duplicado real de residuos queda unificado bajo un solo canonical_id", async () => {
  const a = await resolveCanonical("Contenedor y transporte a gestor autorizado", ctx("engine"), registry);
  const b = await resolveCanonical("Contenedores y transporte", ctx("engine"), registry);
  assert.equal(a.status, "resolved");
  assert.equal(b.status, "resolved");
  assert.equal(a.canonical_id, "WORK.WASTE.CONTAINER.HAUL");
  assert.equal(b.canonical_id, "WORK.WASTE.CONTAINER.HAUL");
});

test("un alias manual privado NO reinterpreta una línea con origin=engine", async () => {
  const r = await resolveCanonical(
    "Contenedor y transporte a gestor autorizado",
    ctx("engine", EMPRESA_A),
    registry
  );
  assert.equal(r.canonical_id, "WORK.WASTE.CONTAINER.HAUL", "el nivel 1 se queda dentro de engine");
  assert.equal(r.source, "exact_engine");
  assert.notEqual(r.canonical_id, MANUAL_A.canonical_id);
});

test("el mismo literal, sin origen de generador, SÍ respeta la curación de la empresa", async () => {
  const r = await resolveCanonical(
    "Contenedor y transporte a gestor autorizado",
    ctx("free_text", EMPRESA_A),
    registry
  );
  assert.equal(r.status, "resolved");
  assert.equal(r.canonical_id, "SRV.WASTE.CONTAINER.HAUL", "manual rank 1 gana a engine rank 3");
  assert.equal(r.source, "exact_manual");
});

// ═══ Aislamiento multiempresa ═════════════════════════════════════════════════

test("la empresa A nunca resuelve con un alias de la empresa B", async () => {
  const a = await resolveCanonical("Pintura plástica en paredes", ctx("free_text", EMPRESA_A), registry);
  assert.equal(a.canonical_id, "WORK.PAINT.EMULSION.WALL.2COATS");
  assert.equal(a.source, "exact_engine");

  const b = await resolveCanonical("Pintura plástica en paredes", ctx("free_text", EMPRESA_B), registry);
  assert.equal(b.canonical_id, "WORK.PAINT.EMULSION.CEILING.2COATS", "B sí ve su propio alias");
  assert.equal(b.source, "exact_manual");
});

test("con acceso tipo service_role (sin RLS ni filtro) la fuga se detiene con TENANT_LEAK", async () => {
  await assert.rejects(
    () => resolveCanonical("Pintura plástica en paredes", ctx("free_text", EMPRESA_A), registryLeaky),
    (err) => {
      assert.equal(err.name, "CanonicalError");
      assert.equal(err.code, "TENANT_LEAK");
      return true;
    },
    "el resolver debe lanzar, no filtrar en silencio"
  );
});

// ═══ Procedencias con evidencia documental ════════════════════════════════════

test("import+cype no puede resolver con un alias de public_bc3", async () => {
  const r = await resolveCanonical("Pintura al temple liso", ctx("import", null, "cype"), registry);
  assert.equal(r.status, "resolved");
  assert.equal(r.canonical_id, IMPORT_CYPE.canonical_id);
  assert.notEqual(r.canonical_id, IMPORT_BC3.canonical_id);
  assert.equal(r.source, "exact_import");
});

test("import sin source_ref no busca por libre entre bancos", async () => {
  const r = await resolveCanonical("Pintura al temple liso", ctx("import"), registry);
  assert.equal(r.status, "unmatched");
  assert.equal(r.canonical_id, null);
});

test("source_ref se compara exacto, nunca como prefijo", async () => {
  const r = await resolveCanonical("Pintura al temple liso", ctx("import", null, "cyp"), registry);
  assert.equal(r.status, "unmatched");
});

// ═══ Empates ══════════════════════════════════════════════════════════════════

test("conflicto exacto en la prioridad ganadora → ambiguous, nunca elegir", async () => {
  const r = await resolveCanonical("Partida de residuos sin detallar", ctx("engine"), registry);
  assert.equal(r.status, "ambiguous");
  assert.equal(r.canonical_id, null);
  assert.equal(r.confidence, null);
  assert.equal(r.source, "exact_engine");
});

test("el empate no depende del orden en que lleguen las filas", async () => {
  const alReves = createInMemoryRegistry({ aliases: [...TODOS].reverse() });
  const r = await resolveCanonical("Partida de residuos sin detallar", ctx("engine"), alReves);
  assert.equal(r.status, "ambiguous");
  assert.equal(r.canonical_id, null);
});

// ═══ Sinónimos ════════════════════════════════════════════════════════════════

test("sinónimo único → review con la confianza del alias", async () => {
  const r = await resolveCanonical("Retirada de escombros", ctx("free_text", EMPRESA_A), registry);
  assert.equal(r.status, "review");
  assert.equal(r.canonical_id, "WORK.WASTE.CONTAINER.HAUL");
  assert.equal(r.confidence, 0.7);
  assert.equal(r.source, "synonym");
});

test("cinta/film: el sinónimo en conflicto → ambiguous con canonical_id NULL", async () => {
  const r = await resolveCanonical("Cinta de enmascarar y plastico protector", ctx("free_text", EMPRESA_A), registry);
  assert.equal(r.status, "ambiguous");
  assert.equal(r.canonical_id, null, "0,37 € y 38,40 €: elegir uno habría sido un error caro");
  assert.equal(r.source, "synonym");
});

test("ningún sinónimo puede producir 'resolved'", async () => {
  const textos = TODOS.filter((a) => a.alias_kind === "synonym").map((a) => a.alias_value);
  assert.ok(textos.length > 0);
  for (const t of textos) {
    for (const origen of ["engine", "free_text", "legacy"]) {
      const r = await resolveCanonical(t, ctx(origen, EMPRESA_A), registry);
      assert.notEqual(r.status, "resolved", `'${t}' con origin=${origen}`);
    }
  }
});

test("un exacto siempre gana a un sinónimo aunque el sinónimo sea de mejor rango", async () => {
  const conSinonimoManual = createInMemoryRegistry({
    aliases: [
      ...SEED,
      alias({
        canonical_id: "WORK.WASTE.FEE.DISPOSAL",
        alias_value: "Contenedores y transporte",
        alias_kind: "synonym",
        source: "manual",
        company_id: EMPRESA_A,
        confidence: 0.8,
      }),
    ],
  });
  const r = await resolveCanonical("Contenedores y transporte", ctx("free_text", EMPRESA_A), conSinonimoManual);
  assert.equal(r.status, "resolved");
  assert.equal(r.canonical_id, "WORK.WASTE.CONTAINER.HAUL");
  assert.equal(r.source, "exact_engine");
});

// ═══ legacy ═══════════════════════════════════════════════════════════════════

test("legacy no usa aliases privados aunque venga con company_id", async () => {
  const r = await resolveCanonical(
    "Contenedor y transporte a gestor autorizado",
    ctx("legacy", EMPRESA_A),
    registry
  );
  assert.equal(r.canonical_id, "WORK.WASTE.CONTAINER.HAUL");
  assert.equal(r.source, "exact_engine");
  assert.notEqual(r.canonical_id, MANUAL_A.canonical_id);
});

test("legacy no inventa procedencia: ni con un source_ref puesto a mano llega a import", async () => {
  const sinRef = await resolveCanonical("Pintura al temple liso", ctx("legacy"), registry);
  assert.equal(sinRef.status, "unmatched");

  const conRef = await resolveCanonical("Pintura al temple liso", ctx("legacy", EMPRESA_A, "cype"), registry);
  assert.equal(conRef.status, "unmatched", "legacy no puede acreditar de qué banco viene");
});

// ═══ unmatched ════════════════════════════════════════════════════════════════

test("sin evidencia suficiente: unmatched con los cuatro campos a NULL", async () => {
  const r = await resolveCanonical("Reparación de gárgolas de piedra caliza", ctx("free_text", EMPRESA_A), registry);
  assert.deepEqual(r, { status: "unmatched", canonical_id: null, confidence: null, source: null });
});

test("texto vacío o sólo puntuación es unmatched, no un error", async () => {
  for (const t of ["", "   ", "---", null, undefined]) {
    const r = await resolveCanonical(t, ctx("free_text", EMPRESA_A), registry);
    assert.equal(r.status, "unmatched");
  }
});

// ═══ Normalización ════════════════════════════════════════════════════════════

test("canonicalNormalize reproduce alias_norm tal como lo generó PostgreSQL", () => {
  // Valores capturados de canonical_aliases.alias_norm en el proyecto real.
  assert.equal(canonicalNormalize("Brocha prensada fibra sintética nº10"), "brocha prensada fibra sintetica n 10");
  assert.equal(canonicalNormalize("Protección de elementos que se conservan"), "proteccion de elementos que se conservan");
  assert.equal(canonicalNormalize("Implantación y protecciones de obra"), "implantacion y protecciones de obra");
  assert.equal(canonicalNormalize("Contenedor y transporte a gestor autorizado"), "contenedor y transporte a gestor autorizado");
  assert.equal(canonicalNormalize("Cinta de enmascarar y plastico protector"), "cinta de enmascarar y plastico protector");
  assert.equal(canonicalNormalize("Contenedor de escombros 6m3 (alquiler+transporte)"), "contenedor de escombros 6m3 alquiler transporte");
});

test("acentos, mayúsculas, puntuación y espacios no cambian el resultado", async () => {
  const variantes = [
    "Protección de elementos que se conservan",
    "PROTECCION DE ELEMENTOS QUE SE CONSERVAN",
    "protección, de elementos - que se conservan!!!",
    "   Protección   de  elementos que se conservan   ",
  ];
  for (const v of variantes) {
    const r = await resolveCanonical(v, ctx("engine"), registry);
    assert.equal(r.status, "resolved", v);
    assert.equal(r.canonical_id, "WORK.PROTECT.SITE.COVERING", v);
  }
});

// ═══ La precedencia es un dato, no una constante ══════════════════════════════

test("la precedencia sale de canonical_alias_sources, no del código", async () => {
  // Se invierte el rango de manual y engine respecto del dato congelado. Si la
  // prioridad estuviera cableada, este test no cambiaría de resultado.
  const invertido = DEFAULT_ALIAS_SOURCES.map((s) =>
    s.source === "engine" ? { ...s, general_rank: 1 } : s.source === "manual" ? { ...s, general_rank: 3 } : s
  );
  const otroOrden = createInMemoryRegistry({ aliases: TODOS, sources: invertido });

  const r = await resolveCanonical(
    "Contenedor y transporte a gestor autorizado",
    ctx("free_text", EMPRESA_A),
    otroOrden
  );
  assert.equal(r.canonical_id, "WORK.WASTE.CONTAINER.HAUL", "ahora engine gana a manual");
  assert.equal(r.source, "exact_engine");
});

test("el orden congelado es manual > curated > engine > import > provider", async () => {
  const ranks = Object.fromEntries(DEFAULT_ALIAS_SOURCES.map((s) => [s.source, s.general_rank]));
  assert.deepEqual(ranks, { manual: 1, curated: 2, engine: 3, import: 4, provider: 5 });

  // curated 2 gana a engine 3 sobre el mismo texto.
  const empate = createInMemoryRegistry({
    aliases: [
      alias({ canonical_id: "WORK.PAINT.EMULSION.WALL.2COATS", alias_value: "Pintar paredes" }),
      alias({ canonical_id: "WORK.PAINT.EMULSION.CEILING.2COATS", alias_value: "Pintar paredes", source: "curated" }),
    ],
  });
  const r = await resolveCanonical("Pintar paredes", ctx("free_text", EMPRESA_A), empate);
  assert.equal(r.source, "exact_curated");
  assert.equal(r.canonical_id, "WORK.PAINT.EMULSION.CEILING.2COATS");
});

test("dos procedencias con el mismo general_rank son un error, no un empate a resolver", async () => {
  const roto = createInMemoryRegistry({
    aliases: SEED,
    sources: DEFAULT_ALIAS_SOURCES.map((s) => (s.source === "curated" ? { ...s, general_rank: 3 } : s)),
  });
  await assert.rejects(
    () => resolveCanonical("Protección de zonas conservadas", ctx("free_text", EMPRESA_A), roto),
    /general_rank 3 duplicado/
  );
});
