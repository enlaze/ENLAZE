/**
 * technical-price-bank.ts
 *
 * TypeScript types for the technical price bank tables.
 * These types mirror the Supabase schema created in
 * 20260526_technical_price_bank.sql
 *
 * NOT used by budget-engine or price-resolver yet.
 * This file only defines types for future integration.
 */

// ─── Source & Region ─────────────────────────────────────────────────────────

/** Authorized sources for technical price data */
export type TechnicalSource =
  | "enlaze_base"   // ENLAZE own curated prices
  | "cype"          // Exported from CYPE Generador de Precios / Arquimedes
  | "ive"           // Institut Valencia d'Edificacio
  | "public_bc3"    // Any other public BC3/FIEBDC source
  | "manual";       // Manually added by admin

/** Spanish regions for regional price differentiation */
export type PriceRegion =
  | "espana"                 // National average
  | "comunitat_valenciana"
  | "madrid"
  | "andalucia"
  | "cataluna"
  | "pais_vasco"
  | "galicia"
  | "castilla_y_leon"
  | "castilla_la_mancha"
  | "aragon"
  | "canarias"
  | "murcia"
  | "extremadura"
  | "baleares"
  | "asturias"
  | "navarra"
  | "cantabria"
  | "la_rioja";

// ─── Technical Chapter ───────────────────────────────────────────────────────

export interface TechnicalChapter {
  id: string;
  code: string;              // "01", "01.03", FIEBDC-compatible
  name: string;
  description: string;
  parent_id: string | null;
  level: number;             // 1=chapter, 2=subchapter, 3=sub-sub
  sort_order: number;
  source: TechnicalSource;
  region: PriceRegion;
  edition: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Technical Price Item ────────────────────────────────────────────────────

export type QualityTier = "basica" | "media" | "alta";

export interface TechnicalPriceItem {
  id: string;
  chapter_id: string;

  // Identity
  item_code: string;         // "01.03.005", FIEBDC-compatible
  name: string;              // "m2 Solado baldosa ceramica 30x30"
  description: string;
  long_text: string;         // Extended spec / pliego condiciones
  unit: string;

  // Cost breakdown (direct cost, no margin)
  unit_price: number;
  labor_cost: number;
  material_cost: number;
  machinery_cost: number;
  indirect_cost: number;
  waste_pct: number;

  // Classification & confidence
  quality_tier: QualityTier;
  confidence_score: number;    // 0.00–1.00 (0.50 = enlaze_base estimate, 0.90 = verified BC3)
  tags: string[];

  // Provenance
  source: TechnicalSource;
  source_code: string;       // Original code in source system
  region: PriceRegion;
  edition: string;

  // Validity
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;

  // Meta
  imported_at: string;
  updated_at: string;
}

// ─── Technical Price Component (decomposition) ──────────────────────────────

export type ComponentType =
  | "labor"        // Mano de obra
  | "material"     // Materiales
  | "machinery"    // Maquinaria
  | "auxiliary"    // Medios auxiliares
  | "subcontract"; // Subcontratacion

export interface TechnicalPriceComponent {
  id: string;
  price_item_id: string;

  component_type: ComponentType;
  code: string;
  name: string;              // "Oficial 1a albanil", "Mortero M-7.5"
  description: string;
  unit: string;

  // Yield & cost
  yield: number;             // Rendimiento: 0.35 h/m2, 1.05 kg/m2
  unit_cost: number;         // Coste unitario del recurso
  total_cost: number;        // GENERATED: yield * unit_cost (read-only)

  source: string;
  sort_order: number;
  created_at: string;
}

// ─── Technical Import Log ────────────────────────────────────────────────────

export type ImportStatus = "running" | "completed" | "failed" | "partial";

export interface TechnicalImportLog {
  id: string;
  source: string;
  file_name: string;
  region: string;
  edition: string;

  // Counters
  chapters_created: number;
  chapters_updated: number;
  items_created: number;
  items_updated: number;
  components_created: number;
  items_skipped: number;

  // Detail
  errors: Array<{ item_code?: string; error: string }>;
  metadata: Record<string, unknown>;

  // Timestamps
  started_at: string;
  finished_at: string | null;
  status: ImportStatus;
  imported_by: string | null;
}

// ─── Query helpers (for future use) ──────────────────────────────────────────

/** Shape returned when joining technical_price_items with their chapter */
export interface TechnicalPriceItemWithChapter extends TechnicalPriceItem {
  chapter: Pick<TechnicalChapter, "code" | "name">;
}

/** Shape returned when loading a full decomposition */
export interface TechnicalPriceItemFull extends TechnicalPriceItem {
  chapter: Pick<TechnicalChapter, "code" | "name">;
  components: TechnicalPriceComponent[];
}
