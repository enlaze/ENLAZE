/**
 * Shared PriceItem type — matches the extended price_items DB table.
 * All retail-specific fields are optional (nullable in DB) so construction
 * rows work without changes.
 */
export interface PriceItem {
  id: string;
  user_id: string;
  sector: string;

  /* ── Core (both sectors) ── */
  name: string;
  description: string;
  category: string;
  subcategory: string;
  unit: string;
  unit_price: number;

  /* ── Retail identity ── */
  brand?: string | null;
  format?: string | null;
  sku?: string | null;
  barcode?: string | null;
  business_subsector?: string | null;
  family?: string | null;

  /* ── Dual pricing (buy / sell) ── */
  purchase_price?: number | null;
  recommended_sale_price?: number | null;
  vat_rate?: number | null;
  gross_margin_pct?: number | null;

  /* ── Supplier link ── */
  supplier_id?: string | null;
  supplier_name?: string | null;
  supplier_ref?: string | null;

  /* ── Source / confidence ── */
  source_type?: string | null;
  source_url?: string | null;
  confidence_score?: number | null;
  is_manual_override?: boolean | null;

  /* ── Lifecycle ── */
  captured_at?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean | null;

  /* ── Scope ── */
  price_scope?: string | null;
}

/**
 * Lightweight version for list views — omits user_id / sector
 * (already filtered in query) and heavy columns.
 */
export type PriceListItem = Omit<PriceItem, "user_id" | "sector" | "sku" | "barcode" | "supplier_ref" | "source_url" | "captured_at" | "valid_from" | "valid_until" | "confidence_score" | "is_manual_override" | "price_scope" | "supplier_id">;

/** Columns selected for the price list (lightweight query). */
export const PRICE_LIST_COLUMNS = `
  id, name, description, category, subcategory, unit, unit_price,
  brand, format, purchase_price, recommended_sale_price,
  vat_rate, gross_margin_pct, supplier_name, source_type,
  is_active, business_subsector, family
` as const;

/** Source type labels for UI display. */
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  manual: "Manual",
  n8n_sync: "n8n Sync",
  import_csv: "CSV Import",
  api: "API",
  default: "Por defecto",
};

/** Confidence score thresholds. */
export const CONFIDENCE = {
  /** Manual user entry or override — highest trust */
  MANUAL: 1.0,
  /** Imported from verified supplier catalog */
  SUPPLIER_CATALOG: 0.9,
  /** Synced from n8n with direct API source */
  N8N_API: 0.8,
  /** Synced from n8n with scraping / aggregated source */
  N8N_SCRAPE: 0.6,
  /** Imported from CSV */
  CSV_IMPORT: 0.5,
  /** Hardcoded sector defaults */
  DEFAULT: 0.3,
} as const;
