/**
 * resolver.ts — Decisión canónica (Fase 2B).
 *
 * Responde a una sola pregunta: dado un texto y un contexto, ¿qué concepto canónico es?
 * No lee de la red por su cuenta (todo entra por CanonicalRegistry), no escribe nada y no
 * conoce importes. La aritmética del presupuesto no aparece aquí ni debe aparecer.
 *
 * ═══ POR QUÉ 'fingerprint' NO ESTÁ EN ESTE ARCHIVO ═══════════════════════════════
 *
 * El vocabulario de la base de datos ADMITE 'fingerprint' como canonical_source (lo
 * comprobé en ck_budget_items_canonical_source, para 'review' y 'ambiguous'), así que
 * excluirlo no es una imposibilidad técnica sino una decisión, y por eso se justifica:
 *
 *   1. Una huella numérica establece COINCIDENCIA, no IDENTIDAD. El caso real que
 *      motivó toda la Fase 2 lo demuestra: 'Contenedor y transporte a gestor
 *      autorizado' y 'Contenedores y transporte' salen del generador con 6,00 ud ×
 *      717,50 € IDÉNTICOS, porque los emite la misma constante. Ahí los números no
 *      probaron que fueran el mismo concepto; lo probó el texto. La huella habría
 *      llegado a la conclusión correcta por el motivo equivocado.
 *
 *   2. El error inverso es peor y es frecuente. Dos partidas alzadas distintas
 *      calculadas como max(superficie × 1,6, 140) colisionan numéricamente sin tener
 *      nada que ver. Un canonical_id equivocado en estado 'review' es una identidad
 *      falsa que un humano tiene que REFUTAR; 'unmatched' es ignorancia honesta que un
 *      humano sólo tiene que completar. Ante la duda, el diseño congelado prefiere
 *      'review' o 'unmatched' antes que resolver mal.
 *
 *   3. La firma no encaja. El pseudocódigo congelado es fingerprint(input, presupuesto):
 *      necesita el presupuesto entero. Meterlo aquí haría que el resultado de una línea
 *      dependiese de sus vecinas, y el resolver dejaría de ser una función de la línea.
 *
 *   4. Lo que la huella detecta de verdad es DUPLICACIÓN, que es exactamente
 *      MATERIAL_DOUBLE_IMPUTATION: competencia de validators.ts, no de este archivo.
 *
 * Revisado además lib/normalized-concepts.ts, que ya hace emparejamiento difuso por
 * solapamiento de palabras con un empujón por categoría. Ese matcher es útil como ayuda
 * a un humano, pero su 'high_confidence' es una heurística, no una prueba de identidad,
 * y por eso tampoco se cablea aquí.
 *
 * Es una DESVIACIÓN CONSCIENTE respecto del diseño congelado v5, que sí lista
 * 'fingerprint' en la matriz de estados. No requiere migración: el valor sigue siendo
 * legal en la base de datos y queda disponible para validators.ts.
 */

import {
  RESOLVED_CONFIDENCE,
  UNMATCHED,
  exactSourceFor,
  isReviewConfidence,
  originAsAliasSource,
  type AliasKind,
  type AliasSource,
  type CanonicalAlias,
  type CanonicalAliasSourceMeta,
  type CanonicalResolution,
  type ResolverContext,
} from "../types/canonical";
import {
  assertKnownSources,
  assertNoTenantLeak,
  canonicalNormalize,
  type CanonicalRegistry,
} from "./registry";

// ─── Clase de tenant ──────────────────────────────────────────────────────────

/**
 * Segundo componente de la tupla de prioridad, después de general_rank.
 *
 * Privado gana a global: si una empresa ha curado su propio alias, sabe algo que el
 * vocabulario base de Enlaze no sabe. Menor es mejor, igual que general_rank, para que
 * la comparación de la tupla sea una sola regla y no dos con signos distintos.
 */
const TENANT_PRIVATE = 0;
const TENANT_GLOBAL = 1;

/**
 * Procedencias que la base de datos obliga a ser globales: ck_curated_is_global y
 * ck_engine_is_global. Se replica aquí porque el NIVEL 1 de 'engine' debe consultar
 * SÓLO aliases globales por decisión propia, no porque confíe en que la restricción
 * exista. Si mañana se relajase el CHECK, este resolver seguiría comportándose igual.
 */
const GLOBAL_ONLY_SOURCES: readonly AliasSource[] = Object.freeze(["curated", "engine"]);

// ─── Metadatos de procedencia ─────────────────────────────────────────────────

type SourceIndex = ReadonlyMap<AliasSource, CanonicalAliasSourceMeta>;

/**
 * Indexa canonical_alias_sources y comprueba lo único que este algoritmo da por hecho:
 * que general_rank identifica unívocamente a una procedencia. Si dos procedencias
 * compartieran rango, un empate en la prioridad ganadora podría contener dos
 * procedencias distintas y habría que elegir una por orden de consulta, que es
 * exactamente lo que el diseño congelado prohíbe. Mejor fallar aquí y en voz alta.
 */
function indexSources(sources: readonly CanonicalAliasSourceMeta[]): SourceIndex {
  assertKnownSources(sources);

  const byRank = new Map<number, AliasSource>();
  const index = new Map<AliasSource, CanonicalAliasSourceMeta>();

  for (const meta of sources) {
    const clash = byRank.get(meta.general_rank);
    if (clash !== undefined) {
      throw new Error(
        `canonical resolver: general_rank ${meta.general_rank} duplicado entre ` +
          `'${clash}' y '${meta.source}'. La precedencia dejaría de ser un orden total ` +
          `y un empate se resolvería por orden de consulta.`
      );
    }
    byRank.set(meta.general_rank, meta.source);
    index.set(meta.source, meta);
  }
  return index;
}

function metaFor(index: SourceIndex, source: AliasSource): CanonicalAliasSourceMeta {
  const meta = index.get(source);
  if (!meta) {
    throw new Error(
      `canonical resolver: la procedencia '${source}' no está en canonical_alias_sources.`
    );
  }
  return meta;
}

// ─── Candidatos y prioridad ───────────────────────────────────────────────────

interface Candidate {
  alias: CanonicalAlias;
  general_rank: number;
  tenant_class: number;
}

function toCandidate(alias: CanonicalAlias, index: SourceIndex): Candidate {
  return {
    alias,
    general_rank: metaFor(index, alias.source).general_rank,
    tenant_class: alias.company_id === null ? TENANT_GLOBAL : TENANT_PRIVATE,
  };
}

/**
 * Devuelve TODOS los candidatos que empatan en la mejor tupla (general_rank,
 * tenant_class). Devolver el conjunto y no un elemento es lo que hace posible detectar
 * el empate: quien devuelve "el mejor" ya ha roto el empate por orden sin darse cuenta.
 */
function winnersOf(candidates: readonly Candidate[]): Candidate[] {
  let bestRank = Number.POSITIVE_INFINITY;
  let bestTenant = Number.POSITIVE_INFINITY;

  for (const c of candidates) {
    if (c.general_rank < bestRank || (c.general_rank === bestRank && c.tenant_class < bestTenant)) {
      bestRank = c.general_rank;
      bestTenant = c.tenant_class;
    }
  }

  return candidates.filter((c) => c.general_rank === bestRank && c.tenant_class === bestTenant);
}

/** Conceptos distintos entre los ganadores, ordenados para que el mensaje sea estable. */
function distinctConcepts(winners: readonly Candidate[]): string[] {
  return [...new Set(winners.map((w) => w.alias.canonical_id))].sort();
}

/**
 * Todos los ganadores comparten general_rank, y indexSources garantiza que el rango
 * determina la procedencia. Esta función lo reafirma en tiempo de ejecución porque de
 * ella sale el canonical_source que se escribirá en budget_items.
 */
function winningSource(winners: readonly Candidate[]): AliasSource {
  const first = winners[0]!.alias.source;
  for (const w of winners) {
    if (w.alias.source !== first) {
      throw new Error(
        `canonical resolver: empate entre procedencias distintas ('${first}' y ` +
          `'${w.alias.source}') con el mismo general_rank.`
      );
    }
  }
  return first;
}

// ─── Decisiones ───────────────────────────────────────────────────────────────

/** EXACT: único → resolved 1.00. Empate entre conceptos → ambiguous. Nunca por orden. */
function decideExact(winners: readonly Candidate[]): CanonicalResolution | null {
  if (winners.length === 0) return null;

  const source = exactSourceFor(winningSource(winners));
  const ids = distinctConcepts(winners);

  if (ids.length === 1) {
    return {
      status: "resolved",
      canonical_id: ids[0]!,
      confidence: RESOLVED_CONFIDENCE,
      source,
    };
  }
  return { status: "ambiguous", canonical_id: null, confidence: null, source };
}

/**
 * SYNONYM: no puede producir 'resolved' NUNCA. Único → review con la confianza del
 * propio alias. Empate entre conceptos → ambiguous.
 *
 * Cuando varios aliases sinónimos ganadores apuntan al mismo concepto se toma la
 * confianza MÁXIMA: son evidencias independientes de lo mismo, y quedarse con la más
 * baja castigaría al concepto por tener más evidencia a favor.
 */
function decideSynonym(winners: readonly Candidate[]): CanonicalResolution | null {
  if (winners.length === 0) return null;

  const ids = distinctConcepts(winners);
  if (ids.length > 1) {
    return { status: "ambiguous", canonical_id: null, confidence: null, source: "synonym" };
  }

  const confidence = Math.max(...winners.map((w) => Number(w.alias.confidence)));
  return { status: "review", canonical_id: ids[0]!, confidence, source: "synonym" };
}

// ─── Consulta de un grupo ─────────────────────────────────────────────────────

interface SourceGroup {
  sources: readonly AliasSource[];
  /** null exige source_ref NULL; string exige coincidencia exacta. Nunca prefijo. */
  sourceRef: string | null;
}

async function gather(
  registry: CanonicalRegistry,
  groups: readonly SourceGroup[],
  norm: string,
  aliasKind: AliasKind,
  companyId: string | null,
  index: SourceIndex
): Promise<Candidate[]> {
  const out: Candidate[] = [];

  for (const group of groups) {
    if (group.sources.length === 0) continue;

    const rows = await registry.findAliases({
      norm,
      aliasKind,
      companyId,
      sources: group.sources,
      sourceRef: group.sourceRef,
    });

    // Tercera capa de aislamiento. La RLS es la primera y el predicado de la consulta
    // la segunda; ninguna de las dos protege al backfill, que corre como service_role.
    // Repetirla aquí es barato y es la única que se ejecuta pase lo que pase.
    assertNoTenantLeak(rows, companyId);

    for (const row of rows) out.push(toCandidate(row, index));
  }

  return out;
}

/**
 * Filtro de banda para sinónimos. ck_confidence_by_kind ya obliga a [0.50, 0.85) en la
 * base de datos, así que en producción no descarta nada. Existe para el caso en que los
 * datos entren por otra puerta (una restauración con restricciones desactivadas): un
 * sinónimo fuera de banda no puede escribirse como 'review' en budget_items, y una
 * evidencia que no se puede registrar no es evidencia.
 */
function withinReviewBand(candidates: readonly Candidate[]): Candidate[] {
  return candidates.filter((c) => isReviewConfidence(Number(c.alias.confidence)));
}

// ─── Algoritmo ────────────────────────────────────────────────────────────────

export async function resolveCanonical(
  rawText: string | null | undefined,
  context: ResolverContext,
  registry: CanonicalRegistry
): Promise<CanonicalResolution> {
  const norm = canonicalNormalize(rawText ?? "");
  if (norm === "") return UNMATCHED;

  const index = indexSources(await registry.listAliasSources());

  /**
   * Empresa efectiva. 'legacy' la anula: de una línea histórica no consta quién la
   * escribió ni con qué vocabulario, así que no puede beneficiarse de la curación
   * privada de nadie. Con NULL sólo alcanzan los aliases globales.
   */
  const effectiveCompanyId = context.origin === "legacy" ? null : context.company_id;
  const sourceRef = context.source_ref ?? null;
  const originSource = originAsAliasSource(context.origin);

  // ── NIVEL 1 — procedencia conocida ──────────────────────────────────────────
  // Sólo para orígenes que SON una procedencia de alias (engine, import, provider) y
  // que estén marcados source_specific en la base de datos. Se busca exclusivamente
  // dentro de esa procedencia: si la línea viene de CYPE, la respuesta está en CYPE.
  if (originSource !== null) {
    const meta = metaFor(index, originSource);
    const hasEvidence = !meta.requires_source_ref || sourceRef !== null;

    if (meta.source_specific && hasEvidence) {
      const decided = decideExact(
        winnersOf(
          await gather(
            registry,
            [
              {
                sources: [originSource],
                // Las procedencias que no exigen instancia la tienen prohibida
                // (ck_source_ref_presence), así que el filtro correcto es IS NULL.
                sourceRef: meta.requires_source_ref ? sourceRef : null,
              },
            ],
            norm,
            "exact",
            GLOBAL_ONLY_SOURCES.includes(originSource) ? null : effectiveCompanyId,
            index
          )
        )
      );
      if (decided) return decided;
    }
    // 'import'/'provider' sin source_ref NO caen a buscar por libre entre bancos: se
    // saltan el nivel 1 y siguen al nivel 2, donde tampoco participarán (ver abajo).
  }

  // ── NIVEL 2 — resolución general ────────────────────────────────────────────
  // Precedencia manual 1 > curated 2 > engine 3 > import 4 > provider 5 leída de
  // canonical_alias_sources.general_rank, nunca escrita a mano.
  //
  // Una procedencia que exige instancia documental (requires_source_ref) sólo entra si
  // el contexto aporta esa instancia, y entonces filtrada por ella exactamente. Sin esa
  // regla, una línea de CYPE acabaría resolviéndose con un alias de public_bc3 sólo
  // porque el texto coincide, que es precisamente lo que el nivel 1 evita.
  const groups: SourceGroup[] = [
    {
      sources: [...index.values()].filter((m) => !m.requires_source_ref).map((m) => m.source),
      sourceRef: null,
    },
  ];

  if (originSource !== null && metaFor(index, originSource).requires_source_ref && sourceRef !== null) {
    groups.push({ sources: [originSource], sourceRef });
  }

  const exactDecision = decideExact(
    winnersOf(await gather(registry, groups, norm, "exact", effectiveCompanyId, index))
  );
  if (exactDecision) return exactDecision;

  const synonymDecision = decideSynonym(
    winnersOf(
      withinReviewBand(await gather(registry, groups, norm, "synonym", effectiveCompanyId, index))
    )
  );
  if (synonymDecision) return synonymDecision;

  // ── UNMATCHED ───────────────────────────────────────────────────────────────
  // Sin evidencia suficiente. No se inventa nada: canonical_id NULL, confianza NULL y
  // procedencia NULL. Es el estado honesto, y en Fase 2 no bloquea nada.
  return UNMATCHED;
}
