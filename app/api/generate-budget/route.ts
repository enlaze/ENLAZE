import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSectorConfig } from "@/lib/agent-prompts";
import { normalizeSector } from "@/lib/sector-config";
import { logAiRun, hashText } from "@/lib/ai-logger";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function stripCodeFences(text: string) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

function extractLikelyJson(text: string) {
  const cleaned = stripCodeFences(text);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1).trim();
  }

  return cleaned;
}

async function repairBudgetJson(rawText: string) {
  const repairMessage = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content:
          "Convierte el siguiente contenido en un JSON VALIDO. " +
          "Debe mantener esta estructura: { title, partidas, notes }. " +
          "Cada partida debe tener: concept, description, quantity, unit, category, unit_price. " +
          "Si la ultima partida esta incompleta o corrupta, elimínala. " +
          "Responde SOLO con JSON valido, sin markdown ni explicaciones.\n\nCONTENIDO:\n" +
          rawText,
      },
    ],
  });

  const repairText = repairMessage.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return extractLikelyJson(repairText);
}

export async function POST(request: Request) {
  try {
    const { description, serviceType, userId } = await request.json();

    if (!description) {
      return NextResponse.json({ error: "Descripcion requerida" }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("business_sector, business_name")
      .eq("id", userId)
      .single();

    const rawSector = profile?.business_sector || "otro";
    const businessName = profile?.business_name || "";
    const sectorConfig = getSectorConfig(rawSector);
    const priceSector = normalizeSector(rawSector);

    const { data: priceItems } = await supabase
      .from("price_items")
      .select("*")
      .eq("user_id", userId)
      .eq("sector", priceSector)
      .order("category");

    const { data: margins } = await supabase
      .from("margin_config")
      .select("*")
      .eq("user_id", userId);

    const generalMargin =
      margins?.find((m) => m.service_type === "general")?.margin_percent || 20;
    const specificMargin = margins?.find((m) => m.service_type === serviceType)?.margin_percent;
    const marginPercent = specificMargin ?? generalMargin;

    const { data: sectorData } = await supabase
      .from("sector_data")
      .select("*")
      .eq("sector", rawSector);

    const regulations = sectorData?.filter((d) => d.data_type === "regulation") || [];
    const refPrices = sectorData?.filter((d) => d.data_type === "price") || [];

    const priceContext =
      priceItems && priceItems.length > 0
        ? priceItems
            .map(
              (p) =>
                "- " +
                p.name +
                " | " +
                p.category +
                " | " +
                p.subcategory +
                " | " +
                p.unit_price +
                " EUR/" +
                p.unit
            )
            .join("\n")
        : "No hay banco de precios configurado. Usa precios de mercado estandar en Espana para " +
          sectorConfig.name +
          ".";

    const regulationContext =
      regulations.length > 0
        ? regulations.map((r) => "- " + r.title + ": " + r.description).join("\n")
        : "Aplica las normativas vigentes estandar del sector.";

    const refPriceContext =
      refPrices.length > 0
        ? refPrices
            .map(
              (p) =>
                "- " +
                p.title +
                ": " +
                p.value +
                " EUR/" +
                p.unit +
                " (" +
                p.source +
                ", actualizado: " +
                new Date(p.last_updated).toLocaleDateString("es-ES") +
                ")"
            )
            .join("\n")
        : "";

    const categoriesStr = sectorConfig.categories.map((c) => '"' + c.value + '"').join(", ");
    const unitsStr = sectorConfig.default_units.map((u) => '"' + u + '"').join(", ");

    const systemPrompt =
      sectorConfig.prompt +
      "\n\n" +
      "EMPRESA DEL USUARIO: " +
      (businessName || "No especificada") +
      "\n" +
      "SECTOR: " +
      sectorConfig.name +
      "\n\n" +
      "NORMATIVAS APLICABLES:\n" +
      regulationContext +
      "\n\n" +
      (refPriceContext
        ? "PRECIOS DE REFERENCIA DEL MERCADO (actualizados):\n" + refPriceContext + "\n\n"
        : "") +
      "BANCO DE PRECIOS DEL USUARIO:\n" +
      priceContext +
      "\n\n" +
      "REGLAS DE FORMATO:\n" +
      "1. Los precios son SIN margen comercial (coste real para el profesional)\n" +
      "2. Las categorias permitidas son: " +
      categoriesStr +
      "\n" +
      "3. Las unidades permitidas son: " +
      unitsStr +
      "\n" +
      "4. Genera detalle profesional y util, sin redundancias excesivas\n" +
      "5. Las cantidades deben ser coherentes con las dimensiones o alcance descrito\n" +
      "6. Cada partida debe tener una descripcion tecnica clara y concisa\n" +
      "7. Separa las partidas principales y auxiliares necesarias, evitando duplicidades innecesarias\n" +
      "8. Incluye costes principales, auxiliares, preparacion y limpieza cuando apliquen\n\n" +
      "RESPONDE UNICAMENTE con un JSON valido con esta estructura exacta (sin markdown, sin explicaciones, solo el JSON):\n" +
      '{\n  "title": "Titulo descriptivo del presupuesto",\n  "partidas": [\n    {\n      "concept": "Nombre especifico de la partida",\n      "description": "Descripcion tecnica clara y concisa",\n      "quantity": 1,\n      "unit": "ud",\n      "category": "' +
      sectorConfig.categories[0]?.value +
      '",\n      "unit_price": 0.00\n    }\n  ],\n  "notes": "Notas sobre plazos, garantias, condiciones y normativa aplicable"\n}';

    const startTime = Date.now();

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 6000,
      messages: [
        {
          role: "user",
          content:
            'Genera un presupuesto profesional detallado para el siguiente trabajo:\n\n"' +
            description +
            '"\n\nTipo de servicio: ' +
            serviceType +
            "\nSector: " +
            sectorConfig.name +
            "\n\nRecuerda: responde SOLO con el JSON, sin texto adicional. Genera las partidas necesarias con detalle tecnico claro y descripciones concisas.",
        },
      ],
      system: systemPrompt,
    });

    const durationMs = Date.now() - startTime;

    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any;
    const cleaned = extractLikelyJson(responseText);

    try {
      result = JSON.parse(cleaned);
    } catch (parseError) {
      console.error("Primary budget JSON parse failed:", parseError);
      console.error("Raw budget response length:", responseText.length);
      console.error("Anthropic stop reason:", message.stop_reason);

      const repaired = await repairBudgetJson(responseText);
      result = JSON.parse(repaired);
    }

    if (!result?.partidas || !Array.isArray(result.partidas)) {
      throw new Error("La respuesta de la IA no contiene una lista valida de partidas");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partidasWithCalcs = result.partidas.map((p: any) => {
      const quantity = Number(p.quantity || 0);
      const unitPrice = Number(p.unit_price || 0);
      const subtotalCost = Math.round(quantity * unitPrice * 100) / 100;
      const unitPriceClient = Math.round(unitPrice * (1 + marginPercent / 100) * 100) / 100;
      const subtotalClient = Math.round(quantity * unitPriceClient * 100) / 100;

      return {
        ...p,
        quantity,
        unit_price: unitPrice,
        subtotal_cost: subtotalCost,
        unit_price_client: unitPriceClient,
        subtotal_client: subtotalClient,
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalCost = partidasWithCalcs.reduce((sum: number, p: any) => sum + p.subtotal_cost, 0);
    const totalClient = partidasWithCalcs.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sum: number, p: any) => sum + p.subtotal_client,
      0
    );

    // Fire-and-forget: log AI run for compliance
    logAiRun(supabase, {
      run_type: "budget_generation",
      model: "claude-sonnet-4-20250514",
      prompt_version: "v1.0",
      input_hash: await hashText(description),
      output_hash: await hashText(responseText),
      tokens_in: message.usage?.input_tokens,
      tokens_out: message.usage?.output_tokens,
      duration_ms: durationMs,
      entity_type: "budget",
    });

    return NextResponse.json({
      title: result.title,
      partidas: partidasWithCalcs,
      notes: result.notes || "",
      margin_percent: marginPercent,
      total_cost: Math.round(totalCost * 100) / 100,
      total_client: Math.round(totalClient * 100) / 100,
      profit: Math.round((totalClient - totalCost) * 100) / 100,
      sector: rawSector,
      agent_name: sectorConfig.agent_name,
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    console.error("Error generating budget:", e);
    return NextResponse.json(
      { error: "Error al generar presupuesto: " + (e.message || "Error desconocido") },
      { status: 500 }
    );
  }
}
