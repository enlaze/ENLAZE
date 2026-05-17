import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSectorConfig } from "@/lib/agent-prompts";

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

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {},
        remove() {},
      },
    }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { sector, description, service_type } = body;
    
    if (!description || description.trim().length < 5) {
      return NextResponse.json({ error: "Descripción insuficiente" }, { status: 400 });
    }

    const activeSector = sector || "construccion";
    const sectorConfig = getSectorConfig(activeSector);
    
    // 1. Fetch user's own price_items (private)
    const { data: priceItems } = await supabase
      .from("price_items")
      .select("name, category, unit_price, unit, supplier_name")
      .eq("user_id", user.id)
      .eq("sector", activeSector)
      .eq("is_active", true)
      .limit(100);

    // 2. Fetch global market data (sector_data)
    const { data: sectorData } = await supabase
      .from("sector_data")
      .select("*")
      .eq("sector", activeSector);
      
    const regulations = sectorData?.filter(d => d.data_type === "regulation") || [];
    const refPrices = sectorData?.filter(d => d.data_type === "price") || [];

    // Build context
    let priceContext = "NO HAY PRECIOS PRIVADOS EN BBDD.\n";
    if (priceItems && priceItems.length > 0) {
      priceContext = priceItems.map(p => `- ${p.name} | Proveedor: ${p.supplier_name || 'Genérico'} | ${p.unit_price} EUR/${p.unit}`).join("\n");
    }

    let regContext = "";
    if (regulations.length > 0) {
      regContext = "NORMATIVAS ACTUALES EN BBDD:\n" + regulations.map(r => `- ${r.title}: ${r.description}`).join("\n");
    }
    
    let marketPriceContext = "";
    if (refPrices.length > 0) {
      marketPriceContext = "PRECIOS MERCADO (AGENT N8N):\n" + refPrices.map(r => `- ${r.title}: ${r.value} EUR/${r.unit} (${r.source})`).join("\n");
    }

    const systemPrompt = `${sectorConfig.prompt}

Tu tarea es actuar como un Agente Inteligente de ${sectorConfig.name} y analizar detalladamente la petición de presupuesto del usuario.

CONTEXTO DEL SISTEMA Y AGENTE N8N:
${regContext}
${marketPriceContext}

CATÁLOGO PRIVADO DEL USUARIO:
${priceContext}

Si el usuario no tiene materiales en su catálogo que coincidan con la petición, usa referencias de mercado de España o las de "PRECIOS MERCADO".

DEVUELVE ÚNICAMENTE UN JSON CON LA SIGUIENTE ESTRUCTURA EXACTA:
{
  "summary": "Resumen corto de 1 linea",
  "confidence_score": 90,
  "source": "supabase_agent_data_claude",
  "detected_scope": {
    "sector": "${activeSector}",
    "service_type": "${service_type || 'general'}",
    "area_m2": 145, // null si no se detecta
    "location": "" // string vacia si no se detecta
  },
  "suggested_items": [
    {
      "concept": "Nombre de la partida",
      "description": "Descripción detallada",
      "quantity": 1,
      "unit": "PA",
      "unit_cost": 100.0,
      "margin_pct": 20,
      "category": "mano_obra"
    }
  ],
  "suggested_materials": [
    {
      "concept": "Nombre material",
      "quantity": 1,
      "unit": "ud",
      "unit_cost": 50.0,
      "supplier_name": "Leroy Merlin",
      "source": "retail_provider"
    }
  ],
  "provider_options": [
    {
      "name": "Leroy Merlin",
      "materials_count": 5,
      "estimated_total": 250.0,
      "source": "n8n_market"
    }
  ],
  "regulatory_notes": [
    {
      "title": "Aviso normativo",
      "description": "Detalle normativo extraído del contexto",
      "severity": "info",
      "source": "sector_agent"
    }
  ],
  "calendar_phases": [
    {
      "title": "Fase 1",
      "duration_days": 3
    }
  ],
  "missing_questions": [
    "Pregunta importante para el cliente para aclarar el alcance"
  ]
}

REGLAS:
1. No envuelvas el JSON en markdown, devuelve solo el objeto.
2. suggested_items son las partidas de mano de obra/maquinaria/otros. NO incluyas materiales puros aquí.
3. suggested_materials son los materiales necesarios.
4. Genera datos coherentes con el alcance descrito.`;

    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Analiza esta petición de presupuesto y genera la estructura JSON:\n\nDescripción:\n"${description}"\n\nTipo: ${service_type || "general"}`
        }
      ]
    });

    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map(block => block.text)
      .join("");

    let result;
    try {
      result = JSON.parse(extractJson(responseText));
    } catch {
      throw new Error("El agente devolvió un formato inválido");
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[budget-analysis] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
