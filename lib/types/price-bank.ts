/**
 * price-bank.ts
 *
 * Types for the Price Bank V2 system.
 * Maps directly to Supabase tables: pb_providers, pb_products,
 * pb_normalized_concepts, pb_price_sources, pb_price_observations,
 * pb_price_current, pb_sync_runs, pb_sync_run_details.
 *
 * Conventions:
 *   - All amounts in EUR, excl. VAT unless suffixed _incl_vat
 *   - Percentages as decimals (21 = 21%)
 *   - Dates as ISO 8601 strings
 *   - Confidence as 0.00-1.00
 *   - company_id: null = global Enlaze, string = private to that company
 */

// ─── Provider ─────────────────────────────────────────────────────────────

export interface PBProvider {
  id: string;
  company_id: string | null;
  name: string;
  trade_name: string | null;
  legal_name: string | null;
  nif: string | null;
  website: string | null;
  country: string;
  autonomous_community: string | null;
  province: string | null;
  supply_zones: string[];
  shipping_cost_flat: number;
  shipping_cost_per_kg: number;
  free_shipping_min: number | null;
  minimum_order: number;
  delivery_days_min: number;
  delivery_days_max: number;
  payment_terms_days: number;
  is_preferred: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type PBProviderInsert = Omit<PBProvider, "id" | "created_at" | "updated_at">;

// ─── Normalized Concept ───────────────────────────────────────────────────

export type ConceptReviewStatus = "draft" | "reviewed" | "approved" | "deprecated";

export interface PBNormalizedConcept {
  id: string;
  company_id: string | null;
  canonical_name: string;
  description: string;
  category: string;
  subcategory: string;
  base_unit: string;
  synonyms: string[];
  specifications: Record<string, unknown>;
  review_status: ConceptReviewStatus;
  created_at: string;
  updated_at: string;
}

export type ConceptMatchType =
  | "exact"
  | "high_confidence"
  | "review_recommended"
  | "none"
  | "conflict";

// ─── Product ──────────────────────────────────────────────────────────────

export interface PBProduct {
  id: string;
  provider_id: string;
  concept_id: string | null;
  concept_match_type: ConceptMatchType;
  commercial_name: string;
  description: string;
  brand: string | null;
  model: string | null;
  sku: string | null;
  ean: string | null;
  sale_unit: string;
  units_per_package: number;
  unit_price: number;
  vat_rate: number;
  url: string | null;
  region: string;
  is_available: boolean;
  checked_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type PBProductInsert = Omit<PBProduct, "id" | "created_at" | "updated_at">;

// ─── Price Source ─────────────────────────────────────────────────────────

export type PriceSourceType =
  | "manual"
  | "private_tariff"
  | "negotiated"
  | "excel"
  | "csv"
  | "bc3"
  | "provider_catalog"
  | "api"
  | "feed"
  | "n8n_webhook"
  | "technical_bank_global"
  | "technical_bank_private"
  | "budget_history"
  | "web_authorized"
  | "market_estimate"
  | "ai_estimate";

export type UpdateFrequency = "manual" | "daily" | "weekly" | "monthly" | "on_demand";

export type SourceStatus = "active" | "paused" | "error" | "needs_credentials" | "deprecated";

export interface PBPriceSource {
  id: string;
  company_id: string | null;
  name: string;
  source_type: PriceSourceType;
  provider_id: string | null;
  country: string;
  region: string | null;
  url: string | null;
  update_frequency: UpdateFrequency;
  last_checked_at: string | null;
  last_success_at: string | null;
  next_run_at: string | null;
  status: SourceStatus;
  last_error: string | null;
  credential_ref: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Price Observation (historical) ───────────────────────────────────────

export interface PBPriceObservation {
  id: string;
  product_id: string;
  provider_id: string;
  source_id: string | null;
  price_excl_vat: number;
  vat_pct: number;
  price_incl_vat: number | null;
  shipping_cost: number;
  other_costs: number;
  discount_pct: number;
  discount_amount: number;
  effective_price: number | null;
  is_available: boolean;
  region: string;
  checked_at: string;
  price_changed_at: string | null;
  published_at: string | null;
  confidence_score: number;
  raw_data: Record<string, unknown> | null;
  dedup_hash: string | null;
  created_at: string;
}

export type PBObservationInsert = Omit<PBPriceObservation, "id" | "created_at">;

// ─── Current Price (materialized) ─────────────────────────────────────────

export interface PBPriceCurrent {
  id: string;
  product_id: string;
  observation_id: string;
  provider_id: string;
  concept_id: string | null;
  price_excl_vat: number;
  effective_price: number | null;
  confidence_score: number;
  region: string;
  is_available: boolean;
  source_type: string | null;
  checked_at: string | null;
  price_changed_at: string | null;
  updated_at: string;
}

// ─── Sync Run ─────────────────────────────────────────────────────────────

export type SyncRunStatus =
  | "pending"
  | "processing"
  | "completed"
  | "partial"
  | "error"
  | "needs_review";

export type SyncScope = "all" | "source" | "provider";

export interface PBSyncRun {
  id: string;
  idempotency_key: string | null;
  source_id: string | null;
  provider_id: string | null;
  scope: SyncScope;
  status: SyncRunStatus;
  started_at: string;
  finished_at: string | null;
  records_checked: number;
  records_new: number;
  records_modified: number;
  records_unchanged: number;
  records_rejected: number;
  records_errors: number;
  summary: Record<string, unknown>;
  error_log: Array<Record<string, unknown>>;
  created_at: string;
}

export interface PBSyncRunDetail {
  id: string;
  run_id: string;
  source_id: string | null;
  provider_id: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  records_checked: number;
  records_new: number;
  records_modified: number;
  records_unchanged: number;
  records_rejected: number;
  records_errors: number;
  errors: Array<Record<string, unknown>>;
  created_at: string;
}

// ─── Price Resolution (used by price-resolver-v2) ────────────────────────

export type ResolutionPriorityLevel =
  | "manual_locked"
  | "private_tariff"
  | "negotiated"
  | "historical_approved"
  | "preferred_supplier"
  | "provider_updated"
  | "private_bc3"
  | "technical_bank"
  | "enlaze_base"
  | "market_estimate"
  | "ai_estimate";

export const DEFAULT_PRIORITY_ORDER: ResolutionPriorityLevel[] = [
  "manual_locked",
  "private_tariff",
  "negotiated",
  "historical_approved",
  "preferred_supplier",
  "provider_updated",
  "private_bc3",
  "technical_bank",
  "enlaze_base",
  "market_estimate",
  "ai_estimate",
];

export interface PriceResolutionResult {
  concept_id: string | null;
  concept_name: string;
  product_id: string | null;
  product_name: string | null;
  provider_id: string | null;
  provider_name: string | null;
  source_id: string | null;
  unit_price: number;
  effective_price: number;
  effective_cost_breakdown: EffectiveCostBreakdown | null;
  source_type: ResolutionPriorityLevel | "estimated";
  confidence_score: number;
  selection_reason: string;
  checked_at: string;
  alternatives: PriceAlternativeV2[];
  warnings: string[];
}

export interface EffectiveCostBreakdown {
  unit_price: number;
  quantity_needed: number;
  units_per_package: number;
  packages_needed: number;
  package_cost: number;
  shipping_cost: number;
  other_costs: number;
  discount_amount: number;
  total_effective: number;
  effective_per_unit: number;
}

export interface PriceAlternativeV2 {
  product_id: string;
  product_name: string;
  provider_id: string;
  provider_name: string;
  brand: string | null;
  unit_price: number;
  effective_price: number | null;
  is_available: boolean;
  delivery_days: number | null;
  confidence_score: number;
  source_type: string;
  checked_at: string | null;
}
