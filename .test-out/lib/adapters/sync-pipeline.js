"use strict";
/**
 * sync-pipeline.ts
 *
 * Orchestrates the price sync pipeline:
 *   1. Get adapter for source type
 *   2. Call adapter.fetch() → raw records
 *   3. Call adapter.normalize() → normalized records
 *   4. Call adapter.validate() → check quality
 *   5. Persist valid records to pb_products + pb_price_observations
 *   6. Track results in pb_sync_run_details
 *
 * This module handles all Supabase writes.
 * Adapters remain pure (no DB access).
 *
 * Used by:
 *   - /api/prices/sync/update (scheduled/manual sync)
 *   - /api/prices/sync/webhook (n8n push, via N8nWebhookAdapter)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncSource = syncSource;
const base_adapter_1 = require("./base-adapter");
// ─── Pipeline ────────────────────────────────────────────────────────────
/**
 * Run the sync pipeline for a single source.
 * Returns detailed results for tracking.
 */
async function syncSource(supabase, source, provider, run_id) {
    const sourceType = source.source_type;
    // Check if adapter exists
    if (!(0, base_adapter_1.hasAdapter)(sourceType)) {
        return {
            source_id: source.id,
            source_name: source.name,
            status: "skipped",
            records_checked: 0,
            records_new: 0,
            records_modified: 0,
            records_unchanged: 0,
            records_rejected: 0,
            records_errors: 0,
            errors: [],
            warnings: [`No adapter registered for source_type: ${sourceType}`],
        };
    }
    const adapter = (0, base_adapter_1.getAdapter)(sourceType);
    const context = {
        source,
        provider,
        region: source.region || source.country || "ES",
        run_id,
    };
    // Create detail record
    const { data: detail } = await supabase
        .from("pb_sync_run_details")
        .insert({
        run_id,
        source_id: source.id,
        provider_id: source.provider_id,
        status: "processing",
        started_at: new Date().toISOString(),
    })
        .select("id")
        .single();
    try {
        // Step 1: Fetch
        const fetchResult = await adapter.fetch(context);
        if (fetchResult.errors.length > 0) {
            const errorResult = {
                source_id: source.id,
                source_name: source.name,
                status: "error",
                records_checked: 0,
                records_new: 0,
                records_modified: 0,
                records_unchanged: 0,
                records_rejected: 0,
                records_errors: fetchResult.errors.length,
                errors: fetchResult.errors.map((e) => ({
                    product: "fetch",
                    error: e.message,
                })),
                warnings: fetchResult.warnings,
            };
            await finalizeDetail(supabase, detail?.id, errorResult);
            return errorResult;
        }
        if (fetchResult.records.length === 0) {
            const emptyResult = {
                source_id: source.id,
                source_name: source.name,
                status: "completed",
                records_checked: 0,
                records_new: 0,
                records_modified: 0,
                records_unchanged: 0,
                records_rejected: 0,
                records_errors: 0,
                errors: [],
                warnings: fetchResult.warnings,
            };
            await finalizeDetail(supabase, detail?.id, emptyResult);
            return emptyResult;
        }
        // Step 2: Normalize
        const normalized = adapter.normalize(fetchResult.records, context);
        // Step 3: Validate
        const validation = adapter.validate(normalized);
        // Split into valid and rejected
        const validRecords = [];
        const rejectedIndices = new Set();
        for (const errMsg of validation.errors) {
            const match = errMsg.match(/^\[(\d+)\]/);
            if (match) {
                rejectedIndices.add(parseInt(match[1], 10));
            }
        }
        for (let i = 0; i < normalized.length; i++) {
            if (!rejectedIndices.has(i)) {
                validRecords.push(normalized[i]);
            }
        }
        // Step 4: Persist valid records
        const providerId = provider?.id || source.provider_id;
        if (!providerId) {
            throw new Error(`No provider_id available for source "${source.name}"`);
        }
        const persistResult = await persistRecords(supabase, validRecords, providerId, source.id);
        // Step 5: Update source timestamps
        await supabase
            .from("pb_price_sources")
            .update({
            last_checked_at: new Date().toISOString(),
            last_success_at: persistResult.errors === 0
                ? new Date().toISOString()
                : undefined,
            status: persistResult.errors === 0 ? "active" : "error",
            last_error: persistResult.errors > 0
                ? `${persistResult.errors} records failed`
                : null,
            updated_at: new Date().toISOString(),
        })
            .eq("id", source.id);
        const result = {
            source_id: source.id,
            source_name: source.name,
            status: persistResult.errors > 0
                ? "partial"
                : "completed",
            records_checked: normalized.length,
            records_new: persistResult.new,
            records_modified: persistResult.modified,
            records_unchanged: persistResult.unchanged,
            records_rejected: rejectedIndices.size,
            records_errors: persistResult.errors,
            errors: [
                ...validation.errors.map((e) => ({ product: "validation", error: e })),
                ...persistResult.errorDetails,
            ],
            warnings: [
                ...fetchResult.warnings,
                ...validation.warnings,
            ],
        };
        await finalizeDetail(supabase, detail?.id, result);
        return result;
    }
    catch (err) {
        const errorResult = {
            source_id: source.id,
            source_name: source.name,
            status: "error",
            records_checked: 0,
            records_new: 0,
            records_modified: 0,
            records_unchanged: 0,
            records_rejected: 0,
            records_errors: 1,
            errors: [{ product: "pipeline", error: err.message || "Unknown error" }],
            warnings: [],
        };
        await finalizeDetail(supabase, detail?.id, errorResult);
        return errorResult;
    }
}
// ─── Persistence ─────────────────────────────────────────────────────────
/**
 * Persist normalized records to pb_products + pb_price_observations.
 * The DB trigger on pb_price_observations auto-updates pb_price_current.
 */
async function persistRecords(supabase, records, providerId, sourceId) {
    let newCount = 0;
    let modifiedCount = 0;
    let unchangedCount = 0;
    let errorCount = 0;
    const errorDetails = [];
    for (const record of records) {
        try {
            // Check for duplicate observation via dedup_hash
            const { data: existingObs } = await supabase
                .from("pb_price_observations")
                .select("id")
                .eq("dedup_hash", record.dedup_hash)
                .limit(1);
            if (existingObs && existingObs.length > 0) {
                unchangedCount++;
                continue;
            }
            // Upsert product
            const { data: existingProduct } = await supabase
                .from("pb_products")
                .select("id, unit_price")
                .eq("provider_id", providerId)
                .eq("commercial_name", record.product_name)
                .eq("sale_unit", record.normalized_unit || record.unit)
                .limit(1);
            let productId;
            if (existingProduct && existingProduct.length > 0) {
                productId = existingProduct[0].id;
                const priceChanged = existingProduct[0].unit_price !== record.price_excl_vat;
                await supabase
                    .from("pb_products")
                    .update({
                    description: record.description || "",
                    brand: record.brand || null,
                    model: record.model || null,
                    sku: record.sku || null,
                    ean: record.ean || null,
                    units_per_package: record.units_per_package,
                    unit_price: record.price_excl_vat,
                    vat_rate: record.vat_pct,
                    url: record.url || null,
                    is_available: record.is_available,
                    checked_at: new Date().toISOString(),
                    is_active: true,
                    updated_at: new Date().toISOString(),
                })
                    .eq("id", productId);
                if (priceChanged) {
                    modifiedCount++;
                }
                else {
                    unchangedCount++;
                }
            }
            else {
                const { data: newProduct, error: prodError } = await supabase
                    .from("pb_products")
                    .insert({
                    provider_id: providerId,
                    concept_id: null,
                    concept_match_type: "none",
                    commercial_name: record.product_name,
                    description: record.description || "",
                    brand: record.brand || null,
                    model: record.model || null,
                    sku: record.sku || null,
                    ean: record.ean || null,
                    sale_unit: record.normalized_unit || record.unit,
                    units_per_package: record.units_per_package,
                    unit_price: record.price_excl_vat,
                    vat_rate: record.vat_pct,
                    url: record.url || null,
                    region: record.region || "ES",
                    is_available: record.is_available,
                    checked_at: new Date().toISOString(),
                    is_active: true,
                })
                    .select("id")
                    .single();
                if (prodError || !newProduct) {
                    throw new Error(`Failed to create product: ${prodError?.message}`);
                }
                productId = newProduct.id;
                newCount++;
            }
            // Create price observation
            const confidence = record.raw_data
                ?.confidence_score ?? 0.80;
            const { error: obsError } = await supabase
                .from("pb_price_observations")
                .insert({
                product_id: productId,
                provider_id: providerId,
                source_id: sourceId,
                price_excl_vat: record.price_excl_vat,
                vat_pct: record.vat_pct,
                shipping_cost: record.shipping_cost,
                other_costs: record.other_costs,
                discount_pct: record.discount_pct,
                effective_price: record.effective_price,
                is_available: record.is_available,
                region: record.region || "ES",
                checked_at: new Date().toISOString(),
                confidence_score: confidence,
                dedup_hash: record.dedup_hash,
                raw_data: record.raw_data || null,
            });
            if (obsError) {
                throw new Error(`Failed to create observation: ${obsError.message}`);
            }
        }
        catch (err) {
            errorCount++;
            errorDetails.push({
                product: record.product_name,
                error: err.message || "Unknown error",
            });
        }
    }
    return {
        new: newCount,
        modified: modifiedCount,
        unchanged: unchangedCount,
        errors: errorCount,
        errorDetails,
    };
}
// ─── Helpers ─────────────────────────────────────────────────────────────
async function finalizeDetail(supabase, detailId, result) {
    if (!detailId)
        return;
    await supabase
        .from("pb_sync_run_details")
        .update({
        status: result.status,
        finished_at: new Date().toISOString(),
        records_checked: result.records_checked,
        records_new: result.records_new,
        records_modified: result.records_modified,
        records_unchanged: result.records_unchanged,
        records_rejected: result.records_rejected,
        records_errors: result.records_errors,
        errors: result.errors.length > 0
            ? result.errors
            : [],
    })
        .eq("id", detailId);
}
