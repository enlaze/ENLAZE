/**
 * registry-snapshot.ts — Carga por lotes del vocabulario canónico (Fase 2D-1b).
 *
 * Problema que resuelve. `resolveCanonical` pide evidencia línea a línea: un
 * `listAliasSources()` por invocación (resolver.ts:286) y entre dos y cuatro
 * `findAliases()` por línea, más un `getConceptByCanonicalId` por concepto. Para el
 * presupuesto real de 59 partidas eso son del orden de 260 viajes a Supabase. El
 * memoizador de classify-budget-items.ts baja el coste a O(textos distintos), que
 * sigue creciendo con el presupuesto.
 *
 * Qué hace este módulo. Mira TODAS las líneas antes de resolver ninguna, calcula qué
 * evidencia puede llegar a hacer falta, la trae en un número de consultas que depende
 * del volumen de evidencia distinta y no del número de partidas, y devuelve un
 * `createInMemoryRegistry` cargado. A partir de ahí la clasificación no toca la red.
 *
 * Coste:
 *     1  (canonical_alias_sources)
 *   + ceil(D / chunk.aliasNorms) * max(1, ceil(R / chunk.sourceRefs))
 *   + ceil(C / chunk.canonicalIds)
 *
 * donde D = alias_norm distintos, R = source_ref válidos distintos y C = canonical_id
 * distintos hallados. NO es constante: es O(fragmentos de evidencia distinta). Lo que
 * sí garantiza es que nunca hay una consulta por línea. En la práctica R vale 0 o 1
 * —un presupuesto importa de un banco, no de doce—, así que el factor multiplicativo
 * es 1 y el coste queda en 1 + ceil(D/200) + ceil(C/200).
 *
 * LÍMITE DELIBERADO: aquí no se decide nada. Ni precedencia de procedencias, ni
 * global-only para `engine`, ni anulación de empresa para `legacy`, ni exact contra
 * synonym, ni desempates privado/global. Todo eso vive en resolver.ts y sigue
 * viviendo allí. Este módulo trae un SUPERCONJUNTO legítimo y se aparta. Si alguna
 * vez alguien mete aquí un filtro "para optimizar" que dependa de esas reglas, habrá
 * cambiado el resultado de la resolución desde un módulo de rendimiento.
 *
 * `canonical_concept_relations` NO se carga todavía: hace falta para `validateBudget`,
 * que se conecta en una fase posterior.
 */

import {
  assertKnownSources,
  assertNoTenantLeak,
  canonicalNormalize,
  createInMemoryRegistry,
  type CanonicalRegistry,
  type MinimalSupabaseClient,
} from "./registry";
import { normalizeProvenance, type LineProvenance } from "./classify-budget-items";
import type {
  CanonicalAlias,
  CanonicalAliasSourceMeta,
  CanonicalConcept,
  ResolutionOrigin,
} from "../types/canonical";

// ─── Errores ──────────────────────────────────────────────────────────────────

export const SNAPSHOT_TABLES = [
  "canonical_alias_sources",
  "canonical_aliases",
  "canonical_concepts",
] as const;

export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

/**
 * Fallo de INFRAESTRUCTURA leyendo el vocabulario.
 *
 * Existe para poder distinguir dos cosas que un registry vacío confundiría: "este
 * presupuesto no tiene ninguna coincidencia en el vocabulario" y "Supabase no
 * respondió". La primera es un resultado legítimo y frecuente. La segunda es una
 * avería, y convertirla aquí en un snapshot vacío haría que un corte de red se
 * presentara como un presupuesto entero sin clasificar, indistinguible de uno con
 * conceptos desconocidos.
 *
 * El fail-open NO se implementa en este módulo. Se implementará en el orquestador,
 * que capturará este error y dejará las líneas en `unmatched` sin impedir el guardado.
 * Quien decide seguir adelante pese a una avería debe ser quien tiene el contexto para
 * decidirlo, no quien la detecta.
 */
export class CanonicalSnapshotError extends Error {
  readonly table: SnapshotTable;
  override readonly cause: unknown;

  constructor(table: SnapshotTable, cause: unknown) {
    const detail =
      typeof cause === "object" && cause !== null && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`canonical snapshot: fallo leyendo ${table}: ${detail}`);
    this.name = "CanonicalSnapshotError";
    this.table = table;
    this.cause = cause;
  }
}

export function isCanonicalSnapshotError(error: unknown): error is CanonicalSnapshotError {
  return error instanceof CanonicalSnapshotError;
}

// ─── Columnas ─────────────────────────────────────────────────────────────────

/**
 * Deben coincidir con las de createSupabaseRegistry (registry.ts:133-140). Si divergen,
 * el snapshot devolvería filas incompletas y la resolución cambiaría en silencio; hay
 * un test que comprueba que cubren todos los campos de cada interfaz.
 */
export const ALIAS_SELECT =
  "id, canonical_id, alias_kind, source, source_ref, company_id, alias_value, " +
  "alias_norm, confidence";

export const CONCEPT_SELECT =
  "id, canonical_id, kind, domain, family, concept, variant, display_name_es, " +
  "definition_es, default_unit, default_price_type, allowed_price_types, status, " +
  "superseded_by, version";

export const SOURCE_SELECT =
  "source, general_rank, source_specific, requires_source_ref, label_es";

// ─── Opciones ─────────────────────────────────────────────────────────────────

export interface SnapshotLine extends LineProvenance {
  concept: string;
}

export interface ChunkSizes {
  aliasNorms: number;
  sourceRefs: number;
  canonicalIds: number;
}

/**
 * 200 elementos por `IN (...)`. El límite real no es de Postgres sino de la longitud
 * de URL de PostgREST, que empieza a dar problemas bastante antes de que la consulta
 * lo dé. 200 alias_norm de reforma rondan los 6 KB, cómodamente por debajo.
 */
export const DEFAULT_CHUNK_SIZES: ChunkSizes = Object.freeze({
  aliasNorms: 200,
  sourceRefs: 200,
  canonicalIds: 200,
});

export interface LoadSnapshotOptions {
  supabase: MinimalSupabaseClient;
  lines: readonly SnapshotLine[];
  companyId: string | null;
  /** Procedencia para las líneas que aún no la llevan grabada. */
  defaultOrigin?: ResolutionOrigin;
  /** Número o tamaños por tabla. Los tests lo bajan para forzar el troceado. */
  chunkSize?: number | Partial<ChunkSizes>;
}

export interface SnapshotStats {
  /** D — alias_norm distintos y no vacíos. */
  distinctNorms: number;
  /** R — source_ref válidos distintos. */
  distinctSourceRefs: number;
  /** C — canonical_id distintos hallados en los aliases traídos. */
  distinctCanonicalIds: number;
  chunks: { aliasNorms: number; sourceRefs: number; canonicalIds: number };
  queries: { total: number; byTable: Record<string, number> };
  rows: { sources: number; aliases: number; concepts: number };
}

export interface CanonicalRegistrySnapshot {
  /** Registry puramente en memoria. Desde aquí, cero I/O. */
  registry: CanonicalRegistry;
  data: {
    sources: CanonicalAliasSourceMeta[];
    aliases: CanonicalAlias[];
    concepts: CanonicalConcept[];
  };
  stats: SnapshotStats;
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

function resolveChunkSizes(chunkSize: LoadSnapshotOptions["chunkSize"]): ChunkSizes {
  if (chunkSize === undefined) return { ...DEFAULT_CHUNK_SIZES };
  if (typeof chunkSize === "number") {
    const n = Math.max(1, Math.floor(chunkSize));
    return { aliasNorms: n, sourceRefs: n, canonicalIds: n };
  }
  return {
    aliasNorms: Math.max(1, Math.floor(chunkSize.aliasNorms ?? DEFAULT_CHUNK_SIZES.aliasNorms)),
    sourceRefs: Math.max(1, Math.floor(chunkSize.sourceRefs ?? DEFAULT_CHUNK_SIZES.sourceRefs)),
    canonicalIds: Math.max(
      1,
      Math.floor(chunkSize.canonicalIds ?? DEFAULT_CHUNK_SIZES.canonicalIds)
    ),
  };
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * Deduplica y ORDENA. El orden importa: es lo que hace que dos cargas del mismo
 * presupuesto emitan las mismas consultas con los mismos valores en el mismo orden, y
 * por tanto que el snapshot sea comparable entre ejecuciones.
 */
function distinctSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * Los valores que se interpolan en un filtro `or=(...)` de PostgREST tienen que ser
 * inertes. `source_ref` ya lo es por construcción (sólo llegan aquí los que pasaron
 * ck_budget_items_source_ref_format), pero `company_id` viene de fuera y una coma o un
 * paréntesis cambiarían la estructura del filtro, no sólo su valor.
 */
const SAFE_FILTER_VALUE = /^[A-Za-z0-9_-]+$/;

function assertSafeFilterValue(value: string, what: string): void {
  if (!SAFE_FILTER_VALUE.test(value)) {
    throw new Error(
      `canonical snapshot: ${what} contiene caracteres no admitidos en un filtro ` +
        `PostgREST ('${value}'). Se rechaza antes de construir la consulta.`
    );
  }
}

// ─── Ejecución instrumentada ──────────────────────────────────────────────────

type QueryBuilderLike = { then: <R>(cb: (r: { data: unknown; error: unknown }) => R) => Promise<R> };

async function runQuery<T>(
  builder: QueryBuilderLike,
  table: SnapshotTable,
  stats: SnapshotStats
): Promise<T[]> {
  stats.queries.total += 1;
  stats.queries.byTable[table] = (stats.queries.byTable[table] ?? 0) + 1;

  const { data, error } = await builder.then((r) => r);
  if (error) throw new CanonicalSnapshotError(table, error);
  return (data ?? []) as T[];
}

// ─── Carga ────────────────────────────────────────────────────────────────────

export async function loadCanonicalRegistrySnapshot(
  options: LoadSnapshotOptions
): Promise<CanonicalRegistrySnapshot> {
  const { supabase, lines, companyId } = options;
  const sizes = resolveChunkSizes(options.chunkSize);
  const defaultOrigin = options.defaultOrigin ?? null;

  if (companyId !== null) assertSafeFilterValue(companyId, "companyId");

  const stats: SnapshotStats = {
    distinctNorms: 0,
    distinctSourceRefs: 0,
    distinctCanonicalIds: 0,
    chunks: { aliasNorms: 0, sourceRefs: 0, canonicalIds: 0 },
    queries: { total: 0, byTable: {} },
    rows: { sources: 0, aliases: 0, concepts: 0 },
  };

  // ── 1-2. Textos normalizados distintos ──────────────────────────────────────
  // Se incluyen los de TODAS las líneas, también las de procedencia degradada.
  // Podar por procedencia sería aplicar aquí una regla que pertenece a la capa de
  // clasificación, y un superconjunto de más nunca cambia una resolución: de menos, sí.
  const norms = distinctSorted(
    lines.map((line) => canonicalNormalize(line.concept ?? "")).filter((n) => n !== "")
  );
  stats.distinctNorms = norms.length;

  // ── 3-4. source_ref válidos, con las MISMAS reglas que classifyBudgetItems ───
  // normalizeProvenance se reutiliza literalmente, no se reimplementa: si las reglas
  // cambian, cambian en un solo sitio y las dos capas siguen de acuerdo.
  const validRefs = distinctSorted(
    lines
      .map((line) => normalizeProvenance(line, defaultOrigin).sourceRef)
      .filter((ref): ref is string => ref !== null)
  );
  stats.distinctSourceRefs = validRefs.length;
  for (const ref of validRefs) assertSafeFilterValue(ref, "source_ref");

  // ── 5. Procedencias: una consulta, siempre ──────────────────────────────────
  const sources = await runQuery<CanonicalAliasSourceMeta>(
    supabase.from("canonical_alias_sources").select(SOURCE_SELECT),
    "canonical_alias_sources",
    stats
  );
  assertKnownSources(sources);
  stats.rows.sources = sources.length;

  // ── 6-8. Aliases por lotes ──────────────────────────────────────────────────
  const normChunks = chunk(norms, sizes.aliasNorms);
  // Un único grupo vacío significa "sólo aliases sin instancia documental".
  const refChunks = validRefs.length === 0 ? [[] as string[]] : chunk(validRefs, sizes.sourceRefs);
  stats.chunks.aliasNorms = normChunks.length;
  stats.chunks.sourceRefs = refChunks.length;

  const aliasById = new Map<string, CanonicalAlias>();

  for (const normChunk of normChunks) {
    for (const refChunk of refChunks) {
      let query = supabase
        .from("canonical_aliases")
        .select(ALIAS_SELECT)
        .in("alias_norm", normChunk);

      // ── 7. Tenant EXPLÍCITO. No se delega en la RLS: el backfill corre como
      // service_role y allí la RLS ni siquiera se evalúa.
      query =
        companyId === null
          ? query.is("company_id", null)
          : query.or(`company_id.is.null,company_id.eq.${companyId}`);

      // ── 8. Evidencia documental. Sin este filtro nos traeríamos el banco CYPE
      // entero para cada texto coincidente.
      query =
        refChunk.length === 0
          ? query.is("source_ref", null)
          : query.or(`source_ref.is.null,source_ref.in.(${refChunk.join(",")})`);

      const rows = await runQuery<CanonicalAlias>(query, "canonical_aliases", stats);

      // Los aliases con source_ref NULL vuelven en cada fragmento de refs: la
      // deduplicación por id es lo que hace que trocear no altere el resultado.
      for (const row of rows) aliasById.set(row.id, row);
    }
  }

  const aliases = [...aliasById.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  stats.rows.aliases = aliases.length;

  // ── 11. Aislamiento en memoria, sobre el snapshot completo ──────────────────
  // Se ejecuta aquí además de en cada findAliases del registry en memoria. Es la
  // única capa que corre pase lo que pase, incluido service_role.
  assertNoTenantLeak(aliases, companyId);

  // ── 9-10. Conceptos por lotes ───────────────────────────────────────────────
  const canonicalIds = distinctSorted(aliases.map((a) => a.canonical_id));
  stats.distinctCanonicalIds = canonicalIds.length;

  const idChunks = chunk(canonicalIds, sizes.canonicalIds);
  stats.chunks.canonicalIds = idChunks.length;

  const conceptById = new Map<string, CanonicalConcept>();
  for (const idChunk of idChunks) {
    const rows = await runQuery<CanonicalConcept>(
      supabase.from("canonical_concepts").select(CONCEPT_SELECT).in("canonical_id", idChunk),
      "canonical_concepts",
      stats
    );
    for (const row of rows) conceptById.set(row.canonical_id, row);
  }

  const concepts = [...conceptById.values()].sort((a, b) =>
    a.canonical_id < b.canonical_id ? -1 : a.canonical_id > b.canonical_id ? 1 : 0
  );
  stats.rows.concepts = concepts.length;

  // ── 12-13. Registry en memoria. Desde aquí, cero consultas ───────────────────
  // createInMemoryRegistry está declarado con la MISMA semántica de filtrado que el
  // de Supabase (registry.ts:231) y es contra el que corren los 25 tests del resolver.
  // No es una aproximación de laboratorio ascendida a producción: es la implementación
  // que la resolución lleva usando desde la Fase 2B.
  const registry = createInMemoryRegistry({ concepts, aliases, sources, relations: [] });

  return { registry, data: { sources, aliases, concepts }, stats };
}
