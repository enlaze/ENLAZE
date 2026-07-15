"use strict";
/**
 * normalized-concepts.ts
 *
 * Semantic matching of product names to normalized concepts.
 * Uses deterministic string-based matching with multiple strategies:
 *   1. Exact normalized match
 *   2. Synonym match
 *   3. Token overlap (high confidence)
 *   4. Fuzzy partial match (review recommended)
 *
 * Claude can be used externally to SUGGEST matches, but this module
 * handles the deterministic matching and confidence classification.
 *
 * Pure functions. No side effects. No DB access.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeForMatching = normalizeForMatching;
exports.extractTokens = extractTokens;
exports.matchProductToConcepts = matchProductToConcepts;
exports.bestMatch = bestMatch;
exports.batchMatchProducts = batchMatchProducts;
// ─── Normalization ────────────────────────────────────────────────────────
/**
 * Normalize a string for matching purposes.
 * Removes accents, lowercases, strips noise words, collapses whitespace.
 */
function normalizeForMatching(text) {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // strip accents
        .replace(/[^\w\s]/g, " ") // strip punctuation
        .replace(/\b(de|del|la|el|los|las|un|una|para|con|en|por|y|o|a)\b/g, " ") // stop words
        .replace(/\s+/g, " ")
        .trim();
}
/**
 * Extract meaningful tokens from a normalized string.
 * Only keeps tokens with 2+ chars that aren't purely numeric.
 */
function extractTokens(normalized) {
    return normalized
        .split(" ")
        .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
}
// ─── Matching strategies ──────────────────────────────────────────────────
/**
 * Match a product name against a list of normalized concepts.
 *
 * Strategy order:
 *   1. Exact: normalized product name === normalized canonical name → "exact"
 *   2. Synonym: normalized product name matches any synonym → "exact"
 *   3. Token overlap ≥ 70% → "high_confidence"
 *   4. Token overlap ≥ 40% with same category → "review_recommended"
 *   5. No match → returns empty array
 *
 * Returns all matches sorted by confidence (highest first).
 * The caller decides what to do with multiple matches (conflict).
 */
function matchProductToConcepts(input, concepts) {
    const normalizedInput = normalizeForMatching(input.product_name);
    const inputTokens = extractTokens(normalizedInput);
    // Also consider description tokens for richer matching
    const descTokens = input.description
        ? extractTokens(normalizeForMatching(input.description))
        : [];
    const allInputTokens = [...new Set([...inputTokens, ...descTokens])];
    const results = [];
    for (const concept of concepts) {
        const normalizedCanonical = normalizeForMatching(concept.canonical_name);
        // Strategy 1: Exact match on canonical name
        if (normalizedInput === normalizedCanonical) {
            results.push({
                concept_id: concept.id,
                canonical_name: concept.canonical_name,
                match_type: "exact",
                confidence: 1.0,
                matched_via: "canonical_name_exact",
            });
            continue;
        }
        // Strategy 2: Exact match on any synonym
        const synonymMatch = concept.synonyms.find((syn) => normalizeForMatching(syn) === normalizedInput);
        if (synonymMatch) {
            results.push({
                concept_id: concept.id,
                canonical_name: concept.canonical_name,
                match_type: "exact",
                confidence: 0.98,
                matched_via: `synonym: ${synonymMatch}`,
            });
            continue;
        }
        // Strategy 3 & 4: Token overlap
        const conceptTokens = extractTokens(normalizedCanonical);
        // Also include synonym tokens
        const allConceptTokens = new Set(conceptTokens);
        for (const syn of concept.synonyms) {
            for (const t of extractTokens(normalizeForMatching(syn))) {
                allConceptTokens.add(t);
            }
        }
        const conceptTokenArr = Array.from(allConceptTokens);
        if (conceptTokenArr.length === 0 || allInputTokens.length === 0)
            continue;
        // Calculate bidirectional overlap
        const inputMatchCount = allInputTokens.filter((t) => conceptTokenArr.some((ct) => ct.includes(t) || t.includes(ct))).length;
        const conceptMatchCount = conceptTokenArr.filter((ct) => allInputTokens.some((t) => t.includes(ct) || ct.includes(t))).length;
        const inputOverlap = inputMatchCount / allInputTokens.length;
        const conceptOverlap = conceptMatchCount / conceptTokenArr.length;
        const avgOverlap = (inputOverlap + conceptOverlap) / 2;
        // Strategy 3: High confidence (≥ 70% overlap)
        if (avgOverlap >= 0.7) {
            results.push({
                concept_id: concept.id,
                canonical_name: concept.canonical_name,
                match_type: "high_confidence",
                confidence: Math.min(0.95, 0.7 + avgOverlap * 0.25),
                matched_via: `token_overlap: ${Math.round(avgOverlap * 100)}%`,
            });
            continue;
        }
        // Strategy 4: Review recommended (≥ 40% overlap + same category)
        if (avgOverlap >= 0.4) {
            const sameCategory = input.category &&
                normalizeForMatching(input.category) ===
                    normalizeForMatching(concept.category);
            if (sameCategory || avgOverlap >= 0.55) {
                results.push({
                    concept_id: concept.id,
                    canonical_name: concept.canonical_name,
                    match_type: "review_recommended",
                    confidence: Math.min(0.75, 0.4 + avgOverlap * 0.3),
                    matched_via: `token_overlap: ${Math.round(avgOverlap * 100)}%${sameCategory ? " + same_category" : ""}`,
                });
            }
        }
    }
    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);
    // Detect conflicts: multiple high-confidence matches
    if (results.length > 1 && results[0].confidence >= 0.85 && results[1].confidence >= 0.85) {
        // Mark all high-confidence results as conflicts
        for (const r of results) {
            if (r.confidence >= 0.85) {
                r.match_type = "conflict";
            }
        }
    }
    return results;
}
/**
 * Best match only (convenience function).
 * Returns null if no match or if conflict detected.
 */
function bestMatch(input, concepts) {
    const matches = matchProductToConcepts(input, concepts);
    if (matches.length === 0)
        return null;
    if (matches[0].match_type === "conflict")
        return null;
    return matches[0];
}
/**
 * Match multiple products against a list of concepts.
 * Returns results for every product, including those with no match.
 */
function batchMatchProducts(products, concepts) {
    return products.map((product) => {
        const allMatches = matchProductToConcepts(product, concepts);
        const best = allMatches.length > 0 && allMatches[0].match_type !== "conflict"
            ? allMatches[0]
            : null;
        return {
            product_name: product.product_name,
            best_match: best,
            all_matches: allMatches,
            needs_review: allMatches.length === 0 ||
                allMatches[0].match_type === "conflict" ||
                allMatches[0].match_type === "review_recommended",
        };
    });
}
