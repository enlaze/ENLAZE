// Allow up to 60s for two sequential Claude calls (FASE 1 + FASE 2)
export const maxDuration = 60;

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { analyzeProject, buildScopeHash } from "@/lib/budget-analysis";
import { generateBudgetItems, applyCostCoefficients } from "@/lib/budget-generator-v2";
import { resolvePricesForBudget, type TechnicalPriceEntry, type ResolvedPrice } from "@/lib/price-resolver";
import { calculateEconomics } from "@/lib/budget-economics";
import { calculateTimeline } from "@/lib/budget-planner";
import { validateBudget } from "@/lib/budget-validator";
import type {
  BudgetScopeV2,
  BudgetPreferences,
  ProjectAnalysis,
  BudgetItemV2,
  BudgetEconomics,
  BudgetTimeline,
  ValidationReport,
} from "@/lib/types/budget-v2";

/**
 * POST /api/budgets/generate-v2
 *
 * Full budget generation pipeline: all 6 phases.
 * FASE 1 (analysis) + FASE 2 (items) + FASE 3 (price resolution)
 * + FASE 4 (economics) + FASE 5 (planning) + FASE 6 (validation).
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

    // ── Fetch price data from DB ──
    // Technical prices (level 2)
    const { data: techPriceRows } = await supabase
      .from("technical_price_items")
      .select("name, item_code, unit, unit_price, confidence_score, source, region")
      .eq("is_active", true);

    const technicalPrices: TechnicalPriceEntry[] = (techPriceRows || []).map((r) => ({
      name: String(r.name || ""),
      item_code: String(r.item_code || ""),
      unit: String(r.unit || "ud"),
      unit_price: Number(r.unit_price) || 0,
      confidence_score: Number(r.confidence_score) || 0.80,
      source: String(r.source || ""),
      region: String(r.region || "espana"),
    }));

    // User prices (level 1)
    const { data: userPriceRows } = await supabase
      .from("price_items")
      .select("name, unit_price, unit, supplier_name, source_type")
      .eq("user_id", user.id)
      .eq("is_active", true);

    const userPrices = (userPriceRows || []).map((p) => ({
      name: String(p.name || ""),
      unit_price: Number(p.unit_price) || 0,
      unit: String(p.unit || "ud"),
      supplier_name: String(p.supplier_name || ""),
      source_type: String(p.source_type || "manual"),
    }));

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

    // ── FASE 3: Price resolution (deterministic) ──
    // Build price requests from generated items
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
      // Fetch enlaze + n8n prices
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

      // Merge resolved prices back into items
      const resolvedMap = new Map<string, ResolvedPrice>(resolved.map((r) => [r.materialName, r]));

      items = items.map((item) => {
        const resolvedPrice = resolvedMap.get(item.name);
        if (resolvedPrice && resolvedPrice.selectedPrice > 0 && resolvedPrice.sourceType !== "estimated") {
          // Update item with resolved price
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

    // Apply cost coefficients for items that only have unit_cost
    items = applyCostCoefficients(items);

    // ── FASE 4: Economics (deterministic) ──
    let economics: BudgetEconomics | null = null;
    try {
      economics = calculateEconomics(
        items,
        prefs,
        scope.project_type,
        scope.surface_m2,
        prefs.workers_count,
        null, // calendarDays — calculated in FASE 5
      );
    } catch (e) {
      console.warn("[GenerateV2] FASE 4 economics error (non-fatal):", e);
    }

    // ── FASE 5: Timeline / Planning (deterministic) ──
    let timeline: BudgetTimeline | null = null;
    try {
      timeline = calculateTimeline(
        items,
        analysis,
        prefs.workers_count,
        scope.start_date,
        scope.deadline_date,
      );
    } catch (e) {
      console.warn("[GenerateV2] FASE 5 timeline error (non-fatal):", e);
    }

    // ── FASE 6: Validation (deterministic) ──
    let validation: ValidationReport | null = null;
    try {
      if (economics) {
        validation = validateBudget(items, economics, analysis, scope, timeline);
      }
    } catch (e) {
      console.warn("[GenerateV2] FASE 6 validation error (non-fatal):", e);
    }

    // ── Calculate totals ──
    const totalCost = items.reduce((sum, i) => sum + i.subtotal_cost, 0);
    const totalSale = items.reduce((sum, i) => sum + i.subtotal_sale, 0);
    const avgConfidence =
      items.length > 0
        ? items.reduce((sum, i) => sum + i.confidence_score, 0) / items.length
        : 0;

    // ── Response ──
    return NextResponse.json({
      ok: true,
      analysis,
      analysis_cached: analysisCached,
      items,
      economics,
      timeline,
      validation,
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
