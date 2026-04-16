import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";

/**
 * GET /api/agent/reputation/summary?user_id=xxx
 *
 * Returns Google Business reputation summary for a user.
 * If not connected, returns connected:false with empty structures.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    // Check if Google Business module is connected
    const { data: connection } = await supabase
      .from("agent_connections")
      .select("connected, status, config, last_sync_at")
      .eq("user_id", userId)
      .eq("module", "google_business")
      .maybeSingle();

    // Also check if user has a google_place_id in their profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("google_place_id")
      .eq("id", userId)
      .maybeSingle();

    const hasPlaceId = Boolean(profile?.google_place_id);
    const isConnected = (connection?.connected) || hasPlaceId;

    if (!isConnected) {
      return NextResponse.json({
        ok: true,
        connected: false,
        reviews: {
          current_rating: 0,
          total_reviews: 0,
          new_reviews_count: 0,
          urgent: [],
          recurring_themes: [],
          trend: "unknown",
        },
        summary: "Google Business no conectado — conecta tu ficha para monitorizar reseñas.",
      });
    }

    // ── Google Business IS connected: fetch real data ──
    // TODO: Implement Google Places / Business API integration.
    // For now, check if we have stored reviews from previous ingestions.
    const { data: recentReviews } = await supabase
      .from("agent_reviews")
      .select("*")
      .eq("user_id", userId)
      .order("review_date", { ascending: false })
      .limit(20);

    const reviews = recentReviews || [];
    const urgentReviews = reviews.filter(
      (r) => r.rating !== null && r.rating !== undefined && r.rating <= 2 && !r.replied,
    );
    const totalRating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length
        : 0;

    return NextResponse.json({
      ok: true,
      connected: true,
      reviews: {
        current_rating: Math.round(totalRating * 10) / 10,
        total_reviews: reviews.length,
        new_reviews_count: reviews.filter(
          (r) =>
            r.review_date &&
            new Date(r.review_date) >
              new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        ).length,
        urgent: urgentReviews.map((r) => ({
          author: r.author_name || "Anónimo",
          rating: r.rating,
          text: (r.text || "").slice(0, 200),
          date: r.review_date,
        })),
        recurring_themes: [],
        trend: reviews.length >= 5 ? (totalRating >= 4 ? "positive" : totalRating >= 3 ? "stable" : "negative") : "unknown",
      },
      summary: urgentReviews.length > 0
        ? `${urgentReviews.length} reseña(s) urgente(s) pendiente(s) de respuesta.`
        : "Reputación estable — sin reseñas urgentes.",
      last_sync_at: connection?.last_sync_at,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/reputation/summary] Error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 },
    );
  }
}
