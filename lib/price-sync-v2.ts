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
  price_changes: PriceChange[];
  stale_marked: number;
  duration_ms: number;
  errors: string[];
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
    const { data: existing } = await supabase
      .from("pb_sync_runs")
      .select("id, status")
      .eq("idempotency_key", cfg.idempotency_key)
      .in("status", ["completed", "processing"])
      .limit(1);

    if (existing && existing.length > 0) {
      return {
        run_id: existing[0].id,
        status: "completed",
        records_checked: 0,
        records_new: 0,
        records_modified: 0,
        records_unchanged: 0,
        records_errors: 0,
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
      records_errors: 0,
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

  // 5. Clean stale prices
  const staleCount = await markStalePrices(supabase, cfg.staleness_days);

  // 6. Update sync run
  const status = errors.length > 0 && matResult.checked === 0 ? "error" as const
    : errors.length > 0 ? "partial" as const
    : "completed" as const;

  await supabase
    .from("pb_sync_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      records_checked: matResult.checked,
      records_new: matResult.new_count,
      records_modified: matResult.modified,
      records_unchanged: matResult.unchanged,
      records_errors: matResult.error_count,
      summary: {
        stale_marked: staleCount,
        price_changes_above_threshold: priceChanges.length,
        config: cfg,
      },
      error_log: errors.map((e) => ({ message: e, at: new Date().toISOString() })),
    })
    .eq("id", runId);

  return {
    run_id: runId,
    status,
    records_checked: matResult.checked,
    records_new: matResult.new_count,
    records_modified: matResult.modified,
    records_unchanged: matResult.unchanged,
    records_errors: matResult.error_count,
    price_changes: priceChanges,
    stale_marked: staleCount,
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
    return result;
  }

  if (!products || products.length === 0) {
    return result;
  }

  // Fetch existing current prices for comparison
  const { data: existingPrices } = await supabase
    .from("pb_price_current")
    .select("product_id, price_excl_vat, is_available");

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
    const { data: observations } = await supabase
      .from("pb_price_observations")
      .select("*")
      .in("product_id", productIds)
      .order("checked_at", { ascending: false });

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

      // Use observation price if available, else product base price
      const price = obs
        ? Number(obs.price_excl_vat) || 0
        : Number(product.unit_price) || 0;

      const isAvailable = obs ? Boolean(obs.is_available) : Boolean(product.is_available);
      const confidence = obs ? Number(obs.confidence_score) || 0.5 : 0.4;
      const checkedAt = obs ? String(obs.checked_at) : new Date().toISOString();

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
            region: obs?.region ?? "ES",
            is_available: isAvailable,
            source_type: obs?.source_type ?? "provider_catalog",
            checked_at: checkedAt,
            price_changed_at: priceChanged ? new Date().toISOString() : undefined,
          },
          { onConflict: "product_id" }
        );

      if (upsertErr) {
        result.error_count++;
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
): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - staleness_days);

  const { data, error } = await supabase
    .from("pb_price_current")
    .update({ is_available: false })
    .eq("is_available", true)
    .lt("checked_at", cutoff.toISOString())
    .select("id");

  if (error) {
    console.error("[PriceSync] Stale cleanup error:", error.message);
    return 0;
  }

  return data?.length ?? 0;
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
    { data: lastRun },
    { count: totalProducts },
    { count: totalAvailable },
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
