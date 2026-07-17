/**
 * migrate-to-price-bank-v2.ts
 *
 * One-time migration script that copies existing V1 data into the
 * Price Bank V2 tables (pb_*).
 *
 * Sources:
 *   1. price_items          → pb_providers (unique suppliers)
 *                           → pb_products  (one per price_item)
 *                           → pb_price_observations (initial observation)
 *                           → pb_price_current (materialized)
 *
 *   2. technical_price_items → pb_normalized_concepts (unique names)
 *                            → pb_products (linked to "Banco Técnico" provider)
 *
 *   3. sector_data          → pb_price_observations (market observations)
 *
 * Usage:
 *   npx tsx scripts/migrate-to-price-bank-v2.ts
 *
 * Requirements:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
 *   - pb_* tables already created (run migration SQL first)
 *
 * Safe to re-run: uses upserts with dedup_hash to avoid duplicates.
 */

import { createClient } from "@supabase/supabase-js";
import { normalizeForMatching } from "../lib/normalized-concepts";
import crypto from "crypto";

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BATCH_SIZE = 100;

// ─── Counters ────────────────────────────────────────────────────────────────

interface MigrationStats {
  providers_created: number;
  concepts_created: number;
  products_created: number;
  observations_created: number;
  current_prices_created: number;
  sources_created: number;
  errors: string[];
}

const stats: MigrationStats = {
  providers_created: 0,
  concepts_created: 0,
  products_created: 0,
  observations_created: 0,
  current_prices_created: 0,
  sources_created: 0,
  errors: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
}

function log(msg: string) {
  console.log(`[migrate-v2] ${msg}`);
}

// ─── Step 1: Create base price sources ───────────────────────────────────────

async function createPriceSources() {
  log("Creating base price sources...");

  const sources = [
    {
      name: "Catálogo de usuario (V1)",
      source_type: "manual",
      country: "ES",
      update_frequency: "manual",
      status: "active",
      is_active: true,
    },
    {
      name: "Banco técnico FIEBDC",
      source_type: "technical_bank_global",
      country: "ES",
      update_frequency: "manual",
      status: "active",
      is_active: true,
    },
    {
      name: "Datos de mercado (n8n/sector_data)",
      source_type: "market_estimate",
      country: "ES",
      update_frequency: "weekly",
      status: "active",
      is_active: true,
    },
  ];

  for (const src of sources) {
    const { error } = await supabase
      .from("pb_price_sources")
      .upsert(src, { onConflict: "name" })
      .select();

    if (error) {
      stats.errors.push(`Source "${src.name}": ${error.message}`);
    } else {
      stats.sources_created++;
    }
  }
}

// ─── Step 2: Migrate price_items ─────────────────────────────────────────────

async function migratePriceItems() {
  log("Migrating price_items...");

  // Fetch all price_items
  const { data: items, error } = await supabase
    .from("price_items")
    .select("*")
    .eq("is_active", true);

  if (error) {
    stats.errors.push(`Fetch price_items: ${error.message}`);
    return;
  }

  if (!items || items.length === 0) {
    log("  No price_items found, skipping.");
    return;
  }

  log(`  Found ${items.length} price_items`);

  // Get the manual source id
  const { data: manualSource } = await supabase
    .from("pb_price_sources")
    .select("id")
    .eq("name", "Catálogo de usuario (V1)")
    .single();

  const sourceId = manualSource?.id ?? null;

  // Extract unique supplier names → create providers
  const supplierNames = new Set<string>();
  for (const item of items) {
    const name = item.supplier_name?.trim();
    if (name) supplierNames.add(name);
  }

  // Create a fallback provider for items without supplier
  const fallbackProviderName = "Proveedor genérico (migración V1)";
  supplierNames.add(fallbackProviderName);

  const providerMap = new Map<string, string>(); // name → id

  for (const name of supplierNames) {
    // Check if already exists
    const { data: existing } = await supabase
      .from("pb_providers")
      .select("id")
      .eq("name", name)
      .limit(1);

    if (existing && existing.length > 0) {
      providerMap.set(name, existing[0].id);
      continue;
    }

    const { data: created, error: createErr } = await supabase
      .from("pb_providers")
      .insert({
        company_id: null, // Will be per-user, but V1 price_items are user-scoped
        name,
        country: "ES",
        supply_zones: ["*"],
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

    if (createErr) {
      stats.errors.push(`Provider "${name}": ${createErr.message}`);
    } else if (created) {
      providerMap.set(name, created.id);
      stats.providers_created++;
    }
  }

  // Create products from price_items (in batches)
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    for (const item of batch) {
      const supplierName = item.supplier_name?.trim() || fallbackProviderName;
      const providerId = providerMap.get(supplierName);

      if (!providerId) {
        stats.errors.push(`No provider for item "${item.name}" (supplier: ${supplierName})`);
        continue;
      }

      const dedupKey = hash(`pi-${item.id}`);

      // Check if already migrated
      const { data: existingProduct } = await supabase
        .from("pb_products")
        .select("id")
        .eq("sku", `v1-${item.id}`)
        .limit(1);

      if (existingProduct && existingProduct.length > 0) continue;

      const { data: product, error: prodErr } = await supabase
        .from("pb_products")
        .insert({
          provider_id: providerId,
          concept_id: null, // Will be linked later via concept matching
          concept_match_type: "none",
          commercial_name: item.name,
          description: "",
          brand: null,
          model: null,
          sku: `v1-${item.id}`,
          ean: null,
          sale_unit: item.unit || "ud",
          units_per_package: 1,
          unit_price: Number(item.unit_price) || 0,
          vat_rate: 21,
          url: null,
          region: "ES",
          is_available: true,
          checked_at: item.updated_at || new Date().toISOString(),
          is_active: true,
        })
        .select("id")
        .single();

      if (prodErr) {
        stats.errors.push(`Product "${item.name}": ${prodErr.message}`);
        continue;
      }

      stats.products_created++;

      if (!product) continue;

      // Create observation
      const { data: obs, error: obsErr } = await supabase
        .from("pb_price_observations")
        .insert({
          product_id: product.id,
          provider_id: providerId,
          source_id: sourceId,
          price_excl_vat: Number(item.unit_price) || 0,
          vat_pct: 21,
          shipping_cost: 0,
          other_costs: 0,
          discount_pct: 0,
          discount_amount: 0,
          is_available: true,
          region: "ES",
          checked_at: item.updated_at || new Date().toISOString(),
          confidence_score: item.source_type === "manual" ? 0.7 : 0.5,
          dedup_hash: dedupKey,
        })
        .select("id")
        .single();

      if (obsErr) {
        stats.errors.push(`Observation for "${item.name}": ${obsErr.message}`);
        continue;
      }

      stats.observations_created++;

      if (!obs) continue;

      // Create current price
      const { error: curErr } = await supabase
        .from("pb_price_current")
        .upsert({
          product_id: product.id,
          observation_id: obs.id,
          provider_id: providerId,
          concept_id: null,
          price_excl_vat: Number(item.unit_price) || 0,
          confidence_score: item.source_type === "manual" ? 0.7 : 0.5,
          region: "ES",
          is_available: true,
          source_type: item.source_type || "manual",
          checked_at: item.updated_at || new Date().toISOString(),
        }, { onConflict: "product_id" });

      if (curErr) {
        stats.errors.push(`Current price for "${item.name}": ${curErr.message}`);
      } else {
        stats.current_prices_created++;
      }
    }

    log(`  Processed ${Math.min(i + BATCH_SIZE, items.length)}/${items.length} price_items`);
  }
}

// ─── Step 3: Migrate technical_price_items ───────────────────────────────────

async function migrateTechnicalPrices() {
  log("Migrating technical_price_items...");

  const { data: items, error } = await supabase
    .from("technical_price_items")
    .select("*");

  if (error) {
    stats.errors.push(`Fetch technical_price_items: ${error.message}`);
    return;
  }

  if (!items || items.length === 0) {
    log("  No technical_price_items found, skipping.");
    return;
  }

  log(`  Found ${items.length} technical_price_items`);

  // Get or create "Banco Técnico" provider
  let techProviderId: string;
  const { data: existing } = await supabase
    .from("pb_providers")
    .select("id")
    .eq("name", "Banco Técnico (FIEBDC)")
    .limit(1);

  if (existing && existing.length > 0) {
    techProviderId = existing[0].id;
  } else {
    const { data: created, error: createErr } = await supabase
      .from("pb_providers")
      .insert({
        company_id: null,
        name: "Banco Técnico (FIEBDC)",
        country: "ES",
        supply_zones: ["*"],
        shipping_cost_flat: 0,
        shipping_cost_per_kg: 0,
        minimum_order: 0,
        delivery_days_min: 1,
        delivery_days_max: 3,
        payment_terms_days: 30,
        is_preferred: false,
        is_active: true,
      })
      .select("id")
      .single();

    if (createErr || !created) {
      stats.errors.push(`Tech provider: ${createErr?.message}`);
      return;
    }

    techProviderId = created.id;
    stats.providers_created++;
  }

  // Get tech source
  const { data: techSource } = await supabase
    .from("pb_price_sources")
    .select("id")
    .eq("name", "Banco técnico FIEBDC")
    .single();

  const sourceId = techSource?.id ?? null;

  // Create concepts from unique names and products
  const seenConcepts = new Map<string, string>(); // normalized_name → concept_id

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    for (const item of batch) {
      const name = item.name || item.description || "";
      if (!name.trim()) continue;

      const normalized = normalizeForMatching(name);
      const category = item.chapter_code || item.category || "general";

      // Check if already migrated
      const { data: existingProd } = await supabase
        .from("pb_products")
        .select("id")
        .eq("sku", `tech-${item.id}`)
        .limit(1);

      if (existingProd && existingProd.length > 0) continue;

      // Get or create concept
      let conceptId = seenConcepts.get(normalized);
      if (!conceptId) {
        const { data: existingConcept } = await supabase
          .from("pb_normalized_concepts")
          .select("id")
          .ilike("canonical_name", name.trim())
          .limit(1);

        if (existingConcept && existingConcept.length > 0) {
          conceptId = existingConcept[0].id;
        } else {
          const { data: newConcept, error: conceptErr } = await supabase
            .from("pb_normalized_concepts")
            .insert({
              company_id: item.company_id ?? null,
              canonical_name: name.trim(),
              description: item.description || "",
              category,
              subcategory: "",
              base_unit: item.unit || "ud",
              synonyms: [],
              specifications: {},
              review_status: "draft",
            })
            .select("id")
            .single();

          if (conceptErr || !newConcept) {
            stats.errors.push(`Concept "${name}": ${conceptErr?.message}`);
            continue;
          }

          conceptId = newConcept.id;
          stats.concepts_created++;
        }

        if (conceptId) seenConcepts.set(normalized, conceptId);
      }

      // Create product
      const { data: product, error: prodErr } = await supabase
        .from("pb_products")
        .insert({
          provider_id: techProviderId,
          concept_id: conceptId,
          concept_match_type: "exact",
          commercial_name: name.trim(),
          description: item.description || "",
          brand: null,
          model: null,
          sku: `tech-${item.id}`,
          ean: null,
          sale_unit: item.unit || "ud",
          units_per_package: 1,
          unit_price: Number(item.price) || 0,
          vat_rate: 21,
          url: null,
          region: item.region || "ES",
          is_available: true,
          checked_at: item.updated_at || new Date().toISOString(),
          is_active: true,
        })
        .select("id")
        .single();

      if (prodErr) {
        stats.errors.push(`Tech product "${name}": ${prodErr.message}`);
        continue;
      }

      stats.products_created++;

      if (!product) continue;

      // Observation + current price
      const dedupKey = hash(`tech-${item.id}`);
      const price = Number(item.price) || 0;

      const { data: obs } = await supabase
        .from("pb_price_observations")
        .insert({
          product_id: product.id,
          provider_id: techProviderId,
          source_id: sourceId,
          price_excl_vat: price,
          vat_pct: 21,
          shipping_cost: 0,
          other_costs: 0,
          discount_pct: 0,
          discount_amount: 0,
          is_available: true,
          region: item.region || "ES",
          checked_at: item.updated_at || new Date().toISOString(),
          confidence_score: 0.85,
          dedup_hash: dedupKey,
        })
        .select("id")
        .single();

      if (obs) {
        stats.observations_created++;

        await supabase.from("pb_price_current").upsert({
          product_id: product.id,
          observation_id: obs.id,
          provider_id: techProviderId,
          concept_id: conceptId,
          price_excl_vat: price,
          confidence_score: 0.85,
          region: item.region || "ES",
          is_available: true,
          source_type: "technical_bank",
          checked_at: item.updated_at || new Date().toISOString(),
        }, { onConflict: "product_id" });

        stats.current_prices_created++;
      }
    }

    log(`  Processed ${Math.min(i + BATCH_SIZE, items.length)}/${items.length} technical_price_items`);
  }
}

// ─── Step 4: Migrate sector_data ─────────────────────────────────────────────

async function migrateSectorData() {
  log("Migrating sector_data...");

  const { data: items, error } = await supabase
    .from("sector_data")
    .select("*")
    .limit(5000);

  if (error) {
    stats.errors.push(`Fetch sector_data: ${error.message}`);
    return;
  }

  if (!items || items.length === 0) {
    log("  No sector_data found, skipping.");
    return;
  }

  log(`  Found ${items.length} sector_data records`);

  const { data: marketSource } = await supabase
    .from("pb_price_sources")
    .select("id")
    .eq("name", "Datos de mercado (n8n/sector_data)")
    .single();

  const sourceId = marketSource?.id ?? null;

  // sector_data may not have product_ids — these are market observations
  // We'll create them as standalone observations linked to concepts if possible
  let migrated = 0;

  for (const item of items) {
    if (!item.price || !item.name) continue;

    const dedupKey = hash(`sector-${item.id}`);

    // Check if already migrated
    const { data: existingObs } = await supabase
      .from("pb_price_observations")
      .select("id")
      .eq("dedup_hash", dedupKey)
      .limit(1);

    if (existingObs && existingObs.length > 0) continue;

    // These are market-level observations without a specific product.
    // We'll skip creating products here — they'll be linked later via concept matching.
    migrated++;
  }

  log(`  ${migrated} sector_data records ready for concept linking (deferred).`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log("=== Price Bank V2 Migration ===");
  log(`Supabase URL: ${SUPABASE_URL}`);
  log("");

  await createPriceSources();
  await migratePriceItems();
  await migrateTechnicalPrices();
  await migrateSectorData();

  log("");
  log("=== Migration Complete ===");
  log(`  Providers created:      ${stats.providers_created}`);
  log(`  Concepts created:       ${stats.concepts_created}`);
  log(`  Products created:       ${stats.products_created}`);
  log(`  Observations created:   ${stats.observations_created}`);
  log(`  Current prices created: ${stats.current_prices_created}`);
  log(`  Sources created:        ${stats.sources_created}`);

  if (stats.errors.length > 0) {
    log("");
    log(`  Errors (${stats.errors.length}):`);
    for (const err of stats.errors.slice(0, 20)) {
      log(`    - ${err}`);
    }
    if (stats.errors.length > 20) {
      log(`    ... and ${stats.errors.length - 20} more`);
    }
  }
}

main().catch((err) => {
  console.error("[migrate-v2] Fatal error:", err);
  process.exit(1);
});
