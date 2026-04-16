import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";

/**
 * GET /api/agent/market/summary?user_id=xxx
 *
 * Returns market / competitor signals for a user.
 * This module is always "available" (uses public data sources),
 * but returns richer data when the user has competitors configured.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    // Get user's competitor and market configuration
    const { data: profile } = await supabase
      .from("profiles")
      .select("competitors, business_type, city, agent_keywords")
      .eq("id", userId)
      .maybeSingle();

    const competitors: string[] = profile?.competitors || [];
    const hasCompetitors = competitors.length > 0;

    // Check for stored signals from previous ingestions
    const { data: recentSignals } = await supabase
      .from("agent_signals")
      .select("*")
      .eq("user_id", userId)
      .in("signal_type", ["competitors", "stock", "margin", "supplier"])
      .order("detected_at", { ascending: false })
      .limit(20);

    const signals = recentSignals || [];

    const priceSignals = signals
      .filter((s) => s.signal_type === "margin" || s.signal_type === "stock")
      .map((s) => ({
        id: s.id,
        type: s.signal_type,
        title: s.title,
        summary: (s.description || "").slice(0, 200),
        impact: s.impact || "medium",
        detected_at: s.detected_at,
      }));

    const competitorSignals = signals
      .filter((s) => s.signal_type === "competitors")
      .map((s) => ({
        id: s.id,
        competitor: s.source || "Competidor",
        title: s.title,
        summary: (s.description || "").slice(0, 200),
        detected_at: s.detected_at,
      }));

    const supplierAlerts = signals
      .filter((s) => s.signal_type === "supplier")
      .map((s) => ({
        id: s.id,
        supplier: s.source || "Proveedor",
        title: s.title,
        summary: (s.description || "").slice(0, 200),
        impact: s.impact || "medium",
        detected_at: s.detected_at,
      }));

    return NextResponse.json({
      ok: true,
      connected: true,
      has_competitors: hasCompetitors,
      price_signals: priceSignals.slice(0, 10),
      competitor_signals: competitorSignals.slice(0, 10),
      market_signals: [],
      supplier_alerts: supplierAlerts.slice(0, 10),
      summary: hasCompetitors
        ? `Monitorizando ${competitors.length} competidor(es). ${priceSignals.length} señal(es) de precio activa(s).`
        : "Configura competidores en tu perfil para recibir alertas de mercado.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/market/summary] Error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 },
    );
  }
}
