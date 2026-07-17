/**
 * price-import.ts
 *
 * Parses uploaded CSV/BC3 files into a preview format, validates rows,
 * and inserts confirmed rows into the Price Bank V2 tables.
 *
 * Workflow:
 *   1. analyze() — parse file, detect columns, validate, return preview
 *   2. process() — insert validated rows into pb_providers + pb_products +
 *                  pb_price_observations + pb_price_current
 *
 * Supports:
 *   - CSV (comma, semicolon, tab separated)
 *   - BC3/FIEBDC-3 (via existing bc3-parser)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ImportFileType = "csv" | "bc3";

export interface ColumnMapping {
  /** CSV column name → target field */
  name: string | null;
  unit: string | null;
  unit_price: string | null;
  brand: string | null;
  sku: string | null;
  category: string | null;
  description: string | null;
}

export interface ImportRow {
  row_number: number;
  name: string;
  unit: string;
  unit_price: number;
  brand: string | null;
  sku: string | null;
  category: string | null;
  description: string | null;
  is_valid: boolean;
  errors: string[];
}

export interface ImportAnalysis {
  ok: boolean;
  file_type: ImportFileType;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  detected_columns: string[];
  suggested_mapping: ColumnMapping;
  preview: ImportRow[];
  warnings: string[];
  errors: string[];
}

export interface ImportProcessInput {
  rows: ImportRow[];
  provider_name: string;
  provider_id?: string; // If linking to existing provider
  company_id: string;
  source_name: string;
  region?: string;
}

export interface ImportProcessResult {
  ok: boolean;
  provider_id: string;
  products_created: number;
  observations_created: number;
  current_prices_created: number;
  skipped: number;
  errors: string[];
}

// ─── CSV Parsing ─────────────────────────────────────────────────────────────

/**
 * Detect delimiter and parse CSV content into rows.
 */
function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  // Detect delimiter
  const firstLine = lines[0];
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;

  let delimiter = ",";
  if (semicolons > commas && semicolons > tabs) delimiter = ";";
  else if (tabs > commas && tabs > semicolons) delimiter = "\t";

  const headers = parseLine(lines[0], delimiter);
  const rows = lines.slice(1).map((line) => parseLine(line, delimiter));

  return { headers, rows };
}

function parseLine(line: string, delimiter: string): string[] {
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

// ─── Column detection ────────────────────────────────────────────────────────

const NAME_PATTERNS = /^(nombre|name|descripci[oó]n|concepto|material|partida|art[ií]culo|producto|item)$/i;
const UNIT_PATTERNS = /^(unidad|unit|ud|uds|medida|unid)$/i;
const PRICE_PATTERNS = /^(precio|price|unit_price|precio_unitario|pvp|coste|cost|importe|valor|€)$/i;
const BRAND_PATTERNS = /^(marca|brand|fabricante|manufacturer)$/i;
const SKU_PATTERNS = /^(sku|c[oó]digo|code|ref|referencia|reference|ean|c[oó]d)$/i;
const CATEGORY_PATTERNS = /^(categor[ií]a|category|cap[ií]tulo|chapter|tipo|type|familia)$/i;
const DESC_PATTERNS = /^(descripci[oó]n_larga|long_description|detalle|detail|notas|notes|observaciones)$/i;

function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    name: null,
    unit: null,
    unit_price: null,
    brand: null,
    sku: null,
    category: null,
    description: null,
  };

  for (const h of headers) {
    const cleaned = h.trim();
    if (NAME_PATTERNS.test(cleaned)) mapping.name = h;
    else if (UNIT_PATTERNS.test(cleaned)) mapping.unit = h;
    else if (PRICE_PATTERNS.test(cleaned)) mapping.unit_price = h;
    else if (BRAND_PATTERNS.test(cleaned)) mapping.brand = h;
    else if (SKU_PATTERNS.test(cleaned)) mapping.sku = h;
    else if (CATEGORY_PATTERNS.test(cleaned)) mapping.category = h;
    else if (DESC_PATTERNS.test(cleaned)) mapping.description = h;
  }

  // Fallback: if no name found, try first text column
  if (!mapping.name && headers.length > 0) {
    mapping.name = headers[0];
  }

  // Fallback: if no price found, try to find a numeric column
  if (!mapping.unit_price) {
    for (const h of headers) {
      if (/precio|price|cost|€|pvp/i.test(h)) {
        mapping.unit_price = h;
        break;
      }
    }
  }

  return mapping;
}

// ─── Analyze ─────────────────────────────────────────────────────────────────

/**
 * Analyze an uploaded file and return a preview with validation.
 * Pure function for CSV. For BC3, delegates to bc3 parser.
 */
export function analyzeCSV(
  content: string,
  customMapping?: Partial<ColumnMapping>
): ImportAnalysis {
  const warnings: string[] = [];
  const errors: string[] = [];

  const { headers, rows } = parseCSV(content);

  if (headers.length === 0) {
    return {
      ok: false,
      file_type: "csv",
      total_rows: 0,
      valid_rows: 0,
      invalid_rows: 0,
      detected_columns: [],
      suggested_mapping: { name: null, unit: null, unit_price: null, brand: null, sku: null, category: null, description: null },
      preview: [],
      warnings,
      errors: ["El archivo está vacío o no tiene cabeceras"],
    };
  }

  const mapping = { ...suggestMapping(headers), ...customMapping };

  if (!mapping.name) {
    errors.push("No se detectó columna de nombre. Mapea manualmente.");
  }
  if (!mapping.unit_price) {
    warnings.push("No se detectó columna de precio. Los productos se importarán con precio 0.");
  }

  // Build import rows
  const importRows: ImportRow[] = [];
  const headerIdx = new Map<string, number>();
  headers.forEach((h, i) => headerIdx.set(h, i));

  const getVal = (row: string[], col: string | null): string => {
    if (!col) return "";
    const idx = headerIdx.get(col);
    return idx !== undefined ? (row[idx] || "").trim() : "";
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((cell) => !cell.trim())) continue; // Skip empty rows

    const rowErrors: string[] = [];

    const name = getVal(row, mapping.name);
    if (!name) rowErrors.push("Nombre vacío");

    const priceStr = getVal(row, mapping.unit_price).replace(/[€$,]/g, "").replace(",", ".");
    const unit_price = parseFloat(priceStr) || 0;
    if (mapping.unit_price && isNaN(parseFloat(priceStr))) {
      rowErrors.push("Precio no numérico");
    }

    importRows.push({
      row_number: i + 2, // +2 for header + 1-indexed
      name,
      unit: getVal(row, mapping.unit) || "ud",
      unit_price,
      brand: getVal(row, mapping.brand) || null,
      sku: getVal(row, mapping.sku) || null,
      category: getVal(row, mapping.category) || null,
      description: getVal(row, mapping.description) || null,
      is_valid: rowErrors.length === 0,
      errors: rowErrors,
    });
  }

  const validCount = importRows.filter((r) => r.is_valid).length;

  return {
    ok: errors.length === 0,
    file_type: "csv",
    total_rows: importRows.length,
    valid_rows: validCount,
    invalid_rows: importRows.length - validCount,
    detected_columns: headers,
    suggested_mapping: mapping,
    preview: importRows.slice(0, 50), // Max 50 rows in preview
    warnings,
    errors,
  };
}

// ─── Process (insert into DB) ────────────────────────────────────────────────

/**
 * Insert validated import rows into the Price Bank V2 tables.
 * Creates or reuses a provider, then inserts products + observations + current prices.
 */
export async function processImport(
  supabase: SupabaseClient,
  input: ImportProcessInput
): Promise<ImportProcessResult> {
  const errors: string[] = [];
  let productsCreated = 0;
  let observationsCreated = 0;
  let currentPricesCreated = 0;
  let skipped = 0;

  // 1. Get or create provider
  let providerId = input.provider_id;

  if (!providerId) {
    // Check if provider exists
    const { data: existing } = await supabase
      .from("pb_providers")
      .select("id")
      .eq("name", input.provider_name)
      .eq("company_id", input.company_id)
      .limit(1);

    if (existing && existing.length > 0) {
      providerId = existing[0].id;
    } else {
      const { data: created, error: createErr } = await supabase
        .from("pb_providers")
        .insert({
          company_id: input.company_id,
          name: input.provider_name,
          country: "ES",
          supply_zones: ["*"],
          shipping_cost_flat: 0,
          shipping_cost_per_kg: 0,
          minimum_order: 0,
          delivery_days_min: 1,
          delivery_days_max: 7,
          payment_terms_days: 30,
          is_preferred: false,
          is_active: true,
        })
        .select("id")
        .single();

      if (createErr || !created) {
        return {
          ok: false,
          provider_id: "",
          products_created: 0,
          observations_created: 0,
          current_prices_created: 0,
          skipped: 0,
          errors: [`No se pudo crear el proveedor: ${createErr?.message}`],
        };
      }

      providerId = created.id;
    }
  }

  // 2. Get or create import source
  const sourceName = input.source_name || `Importación CSV - ${input.provider_name}`;
  let sourceId: string | null = null;

  const { data: existingSource } = await supabase
    .from("pb_price_sources")
    .select("id")
    .eq("name", sourceName)
    .limit(1);

  if (existingSource && existingSource.length > 0) {
    sourceId = existingSource[0].id;
  } else {
    const { data: newSource } = await supabase
      .from("pb_price_sources")
      .insert({
        name: sourceName,
        source_type: "csv_import",
        country: "ES",
        update_frequency: "manual",
        status: "active",
        is_active: true,
      })
      .select("id")
      .single();

    sourceId = newSource?.id ?? null;
  }

  // 3. Insert products
  const validRows = input.rows.filter((r) => r.is_valid && r.name);
  const now = new Date().toISOString();
  const region = input.region || "ES";

  for (const row of validRows) {
    // Check for duplicate by SKU or name+provider
    const dedupField = row.sku ? "sku" : "commercial_name";
    const dedupValue = row.sku || row.name;

    const { data: existingProd } = await supabase
      .from("pb_products")
      .select("id")
      .eq("provider_id", providerId)
      .eq(dedupField, dedupValue)
      .limit(1);

    if (existingProd && existingProd.length > 0) {
      skipped++;
      continue;
    }

    // Insert product
    const { data: product, error: prodErr } = await supabase
      .from("pb_products")
      .insert({
        provider_id: providerId,
        concept_id: null,
        concept_match_type: "none",
        commercial_name: row.name,
        description: row.description || "",
        brand: row.brand,
        model: null,
        sku: row.sku,
        ean: null,
        sale_unit: row.unit,
        units_per_package: 1,
        unit_price: row.unit_price,
        vat_rate: 21,
        url: null,
        region,
        is_available: true,
        checked_at: now,
        is_active: true,
      })
      .select("id")
      .single();

    if (prodErr || !product) {
      errors.push(`Producto "${row.name}": ${prodErr?.message}`);
      continue;
    }

    productsCreated++;

    // Insert observation
    const dedupHash = crypto
      .createHash("sha256")
      .update(`import-${providerId}-${row.name}-${row.unit_price}`)
      .digest("hex")
      .slice(0, 32);

    const { data: obs, error: obsErr } = await supabase
      .from("pb_price_observations")
      .insert({
        product_id: product.id,
        provider_id: providerId,
        source_id: sourceId,
        price_excl_vat: row.unit_price,
        vat_pct: 21,
        shipping_cost: 0,
        other_costs: 0,
        discount_pct: 0,
        discount_amount: 0,
        is_available: true,
        region,
        checked_at: now,
        confidence_score: 0.75,
        dedup_hash: dedupHash,
      })
      .select("id")
      .single();

    if (obsErr) {
      errors.push(`Observación "${row.name}": ${obsErr.message}`);
      continue;
    }

    observationsCreated++;

    if (!obs) continue;

    // Insert current price
    const { error: curErr } = await supabase
      .from("pb_price_current")
      .upsert(
        {
          product_id: product.id,
          observation_id: obs.id,
          provider_id: providerId,
          concept_id: null,
          price_excl_vat: row.unit_price,
          confidence_score: 0.75,
          region,
          is_available: true,
          source_type: "csv_import",
          checked_at: now,
        },
        { onConflict: "product_id" }
      );

    if (curErr) {
      errors.push(`Precio actual "${row.name}": ${curErr.message}`);
    } else {
      currentPricesCreated++;
    }
  }

  return {
    ok: errors.length === 0,
    provider_id: providerId ?? "",
    products_created: productsCreated,
    observations_created: observationsCreated,
    current_prices_created: currentPricesCreated,
    skipped,
    errors,
  };
}
