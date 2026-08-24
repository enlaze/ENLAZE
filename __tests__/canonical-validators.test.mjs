/**
 * Fase 2C · Validators en modo observador.
 *
 * El contrato canónico (20 conceptos, 12 relaciones) es COPIA LITERAL del proyecto real.
 * Las líneas de presupuesto también son reales: presupuestos 318dc62a y 55082c1b, con
 * sus item_id, cantidades e importes tal como están almacenados hoy. Lo único sintético
 * son las líneas marcadas como tales, y se marcan una a una.
 *
 * Nada de esto escribe en Supabase ni sale a la red.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const V = await import(path.join(root, "lib/validation/validators.ts"));
const T = await import(path.join(root, "lib/validation/types.ts"));

// ─── Contrato real ────────────────────────────────────────────────────────────

const concept = (canonical_id, kind, allowed, def) => ({
  canonical_id,
  kind,
  allowed_price_types: allowed,
  default_price_type: def,
});

const CONTRACT = {
  concepts: [
    concept("MAT.PAINT.EMULSION.INTERIOR_MATT", "MAT", ["MATERIAL_ONLY"], "MATERIAL_ONLY"),
    concept("MAT.PAINT.FILLER.POWDER", "MAT", ["MATERIAL_ONLY"], "MATERIAL_ONLY"),
    concept("MAT.PAINT.MASKING.FILM", "MAT", ["MATERIAL_ONLY"], "MATERIAL_ONLY"),
    concept("MAT.PAINT.MASKING.TAPE", "MAT", ["MATERIAL_ONLY"], "MATERIAL_ONLY"),
    concept("MAT.PAINT.PRIMER.ACRYLIC", "MAT", ["MATERIAL_ONLY"], "MATERIAL_ONLY"),
    concept("MAT.PAINT.TOOL.BRUSH", "MAT", ["MATERIAL_ONLY"], "MATERIAL_ONLY"),
    concept("MAT.PAINT.TOOL.ROLLER", "MAT", ["MATERIAL_ONLY"], "MATERIAL_ONLY"),
    concept("MAT.PAINT.TOOL.TRAY", "MAT", ["MATERIAL_ONLY"], "MATERIAL_ONLY"),
    concept("SRV.WASTE.CONTAINER.HAUL", "SRV", ["SERVICE"], "SERVICE"),
    concept("SRV.WASTE.CONTAINER.HAUL.6M3", "SRV", ["SERVICE"], "SERVICE"),
    concept("WORK.PAINT.EMULSION.CEILING.2COATS", "WORK", ["LABOR_ONLY", "LABOR_AND_MATERIAL"], "LABOR_AND_MATERIAL"),
    concept("WORK.PAINT.EMULSION.WALL.2COATS", "WORK", ["LABOR_ONLY", "LABOR_AND_MATERIAL"], "LABOR_AND_MATERIAL"),
    concept("WORK.PAINT.PREP.MASKING", "WORK", ["LABOR_ONLY", "LABOR_AND_MATERIAL"], "LABOR_AND_MATERIAL"),
    concept("WORK.PAINT.PREP.SURFACE", "WORK", ["LABOR_ONLY", "LABOR_AND_MATERIAL"], "LABOR_AND_MATERIAL"),
    concept("WORK.PAINT.PRIMER.APPLY", "WORK", ["LABOR_ONLY", "LABOR_AND_MATERIAL"], "LABOR_AND_MATERIAL"),
    concept("WORK.PROTECT.SITE.COVERING", "WORK", ["LABOR_ONLY", "LABOR_AND_MATERIAL"], "LABOR_AND_MATERIAL"),
    concept("WORK.WASTE.CONTAINER.HAUL", "WORK", ["SERVICE", "LABOR_AND_MATERIAL"], "SERVICE"),
    concept("WORK.WASTE.CONTAINER.HAUL.6M3", "WORK", ["SERVICE", "LABOR_AND_MATERIAL"], "SERVICE"),
    concept("WORK.WASTE.FEE.DISPOSAL", "WORK", ["SERVICE"], "SERVICE"),
    concept("WORK.WASTE.MANAGEMENT.FULL", "WORK", ["LABOR_AND_MATERIAL", "SERVICE"], "LABOR_AND_MATERIAL"),
  ],
  relations: [
    { from_canonical: "SRV.WASTE.CONTAINER.HAUL.6M3", to_canonical: "WORK.WASTE.CONTAINER.HAUL.6M3", relation_type: "provides" },
    { from_canonical: "SRV.WASTE.CONTAINER.HAUL", to_canonical: "WORK.WASTE.CONTAINER.HAUL", relation_type: "provides" },
    { from_canonical: "WORK.WASTE.CONTAINER.HAUL.6M3", to_canonical: "WORK.WASTE.CONTAINER.HAUL", relation_type: "variant_of" },
    { from_canonical: "SRV.WASTE.CONTAINER.HAUL.6M3", to_canonical: "SRV.WASTE.CONTAINER.HAUL", relation_type: "variant_of" },
    { from_canonical: "WORK.WASTE.MANAGEMENT.FULL", to_canonical: "WORK.WASTE.CONTAINER.HAUL", relation_type: "includes" },
    { from_canonical: "WORK.WASTE.MANAGEMENT.FULL", to_canonical: "WORK.WASTE.FEE.DISPOSAL", relation_type: "includes" },
    { from_canonical: "WORK.PAINT.EMULSION.WALL.2COATS", to_canonical: "MAT.PAINT.EMULSION.INTERIOR_MATT", relation_type: "includes" },
    { from_canonical: "WORK.PAINT.EMULSION.CEILING.2COATS", to_canonical: "MAT.PAINT.EMULSION.INTERIOR_MATT", relation_type: "includes" },
    { from_canonical: "WORK.PAINT.PRIMER.APPLY", to_canonical: "MAT.PAINT.PRIMER.ACRYLIC", relation_type: "includes" },
    { from_canonical: "WORK.PAINT.PREP.SURFACE", to_canonical: "MAT.PAINT.FILLER.POWDER", relation_type: "includes" },
    { from_canonical: "WORK.PAINT.PREP.MASKING", to_canonical: "MAT.PAINT.MASKING.TAPE", relation_type: "includes" },
    { from_canonical: "WORK.PAINT.PREP.MASKING", to_canonical: "MAT.PAINT.MASKING.FILM", relation_type: "includes" },
  ],
};

// ─── Líneas ───────────────────────────────────────────────────────────────────

/** Por defecto 'resolved': una línea con canonical_id sólo puede estar resolved o review. */
function line(item_id, budget_id, name, canonical_id, price_type, quantity, unit, unit_price, subtotal, extra = {}) {
  return {
    item_id,
    budget_id,
    name,
    canonical_id,
    canonical_status: canonical_id === null ? "unmatched" : "resolved",
    price_type,
    quantity,
    unit,
    unit_price,
    subtotal,
    ...extra,
  };
}

const B_PINTURA = "318dc62a-b519-4637-a361-d87ca63aa628";
const B_RESIDUOS = "55082c1b-ebd4-464d-a24a-049845f73734";

// Presupuesto 55082c1b: el duplicado histórico de residuos, 6 ud × 717,50 € DOS VECES.
const RESIDUOS_1 = line("a0565e4d-76f5-4798-a2c8-6e02091b0aa0", B_RESIDUOS, "Contenedor y transporte a gestor autorizado", "WORK.WASTE.CONTAINER.HAUL", "SERVICE", 6, "ud", 717.5, 4305.02);
const RESIDUOS_2 = line("faaff323-79a1-40d5-94d7-06185c990458", B_RESIDUOS, "Contenedores y transporte", "WORK.WASTE.CONTAINER.HAUL", "SERVICE", 6, "ud", 717.5, 4305.02);
const TASAS = line("eb0a0d2d-c3cb-4398-9aea-375ae9ca6577", B_RESIDUOS, "Tasas y documentación de residuos", "WORK.WASTE.FEE.DISPOSAL", "SERVICE", 1, "pa", 1319.29, 1319.29);

// Presupuesto 318dc62a: paredes y techos comparten el mismo material.
const PAREDES = line("92e6d5b0-7095-43dc-9d9f-6b0ddc138269", B_PINTURA, "Pintura plástica en paredes", "WORK.PAINT.EMULSION.WALL.2COATS", "LABOR_AND_MATERIAL", 58, "m2", 15.64, 906.89);
const TECHOS = line("9712c07c-7e97-4926-aeb3-ebd6dc18fd25", B_PINTURA, "Pintura de techos", "WORK.PAINT.EMULSION.CEILING.2COATS", "LABOR_AND_MATERIAL", 160, "m2", 17.28, 2764.8);
const PINTURA_MAT = line("3fa68327-d23e-4a80-a9d6-aed9d31839a4", B_PINTURA, "Pintura plástica blanca mate interior 15 L", "MAT.PAINT.EMULSION.INTERIOR_MATT", "MATERIAL_ONLY", 3, "cubos", 52.8, 158.4);
const IMPRIMACION = line("b0c44f0d-064a-42c4-b78f-aeee8e14958f", B_PINTURA, "Imprimación de paredes y techos", "WORK.PAINT.PRIMER.APPLY", "LABOR_AND_MATERIAL", 160, "m2", 5.59, 894.72);
const FIJADOR = line("ac1339a7-5d7e-4a98-a1aa-818495663133", B_PINTURA, "Fondo fijador acrílico 15 L blanco", "MAT.PAINT.PRIMER.ACRYLIC", "MATERIAL_ONLY", 2, "cubos", 40.8, 81.6);

// SINTÉTICA: WORK.WASTE.MANAGEMENT.FULL no aparece en ningún presupuesto real todavía.
// El literal del texto sí es el del generador (budget-engine.ts).
const AGREGADO = line("11111111-1111-4111-8111-111111111111", B_RESIDUOS, "Gestion de residuos y contenedores", "WORK.WASTE.MANAGEMENT.FULL", "LABOR_AND_MATERIAL", 1, "ud", 5000, 5000);

const codes = (findings) => findings.map((f) => f.code);
const only = (findings, code) => findings.filter((f) => f.code === code);

// ═══ DUPLICATE_CANONICAL ══════════════════════════════════════════════════════

test("duplicado real de residuos: dos líneas, mismo canonical, mismo presupuesto", () => {
  const f = V.findDuplicateCanonical([RESIDUOS_1, RESIDUOS_2, TASAS], CONTRACT);
  assert.equal(f.length, 1);
  assert.equal(f[0].code, "DUPLICATE_CANONICAL");
  assert.equal(f[0].severity, "error");
  assert.deepEqual(f[0].canonical_ids, ["WORK.WASTE.CONTAINER.HAUL"]);
  assert.deepEqual(f[0].item_ids, [RESIDUOS_1.item_id, RESIDUOS_2.item_id].sort());
  assert.equal(f[0].budget_id, B_RESIDUOS);
  assert.equal(f[0].evidence.suma_subtotales_cents, 861004, "8.610,04 € cobrados");
  assert.equal(f[0].evidence.huella_economica_identica, true);
});

test("el duplicado se detecta aunque los importes sean distintos", () => {
  // Presupuesto 318dc62a real: 3 ud × 545,74 € y 3 ud × 348,00 €, mismo concepto.
  const a = line("73e5f7ac-ca6a-4117-8bec-1f40af49bc15", B_PINTURA, "Contenedor y transporte a gestor autorizado", "WORK.WASTE.CONTAINER.HAUL", "SERVICE", 3, "ud", 545.74, 1637.21);
  const b = line("36aabe2d-f563-46d1-843e-74b1920f2184", B_PINTURA, "Contenedores y transporte", "WORK.WASTE.CONTAINER.HAUL", "SERVICE", 3, "ud", 348, 1044);
  const f = V.findDuplicateCanonical([a, b], CONTRACT);
  assert.equal(f.length, 1);
  assert.equal(f[0].evidence.huella_economica_identica, false, "huellas distintas, duplicado igual");
});

test("mismo canonical en dos líneas NO económicas no es duplicado", () => {
  const a = { ...RESIDUOS_1, subtotal: 0, unit_price: 0 };
  const b = { ...RESIDUOS_2, subtotal: 0, unit_price: 0 };
  assert.equal(V.findDuplicateCanonical([a, b], CONTRACT).length, 0);

  // Y tampoco cuando el llamador lo declara explícitamente con economic:false.
  const c = { ...RESIDUOS_1, economic: false };
  const d = { ...RESIDUOS_2, economic: false };
  assert.equal(V.findDuplicateCanonical([c, d], CONTRACT).length, 0);
});

test("el mismo concepto en presupuestos distintos no es duplicado", () => {
  const otro = { ...RESIDUOS_2, budget_id: B_PINTURA };
  assert.equal(V.findDuplicateCanonical([RESIDUOS_1, otro], CONTRACT).length, 0);
});

test("si alguna línea está en review, el duplicado baja a warning", () => {
  const enRevision = { ...RESIDUOS_2, canonical_status: "review" };
  const f = V.findDuplicateCanonical([RESIDUOS_1, enRevision], CONTRACT);
  assert.equal(f[0].severity, "warning");
});

// ═══ OVERLAPPING_CANONICAL_SCOPE ══════════════════════════════════════════════

test("agregado de residuos + componente cobrados → overlap", () => {
  const f = V.findOverlappingScope([AGREGADO, RESIDUOS_1, TASAS], CONTRACT);
  assert.equal(f.length, 2, "el agregado incluye contenedor y tasas: dos solapes");
  assert.deepEqual(codes(f), ["OVERLAPPING_CANONICAL_SCOPE", "OVERLAPPING_CANONICAL_SCOPE"]);
  assert.deepEqual(f[0].canonical_ids, ["WORK.WASTE.CONTAINER.HAUL", "WORK.WASTE.MANAGEMENT.FULL"]);
  assert.deepEqual(f[1].canonical_ids, ["WORK.WASTE.FEE.DISPOSAL", "WORK.WASTE.MANAGEMENT.FULL"]);
  assert.equal(f[0].evidence.relacion.tipo, "includes");
});

test("agregado sin componentes cobrados → no hay overlap", () => {
  assert.equal(V.findOverlappingScope([AGREGADO], CONTRACT).length, 0);
});

test("componentes sin el agregado → no hay overlap", () => {
  assert.equal(V.findOverlappingScope([RESIDUOS_1, TASAS], CONTRACT).length, 0);
});

test("un componente no cobrado no genera overlap", () => {
  const gratis = { ...RESIDUOS_1, subtotal: 0 };
  assert.equal(V.findOverlappingScope([AGREGADO, gratis], CONTRACT).length, 0);
});

test("una relación que no es 'includes' nunca genera overlap", () => {
  // SRV.WASTE.CONTAINER.HAUL 'provides' WORK.WASTE.CONTAINER.HAUL: son los dos lados del
  // margen, 290 € al gestor y 348 € al cliente. Cobrar los dos es correcto.
  const servicio = line("22222222-2222-4222-8222-222222222222", B_RESIDUOS, "Servicio de contenedor y retirada", "SRV.WASTE.CONTAINER.HAUL", "SERVICE", 1, "ud", 290, 290);
  assert.equal(V.findOverlappingScope([servicio, RESIDUOS_1], CONTRACT).length, 0);
});

// ═══ MATERIAL_DOUBLE_IMPUTATION ═══════════════════════════════════════════════

test("WORK LABOR_AND_MATERIAL + material aparte → doble imputación", () => {
  const f = V.findMaterialDoubleImputation([IMPRIMACION, FIJADOR], CONTRACT);
  assert.equal(f.length, 1);
  assert.equal(f[0].code, "MATERIAL_DOUBLE_IMPUTATION");
  assert.equal(f[0].severity, "error");
  assert.equal(f[0].evidence.material, "MAT.PAINT.PRIMER.ACRYLIC");
  assert.equal(f[0].evidence.concluyente, true);
  assert.equal(f[0].evidence.suma_material_cents, 8160);
  assert.deepEqual(f[0].item_ids, [IMPRIMACION.item_id, FIJADOR.item_id].sort());
});

test("WORK LABOR_ONLY + material aparte es VÁLIDO y no se reporta", () => {
  const soloManoObra = { ...IMPRIMACION, price_type: "LABOR_ONLY" };
  assert.equal(V.findMaterialDoubleImputation([soloManoObra, FIJADOR], CONTRACT).length, 0);
});

test("paredes y techos comparten material: UNA incidencia con evidencia agregada", () => {
  const f = V.findMaterialDoubleImputation([PAREDES, TECHOS, PINTURA_MAT], CONTRACT);
  assert.equal(f.length, 1, "un solo hecho: ese material está cobrado aparte");
  assert.deepEqual(f[0].canonical_ids, [
    "MAT.PAINT.EMULSION.INTERIOR_MATT",
    "WORK.PAINT.EMULSION.CEILING.2COATS",
    "WORK.PAINT.EMULSION.WALL.2COATS",
  ]);
  assert.equal(f[0].evidence.partidas_que_lo_incluyen.length, 2);
  assert.deepEqual(
    f[0].evidence.partidas_que_lo_incluyen.map((p) => p.item_id),
    [PAREDES.item_id, TECHOS.item_id].sort(),
    "las partidas van ordenadas por item_id, no por orden de llegada"
  );
});

test("si una de las dos partidas es LABOR_ONLY, sólo cuenta la otra", () => {
  const techosManoObra = { ...TECHOS, price_type: "LABOR_ONLY" };
  const f = V.findMaterialDoubleImputation([PAREDES, techosManoObra, PINTURA_MAT], CONTRACT);
  assert.equal(f.length, 1);
  assert.equal(f[0].evidence.partidas_que_lo_incluyen.length, 1);
  assert.equal(f[0].evidence.partidas_que_lo_incluyen[0].item_id, PAREDES.item_id);
});

test("price_type NULL en la partida: aviso informativo, nunca error duro", () => {
  const sinTipo = { ...IMPRIMACION, price_type: null };
  const f = V.findMaterialDoubleImputation([sinTipo, FIJADOR], CONTRACT);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "info");
  assert.equal(f[0].evidence.concluyente, false);
  assert.equal(f[0].evidence.partidas_que_lo_incluyen[0].incluye_material_en_precio, null);
});

test("material sin ninguna partida que lo incluya → nada que reportar", () => {
  assert.equal(V.findMaterialDoubleImputation([FIJADOR], CONTRACT).length, 0);
});

// ═══ PRICE_TYPE_NOT_ALLOWED ═══════════════════════════════════════════════════

test("price_type permitido → sin incidencia", () => {
  const f = V.findPriceTypeNotAllowed([RESIDUOS_1, PAREDES, PINTURA_MAT], CONTRACT);
  assert.equal(f.length, 0);
});

test("price_type prohibido → incidencia con los permitidos en la evidencia", () => {
  // WORK.WASTE.FEE.DISPOSAL sólo admite SERVICE.
  const mal = { ...TASAS, price_type: "LABOR_ONLY" };
  const f = V.findPriceTypeNotAllowed([mal], CONTRACT);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "error");
  assert.equal(f[0].evidence.price_type, "LABOR_ONLY");
  assert.deepEqual(f[0].evidence.allowed_price_types, ["SERVICE"]);
});

test("price_type NULL → info, y no se le asigna el default del concepto", () => {
  const sinTipo = { ...TASAS, price_type: null };
  const f = V.findPriceTypeNotAllowed([sinTipo], CONTRACT);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "info", "no es error duro");
  assert.equal(f[0].evidence.price_type, null, "sigue siendo null: no se inventa");
  assert.equal(f[0].evidence.default_price_type, "SERVICE", "el default se muestra, no se aplica");
});

test("una línea sin canonical_id no se comprueba contra ningún vocabulario", () => {
  const sinClasificar = line("33333333-3333-4333-8333-333333333333", B_RESIDUOS, "Ayudas de albañilería", null, null, 1, "pa", 500, 500);
  assert.equal(V.findPriceTypeNotAllowed([sinClasificar], CONTRACT).length, 0);
});

test("un canonical_id fuera del contrato es fallo de programa, no incidencia", () => {
  const inventado = { ...TASAS, canonical_id: "WORK.NO.EXISTE.NADA" };
  assert.throws(() => V.findPriceTypeNotAllowed([inventado], CONTRACT), /no está en el contrato recibido/);
});

// ═══ Fingerprint ══════════════════════════════════════════════════════════════

test("la huella económica normaliza unidad, céntimos y decimales de cantidad", () => {
  const a = { ...RESIDUOS_1, unit: "UD", unit_price: 717.5, quantity: 6 };
  const b = { ...RESIDUOS_2, unit: " ud ", unit_price: 717.5, quantity: 6.0 };
  assert.equal(V.economicFingerprint(a), V.economicFingerprint(b));
});

test("huella idéntica con canonical distinto: sólo señal informativa, no identidad", () => {
  const a = line("44444444-4444-4444-8444-444444444444", B_RESIDUOS, "Partida alzada A", "WORK.PROTECT.SITE.COVERING", "LABOR_AND_MATERIAL", 1, "pa", 140, 140);
  const b = line("55555555-5555-4555-8555-555555555555", B_RESIDUOS, "Partida alzada B", "WORK.WASTE.FEE.DISPOSAL", "SERVICE", 1, "pa", 140, 140);

  const f = V.findEconomicFingerprintCollisions([a, b], CONTRACT);
  assert.equal(f.length, 1);
  assert.equal(f[0].code, "ECONOMIC_FINGERPRINT_COLLISION");
  assert.equal(f[0].severity, "info");
  assert.equal(f[0].evidence.asigna_identidad, false);

  // Lo importante: la huella NO ha producido un duplicado ni ha unificado conceptos.
  assert.equal(V.findDuplicateCanonical([a, b], CONTRACT).length, 0);
  const informe = V.validateBudget([a, b], CONTRACT);
  assert.equal(informe.findings.filter((x) => x.code === "DUPLICATE_CANONICAL").length, 0);
  assert.equal(informe.counts.error, 0);
});

test("cuando la huella coincide Y el concepto también, no se duplica el ruido", () => {
  const f = V.findEconomicFingerprintCollisions([RESIDUOS_1, RESIDUOS_2], CONTRACT);
  assert.equal(f.length, 0, "eso ya lo cuenta DUPLICATE_CANONICAL");
});

// ═══ Determinismo, estabilidad y pureza ═══════════════════════════════════════

const ESCENARIO = [RESIDUOS_1, RESIDUOS_2, TASAS, AGREGADO, PAREDES, TECHOS, PINTURA_MAT, IMPRIMACION, FIJADOR];

test("el informe no depende del orden de entrada", () => {
  const directo = V.validateBudget(ESCENARIO, CONTRACT);
  const alReves = V.validateBudget([...ESCENARIO].reverse(), CONTRACT);
  const barajado = V.validateBudget([ESCENARIO[4], ESCENARIO[0], ESCENARIO[8], ESCENARIO[2], ESCENARIO[6], ESCENARIO[1], ESCENARIO[7], ESCENARIO[3], ESCENARIO[5]], CONTRACT);

  assert.deepEqual(alReves, directo);
  assert.deepEqual(barajado, directo);
});

test("no se emiten incidencias equivalentes repetidas", () => {
  const { findings } = V.validateBudget(ESCENARIO, CONTRACT);
  const huellas = findings.map((f) => `${f.code}|${f.budget_id}|${f.canonical_ids.join(",")}|${f.item_ids.join(",")}`);
  assert.equal(new Set(huellas).size, huellas.length, "hay incidencias duplicadas");
});

test("el mismo hecho no se reporta a la vez como overlap y como doble imputación", () => {
  const f = V.validateBudget([PAREDES, PINTURA_MAT], CONTRACT).findings;
  assert.equal(only(f, "OVERLAPPING_CANONICAL_SCOPE").length, 0);
  assert.equal(only(f, "MATERIAL_DOUBLE_IMPUTATION").length, 1);
});

test("los validators no mutan la entrada", () => {
  const antes = JSON.stringify(ESCENARIO);
  V.validateBudget(ESCENARIO, CONTRACT);
  assert.equal(JSON.stringify(ESCENARIO), antes);
});

test("una incidencia de negocio nunca se lanza como excepción", () => {
  assert.doesNotThrow(() => V.validateBudget(ESCENARIO, CONTRACT));
});

test("el informe se declara observador y cuenta por severidad", () => {
  const informe = V.validateBudget(ESCENARIO, CONTRACT);
  assert.equal(informe.observer_mode, true);
  assert.equal(
    informe.counts.error + informe.counts.warning + informe.counts.info,
    informe.findings.length
  );
  // Orden de presentación: el declarado en FINDING_CODES, de lo más caro a lo más leve.
  const orden = informe.findings.map((f) => T.FINDING_CODES.indexOf(f.code));
  assert.deepEqual(orden, [...orden].sort((a, b) => a - b));
});

test("presupuesto limpio: ninguna incidencia", () => {
  const limpio = [
    line("66666666-6666-4666-8666-666666666666", B_PINTURA, "Pintura plástica en paredes", "WORK.PAINT.EMULSION.WALL.2COATS", "LABOR_AND_MATERIAL", 58, "m2", 15.64, 906.89),
    line("77777777-7777-4777-8777-777777777777", B_PINTURA, "Contenedor y transporte a gestor autorizado", "WORK.WASTE.CONTAINER.HAUL", "SERVICE", 3, "ud", 545.74, 1637.21),
  ];
  assert.deepEqual(V.validateBudget(limpio, CONTRACT).findings, []);
});

test("escenario completo: los tres hechos reales aparecen y nada se corrige", () => {
  const { findings } = V.validateBudget(ESCENARIO, CONTRACT);

  assert.equal(only(findings, "DUPLICATE_CANONICAL").length, 1);
  assert.equal(only(findings, "OVERLAPPING_CANONICAL_SCOPE").length, 2);
  assert.equal(only(findings, "MATERIAL_DOUBLE_IMPUTATION").length, 2);

  for (const f of findings) {
    assert.ok(T.FINDING_SEVERITIES.includes(f.severity));
    assert.ok(f.message.length > 0);
    assert.deepEqual(f.item_ids, [...f.item_ids].sort(), "item_ids sin ordenar");
    assert.deepEqual(f.canonical_ids, [...f.canonical_ids].sort(), "canonical_ids sin ordenar");
    assert.equal("fix" in f, false, "una incidencia observadora no propone correcciones");
  }
});
