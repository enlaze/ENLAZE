import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * GET /api/agent/market/analysis?user_id=xxx
 *
 * AI-powered automated market analysis for a local business.
 * Analyzes: user's products, competitors, sector data, recent signals,
 * and generates actionable insights for increasing sales.
 *
 * This is an on-demand endpoint (called from dashboard),
 * NOT part of the daily agent workflow (too expensive to run daily).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    // Gather all context
    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "business_sector, business_type, business_name, city, competitors, agent_keywords",
      )
      .eq("id", userId)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json(
        { error: "Perfil no encontrado" },
        { status: 404 },
      );
    }

    const sector = profile.business_sector || "comercio";
    const competitors = profile.competitors || [];

    // Get user's products/prices
    const { data: priceItems } = await supabase
      .from("price_items")
      .select("*")
      .eq("user_id", userId)
      .order("category")
      .limit(100);

    // Get sector reference data
    const { data: sectorData } = await supabase
      .from("sector_data")
      .select("*")
      .eq("sector", sector);

    // Get recent agent signals
    const { data: recentSignals } = await supabase
      .from("agent_signals")
      .select("*")
      .eq("user_id", userId)
      .order("detected_at", { ascending: false })
      .limit(30);

    // Get recent reviews for customer sentiment
    const { data: reviews } = await supabase
      .from("agent_reviews")
      .select("rating, text_content, themes")
      .eq("user_id", userId)
      .order("review_date", { ascending: false })
      .limit(20);

    // Get recent campaigns for marketing context
    const { data: campaigns } = await supabase
      .from("agent_campaigns")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    // Build context for AI analysis
    const productList =
      priceItems && priceItems.length > 0
        ? priceItems
            .map(
              (p) =>
                `- ${p.name} (${p.category}/${p.subcategory}): ${p.unit_price} EUR/${p.unit}`,
            )
            .join("\n")
        : "Sin productos configurados en el banco de precios.";

    const competitorList =
      competitors.length > 0
        ? competitors.join(", ")
        : "Sin competidores configurados.";

    const sectorPrices = (sectorData || [])
      .filter((d) => d.data_type === "price")
      .map((d) => `- ${d.title}: ${d.value} EUR/${d.unit} (${d.source})`)
      .join("\n");

    const sectorRegulations = (sectorData || [])
      .filter((d) => d.data_type === "regulation")
      .map((d) => `- ${d.title}: ${d.description}`)
      .join("\n");

    const signalsSummary = (recentSignals || [])
      .slice(0, 15)
      .map((s) => `- [${s.signal_type}] ${s.title}: ${s.detail || ""}`)
      .join("\n");

    const reviewsSummary = (reviews || [])
      .slice(0, 10)
      .map(
        (r) =>
          `- ${r.rating}/5: ${(r.text_content || "Sin texto").slice(0, 100)}`,
      )
      .join("\n");

    const systemPrompt = `Eres un consultor de negocio experto en comercio local en España. Analiza el negocio del usuario y genera un estudio de mercado accionable.

DATOS DEL NEGOCIO:
- Nombre: ${profile.business_name || "No especificado"}
- Sector: ${sector}
- Tipo: ${profile.business_type || "comercio"}
- Ciudad: ${profile.city || "España"}
- Competidores conocidos: ${competitorList}

PRODUCTOS/SERVICIOS DEL NEGOCIO:
${productList}

PRECIOS DE REFERENCIA DEL MERCADO:
${sectorPrices || "Sin datos de precios de mercado."}

NORMATIVA VIGENTE:
${sectorRegulations || "Sin datos de normativa."}

SEÑALES RECIENTES DETECTADAS:
${signalsSummary || "Sin señales recientes."}

RESEÑAS RECIENTES:
${reviewsSummary || "Sin reseñas."}

INSTRUCCIONES:
Genera un análisis de mercado estructurado en JSON con esta estructura exacta:
{
  "executive_summary": "Resumen ejecutivo de 2-3 frases",
  "market_position": {
    "strengths": ["Fortaleza 1", "Fortaleza 2"],
    "weaknesses": ["Debilidad 1"],
    "opportunities": ["Oportunidad 1"],
    "threats": ["Amenaza 1"]
  },
  "competitor_analysis": {
    "overview": "Resumen competitivo",
    "advantages": ["Ventaja vs competencia 1"],
    "risks": ["Riesgo competitivo 1"]
  },
  "pricing_recommendations": [
    {
      "product": "nombre o categoría",
      "current_position": "above_market | competitive | below_market",
      "recommendation": "Acción sugerida",
      "estimated_impact": "Impacto estimado en ventas/margen"
    }
  ],
  "sales_actions": [
    {
      "title": "Acción concreta",
      "type": "pricing | marketing | product | service | operations",
      "priority": "high | medium | low",
      "description": "Descripción detallada",
      "estimated_effort": "Esfuerzo estimado",
      "expected_result": "Resultado esperado"
    }
  ],
  "marketing_suggestions": [
    {
      "campaign": "Nombre de campaña",
      "channel": "Canal sugerido",
      "target": "Público objetivo",
      "message": "Mensaje clave",
      "timing": "Cuándo lanzar"
    }
  ],
  "risk_alerts": [
    {
      "risk": "Descripción del riesgo",
      "severity": "high | medium | low",
      "mitigation": "Acción de mitigación"
    }
  ]
}

Sé concreto, práctico y orientado a acción. No generes contenido genérico. Responde SOLO con JSON.`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Genera un análisis de mercado completo para ${profile.business_name || "mi negocio"} en ${profile.city || "mi ciudad"}. Necesito acciones concretas para aumentar ventas. Responde SOLO con JSON.`,
        },
      ],
    });

    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Parse AI response
    let cleaned = responseText.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let analysis: any;
    try {
      analysis = JSON.parse(cleaned);
    } catch {
      // Return raw text if parsing fails
      return NextResponse.json({
        ok: true,
        parsed: false,
        raw_analysis: responseText,
        error: "Could not parse AI response as JSON",
      });
    }

    return NextResponse.json({
      ok: true,
      parsed: true,
      business_name: profile.business_name,
      sector,
      city: profile.city,
      generated_at: new Date().toISOString(),
      analysis,
      data_sources: {
        products: priceItems?.length || 0,
        competitors: competitors.length,
        signals: recentSignals?.length || 0,
        reviews: reviews?.length || 0,
        campaigns: campaigns?.length || 0,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/market/analysis] Error:", message);
    return NextResponse.json(
      { error: "Error al generar análisis de mercado", detail: message },
      { status: 500 },
    );
  }
}
