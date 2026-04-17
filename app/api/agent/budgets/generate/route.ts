import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { getSectorConfig } from "@/lib/agent-prompts";
import { normalizeSector } from "@/lib/sector-config";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function stripCodeFences(text: string) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

function extractJson(text: string) {
  const cleaned = stripCodeFences(text);
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) return cleaned.slice(first, last + 1).trim();
  return cleaned;
}

/**
 * POST /api/agent/budgets/generate
 *
 * AI-powered budget generator for local businesses.
 * Uses the same pattern as /api/generate-budget but adapted for the agent system.
 *
 * Body: { description, service_type? }
 * Auth: Bearer AGENT_API_KEY + user_id query param
 *
 * Returns: { ok, title, partidas[], notes, total_cost, total_client, margin_percent, profit }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    const body = await req.json();
    const { description, service_type } = body;

    if (!description) {
      return NextResponse.json(
        { error: "description is required" },
        { status: 400 },
      );
    }

    // Get user profile for sector context
    const { data: profile } = await supabase
      .from("profiles")
      .select("business_sector, business_name, business_type, city")
      .eq("id", userId)
      .maybeSingle();

    const rawSector = profile?.business_sector || "comercio";
    const businessName = profile?.business_name || "";
    const sectorConfig = getSectorConfig(rawSector);
    const priceSector = normalizeSector(rawSector);

    // Get user's price items if available (filtered by normalized sector)
    const { data: priceItems } = await supabase
      .from("price_items")
      .select("*")
      .eq("user_id", userId)
      .eq("sector", priceSector)
      .order("category");

    // Get margin config
    const { data: margins } = await supabase
      .from("margin_config")
      .select("*")
      .eq("user_id", userId);

    const generalMargin =
      margins?.find((m) => m.service_type === "general")?.margin_percent || 20;
    const specificMargin = margins?.find(
      (m) => m.service_type === (service_type || "general"),
    )?.margin_percent;
    const marginPercent = specificMargin ?? generalMargin;

    // Get sector reference data
    const { data: sectorData } = await supabase
      .from("sector_data")
      .select("*")
      .eq("sector", rawSector);

    const regulations =
      sectorData?.filter((d) => d.data_type === "regulation") || [];
    const refPrices = sectorData?.filter((d) => d.data_type === "price") || [];

    // Build context strings
    const priceContext =
      priceItems && priceItems.length > 0
        ? priceItems
            .map(
              (p) =>
                `- ${p.name} | ${p.category} | ${p.subcategory} | ${p.unit_price} EUR/${p.unit}`,
            )
            .join("\n")
        : `No hay banco de precios configurado. Usa precios de mercado estándar en España para ${sectorConfig.name}.`;

    const regulationContext =
      regulations.length > 0
        ? regulations
            .map((r) => `- ${r.title}: ${r.description}`)
            .join("\n")
        : "Aplica las normativas vigentes estándar del sector.";

    const refPriceContext =
      refPrices.length > 0
        ? refPrices
            .map(
              (p) =>
                `- ${p.title}: ${p.value} EUR/${p.unit} (${p.source}, actualizado: ${new Date(p.last_updated).toLocaleDateString("es-ES")})`,
            )
            .join("\n")
        : "";

    const categoriesStr = sectorConfig.categories
      .map((c) => `"${c.value}"`)
      .join(", ");
    const unitsStr = sectorConfig.default_units
      .map((u) => `"${u}"`)
      .join(", ");

    const systemPrompt = `${sectorConfig.prompt}

EMPRESA DEL USUARIO: ${businessName || "No especificada"}
SECTOR: ${sectorConfig.name}
CIUDAD: ${profile?.city || "España"}

NORMATIVAS APLICABLES:
${regulationContext}

${refPriceContext ? `PRECIOS DE REFERENCIA DEL MERCADO:\n${refPriceContext}\n` : ""}
BANCO DE PRECIOS DEL USUARIO:
${priceContext}

REGLAS DE FORMATO:
1. Los precios son SIN margen comercial (coste real para el profesional)
2. Las categorías permitidas son: ${categoriesStr}
3. Las unidades permitidas son: ${unitsStr}
4. Genera detalle profesional y útil
5. Las cantidades deben ser coherentes con las dimensiones o alcance descrito
6. Cada partida debe tener una descripción técnica clara
7. Incluye costes principales, auxiliares, preparación y limpieza cuando apliquen

RESPONDE ÚNICAMENTE con un JSON válido:
{
  "title": "Título descriptivo del presupuesto",
  "partidas": [
    {
      "concept": "Nombre de la partida",
      "description": "Descripción técnica",
      "quantity": 1,
      "unit": "ud",
      "category": "${sectorConfig.categories[0]?.value || "servicio"}",
      "unit_price": 0.00
    }
  ],
  "notes": "Notas sobre plazos, garantías y condiciones"
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 6000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Genera un presupuesto profesional detallado para:\n\n"${description}"\n\nTipo: ${service_type || "general"}\nSector: ${sectorConfig.name}\n\nResponde SOLO con el JSON.`,
        },
      ],
    });

    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any;
    try {
      result = JSON.parse(extractJson(responseText));
    } catch {
      // Attempt repair with a second call
      const repair = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `Convierte en JSON válido. Estructura: { title, partidas, notes }. Cada partida: { concept, description, quantity, unit, category, unit_price }. Si la última partida está incompleta, elimínala. SOLO JSON.\n\n${responseText}`,
          },
        ],
      });
      const repairText = repair.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      result = JSON.parse(extractJson(repairText));
    }

    if (!result?.partidas || !Array.isArray(result.partidas)) {
      throw new Error("La IA no devolvió una lista válida de partidas");
    }

    // Calculate margins
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partidasWithCalcs = result.partidas.map((p: any) => {
      const quantity = Number(p.quantity || 0);
      const unitPrice = Number(p.unit_price || 0);
      const subtotalCost = Math.round(quantity * unitPrice * 100) / 100;
      const unitPriceClient =
        Math.round(unitPrice * (1 + marginPercent / 100) * 100) / 100;
      const subtotalClient =
        Math.round(quantity * unitPriceClient * 100) / 100;

      return {
        ...p,
        quantity,
        unit_price: unitPrice,
        subtotal_cost: subtotalCost,
        unit_price_client: unitPriceClient,
        subtotal_client: subtotalClient,
      };
    });

    const totalCost = partidasWithCalcs.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sum: number, p: any) => sum + p.subtotal_cost,
      0,
    );
    const totalClient = partidasWithCalcs.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sum: number, p: any) => sum + p.subtotal_client,
      0,
    );

    return NextResponse.json({
      ok: true,
      title: result.title,
      partidas: partidasWithCalcs,
      notes: result.notes || "",
      margin_percent: marginPercent,
      total_cost: Math.round(totalCost * 100) / 100,
      total_client: Math.round(totalClient * 100) / 100,
      profit: Math.round((totalClient - totalCost) * 100) / 100,
      sector: rawSector,
      business_name: businessName,
      agent_name: sectorConfig.agent_name,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/budgets/generate] Error:", message);
    return NextResponse.json(
      { error: "Error al generar presupuesto", detail: message },
      { status: 500 },
    );
  }
}
