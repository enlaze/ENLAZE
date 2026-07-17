/**
 * normalized-concepts.ts
 *
 * Deterministic semantic matching for construction materials/concepts.
 *
 * Strategies (in order):
 *   1. Exact match (after normalization)
 *   2. Synonym match (concept.synonyms array)
 *   3. Word overlap with threshold
 *   4. Category-scoped fuzzy match
 *
 * Pure functions. No DB access. No AI calls.
 */

import type { ConceptMatchType } from "./types/price-bank";

// ─── Normalization ────────────────────────────────────────────────────────

/**
 * Normalize a string for matching: lowercase, strip accents,
 * remove parentheses content, collapse whitespace.
 */
export function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract significant words (length > 2) from a normalized string.
 */
function significantWords(text: string): string[] {
  return normalizeForMatching(text)
    .split(" ")
    .filter((w) => w.length > 2);
}

// ─── Matching ─────────────────────────────────────────────────────────────

export interface ConceptCandidate {
  id: string;
  canonical_name: string;
  category: string;
  synonyms: string[];
}

export interface MatchResult {
  concept_id: string | null;
  concept_name: string | null;
  match_type: ConceptMatchType;
  confidence: number;
}

/**
 * Match an input name against a list of normalized concepts.
 *
 * Returns the best match with confidence score:
 *   - exact:              1.00
 *   - high_confidence:    0.85+
 *   - review_recommended: 0.50-0.84
 *   - none:               no match found
 */
export function matchConcept(
  inputName: string,
  inputCategory: string,
  concepts: ConceptCandidate[]
): MatchResult {
  const normalized = normalizeForMatching(inputName);
  const inputWords = significantWords(inputName);

  if (inputWords.length === 0) {
    return { concept_id: null, concept_name: null, match_type: "none", confidence: 0 };
  }

  let bestMatch: MatchResult = {
    concept_id: null,
    concept_name: null,
    match_type: "none",
    confidence: 0,
  };

  for (const concept of concepts) {
    const conceptNorm = normalizeForMatching(concept.canonical_name);

    // Strategy 1: Exact match
    if (normalized === conceptNorm) {
      return {
        concept_id: concept.id,
        concept_name: concept.canonical_name,
        match_type: "exact",
        confidence: 1.0,
      };
    }

    // Strategy 2: Synonym match
    for (const syn of concept.synonyms) {
      const synNorm = normalizeForMatching(syn);
      if (normalized === synNorm || normalized.includes(synNorm) || synNorm.includes(normalized)) {
        const conf = normalized === synNorm ? 0.95 : 0.88;
        if (conf > bestMatch.confidence) {
          bestMatch = {
            concept_id: concept.id,
            concept_name: concept.canonical_name,
            match_type: "high_confidence",
            confidence: conf,
          };
        }
      }
    }

    // Strategy 3: Word overlap
    const conceptWords = significantWords(concept.canonical_name);
    const overlap = inputWords.filter((w) =>
      conceptWords.some((cw) => cw.includes(w) || w.includes(cw))
    );
    const overlapRatio = overlap.length / Math.max(inputWords.length, conceptWords.length);

    // Strategy 4: Category-scoped boost
    const categoryBoost =
      inputCategory &&
      concept.category &&
      normalizeForMatching(inputCategory) === normalizeForMatching(concept.category)
        ? 0.10
        : 0;

    const wordConfidence = Math.min(overlapRatio + categoryBoost, 1.0);

    if (wordConfidence > bestMatch.confidence && wordConfidence >= 0.50) {
      const matchType: ConceptMatchType =
        wordConfidence >= 0.85 ? "high_confidence" : "review_recommended";

      bestMatch = {
        concept_id: concept.id,
        concept_name: concept.canonical_name,
        match_type: matchType,
        confidence: Math.round(wordConfidence * 100) / 100,
      };
    }
  }

  return bestMatch;
}

/**
 * Batch match: match multiple input names against the same concept list.
 */
export function matchConceptsBatch(
  inputs: Array<{ name: string; category: string }>,
  concepts: ConceptCandidate[]
): MatchResult[] {
  return inputs.map((input) => matchConcept(input.name, input.category, concepts));
}
