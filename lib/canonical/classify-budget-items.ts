/**
 * classify-budget-items.ts — Capa PURA de clasificación canónica (Fase 2D, paso 1).
 *
 * Qué hace: recibe las líneas ya definitivas de un presupuesto, su procedencia y un
 * registry ya construido, y devuelve LAS MISMAS líneas con siete columnas añadidas.
 *
 * Qué NO hace, y es lo que la vuelve segura:
 *   - no habla con Supabase (recibe el registry, no lo crea);
 *   - no lee ni escribe React state;
 *   - no toca `quantity`, `unit_price`, `subtotal`, IVA, margen ni totales;
 *   - no añade, elimina ni reordena líneas;
 *   - no lee la hora ni genera aleatoriedad: la misma entrada da la misma salida.
 *
 * Sólo pueden aparecer o cambiar estas siete claves:
 *   canonical_id, canonical_status, canonical_confidence, canonical_source,
 *   canonical_origin, canonical_source_ref, price_type.
 *
 * FAIL-OPEN es un requisito, no una cortesía. Fase 2D no puede impedir guardar un
 * presupuesto. Si el registry no está disponible, si el resolver lanza para una línea
 * o si el concepto no se puede leer, la línea sale `unmatched` y el lote continúa.
 * Esta capa NUNCA lanza.
 */

import {
  assertKnownSources,
  canonicalNormalize,
  type AliasQuery,
  type CanonicalRegistry,
} from "./registry";
import { resolveCanonical } from "./resolver";
import {
  UNMATCHED,
  isResolutionOrigin,
  type CanonicalAlias,
  type CanonicalAliasSourceMeta,
  type CanonicalConcept,
  type CanonicalRelation,
  type CanonicalResolution,
  type PriceType,
  type ResolutionOrigin,
} from "../types/canonical";

// ─── Contrato de salida ───────────────────────────────────────────────────────

export type CanonicalStatus = CanonicalResolution["status"];

/**
 * Las siete columnas de `budget_items` que introduce la Fase 2. Los nombres son
 * literalmente los de la tabla: esta interfaz es el contrato con la migración
 * 20260824121231_budget_items_canonical.sql, no una representación intermedia.
 */
export interface CanonicalColumns {
  canonical_id: string | null;
  canonical_status: CanonicalStatus;
  canonical_confidence: number | null;
  canonical_source: CanonicalResolution["source"];
  canonical_origin: ResolutionOrigin | null;
  canonical_source_ref: string | null;
  price_type: PriceType | null;
}

/** Las siete claves, en un solo sitio, para que los tests puedan auditarlas. */
export const CANONICAL_COLUMN_KEYS = [
  "canonical_id",
  "canonical_status",
  "canonical_confidence",
  "canonical_source",
  "canonical_origin",
  "canonical_source_ref",
  "price_type",
] as const satisfies readonly (keyof CanonicalColumns)[];

/**
 * Procedencia que viaja DENTRO de la línea desde su nacimiento.
 *
 * `canonical_origin` afirma de dónde nació la LÍNEA. No confundir con `price_source`,
 * que afirma de dónde salió el PRECIO y se sobrescribe varias veces durante la
 * generación. Son preguntas distintas y nunca se derivan la una de la otra.
 */
export interface LineProvenance {
  canonical_origin?: ResolutionOrigin | null;
  canonical_source_ref?: string | null;
}

/** Lo mínimo que esta capa necesita leer de una línea: su texto. Nada económico. */
export interface ClassifiableLine extends LineProvenance {
  concept: string;
}

export interface ClassifyOptions {
  /** Empresa efectiva para el aislamiento de tenant. null = sólo aliases globales. */
  companyId: string | null;
  /**
   * Procedencia para las líneas que aún no la llevan grabada. Mientras el wiring no
   * exista, la mayoría de las líneas históricas llegarán sin ella.
   */
  defaultOrigin?: ResolutionOrigin;
}

export interface ClassifyStats {
  /** Llamadas reales al registry envuelto. La prueba del N+1 se lee aquí. */
  listAliasSources: number;
  findAliases: number;
  getConceptByCanonicalId: number;
  /** Resoluciones efectivamente ejecutadas tras deduplicar. */
  resolutions: number;
  /** Líneas cuya resolución lanzó y se degradó a `unmatched`. */
  failedLines: number;
  /** true si el registry no se pudo inicializar y TODO el lote salió `unmatched`. */
  registryUnavailable: boolean;
}

export interface ClassifyResult<T> {
  lines: (T & CanonicalColumns)[];
  stats: ClassifyStats;
}

// ─── Coherencia de procedencia con las restricciones de la tabla ──────────────

/** ck_budget_items_source_ref_format */
const SOURCE_REF_FORMAT = /^[a-z0-9][a-z0-9_-]*$/;

/** ck_origin_source_ref: estas procedencias EXIGEN instancia documental. */
const ORIGINS_REQUIRING_SOURCE_REF: readonly ResolutionOrigin[] = ["import", "provider"];

interface NormalizedProvenance {
  origin: ResolutionOrigin | null;
  sourceRef: string | null;
}

/**
 * Normaliza la procedencia declarada por la línea a una pareja que Postgres aceptaría.
 *
 * Las dos reglas son ASIMÉTRICAS a propósito, porque los dos defectos son distintos:
 *
 *   engine / ai / free_text / legacy con un source_ref inesperado
 *     → el origen es válido y la clasificación sigue siendo posible. El source_ref
 *       sobra (`ck_origin_source_ref` lo prohíbe), así que se descarta y punto. La
 *       línea se clasifica con normalidad. En particular NO se degrada el origen: un
 *       campo de más no desmiente dónde nació la línea, y castigar con `unmatched`
 *       una procedencia correcta por un adorno sobrante sería perder información
 *       buena por culpa de información irrelevante.
 *
 *   import / provider sin source_ref o con formato inválido
 *     → el origen es INUTILIZABLE. El nivel 1 del resolver no tiene banco concreto
 *       donde buscar, y el nivel 2 excluye a las procedencias que exigen instancia
 *       documental cuando no la hay. Además `ck_origin_source_ref` rechazaría la fila.
 *       Se degrada a (NULL, NULL) y la línea sale `unmatched`.
 *
 * En ningún caso se lanza: la Fase 2D observa, no bloquea.
 */
export function normalizeProvenance(
  line: LineProvenance,
  defaultOrigin: ResolutionOrigin | null
): NormalizedProvenance {
  const declared = line.canonical_origin ?? defaultOrigin ?? null;
  if (declared === null || !isResolutionOrigin(declared)) {
    return { origin: null, sourceRef: null };
  }

  const rawRef = line.canonical_source_ref ?? null;

  if (ORIGINS_REQUIRING_SOURCE_REF.includes(declared)) {
    if (rawRef === null || !SOURCE_REF_FORMAT.test(rawRef)) {
      return { origin: null, sourceRef: null };
    }
    return { origin: declared, sourceRef: rawRef };
  }

  // engine / ai / free_text / legacy: la instancia documental está PROHIBIDA por la
  // tabla. 'ai' cae aquí sin necesidad de una rama propia, y es lo correcto: una
  // propuesta del modelo no procede de ningún banco ni tarifa que pueda citarse.
  return { origin: declared, sourceRef: null };
}

// ─── Registry memoizador ──────────────────────────────────────────────────────

/**
 * Clave determinista de una consulta de aliases.
 *
 * `sources` se ordena SÓLO para construir la clave: el orden del array no cambia el
 * conjunto consultado, así que dos peticiones con el mismo conjunto deben compartir
 * caché. `undefined` y `null` se codifican distinto a propósito, porque en AliasQuery
 * significan cosas distintas (sin filtro vs. exige NULL).
 */
function aliasQueryKey(query: AliasQuery): string {
  const sources = query.sources === undefined ? "*" : [...query.sources].sort().join(",");
  const ref =
    query.sourceRef === undefined ? "*" : query.sourceRef === null ? "\u0000null" : query.sourceRef;
  return [query.norm, query.aliasKind, query.companyId ?? "\u0000null", sources, ref].join("\u0001");
}

export interface MemoizingRegistry {
  registry: CanonicalRegistry;
  stats: Pick<ClassifyStats, "listAliasSources" | "findAliases" | "getConceptByCanonicalId">;
}

/**
 * Envuelve un registry para que un presupuesto entero se clasifique con UNA carga.
 *
 * Sin esto, `resolveCanonical` pide `listAliasSources()` en cada llamada (resolver.ts,
 * primera línea del algoritmo). Con 59 líneas eso son 59 lecturas de una tabla de 5
 * filas que no cambia durante el lote, más las repeticiones de `findAliases` para
 * conceptos con el mismo texto normalizado.
 *
 * Se cachea la PROMESA, no el valor: dos líneas que resuelven en paralelo comparten el
 * mismo viaje en vez de disparar dos. Una promesa rechazada también queda cacheada, y
 * es correcto: si el registry no responde, no tiene sentido reintentar 59 veces dentro
 * del mismo guardado.
 */
export function createMemoizingRegistry(inner: CanonicalRegistry): MemoizingRegistry {
  const stats = { listAliasSources: 0, findAliases: 0, getConceptByCanonicalId: 0 };

  let sourcesPromise: Promise<CanonicalAliasSourceMeta[]> | null = null;
  const aliasCache = new Map<string, Promise<CanonicalAlias[]>>();
  const conceptCache = new Map<string, Promise<CanonicalConcept | null>>();
  const relationCache = new Map<string, Promise<CanonicalRelation[]>>();

  const registry: CanonicalRegistry = {
    listAliasSources() {
      if (sourcesPromise === null) {
        stats.listAliasSources += 1;
        sourcesPromise = inner.listAliasSources();
      }
      return sourcesPromise;
    },

    findAliases(query) {
      const key = aliasQueryKey(query);
      const hit = aliasCache.get(key);
      if (hit !== undefined) return hit;
      stats.findAliases += 1;
      const promise = inner.findAliases(query);
      aliasCache.set(key, promise);
      return promise;
    },

    getConceptByCanonicalId(canonicalId) {
      const hit = conceptCache.get(canonicalId);
      if (hit !== undefined) return hit;
      stats.getConceptByCanonicalId += 1;
      const promise = inner.getConceptByCanonicalId(canonicalId);
      conceptCache.set(canonicalId, promise);
      return promise;
    },

    getConceptById(id) {
      return inner.getConceptById(id);
    },

    listRelations(canonicalId) {
      const hit = relationCache.get(canonicalId);
      if (hit !== undefined) return hit;
      const promise = inner.listRelations(canonicalId);
      relationCache.set(canonicalId, promise);
      return promise;
    },
  };

  return { registry, stats };
}

// ─── price_type ───────────────────────────────────────────────────────────────

/**
 * Deriva `price_type` del contrato canónico, y SÓLO de él.
 *
 * Regla completa:
 *   resolved  + exactamente 1 allowed_price_type → ese valor
 *   resolved  + más de 1 allowed_price_type      → NULL
 *   review                                        → NULL
 *   ambiguous                                     → NULL
 *   unmatched                                     → NULL
 *
 * Que `review` no reciba price_type es una decisión, no un descuido. Un vínculo en
 * revisión es una hipótesis pendiente de que alguien la confirme; escribir price_type
 * a partir de ella metería en la línea un dato firme derivado de una premisa que
 * todavía no lo es. Si la revisión acaba rechazando el concepto, el price_type habría
 * sido falso todo ese tiempo y nadie lo habría sabido.
 *
 * `default_price_type` NO se usa: es una sugerencia para quien redacta, no un hecho
 * sobre la línea, y escribirlo aquí convertiría una preferencia en un dato.
 *
 * `cost_breakdown.price_type` tampoco se usa NUNCA, pese al nombre idéntico. Aquél es
 * un enum de calidad del precio ('real' | 'market_ref' | 'estimated') que vive en
 * lib/budget-engine.ts y no tiene ninguna relación con el enum canónico
 * ('LABOR_ONLY' | 'MATERIAL_ONLY' | 'LABOR_AND_MATERIAL' | 'SERVICE'). Es la colisión
 * de nombres más peligrosa de esta fase.
 */
function derivePriceType(concept: CanonicalConcept | null): PriceType | null {
  if (concept === null) return null;
  const allowed = concept.allowed_price_types;
  if (!Array.isArray(allowed) || allowed.length !== 1) return null;
  return allowed[0] ?? null;
}

// ─── Clasificación ────────────────────────────────────────────────────────────

/** Fila unmatched canónica. Se construye por línea para no compartir referencias. */
function unmatchedColumns(provenance: NormalizedProvenance): CanonicalColumns {
  return {
    canonical_id: UNMATCHED.canonical_id,
    canonical_status: UNMATCHED.status,
    canonical_confidence: UNMATCHED.confidence,
    canonical_source: UNMATCHED.source,
    canonical_origin: provenance.origin,
    canonical_source_ref: provenance.sourceRef,
    price_type: null,
  };
}

/**
 * Clasifica un lote de líneas.
 *
 * Garantías comprobadas por los tests:
 *   - misma longitud y mismo orden que la entrada;
 *   - todas las claves preexistentes conservan su valor exacto, salvo las siete
 *     canónicas;
 *   - nunca lanza.
 */
export async function classifyBudgetItems<T extends ClassifiableLine>(
  lines: readonly T[],
  registry: CanonicalRegistry,
  options: ClassifyOptions
): Promise<ClassifyResult<T>> {
  const defaultOrigin = options.defaultOrigin ?? null;
  const memo = createMemoizingRegistry(registry);

  const stats: ClassifyStats = {
    listAliasSources: 0,
    findAliases: 0,
    getConceptByCanonicalId: 0,
    resolutions: 0,
    failedLines: 0,
    registryUnavailable: false,
  };

  // Procedencia primero: es pura y no depende del registry, así que se conserva
  // intacta aunque después no haya vocabulario contra el que clasificar.
  const provenances = lines.map((line) => normalizeProvenance(line, defaultOrigin));

  // Carga única del contrato de procedencias. Es también el punto donde se decide si
  // el registry es utilizable: una sola comprobación para todo el lote.
  let registryUsable = true;
  try {
    assertKnownSources(await memo.registry.listAliasSources());
  } catch {
    registryUsable = false;
    stats.registryUnavailable = true;
  }

  if (!registryUsable) {
    Object.assign(stats, memo.stats);
    return {
      lines: lines.map((line, i) => ({ ...line, ...unmatchedColumns(provenances[i]!) })),
      stats,
    };
  }

  /**
   * Deduplicación. Dos líneas con el mismo texto normalizado, la misma procedencia y
   * la misma empresa tienen por fuerza la misma resolución: el resolver es una función
   * de esos cuatro valores. Un presupuesto de reforma repite mucho ("ayudas de
   * albañilería", "retirada de escombros"), así que esto no es un caso de laboratorio.
   */
  const resolutionByKey = new Map<string, CanonicalResolution>();
  const resolved: CanonicalResolution[] = new Array(lines.length);

  for (let i = 0; i < lines.length; i += 1) {
    const provenance = provenances[i]!;
    if (provenance.origin === null) {
      resolved[i] = UNMATCHED;
      continue;
    }

    const norm = canonicalNormalize(lines[i]!.concept ?? "");
    if (norm === "") {
      resolved[i] = UNMATCHED;
      continue;
    }

    const key = [norm, provenance.origin, provenance.sourceRef ?? "\u0000null", options.companyId ?? "\u0000null"].join(
      "\u0001"
    );

    const cached = resolutionByKey.get(key);
    if (cached !== undefined) {
      resolved[i] = cached;
      continue;
    }

    let resolution: CanonicalResolution;
    try {
      stats.resolutions += 1;
      resolution = await resolveCanonical(
        lines[i]!.concept,
        {
          company_id: options.companyId,
          origin: provenance.origin,
          source_ref: provenance.sourceRef,
        },
        memo.registry
      );
    } catch {
      // FAIL-OPEN por línea: el fallo de una no puede llevarse por delante al lote.
      stats.failedLines += 1;
      resolution = UNMATCHED;
    }

    resolutionByKey.set(key, resolution);
    resolved[i] = resolution;
  }

  // price_type: una lectura por canonical_id distinto, cacheada por el memoizador.
  // Sólo se leen los conceptos de líneas 'resolved': para 'review' el price_type es
  // NULL por regla, así que consultar su concepto sería trabajo tirado.
  const priceTypeById = new Map<string, PriceType | null>();
  for (const resolution of resolved) {
    if (resolution.status !== "resolved") continue;
    const id = resolution.canonical_id;
    if (id === null || priceTypeById.has(id)) continue;
    try {
      priceTypeById.set(id, derivePriceType(await memo.registry.getConceptByCanonicalId(id)));
    } catch {
      priceTypeById.set(id, null); // FAIL-OPEN: sin concepto legible, sin price_type.
    }
  }

  const out = lines.map((line, i) => {
    const provenance = provenances[i]!;
    const resolution = resolved[i]!;
    const columns: CanonicalColumns = {
      canonical_id: resolution.canonical_id,
      canonical_status: resolution.status,
      canonical_confidence: resolution.confidence,
      canonical_source: resolution.source,
      canonical_origin: provenance.origin,
      canonical_source_ref: provenance.sourceRef,
      price_type:
        resolution.status === "resolved" && resolution.canonical_id !== null
          ? priceTypeById.get(resolution.canonical_id) ?? null
          : null,
    };
    return { ...line, ...columns };
  });

  Object.assign(stats, memo.stats);
  return { lines: out, stats };
}
