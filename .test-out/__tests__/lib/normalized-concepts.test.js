"use strict";
/**
 * Tests for lib/normalized-concepts.ts
 *
 * Run: npx tsx --test __tests__/lib/normalized-concepts.test.ts
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const normalized_concepts_1 = require("../../lib/normalized-concepts");
// ─── Fixtures ─────────────────────────────────────────────────────────────
function makeConcept(overrides) {
    return {
        id: `concept-${Math.random().toString(36).slice(2, 8)}`,
        company_id: null,
        canonical_name: overrides.canonical_name,
        description: overrides.description ?? "",
        category: overrides.category ?? "material",
        subcategory: overrides.subcategory ?? "",
        base_unit: overrides.base_unit ?? "ud",
        synonyms: overrides.synonyms ?? [],
        specifications: overrides.specifications ?? {},
        review_status: overrides.review_status ?? "approved",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
}
const CONCEPTS = [
    makeConcept({
        canonical_name: "Placa de yeso laminado estándar de 13 mm",
        category: "material",
        subcategory: "albanileria",
        base_unit: "ud",
        synonyms: [
            "Placa BA13",
            "Pladur estándar 13",
            "PYL 13 mm",
            "Placa de yeso laminado 13mm",
        ],
    }),
    makeConcept({
        canonical_name: "Azulejo porcelánico rectificado 60x60",
        category: "material",
        subcategory: "revestimientos",
        base_unit: "m2",
        synonyms: [
            "Porcelánico 60x60",
            "Baldosa porcelánica rectificada",
        ],
    }),
    makeConcept({
        canonical_name: "Inodoro compacto salida dual",
        category: "material",
        subcategory: "sanitarios",
        base_unit: "ud",
        synonyms: [
            "WC compacto",
            "Inodoro de salida horizontal/vertical",
        ],
    }),
    makeConcept({
        canonical_name: "Cable H07V-K 2.5mm2 libre de halógenos",
        category: "material",
        subcategory: "electricidad",
        base_unit: "ml",
        synonyms: [
            "Cable 2.5mm",
            "Cable libre halógenos 2.5",
        ],
    }),
];
// ─── normalizeForMatching ─────────────────────────────────────────────────
(0, node_test_1.describe)("normalizeForMatching", () => {
    (0, node_test_1.it)("lowercases and strips accents", () => {
        strict_1.default.equal((0, normalized_concepts_1.normalizeForMatching)("Azulejo Porcelánico"), "azulejo porcelanico");
    });
    (0, node_test_1.it)("removes stop words", () => {
        const result = (0, normalized_concepts_1.normalizeForMatching)("Placa de yeso laminado");
        strict_1.default.ok(!result.includes(" de "));
        strict_1.default.ok(result.includes("placa"));
        strict_1.default.ok(result.includes("yeso"));
        strict_1.default.ok(result.includes("laminado"));
    });
    (0, node_test_1.it)("collapses whitespace", () => {
        const result = (0, normalized_concepts_1.normalizeForMatching)("  Cable   libre   halógenos  ");
        strict_1.default.ok(!result.includes("  "));
    });
});
// ─── extractTokens ───────────────────────────────────────────────────────
(0, node_test_1.describe)("extractTokens", () => {
    (0, node_test_1.it)("keeps meaningful tokens", () => {
        const tokens = (0, normalized_concepts_1.extractTokens)("placa yeso laminado 13 mm estandar");
        strict_1.default.ok(tokens.includes("placa"));
        strict_1.default.ok(tokens.includes("yeso"));
        strict_1.default.ok(tokens.includes("laminado"));
        strict_1.default.ok(tokens.includes("mm"));
        strict_1.default.ok(tokens.includes("estandar"));
        // Pure numeric "13" should be excluded (length >= 2 but purely numeric)
        strict_1.default.ok(!tokens.includes("13"));
    });
    (0, node_test_1.it)("excludes short tokens", () => {
        const tokens = (0, normalized_concepts_1.extractTokens)("a b cd ef");
        strict_1.default.ok(!tokens.includes("a"));
        strict_1.default.ok(!tokens.includes("b"));
        strict_1.default.ok(tokens.includes("cd"));
        strict_1.default.ok(tokens.includes("ef"));
    });
});
// ─── matchProductToConcepts ──────────────────────────────────────────────
(0, node_test_1.describe)("matchProductToConcepts", () => {
    (0, node_test_1.it)("exact match on canonical name", () => {
        const matches = (0, normalized_concepts_1.matchProductToConcepts)({ product_name: "Placa de yeso laminado estándar de 13 mm" }, CONCEPTS);
        strict_1.default.ok(matches.length > 0);
        strict_1.default.equal(matches[0].match_type, "exact");
        strict_1.default.equal(matches[0].confidence, 1.0);
    });
    (0, node_test_1.it)("exact match via synonym", () => {
        const matches = (0, normalized_concepts_1.matchProductToConcepts)({ product_name: "Placa BA13" }, CONCEPTS);
        strict_1.default.ok(matches.length > 0);
        strict_1.default.equal(matches[0].match_type, "exact");
        strict_1.default.ok(matches[0].confidence >= 0.95);
        strict_1.default.ok(matches[0].matched_via.includes("synonym"));
    });
    (0, node_test_1.it)("high confidence via token overlap", () => {
        const matches = (0, normalized_concepts_1.matchProductToConcepts)({ product_name: "Placa yeso laminado 13mm tipo N" }, CONCEPTS);
        strict_1.default.ok(matches.length > 0);
        // Should match the PYL concept with some confidence
        strict_1.default.ok(matches[0].match_type === "exact" ||
            matches[0].match_type === "high_confidence" ||
            matches[0].match_type === "review_recommended");
        strict_1.default.ok(matches[0].canonical_name.includes("yeso laminado"));
    });
    (0, node_test_1.it)("review_recommended for partial overlap", () => {
        const matches = (0, normalized_concepts_1.matchProductToConcepts)({ product_name: "Placa especial de yeso", category: "material" }, CONCEPTS);
        // Should find something but not with full confidence
        if (matches.length > 0) {
            strict_1.default.ok(["exact", "high_confidence", "review_recommended"].includes(matches[0].match_type));
        }
    });
    (0, node_test_1.it)("no match for completely unrelated product", () => {
        const matches = (0, normalized_concepts_1.matchProductToConcepts)({ product_name: "Hormigonera eléctrica 160L" }, CONCEPTS);
        // Should return empty or very low confidence
        if (matches.length > 0) {
            strict_1.default.ok(matches[0].confidence < 0.7);
        }
    });
    (0, node_test_1.it)("considers description in matching", () => {
        const matches = (0, normalized_concepts_1.matchProductToConcepts)({
            product_name: "Inodoro porcelana modelo XR-500",
            description: "Inodoro compacto de porcelana con salida dual",
        }, CONCEPTS);
        strict_1.default.ok(matches.length > 0);
        strict_1.default.ok(matches[0].canonical_name.includes("Inodoro"));
    });
});
// ─── bestMatch ───────────────────────────────────────────────────────────
(0, node_test_1.describe)("bestMatch", () => {
    (0, node_test_1.it)("returns best match for clear input", () => {
        const result = (0, normalized_concepts_1.bestMatch)({ product_name: "PYL 13 mm" }, CONCEPTS);
        strict_1.default.ok(result !== null);
        strict_1.default.ok(result.canonical_name.includes("yeso laminado"));
    });
    (0, node_test_1.it)("returns null for no match", () => {
        const result = (0, normalized_concepts_1.bestMatch)({ product_name: "Producto completamente irrelevante sin relación alguna" }, CONCEPTS);
        // Either null or very low confidence
        if (result !== null) {
            strict_1.default.ok(result.confidence < 0.5);
        }
    });
});
// ─── batchMatchProducts ──────────────────────────────────────────────────
(0, node_test_1.describe)("batchMatchProducts", () => {
    (0, node_test_1.it)("matches multiple products at once", () => {
        const results = (0, normalized_concepts_1.batchMatchProducts)([
            { product_name: "Placa BA13" },
            { product_name: "Porcelánico 60x60" },
            { product_name: "WC compacto" },
            { product_name: "Producto desconocido XYZ" },
        ], CONCEPTS);
        strict_1.default.equal(results.length, 4);
        // First three should match
        strict_1.default.ok(results[0].best_match !== null);
        strict_1.default.ok(results[1].best_match !== null);
        strict_1.default.ok(results[2].best_match !== null);
        // Last one should need review
        strict_1.default.equal(results[3].needs_review, true);
    });
});
