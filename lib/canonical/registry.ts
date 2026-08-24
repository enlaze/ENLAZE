/**
 * registry.ts — Capa de LECTURA del vocabulario canónico (Fase 2B).
 *
 * Responsabilidad única: traer filas. Aquí no se decide nada. No hay umbrales, no hay
 * precedencia aplicada, no hay lógica económica y no se escribe jamás. La decisión vive
 * en resolver.ts; si algún día alguien mete un `if (confidence > ...)` en este archivo,
 * está en el archivo equivocado.
 *
 * El registry es una INTERFAZ, no una clase atada a Supabase. Esto permite que el
 * resolver se pruebe con datos en memoria (los del seed real) sin tocar la red ni la
 * base de datos, que es justo lo que exige una fase donde no se puede escribir nada.
 */

import {
  ALIAS_SOURCES,
  CanonicalError,
  type AliasKind,
  type AliasSource,
  type CanonicalAlias,
  type CanonicalAliasSourceMeta,
  type CanonicalConcept,
  type CanonicalRelation,
} from "../types/canonical";

// ─── Normalización ────────────────────────────────────────────────────────────

/**
 * Réplica EXACTA de la función SQL public.canonical_normalize.
 *
 * Esto no es una utilidad de conveniencia: `canonical_aliases.alias_norm` es una
 * columna GENERATED ALWAYS AS canonical_normalize(alias_value). Para buscar un alias
 * hay que producir byte a byte la misma cadena que generó Postgres. Si esta función
 * y la SQL divergen, el resolver deja de encontrar aliases y todo cae a 'unmatched'
 * en silencio, que es el peor modo de fallo posible: sin error y sin resultado.
 *
 * Definición SQL replicada:
 *   btrim(regexp_replace(regexp_replace(
 *     lower(translate(txt, '<acentos>', '<sin acentos>')),
 *     '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
 *
 * NO se reutiliza `normalizeForMatching` de lib/normalized-concepts.ts, y es
 * deliberado: aquella borra el CONTENIDO de los paréntesis y conserva el guion bajo
 * (usa \w). Ésta no borra paréntesis y convierte el guion bajo en espacio. Son
 * funciones distintas para propósitos distintos; confundirlas produciría fallos de
 * coincidencia difíciles de rastrear.
 */
const ACCENTS_FROM = "áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ";
const ACCENTS_TO = "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC";

const TRANSLATE_MAP: ReadonlyMap<string, string> = new Map(
  Array.from(ACCENTS_FROM).map((ch, i) => [ch, ACCENTS_TO[i]!])
);

export function canonicalNormalize(text: string): string {
  let translated = "";
  for (const ch of text) translated += TRANSLATE_MAP.get(ch) ?? ch;

  return translated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Aislamiento de tenant ────────────────────────────────────────────────────

/**
 * Tercera capa de aislamiento, la que se ejecuta en memoria.
 *
 * Las otras dos son la RLS y el predicado explícito de cada consulta. Esta existe
 * porque el backfill corre como `service_role`, que SALTA la RLS por completo: si el
 * predicato de la consulta tuviera un fallo, no quedaría ninguna red debajo. Que la
 * aserción lance en vez de filtrar es intencionado: una fila de otra empresa en el
 * resultado no es un dato que descartar, es la prueba de un fallo de aislamiento que
 * debe interrumpir el proceso y hacerse visible.
 */
export function assertNoTenantLeak(
  rows: readonly { company_id: string | null }[],
  effectiveCompanyId: string | null
): void {
  for (const row of rows) {
    if (row.company_id === null) continue; // alias global: legítimo para todos
    if (row.company_id === effectiveCompanyId) continue;
    throw new CanonicalError(
      "TENANT_LEAK",
      `Alias con company_id ajeno (${row.company_id}) en un contexto de empresa ` +
        `${effectiveCompanyId ?? "NULL"}. La consulta no filtró por tenant o la RLS ` +
        `fue omitida (service_role).`
    );
  }
}

// ─── Interfaz ─────────────────────────────────────────────────────────────────

export interface AliasQuery {
  /** Texto YA normalizado con canonicalNormalize. */
  norm: string;
  aliasKind: AliasKind;
  /** Empresa efectiva. null = sólo aliases globales. */
  companyId: string | null;
  /** Procedencias admitidas. undefined = todas. */
  sources?: readonly AliasSource[];
  /**
   * undefined = sin filtro. null = exige source_ref NULL. string = coincidencia
   * EXACTA. Nunca se interpreta como prefijo ni como patrón.
   */
  sourceRef?: string | null;
}

export interface CanonicalRegistry {
  getConceptByCanonicalId(canonicalId: string): Promise<CanonicalConcept | null>;
  getConceptById(id: string): Promise<CanonicalConcept | null>;
  findAliases(query: AliasQuery): Promise<CanonicalAlias[]>;
  listAliasSources(): Promise<CanonicalAliasSourceMeta[]>;
  listRelations(canonicalId: string): Promise<CanonicalRelation[]>;
}

// ─── Implementación sobre Supabase ────────────────────────────────────────────

/** Superficie mínima del cliente que realmente se usa. Facilita el doblado en tests. */
type QueryBuilder = {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  is: (column: string, value: null) => QueryBuilder;
  in: (column: string, values: readonly unknown[]) => QueryBuilder;
  or: (filter: string) => QueryBuilder;
  limit: (n: number) => QueryBuilder;
  then: <R>(onfulfilled: (r: { data: unknown; error: unknown }) => R) => Promise<R>;
};

export type MinimalSupabaseClient = { from: (table: string) => QueryBuilder };

const CONCEPT_COLUMNS =
  "id, canonical_id, kind, domain, family, concept, variant, display_name_es, " +
  "definition_es, default_unit, default_price_type, allowed_price_types, status, " +
  "superseded_by, version";

const ALIAS_COLUMNS =
  "id, canonical_id, alias_kind, source, source_ref, company_id, alias_value, " +
  "alias_norm, confidence";

async function run<T>(builder: QueryBuilder, context: string): Promise<T[]> {
  const { data, error } = await builder.then((r) => r);
  if (error) {
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
    throw new Error(`canonical registry: fallo leyendo ${context}: ${message}`);
  }
  return (data ?? []) as T[];
}

export function createSupabaseRegistry(client: MinimalSupabaseClient): CanonicalRegistry {
  return {
    async getConceptByCanonicalId(canonicalId) {
      const rows = await run<CanonicalConcept>(
        client.from("canonical_concepts").select(CONCEPT_COLUMNS).eq("canonical_id", canonicalId).limit(1),
        "canonical_concepts por canonical_id"
      );
      return rows[0] ?? null;
    },

    async getConceptById(id) {
      const rows = await run<CanonicalConcept>(
        client.from("canonical_concepts").select(CONCEPT_COLUMNS).eq("id", id).limit(1),
        "canonical_concepts por id"
      );
      return rows[0] ?? null;
    },

    async findAliases(query) {
      let q = client
        .from("canonical_aliases")
        .select(ALIAS_COLUMNS)
        .eq("alias_norm", query.norm)
        .eq("alias_kind", query.aliasKind);

      if (query.sources && query.sources.length > 0) {
        q = q.in("source", query.sources as readonly string[]);
      }

      if (query.sourceRef !== undefined) {
        q = query.sourceRef === null ? q.is("source_ref", null) : q.eq("source_ref", query.sourceRef);
      }

      // Predicado EXPLÍCITO de tenant. No se delega en la RLS: el backfill corre como
      // service_role y la RLS no se evalúa siquiera.
      q =
        query.companyId === null
          ? q.is("company_id", null)
          : q.or(`company_id.is.null,company_id.eq.${query.companyId}`);

      const rows = await run<CanonicalAlias>(q, "canonical_aliases");
      assertNoTenantLeak(rows, query.companyId);
      return rows;
    },

    async listAliasSources() {
      const rows = await run<CanonicalAliasSourceMeta>(
        client
          .from("canonical_alias_sources")
          .select("source, general_rank, source_specific, requires_source_ref, label_es"),
        "canonical_alias_sources"
      );
      return rows;
    },

    async listRelations(canonicalId) {
      return run<CanonicalRelation>(
        client
          .from("canonical_concept_relations")
          .select("id, from_canonical, to_canonical, relation_type, note_es")
          .eq("from_canonical", canonicalId),
        "canonical_concept_relations"
      );
    },
  };
}

// ─── Implementación en memoria (tests y backfill en seco) ─────────────────────

export interface InMemoryData {
  concepts?: readonly CanonicalConcept[];
  aliases?: readonly CanonicalAlias[];
  relations?: readonly CanonicalRelation[];
  sources?: readonly CanonicalAliasSourceMeta[];
}

/**
 * Registry en memoria con la MISMA semántica de filtrado que el de Supabase.
 *
 * `leaky` existe para un solo propósito: simular el escenario `service_role`, donde la
 * RLS no filtra y un fallo en el predicado devolvería filas de otra empresa. Con
 * leaky=true este registry omite a propósito el filtro de tenant, de modo que el test
 * pueda comprobar que la aserción en memoria del resolver sigue atrapando la fuga.
 */
export function createInMemoryRegistry(
  data: InMemoryData,
  options: { leaky?: boolean } = {}
): CanonicalRegistry {
  const concepts = data.concepts ?? [];
  const aliases = data.aliases ?? [];
  const relations = data.relations ?? [];
  const sources = data.sources ?? [];
  const leaky = options.leaky === true;

  return {
    async getConceptByCanonicalId(canonicalId) {
      return concepts.find((c) => c.canonical_id === canonicalId) ?? null;
    },

    async getConceptById(id) {
      return concepts.find((c) => c.id === id) ?? null;
    },

    async findAliases(query) {
      const rows = aliases.filter((a) => {
        if (a.alias_norm !== query.norm) return false;
        if (a.alias_kind !== query.aliasKind) return false;
        if (query.sources && query.sources.length > 0 && !query.sources.includes(a.source)) {
          return false;
        }
        if (query.sourceRef !== undefined && a.source_ref !== query.sourceRef) return false;
        if (leaky) return true; // sin filtro de tenant, a propósito
        return a.company_id === null || a.company_id === query.companyId;
      });

      if (!leaky) assertNoTenantLeak(rows, query.companyId);
      return rows;
    },

    async listAliasSources() {
      return sources.length > 0 ? [...sources] : [...DEFAULT_ALIAS_SOURCES];
    },

    async listRelations(canonicalId) {
      return relations.filter((r) => r.from_canonical === canonicalId);
    },
  };
}

/**
 * Copia literal de las 5 filas de canonical_alias_sources. Sólo se usa cuando un
 * registry en memoria no recibe procedencias explícitas. El código de producción
 * SIEMPRE las lee de la base de datos: la precedencia es un dato, no una constante.
 */
export const DEFAULT_ALIAS_SOURCES: readonly CanonicalAliasSourceMeta[] = Object.freeze([
  { source: "manual", general_rank: 1, source_specific: false, requires_source_ref: false, label_es: "Curación manual de la empresa" },
  { source: "curated", general_rank: 2, source_specific: false, requires_source_ref: false, label_es: "Vocabulario base de Enlaze" },
  { source: "engine", general_rank: 3, source_specific: true, requires_source_ref: false, label_es: "Literal del generador" },
  { source: "import", general_rank: 4, source_specific: true, requires_source_ref: true, label_es: "Importación BC3 / CYPE / banco técnico" },
  { source: "provider", general_rank: 5, source_specific: true, requires_source_ref: true, label_es: "Nomenclatura comercial de proveedor" },
]);

/** Comprobación de coherencia: el vocabulario de tipos y el de datos no pueden divergir. */
export function assertKnownSources(sources: readonly CanonicalAliasSourceMeta[]): void {
  for (const s of sources) {
    if (!(ALIAS_SOURCES as readonly string[]).includes(s.source)) {
      throw new Error(
        `canonical registry: procedencia desconocida '${s.source}'. ` +
          `lib/types/canonical.ts está desactualizado respecto a canonical_alias_sources.`
      );
    }
  }
}
