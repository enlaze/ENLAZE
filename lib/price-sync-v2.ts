/**
 * price-sync-v2.ts
 *
 * Sync engine for the Price Bank V2. Materializes the latest observations
 * into pb_price_current, detects price changes, and cleans stale data.
 *
 * Three main operations:
 *   1. materializeCurrentPrices() — for each product, pick the best recent
 *      observation and upsert into pb_price_current.
 *   2. detectPriceChanges() — compare old vs new prices, flag significant
 *      changes for alerts.
 *   3. cleanExpiredPrices() — mark products unavailable if their latest
 *      observation is older than the configured TTL.
 *
 * All operations use Supabase client passed by the caller. The engine
 * tracks everything in pb_sync_runs + pb_sync_run_details.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PBSyncRun } from "./types/price-bank";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncConfig {
  /** Max age in days before a price is considered stale */
  staleness_days: number;
  /** Minimum % change to trigger a price change alert (e.g. 5 = 5%) */
  change_threshold_pct: number;
  /** Scope of sync: all products, a specific source, or a specific provider */
  scope: "all" | "source" | "provider";
  /** If scope=source or provider, the target ID */
  scope_id?: string;
  /** Idempotency key for dedup (e.g. "daily-2026-07-16") */
  idempotency_key?: string;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  staleness_days: 30,
  change_threshold_pct: 5,
  scope: "all",
};

export interface PriceChange {
  product_id: string;
  product_name: string;
  provider_id: string;
  provider_name: string;
  old_price: number;
  new_price: number;
  change_pct: number;
  direction: "up" | "down";
}

export interface SyncResult {
  run_id: string;
  status: "completed" | "partial" | "error";
  records_checked: number;
  records_new: number;
  records_modified: number;
  records_unchanged: number;
  records_errors: number;
  records_skipped: number;
  price_changes: PriceChange[];
  stale_marked: number;
  duration_ms: number;
  errors: string[];
}

type QueryError = { message?: string } | null;

type StalePriceResult = {
  count: number;
  error: string | null;
};

const OBSERVATION_CONFIDENCE: Readonly<Record<string, number>> = Object.freeze({
  official_bc3_catalog: 0.85,
  official_pdf_catalog: 0.80,
  official_product_page: 0.70,
  official_product_listing: 0.70,
});

export const PRICE_SYNC_SOURCE_TYPES = Object.freeze([
  "provider_catalog",
  "n8n",
  "manual",
  "api",
  "scraper",
  "product_base",
] as const);

type PriceSyncSourceType = typeof PRICE_SYNC_SOURCE_TYPES[number];

const PRICE_SYNC_SOURCE_TYPE_SET = new Set<string>(PRICE_SYNC_SOURCE_TYPES);
const MAX_SKIPPED_EXAMPLES = 20;
const POSTGREST_PAGE_SIZE = 1_000;

function queryError(prefix: string, error: QueryError): string {
  return `${prefix}: ${error?.message || "unknown database error"}`;
}

function observationMetadata(observation: Record<string, unknown>): Record<string, unknown> {
  const metadata = observation.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
}

function skippedReasonKey(reason: string): string {
  if (reason.startsWith("declared pack quantity")) {
    return "declared_pack_quantity_without_units_per_package";
  }
  if (reason.startsWith("observed_price")) return "invalid_observed_price";
  return "unsafe_price_normalization";
}

function declaredPackQuantity(productName: unknown): number | null {
  const normalized = String(productName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const match = normalized.match(
    /(?:\bx\s*|\b)(\d{1,4})\s*(?:ud(?:s)?|unidades?|piezas?|pcs?)\b/,
  );
  if (!match) return null;
  const quantity = Number(match[1]);
  return Number.isInteger(quantity) && quantity > 1 ? quantity : null;
}

export function confidenceForEvidence(evidenceType: unknown): number {
  return OBSERVATION_CONFIDENCE[String(evidenceType ?? "")] ?? 0.55;
}

export function priceSyncSourceType(source: unknown): PriceSyncSourceType {
  const normalized = String(source ?? "").trim().toLowerCase();
  return PRICE_SYNC_SOURCE_TYPE_SET.has(normalized)
    ? normalized as PriceSyncSourceType
    : "n8n";
}

export function observedUnitPrice(
  observedPrice: unknown,
  _priceBasis: unknown,
  _saleUnit: unknown,
  unitsPerPackage: unknown,
  productName?: unknown,
): { price: number | null; reason: string | null } {
  const price = Number(observedPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { price: null, reason: "observed_price is not a positive finite number" };
  }

  const quantity = Number(unitsPerPackage);
  if (Number.isFinite(quantity) && quantity > 1) {
    return { price: price / quantity, reason: null };
  }

  const declaredQuantity = declaredPackQuantity(productName);
  if (quantity === 1 && declaredQuantity !== null) {
    return {
      price: null,
      reason: `declared pack quantity ${declaredQuantity} conflicts with units_per_package 1`,
    };
  }

  // price_basis describes the sale format (bottle, box, sack, roll...), not an
  // implicit multiplier. With no explicit package quantity the observed price
  // is already the price of one sale unit and must be kept unchanged.
  return { price, reason: null };
}

// ─── Main sync function ──────────────────────────────────────────────────────

/**
 * Run a full sync cycle:
 *   1. Create sync run record
 *   2. Materialize current prices from observations
 *   3. Detect significant changes
 *   4. Clean stale prices
 *   5. Update sync run with results
 */
export async function runPriceSync(
  supabase: SupabaseClient,
  config: Partial<SyncConfig> = {}
): Promise<SyncResult> {
  const cfg = { ...DEFAULT_SYNC_CONFIG, ...config };
  const startTime = Date.now();
  const errors: string[] = [];

  // 1. Check idempotency
  if (cfg.idempotency_key) {
    const { data: existing, error: existingError } = await supabase
      .from("pb_sync_runs")
      .select("id, status")
      .eq("idempotency_key", cfg.idempotency_key)
      .in("status", ["completed", "processing"])
      .limit(1);

    if (existingError) {
      return {
        run_id: "",
        status: "error",
        records_checked: 0,
        records_new: 0,
        records_modified: 0,
        records_unchanged: 0,
        records_errors: 1,
        records_skipped: 0,
        price_changes: [],
        stale_marked: 0,
        duration_ms: Date.now() - startTime,
        errors: [queryError("Failed to check sync idempotency", existingError)],
      };
    }

    if (existing && existing.length > 0) {
      return {
        run_id: existing[0].id,
        status: "completed",
        records_checked: 0,
        records_new: 0,
        records_modified: 0,
        records_unchanged: 0,
        records_errors: 0,
        records_skipped: 0,
        price_changes: [],
        stale_marked: 0,
        duration_ms: 0,
        errors: ["Sync already completed for this idempotency key"],
      };
    }
  }

  // 2. Create sync run
  const { data: run, error: runErr } = await supabase
    .from("pb_sync_runs")
    .insert({
      idempotency_key: cfg.idempotency_key ?? null,
      scope: cfg.scope,
      status: "processing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runErr || !run) {
    return {
      run_id: "",
      status: "error",
      records_checked: 0,
      records_new: 0,
      records_modified: 0,
      records_unchanged: 0,
      records_errors: 1,
      records_skipped: 0,
      price_changes: [],
      stale_marked: 0,
      duration_ms: Date.now() - startTime,
      errors: [`Failed to create sync run: ${runErr?.message}`],
    };
  }

  const runId = run.id;

  // 3. Materialize current prices
  const matResult = await materializeCurrentPrices(supabase, cfg);
  errors.push(...matResult.errors);

  // 4. Detect price changes
  const priceChanges = matResult.changes.filter(
    (c) => Math.abs(c.change_pct) >= cfg.change_threshold_pct
  );

  // 5. Clean stale prices only when materialization did not hit a fatal query
  // error. Continuing after a failed read is how the old implementation hid a
  // broken observation schema behind a successful run.
  const staleResult: StalePriceResult = matResult.fatal
    ? { count: 0, error: null }
    : await markStalePrices(supabase, cfg.staleness_days);
  if (staleResult.error) errors.push(staleResult.error);
  const recordsErrors = matResult.error_count + (staleResult.error ? 1 : 0);

  // 6. Update sync run
  let status: SyncResult["status"] = matResult.fatal || staleResult.error
    ? "error"
    : errors.length > 0
      ? "partial"
      : "completed";

  const { error: updateRunError } = await supabase
    .from("pb_sync_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      records_checked: matResult.checked,
      records_new: matResult.new_count,
      records_modified: matResult.modified,
      records_unchanged: matResult.unchanged,
      records_errors: recordsErrors,
      summary: {
        stale_marked: staleResult.count,
        records_skipped: matResult.skipped,
        skipped: {
          reasons: matResult.skipped_by_reason,
          examples: matResult.skipped_examples,
        },
        unknown_sources: {
          count: matResult.unknown_source_count,
          examples: matResult.unknown_source_examples,
        },
        price_changes_above_threshold: priceChanges.length,
        config: cfg,
      },
      error_log: errors.map((e) => ({ message: e, at: new Date().toISOString() })),
    })
    .eq("id", runId);

  if (updateRunError) {
    status = "error";
    errors.push(queryError("Failed to persist sync result", updateRunError));
  }

  return {
    run_id: runId,
    status,
    records_checked: matResult.checked,
    records_new: matResult.new_count,
    records_modified: matResult.modified,
    records_unchanged: matResult.unchanged,
    records_errors: recordsErrors + (updateRunError ? 1 : 0),
    records_skipped: matResult.skipped,
    price_changes: priceChanges,
    stale_marked: staleResult.count,
    duration_ms: Date.now() - startTime,
    errors,
  };
}

// ─── Materialize current prices ──────────────────────────────────────────────

interface MaterializeResult {
  checked: number;
  new_count: number;
  modified: number;
  unchanged: number;
  error_count: number;
  skipped: number;
  skipped_by_reason: Record<string, number>;
  skipped_examples: Array<{ product_id: string; reason: string }>;
  unknown_source_count: number;
  unknown_source_examples: Array<{ product_id: string; source: string }>;
  fatal: boolean;
  changes: PriceChange[];
  errors: string[];
}

interface SyncProductRow {
  id: string;
  commercial_name: string;
  provider_id: string;
  concept_id: string | null;
  sale_unit: string | null;
  units_per_package: number | null;
  unit_price: number | null;
  is_available: boolean | null;
  pb_providers: unknown;
}

interface CurrentPriceRow {
  product_id: string;
  price_excl_vat: number;
  is_available: boolean;
}

/**
 * For each active product, find the most recent observation and upsert
 * into pb_price_current. Tracks which prices changed.
 */
async function materializeCurrentPrices(
  supabase: SupabaseClient,
  config: SyncConfig
): Promise<MaterializeResult> {
  const result: MaterializeResult = {
    checked: 0,
    new_count: 0,
    modified: 0,
    unchanged: 0,
    error_count: 0,
    skipped: 0,
    skipped_by_reason: {},
    skipped_examples: [],
    unknown_source_count: 0,
    unknown_source_examples: [],
    fatal: false,
    changes: [],
    errors: [],
  };

  // PostgREST caps a response at max-rows (1,000 in production). Page both
  // source tables explicitly; otherwise a "successful" full sync silently
  // materializes only the first page of the catalogue.
  const products: SyncProductRow[] = [];
  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    let productQuery = supabase
      .from("pb_products")
      .select(`
        id, commercial_name, provider_id, concept_id, sale_unit,
        units_per_package, unit_price, is_available,
        pb_providers!inner ( id, name )
      `)
      .eq("is_active", true)
      .order("id", { ascending: true });

    if (config.scope === "provider" && config.scope_id) {
      productQuery = productQuery.eq("provider_id", config.scope_id);
    }

    const { data: page, error: prodErr } = await productQuery.range(
      from,
      from + POSTGREST_PAGE_SIZE - 1,
    );

    if (prodErr) {
      result.errors.push(`Failed to fetch products: ${prodErr.message}`);
      result.error_count++;
      result.fatal = true;
      return result;
    }

    products.push(...(page ?? []));
    if (!page || page.length < POSTGREST_PAGE_SIZE) break;
  }

  if (!products || products.length === 0) {
    return result;
  }

  // Fetch existing current prices for comparison
  const existingPrices: CurrentPriceRow[] = [];
  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const { data: page, error: existingPricesError } = await supabase
      .from("pb_price_current")
      .select("product_id, price_excl_vat, is_available")
      .order("product_id", { ascending: true })
      .range(from, from + POSTGREST_PAGE_SIZE - 1);

    if (existingPricesError) {
      result.errors.push(queryError("Failed to fetch current prices", existingPricesError));
      result.error_count++;
      result.fatal = true;
      return result;
    }

    existingPrices.push(...(page ?? []));
    if (!page || page.length < POSTGREST_PAGE_SIZE) break;
  }

  const existingMap = new Map<string, { price: number; available: boolean }>();
  for (const ep of existingPrices || []) {
    existingMap.set(ep.product_id, {
      price: Number(ep.price_excl_vat),
      available: Boolean(ep.is_available),
    });
  }

  // Process in batches
  const BATCH = 50;

  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const productIds = batch.map((p) => p.id);
    const upserts: Array<Record<string, unknown>> = [];
    const outcomes: Array<{ isNew: boolean; priceChanged: boolean }> = [];

    // Get latest observation for each product in this batch
    const { data: observations, error: observationsError } = await supabase
      .from("pb_price_observations")
      .select("id, product_id, provider_id, observed_price, observed_at, source, source_url, currency, metadata, created_at")
      .in("product_id", productIds)
      .order("observed_at", { ascending: false });

    if (observationsError) {
      result.errors.push(queryError("Failed to fetch price observations", observationsError));
      result.error_count++;
      result.fatal = true;
      return result;
    }

    // Group by product_id, take latest per product
    const latestByProduct = new Map<string, Record<string, unknown>>();
    for (const obs of observations || []) {
      if (!latestByProduct.has(obs.product_id)) {
        latestByProduct.set(obs.product_id, obs);
      }
    }

    // Build upserts
    for (const product of batch) {
      result.checked++;

      const obs = latestByProduct.get(product.id);
      const provRaw = product.pb_providers as unknown;
      const prov = Array.isArray(provRaw) ? provRaw[0] as Record<string, unknown> | undefined : provRaw as Record<string, unknown> | null;
      const providerName = String(prov?.name ?? "");

      const metadata = obs ? observationMetadata(obs) : {};
      // Old product rows also copied package labels into sale_unit, and some
      // observations have no price_basis metadata. Falling back to sale_unit
      // keeps those rows from publishing a package price as a unit price.
      const priceBasis = metadata.price_basis ?? product.sale_unit;
      const normalized = observedUnitPrice(
        obs ? obs.observed_price : product.unit_price,
        priceBasis,
        product.sale_unit,
        product.units_per_package,
        product.commercial_name,
      );

      if (normalized.price === null) {
        const reason = normalized.reason ?? "unsafe price normalization";
        const reasonKey = skippedReasonKey(reason);
        result.skipped++;
        result.skipped_by_reason[reasonKey] = (result.skipped_by_reason[reasonKey] ?? 0) + 1;
        if (result.skipped_examples.length < MAX_SKIPPED_EXAMPLES) {
          result.skipped_examples.push({ product_id: product.id, reason });
        }
        continue;
      }

      // Use observation price if available, else product base price
      const price = normalized.price;
      const isAvailable = Boolean(product.is_available);
      const evidenceType = metadata.evidence_type;
      const confidence = obs ? confidenceForEvidence(evidenceType) : 0.30;
      const checkedAt = obs ? String(obs.observed_at) : new Date().toISOString();
      const rawSource = String(obs?.source ?? "").trim().toLowerCase();
      const sourceType = obs
        ? priceSyncSourceType(rawSource)
        : "product_base";
      if (obs && !PRICE_SYNC_SOURCE_TYPE_SET.has(rawSource)) {
        result.unknown_source_count++;
        if (result.unknown_source_examples.length < MAX_SKIPPED_EXAMPLES) {
          result.unknown_source_examples.push({
            product_id: product.id,
            source: rawSource.slice(0, 100) || "(missing)",
          });
        }
      }

      // Compare with existing
      const existing = existingMap.get(product.id);
      const isNew = !existing;
      const priceChanged = existing && Math.abs(existing.price - price) > 0.001;

      if (priceChanged && existing) {
        const changePct = existing.price > 0
          ? ((price - existing.price) / existing.price) * 100
          : 0;

        result.changes.push({
          product_id: product.id,
          product_name: product.commercial_name,
          provider_id: product.provider_id,
          provider_name: providerName,
          old_price: existing.price,
          new_price: price,
          change_pct: Math.round(changePct * 100) / 100,
          direction: price > existing.price ? "up" : "down",
        });
      }

      upserts.push({
        product_id: product.id,
        observation_id: obs?.id ?? null,
        provider_id: product.provider_id,
        concept_id: product.concept_id,
        price_excl_vat: price,
        confidence_score: confidence,
        region: "ES",
        is_available: isAvailable,
        source_type: sourceType,
        checked_at: checkedAt,
        price_changed_at: priceChanged ? new Date().toISOString() : undefined,
      });
      outcomes.push({ isNew, priceChanged: Boolean(priceChanged) });
    }

    if (upserts.length === 0) continue;

    const { error: upsertErr } = await supabase
      .from("pb_price_current")
      .upsert(upserts, { onConflict: "product_id" });

    if (upsertErr) {
      result.error_count += upserts.length;
      result.fatal = true;
      result.errors.push(
        `Upsert batch ${i / BATCH + 1} (${upserts.length} products): ${upsertErr.message}`,
      );
      continue;
    }

    for (const outcome of outcomes) {
      if (outcome.isNew) result.new_count++;
      else if (outcome.priceChanged) result.modified++;
      else result.unchanged++;
    }
  }

  return result;
}

// ─── Stale price cleanup ─────────────────────────────────────────────────────

/**
 * Mark products as unavailable if their latest check is older than
 * staleness_days. Returns count of rows updated.
 */
async function markStalePrices(
  supabase: SupabaseClient,
  staleness_days: number
): Promise<StalePriceResult> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - staleness_days);

  const { data, error } = await supabase
    .from("pb_price_current")
    .update({ is_available: false })
    .eq("is_available", true)
    .lt("checked_at", cutoff.toISOString())
    .select("id");

  if (error) {
    return {
      count: 0,
      error: queryError("Failed to mark stale prices", error),
    };
  }

  return { count: data?.length ?? 0, error: null };
}

// ─── Get last sync info ──────────────────────────────────────────────────────

export interface SyncStatus {
  last_run: PBSyncRun | null;
  total_products: number;
  total_available: number;
  total_stale: number;
  last_completed_at: string | null;
}

export async function getSyncStatus(supabase: SupabaseClient): Promise<SyncStatus> {
  const [
    { data: lastRun, error: lastRunError },
    { count: totalProducts, error: totalProductsError },
    { count: totalAvailable, error: totalAvailableError },
  ] = await Promise.all([
    supabase
      .from("pb_sync_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("pb_price_current")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("pb_price_current")
      .select("*", { count: "exact", head: true })
      .eq("is_available", true),
  ]);

  const statusErrors = [
    lastRunError && queryError("Failed to fetch last sync run", lastRunError),
    totalProductsError && queryError("Failed to count current prices", totalProductsError),
    totalAvailableError && queryError("Failed to count available prices", totalAvailableError),
  ].filter((value): value is string => Boolean(value));

  if (statusErrors.length > 0) throw new Error(statusErrors.join("; "));

  const total = totalProducts ?? 0;
  const available = totalAvailable ?? 0;

  return {
    last_run: lastRun as PBSyncRun | null,
    total_products: total,
    total_available: available,
    total_stale: total - available,
    last_completed_at: lastRun?.finished_at ?? null,
  };
}
