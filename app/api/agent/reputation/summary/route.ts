import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";

/**
 * GET /api/agent/reputation/summary?user_id=xxx
 *
 * Returns Google Business reputation summary with automation-ready data:
 * - Current rating and review statistics
 * - Urgent reviews (negative, needing response)
 * - Suggested responses for each urgent review
 * - Recurring themes in reviews
 * - Trend analysis (improving/declining/stable)
 * - Action items for reputation management
 *
 * Graceful degradation: if not connected → connected:false + empty structures.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    const { data: connection } = await supabase
      .from("agent_connections")
      .select("connected, status, config, last_sync_at")
      .eq("user_id", userId)
      .eq("module", "google_business")
      .maybeSingle();

    const { data: profile } = await supabase
      .from("profiles")
      .select("google_place_id, business_name, business_type")
      .eq("id", userId)
      .maybeSingle();

    const hasPlaceId = Boolean(profile?.google_place_id);
    const isConnected = connection?.connected || hasPlaceId;

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
        suggested_responses: [],
        action_items: [],
        summary:
          "Google Business no conectado — conecta tu ficha para monitorizar reseñas, recibir alertas de reseñas negativas y sugerencias de respuesta.",
      });
    }

    // ── Google Business IS connected: check stored reviews ──
    const { data: recentReviews } = await supabase
      .from("agent_reviews")
      .select("*")
      .eq("user_id", userId)
      .order("review_date", { ascending: false })
      .limit(30);

    const reviews = recentReviews || [];
    const urgentReviews = reviews.filter(
      (r) => r.rating !== null && r.rating !== undefined && r.rating <= 2 && !r.responded,
    );
    const newReviews = reviews.filter(
      (r) =>
        r.review_date &&
        new Date(r.review_date) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    );

    const totalRating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length
        : 0;

    // Generate suggested responses for urgent reviews
    const suggestedResponses = urgentReviews.slice(0, 5).map((r) => {
      const bizName = profile?.business_name || "nuestro negocio";
      const isVeryNegative = (r.rating || 0) <= 1;
      const hasText = r.text_content && r.text_content.length > 10;

      let suggestedResponse = "";
      if (isVeryNegative && hasText) {
        suggestedResponse = `Estimado/a ${r.author || "cliente"}, lamentamos mucho tu experiencia en ${bizName}. Nos tomamos muy en serio tu opinión y nos gustaría conocer más detalles para poder mejorar. ¿Podrías contactarnos directamente para resolver esta situación? Gracias por ayudarnos a mejorar.`;
      } else if (isVeryNegative) {
        suggestedResponse = `Gracias por tu valoración. En ${bizName} trabajamos cada día para ofrecer el mejor servicio. Lamentamos no haber cumplido tus expectativas. Nos encantaría tener la oportunidad de mejorar tu experiencia.`;
      } else {
        suggestedResponse = `Gracias por tu opinión, ${r.author || ""}. En ${bizName} valoramos cada comentario. Tomamos nota de tus observaciones para seguir mejorando. Esperamos verte pronto.`;
      }

      return {
        review_id: r.id,
        author: r.author || "Anónimo",
        rating: r.rating,
        review_text: (r.text_content || "").slice(0, 200),
        suggested_response: suggestedResponse,
        tone: isVeryNegative ? "empathetic_urgent" : "professional",
        priority: isVeryNegative ? "urgent" : "high",
      };
    });

    // Detect recurring themes from review text
    const themeKeywords: Record<string, string[]> = {
      servicio: ["servicio", "atención", "amabilidad", "trato", "personal"],
      calidad: ["calidad", "producto", "fresco", "bueno", "malo", "regular"],
      precio: ["precio", "caro", "barato", "relación calidad-precio", "económico"],
      espera: ["espera", "lento", "rápido", "tiempo", "tardanza"],
      limpieza: ["limpieza", "limpio", "sucio", "higiene"],
      ambiente: ["ambiente", "decoración", "ruido", "acogedor", "agradable"],
    };

    const themeCounts: Record<string, { positive: number; negative: number }> = {};
    for (const review of reviews) {
      const text = (review.text_content || "").toLowerCase();
      const isNeg = (review.rating || 5) <= 2;
      for (const [theme, keywords] of Object.entries(themeKeywords)) {
        if (keywords.some((kw) => text.includes(kw))) {
          if (!themeCounts[theme]) themeCounts[theme] = { positive: 0, negative: 0 };
          if (isNeg) themeCounts[theme].negative++;
          else themeCounts[theme].positive++;
        }
      }
    }

    const recurringThemes = Object.entries(themeCounts)
      .map(([theme, counts]) => ({
        theme,
        mentions: counts.positive + counts.negative,
        sentiment: counts.negative > counts.positive ? "negative" : "positive",
        positive: counts.positive,
        negative: counts.negative,
      }))
      .filter((t) => t.mentions >= 2)
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 6);

    // Build action items
    const actionItems = [];
    if (urgentReviews.length > 0) {
      actionItems.push({
        type: "respond_reviews",
        title: `Responder a ${urgentReviews.length} reseña(s) negativa(s)`,
        priority: "urgent",
        description: "Las reseñas negativas sin respuesta afectan tu posicionamiento en Google Maps.",
      });
    }
    const negThemes = recurringThemes.filter((t) => t.sentiment === "negative");
    if (negThemes.length > 0) {
      actionItems.push({
        type: "improve_service",
        title: `Mejorar: ${negThemes.map((t) => t.theme).join(", ")}`,
        priority: "medium",
        description: `Temas recurrentes con valoración negativa detectados en las últimas reseñas.`,
      });
    }
    if (newReviews.length === 0 && reviews.length > 0) {
      actionItems.push({
        type: "request_reviews",
        title: "Solicitar nuevas reseñas a clientes satisfechos",
        priority: "low",
        description: "No hay reseñas nuevas esta semana. Pide a tus clientes habituales que te valoren.",
      });
    }

    // Trend calculation
    let trend: "positive" | "negative" | "stable" | "unknown" = "unknown";
    if (reviews.length >= 5) {
      const recent5 = reviews.slice(0, 5);
      const older5 = reviews.slice(5, 10);
      if (older5.length >= 3) {
        const recentAvg = recent5.reduce((s, r) => s + (r.rating || 0), 0) / recent5.length;
        const olderAvg = older5.reduce((s, r) => s + (r.rating || 0), 0) / older5.length;
        trend = recentAvg > olderAvg + 0.3 ? "positive" : recentAvg < olderAvg - 0.3 ? "negative" : "stable";
      } else {
        trend = totalRating >= 4 ? "positive" : totalRating >= 3 ? "stable" : "negative";
      }
    }

    return NextResponse.json({
      ok: true,
      connected: true,
      reviews: {
        current_rating: Math.round(totalRating * 10) / 10,
        total_reviews: reviews.length,
        new_reviews_count: newReviews.length,
        urgent: urgentReviews.slice(0, 10).map((r) => ({
          id: r.id,
          author: r.author || "Anónimo",
          rating: r.rating,
          text: (r.text_content || "").slice(0, 200),
          date: r.review_date,
          themes: [],
          responded: false,
        })),
        recurring_themes: recurringThemes,
        trend,
      },
      suggested_responses: suggestedResponses,
      action_items: actionItems,
      summary:
        urgentReviews.length > 0
          ? `${urgentReviews.length} reseña(s) urgente(s) pendiente(s). Rating actual: ${(Math.round(totalRating * 10) / 10).toFixed(1)}. Tendencia: ${trend}.`
          : `Reputación estable. Rating: ${(Math.round(totalRating * 10) / 10).toFixed(1)}. ${newReviews.length} reseña(s) nueva(s) esta semana.`,
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
