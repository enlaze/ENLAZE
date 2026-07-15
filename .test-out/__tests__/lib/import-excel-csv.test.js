"use strict";
/**
 * Tests for lib/import-excel-csv.ts
 *
 * Run: npx tsc -p tsconfig.test.json --noEmit false && node --test .test-out/__tests__/lib/import-excel-csv.test.js
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const import_excel_csv_1 = require("../../lib/import-excel-csv");
// ─── Helper ─────────────────────────────────────────────────────────────────
function defaultImportOptions(overrides) {
    return {
        provider_id: null,
        provider_name: "Test Provider",
        tariff_name: "Tarifa Test 2026",
        edition: "2026",
        year: 2026,
        region: "espana",
        currency: "EUR",
        includes_vat: false,
        content_type: "mixed",
        notes: "",
        duplicate_strategy: "skip",
        ...overrides,
    };
}
// ─── detectCsvSeparator ─────────────────────────────────────────────────────
(0, node_test_1.describe)("detectCsvSeparator", () => {
    (0, node_test_1.it)("detects semicolon separator (Spanish style)", () => {
        const content = "Codigo;Nombre;Unidad;Precio\nM001;Cemento Portland;kg;0,12\nM002;Arena fina;m3;18,50";
        strict_1.default.equal((0, import_excel_csv_1.detectCsvSeparator)(content), ";");
    });
    (0, node_test_1.it)("detects comma separator", () => {
        const content = "Code,Name,Unit,Price\nM001,Portland Cement,kg,0.12\nM002,Fine Sand,m3,18.50";
        strict_1.default.equal((0, import_excel_csv_1.detectCsvSeparator)(content), ",");
    });
    (0, node_test_1.it)("detects tab separator", () => {
        const content = "Code\tName\tUnit\tPrice\nM001\tCemento\tkg\t0.12";
        strict_1.default.equal((0, import_excel_csv_1.detectCsvSeparator)(content), "\t");
    });
});
// ─── detectDecimalSeparator ─────────────────────────────────────────────────
(0, node_test_1.describe)("detectDecimalSeparator", () => {
    (0, node_test_1.it)("detects dot as decimal separator", () => {
        const values = ["12.50", "3.14", "100.00", "0.75"];
        strict_1.default.equal((0, import_excel_csv_1.detectDecimalSeparator)(values), ".");
    });
    (0, node_test_1.it)("detects comma as decimal separator (Spanish)", () => {
        const values = ["12,50", "3,14", "100,00", "0,75"];
        strict_1.default.equal((0, import_excel_csv_1.detectDecimalSeparator)(values), ",");
    });
});
// ─── parseCsv ───────────────────────────────────────────────────────────────
(0, node_test_1.describe)("parseCsv", () => {
    (0, node_test_1.it)("parses semicolon-separated CSV", () => {
        const content = "A;B;C\n1;2;3\n4;5;6";
        const { rows, separator } = (0, import_excel_csv_1.parseCsv)(content);
        strict_1.default.equal(separator, ";");
        strict_1.default.equal(rows.length, 3);
        strict_1.default.deepEqual(rows[0], ["A", "B", "C"]);
        strict_1.default.deepEqual(rows[1], ["1", "2", "3"]);
    });
    (0, node_test_1.it)("handles quoted fields with separator inside", () => {
        const content = 'A;B;C\n"hello;world";2;3';
        const { rows } = (0, import_excel_csv_1.parseCsv)(content, ";");
        strict_1.default.equal(rows[1][0], "hello;world");
    });
    (0, node_test_1.it)("handles empty lines", () => {
        const content = "A;B\n1;2\n\n3;4";
        const { rows } = (0, import_excel_csv_1.parseCsv)(content, ";");
        // Empty lines may be included or filtered
        const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
        strict_1.default.ok(nonEmpty.length >= 3);
    });
});
// ─── detectColumnMappings ───────────────────────────────────────────────────
(0, node_test_1.describe)("detectColumnMappings", () => {
    (0, node_test_1.it)("maps Spanish headers", () => {
        const headers = ["Codigo", "Descripcion", "Unidad", "Precio"];
        const mappings = (0, import_excel_csv_1.detectColumnMappings)(headers);
        const codeMapping = mappings.find((m) => m.field === "code");
        strict_1.default.ok(codeMapping, "Should detect 'Codigo' as code");
        strict_1.default.equal(codeMapping.column_index, 0);
        const nameMapping = mappings.find((m) => m.field === "name" || m.field === "description");
        strict_1.default.ok(nameMapping, "Should detect 'Descripcion' as name or description");
        const unitMapping = mappings.find((m) => m.field === "unit");
        strict_1.default.ok(unitMapping, "Should detect 'Unidad' as unit");
        const priceMapping = mappings.find((m) => m.field === "price_excl_vat" || m.field === "price_incl_vat");
        strict_1.default.ok(priceMapping, "Should detect 'Precio' as price");
    });
    (0, node_test_1.it)("maps English headers", () => {
        const headers = ["Code", "Name", "Unit", "Unit Price", "Brand"];
        const mappings = (0, import_excel_csv_1.detectColumnMappings)(headers);
        strict_1.default.ok(mappings.some((m) => m.field === "code"), "Should detect 'Code'");
        strict_1.default.ok(mappings.some((m) => m.field === "name"), "Should detect 'Name'");
        strict_1.default.ok(mappings.some((m) => m.field === "brand"), "Should detect 'Brand'");
    });
    (0, node_test_1.it)("handles PVP/PVD price columns", () => {
        const headers = ["Ref", "Material", "Ud", "PVP", "PVD"];
        const mappings = (0, import_excel_csv_1.detectColumnMappings)(headers);
        const priceMapping = mappings.find((m) => m.field === "price_excl_vat" || m.field === "price_incl_vat");
        strict_1.default.ok(priceMapping, "Should detect PVP or PVD as price");
    });
});
// ─── detectHeaderRow ────────────────────────────────────────────────────────
(0, node_test_1.describe)("detectHeaderRow", () => {
    (0, node_test_1.it)("detects header in first row", () => {
        const rows = [
            ["Codigo", "Nombre", "Precio"],
            ["M001", "Cemento", "12.50"],
            ["M002", "Arena", "18.00"],
        ];
        strict_1.default.equal((0, import_excel_csv_1.detectHeaderRow)(rows), 0);
    });
    (0, node_test_1.it)("detects header when preceded by metadata rows", () => {
        const rows = [
            ["Proveedor: ACME S.L."],
            ["Fecha: 2026-01-15"],
            [""],
            ["Codigo", "Nombre", "Unidad", "Precio"],
            ["M001", "Cemento", "kg", "12.50"],
        ];
        // Should detect row 3 as the header (most column-like)
        const headerRow = (0, import_excel_csv_1.detectHeaderRow)(rows);
        strict_1.default.ok(headerRow >= 2, `Expected header at row ≥2, got ${headerRow}`);
    });
});
// ─── parseNumber ────────────────────────────────────────────────────────────
(0, node_test_1.describe)("parseNumber", () => {
    (0, node_test_1.it)("parses dot decimal", () => {
        strict_1.default.equal((0, import_excel_csv_1.parseNumber)("12.50", "."), 12.5);
    });
    (0, node_test_1.it)("parses comma decimal (Spanish)", () => {
        strict_1.default.equal((0, import_excel_csv_1.parseNumber)("12,50", ","), 12.5);
    });
    (0, node_test_1.it)("handles thousand separators (dot + comma decimal)", () => {
        strict_1.default.equal((0, import_excel_csv_1.parseNumber)("1.234,56", ","), 1234.56);
    });
    (0, node_test_1.it)("handles currency symbols", () => {
        const val = (0, import_excel_csv_1.parseNumber)("12,50 €", ",");
        strict_1.default.equal(val, 12.5);
    });
    (0, node_test_1.it)("returns 0 for empty string", () => {
        strict_1.default.equal((0, import_excel_csv_1.parseNumber)("", "."), 0);
    });
    (0, node_test_1.it)("returns 0 for non-numeric", () => {
        strict_1.default.equal((0, import_excel_csv_1.parseNumber)("abc", "."), 0);
    });
});
// ─── analyzeCsvContent ──────────────────────────────────────────────────────
(0, node_test_1.describe)("analyzeCsvContent", () => {
    (0, node_test_1.it)("analyzes a valid Spanish CSV", () => {
        const csv = [
            "Codigo;Nombre;Unidad;Precio",
            "M001;Cemento Portland CEM II;kg;0,12",
            "M002;Arena lavada 0/4;m3;18,50",
            "M003;Ladrillo macizo;ud;0,35",
        ].join("\n");
        const result = (0, import_excel_csv_1.analyzeCsvContent)(csv, "materiales.csv");
        strict_1.default.equal(result.ok, true);
        strict_1.default.equal(result.metadata.file_type, "csv");
        strict_1.default.equal(result.metadata.csv_separator, ";");
        strict_1.default.equal(result.metadata.decimal_separator, ",");
        strict_1.default.ok(result.metadata.total_rows >= 3);
        strict_1.default.ok(result.mappings.length > 0);
        strict_1.default.equal(result.errors.length, 0);
    });
    (0, node_test_1.it)("returns error for empty content", () => {
        const result = (0, import_excel_csv_1.analyzeCsvContent)("", "empty.csv");
        strict_1.default.equal(result.ok, false);
        strict_1.default.ok(result.errors.length > 0);
    });
    (0, node_test_1.it)("returns error for single-row file", () => {
        const result = (0, import_excel_csv_1.analyzeCsvContent)("Just one line", "single.csv");
        strict_1.default.equal(result.ok, false);
    });
    (0, node_test_1.it)("warns when no price column detected", () => {
        const csv = "Nombre;Codigo\nCemento;M001\nArena;M002";
        const result = (0, import_excel_csv_1.analyzeCsvContent)(csv, "no-price.csv");
        strict_1.default.ok(result.warnings.some((w) => w.toLowerCase().includes("precio")), "Should warn about missing price column");
    });
});
// ─── analyzeExcelRows ───────────────────────────────────────────────────────
(0, node_test_1.describe)("analyzeExcelRows", () => {
    (0, node_test_1.it)("analyzes rows from Excel", () => {
        const rows = [
            ["Ref", "Material", "Ud", "Precio sin IVA"],
            ["MAT-001", "Cemento CEM II 42.5", "kg", "0.12"],
            ["MAT-002", "Arena silice 0/4", "m3", "18.50"],
        ];
        const result = (0, import_excel_csv_1.analyzeExcelRows)(rows, "precios.xlsx", ["Hoja1"], 0);
        strict_1.default.equal(result.ok, true);
        strict_1.default.equal(result.metadata.file_type, "xlsx");
        strict_1.default.ok(result.mappings.length > 0);
    });
    (0, node_test_1.it)("returns error for insufficient rows", () => {
        const rows = [["Solo una fila"]];
        const result = (0, import_excel_csv_1.analyzeExcelRows)(rows, "short.xlsx", ["Hoja1"], 0);
        strict_1.default.equal(result.ok, false);
    });
});
// ─── generatePreview ────────────────────────────────────────────────────────
(0, node_test_1.describe)("generatePreview", () => {
    (0, node_test_1.it)("generates preview with valid records", () => {
        const dataRows = [
            ["M001", "Cemento Portland CEM II", "kg", "0.12"],
            ["M002", "Arena lavada 0/4", "m3", "18.50"],
        ];
        const mappings = [
            { column_index: 0, header: "Codigo", field: "code", confidence: 1 },
            { column_index: 1, header: "Nombre", field: "name", confidence: 1 },
            { column_index: 2, header: "Unidad", field: "unit", confidence: 1 },
            {
                column_index: 3,
                header: "Precio",
                field: "price_excl_vat",
                confidence: 1,
            },
        ];
        const preview = (0, import_excel_csv_1.generatePreview)(dataRows, 0, mappings, ".", defaultImportOptions());
        strict_1.default.equal(preview.total_records, 2);
        strict_1.default.ok(preview.valid_records >= 1);
        strict_1.default.equal(preview.records.length, 2);
        strict_1.default.equal(preview.records[0].code, "M001");
        strict_1.default.equal(preview.records[0].name, "Cemento Portland CEM II");
        strict_1.default.equal(preview.records[0].price_excl_vat, 0.12);
    });
    (0, node_test_1.it)("rejects records without name", () => {
        const dataRows = [["M001", "", "kg", "0.12"]];
        const mappings = [
            { column_index: 0, header: "Codigo", field: "code", confidence: 1 },
            { column_index: 1, header: "Nombre", field: "name", confidence: 1 },
            { column_index: 2, header: "Unidad", field: "unit", confidence: 1 },
            {
                column_index: 3,
                header: "Precio",
                field: "price_excl_vat",
                confidence: 1,
            },
        ];
        const preview = (0, import_excel_csv_1.generatePreview)(dataRows, 0, mappings, ".", defaultImportOptions());
        strict_1.default.ok(preview.rejected_records >= 1 || preview.warning_records >= 1, "Should reject or warn about record without name");
    });
    (0, node_test_1.it)("handles Spanish decimal separator", () => {
        const dataRows = [["M001", "Cemento", "kg", "1.234,56"]];
        const mappings = [
            { column_index: 0, header: "Codigo", field: "code", confidence: 1 },
            { column_index: 1, header: "Nombre", field: "name", confidence: 1 },
            { column_index: 2, header: "Unidad", field: "unit", confidence: 1 },
            {
                column_index: 3,
                header: "Precio",
                field: "price_excl_vat",
                confidence: 1,
            },
        ];
        const preview = (0, import_excel_csv_1.generatePreview)(dataRows, 0, mappings, ",", defaultImportOptions());
        strict_1.default.equal(preview.records[0].price_excl_vat, 1234.56);
    });
    (0, node_test_1.it)("detects duplicates against existing names", () => {
        const dataRows = [
            ["M001", "Cemento Portland", "kg", "0.12"],
            ["M002", "Arena fina", "m3", "18.50"],
        ];
        const mappings = [
            { column_index: 0, header: "Codigo", field: "code", confidence: 1 },
            { column_index: 1, header: "Nombre", field: "name", confidence: 1 },
            { column_index: 2, header: "Unidad", field: "unit", confidence: 1 },
            {
                column_index: 3,
                header: "Precio",
                field: "price_excl_vat",
                confidence: 1,
            },
        ];
        const existing = new Set(["cemento portland"]);
        const preview = (0, import_excel_csv_1.generatePreview)(dataRows, 0, mappings, ".", defaultImportOptions(), existing);
        strict_1.default.ok(preview.duplicate_records >= 1, "Should detect 1 duplicate");
    });
});
