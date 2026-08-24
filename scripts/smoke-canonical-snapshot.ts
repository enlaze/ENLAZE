/**
 * smoke-canonical-snapshot.ts — Fase 2D-1c. Comprobación READ-ONLY contra Supabase real.
 *
 * Qué comprueba. Que la sintaxis PostgREST que emite `loadCanonicalRegistrySnapshot`
 * tiene contra el servidor real exactamente la semántica que el fake de los tests le
 * atribuye. En concreto que estos dos grupos:
 *
 *     company_id IS NULL OR company_id = <companyId>
 *     source_ref IS NULL OR source_ref IN (...)
 *
 * se combinan entre sí con AND y no con OR. Dos `.or()` encadenados en supabase-js
 * producen dos parámetros `or=` distintos en la URL, y PostgREST los conjuga con AND.
 * Eso es lo que el fake asume. Si el servidor real hiciera otra cosa, el snapshot
 * traería filas de más (o de menos) y la resolución cambiaría sin que ningún test
 * unitario se enterase.
 *
 * Cómo lo comprueba. No se fía de una expectativa escrita a mano. Descarga las tres
 * tablas ENTERAS sin filtrar, aplica en JavaScript la semántica pretendida, y compara
 * ese conjunto contra el que devolvió PostgREST con los filtros puestos. Si PostgREST
 * interpretara los filtros de otro modo, los dos conjuntos diferirían.
 *
 * SOLO LECTURA. El cliente que se pasa al loader está envuelto en un proxy que sólo
 * expone select/eq/is/in/or/limit/order/then. Cualquier intento de insert, update,
 * delete, upsert o rpc lanza antes de tocar la red. No es una promesa: es una barrera.
 *
 * Uso:
 *     npm run smoke:snapshot
 *
 * Requiere NEXT_PUBLIC_SUPABASE_URL y una clave en el entorno. Por defecto usa
 * SUPABASE_SERVICE_ROLE_KEY, que ignora la RLS: es deliberado, porque así lo único que
 * filtra las filas es el predicado explícito del loader, que es justo lo que se está
 * midiendo. Con la clave anónima, la RLS y el predicado se solaparían y un fallo del
 * predicado quedaría tapado por la RLS. Con SMOKE_USE_ANON=1 se usa la anónima.
 */

import { createClient } from "@supabase/supabase-js";

import {
  assertNoTenantLeak,
  canonicalNormalize,
  createInMemoryRegistry,
  type MinimalSupabaseClient,
} from "../lib/canonical/registry";
import {
  loadCanonicalRegistrySnapshot,
  ALIAS_SELECT,
  CONCEPT_SELECT,
  SOURCE_SELECT,
  type SnapshotLine,
} from "../lib/canonical/registry-snapshot";
import { classifyBudgetItems } from "../lib/canonical/classify-budget-items";
import { resolveCanonical } from "../lib/canonical/resolver";
import type {
  CanonicalAlias,
  CanonicalAliasSourceMeta,
  CanonicalConcept,
  CanonicalResolution,
  ResolutionOrigin,
} from "../lib/types/canonical";

// ─── Barrera de sólo lectura ──────────────────────────────────────────────────

/** Únicos métodos que el smoke permite. Nada de esto escribe. */
const METODOS_PERMITIDOS = new Set([
  "select",
  "eq",
  "is",
  "in",
  "or",
  "limit",
  "order",
  "then",
  "catch",
  "finally",
]);

class EscrituraProhibida extends Error {
  constructor(metodo: string) {
    super(
      `smoke read-only: se ha intentado llamar a "${metodo}". Este script tiene ` +
        `terminantemente prohibido escribir en Supabase.`
    );
    this.name = "EscrituraProhibida";
  }
}

interface Contador {
  total: number;
  porTabla: Record<string, number>;
  registro: string[];
  reset(): void;
}

export function nuevoContador(): Contador {
  return {
    total: 0,
    porTabla: {},
    registro: [],
    reset(this: Contador) {
      this.total = 0;
      this.porTabla = {};
      this.registro = [];
    },
  };
}

/**
 * Envuelve el cliente real. Cuenta un request por cada `.from()` —que es exactamente
 * una petición HTTP a PostgREST— y bloquea todo lo que no sea lectura.
 */
export function clienteInstrumentado(
  real: { from: (t: string) => unknown },
  contador: Contador
): MinimalSupabaseClient {
  const envolver = (destino: unknown, tabla: string): unknown =>
    new Proxy(destino as object, {
      get(obj, prop, receptor) {
        if (typeof prop !== "string") return Reflect.get(obj, prop, receptor);
        if (!METODOS_PERMITIDOS.has(prop)) throw new EscrituraProhibida(`${tabla}.${prop}`);

        const valor = Reflect.get(obj, prop, receptor);
        if (typeof valor !== "function") return valor;

        return (...args: unknown[]) => {
          if (prop === "select") {
            contador.registro.push(`${tabla}: select(${String(args[0]).slice(0, 60)}…)`);
          }
          const resultado = (valor as (...a: unknown[]) => unknown).apply(obj, args);
          // then/catch/finally devuelven una promesa: se deja pasar tal cual.
          if (prop === "then" || prop === "catch" || prop === "finally") return resultado;
          return envolver(resultado, tabla);
        };
      },
    });

  return {
    from(tabla: string) {
      contador.total += 1;
      contador.porTabla[tabla] = (contador.porTabla[tabla] ?? 0) + 1;
      return envolver(real.from(tabla), tabla) as ReturnType<MinimalSupabaseClient["from"]>;
    },
  };
}

// ─── Semántica pretendida, reimplementada en memoria ──────────────────────────

/**
 * Lo que el loader DEBERÍA traer, según la semántica que el fake asume. Es la
 * referencia contra la que se compara lo que PostgREST devolvió de verdad.
 *
 * Nótese el AND entre los dos grupos: es la propiedad bajo examen.
 */
export function esperadoEnMemoria(
  todos: readonly CanonicalAlias[],
  norms: readonly string[],
  companyId: string | null,
  refs: readonly string[]
): CanonicalAlias[] {
  const setNorms = new Set(norms);
  const setRefs = new Set(refs);

  return todos
    .filter((a) => setNorms.has(a.alias_norm))
    .filter((a) => (companyId === null ? a.company_id === null : a.company_id === null || a.company_id === companyId))
    .filter((a) => (setRefs.size === 0 ? a.source_ref === null : a.source_ref === null || setRefs.has(a.source_ref)))
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

// ─── Utilidades de salida ─────────────────────────────────────────────────────

const linea = (c = "─") => console.log(c.repeat(78));

function titulo(texto: string): void {
  console.log("");
  linea("═");
  console.log(texto);
  linea("═");
}

function tabla(filas: Record<string, unknown>[]): void {
  if (filas.length === 0) {
    console.log("  (sin filas)");
    return;
  }
  console.table(filas);
}

interface Resultado {
  caso: string;
  ok: boolean;
  notas: string[];
}

const resultados: Resultado[] = [];

function comprobar(caso: string, condicion: boolean, nota: string): void {
  const entrada = resultados.find((r) => r.caso === caso);
  const destino = entrada ?? { caso, ok: true, notas: [] };
  if (!entrada) resultados.push(destino);
  destino.ok = destino.ok && condicion;
  destino.notas.push(`${condicion ? "OK  " : "FALLO"} ${nota}`);
  console.log(`  ${condicion ? "✓" : "✗"} ${nota}`);
}

// ─── Un caso ──────────────────────────────────────────────────────────────────

interface Caso {
  nombre: string;
  lineas: SnapshotLine[];
  companyId: string | null;
}

async function ejecutarCaso(
  caso: Caso,
  clienteReal: { from: (t: string) => unknown },
  verdad: {
    aliases: CanonicalAlias[];
    concepts: CanonicalConcept[];
    sources: CanonicalAliasSourceMeta[];
  }
): Promise<void> {
  titulo(`CASO — ${caso.nombre}`);

  const contador = nuevoContador();
  const cliente = clienteInstrumentado(clienteReal, contador);

  const snapshot = await loadCanonicalRegistrySnapshot({
    supabase: cliente,
    lines: caso.lineas,
    companyId: caso.companyId,
  });

  const requestsCarga = contador.total;

  // ── Lo que se pidió ────────────────────────────────────────────────────────
  const norms = Array.from(
    new Set(caso.lineas.map((l) => canonicalNormalize(l.concept)).filter((n) => n !== ""))
  ).sort();
  const refs = Array.from(
    new Set(
      caso.lineas
        .map((l) => l.canonical_source_ref)
        .filter((r): r is string => typeof r === "string" && r !== "")
    )
  ).sort();

  console.log("\n  alias_norm consultados:", JSON.stringify(norms, null, 0));
  console.log("  source_refs usados:", refs.length === 0 ? "(ninguno)" : JSON.stringify(refs));
  console.log("  company_id del caso:", caso.companyId ?? "(null — sólo global)");

  // ── Lo que volvió ──────────────────────────────────────────────────────────
  console.log(`\n  aliases recuperados: ${snapshot.data.aliases.length}`);
  tabla(
    snapshot.data.aliases.map((a) => ({
      id: a.id,
      canonical_id: a.canonical_id,
      kind: a.alias_kind,
      source: a.source,
      source_ref: a.source_ref ?? "(null)",
      company_id: a.company_id ?? "(null)",
    }))
  );

  const canonicalIds = Array.from(new Set(snapshot.data.aliases.map((a) => a.canonical_id))).sort();
  console.log("  canonical_ids recuperados:", JSON.stringify(canonicalIds));
  console.log(`  concepts cargados: ${snapshot.data.concepts.length}`);
  console.log(
    "  concepts:",
    JSON.stringify(snapshot.data.concepts.map((c) => c.canonical_id).sort())
  );
  console.log(`\n  REQUESTS TOTALES (carga): ${requestsCarga}`, JSON.stringify(contador.porTabla));
  console.log(
    `  fórmula: 1 + ceil(D=${snapshot.stats.distinctNorms}/200)` +
      ` * max(1, ceil(R=${snapshot.stats.distinctSourceRefs}/200))` +
      ` + ceil(C=${snapshot.stats.distinctCanonicalIds}/200)`
  );

  console.log("");

  // ── 1. El contador del loader coincide con los requests reales ─────────────
  comprobar(
    caso.nombre,
    snapshot.stats.queries.total === requestsCarga,
    `el loader declara ${snapshot.stats.queries.total} consultas y se observaron ${requestsCarga}`
  );

  // ── 2. PostgREST filtró como el fake supone (el AND entre grupos) ──────────
  const esperado = esperadoEnMemoria(verdad.aliases, norms, caso.companyId, refs);
  const obtenidoIds = snapshot.data.aliases.map((a) => a.id).sort();
  const esperadoIds = esperado.map((a) => a.id).sort();

  const sobran = obtenidoIds.filter((id) => !esperadoIds.includes(id));
  const faltan = esperadoIds.filter((id) => !obtenidoIds.includes(id));

  comprobar(
    caso.nombre,
    sobran.length === 0,
    `PostgREST no devolvió filas de más${sobran.length ? ` (sobran ${JSON.stringify(sobran)})` : ""}`
  );
  comprobar(
    caso.nombre,
    faltan.length === 0,
    `PostgREST no perdió filas${faltan.length ? ` (faltan ${JSON.stringify(faltan)})` : ""}`
  );

  // ── 3. Sin fugas de tenant ─────────────────────────────────────────────────
  let fuga = 0;
  try {
    assertNoTenantLeak(snapshot.data.aliases, caso.companyId);
  } catch {
    fuga = snapshot.data.aliases.filter(
      (a) => a.company_id !== null && a.company_id !== caso.companyId
    ).length;
  }
  comprobar(caso.nombre, fuga === 0, `tenant leakage = ${fuga}`);

  // ── 4. Sin duplicados ──────────────────────────────────────────────────────
  comprobar(
    caso.nombre,
    new Set(obtenidoIds).size === obtenidoIds.length,
    "ningún alias repetido en el snapshot"
  );

  // ── 5. Cero I/O después de construir el snapshot ───────────────────────────
  contador.reset();

  const origen: ResolutionOrigin = caso.lineas[0]?.canonical_origin ?? "free_text";
  const resolucionesSnapshot: CanonicalResolution[] = [];
  for (const l of caso.lineas) {
    resolucionesSnapshot.push(
      await resolveCanonical(
        l.concept,
        {
          company_id: caso.companyId,
          origin: l.canonical_origin ?? origen,
          source_ref: l.canonical_source_ref ?? null,
        },
        snapshot.registry
      )
    );
  }
  await classifyBudgetItems(caso.lineas, snapshot.registry, { companyId: caso.companyId });

  comprobar(
    caso.nombre,
    contador.total === 0,
    `resolver + clasificar tras el snapshot: ${contador.total} requests adicionales`
  );

  // ── 6. Mismo resultado contra un registry en memoria con las MISMAS filas ──
  const referencia = createInMemoryRegistry({
    concepts: snapshot.data.concepts,
    aliases: snapshot.data.aliases,
    sources: snapshot.data.sources,
    relations: [],
  });

  let divergentes = 0;
  const comparativa: Record<string, unknown>[] = [];
  for (let i = 0; i < caso.lineas.length; i += 1) {
    const l = caso.lineas[i]!;
    const esperadaRes = await resolveCanonical(
      l.concept,
      {
        company_id: caso.companyId,
        origin: l.canonical_origin ?? origen,
        source_ref: l.canonical_source_ref ?? null,
      },
      referencia
    );
    const real = resolucionesSnapshot[i]!;
    const igual =
      real.canonical_id === esperadaRes.canonical_id &&
      real.status === esperadaRes.status &&
      real.confidence === esperadaRes.confidence &&
      real.source === esperadaRes.source;
    if (!igual) divergentes += 1;

    comparativa.push({
      concepto: l.concept.slice(0, 42),
      status: real.status,
      canonical_id: real.canonical_id ?? "(null)",
      confidence: real.confidence ?? "(null)",
      source: real.source ?? "(null)",
      coincide: igual ? "sí" : "NO",
    });
  }

  console.log("\n  resoluciones:");
  tabla(comparativa);

  comprobar(
    caso.nombre,
    divergentes === 0,
    `resoluciones snapshot vs createInMemoryRegistry: ${divergentes} divergencias`
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const usarAnon = process.env.SMOKE_USE_ANON === "1";
  const key = usarAnon
    ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    : process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o la clave. Ejecuta con:\n" +
        "  npm run smoke:snapshot\n" +
        "que carga .env.local automáticamente."
    );
    process.exit(1);
  }

  titulo("FASE 2D-1c · smoke READ-ONLY del snapshot canónico");
  console.log(`  proyecto: ${url}`);
  console.log(`  clave:    ${usarAnon ? "anónima (RLS activa)" : "service_role (RLS ignorada)"}`);
  console.log(
    usarAnon
      ? "  nota: con RLS activa, un fallo del predicado del loader podría quedar tapado."
      : "  nota: sin RLS, lo único que filtra es el predicado explícito del loader. Es lo que se mide."
  );

  const real = createClient(url, key, { auth: { persistSession: false } });

  // ── Verdad de referencia: las tablas enteras, sin filtro ───────────────────
  titulo("VERDAD DE REFERENCIA — tablas completas, sin filtros");
  const contadorVerdad = nuevoContador();
  const clienteVerdad = clienteInstrumentado(real, contadorVerdad);

  const leer = async <T>(t: string, cols: string): Promise<T[]> => {
    const { data, error } = await clienteVerdad.from(t).select(cols).then((r) => r);
    if (error) throw new Error(`${t}: ${JSON.stringify(error)}`);
    return (data ?? []) as T[];
  };

  const verdad = {
    sources: await leer<CanonicalAliasSourceMeta>("canonical_alias_sources", SOURCE_SELECT),
    aliases: await leer<CanonicalAlias>("canonical_aliases", ALIAS_SELECT),
    concepts: await leer<CanonicalConcept>("canonical_concepts", CONCEPT_SELECT),
  };

  console.log(`  canonical_alias_sources: ${verdad.sources.length}`);
  console.log(`  canonical_aliases:       ${verdad.aliases.length}`);
  console.log(`  canonical_concepts:      ${verdad.concepts.length}`);
  console.log(`  requests: ${contadorVerdad.total}`);

  // ── Inventario de evidencia real ───────────────────────────────────────────
  const privados = verdad.aliases.filter((a) => a.company_id !== null);
  const conRef = verdad.aliases.filter((a) => a.source_ref !== null);
  const companiesConEvidencia = Array.from(new Set(privados.map((a) => a.company_id!))).sort();
  const refsReales = Array.from(new Set(conRef.map((a) => a.source_ref!))).sort();

  titulo("INVENTARIO DE EVIDENCIA REAL");
  console.log(`  aliases privados (company_id no nulo): ${privados.length}`);
  console.log(`  empresas con evidencia privada:        ${JSON.stringify(companiesConEvidencia)}`);
  console.log(`  aliases con source_ref:                ${conRef.length}`);
  console.log(`  source_refs distintos:                 ${JSON.stringify(refsReales)}`);
  console.log(
    `  sources presentes:                     ` +
      JSON.stringify(Array.from(new Set(verdad.aliases.map((a) => a.source))).sort())
  );

  // Las líneas se construyen con alias_value REALES. No se inventa nada.
  const valoresReales = Array.from(new Set(verdad.aliases.map((a) => a.alias_value))).sort();
  const muestra = valoresReales.slice(0, 8);

  if (muestra.length === 0) {
    console.error("\nNo hay ningún alias en la base. No hay nada que comprobar.");
    process.exit(1);
  }

  // ── CASO 1 — global ────────────────────────────────────────────────────────
  await ejecutarCaso(
    {
      nombre: "1. global (companyId = null)",
      companyId: null,
      lineas: muestra.map((v) => ({ concept: v, canonical_origin: "free_text" as const })),
    },
    real,
    verdad
  );

  // ── CASO 2 — company + global ──────────────────────────────────────────────
  if (companiesConEvidencia.length > 0) {
    const empresa = companiesConEvidencia[0]!;
    const suyos = privados.filter((a) => a.company_id === empresa);
    await ejecutarCaso(
      {
        nombre: `2. company + global (${empresa})`,
        companyId: empresa,
        lineas: Array.from(new Set([...suyos.map((a) => a.alias_value), ...muestra.slice(0, 4)])).map(
          (v) => ({ concept: v, canonical_origin: "free_text" as const })
        ),
      },
      real,
      verdad
    );
  } else {
    titulo("CASO 2 — company + global");
    console.log(
      "  SIN EVIDENCIA REAL. No existe ningún alias con company_id no nulo en la base.\n" +
        "  No se ejecuta el caso y no se inventan filas. Lo único que puede afirmarse hoy\n" +
        "  es que el predicado de tenant no trae filas ajenas, porque no hay filas ajenas\n" +
        "  que traer. La rama `company_id.eq.<uuid>` del OR queda SIN VERIFICAR contra el\n" +
        "  servidor real hasta que exista al menos un alias privado."
    );
    resultados.push({
      caso: "2. company + global",
      ok: true,
      notas: ["OMITIDO — sin evidencia privada real"],
    });
  }

  // ── CASO 3 — source_ref ────────────────────────────────────────────────────
  if (refsReales.length > 0) {
    const conRefLineas = conRef.slice(0, 6).map((a) => ({
      concept: a.alias_value,
      canonical_origin: "import" as const,
      canonical_source_ref: a.source_ref,
    }));
    await ejecutarCaso(
      {
        nombre: `3. source_ref (${refsReales.join(", ")})`,
        companyId: null,
        lineas: conRefLineas,
      },
      real,
      verdad
    );
  } else {
    titulo("CASO 3 — source_ref");
    console.log(
      "  SIN EVIDENCIA REAL. No existe ningún alias con source_ref no nulo en la base.\n" +
        "  La rama `source_ref.in.(...)` del OR queda SIN VERIFICAR contra el servidor\n" +
        "  real. Lo que sí se ejerce en los casos 1 y 2 es la rama `source_ref.is.null`,\n" +
        "  que es la que se aplica cuando el presupuesto no declara procedencia documental."
    );
    resultados.push({
      caso: "3. source_ref",
      ok: true,
      notas: ["OMITIDO — sin aliases con source_ref reales"],
    });
  }

  // ── Veredicto ──────────────────────────────────────────────────────────────
  titulo("VEREDICTO");
  for (const r of resultados) {
    console.log(`${r.ok ? "PASA " : "FALLA"}  ${r.caso}`);
    for (const n of r.notas) console.log(`         ${n}`);
  }

  const fallos = resultados.filter((r) => !r.ok);
  console.log("");
  linea();
  console.log("CERO ESCRITURAS: este script sólo invoca select/eq/is/in/or/limit/order.");
  console.log("Cualquier otro método lanza EscrituraProhibida antes de tocar la red.");
  linea();

  if (fallos.length > 0) {
    console.error(`\n${fallos.length} caso(s) con divergencias respecto al fake. NO avanzar al wiring.`);
    process.exit(1);
  }
  console.log("\nTodo coincide con lo que el fake asume.");
}

/**
 * Sólo arranca cuando se ejecuta directamente. Así el módulo puede importarse desde un
 * test para ejercitar la barrera de sólo lectura y la semántica de referencia sin abrir
 * ninguna conexión.
 */
const ejecutadoDirectamente =
  process.argv[1] !== undefined && process.argv[1].includes("smoke-canonical-snapshot");

if (ejecutadoDirectamente) {
  main().catch((e) => {
    console.error("\nSMOKE ABORTADO");
    console.error(e);
    process.exit(1);
  });
}
