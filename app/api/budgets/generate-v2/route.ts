import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { analyzeProject, buildScopeHash } from "@/lib/budget-analysis";
import { generateBudgetItems, applyCostCoefficients } from "@/lib/budget-generator-v2";
import { resolvePricesForBudget, type TechnicalPriceEntry, type ResolvedPrice } from "@/lib/price-resolver";
import {
  resolveForBudget as resolveForBudgetV2,
  type PrefetchedPriceData,
  type CurrentPriceRow,
  type ManualPriceRow,
  type TechnicalPriceRow,
  type EnlazePriceRow,
} from "@/lib/price-resolver-v2";
import type { PriceAlternativeV2 } from "@/lib/types/price-bank";
import type {
  BudgetScopeV2,
  BudgetPreferences,
  ProjectAnalysis,
  BudgetItemV2,
} from "@/lib/types/budget-v2";

/**
 * POST /api/budgets/generate-v2
 *
 * Full budget generation pipeline: FASE 1 (analysis) + FASE 2 (items).
 * FASE 3 (price resolution) is integrated inline.
 * FASEs 4-6 (economics, planning, validation) will be added in later etapas.
 *
 * Flow:
 *   1. Check analysis cache -> if miss, run FASE 1 (Claude)
 *   2. Fetch technical prices + user prices from DB
 *   3. Run FASE 2 (Claude) -> raw items
 *   4. Sanitize + apply cost coefficients
 *   5. Run price-resolver on items needing price updates
 *   6. Return items with analysis
 *
 * Only call on explicit user action (wizard "Generate" button).
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    }
  );

  // ── Auth ──
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      scope,
      preferences,
    } = body as {
      scope: BudgetScopeV2;
      preferences: BudgetPreferences;
    };

    if (!scope || !scope.project_type || !scope.surface_m2) {
      return NextResponse.json(
        { error: "Faltan datos del proyecto (scope)" },
        { status: 400 },
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY no configurada" },
        { status: 500 },
      );
    }

    const prefs: BudgetPreferences = {
      quality: preferences?.quality || scope.quality || "media",
      margin_percent: preferences?.margin_percent ?? 25,
      indirect_costs_percent: preferences?.indirect_costs_percent ?? 6,
      tax_percent: preferences?.tax_percent ?? 21,
      workers_count: preferences?.workers_count ?? null,
      include_alternatives: preferences?.include_alternatives ?? false,
    };

    // ── FASE 1: Analysis (with cache) ──
    let analysis: ProjectAnalysis;
    let analysisCached = false;

    const scopeHash = buildScopeHash(scope);

    // Check cache
    const { data: cachedAnalysis } = await supabase
      .from("budget_analysis_cache")
      .select("analysis")
      .eq("user_id", user.id)
      .eq("scope_hash", scopeHash)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cachedAnalysis?.analysis) {
      analysis = cachedAnalysis.analysis as ProjectAnalysis;
      analysisCached = true;
    } else {
      const analysisResult = await analyzeProject(scope, { apiKey });
      if (!analysisResult.ok || !analysisResult.analysis) {
        return NextResponse.json(
          { error: analysisResult.error || "Error en FASE 1 (analisis)" },
          { status: 500 },
        );
      }
      analysis = analysisResult.analysis;

      // Save to cache (fire-and-forget)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      supabase
        .from("budget_analysis_cache")
        .upsert(
          {
            user_id: user.id,
            scope_hash: scopeHash,
            analysis,
            created_at: new Date().toISOString(),
            expires_at: expiresAt,
          },
          { onConflict: "user_id,scope_hash" },
        )
        .then(({ error }) => {
          if (error) console.error("[GenerateV2] Cache save error:", error.message);
        });
    }

    // ── Fetch price data from DB (V1 + V2 in parallel) ──

    // Get user's company_id for V2 scope
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    const company_id = profile?.company_id ?? null;

    // Parallel fetch: V1 tables + V2 pb_* tables
    const [
      { data: techPriceRows },
      { data: userPriceRows },
      { data: pbCurrentRows },
      { data: pbManualRows },
      { data: pbTechnicalRows },
      { data: pbEnlazeRows },
    ] = await Promise.all([
      // V1: technical_price_items
      supabase
        .from("technical_price_items")
        .select("name, item_code, unit, unit_price, confidence_score, source, region")
        .eq("is_active", true),
      // V1: price_items
      supabase
        .from("price_items")
        .select("name, unit_price, unit, supplier_name, source_type, is_locked")
        .eq("user_id", user.id)
        .eq("is_active", true),
      // V2: pb_price_current with joins
      supabase
        .from("pb_price_current")
        .select(`
          product_id, price_excl_vat, effective_price, confidence_score,
          source_type, is_available, checked_at,
          pb_products!inner (
            id, commercial_name, concept_id, brand, sku, sale_unit,
            units_per_package, unit_price,
            pb_normalized_concepts ( id, canonical_name )
          ),
          pb_providers!inner (
            id, name, province, supply_zones, is_preferred,
            shipping_cost_flat, minimum_order, delivery_days_min, delivery_days_max,
            company_id
          )
        `)
        .or(`pb_providers.company_id.is.null${company_id ? `,pb_providers.company_id.eq.${company_id}` : ""}`),
      // V2: manual prices (price_items with is_locked)
      supabase
        .from("price_items")
        .select("name, unit_price, unit, supplier_name, source_type, is_locked")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .eq("is_locked", true),
      // V2: technical prices (global + company)
      supabase
        .from("technical_price_items")
        .select("name, item_code, unit, unit_price, confidence_score, source, region, company_id")
        .eq("is_active", true),
      // V2: enlaze base prices
      supabase
        .from("sector_data")
        .select("title, value, unit, source, category")
        .eq("data_type", "price")
        .in("source", ["enlaze", "base"]),
    ]);

    // Determine if V2 data is available
    const hasPBData = (pbCurrentRows?.length ?? 0) > 0;

    // Map V1 data
    const technicalPrices: TechnicalPriceEntry[] = (techPriceRows || []).map((r) => ({
      name: String(r.name || ""),
      item_code: String(r.item_code || ""),
      unit: String(r.unit || "ud"),
      unit_price: Number(r.unit_price) || 0,
      confidence_score: Number(r.confidence_score) || 0.80,
      source: String(r.source || ""),
      region: String(r.region || "espana"),
    }));

    const userPrices = (userPriceRows || []).map((p) => ({
      name: String(p.name || ""),
      unit_price: Number(p.unit_price) || 0,
      unit: String(p.unit || "ud"),
      supplier_name: String(p.supplier_name || ""),
      source_type: String(p.source_type || "manual"),
    }));

    // Map V2 prefetched data (only used if hasPBData)
    const v2PrefetchedData: PrefetchedPriceData | null = hasPBData ? {
      current_prices: (pbCurrentRows || []).map((row: Record<string, unknown>): CurrentPriceRow => {
        const prod = row.pb_products as Record<string, unknown> | null;
        const prov = row.pb_providers as Record<string, unknown> | null;
        const concept = prod?.pb_normalized_concepts as Record<string, unknown> | null;
        return {
          product_id: String(prod?.id ?? ""),
          product_name: String(prod?.commercial_name ?? ""),
          concept_id: concept?.id ? String(concept.id) : null,
          concept_name: concept?.canonical_name ? String(concept.canonical_name) : null,
          provider_id: String(prov?.id ?? ""),
          provider_name: String(prov?.name ?? ""),
          provider_province: prov?.province ? String(prov.province) : null,
          provider_supply_zones: Array.isArray(prov?.supply_zones) ? prov.supply_zones as string[] : [],
          is_preferred: Boolean(prov?.is_preferred),
          brand: prod?.brand ? String(prod.brand) : null,
          sku: prod?.sku ? String(prod.sku) : null,
          unit: String(prod?.sale_unit ?? "ud"),
          units_per_package: Number(prod?.units_per_package) || 1,
          price_excl_vat: Number(row.price_excl_vat) || 0,
          effective_price: row.effective_price ? Number(row.effective_price) : null,
          shipping_cost: Number(prov?.shipping_cost_flat) || 0,
          minimum_order: Number(prov?.minimum_order) || 0,
          delivery_days_min: Number(prov?.delivery_days_min) || 1,
          delivery_days_max: Number(prov?.delivery_days_max) || 7,
          is_available: Boolean(row.is_available),
          confidence_score: Number(row.confidence_score) || 0.5,
          source_type: String(row.source_type ?? "provider_catalog"),
          checked_at: row.checked_at ? String(row.checked_at) : null,
          price_changed_at: null,
          is_private_tariff: false,
          is_negotiated: false,
        };
      }),
      manual_prices: (pbManualRows || []).map((p): ManualPriceRow => ({
        name: String(p.name || ""),
        unit: String(p.unit || "ud"),
        unit_price: Number(p.unit_price) || 0,
        supplier_name: String(p.supplier_name || ""),
        source_type: String(p.source_type || "manual"),
        is_locked: Boolean(p.is_locked),
      })),
      historical_prices: [], // No historical data in V1 migration
      technical_prices: (pbTechnicalRows || []).map((r): TechnicalPriceRow => ({
        name: String(r.name || ""),
        item_code: String(r.item_code || ""),
        unit: String(r.unit || "ud"),
        unit_price: Number(r.unit_price) || 0,
        confidence_score: Number(r.confidence_score) || 0.80,
        source: String(r.source || ""),
        region: String(r.region || "espana"),
        is_private: Boolean(r.company_id),
      })),
      enlaze_prices: (pbEnlazeRows || []).map((sd): EnlazePriceRow => ({
        name: String(sd.title || ""),
        unit: String(sd.unit || "ud"),
        unit_price: Number(sd.value) || 0,
        chapter: String(sd.category || ""),
        supplier_ref: String(sd.source || "Banco ENLAZE"),
      })),
    } : null;

    // Simple prices for Claude context (no supplier details)
    const userPricesForClaude = userPrices.map((p) => ({
      name: p.name,
      unit_price: p.unit_price,
      unit: p.unit,
    }));

    // ── FASE 2: Generate items (Claude) ──
    const genResult = await generateBudgetItems(
      analysis,
      scope,
      prefs,
      technicalPrices,
      userPricesForClaude,
      { apiKey },
    );

    if (!genResult.ok || genResult.items.length === 0) {
      return NextResponse.json(
        { error: genResult.error || "Error en FASE 2 (generacion de partidas)" },
        { status: 500 },
      );
    }

    let items = genResult.items;

    // ── FASE 3: Price resolution (deterministic, V2 preferred → V1 fallback) ──
    let resolverUsed: "v1" | "v2" = "v1";
    let itemAlternatives: Map<string, PriceAlternativeV2[]> = new Map();

    if (hasPBData && v2PrefetchedData && company_id) {
      // ── V2 path: 11-level cascade with pb_* data ──
      resolverUsed = "v2";

      const province = scope.location || "";
      const v2Input = {
        items: items.map((item) => ({
          concept_name: item.name,
          category: item.chapter,
          unit: item.unit,
          quantity: item.quantity,
        })),
        context: {
          company_id,
          province,
          quality_tier: prefs.quality as "basica" | "media" | "alta",
        },
        data: v2PrefetchedData,
      };

      const v2Result = resolveForBudgetV2(v2Input);

      // Merge V2 results back into items
      items = items.map((item, idx) => {
        const r = v2Result.results[idx];
        if (!r || r.unit_price === 0) return item;

        // Store alternatives for response
        if (r.alternatives.length > 0) {
          itemAlternatives.set(item.name, r.alternatives);
        }

        const unitCost = r.effective_price > 0 ? r.effective_price : r.unit_price;
        const unitPriceSale = Number((unitCost * (1 + prefs.margin_percent / 100)).toFixed(2));

        // Map V2 source_type to V1 PriceSourceV2 for BudgetItemV2 compat
        const mappedSource = mapV2SourceToV1(r.source_type);

        return {
          ...item,
          unit_cost: Number(unitCost.toFixed(2)),
          unit_price_sale: unitPriceSale,
          subtotal_cost: Number((item.quantity * unitCost).toFixed(2)),
          subtotal_sale: Number((item.quantity * unitPriceSale).toFixed(2)),
          confidence_score: r.confidence_score,
          price_source: mappedSource,
          price_source_detail: r.provider_name || r.selection_reason,
          supplier: r.provider_name || null,
        };
      });
    } else {
      // ── V1 fallback: 7-level cascade ──
      const priceRequests = items
        .filter((item) => item.price_source === "estimated" && item.confidence_score < 0.50)
        .map((item) => ({
          materialName: item.name,
          category: item.chapter,
          unit: item.unit,
          quantity: item.quantity,
          qualityTier: prefs.quality,
          location: scope.location || "",
        }));

      if (priceRequests.length > 0) {
        const { data: sectorData } = await supabase
          .from("sector_data")
          .select("title, value, unit, source, category")
          .eq("data_type", "price")
          .order("last_updated", { ascending: false });

        const enlazePrices = (sectorData || [])
          .filter((sd) => sd.source === "enlaze" || sd.source === "base")
          .map((sd) => ({
            name: String(sd.title || ""),
            unit_price: Number(sd.value) || 0,
            unit: String(sd.unit || "ud"),
            supplier_name: String(sd.source || "Banco ENLAZE"),
          }));

        const n8nPrices = (sectorData || [])
          .filter((sd) => sd.source !== "enlaze" && sd.source !== "base")
          .map((sd) => ({
            title: String(sd.title || ""),
            value: Number(sd.value) || 0,
            unit: String(sd.unit || "ud"),
            source: String(sd.source || "n8n market"),
          }));

        const { resolved } = resolvePricesForBudget({
          materials: priceRequests,
          userPrices,
          enlazePrices,
          n8nPrices,
          technicalPrices,
        });

        const resolvedMap = new Map<string, ResolvedPrice>(resolved.map((r) => [r.materialName, r]));

        items = items.map((item) => {
          const resolvedPrice = resolvedMap.get(item.name);
          if (resolvedPrice && resolvedPrice.selectedPrice > 0 && resolvedPrice.sourceType !== "estimated") {
            const unitCost = resolvedPrice.selectedPrice;
            const unitPriceSale = Number((unitCost * (1 + prefs.margin_percent / 100)).toFixed(2));
            return {
              ...item,
              unit_cost: Number(unitCost.toFixed(2)),
              unit_price_sale: unitPriceSale,
              subtotal_cost: Number((item.quantity * unitCost).toFixed(2)),
              subtotal_sale: Number((item.quantity * unitPriceSale).toFixed(2)),
              confidence_score: resolvedPrice.confidenceScore,
              price_source: resolvedPrice.sourceType as BudgetItemV2["price_source"],
              price_source_detail: resolvedPrice.selectedSupplier,
              supplier: resolvedPrice.selectedSupplier || null,
            };
          }
          return item;
        });
      }
    }

    // Apply cost coefficients for items that only have unit_cost
    items = applyCostCoefficients(items);

    // ── Calculate totals ──
    const totalCost = items.reduce((sum, i) => sum + i.subtotal_cost, 0);
    const totalSale = items.reduce((sum, i) => sum + i.subtotal_sale, 0);
    const avgConfidence =
      items.length > 0
        ? items.reduce((sum, i) => sum + i.confidence_score, 0) / items.length
        : 0;

    // ── Build alternatives map for response ──
    const alternativesObj: Record<string, PriceAlternativeV2[]> = {};
    for (const [name, alts] of itemAlternatives) {
      alternativesObj[name] = alts;
    }

    // ── Response ──
    return NextResponse.json({
      ok: true,
      resolver_used: resolverUsed,
      analysis,
      analysis_cached: analysisCached,
      items,
      alternatives: resolverUsed === "v2" ? alternativesObj : undefined,
      summary: {
        total_items: items.length,
        total_cost: Number(totalCost.toFixed(2)),
        total_sale: Number(totalSale.toFixed(2)),
        margin_percent: prefs.margin_percent,
        avg_confidence: Number(avgConfidence.toFixed(2)),
        price_sources: {
          user_catalog: items.filter((i) => i.price_source === "user_catalog").length,
          technical_bank: items.filter((i) => i.price_source === "technical_bank").length,
          enlaze_base: items.filter((i) => i.price_source === "enlaze_base").length,
          n8n_market: items.filter((i) => i.price_source === "n8n_market").length,
          web_search: items.filter((i) => i.price_source === "web_search").length,
          estimated: items.filter((i) => i.price_source === "estimated").length,
        },
        chapters: [...new Set(items.map((i) => i.chapter))].length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GenerateV2] Error:", message);
    return NextResponse.json(
      { error: message || "Error interno al generar presupuesto" },
      { status: 500 },
    );
  }
}

// ─── Helper: map V2 source types to V1 PriceSourceV2 ─────────────────────

function mapV2SourceToV1(sourceType: string): BudgetItemV2["price_source"] {
  const mapping: Record<string, BudgetItemV2["price_source"]> = {
    manual_locked: "user_catalog",
    private_tariff: "user_catalog",
    negotiated: "user_catalog",
    historical_approved: "user_catalog",
    preferred_supplier: "user_catalog",
    provider_updated: "n8n_market",
    private_bc3: "technical_bank",
    technical_bank: "technical_bank",
    enlaze_base: "enlaze_base",
    market_estimate: "n8n_market",
    ai_estimate: "estimated",
  };
  return mapping[sourceType] ?? "estimated";
}
