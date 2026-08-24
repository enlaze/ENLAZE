/**
 * types.ts — Contrato de la validación canónica (Fase 2C).
 *
 * MODO OBSERVADOR. Nada de lo que se define aquí bloquea un presupuesto, corrige una
 * línea ni toca un importe. Una incidencia es una AFIRMACIÓN sobre lo que se ha
 * encontrado, acompañada de la evidencia que la sostiene, para que un humano decida.
 * Por eso `ValidationFinding` no tiene ningún campo de acción ni de corrección: si
 * algún día alguien añade aquí un `fix` o un `suggested_quantity`, habrá cambiado la
 * naturaleza de la fase sin querer.
 *
 * DOS VOCABULARIOS DISTINTOS QUE NO HAY QUE CONFUNDIR:
 *   · CANONICAL_ERROR_CODES (lib/types/canonical.ts) son códigos de EXCEPCIÓN: fallos
 *     de programa o de aislamiento, como TENANT_LEAK. Se lanzan y detienen el proceso.
 *   · FINDING_CODES (este archivo) son códigos de INCIDENCIA DE NEGOCIO: se devuelven,
 *     nunca se lanzan. Un presupuesto con dos contenedores cobrados es un dato normal
 *     del mundo, no un error de programación.
 *
 * Se llama DUPLICATE_CANONICAL y no DUPLICATE_CANONICAL_ID precisamente para que no se
 * mezcle con el código homónimo de excepción, que habla del registro de conceptos y no
 * de un presupuesto concreto.
 */

import type {
  CanonicalConcept,
  CanonicalRelation,
  CanonicalStatus,
  PriceType,
} from "../types/canonical";

// ─── Severidad ────────────────────────────────────────────────────────────────

/**
 * error   -> hay un cobro que muy probablemente esté mal y cuesta dinero al cliente.
 * warning -> hay un solapamiento real pero la identidad o el price_type no están
 *            confirmados; hace falta un humano para afirmarlo.
 * info    -> señal, sospecha o dato de contexto. Nunca es una acusación.
 *
 * En Fase 2 NINGUNA de las tres bloquea. La severidad ordena la atención humana, no
 * el comportamiento del sistema.
 */
export const FINDING_SEVERITIES = ["error", "warning", "info"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

// ─── Códigos ──────────────────────────────────────────────────────────────────

/**
 * El orden de esta lista ES el orden de presentación de las incidencias. Va de lo más
 * caro a lo más especulativo, no alfabético.
 */
export const FINDING_CODES = [
  /** Dos líneas económicas distintas del mismo presupuesto con el mismo canonical_id. */
  "DUPLICATE_CANONICAL",
  /** Un concepto agregado y un componente suyo, ambos cobrados en el mismo presupuesto. */
  "OVERLAPPING_CANONICAL_SCOPE",
  /** Una partida que ya lleva el material dentro, y el material otra vez como línea. */
  "MATERIAL_DOUBLE_IMPUTATION",
  /** price_type de la línea fuera de allowed_price_types del concepto. */
  "PRICE_TYPE_NOT_ALLOWED",
  /** Misma huella económica en líneas que NO comparten canonical_id. Sólo sospecha. */
  "ECONOMIC_FINGERPRINT_COLLISION",
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

export function isFindingCode(value: string): value is FindingCode {
  return (FINDING_CODES as readonly string[]).includes(value);
}

// ─── Evidencia ────────────────────────────────────────────────────────────────

/**
 * La evidencia es un valor plano y serializable, no un objeto vivo. Tiene que poder
 * guardarse en un JSONB, mandarse por API y leerse dentro de seis meses sin el código
 * al lado. Nada de funciones, fechas ni referencias a filas.
 */
export type EvidenceValue =
  | string
  | number
  | boolean
  | null
  | readonly EvidenceValue[]
  | { readonly [key: string]: EvidenceValue };

export type FindingEvidence = { readonly [key: string]: EvidenceValue };

// ─── Incidencia ───────────────────────────────────────────────────────────────

export interface ValidationFinding {
  code: FindingCode;
  severity: FindingSeverity;
  /** Mensaje en español, dirigido a una persona, con las cifras dentro. */
  message: string;
  /** Conceptos implicados. Ordenados y sin repetir; nunca en orden de llegada. */
  canonical_ids: readonly string[];
  /** Líneas implicadas. Ordenadas y sin repetir. */
  item_ids: readonly string[];
  /** Presupuesto al que pertenece la incidencia. null si el llamador no lo aportó. */
  budget_id: string | null;
  evidence: FindingEvidence;
}

export interface ValidationReport {
  findings: readonly ValidationFinding[];
  counts: Readonly<Record<FindingSeverity, number>>;
  /**
   * Constante, y está en el propio informe a propósito: quien consuma este objeto debe
   * poder comprobar en tiempo de ejecución que lo que tiene delante NO autoriza a
   * bloquear ni a corregir nada.
   */
  observer_mode: true;
}

// ─── Entrada ──────────────────────────────────────────────────────────────────

/**
 * Una línea ya clasificada. Es un subconjunto de budget_items, no la fila entera: el
 * validador no necesita saber de chapters, costes ni orden, y no debe poder tocarlos.
 *
 * Los importes llegan tal como están almacenados y se usan tal cual. Aquí no se
 * recalcula ningún importe ni se corrige ninguna cantidad.
 */
export interface ValidationLine {
  item_id: string;
  budget_id?: string | null;
  /** Descripción original. Sólo para que el mensaje sea legible. */
  name?: string | null;
  canonical_id: string | null;
  canonical_status: CanonicalStatus;
  price_type: PriceType | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  subtotal: number | null;
  /**
   * Si la línea COBRA en la base del presupuesto.
   *
   * Se puede afirmar explícitamente; si no se afirma, se deduce del subtotal. budget_items
   * todavía no tiene is_client_line ni parent_item_id (son Fase 4), así que este campo es
   * la vía para que el llamador aporte esa información cuando la tenga, sin que el
   * validador se la invente.
   */
  economic?: boolean;
}

// ─── Contrato canónico ────────────────────────────────────────────────────────

/**
 * Sólo lo que el validador necesita de canonical_concepts. Al declararse con Pick, una
 * fila real de la base de datos encaja sin conversión y no puede desincronizarse del
 * tipo de la tabla.
 */
export type ConceptRule = Pick<
  CanonicalConcept,
  "canonical_id" | "kind" | "allowed_price_types" | "default_price_type"
>;

export type RelationRule = Pick<
  CanonicalRelation,
  "from_canonical" | "to_canonical" | "relation_type"
>;

export interface CanonicalContract {
  concepts: readonly ConceptRule[];
  relations: readonly RelationRule[];
}

/**
 * Tipos de precio que incluyen material dentro del precio de la partida.
 *
 * LABOR_ONLY es el único que NO lo incluye, y por eso comprar el material aparte es
 * legítimo con él. La lista se escribe por exclusión explícita y no como "todo menos
 * LABOR_ONLY" para que añadir un price_type nuevo al vocabulario obligue a decidir
 * conscientemente de qué lado cae.
 */
export const MATERIAL_BEARING_PRICE_TYPES: readonly PriceType[] = Object.freeze([
  "MATERIAL_ONLY",
  "LABOR_AND_MATERIAL",
  "SERVICE",
]);
