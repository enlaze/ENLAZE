import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";
import { normalizeSector } from "@/lib/sector-config";

/**
 * GET /api/agent/market/prices?user_id=xxx
 *
 * Returns market price benchmarks for the user's sector and location.
 * Aggregates data from:
 * - sector_data table (reference prices)
 * - agent_signals (margin/stock alerts)
 * - price_items (user's own price database for comparison)
 *
 * This helps business owners understand where their prices sit
 * relative to the market and identify margin optimization opportunities.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    // Get user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("business_sector, business_type, city, business_name")
      .eq("id", userId)
      .maybeSingle();

    const rawSector = profile?.business_sector || "comercio";
    const priceSector = normalizeSector(rawSector);

    // Get sector reference prices
    const { data: sectorPrices } = await supabase
      .from("sector_data")
      .select("*")
      .eq("sector", rawSector)
      .eq("data_type", "price")
      .order("last_updated", { ascending: false });

    // Get user's own price items (filtered by normalized sector)
    const { data: userPrices } = await supabase
      .from("price_items")
      .select("*")
      .eq("user_id", userId)
      .eq("sector", priceSector)
      .order("category");

    // Get recent margin signals
    const { data: marginSignals } = await supabase
      .from("agent_signals")
      .select("*")
      .eq("user_id", userId)
      .in("signal_type", ["margin_alert", "stock_alert"])
      .order("detected_at", { ascending: false })
      .limit(20);

    // Build market benchmarks
    const benchmarks = (sectorPrices || []).map((sp) => ({
      id: sp.id,
      name: sp.title,
      market_price: Number(sp.value || 0),
      unit: sp.unit || "ud",
      source: sp.source || "mercado",
      last_updated: sp.last_updated,
      category: sp.category || "general",
    }));

    // Compare user prices against market benchmarks
    const priceComparisons = [];
    if (userPrices && userPrices.length > 0 && benchmarks.length > 0) {
      for (const up of userPrices) {
        const match = benchmarks.find(
          (b) =>
            b.name.toLowerCase().includes(up.name.toLowerCase()) ||
            up.name.toLowerCase().includes(b.name.toLowerCase()),
        );
        if (match) {
          const diff = up.unit_price - match.market_price;
          const diffPct =
            match.market_price > 0
              ? Math.round((diff / match.market_price) * 10000) / 100
              : 0;
          priceComparisons.push({
            item: up.name,
            your_price: up.unit_price,
            market_price: match.market_price,
            difference: Math.round(diff * 100) / 100,
            difference_pct: diffPct,
            unit: up.unit,
            status:
              diffPct > 15
                ? "above_market"
                : diffPct < -15
                  ? "below_market"
                  : "competitive",
            recommendation:
              diffPct > 15
                ? "Tu precio está por encima del mercado. Valora si tu diferenciación lo justifica."
                : diffPct < -15
                  ? "Tu precio está por debajo del mercado. Podrías tener margen para subir."
                  : "Precio competitivo respecto al mercado.",
          });
        }
      }
    }

    // Build summary insights
    const aboveMarket = priceComparisons.filter(
      (p) => p.status === "above_market",
    ).length;
    const belowMarket = priceComparisons.filter(
      (p) => p.status === "below_market",
    ).length;
    const competitive = priceComparisons.filter(
      (p) => p.status === "competitive",
    ).length;

    const insights = [];
    if (belowMarket > 0) {
      insights.push({
        type: "margin_opportunity",
        title: `${belowMarket} producto(s) por debajo del mercado`,
        description:
          "Tienes productos con precio inferior al mercado. Podrías mejorar márgenes sin perder competitividad.",
        priority: "high",
      });
    }
    if (aboveMarket > 0) {
      insights.push({
        type: "price_risk",
        title: `${aboveMarket} producto(s) por encima del mercado`,
        description:
          "Algunos precios están por encima del mercado. Asegúrate de que tu propuesta de valor lo justifica.",
        priority: "medium",
      });
    }
    if ((marginSignals || []).length > 0) {
      insights.push({
        type: "cost_alert",
        title: `${(marginSignals || []).length} alerta(s) de margen reciente(s)`,
        description:
          "Se han detectado cambios en costes que pueden afectar tus márgenes.",
        priority: "high",
      });
    }

    return NextResponse.json({
      ok: true,
      sector: rawSector,
      business_type: profile?.business_type || "comercio",
      city: profile?.city || "",
      benchmarks: benchmarks.slice(0, 50),
      your_prices_count: userPrices?.length || 0,
      comparisons: priceComparisons.slice(0, 30),
      margin_alerts: (marginSignals || []).slice(0, 10).map((s) => ({
        id: s.id,
        title: s.title,
        detail: s.detail,
        severity: s.severity,
        detected_at: s.detected_at,
      })),
      insights,
      summary: {
        total_benchmarks: benchmarks.length,
        total_comparisons: priceComparisons.length,
        above_market: aboveMarket,
        below_market: belowMarket,
        competitive,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/market/prices] Error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 },
    );
  }
}
