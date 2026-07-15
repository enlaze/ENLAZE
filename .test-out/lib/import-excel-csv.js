"use strict";
/**
 * import-excel-csv.ts
 *
 * Parser and analyzer for Excel (.xlsx, .xls) and CSV (.csv) price files.
 * Used by the import wizard to analyze, map, and process tabular data
 * into the Price Bank V2 format.
 *
 * Responsibilities:
 *   - Detect file type, encoding, separator
 *   - Detect headers and column types
 *   - Propose column-to-field mappings
 *   - Parse and normalize records
 *   - Validate data quality
 *   - Generate preview with stats
 *
 * This module is PURE for the analysis/parsing functions.
 * The actual DB import is done by the API route.
 *
 * IMPORTANT: Does NOT trust Excel formulas — uses raw cell values only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectCsvSeparator = detectCsvSeparator;
exports.detectDecimalSeparator = detectDecimalSeparator;
exports.parseCsv = parseCsv;
exports.detectColumnMappings = detectColumnMappings;
exports.detectHeaderRow = detectHeaderRow;
exports.parseNumber = parseNumber;
exports.parseRow = parseRow;
exports.analyzeCsvContent = analyzeCsvContent;
exports.analyzeExcelRows = analyzeExcelRows;
exports.generatePreview = generatePreview;
const price_resolver_1 = require("./price-resolver");
const normalized_concepts_1 = require("./normalized-concepts");
// ─── CSV Parser ───────────────────────────────────────────────────────────
/**
 * Detect the CSV separator by analyzing the first few lines.
 */
function detectCsvSeparator(content) {
    const firstLines = content.split(/\r?\n/).slice(0, 5).join("\n");
    const counts = {
        ",": 0,
        ";": 0,
        "\t": 0,
        "|": 0,
    };
    for (const char of firstLines) {
        if (char in counts) {
            counts[char]++;
        }
    }
    // In Spanish files, semicolon is most common (comma used as decimal)
    const entries = Object.entries(counts);
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
}
/**
 * Detect decimal separator by analyzing number-like values.
 */
function detectDecimalSeparator(values) {
    let dotCount = 0;
    let commaCount = 0;
    for (const val of values) {
        const trimmed = val.trim();
        // Pattern: digits + separator + 1-4 digits at end (likely decimal)
        if (/\d+\.\d{1,4}$/.test(trimmed))
            dotCount++;
        if (/\d+,\d{1,4}$/.test(trimmed))
            commaCount++;
    }
    return commaCount > dotCount ? "," : ".";
}
/**
 * Parse a CSV value, handling quoted fields.
 */
function parseCsvLine(line, separator) {
    const fields = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++;
            }
            else {
                inQuotes = !inQuotes;
            }
        }
        else if (char === separator && !inQuotes) {
            fields.push(current.trim());
            current = "";
        }
        else {
            current += char;
        }
    }
    fields.push(current.trim());
    return fields;
}
/**
 * Parse CSV content into a 2D array of strings.
 */
function parseCsv(content, separator) {
    const sep = separator || detectCsvSeparator(content);
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
    const rows = lines.map((line) => parseCsvLine(line, sep));
    return { rows, separator: sep };
}
// ─── Header detection ─────────────────────────────────────────────────────
const HEADER_KEYWORDS = {
    code: ["codigo", "code", "cod", "ref", "referencia", "id"],
    name: ["nombre", "name", "denominacion", "concepto", "descripcion corta", "titulo", "producto", "articulo"],
    description: ["descripcion", "description", "desc", "detalle", "texto largo", "observaciones"],
    category: ["categoria", "category", "tipo", "familia", "capitulo", "seccion"],
    subcategory: ["subcategoria", "subcategory", "subfamilia"],
    unit: ["unidad", "unit", "ud", "uom", "medida", "u.m."],
    price_excl_vat: ["precio", "price", "pvp", "coste", "cost", "importe", "tarifa", "precio sin iva", "precio neto", "p.u.", "precio unitario"],
    price_incl_vat: ["precio con iva", "precio iva incluido", "pvp iva", "total"],
    vat_pct: ["iva", "vat", "impuesto", "% iva", "tipo iva"],
    provider: ["proveedor", "provider", "supplier", "fabricante", "distribuidor"],
    brand: ["marca", "brand"],
    model: ["modelo", "model"],
    sku: ["sku", "referencia proveedor", "ref prov", "codigo proveedor", "cod prov"],
    ean: ["ean", "barcode", "codigo barras", "upc", "gtin"],
    quantity_per_package: ["envase", "pack", "cantidad envase", "uds envase", "uds/envase", "formato"],
    chapter: ["capitulo", "chapter", "seccion", "grupo"],
    concept_type: ["tipo concepto", "concept type", "naturaleza"],
    ignore: [],
};
/**
 * Auto-detect column mappings from header row.
 */
function detectColumnMappings(headers) {
    return headers.map((header, index) => {
        const normalized = (0, normalized_concepts_1.normalizeForMatching)(header);
        let bestField = "ignore";
        let bestConfidence = 0;
        for (const [field, keywords] of Object.entries(HEADER_KEYWORDS)) {
            if (field === "ignore")
                continue;
            for (const kw of keywords) {
                const normalizedKw = (0, normalized_concepts_1.normalizeForMatching)(kw);
                // Exact match
                if (normalized === normalizedKw) {
                    if (1.0 > bestConfidence) {
                        bestField = field;
                        bestConfidence = 1.0;
                    }
                }
                // Contains
                else if (normalized.includes(normalizedKw) || normalizedKw.includes(normalized)) {
                    const conf = 0.8;
                    if (conf > bestConfidence) {
                        bestField = field;
                        bestConfidence = conf;
                    }
                }
                // Word overlap
                else {
                    const headerWords = normalized.split(" ").filter((w) => w.length > 2);
                    const kwWords = normalizedKw.split(" ").filter((w) => w.length > 2);
                    if (headerWords.length > 0 && kwWords.length > 0) {
                        const overlap = headerWords.filter((w) => kwWords.some((kw2) => kw2.includes(w) || w.includes(kw2)));
                        if (overlap.length > 0) {
                            const conf = 0.5 + (overlap.length / Math.max(headerWords.length, kwWords.length)) * 0.3;
                            if (conf > bestConfidence) {
                                bestField = field;
                                bestConfidence = conf;
                            }
                        }
                    }
                }
            }
        }
        return {
            column_index: index,
            header,
            field: bestField,
            confidence: bestConfidence,
        };
    });
}
/**
 * Detect which row contains headers (first row with mostly text values).
 */
function detectHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i];
        if (!row || row.length < 2)
            continue;
        const nonEmpty = row.filter((cell) => cell.trim() !== "");
        if (nonEmpty.length < 2)
            continue;
        // If most cells are text (not numbers), it's likely a header
        const textCells = nonEmpty.filter((cell) => {
            const trimmed = cell.trim().replace(/[€$%]/g, "");
            return isNaN(Number(trimmed.replace(",", ".")));
        });
        if (textCells.length / nonEmpty.length > 0.6) {
            return i;
        }
    }
    return 0;
}
// ─── Number parsing ───────────────────────────────────────────────────────
/**
 * Parse a number from a string, handling both comma and dot decimals,
 * currency symbols, and percentage signs.
 */
function parseNumber(value, decimalSep = ".") {
    if (!value || value.trim() === "")
        return 0;
    let cleaned = value
        .trim()
        .replace(/[€$£\s]/g, "")
        .replace(/%$/, "");
    if (decimalSep === ",") {
        // Remove dot thousands separators, then replace comma decimal
        cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    }
    else {
        // Remove comma thousands separators
        cleaned = cleaned.replace(/,/g, "");
    }
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}
// ─── Record parsing ──────────────────────────────────────────────────────
/**
 * Parse a single data row into an ImportRecord using the column mapping.
 */
function parseRow(row, rowNumber, mappings, decimalSep, options) {
    const raw = {};
    const messages = [];
    function getField(field) {
        const mapping = mappings.find((m) => m.field === field);
        if (!mapping)
            return "";
        const val = row[mapping.column_index] || "";
        raw[field] = val;
        return val.trim();
    }
    // Extract fields
    const name = getField("name");
    const code = getField("code");
    const description = getField("description");
    const category = getField("category") || getField("chapter");
    const unitRaw = getField("unit");
    const priceExclRaw = getField("price_excl_vat");
    const priceInclRaw = getField("price_incl_vat");
    const vatRaw = getField("vat_pct");
    const provider = getField("provider") || options.provider_name;
    const brand = getField("brand");
    const sku = getField("sku");
    const ean = getField("ean");
    const qtyPerPkgRaw = getField("quantity_per_package");
    const chapter = getField("chapter") || category;
    // Parse numbers
    let priceExcl = parseNumber(priceExclRaw, decimalSep);
    const priceIncl = priceInclRaw ? parseNumber(priceInclRaw, decimalSep) : null;
    let vatPct = vatRaw ? parseNumber(vatRaw, decimalSep) : 21;
    const qtyPerPkg = qtyPerPkgRaw ? parseNumber(qtyPerPkgRaw, decimalSep) : 1;
    // Normalize unit
    const unit = unitRaw ? (0, price_resolver_1.normalizeUnit)(unitRaw) : "ud";
    // Handle IVA logic
    if (options.includes_vat && priceExcl > 0 && !priceInclRaw) {
        // Price was entered with VAT, need to extract
        const multiplier = 1 + vatPct / 100;
        priceExcl = Math.round((priceExcl / multiplier) * 10000) / 10000;
    }
    else if (!options.includes_vat && priceIncl && priceExcl === 0) {
        // Only have incl price, compute excl
        const multiplier = 1 + vatPct / 100;
        priceExcl = Math.round((priceIncl / multiplier) * 10000) / 10000;
    }
    // ─── Validation ─────────────────────────────────────────────────────
    let status = "valid";
    // Name is required
    if (!name) {
        messages.push("Sin nombre de producto");
        status = "rejected";
    }
    // Price checks
    if (priceExcl === 0 && !priceIncl) {
        messages.push("Precio a cero");
        if (status !== "rejected")
            status = "warning";
    }
    if (priceExcl < 0) {
        messages.push("Precio negativo");
        status = "rejected";
    }
    if (priceExcl > 100000) {
        messages.push("Precio anormalmente alto (>100.000€)");
        if (status !== "rejected")
            status = "warning";
    }
    // Unit check
    if (!unitRaw || unitRaw.trim() === "") {
        messages.push("Unidad no especificada (se asume 'ud')");
        if (status !== "rejected")
            status = "warning";
    }
    // VAT check
    if (vatPct === 0) {
        messages.push("IVA al 0% — verificar");
        if (status !== "rejected")
            status = "warning";
    }
    return {
        row_number: rowNumber,
        code,
        name,
        description,
        category,
        unit,
        price_excl_vat: priceExcl,
        price_incl_vat: priceIncl,
        vat_pct: vatPct,
        provider,
        brand,
        sku,
        ean,
        quantity_per_package: qtyPerPkg,
        chapter,
        status,
        validation_messages: messages,
        raw_values: raw,
    };
}
// ─── Full analysis pipeline ───────────────────────────────────────────────
/**
 * Analyze a CSV file content: detect format, headers, mappings.
 * Returns analysis result ready for the wizard's step 2-3.
 */
function analyzeCsvContent(content, fileName) {
    const warnings = [];
    const errors = [];
    if (!content || content.trim() === "") {
        return {
            ok: false,
            metadata: emptyMetadata(fileName, "csv"),
            mappings: [],
            sample_rows: [],
            warnings: [],
            errors: ["Archivo vacío"],
        };
    }
    // Parse CSV
    const { rows, separator } = parseCsv(content);
    if (rows.length < 2) {
        return {
            ok: false,
            metadata: emptyMetadata(fileName, "csv"),
            mappings: [],
            sample_rows: rows,
            warnings: [],
            errors: ["El archivo tiene menos de 2 filas"],
        };
    }
    // Detect header row
    const headerRow = detectHeaderRow(rows);
    const headers = rows[headerRow] || [];
    const dataRows = rows.slice(headerRow + 1);
    // Detect decimal separator from data
    const allValues = dataRows.flatMap((r) => r);
    const decimalSep = detectDecimalSeparator(allValues);
    // Auto-detect column mappings
    const mappings = detectColumnMappings(headers);
    // Check for essential fields
    const hasPriceField = mappings.some((m) => (m.field === "price_excl_vat" || m.field === "price_incl_vat") &&
        m.confidence > 0);
    const hasNameField = mappings.some((m) => m.field === "name" && m.confidence > 0);
    if (!hasNameField) {
        warnings.push("No se detectó columna de nombre. Revisa el mapeo de columnas.");
    }
    if (!hasPriceField) {
        warnings.push("No se detectó columna de precio. Revisa el mapeo de columnas.");
    }
    // Sample rows (first 20 data rows)
    const sampleRows = dataRows.slice(0, 20);
    const metadata = {
        file_type: "csv",
        file_name: fileName,
        file_size: content.length,
        encoding: "utf-8",
        csv_separator: separator,
        decimal_separator: decimalSep,
        sheets: [],
        selected_sheet: 0,
        total_rows: dataRows.length,
        header_row: headerRow,
        detected_headers: headers,
    };
    return {
        ok: errors.length === 0,
        metadata,
        mappings,
        sample_rows: sampleRows,
        warnings,
        errors,
    };
}
/**
 * Analyze Excel content that has been pre-parsed into rows.
 * The actual Excel parsing (using SheetJS/exceljs) happens in the API route
 * or client. This function works on the parsed 2D array.
 */
function analyzeExcelRows(rows, fileName, sheetNames, selectedSheet) {
    const warnings = [];
    const errors = [];
    if (rows.length < 2) {
        return {
            ok: false,
            metadata: emptyMetadata(fileName, "xlsx"),
            mappings: [],
            sample_rows: rows,
            warnings: [],
            errors: ["La hoja seleccionada tiene menos de 2 filas"],
        };
    }
    const headerRow = detectHeaderRow(rows);
    const headers = rows[headerRow] || [];
    const dataRows = rows.slice(headerRow + 1);
    const allValues = dataRows.flatMap((r) => r);
    const decimalSep = detectDecimalSeparator(allValues);
    const mappings = detectColumnMappings(headers);
    const hasNameField = mappings.some((m) => m.field === "name" && m.confidence > 0);
    const hasPriceField = mappings.some((m) => (m.field === "price_excl_vat" || m.field === "price_incl_vat") &&
        m.confidence > 0);
    if (!hasNameField) {
        warnings.push("No se detectó columna de nombre. Revisa el mapeo de columnas.");
    }
    if (!hasPriceField) {
        warnings.push("No se detectó columna de precio. Revisa el mapeo de columnas.");
    }
    const sampleRows = dataRows.slice(0, 20);
    const metadata = {
        file_type: "xlsx",
        file_name: fileName,
        file_size: 0,
        encoding: "utf-8",
        csv_separator: null,
        decimal_separator: decimalSep,
        sheets: sheetNames,
        selected_sheet: selectedSheet,
        total_rows: dataRows.length,
        header_row: headerRow,
        detected_headers: headers,
    };
    return {
        ok: errors.length === 0,
        metadata,
        mappings,
        sample_rows: sampleRows,
        warnings,
        errors,
    };
}
// ─── Preview generation ───────────────────────────────────────────────────
/**
 * Parse all data rows and generate a preview with validation stats.
 */
function generatePreview(dataRows, headerRowIndex, mappings, decimalSep, options, existingNames) {
    const records = [];
    let valid = 0;
    let warning = 0;
    let rejected = 0;
    let duplicates = 0;
    let priceAnomalies = 0;
    let unknownUnits = 0;
    const KNOWN_UNITS = new Set([
        "ud", "m2", "ml", "m3", "kg", "l", "h", "pa", "saco",
        "rollo", "cubo", "lote", "jornada", "punto",
    ]);
    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const rowNum = headerRowIndex + 2 + i; // 1-based, skip header
        // Skip completely empty rows
        if (row.every((cell) => !cell || cell.trim() === ""))
            continue;
        const record = parseRow(row, rowNum, mappings, decimalSep, options);
        // Check duplicates
        if (existingNames && record.name) {
            const normalizedName = (0, normalized_concepts_1.normalizeForMatching)(record.name);
            if (existingNames.has(normalizedName)) {
                duplicates++;
                record.validation_messages.push("Producto ya existente en el banco");
                if (record.status === "valid")
                    record.status = "warning";
            }
        }
        // Check unknown units
        if (!KNOWN_UNITS.has(record.unit)) {
            unknownUnits++;
            record.validation_messages.push(`Unidad desconocida: "${record.unit}"`);
        }
        // Price anomalies
        if (record.price_excl_vat > 50000 || record.price_excl_vat < 0) {
            priceAnomalies++;
        }
        // Count by status
        switch (record.status) {
            case "valid":
                valid++;
                break;
            case "warning":
                warning++;
                break;
            case "rejected":
                rejected++;
                break;
        }
        records.push(record);
    }
    return {
        total_records: records.length,
        valid_records: valid,
        warning_records: warning,
        rejected_records: rejected,
        duplicate_records: duplicates,
        new_records: records.length - duplicates,
        price_anomalies: priceAnomalies,
        unknown_units: unknownUnits,
        records,
    };
}
// ─── Helpers ──────────────────────────────────────────────────────────────
function emptyMetadata(fileName, fileType) {
    return {
        file_type: fileType,
        file_name: fileName,
        file_size: 0,
        encoding: "utf-8",
        csv_separator: null,
        decimal_separator: ".",
        sheets: [],
        selected_sheet: 0,
        total_rows: 0,
        header_row: 0,
        detected_headers: [],
    };
}
