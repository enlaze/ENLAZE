/**
 * POST /api/pb/webhook
 *
 * Robust webhook receiver for n8n scraping workflows.
 * Receives product/price data scraped from external sources (BigMat,
 * Leroy Merlin, Obramat, manufacturer catalogs, etc.) and upserts
 * them into the Price Bank V2 tables.
 *
 * Auth: Bearer token (WEBHOOK_SECRET env var)
 *
 * Body (JSON):
 *   action: "upsert_products" | "upsert_prices" | "update_availability" | "bulk_import"
 *   source: { name, type, url? }
 *   provider: { name, nif?, website?, region? }
 *   items: Array of product/price objects
 *   metadata?: { scraped_at, workflow_id, run_id }
 *
 * Designed for resilience:
 *   - Idempotent (dedup by provider+sku or provider+name)
 *   - Partial success (processes all items, reports per-item errors)
 *   - Tracks sync runs for auditing
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import crypto from "crypto";

// Use service role for webhook (no cookie auth)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface WebhookSource {
  name: string;
  type: "n8n_webhook" | "api" | "feed";
  url?: string;
}

interface WebhookProvider {
  name: string;
  nif?: string;
  website?: string;
  region?: string;
  province?: string;
}

interface WebhookProduct {
  /** Product name (required) */
  name: string;
  /** Optional description */
  description?: string;
  /** SKU or reference code */
  sku?: string;
  /** EAN barcode */
  ean?: string;
  /** Brand name */
  brand?: string;
  /** Model */
  model?: string;
  /** Unit of sale: "ud", "m2", "ml", "kg", etc. */
  unit?: string;
  /** Units per package/lot */
  units_per_package?: number;
  /** Unit price excluding VAT (EUR) */
  price?: number;
  /** VAT rate (default 21) */
  vat_rate?: number;
  /** Product URL on the source website */
  url?: string;
  /** Category/chapter */
  category?: string;
  /** Is product currently available */
  is_available?: boolean;
  /** Region where price applies */
  region?: string;
}

interface WebhookMetadata {
  scraped_at?: string;
  workflow_id?: string;
  run_id?: string;
  n8n_execution_id?: string;
}

interface WebhookBody {
  action: "upsert_products" | "upsert_prices" | "update_availability" | "bulk_import";
  source: WebhookSource;
  provider: WebhookProvider;
  items: WebhookProduct[];
  company_id?: string | null;
  metadata?: WebhookMetadata;
}

interface WebhookResult {
  ok: boolean;
  action: string;
  provider_id: string;
  source_id: string;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ item: string; error: string }>;
  sync_run_id: string;
  duration_ms: number;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const startTime = Date.now();

  // Auth
  const authHeader = request.headers.get("authorization");
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json(
      { error: "WEBHOOK_SECRET no configurado en el servidor" },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${webhookSecret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Validate required fields
  if (!body.action) {
    return NextResponse.json({ error: "Campo 'action' requerido" }, { status: 400 });
  }
  if (!body.source?.name) {
    return NextResponse.json({ error: "Campo 'source.name' requerido" }, { status: 400 });
  }
  if (!body.provider?.name) {
    return NextResponse.json({ error: "Campo 'provider.name' requerido" }, { status: 400 });
  }
  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "'items' debe ser un array no vacío" }, { status: 400 });
  }

  try {
    const result = await processWebhook(body, startTime);
    const status = result.ok ? 200 : result.errors.length === result.processed ? 500 : 207;
    return NextResponse.json(result, { status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PB Webhook] Fatal error:", message);
    return NextResponse.json(
      { error: message, duration_ms: Date.now() - startTime },
      { status: 500 }
    );
  }
}

// ─── Core processing ──────────────────────────────────────────────────────────

async function processWebhook(
  body: WebhookBody,
  startTime: number
): Promise<WebhookResult> {
  const errors: Array<{ item: string; error: string }> = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const companyId = body.company_id ?? null;

  // 1. Get or create provider
  const providerId = await getOrCreateProvider(body.provider, companyId);

  // 2. Get or create price source
  const sourceId = await getOrCreateSource(body.source, providerId, companyId);

  // 3. Create sync run for tracking
  const syncRunId = await createSyncRun(sourceId, providerId, body.metadata);

  // 4. Process items based on action
  const now = new Date().toISOString();

  for (const item of body.items) {
    if (!item.name) {
      errors.push({ item: "(sin nombre)", error: "Nombre vacío" });
      skipped++;
      continue;
    }

    try {
      switch (body.action) {
        case "upsert_products":
        case "bulk_import": {
          const result = await upsertProduct(
            item, providerId, sourceId, companyId,
            body.provider.region || "ES", now
          );
          if (result === "created") created++;
          else if (result === "updated") updated++;
          else skipped++;
          break;
        }

        case "upsert_prices": {
          const result = await upsertPrice(
            item, providerId, sourceId,
            body.provider.region || "ES", now
          );
          if (result === "created") created++;
          else if (result === "updated") updated++;
          else skipped++;
          break;
        }

        case "update_availability": {
          const result = await updateAvailability(item, providerId);
          if (result) updated++;
          else skipped++;
          break;
        }

        default:
          errors.push({ item: item.name, error: `Acción no soportada: ${body.action}` });
          skipped++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ item: item.name, error: msg });
    }
  }

  // 5. Update sync run with results
  await finalizeSyncRun(syncRunId, {
    checked: body.items.length,
    new_count: created,
    modified: updated,
    unchanged: skipped,
    error_count: errors.length,
    errors,
  });

  return {
    ok: errors.length === 0,
    action: body.action,
    provider_id: providerId,
    source_id: sourceId,
    processed: body.items.length,
    created,
    updated,
    skipped,
    errors,
    sync_run_id: syncRunId,
    duration_ms: Date.now() - startTime,
  };
}

// ─── Provider management ──────────────────────────────────────────────────────

async function getOrCreateProvider(
  provider: WebhookProvider,
  companyId: string | null
): Promise<string> {
  // Try to find existing by name (+ company_id if not global)
  let query = supabase
    .from("pb_providers")
    .select("id")
    .eq("name", provider.name);

  if (companyId) {
    query = query.eq("company_id", companyId);
  } else {
    query = query.is("company_id", null);
  }

  const { data: existing } = await query.limit(1);

  if (existing && existing.length > 0) {
    return existing[0].id;
  }

  // Create new provider
  const { data: created, error } = await supabase
    .from("pb_providers")
    .insert({
      company_id: companyId,
      name: provider.name,
      legal_name: provider.name,
      nif: provider.nif ?? null,
      website: provider.website ?? null,
      country: "ES",
      autonomous_community: provider.region ?? null,
      province: provider.province ?? null,
      supply_zones: provider.region ? [provider.region] : ["*"],
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

  if (error || !created) {
    throw new Error(`Error creando proveedor "${provider.name}": ${error?.message}`);
  }

  return created.id;
}

// ─── Source management ────────────────────────────────────────────────────────

async function getOrCreateSource(
  source: WebhookSource,
  providerId: string,
  companyId: string | null
): Promise<string> {
  const { data: existing } = await supabase
    .from("pb_price_sources")
    .select("id")
    .eq("name", source.name)
    .eq("provider_id", providerId)
    .limit(1);

  if (existing && existing.length > 0) {
    // Update last_checked_at
    await supabase
      .from("pb_price_sources")
      .update({
        last_checked_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        status: "active",
      })
      .eq("id", existing[0].id);

    return existing[0].id;
  }

  const { data: created, error } = await supabase
    .from("pb_price_sources")
    .insert({
      company_id: companyId,
      name: source.name,
      source_type: source.type || "n8n_webhook",
      provider_id: providerId,
      country: "ES",
      url: source.url ?? null,
      update_frequency: "daily",
      last_checked_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
      status: "active",
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Error creando fuente "${source.name}": ${error?.message}`);
  }

  return created.id;
}

// ─── Product upsert ───────────────────────────────────────────────────────────

async function upsertProduct(
  item: WebhookProduct,
  providerId: string,
  sourceId: string,
  companyId: string | null,
  defaultRegion: string,
  now: string
): Promise<"created" | "updated" | "skipped"> {
  // Find existing by SKU or name+provider
  const dedupField = item.sku ? "sku" : "commercial_name";
  const dedupValue = item.sku || item.name;

  const { data: existing } = await supabase
    .from("pb_products")
    .select("id, unit_price")
    .eq("provider_id", providerId)
    .eq(dedupField, dedupValue)
    .limit(1);

  const price = item.price ?? 0;
  const region = item.region || defaultRegion;

  if (existing && existing.length > 0) {
    const productId = existing[0].id;
    const oldPrice = Number(existing[0].unit_price);

    // Update product
    await supabase
      .from("pb_products")
      .update({
        commercial_name: item.name,
        description: item.description || "",
        brand: item.brand ?? null,
        model: item.model ?? null,
        sku: item.sku ?? null,
        ean: item.ean ?? null,
        sale_unit: item.unit || "ud",
        units_per_package: item.units_per_package || 1,
        unit_price: price,
        vat_rate: item.vat_rate ?? 21,
        url: item.url ?? null,
        region,
        is_available: item.is_available ?? true,
        checked_at: now,
      })
      .eq("id", productId);

    // Only insert observation if price changed
    if (Math.abs(oldPrice - price) > 0.001) {
      await insertObservation(productId, providerId, sourceId, price, region, now);
    }

    return "updated";
  }

  // Create new product
  const { data: product, error: prodErr } = await supabase
    .from("pb_products")
    .insert({
      provider_id: providerId,
      concept_id: null,
      concept_match_type: "none",
      commercial_name: item.name,
      description: item.description || "",
      brand: item.brand ?? null,
      model: item.model ?? null,
      sku: item.sku ?? null,
      ean: item.ean ?? null,
      sale_unit: item.unit || "ud",
      units_per_package: item.units_per_package || 1,
      unit_price: price,
      vat_rate: item.vat_rate ?? 21,
      url: item.url ?? null,
      region,
      is_available: item.is_available ?? true,
      checked_at: now,
      is_active: true,
    })
    .select("id")
    .single();

  if (prodErr || !product) {
    throw new Error(`Producto "${item.name}": ${prodErr?.message}`);
  }

  await insertObservation(product.id, providerId, sourceId, price, region, now);

  return "created";
}

// ─── Price-only upsert ────────────────────────────────────────────────────────

async function upsertPrice(
  item: WebhookProduct,
  providerId: string,
  sourceId: string,
  defaultRegion: string,
  now: string
): Promise<"created" | "updated" | "skipped"> {
  // Find product by SKU or name
  const dedupField = item.sku ? "sku" : "commercial_name";
  const dedupValue = item.sku || item.name;

  const { data: existing } = await supabase
    .from("pb_products")
    .select("id, unit_price")
    .eq("provider_id", providerId)
    .eq(dedupField, dedupValue)
    .limit(1);

  if (!existing || existing.length === 0) {
    // Product not found — create it via upsertProduct
    return upsertProduct(item, providerId, sourceId, null, defaultRegion, now);
  }

  const productId = existing[0].id;
  const oldPrice = Number(existing[0].unit_price);
  const newPrice = item.price ?? 0;

  if (Math.abs(oldPrice - newPrice) < 0.001) {
    // Update checked_at even if price unchanged
    await supabase
      .from("pb_products")
      .update({ checked_at: now, is_available: item.is_available ?? true })
      .eq("id", productId);
    return "skipped";
  }

  // Price changed
  await supabase
    .from("pb_products")
    .update({ unit_price: newPrice, checked_at: now, is_available: item.is_available ?? true })
    .eq("id", productId);

  await insertObservation(productId, providerId, sourceId, newPrice, item.region || defaultRegion, now);

  return "updated";
}

// ─── Availability update ──────────────────────────────────────────────────────

async function updateAvailability(
  item: WebhookProduct,
  providerId: string
): Promise<boolean> {
  const dedupField = item.sku ? "sku" : "commercial_name";
  const dedupValue = item.sku || item.name;

  const { data: products } = await supabase
    .from("pb_products")
    .select("id")
    .eq("provider_id", providerId)
    .eq(dedupField, dedupValue);

  if (!products || products.length === 0) return false;

  for (const p of products) {
    await supabase
      .from("pb_products")
      .update({
        is_available: item.is_available ?? false,
        checked_at: new Date().toISOString(),
      })
      .eq("id", p.id);

    await supabase
      .from("pb_price_current")
      .update({ is_available: item.is_available ?? false })
      .eq("product_id", p.id);
  }

  return true;
}

// ─── Observation insert + current price upsert ────────────────────────────────

async function insertObservation(
  productId: string,
  providerId: string,
  sourceId: string,
  price: number,
  region: string,
  now: string
): Promise<void> {
  const dedupHash = crypto
    .createHash("sha256")
    .update(`webhook-${providerId}-${productId}-${price}-${now.slice(0, 10)}`)
    .digest("hex")
    .slice(0, 32);

  const { data: obs } = await supabase
    .from("pb_price_observations")
    .insert({
      product_id: productId,
      provider_id: providerId,
      source_id: sourceId,
      price_excl_vat: price,
      vat_pct: 21,
      shipping_cost: 0,
      other_costs: 0,
      discount_pct: 0,
      discount_amount: 0,
      is_available: true,
      region,
      checked_at: now,
      price_changed_at: now,
      confidence_score: 0.80,
      dedup_hash: dedupHash,
    })
    .select("id")
    .single();

  if (obs) {
    await supabase
      .from("pb_price_current")
      .upsert(
        {
          product_id: productId,
          observation_id: obs.id,
          provider_id: providerId,
          price_excl_vat: price,
          confidence_score: 0.80,
          region,
          is_available: true,
          source_type: "n8n_webhook",
          checked_at: now,
          price_changed_at: now,
        },
        { onConflict: "product_id" }
      );
  }
}

// ─── Sync run tracking ───────────────────────────────────────────────────────

async function createSyncRun(
  sourceId: string,
  providerId: string,
  metadata?: WebhookMetadata
): Promise<string> {
  const idempotencyKey = metadata?.run_id
    || `webhook-${providerId}-${new Date().toISOString().slice(0, 13)}`;

  const { data: run } = await supabase
    .from("pb_sync_runs")
    .insert({
      idempotency_key: idempotencyKey,
      source_id: sourceId,
      provider_id: providerId,
      scope: "provider",
      status: "processing",
      started_at: new Date().toISOString(),
      summary: { type: "webhook", metadata: metadata || {} },
    })
    .select("id")
    .single();

  return run?.id ?? "";
}

async function finalizeSyncRun(
  runId: string,
  stats: {
    checked: number;
    new_count: number;
    modified: number;
    unchanged: number;
    error_count: number;
    errors: Array<{ item: string; error: string }>;
  }
): Promise<void> {
  if (!runId) return;

  const status = stats.error_count === 0
    ? "completed"
    : stats.error_count === stats.checked
    ? "error"
    : "partial";

  await supabase
    .from("pb_sync_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      records_checked: stats.checked,
      records_new: stats.new_count,
      records_modified: stats.modified,
      records_unchanged: stats.unchanged,
      records_errors: stats.error_count,
      error_log: stats.errors.map((e) => ({
        item: e.item,
        message: e.error,
        at: new Date().toISOString(),
      })),
    })
    .eq("id", runId);
}

// ─── GET: docs ────────────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    name: "Enlaze Price Bank Webhook (V2)",
    version: "2.0",
    auth: "Bearer token en header Authorization",
    actions: ["upsert_products", "upsert_prices", "update_availability", "bulk_import"],
    example: {
      action: "upsert_products",
      source: {
        name: "n8n-leroy-merlin-scraper",
        type: "n8n_webhook",
        url: "https://www.leroymerlin.es",
      },
      provider: {
        name: "Leroy Merlin",
        website: "https://www.leroymerlin.es",
        region: "España",
      },
      items: [
        {
          name: "Azulejo porcelánico 30x60 gris mate",
          sku: "LM-82745632",
          brand: "Artens",
          unit: "m2",
          price: 18.95,
          category: "revestimientos",
          url: "https://www.leroymerlin.es/...",
          is_available: true,
        },
      ],
      metadata: {
        scraped_at: "2026-07-17T08:00:00Z",
        workflow_id: "wf-leroy-prices",
      },
    },
  });
}
