import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSectorConfig } from "@/lib/agent-prompts";

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
      return NextResponse.json({ error: "Descripcion requerida" }, { status: 400 });
    }

    // Cargar perfil del usuario para saber su sector
    const { data: profile } = await supabase
      .from("profiles")
      .select("business_sector, business_name")
      .eq("id", userId)
      .single();

    const sector = profile?.business_sector || "otro";
    const businessName = profile?.business_name || "";
    const sectorConfig = getSectorConfig(sector);

    // Cargar banco de precios del usuario
    const { data: priceItems } = await supabase
      .from("price_items")
      .select("*")
      .eq("user_id", userId)
      .order("category");

    // Cargar margenes del usuario
    const { data: margins } = await supabase
      .from("margin_config")
      .select("*")
      .eq("user_id", userId);

    const generalMargin = margins?.find((m) => m.service_type === "general")?.margin_percent || 20;
    const specificMargin = margins?.find((m) => m.service_type === serviceType)?.margin_percent;
    const marginPercent = specificMargin ?? generalMargin;

    // Cargar datos del sector (normativas, precios de referencia via n8n)
    const { data: sectorData } = await supabase
      .from("sector_data")
      .select("*")
      .eq("sector", sector);

    const regulations = sectorData?.filter((d) => d.data_type === "regulation") || [];
    const refPrices = sectorData?.filter((d) => d.data_type === "price") || [];

    // Contexto de precios del usuario
    const priceContext = priceItems && priceItems.length > 0
      ? priceItems.map((p) => "- " + p.name + " | " + p.category + " | " + p.subcategory + " | " + p.unit_price + " EUR/" + p.unit).join("\n")
      : "No hay banco de precios configurado. Usa precios de mercado estandar en Espana para " + sectorConfig.name + ".";

    // Contexto de normativas
    const regulationContext = regulations.length > 0
      ? regulations.map((r) => "- " + r.title + ": " + r.description).join("\n")
      : "Aplica las normativas vigentes estandar del sector.";

    // Contexto de precios de referencia (actualizados via n8n)
    const refPriceContext = refPrices.length > 0
      ? refPrices.map((p) => "- " + p.title + ": " + p.value + " EUR/" + p.unit + " (" + p.source + ", actualizado: " + new Date(p.last_updated).toLocaleDateString("es-ES") + ")").join("\n")
      : "";

    const categoriesStr = sectorConfig.categories.map((c) => '"' + c.value + '"').join(", ");
    const unitsStr = sectorConfig.default_units.map((u) => '"' + u + '"').join(", ");

    const systemPrompt = sectorConfig.prompt + "\n\n" +
      "EMPRESA DEL USUARIO: " + (businessName || "No especificada") + "\n" +
      "SECTOR: " + sectorConfig.name + "\n\n" +
      "NORMATIVAS APLICABLES:\n" + regulationContext + "\n\n" +
      (refPriceContext ? "PRECIOS DE REFERENCIA DEL MERCADO (actualizados):\n" + refPriceContext + "\n\n" : "") +
      "BANCO DE PRECIOS DEL USUARIO:\n" + priceContext + "\n\n" +
      "REGLAS DE FORMATO:\n" +
      "1. Los precios son SIN margen comercial (coste real para el profesional)\n" +
      "2. Las categorias permitidas son: " + categoriesStr + "\n" +
      "3. Las unidades permitidas son: " + unitsStr + "\n" +
      "4. Genera el MAXIMO nivel de detalle posible en cada partida\n" +
      "5. Las cantidades deben ser COHERENTES con las dimensiones o alcance descrito\n" +
      "6. Cada partida debe tener una descripcion tecnica detallada\n" +
      "7. NO agrupes conceptos. Cada accion, material o servicio es una partida separada\n" +
      "8. Incluye TODOS los costes: principales, auxiliares, preparacion, limpieza\n\n" +
      "RESPONDE UNICAMENTE con un JSON valido con esta estructura exacta (sin markdown, sin explicaciones, solo el JSON):\n" +
      '{\n  "title": "Titulo descriptivo del presupuesto",\n  "partidas": [\n    {\n      "concept": "Nombre especifico de la partida",\n      "description": "Descripcion tecnica detallada: que se hace, como, con que materiales, medidas exactas",\n      "quantity": 1,\n      "unit": "ud",\n      "category": "' + sectorConfig.categories[0]?.value + '",\n      "unit_price": 0.00\n    }\n  ],\n  "notes": "Notas sobre plazos, garantias, condiciones, normativa aplicable"\n}';

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: "Genera un presupuesto profesional ULTRA-DETALLADO para el siguiente trabajo:\n\n\"" + description + "\"\n\nTipo de servicio: " + serviceType + "\nSector: " + sectorConfig.name + "\n\nRecuerda: responde SOLO con el JSON, sin texto adicional. Genera el MAXIMO numero de partidas necesarias con el MAXIMO detalle tecnico.",
        },
      ],
      system: systemPrompt,
    });

    // Extraer texto de la respuesta
    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Parsear JSON
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
      sector: sector,
      agent_name: sectorConfig.agent_name,
    });
  } catch (e: any) {
    console.error("Error generating budget:", e);
    return NextResponse.json(
      { error: "Error al generar presupuesto: " + (e.message || "Error desconocido") },
      { status: 500 }
    );
  }
}
