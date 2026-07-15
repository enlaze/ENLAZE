"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIDENCE = exports.SOURCE_TYPE_LABELS = exports.PRICE_LIST_COLUMNS = void 0;
/** Columns selected for the price list (lightweight query). */
exports.PRICE_LIST_COLUMNS = `
  id, name, description, category, subcategory, unit, unit_price,
  brand, format, purchase_price, recommended_sale_price,
  vat_rate, gross_margin_pct, supplier_name, source_type,
  is_active, business_subsector, family
`;
/** Source type labels for UI display. */
exports.SOURCE_TYPE_LABELS = {
    manual: "Manual",
    n8n_sync: "n8n Sync",
    import_csv: "CSV Import",
    api: "API",
    default: "Por defecto",
};
/** Confidence score thresholds. */
exports.CONFIDENCE = {
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
};
