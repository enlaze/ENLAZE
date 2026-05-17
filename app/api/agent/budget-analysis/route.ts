import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
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
      return NextResponse.json({ error: "Descripcion insuficiente" }, { status: 400 });
    }

    const activeSector = normalizeSector(sector || "construccion");
    const sectorConfig = getSectorConfig(activeSector);

    // 1. Fetch user's own price_items (private)
    const { data: priceItemsData } = await supabase
      .from("price_items")
      .select("name, category, unit_price, unit, supplier_name, source_type, source_url, description")
      .eq("user_id", user.id)
      .eq("sector", activeSector)
      .eq("is_active", true)
      .limit(200);

    const priceItems = (priceItemsData || []).map(p => {
      let supplierName = p.supplier_name;
      if (!supplierName) {
        const rawSource = [p.source_url, p.source_type, p.description, p.name, p.category].join(" ").toLowerCase();
        if (rawSource.includes("leroy")) supplierName = "Leroy Merlin";
        else if (rawSource.includes("obramat") || rawSource.includes("bricomart")) supplierName = "OBRAMAT";
        else if (rawSource.includes("cype")) supplierName = "CYPE / Banco de precios";
        else if (rawSource.includes("referencia-mercado") || rawSource.includes("referencia")) supplierName = "Referencia mercado";
        else if (p.source_type === "default") supplierName = "Banco ENLAZE base";
        else supplierName = "Proveedor sin identificar";
      }
      return { ...p, supplier_name: supplierName };
    });

    // 2. Fetch global market data (sector_data) — try both normalized and raw sector
    const { data: sectorData } = await supabase
      .from("sector_data")
      .select("*")
      .eq("sector", activeSector);

    const regulations = sectorData?.filter(d => d.data_type === "regulation") || [];
    const refPrices = sectorData?.filter(d => d.data_type === "price") || [];

    // Build context
    let priceContext = "NO HAY PRECIOS PRIVADOS EN BBDD.\n";
    if (priceItems && priceItems.length > 0) {
      priceContext = "CATALOGO PRIVADO DEL USUARIO:\n" + priceItems.map(p => `- ${p.name} | Proveedor: ${p.supplier_name || 'Generico'} | ${p.unit_price} EUR/${p.unit}`).join("\n");
    }

    let regContext = "";
    if (regulations.length > 0) {
      regContext = "NORMATIVAS ACTUALES EN BBDD:\n" + regulations.map(r => `- ${r.title}: ${r.description}`).join("\n");
    }

    let marketPriceContext = "";
    if (refPrices.length > 0) {
      marketPriceContext = "PRECIOS MERCADO (AGENT N8N):\n" + refPrices.map(r => `- ${r.title}: ${r.value} EUR/${r.unit} (${r.source})`).join("\n");
    }

    // --- CONSTRUCTION-SPECIFIC PRICING INSTRUCTIONS ---
    let pricingInstructions = "";
    if (activeSector === "construccion") {
      pricingInstructions = `
INSTRUCCIONES CRITICAS DE PRECIO PARA CONSTRUCCION EN ESPANA (2024-2026):
- Reforma INTEGRAL de vivienda: 500-1200 EUR/m2 (media 700-800 EUR/m2)
- Reforma de BANO completo: 600-1500 EUR/m2 del bano
- Reforma de COCINA completa: 600-1400 EUR/m2 de cocina
- Reforma PARCIAL (pintura, suelos): 100-400 EUR/m2
- Obra nueva residencial: 900-1800 EUR/m2

DEBES detectar el area en m2 de la descripcion. Si no se indica, estima un area razonable (ej: piso estandar 80-100m2, bano 4-6m2, cocina 8-12m2).
DEBES verificar que tu presupuesto total dividido por el area cae DENTRO del rango esperado.
Si tu calculo da menos de 500 EUR/m2 para una reforma integral, SUBE los precios unitarios hasta que encaje.

NIVEL DE DETALLE OBLIGATORIO PARA CONSTRUCCION:
Para una reforma integral de vivienda, DEBES generar MINIMO 20 partidas (suggested_items) organizadas por capitulos. Ejemplo de capitulos obligatorios:
1. Trabajos previos y protecciones
2. Demoliciones y retirada de escombros
3. Albanileria y tabiqueria
4. Fontaneria (agua fria, caliente, evacuacion)
5. Electricidad (puntos de luz, enchufes, cuadro, protecciones)
6. Impermeabilizacion
7. Revestimientos de paredes (alicatados)
8. Solados y pavimentos
9. Pintura y acabados
10. Carpinteria interior (puertas)
11. Carpinteria exterior (ventanas) — si aplica
12. Sanitarios y griferria
13. Cocina (muebles, encimera, electrodomesticos) — si aplica
14. Climatizacion (AA o calefaccion) — si aplica
15. Iluminacion y mecanismos electricos
16. Limpieza final de obra
17. Gestion de residuos y contenedores
18. Seguridad y medios auxiliares

Dentro de cada capitulo, genera subpartidas detalladas. Por ejemplo, para "Demoliciones":
- Demolicion de alicatado ceramico existente (m2)
- Levantado de pavimento existente (m2)
- Desmontaje de sanitarios (ud)
- Retirada de tuberias vistas (ml)
- Carga y transporte de escombros a vertedero (m3)

CADA partida debe tener:
- concept: nombre especifico (NO generico)
- description: detalle con medidas/especificaciones
- quantity: cantidad REAL coherente con las dimensiones
- unit: m2, ml, ud, m3, PA, h — la unidad correcta
- unit_cost: precio unitario REALISTA de mercado espanol
- category: "mano_obra", "material", "maquinaria", "otros"
- chapter: nombre del capitulo al que pertenece (ej: "Demoliciones")

MATERIALES (suggested_materials):
DEBES generar MINIMO 15 materiales para una reforma integral. Incluye:
- Materiales de albanileria (mortero, yeso, ladrillos, placas de yeso)
- Materiales de fontaneria (tuberias multicapa, PVC, llaves, sifones)
- Materiales electricos (cable, mecanismos, cuadro, magnetotermicos)
- Revestimientos (azulejos, porcelanico, rodapies, adhesivo)
- Pintura (pintura plastica, imprimacion, masilla)
- Sanitarios (inodoro, lavabo, plato ducha, monomandos)
- Materiales auxiliares (tornilleria, silicona, cinta, protecciones)

Cada material DEBE tener supplier_name: usa "Leroy Merlin", "Obramat", "Bricomart", "Saltoki", o "Referencia mercado" segun aplique.

PROVEEDORES (provider_options):
Genera SIEMPRE al menos 2 proveedores con sus materiales asignados.`;
    }

    const systemPrompt = `${sectorConfig.prompt}

Tu tarea es actuar como un Agente Inteligente de ${sectorConfig.name} y analizar detalladamente la peticion de presupuesto del usuario.

CONTEXTO DEL SISTEMA Y AGENTE N8N:
${regContext}
${marketPriceContext}

${priceContext}

Si el usuario no tiene materiales en su catalogo que coincidan con la peticion, usa referencias de mercado de Espana o las de "PRECIOS MERCADO".
${pricingInstructions}

DEVUELVE UNICAMENTE UN JSON CON LA SIGUIENTE ESTRUCTURA EXACTA:
{
  "summary": "Resumen corto de 1 linea",
  "confidence_score": 90,
  "source": "supabase_agent_data_claude",
  "detected_scope": {
    "sector": "${activeSector}",
    "service_type": "${service_type || 'general'}",
    "area_m2": 90,
    "location": ""
  },
  "suggested_items": [
    {
      "concept": "Nombre especifico de la partida",
      "description": "Descripcion detallada con medidas y especificaciones",
      "quantity": 24,
      "unit": "m2",
      "unit_cost": 35.0,
      "margin_pct": 20,
      "category": "mano_obra",
      "chapter": "Demoliciones"
    }
  ],
  "suggested_materials": [
    {
      "concept": "Nombre material concreto",
      "quantity": 5,
      "unit": "sacos",
      "unit_cost": 12.50,
      "supplier_name": "Leroy Merlin",
      "source": "retail_provider"
    }
  ],
  "provider_options": [
    {
      "name": "Leroy Merlin",
      "materials_count": 12,
      "estimated_total": 2500.0,
      "source": "n8n_market"
    }
  ],
  "regulatory_notes": [
    {
      "title": "Aviso normativo",
      "description": "Detalle normativo extraido del contexto",
      "severity": "info",
      "source": "sector_agent"
    }
  ],
  "calendar_phases": [
    {
      "title": "Fase 1: Demoliciones",
      "duration_days": 5,
      "description": "Demolicion y retirada de escombros"
    }
  ],
  "estimated_timeline": {
    "total_duration_days": 45,
    "total_duration_weeks": 9,
    "confidence": 0.75,
    "notes": "Plazo estimado para una reforma integral de vivienda de 90m2"
  },
  "estimated_price_range": {
    "min": 45000,
    "max": 90000
  },
  "pricing_confidence": 80,
  "missing_questions": [
    "Pregunta importante para el cliente para aclarar el alcance"
  ]
}

REGLAS:
1. No envuelvas el JSON en markdown, devuelve SOLO el objeto JSON.
2. suggested_items incluye TODAS las partidas: mano de obra, servicios, instalaciones. Cada una con su chapter.
3. suggested_materials son los materiales fisicos necesarios (NO mano de obra). Cada uno con supplier_name.
4. Genera datos coherentes con el alcance descrito y los precios de mercado espanol.
5. Para construccion: MINIMO 20 suggested_items y MINIMO 15 suggested_materials en una reforma integral.
6. Incluye SIEMPRE estimated_timeline y calendar_phases.
7. Incluye SIEMPRE estimated_price_range con el rango de mercado para el tipo de trabajo.
8. Los precios deben ser REALISTAS para el mercado espanol actual (2024-2026).`;

    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Analiza esta peticion de presupuesto y genera la estructura JSON completa con TODAS las partidas detalladas, materiales, proveedores, fases y timeline:\n\nDescripcion:\n"${description}"\n\nTipo: ${service_type || "general"}\n\nRecuerda: para construccion necesito MINIMO 20 partidas y 15 materiales con precios realistas de mercado espanol.`
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
      console.error("[budget-analysis] Failed to parse JSON. Raw response length:", responseText.length);
      console.error("[budget-analysis] First 500 chars:", responseText.slice(0, 500));
      throw new Error("El agente devolvio un formato invalido. Intenta de nuevo.");
    }

    // Post-processing: ensure arrays exist
    if (!result.suggested_items) result.suggested_items = [];
    if (!result.suggested_materials) result.suggested_materials = [];
    if (!result.provider_options) result.provider_options = [];
    if (!result.calendar_phases) result.calendar_phases = [];
    if (!result.missing_questions) result.missing_questions = [];
    if (!result.regulatory_notes) result.regulatory_notes = [];

    // Post-processing: ensure detected_scope
    if (!result.detected_scope) {
      result.detected_scope = { sector: activeSector, service_type: service_type || "general", area_m2: null, location: "" };
    }

    // Post-processing: ensure timeline exists
    if (!result.estimated_timeline && result.calendar_phases.length > 0) {
      const totalDays = result.calendar_phases.reduce((s: number, p: any) => s + (p.duration_days || 0), 0);
      result.estimated_timeline = {
        total_duration_days: totalDays,
        total_duration_weeks: Math.ceil(totalDays / 5),
        confidence: 0.7,
        notes: "Estimacion calculada desde las fases del calendario."
      };
    }

    const n8nItemsCount = priceItems.filter(p => p.source_type === "n8n_sync" || (p.source_url && p.source_url.includes("n8n")) || p.supplier_name === "Leroy Merlin" || p.supplier_name === "OBRAMAT").length;
    const defaultItemsCount = priceItems.filter(p => p.source_type === "default" || p.supplier_name === "Banco ENLAZE base").length;
    const realSuppliers = Array.from(new Set(priceItems.map(p => p.supplier_name).filter(s => s === "Leroy Merlin" || s === "OBRAMAT")));

    result.data_sources = {
      price_items_count: priceItems.length,
      n8n_items_count: n8nItemsCount,
      default_items_count: defaultItemsCount,
      sector_price_count: refPrices.length,
      sector_regulation_count: regulations.length,
      real_suppliers: realSuppliers,
      using_fallback: n8nItemsCount < 10,
      fallback_reason: n8nItemsCount < 10 ? `Catalogo real insuficiente: solo ${n8nItemsCount} precios n8n sincronizados` : ""
    };

    // Log summary for debugging
    console.log(`[budget-analysis] OK: ${result.suggested_items.length} partidas, ${result.suggested_materials.length} materials, area=${result.detected_scope?.area_m2}m2`);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[budget-analysis] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
