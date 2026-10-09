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
 * tracks everything in pb_sync_runs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PBSyncRun } from "./types/price-bank";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncConfig {
  /** Default max age; source-specific windows override it when configured */
  staleness_days: number;
  /** Minimum % change to trigger a price change alert (e.g. 5 = 5%) */
  change_threshold_pct: number;
  /** Scope of sync: all products, a specific source, or a specific provider */
  scope: "all" | "source" | "provider";
  /** If scope=source or provider, the target ID */
  scope_id?: string;
  /** Idempotency key for dedup (e.g. "daily-2026-07-16") */
  idempotency_key?: string;
  /** Continue strictly after this product id */
  resume_after_id?: string;
  /** Stop cleanly at a batch boundary before the platform timeout */
  time_budget_ms: number;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  staleness_days: 30,
  change_threshold_pct: 5,
  scope: "all",
  time_budget_ms: 240_000,
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
  skipped_by_reason: Record<string, number>;
  price_changes: PriceChange[];
  stale_marked: number;
  stale_marked_by_source: Record<string, number>;
  duration_ms: number;
  errors: string[];
  resume_after_id: string | null;
}

export interface SyncRuntime {
  now: () => number;
}

type QueryError = { message?: string } | null;

type StalePriceResult = {
  count: number;
  by_source: Record<string, number>;
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

export const PRICE_STALENESS_DAYS_BY_SOURCE = Object.freeze({
  // A fixed TTL is only a temporary substitute for provider catalogues. Their
  // correct invalidation signal is a newly published edition, which the
  // OBRAMAT workflow already detects by fingerprint. Remove this 400-day
  // fallback once that edition-change signal reaches the current-price bank.
  provider_catalog: 400,
  n8n: 30,
  product_base: 30,
} as const);

type PriceSyncSourceType = typeof PRICE_SYNC_SOURCE_TYPES[number];

const PRICE_SYNC_SOURCE_TYPE_SET = new Set<string>(PRICE_SYNC_SOURCE_TYPES);
const MAX_SKIPPED_EXAMPLES = 20;
const POSTGREST_FETCH_LIMIT = 1_000;
const POSTGREST_PAGE_SIZE = POSTGREST_FETCH_LIMIT - 1;
const PRODUCT_BATCH_SIZE = 500;

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
  config: Partial<SyncConfig> = {},
  runtime: SyncRuntime = { now: Date.now },
): Promise<SyncResult> {
  const cfg = { ...DEFAULT_SYNC_CONFIG, ...config };
  const startTime = runtime.now();
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
        skipped_by_reason: {},
        price_changes: [],
        stale_marked: 0,
        stale_marked_by_source: {},
        duration_ms: runtime.now() - startTime,
        errors: [queryError("Failed to check sync idempotency", existingError)],
        resume_after_id: cfg.resume_after_id ?? null,
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
        skipped_by_reason: {},
        price_changes: [],
        stale_marked: 0,
        stale_marked_by_source: {},
        duration_ms: 0,
        errors: ["Sync already completed for this idempotency key"],
        resume_after_id: null,
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
      skipped_by_reason: {},
      price_changes: [],
      stale_marked: 0,
      stale_marked_by_source: {},
      duration_ms: runtime.now() - startTime,
      errors: [`Failed to create sync run: ${runErr?.message}`],
      resume_after_id: cfg.resume_after_id ?? null,
    };
  }

  const runId = run.id;

  // 3. Materialize current prices
  const matResult = await materializeCurrentPrices(supabase, cfg, startTime, runtime);
  errors.push(...matResult.errors);

  // 4. Detect price changes
  const priceChanges = matResult.changes.filter(
    (c) => Math.abs(c.change_pct) >= cfg.change_threshold_pct
  );

  // 5. Clean stale prices only when materialization did not hit a fatal query
  // error. Continuing after a failed read is how the old implementation hid a
  // broken observation schema behind a successful run.
  const staleResult: StalePriceResult = matResult.fatal || matResult.time_budget_exhausted
    ? { count: 0, by_source: {}, error: null }
    : await markStalePrices(supabase, cfg.staleness_days, runtime.now());
  if (staleResult.error) errors.push(staleResult.error);
  const recordsErrors = matResult.error_count + (staleResult.error ? 1 : 0);

  // 6. Update sync run
  let status: SyncResult["status"] = matResult.fatal || staleResult.error
    ? "error"
    : matResult.time_budget_exhausted
      ? "partial"
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
        stale_marked_by_source: staleResult.by_source,
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
        time_budget_exhausted: matResult.time_budget_exhausted,
        resume_after_id: matResult.resume_after_id,
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
    skipped_by_reason: matResult.skipped_by_reason,
    price_changes: priceChanges,
    stale_marked: staleResult.count,
    stale_marked_by_source: staleResult.by_source,
    duration_ms: runtime.now() - startTime,
    errors,
    resume_after_id: matResult.resume_after_id,
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
  time_budget_exhausted: boolean;
  resume_after_id: string | null;
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
  id: string;
  product_id: string;
  price_excl_vat: number;
  is_available: boolean;
}

function withoutProbe<T>(page: T[]): { rows: T[]; hasMore: boolean } {
  const hasMore = page.length === POSTGREST_FETCH_LIMIT;
  return {
    rows: hasMore ? page.slice(0, POSTGREST_PAGE_SIZE) : page,
    hasMore,
  };
}

function observationCursorFilter(observedAt: string, id: string): string {
  return `observed_at.lt.${observedAt},and(observed_at.eq.${observedAt},id.gt.${id})`;
}

/**
 * For each active product, find the most recent observation and upsert
 * into pb_price_current. Tracks which prices changed.
 */
async function materializeCurrentPrices(
  supabase: SupabaseClient,
  config: SyncConfig,
  startTime: number,
  runtime: SyncRuntime,
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
    time_budget_exhausted: false,
    resume_after_id: config.resume_after_id ?? null,
    changes: [],
    errors: [],
  };

  // Fetch existing prices with a stable keyset. Each request asks for one
  // probe row; the probe is not consumed and becomes the first row after the
  // next cursor. This distinguishes a full final page from a page with more
  // data without OFFSET scans.
  const existingMap = new Map<string, { price: number; available: boolean }>();
  let currentPriceCursor: string | null = null;
  while (true) {
    let currentPriceQuery = supabase
      .from("pb_price_current")
      .select("id, product_id, price_excl_vat, is_available")
      .order("id", { ascending: true })
      .limit(POSTGREST_FETCH_LIMIT);
    if (currentPriceCursor) {
      currentPriceQuery = currentPriceQuery.gt("id", currentPriceCursor);
    }

    const { data, error: existingPricesError } = await currentPriceQuery;
    if (existingPricesError) {
      result.errors.push(queryError("Failed to fetch current prices", existingPricesError));
      result.error_count++;
      result.fatal = true;
      return result;
    }

    const { rows, hasMore } = withoutProbe((data ?? []) as CurrentPriceRow[]);
    for (const row of rows) {
      existingMap.set(row.product_id, {
        price: Number(row.price_excl_vat),
        available: Boolean(row.is_available),
      });
    }
    if (!hasMore || rows.length === 0) break;
    currentPriceCursor = rows.at(-1)!.id;
  }

  // Products are consumed page by page so a partial run never needs to keep
  // the full catalogue in memory. The persisted cursor only advances after a
  // complete batch has been written (or deliberately skipped).
  let productCursor = config.resume_after_id ?? null;
  while (true) {
    let productQuery = supabase
      .from("pb_products")
      .select(`
        id, commercial_name, provider_id, concept_id, sale_unit,
        units_per_package, unit_price, is_available,
        pb_providers!inner ( id, name )
      `)
      .eq("is_active", true)
      .order("id", { ascending: true })
      .limit(POSTGREST_FETCH_LIMIT);

    if (config.scope === "provider" && config.scope_id) {
      productQuery = productQuery.eq("provider_id", config.scope_id);
    }
    if (productCursor) {
      productQuery = productQuery.gt("id", productCursor);
    }

    const { data, error: productError } = await productQuery;
    if (productError) {
      result.errors.push(queryError("Failed to fetch products", productError));
      result.error_count++;
      result.fatal = true;
      return result;
    }

    const { rows: products, hasMore: hasMoreProductPages } = withoutProbe(
      (data ?? []) as SyncProductRow[],
    );
    if (products.length === 0) break;

    for (let index = 0; index < products.length; index += PRODUCT_BATCH_SIZE) {
      const batch = products.slice(index, index + PRODUCT_BATCH_SIZE);
      const productIds = batch.map((product) => product.id);
      const upserts: Array<Record<string, unknown>> = [];
      const outcomes: Array<{ isNew: boolean; priceChanged: boolean }> = [];

      // Observations use a composite keyset because newest rows come first,
      // while id is the deterministic ascending tie-breaker.
      const observations: Array<Record<string, unknown>> = [];
      let observationCursor: { observedAt: string; id: string } | null = null;
      while (true) {
        let observationQuery = supabase
          .from("pb_price_observations")
          .select("id, product_id, provider_id, observed_price, observed_at, source, source_url, currency, metadata, created_at")
          .in("product_id", productIds)
          .order("observed_at", { ascending: false })
          .order("id", { ascending: true })
          .limit(POSTGREST_FETCH_LIMIT);
        if (observationCursor) {
          observationQuery = observationQuery.or(observationCursorFilter(
            observationCursor.observedAt,
            observationCursor.id,
          ));
        }

        const { data: observationData, error: observationsError } = await observationQuery;
        if (observationsError) {
          result.errors.push(queryError("Failed to fetch price observations", observationsError));
          result.error_count++;
          result.fatal = true;
          return result;
        }

        const { rows, hasMore } = withoutProbe(
          (observationData ?? []) as Array<Record<string, unknown>>,
        );
        observations.push(...rows);
        if (!hasMore || rows.length === 0) break;
        const last = rows.at(-1)!;
        observationCursor = {
          observedAt: String(last.observed_at),
          id: String(last.id),
        };
      }

      // Group by product_id, take latest per product.
      const latestByProduct = new Map<string, Record<string, unknown>>();
      for (const observation of observations) {
        const productId = String(observation.product_id);
        if (!latestByProduct.has(productId)) {
          latestByProduct.set(productId, observation);
        }
      }

      for (const product of batch) {
        result.checked++;

        const obs = latestByProduct.get(product.id);
        const provRaw = product.pb_providers as unknown;
        const prov = Array.isArray(provRaw) ? provRaw[0] as Record<string, unknown> | undefined : provRaw as Record<string, unknown> | null;
        const providerName = String(prov?.name ?? "");

        const metadata = obs ? observationMetadata(obs) : {};
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

        const price = normalized.price;
        const isAvailable = Boolean(product.is_available);
        const evidenceType = metadata.evidence_type;
        const confidence = obs ? confidenceForEvidence(evidenceType) : 0.30;
        const checkedAt = obs ? String(obs.observed_at) : new Date().toISOString();
        const rawSource = String(obs?.source ?? "").trim().toLowerCase();
        const sourceType = obs ? priceSyncSourceType(rawSource) : "product_base";
        if (obs && !PRICE_SYNC_SOURCE_TYPE_SET.has(rawSource)) {
          result.unknown_source_count++;
          if (result.unknown_source_examples.length < MAX_SKIPPED_EXAMPLES) {
            result.unknown_source_examples.push({
              product_id: product.id,
              source: rawSource.slice(0, 100) || "(missing)",
            });
          }
        }

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

      if (upserts.length > 0) {
        const { error: upsertError } = await supabase
          .from("pb_price_current")
          .upsert(upserts, { onConflict: "product_id" });

        if (upsertError) {
          result.error_count += upserts.length;
          result.fatal = true;
          result.errors.push(
            `Upsert batch (${upserts.length} products): ${upsertError.message}`,
          );
          return result;
        }

        for (const outcome of outcomes) {
          if (outcome.isNew) result.new_count++;
          else if (outcome.priceChanged) result.modified++;
          else result.unchanged++;
        }
      }

      productCursor = batch.at(-1)!.id;
      result.resume_after_id = productCursor;

      const moreProductsRemain = index + batch.length < products.length
        || hasMoreProductPages;
      if (moreProductsRemain && runtime.now() - startTime >= config.time_budget_ms) {
        result.time_budget_exhausted = true;
        return result;
      }
    }

    if (!hasMoreProductPages) break;
  }

  result.resume_after_id = null;
  return result;
}

// ─── Stale price cleanup ─────────────────────────────────────────────────────

/**
 * Mark products as unavailable if their latest check exceeds the window for
 * their source. staleness_days is the fallback for sources without an
 * explicit override. Returns the total and a per-source breakdown.
 */
async function markStalePrices(
  supabase: SupabaseClient,
  staleness_days: number,
  now: number,
): Promise<StalePriceResult> {
  const bySource: Record<string, number> = {};
  let count = 0;
  const overriddenSources = Object.keys(PRICE_STALENESS_DAYS_BY_SOURCE);
  const windows: Array<{ sourceType: string; days: number; fallback: boolean }> =
    Object.entries(PRICE_STALENESS_DAYS_BY_SOURCE).map(
    ([sourceType, days]) => ({ sourceType, days, fallback: false }),
  );
  windows.push({ sourceType: "", days: staleness_days, fallback: true });

  for (const window of windows) {
    const cutoff = new Date(now - window.days * 24 * 60 * 60 * 1_000).toISOString();
    let query = supabase
      .from("pb_price_current")
      .update({ is_available: false })
      .eq("is_available", true);

    query = window.fallback
      ? query.not("source_type", "in", `(${overriddenSources.join(",")})`)
      : query.eq("source_type", window.sourceType);

    const { data, error } = await query
      .lt("checked_at", cutoff)
      .select("id, source_type");

    if (error) {
      const target = window.fallback ? "default sources" : window.sourceType;
      return {
        count,
        by_source: bySource,
        error: queryError(`Failed to mark stale prices for ${target}`, error),
      };
    }

    for (const row of data ?? []) {
      const sourceType = String(row.source_type ?? "unknown");
      bySource[sourceType] = (bySource[sourceType] ?? 0) + 1;
      count += 1;
    }
  }

  return { count, by_source: bySource, error: null };
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
