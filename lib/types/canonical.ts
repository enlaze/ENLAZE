/**
 * canonical.ts — Tipos cerrados del registro canónico (Fase 2B).
 *
 * Cada vocabulario de este archivo es la contrapartida en TypeScript de un CHECK
 * realmente aplicado en la base de datos. Si divergen, la base de datos gana: ella
 * rechaza la escritura y TypeScript no. Por eso al lado de cada constante queda
 * anotada la restricción de la que procede, para que una futura migración sepa qué
 * hay que tocar aquí.
 *
 * Regla de diseño: NO se repite un valor que pueda derivarse de otro. Las siete
 * procedencias "exact_*" no se escriben a mano, se derivan de ALIAS_SOURCES, porque
 * escribirlas dos veces es garantizar que algún día discrepen.
 *
 * Este archivo no accede a datos y no tiene lógica económica.
 */

// ─── Vocabularios cerrados ────────────────────────────────────────────────────

/** canonical_concepts_kind_check */
export const CANONICAL_KINDS = ["WORK", "MAT", "SRV"] as const;
export type CanonicalKind = (typeof CANONICAL_KINDS)[number];

/** ck_budget_items_canonical_status + matriz de ck_canonical_coherence */
export const CANONICAL_STATUSES = ["unmatched", "resolved", "review", "ambiguous"] as const;
export type CanonicalStatus = (typeof CANONICAL_STATUSES)[number];

/** canonical_aliases_alias_kind_check */
export const ALIAS_KINDS = ["exact", "synonym"] as const;
export type AliasKind = (typeof ALIAS_KINDS)[number];

/**
 * canonical_alias_sources.source. El ORDEN de este array no significa nada: la
 * precedencia real vive en canonical_alias_sources.general_rank y se lee de la base
 * de datos. Ordenar por posición en este array sería hardcodear la precedencia.
 */
export const ALIAS_SOURCES = ["manual", "curated", "engine", "import", "provider"] as const;
export type AliasSource = (typeof ALIAS_SOURCES)[number];

/** canonical_concept_relations_relation_type_check */
export const RELATION_TYPES = ["includes", "provides", "variant_of"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** ck_price_type_values / ck_budget_items_price_type */
export const PRICE_TYPES = [
  "LABOR_ONLY",
  "MATERIAL_ONLY",
  "LABOR_AND_MATERIAL",
  "SERVICE",
] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

/** canonical_concepts_status_check */
export const CONCEPT_STATUSES = ["active", "deprecated"] as const;
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];

/**
 * ck_budget_items_canonical_origin. De dónde viene el texto que se va a resolver.
 * No es lo mismo que AliasSource: 'free_text' y 'legacy' describen la procedencia de
 * la LÍNEA, no la de un alias, y por eso nunca aparecen en canonical_alias_sources.
 */
export const RESOLUTION_ORIGINS = [
  "engine",
  "import",
  "provider",
  "free_text",
  "legacy",
] as const;
export type ResolutionOrigin = (typeof RESOLUTION_ORIGINS)[number];

// ─── Procedencias del resultado (canonical_source) ────────────────────────────

/**
 * Derivadas, no escritas a mano. ck_budget_items_canonical_source acepta exactamente
 * 'exact_' + cada valor de canonical_alias_sources.source.
 */
export type ExactSource = `exact_${AliasSource}`;

export function exactSourceFor(source: AliasSource): ExactSource {
  return `exact_${source}`;
}

export const EXACT_SOURCES: readonly ExactSource[] = ALIAS_SOURCES.map(exactSourceFor);

/**
 * Procedencias que sólo puede producir una decisión humana o un override explícito.
 * El resolver de Fase 2B no las emite; se reservan para la corrección manual.
 */
export const HUMAN_SOURCES = ["override", "generator"] as const;
export type HumanSource = (typeof HUMAN_SOURCES)[number];

/**
 * Procedencias difusas. 'fingerprint' existe en el vocabulario de la base de datos
 * pero el resolver NO la emite (ver la nota de diseño en resolver.ts): una huella
 * numérica detecta coincidencia económica, no identidad semántica.
 */
export const FUZZY_SOURCES = ["synonym", "fingerprint"] as const;
export type FuzzySource = (typeof FUZZY_SOURCES)[number];

/** Las únicas procedencias admitidas por ck_canonical_coherence en 'resolved'. */
export type ResolvedSource = ExactSource | HumanSource;

/** Las únicas admitidas en 'ambiguous'. */
export type AmbiguousSource = ExactSource | FuzzySource;

export type CanonicalSource = ResolvedSource | FuzzySource;

// ─── Umbrales de confianza ────────────────────────────────────────────────────

/** ck_canonical_coherence exige exactamente 1.00 en 'resolved'. */
export const RESOLVED_CONFIDENCE = 1;

/** 'review' exige >= 0.50 y < 0.85. La franja [0.85, 1.00) está vacía por diseño. */
export const REVIEW_CONFIDENCE_MIN = 0.5;
export const REVIEW_CONFIDENCE_MAX_EXCLUSIVE = 0.85;

export function isReviewConfidence(value: number): boolean {
  return value >= REVIEW_CONFIDENCE_MIN && value < REVIEW_CONFIDENCE_MAX_EXCLUSIVE;
}

// ─── Códigos de error ─────────────────────────────────────────────────────────

export const CANONICAL_ERROR_CODES = [
  "DUPLICATE_CANONICAL_ID",
  "OVERLAPPING_CANONICAL_SCOPE",
  "MATERIAL_DOUBLE_IMPUTATION",
  "PRICE_TYPE_NOT_ALLOWED",
  "TENANT_LEAK",
] as const;
export type CanonicalErrorCode = (typeof CANONICAL_ERROR_CODES)[number];

export class CanonicalError extends Error {
  readonly code: CanonicalErrorCode;
  constructor(code: CanonicalErrorCode, message: string) {
    super(message);
    this.name = "CanonicalError";
    this.code = code;
  }
}

// ─── Filas del registro ───────────────────────────────────────────────────────

export interface CanonicalConcept {
  id: string;
  canonical_id: string;
  kind: CanonicalKind;
  domain: string;
  family: string;
  concept: string;
  variant: string | null;
  display_name_es: string;
  definition_es: string;
  default_unit: string;
  default_price_type: PriceType;
  allowed_price_types: PriceType[];
  status: ConceptStatus;
  superseded_by: string | null;
  version: number;
}

export interface CanonicalAlias {
  id: string;
  canonical_id: string;
  alias_kind: AliasKind;
  source: AliasSource;
  source_ref: string | null;
  company_id: string | null;
  alias_value: string;
  /** Columna GENERATED ALWAYS AS canonical_normalize(alias_value). Nunca se escribe. */
  alias_norm: string;
  confidence: number;
}

export interface CanonicalRelation {
  id: string;
  from_canonical: string;
  to_canonical: string;
  relation_type: RelationType;
  note_es: string | null;
}

export interface CanonicalAliasSourceMeta {
  source: AliasSource;
  /** Precedencia general congelada: manual 1 > curated 2 > engine 3 > import 4 > provider 5. */
  general_rank: number;
  /** Si true, sólo resuelve dentro de su propia procedencia en el nivel 1. */
  source_specific: boolean;
  /** Si true, un alias de esta procedencia exige source_ref (import, provider). */
  requires_source_ref: boolean;
  label_es: string;
}

// ─── Contexto y resultado del resolver ────────────────────────────────────────

export interface ResolverContext {
  company_id: string | null;
  origin: ResolutionOrigin;
  source_ref?: string | null;
}

/**
 * Unión discriminada que replica ck_canonical_coherence. Las combinaciones ilegales
 * en la base de datos son además inexpresables en TypeScript: no se puede construir
 * un 'ambiguous' con canonical_id, ni un 'resolved' con confianza distinta de 1.
 */
export type CanonicalResolution =
  | { status: "unmatched"; canonical_id: null; confidence: null; source: null }
  | {
      status: "resolved";
      canonical_id: string;
      confidence: typeof RESOLVED_CONFIDENCE;
      source: ResolvedSource;
    }
  | { status: "review"; canonical_id: string; confidence: number; source: FuzzySource }
  | { status: "ambiguous"; canonical_id: null; confidence: null; source: AmbiguousSource };

export const UNMATCHED: CanonicalResolution = Object.freeze({
  status: "unmatched",
  canonical_id: null,
  confidence: null,
  source: null,
});

// ─── Guardas ──────────────────────────────────────────────────────────────────

const has = <T extends readonly string[]>(list: T, v: unknown): v is T[number] =>
  typeof v === "string" && (list as readonly string[]).includes(v);

export const isCanonicalKind = (v: unknown): v is CanonicalKind => has(CANONICAL_KINDS, v);
export const isCanonicalStatus = (v: unknown): v is CanonicalStatus => has(CANONICAL_STATUSES, v);
export const isAliasKind = (v: unknown): v is AliasKind => has(ALIAS_KINDS, v);
export const isAliasSource = (v: unknown): v is AliasSource => has(ALIAS_SOURCES, v);
export const isResolutionOrigin = (v: unknown): v is ResolutionOrigin =>
  has(RESOLUTION_ORIGINS, v);
export const isPriceType = (v: unknown): v is PriceType => has(PRICE_TYPES, v);
export const isRelationType = (v: unknown): v is RelationType => has(RELATION_TYPES, v);

/**
 * Un ResolutionOrigin puede coincidir con una AliasSource ('engine', 'import',
 * 'provider') o no ('free_text', 'legacy'). Esta función es la única traducción
 * permitida entre ambos vocabularios.
 */
export function originAsAliasSource(origin: ResolutionOrigin): AliasSource | null {
  return isAliasSource(origin) ? origin : null;
}
