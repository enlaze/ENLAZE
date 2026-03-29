import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const { description, serviceType, userId } = await request.json();

    if (!description) {
      return NextResponse.json({ error: "Descripción requerida" }, { status: 400 });
    }

    // Cargar banco de precios del usuario
    const { data: priceItems } = await supabase
      .from("price_items")
      .select("*")
      .eq("user_id", userId)
      .order("category");

    // Cargar márgenes del usuario
    const { data: margins } = await supabase
      .from("margin_config")
      .select("*")
      .eq("user_id", userId);

    const generalMargin = margins?.find((m) => m.service_type === "general")?.margin_percent || 20;
    const specificMargin = margins?.find((m) => m.service_type === serviceType)?.margin_percent;
    const marginPercent = specificMargin ?? generalMargin;

    // Construir contexto de precios para el agente
    const priceContext = priceItems && priceItems.length > 0
      ? priceItems.map((p) => `- ${p.name} | ${p.category} | ${p.subcategory} | ${p.unit_price}€/${p.unit}`).join("\n")
      : "No hay banco de precios configurado. Usa precios de mercado estándar en España.";

    const systemPrompt = `Eres un experto presupuestador profesional del sector de reformas, fontanería, electricidad, climatización y multiservicios en España. 

Tu trabajo es interpretar la descripción de un trabajo y generar un presupuesto desglosado con partidas detalladas.

REGLAS IMPORTANTES:
1. Genera partidas REALISTAS con cantidades y precios de mercado en España
2. Usa el banco de precios del usuario cuando haya coincidencias. Si no hay coincidencia exacta, usa precios de mercado
3. Incluye TODAS las partidas necesarias: demolición, materiales, mano de obra, acabados, limpieza
4. Las cantidades deben ser coherentes con las dimensiones indicadas
5. Cada partida debe tener: concept, description, quantity, unit, category, unit_price
6. Las categorías son: "material", "mano_obra", "otros"
7. Las unidades son: "ud", "m2", "ml", "h", "kg", "global", "m3", "l"
8. Los precios son SIN margen comercial (coste real)

BANCO DE PRECIOS DEL USUARIO:
${priceContext}

RESPONDE ÚNICAMENTE con un JSON válido con esta estructura exacta (sin markdown, sin explicaciones, solo el JSON):
{
  "title": "Título descriptivo del presupuesto",
  "partidas": [
    {
      "concept": "Nombre de la partida",
      "description": "Descripción detallada del trabajo",
      "quantity": 1,
      "unit": "ud",
      "category": "material",
      "unit_price": 0.00
    }
  ],
  "notes": "Notas relevantes sobre plazos, garantías o condiciones"
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Genera un presupuesto profesional detallado para el siguiente trabajo:\n\n"${description}"\n\nTipo de servicio: ${serviceType}\n\nRecuerda: responde SOLO con el JSON, sin texto adicional.`,
        },
      ],
      system: systemPrompt,
    });

    // Extraer texto de la respuesta
    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Parsear JSON (limpiar posible markdown)
    let cleaned = responseText.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    const result = JSON.parse(cleaned);

    // Calcular subtotales y aplicar margen
    const partidasWithCalcs = result.partidas.map((p: any) => ({
      ...p,
      subtotal_cost: Math.round(p.quantity * p.unit_price * 100) / 100,
      unit_price_client: Math.round(p.unit_price * (1 + marginPercent / 100) * 100) / 100,
      subtotal_client: Math.round(p.quantity * p.unit_price * (1 + marginPercent / 100) * 100) / 100,
    }));

    const totalCost = partidasWithCalcs.reduce((sum: number, p: any) => sum + p.subtotal_cost, 0);
    const totalClient = partidasWithCalcs.reduce((sum: number, p: any) => sum + p.subtotal_client, 0);

    return NextResponse.json({
      title: result.title,
      partidas: partidasWithCalcs,
      notes: result.notes || "",
      margin_percent: marginPercent,
      total_cost: Math.round(totalCost * 100) / 100,
      total_client: Math.round(totalClient * 100) / 100,
      profit: Math.round((totalClient - totalCost) * 100) / 100,
    });
  } catch (e: any) {
    console.error("Error generating budget:", e);
    return NextResponse.json(
      { error: "Error al generar presupuesto: " + (e.message || "Error desconocido") },
      { status: 500 }
    );
  }
}
