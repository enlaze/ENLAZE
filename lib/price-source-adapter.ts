/**
 * price-source-adapter.ts
 *
 * Generic adapter pattern for external price sources.
 * Each adapter normalizes data from a specific source into
 * PBProduct + PBPriceObservation rows for the Price Bank V2.
 *
 * Supported sources:
 *   - BEDEC (ITeC Barcelona) — CSV/XML export
 *   - PREOC (preoc.es) — CSV export
 *   - CYPE Generador de Precios — CSV/XML export
 *   - Custom CSV/XLSX from any provider
 *
 * Each adapter:
 *   1. Receives raw file content (string or ArrayBuffer)
 *   2. Returns normalized AdaptedPriceRow[] ready for import
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type PriceSourceAdapter =
  | "bedec"
  | "preoc"
  | "cype"
  | "generic_csv"
  | "generic_xlsx";

export interface AdaptedPriceRow {
  /** External code from the source (e.g., BEDEC code, PREOC code) */
  external_code: string;
  /** Material/product name */
  name: string;
  /** Optional long description */
  description: string;
  /** Category/chapter */
  category: string;
  /** Subcategory */
  subcategory: string;
  /** Unit of measurement */
  unit: string;
  /** Unit price excluding VAT */
  unit_price: number;
  /** Source this came from */
  source: PriceSourceAdapter;
  /** Region (autonomous community) */
  region: string;
  /** When this price was published/updated */
  published_date: string | null;
  /** Is this a composed price (partida) vs simple material */
  is_composed: boolean;
  /** Confidence score (0-1) */
  confidence: number;
  /** Raw data from source for debugging */
  raw: Record<string, string>;
}

export interface AdapterResult {
  ok: boolean;
  source: PriceSourceAdapter;
  rows: AdaptedPriceRow[];
  total_parsed: number;
  total_valid: number;
  total_skipped: number;
  warnings: string[];
  errors: string[];
}

// ─── BEDEC Adapter (ITeC Barcelona) ──────────────────────────────────────────

/**
 * BEDEC exports structured CSV with columns:
 *   Codi;Descripcio;Unitat;Preu;Tipus;Capitol
 *
 * The BEDEC database covers Catalonia construction costs.
 * Available at: https://itec.es/servicios/bedec/
 */
export function adaptBEDEC(content: string): AdapterResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const rows: AdaptedPriceRow[] = [];
  let skipped = 0;

  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return {
      ok: false, source: "bedec", rows: [], total_parsed: 0,
      total_valid: 0, total_skipped: 0, warnings,
      errors: ["Archivo BEDEC vacío o sin datos"],
    };
  }

  // Detect delimiter (BEDEC typically uses semicolons)
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headerLine = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());

  // Map BEDEC column names (Catalan/Spanish)
  const colMap = detectBEDECColumns(headerLine);

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i], delimiter);
    if (cells.every((c) => !c.trim())) { skipped++; continue; }

    const code = getCell(cells, colMap.code);
    const name = getCell(cells, colMap.name);
    const unit = getCell(cells, colMap.unit) || "ud";
    const priceStr = getCell(cells, colMap.price).replace(",", ".");
    const price = parseFloat(priceStr);
    const category = getCell(cells, colMap.category);
    const type = getCell(cells, colMap.type).toLowerCase();

    if (!name || isNaN(price)) { skipped++; continue; }

    rows.push({
      external_code: code,
      name,
      description: name,
      category: category || "General",
      subcategory: "",
      unit,
      unit_price: price,
      source: "bedec",
      region: "Cataluña",
      published_date: null,
      is_composed: type === "p" || type === "partida",
      confidence: 0.85,
      raw: Object.fromEntries(
        headerLine.map((h, idx) => [h, cells[idx] || ""])
      ),
    });
  }

  if (rows.length === 0) {
    warnings.push("No se encontraron filas válidas. ¿Es un archivo BEDEC con formato estándar?");
  }

  return {
    ok: errors.length === 0,
    source: "bedec",
    rows,
    total_parsed: lines.length - 1,
    total_valid: rows.length,
    total_skipped: skipped,
    warnings,
    errors,
  };
}

function detectBEDECColumns(headers: string[]): Record<string, number> {
  const map: Record<string, number> = { code: -1, name: -1, unit: -1, price: -1, category: -1, type: -1 };

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (/^(codi|codigo|code|ref)$/i.test(h)) map.code = i;
    else if (/^(descripcio|descripcion|nombre|name)$/i.test(h)) map.name = i;
    else if (/^(unitat|unidad|unit|ud)$/i.test(h)) map.unit = i;
    else if (/^(preu|precio|price|cost|pvp|€)$/i.test(h)) map.price = i;
    else if (/^(capitol|capitulo|chapter|categoria)$/i.test(h)) map.category = i;
    else if (/^(tipus|tipo|type)$/i.test(h)) map.type = i;
  }

  // Fallback: first col = code, second = name, etc.
  if (map.name === -1 && headers.length >= 2) map.name = 1;
  if (map.code === -1 && headers.length >= 1) map.code = 0;

  return map;
}

// ─── PREOC Adapter ───────────────────────────────────────────────────────────

/**
 * PREOC (Precios de la Construcción) exports CSV with:
 *   Código;Descripción;Unidad;Precio;Capítulo
 *
 * Covers all of Spain by autonomous community.
 * Available at: https://www.preoc.es/
 */
export function adaptPREOC(
  content: string,
  region = "España"
): AdapterResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const rows: AdaptedPriceRow[] = [];
  let skipped = 0;

  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return {
      ok: false, source: "preoc", rows: [], total_parsed: 0,
      total_valid: 0, total_skipped: 0, warnings,
      errors: ["Archivo PREOC vacío o sin datos"],
    };
  }

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headerLine = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());

  // Map PREOC columns
  const colMap = detectPREOCColumns(headerLine);

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i], delimiter);
    if (cells.every((c) => !c.trim())) { skipped++; continue; }

    const code = getCell(cells, colMap.code);
    const name = getCell(cells, colMap.name);
    const unit = getCell(cells, colMap.unit) || "ud";
    const priceStr = getCell(cells, colMap.price).replace(",", ".");
    const price = parseFloat(priceStr);
    const chapter = getCell(cells, colMap.chapter);
    const subcategory = getCell(cells, colMap.subcategory);

    if (!name || isNaN(price)) { skipped++; continue; }

    // PREOC codes indicate type: M = material, O = mano de obra, P = partida
    const isComposed = code.startsWith("P") || code.startsWith("U");

    rows.push({
      external_code: code,
      name,
      description: name,
      category: chapter || "General",
      subcategory: subcategory || "",
      unit,
      unit_price: price,
      source: "preoc",
      region,
      published_date: null,
      is_composed: isComposed,
      confidence: 0.82,
      raw: Object.fromEntries(
        headerLine.map((h, idx) => [h, cells[idx] || ""])
      ),
    });
  }

  return {
    ok: errors.length === 0,
    source: "preoc",
    rows,
    total_parsed: lines.length - 1,
    total_valid: rows.length,
    total_skipped: skipped,
    warnings,
    errors,
  };
}

function detectPREOCColumns(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {
    code: -1, name: -1, unit: -1, price: -1, chapter: -1, subcategory: -1,
  };

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (/^(codigo|code|clave|ref)$/i.test(h)) map.code = i;
    else if (/^(descripcion|nombre|concepto|name)$/i.test(h)) map.name = i;
    else if (/^(unidad|ud|uds|unit)$/i.test(h)) map.unit = i;
    else if (/^(precio|price|importe|coste|pvp|€)$/i.test(h)) map.price = i;
    else if (/^(capitulo|chapter|grupo|familia)$/i.test(h)) map.chapter = i;
    else if (/^(subcapitulo|subcategoria|subfamilia)$/i.test(h)) map.subcategory = i;
  }

  if (map.name === -1 && headers.length >= 2) map.name = 1;
  if (map.code === -1 && headers.length >= 1) map.code = 0;

  return map;
}

// ─── CYPE Adapter ────────────────────────────────────────────────────────────

/**
 * CYPE Generador de Precios exports CSV/TXT with:
 *   Código | Descripción | Unidad | Precio | Capítulo | Subcapítulo
 *
 * Most widely used construction pricing tool in Spain.
 * Available at: https://generadordeprecios.info/
 */
export function adaptCYPE(
  content: string,
  region = "España"
): AdapterResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const rows: AdaptedPriceRow[] = [];
  let skipped = 0;

  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return {
      ok: false, source: "cype", rows: [], total_parsed: 0,
      total_valid: 0, total_skipped: 0, warnings,
      errors: ["Archivo CYPE vacío o sin datos"],
    };
  }

  // CYPE can use tab, semicolon, or pipe as delimiter
  const firstLine = lines[0];
  let delimiter = ";";
  if ((firstLine.match(/\|/g) || []).length > 2) delimiter = "|";
  else if ((firstLine.match(/\t/g) || []).length > 2) delimiter = "\t";

  const headerLine = firstLine.split(delimiter).map((h) => h.trim().toLowerCase());

  // Map CYPE columns
  const colMap = detectCYPEColumns(headerLine);

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i], delimiter);
    if (cells.every((c) => !c.trim())) { skipped++; continue; }

    const code = getCell(cells, colMap.code);
    const name = getCell(cells, colMap.name);
    const unit = getCell(cells, colMap.unit) || "ud";
    const priceStr = getCell(cells, colMap.price).replace(",", ".");
    const price = parseFloat(priceStr);
    const chapter = getCell(cells, colMap.chapter);
    const subcategory = getCell(cells, colMap.subcategory);

    if (!name || isNaN(price)) { skipped++; continue; }

    // CYPE uses dot-separated codes: E.g., "EHE010" for materials
    const isComposed = /^[A-Z]{2,3}\d{3}$/i.test(code);

    rows.push({
      external_code: code,
      name: cleanCYPEDescription(name),
      description: name,
      category: chapter || "General",
      subcategory: subcategory || "",
      unit,
      unit_price: price,
      source: "cype",
      region,
      published_date: null,
      is_composed: isComposed,
      confidence: 0.88,
      raw: Object.fromEntries(
        headerLine.map((h, idx) => [h, cells[idx] || ""])
      ),
    });
  }

  return {
    ok: errors.length === 0,
    source: "cype",
    rows,
    total_parsed: lines.length - 1,
    total_valid: rows.length,
    total_skipped: skipped,
    warnings,
    errors,
  };
}

function detectCYPEColumns(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {
    code: -1, name: -1, unit: -1, price: -1, chapter: -1, subcategory: -1,
  };

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (/^(codigo|code|clave|ref|referencia)$/i.test(h)) map.code = i;
    else if (/^(descripcion|nombre|concepto|resumen|name)$/i.test(h)) map.name = i;
    else if (/^(unidad|ud|uds|unit|medida)$/i.test(h)) map.unit = i;
    else if (/^(precio|price|importe|coste|pvp|€|total)$/i.test(h)) map.price = i;
    else if (/^(capitulo|chapter|grupo|familia|seccion)$/i.test(h)) map.chapter = i;
    else if (/^(subcapitulo|subcategoria|subfamilia|apartado)$/i.test(h)) map.subcategory = i;
  }

  if (map.name === -1 && headers.length >= 2) map.name = 1;
  if (map.code === -1 && headers.length >= 1) map.code = 0;

  return map;
}

/**
 * CYPE descriptions often include measurement details in brackets.
 * Clean them for a more usable name.
 */
function cleanCYPEDescription(desc: string): string {
  return desc
    .replace(/\s*\(ver pliego\)/gi, "")
    .replace(/\s*\(p\.o\.\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Universal adapter dispatcher ────────────────────────────────────────────

/**
 * Auto-detect source format and parse accordingly.
 * If sourceHint is provided, uses that adapter directly.
 */
export function adaptPriceSource(
  content: string,
  sourceHint?: PriceSourceAdapter,
  region?: string
): AdapterResult {
  const adapter = sourceHint || detectSourceFormat(content);

  switch (adapter) {
    case "bedec":
      return adaptBEDEC(content);
    case "preoc":
      return adaptPREOC(content, region);
    case "cype":
      return adaptCYPE(content, region);
    case "generic_csv":
    default:
      // For generic CSV, we return an error suggesting
      // the standard import flow instead
      return {
        ok: false,
        source: "generic_csv",
        rows: [],
        total_parsed: 0,
        total_valid: 0,
        total_skipped: 0,
        warnings: [],
        errors: [
          "Formato genérico detectado. Usa el importador estándar de CSV/XLSX.",
        ],
      };
  }
}

/**
 * Try to detect which source format a CSV file is from
 * based on header patterns and content clues.
 */
function detectSourceFormat(content: string): PriceSourceAdapter {
  const firstLines = content.slice(0, 2000).toLowerCase();

  // BEDEC: Catalan column names
  if (firstLines.includes("codi") && firstLines.includes("descripcio") && firstLines.includes("preu")) {
    return "bedec";
  }

  // CYPE: specific code patterns or pipe delimiters
  if (firstLines.includes("generador de precios") || /\|.*\|.*\|/g.test(firstLines)) {
    return "cype";
  }

  // PREOC: specific patterns
  if (firstLines.includes("preoc") || (firstLines.includes("capitulo") && firstLines.includes("codigo"))) {
    return "preoc";
  }

  return "generic_csv";
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function splitCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());

  return fields;
}

function getCell(cells: string[], index: number): string {
  if (index < 0 || index >= cells.length) return "";
  return (cells[index] || "").trim();
}

// ─── Convert AdaptedPriceRow[] → ImportRow[] for the standard process flow ──

import type { ImportRow } from "./price-import";

export function adaptedRowsToImportRows(adapted: AdaptedPriceRow[]): ImportRow[] {
  return adapted.map((row, idx) => ({
    row_number: idx + 1,
    name: row.name,
    unit: row.unit,
    unit_price: row.unit_price,
    brand: null,
    sku: row.external_code || null,
    category: row.category || null,
    description: row.description || null,
    is_valid: !!row.name && row.unit_price >= 0,
    errors: [],
  }));
}
