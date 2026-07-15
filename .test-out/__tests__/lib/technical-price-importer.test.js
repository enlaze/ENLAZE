"use strict";
/**
 * Tests for lib/technical-price-importer.ts (v2 enhancements)
 *
 * Tests the pure utility functions: contentHash, compareEditions.
 * The main importBC3ToDatabase function requires Supabase and is tested via integration tests.
 *
 * Run: npx tsc -p tsconfig.test.json --noEmit false && node --test .test-out/__tests__/lib/technical-price-importer.test.js
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const technical_price_importer_1 = require("../../lib/technical-price-importer");
// ─── contentHash ────────────────────────────────────────────────────────────
(0, node_test_1.describe)("contentHash", () => {
    (0, node_test_1.it)("produces consistent hash for same input", () => {
        const h1 = (0, technical_price_importer_1.contentHash)({
            code: "M001",
            unit: "kg",
            price: 12.5,
            source: "cype",
            region: "espana",
        });
        const h2 = (0, technical_price_importer_1.contentHash)({
            code: "M001",
            unit: "kg",
            price: 12.5,
            source: "cype",
            region: "espana",
        });
        strict_1.default.equal(h1, h2);
    });
    (0, node_test_1.it)("produces different hash for different price", () => {
        const h1 = (0, technical_price_importer_1.contentHash)({
            code: "M001",
            unit: "kg",
            price: 12.5,
            source: "cype",
            region: "espana",
        });
        const h2 = (0, technical_price_importer_1.contentHash)({
            code: "M001",
            unit: "kg",
            price: 13.0,
            source: "cype",
            region: "espana",
        });
        strict_1.default.notEqual(h1, h2);
    });
    (0, node_test_1.it)("produces different hash for different source", () => {
        const h1 = (0, technical_price_importer_1.contentHash)({
            code: "M001",
            unit: "kg",
            price: 12.5,
            source: "cype",
            region: "espana",
        });
        const h2 = (0, technical_price_importer_1.contentHash)({
            code: "M001",
            unit: "kg",
            price: 12.5,
            source: "ive",
            region: "espana",
        });
        strict_1.default.notEqual(h1, h2);
    });
    (0, node_test_1.it)("is case-insensitive", () => {
        const h1 = (0, technical_price_importer_1.contentHash)({
            code: "M001",
            unit: "KG",
            price: 12.5,
            source: "CYPE",
            region: "Espana",
        });
        const h2 = (0, technical_price_importer_1.contentHash)({
            code: "m001",
            unit: "kg",
            price: 12.5,
            source: "cype",
            region: "espana",
        });
        strict_1.default.equal(h1, h2);
    });
    (0, node_test_1.it)("trims whitespace", () => {
        const h1 = (0, technical_price_importer_1.contentHash)({
            code: " M001 ",
            unit: " kg ",
            price: 12.5,
            source: " cype ",
            region: " espana ",
        });
        const h2 = (0, technical_price_importer_1.contentHash)({
            code: "M001",
            unit: "kg",
            price: 12.5,
            source: "cype",
            region: "espana",
        });
        strict_1.default.equal(h1, h2);
    });
    (0, node_test_1.it)("returns a 16-character hex string", () => {
        const h = (0, technical_price_importer_1.contentHash)({
            code: "M001",
            unit: "kg",
            price: 12.5,
            source: "cype",
            region: "espana",
        });
        strict_1.default.equal(h.length, 16);
        strict_1.default.match(h, /^[0-9a-f]{16}$/);
    });
});
// ─── compareEditions ────────────────────────────────────────────────────────
(0, node_test_1.describe)("compareEditions", () => {
    (0, node_test_1.it)("2026 > 2025", () => {
        strict_1.default.ok((0, technical_price_importer_1.compareEditions)("2026", "2025") > 0);
    });
    (0, node_test_1.it)("2025 < 2026", () => {
        strict_1.default.ok((0, technical_price_importer_1.compareEditions)("2025", "2026") < 0);
    });
    (0, node_test_1.it)("same year = 0", () => {
        strict_1.default.equal((0, technical_price_importer_1.compareEditions)("2026", "2026"), 0);
    });
    (0, node_test_1.it)("2026.2 > 2026.1", () => {
        strict_1.default.ok((0, technical_price_importer_1.compareEditions)("2026.2", "2026.1") > 0);
    });
    (0, node_test_1.it)("2025.1 < 2026.1", () => {
        strict_1.default.ok((0, technical_price_importer_1.compareEditions)("2025.1", "2026.1") < 0);
    });
    (0, node_test_1.it)("handles Q notation: 2025.Q4 > 2025.Q3", () => {
        strict_1.default.ok((0, technical_price_importer_1.compareEditions)("2025.Q4", "2025.Q3") > 0);
    });
    (0, node_test_1.it)("handles dash separators: 2026-01 > 2025-12", () => {
        strict_1.default.ok((0, technical_price_importer_1.compareEditions)("2026-01", "2025-12") > 0);
    });
    (0, node_test_1.it)("handles mixed formats gracefully", () => {
        // "2026" vs "2025.2" — year takes priority
        strict_1.default.ok((0, technical_price_importer_1.compareEditions)("2026", "2025.2") > 0);
    });
});
