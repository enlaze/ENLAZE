import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  type PriceRequest,
  type ResolvedPrice,
  type PriceAlternative,
  type TechnicalPriceEntry,
  resolveMaterialPrice,
  buildCacheRow,
  normalizeMaterialName,
  normalizeUnit,
} from "@/lib/price-resolver";
import { searchWebPricesBatch, type WebSearchRequest } from "@/lib/web-price-search";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ResolveRequestBody {
  materials: PriceRequest[];
  location: string;
  forceRefresh?: boolean; // Skip cache, re-search everything
}

interface CachedRow {
  id: string;
  normalized_name: string;
  unit: string;
  quality_tier: string;
  location: string;
  selected_price: number;
  price_min: number | null;
  price_median: number | null;
  price_max: number | null;
  selected_supplier: string | null;
  source_url: string | null;
  source_type: string;
  confidence_score: number | null;
  alternatives: PriceAlternative[] | null;
  captured_at: string | null;
  expires_at: string | null;
  material_name: string;
}

// ─── POST /api/prices/resolve ───────────────────────────────────────────────

/**
 * Resolves prices for a list of materials through the full priority chain:
 *   1. User's price_items catalog
 *   2. sector_data (n8n synced market prices)
 *   3. resolved_prices cache (if not expired)
 *   4. Web search (SerpAPI / retailers / n8n webhook)
 *   5. Internal estimate fallback
 *
 * Caches web results in resolved_prices table (48h TTL).
 *
 * Triggers:
 *   - Budget generation (from BudgetGenerateProvider)
 *   - "Actualizar precios de mercado" button
 *   - Cache expired on next generation
 *
 * NEVER called on render. Only on explicit user action.
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
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body: ResolveRequestBody = await request.json();
    const { materials, location, forceRefresh } = body;

    if (!materials || !Array.isArray(materials) || materials.length === 0) {
      return NextResponse.json({ error: "Falta la lista de materiales" }, { status: 400 });
    }

    // ── Step 1: Fetch user's price_items (level 1 — user_catalog) ──
    const { data: userPriceItems } = await supabase
      .from("price_items")
      .select("name, unit_price, unit, supplier_name, source_type")
      .eq("user_id", user.id)
      .eq("is_active", true);

    const userPrices = (userPriceItems || []).map(p => ({
      name: p.name,
      unit_price: Number(p.unit_price) || 0,
      unit: p.unit || "ud",
      supplier_name: p.supplier_name || "",
      source_type: p.source_type || "manual",
    }));

    // ── Step 1b: Fetch technical_price_items (level 2 — technical_bank) ──
    const { data: techPriceRows } = await supabase
      .from("technical_price_items")
      .select("name, item_code, unit, unit_price, confidence_score, source, region")
      .eq("is_active", true);

    const technicalPrices: TechnicalPriceEntry[] = (techPriceRows || []).map(r => ({
      name: String(r.name || ""),
      item_code: String(r.item_code || ""),
      unit: String(r.unit || "ud"),
      unit_price: Number(r.unit_price) || 0,
      confidence_score: Number(r.confidence_score) || 0.80,
      source: String(r.source || ""),
      region: String(r.region || "espana"),
    }));

    // ── Step 2: Fetch sector_data market prices (level 3-4 — enlaze_base + n8n) ──
    const { data: sectorData } = await supabase
      .from("sector_data")
      .select("title, value, unit, source, category")
      .eq("data_type", "price")
      .order("last_updated", { ascending: false });

    // Split into ENLAZE base vs n8n synced
    const enlazePrices = (sectorData || [])
      .filter(sd => sd.source === "enlaze" || sd.source === "base")
      .map(sd => ({
        name: sd.title || "",
        unit_price: Number(sd.value) || 0,
        unit: sd.unit || "ud",
        supplier_name: sd.source || "Banco ENLAZE",
      }));

    const n8nPrices = (sectorData || [])
      .filter(sd => sd.source !== "enlaze" && sd.source !== "base")
      .map(sd => ({
        title: sd.title || "",
        value: Number(sd.value) || 0,
        unit: sd.unit || "ud",
        source: sd.source || "n8n market",
      }));

    // ── Step 3: Check resolved_prices cache ──
    const normalizedKeys = materials.map(m => normalizeMaterialName(m.materialName));

    let cachedPrices: CachedRow[] = [];
    if (!forceRefresh) {
      const { data: cached } = await supabase
        .from("resolved_prices")
        .select("*")
        .eq("user_id", user.id)
        .in("normalized_name", normalizedKeys)
        .gt("expires_at", new Date().toISOString());

      cachedPrices = (cached || []) as CachedRow[];
    }

    // Build cache lookup map
    const cacheMap = new Map<string, CachedRow>();
    for (const c of cachedPrices) {
      const key = `${c.normalized_name}|${c.unit}|${c.quality_tier}`;
      cacheMap.set(key, c);
    }

    // ── Step 4: First pass — resolve with levels 1-3 + cache ──
    const resolved: ResolvedPrice[] = [];
    const needsWebSearch: WebSearchRequest[] = [];

    for (const mat of materials) {
      const normalized = normalizeMaterialName(mat.materialName);
      const normalizedUnit = normalizeUnit(mat.unit);
      const cacheKey = `${normalized}|${normalizedUnit}|${mat.qualityTier}`;

      // Check cache first (valid, non-expired entry with real source)
      const cached = cacheMap.get(cacheKey);
      if (cached && cached.source_type !== "estimated") {
        // Reconstruct ResolvedPrice from cached row
        resolved.push({
          materialName: mat.materialName,
          normalizedName: cached.normalized_name,
          category: mat.category,
          unit: cached.unit,
          quantity: mat.quantity,
          qualityTier: mat.qualityTier,
          selectedPrice: Number(cached.selected_price),
          priceMin: Number(cached.price_min ?? cached.selected_price),
          priceMedian: Number(cached.price_median ?? cached.selected_price),
          priceMax: Number(cached.price_max ?? cached.selected_price),
          selectedSupplier: cached.selected_supplier || "",
          sourceUrl: cached.source_url || "",
          sourceType: cached.source_type as ResolvedPrice["sourceType"],
          confidenceScore: Number(cached.confidence_score ?? 0.4),
          capturedAt: cached.captured_at || new Date().toISOString(),
          alternatives: (cached.alternatives as PriceAlternative[]) || [],
        });
        continue;
      }

      // Try levels 1-4 (pure function, no web)
      const result = resolveMaterialPrice(mat, userPrices, enlazePrices, n8nPrices, undefined, technicalPrices);

      if (result.sourceType === "estimated" && result.confidenceScore < 0.5) {
        // Needs web search
        needsWebSearch.push({
          materialName: mat.materialName,
          category: mat.category,
          unit: mat.unit,
          qualityTier: mat.qualityTier,
          location: location || "",
        });
        // Push the estimated result for now; will be replaced if web search succeeds
        resolved.push(result);
      } else {
        resolved.push(result);
      }
    }

    // ── Step 5: Web search for materials that need it ──
    let webSearchCount = 0;
    if (needsWebSearch.length > 0) {
      const webResults = await searchWebPricesBatch(needsWebSearch, 3);

      // Replace estimated results with web results where available
      for (let i = 0; i < resolved.length; i++) {
        const r = resolved[i];
        if (r.sourceType !== "estimated" || r.confidenceScore >= 0.5) continue;

        const webResult = webResults.get(r.materialName);
        if (!webResult || webResult.alternatives.length === 0) continue;

        // Re-resolve with web results
        const mat = materials.find(m => m.materialName === r.materialName);
        if (!mat) continue;

        const reResolved = resolveMaterialPrice(
          mat, userPrices, enlazePrices, n8nPrices, webResult.alternatives, technicalPrices
        );

        // Only use if it actually found web results (sourceType should be web_search)
        if (reResolved.sourceType === "web_search" && reResolved.sourceUrl) {
          resolved[i] = reResolved;
          webSearchCount++;
        }
      }
    }

    // ── Step 6: Cache all results (upsert into resolved_prices) ──
    const rowsToUpsert = resolved
      .filter(r => r.selectedPrice > 0) // Don't cache zero-price results
      .map(r => buildCacheRow(r, user.id, location || ""));

    if (rowsToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from("resolved_prices")
        .upsert(rowsToUpsert, {
          onConflict: "user_id,normalized_name,unit,quality_tier,location",
        });

      if (upsertError) {
        console.error("[PriceResolve] Cache upsert error:", upsertError);
        // Non-fatal — continue with results even if cache fails
      }
    }

    // ── Response ──
    const summary = {
      total: resolved.length,
      fromUserCatalog: resolved.filter(r => r.sourceType === "user_catalog").length,
      fromTechnicalBank: resolved.filter(r => r.sourceType === "technical_bank").length,
      fromEnlaze: resolved.filter(r => r.sourceType === "enlaze_base").length,
      fromN8n: resolved.filter(r => r.sourceType === "n8n_market").length,
      fromWebSearch: resolved.filter(r => r.sourceType === "web_search").length,
      fromCache: cachedPrices.length,
      estimated: resolved.filter(r => r.sourceType === "estimated").length,
      webSearchesPerformed: needsWebSearch.length,
      webSearchesSuccessful: webSearchCount,
    };

    return NextResponse.json({
      ok: true,
      resolved,
      summary,
      cachedUntil: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PriceResolve] Error:", message);
    return NextResponse.json(
      { error: message || "Error interno al resolver precios" },
      { status: 500 }
    );
  }
}
