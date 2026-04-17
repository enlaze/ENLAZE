import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";

/**
 * GET /api/agent/market/summary?user_id=xxx
 *
 * Returns market / competitor intelligence with automation-ready data:
 * - Price signals (trending up/down, anomalies)
 * - Competitor activity signals
 * - Market trends and local events
 * - Supplier alerts (delays, price changes)
 * - Price analysis with recommendations
 * - Actionable items for the business owner
 *
 * This module is always "available" (uses public/stored data).
 * Returns richer data when competitors and products are configured.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    // Get user's market configuration
    const { data: profile } = await supabase
      .from("profiles")
      .select("competitors, business_type, city, agent_keywords")
      .eq("id", userId)
      .maybeSingle();

    const competitors: string[] = profile?.competitors || [];
    const hasCompetitors = competitors.length > 0;

    // Fetch stored signals from previous ingestions
    const { data: recentSignals } = await supabase
      .from("agent_signals")
      .select("*")
      .eq("user_id", userId)
      .in("signal_type", [
        "competitors",
        "competitor",
        "stock_alert",
        "margin_alert",
        "supplier_alert",
        "local_event",
      ])
      .order("detected_at", { ascending: false })
      .limit(30);

    const signals = recentSignals || [];

    // Categorize signals
    const priceSignals = signals
      .filter((s) => s.signal_type === "margin_alert" || s.signal_type === "stock_alert")
      .map((s) => ({
        id: s.id,
        type: s.signal_type,
        title: s.title,
        summary: (s.detail || "").slice(0, 200),
        impact: s.severity === "warning" ? "high" : "medium",
        detected_at: s.detected_at,
        action: s.action_suggested || null,
      }));

    const competitorSignals = signals
      .filter((s) => s.signal_type === "competitors" || s.signal_type === "competitor")
      .map((s) => ({
        id: s.id,
        competitor: s.source_entity || "Competidor",
        title: s.title,
        summary: (s.detail || "").slice(0, 200),
        opportunity: s.opportunity || null,
        detected_at: s.detected_at,
      }));

    const supplierAlerts = signals
      .filter((s) => s.signal_type === "supplier_alert")
      .map((s) => ({
        id: s.id,
        supplier: s.source_entity || "Proveedor",
        title: s.title,
        summary: (s.detail || "").slice(0, 200),
        impact: s.severity === "warning" ? "high" : "medium",
        alternative: s.opportunity || null,
        detected_at: s.detected_at,
      }));

    const marketSignals = signals
      .filter((s) => s.signal_type === "local_event")
      .map((s) => ({
        id: s.id,
        title: s.title || s.source_entity,
        summary: (s.detail || "").slice(0, 200),
        action: s.action_suggested || null,
        detected_at: s.detected_at,
      }));

    // Price analysis: detect trends
    const trendingUp = priceSignals
      .filter((s) => s.title.toLowerCase().includes("subida") || s.title.toLowerCase().includes("incremento"))
      .slice(0, 5);
    const trendingDown = priceSignals
      .filter((s) => s.title.toLowerCase().includes("bajada") || s.title.toLowerCase().includes("descenso"))
      .slice(0, 5);

    // Build price recommendations
    const recommendations = [];
    if (trendingUp.length > 0) {
      recommendations.push({
        type: "review_prices",
        title: "Revisar precios al alza",
        description: `Se detectan ${trendingUp.length} señal(es) de subida de costes. Considera ajustar precios de venta.`,
        priority: "high",
      });
    }
    if (supplierAlerts.length > 0) {
      recommendations.push({
        type: "check_suppliers",
        title: "Evaluar proveedores alternativos",
        description: `${supplierAlerts.length} alerta(s) de proveedor. Valora alternativas para mantener márgenes.`,
        priority: "medium",
      });
    }
    if (!hasCompetitors) {
      recommendations.push({
        type: "add_competitors",
        title: "Configura tus competidores",
        description: "Añade competidores en tu perfil para recibir alertas de su actividad y precios.",
        priority: "low",
      });
    }

    // Build action items
    const actionItems = [];
    if (priceSignals.length > 0) {
      actionItems.push({
        type: "price_review",
        title: `Revisar ${priceSignals.length} señal(es) de precio/margen`,
        priority: priceSignals.some((s) => s.impact === "high") ? "high" : "medium",
        description: "Señales de precio detectadas que pueden afectar tus márgenes.",
      });
    }
    if (competitorSignals.length > 0) {
      actionItems.push({
        type: "competitor_analysis",
        title: `Analizar ${competitorSignals.length} movimiento(s) de competencia`,
        priority: "medium",
        description: "Actividad de competidores detectada. Revisa oportunidades y amenazas.",
      });
    }
    if (marketSignals.length > 0) {
      actionItems.push({
        type: "market_opportunity",
        title: `${marketSignals.length} evento(s) local(es) detectado(s)`,
        priority: "medium",
        description: "Eventos locales que pueden generar tráfico para tu negocio.",
      });
    }

    return NextResponse.json({
      ok: true,
      connected: true,
      has_competitors: hasCompetitors,
      competitors_count: competitors.length,
      price_signals: priceSignals.slice(0, 10),
      competitor_signals: competitorSignals.slice(0, 10),
      market_signals: marketSignals.slice(0, 10),
      supplier_alerts: supplierAlerts.slice(0, 10),
      price_analysis: {
        trending_up: trendingUp,
        trending_down: trendingDown,
        recommendations,
      },
      action_items: actionItems,
      summary: hasCompetitors
        ? `Monitorizando ${competitors.length} competidor(es). ${priceSignals.length} señal(es) de precio, ${competitorSignals.length} de competencia.`
        : "Configura competidores en tu perfil para recibir alertas de mercado completas.",
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
