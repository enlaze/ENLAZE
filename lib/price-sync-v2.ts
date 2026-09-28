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

const PACKAGE_BASES = new Set([
  "caja",
  "saco",
  "rollo",
  "paquete",
  "pack",
  "palet",
  "pallet",
  "bobina",
  "bidon",
]);

function queryError(prefix: string, error: QueryError): string {
  return `${prefix}: ${error?.message || "unknown database error"}`;
}

function normalizeUnit(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/[._\s/-]+/g, "");

  const aliases: Record<string, string> = {
    u: "ud",
    unidad: "ud",
    unidades: "ud",
    metro: "m",
    metros: "m",
    metrocuadrado: "m2",
    metroscuadrados: "m2",
    metrocubico: "m3",
    metroscubicos: "m3",
    litro: "l",
    litros: "l",
    ltr: "l",
    kilogramo: "kg",
    kilogramos: "kg",
    hora: "h",
    horas: "h",
  };

  return aliases[normalized] ?? normalized;
}

function observationMetadata(observation: Record<string, unknown>): Record<string, unknown> {
  const metadata = observation.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
}

export function confidenceForEvidence(evidenceType: unknown): number {
  return OBSERVATION_CONFIDENCE[String(evidenceType ?? "")] ?? 0.55;
}

export function observedUnitPrice(
  observedPrice: unknown,
  priceBasis: unknown,
  saleUnit: unknown,
  unitsPerPackage: unknown
): { price: number | null; reason: string | null } {
  const price = Number(observedPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { price: null, reason: "observed_price is not a positive finite number" };
  }

  const basis = normalizeUnit(priceBasis);
  if (!basis) return { price, reason: null };

  const unit = normalizeUnit(saleUnit);
  const quantity = Number(unitsPerPackage);

  // Package labels describe the price of the whole package even when an old
  // product row copied that same label into sale_unit. Never let that equality
  // turn a box/sack/roll price into a unit price.
  if (PACKAGE_BASES.has(basis) && Number.isFinite(quantity) && quantity > 1) {
    return { price: price / quantity, reason: null };
  }

  if (!PACKAGE_BASES.has(basis) && (basis === unit || (basis === "ud" && (!unit || unit === "ud")))) {
    return { price, reason: null };
  }

  if (!PACKAGE_BASES.has(basis) && Number.isFinite(quantity) && quantity > 1) {
    return { price: price / quantity, reason: null };
  }

  const displayBasis = String(priceBasis).trim();
  const kind = PACKAGE_BASES.has(basis) ? "package" : "non-unit";
  return {
    price: null,
    reason: `${kind} price_basis '${displayBasis}' has no usable units_per_package`,
  };
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
  fatal: boolean;
  changes: PriceChange[];
  errors: string[];
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
    fatal: false,
    changes: [],
    errors: [],
  };

  // Fetch all active products with their providers
  let productQuery = supabase
    .from("pb_products")
    .select(`
      id, commercial_name, provider_id, concept_id, sale_unit,
      units_per_package, unit_price, is_available,
      pb_providers!inner ( id, name )
    `)
    .eq("is_active", true);

  if (config.scope === "provider" && config.scope_id) {
    productQuery = productQuery.eq("provider_id", config.scope_id);
  }

  const { data: products, error: prodErr } = await productQuery;

  if (prodErr) {
    result.errors.push(`Failed to fetch products: ${prodErr.message}`);
    result.error_count++;
    result.fatal = true;
    return result;
  }

  if (!products || products.length === 0) {
    return result;
  }

  // Fetch existing current prices for comparison
  const { data: existingPrices, error: existingPricesError } = await supabase
    .from("pb_price_current")
    .select("product_id, price_excl_vat, is_available");

  if (existingPricesError) {
    result.errors.push(queryError("Failed to fetch current prices", existingPricesError));
    result.error_count++;
    result.fatal = true;
    return result;
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
        product.units_per_package
      );

      if (normalized.price === null) {
        result.error_count++;
        result.skipped++;
        result.errors.push(`Skipped product ${product.id}: ${normalized.reason}`);
        continue;
      }

      // Use observation price if available, else product base price
      const price = normalized.price;
      const isAvailable = Boolean(product.is_available);
      const evidenceType = metadata.evidence_type;
      const confidence = confidenceForEvidence(evidenceType);
      const checkedAt = obs ? String(obs.observed_at) : new Date().toISOString();
      const sourceType = obs
        ? String(obs.source || evidenceType || "n8n")
        : "provider_catalog";

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

      // Upsert
      const { error: upsertErr } = await supabase
        .from("pb_price_current")
        .upsert(
          {
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
          },
          { onConflict: "product_id" }
        );

      if (upsertErr) {
        result.error_count++;
        result.fatal = true;
        result.errors.push(`Upsert product ${product.id}: ${upsertErr.message}`);
      } else if (isNew) {
        result.new_count++;
      } else if (priceChanged) {
        result.modified++;
      } else {
        result.unchanged++;
      }
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
