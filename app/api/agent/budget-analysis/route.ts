import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSectorConfig } from "@/lib/agent-prompts";
import { normalizeSector } from "@/lib/sector-config";
import { inferBudgetActions, normalizeBathroomCount, type BudgetScope } from "@/lib/budget-engine";
import { buildDeterministicBudgetAnalysis } from "@/lib/budget-analysis-fallback";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

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
    // The shared market tracker is written with the service role. Reading it
    // through the user's cookie client can legitimately return zero because of
    // RLS, even while the price-tracker screen contains thousands of rows.
    const trackerDb = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } }
        )
      : supabase;

    const body = await request.json();
    const {
      sector,
      description,
      service_type,
      scope,
      project_id,
      technical_document_ids,
    } = body;

    const hasStructuredScope =
      Number(scope?.superficie_m2) > 0 ||
      Boolean(service_type) ||
      (Array.isArray(scope?.actuaciones) && scope.actuaciones.length > 0) ||
      (Array.isArray(scope?.estancias) && scope.estancias.length > 0);
    if (!hasStructuredScope && (!description || description.trim().length < 5)) {
      return NextResponse.json(
        { error: "Indica superficie y tipo de obra, o añade una descripción breve" },
        { status: 400 },
      );
    }

    const activeSector = normalizeSector(sector || "construccion");
    const sectorConfig = getSectorConfig(activeSector);
    const explicitActions = Array.isArray(scope?.actuaciones)
      ? scope.actuaciones.filter((action: unknown): action is string => typeof action === "string" && action.length > 0)
      : [];
    const inferredActions = explicitActions.length > 0
      ? explicitActions
      : inferBudgetActions(`${service_type || ""} ${description || ""}`);
    const engineScope: BudgetScope = {
      superficie_m2: Math.max(Number(scope?.superficie_m2) || 80, 1),
      num_banos: normalizeBathroomCount(scope?.num_banos),
      incluye_cocina: scope?.incluye_cocina ?? inferredActions.includes("cocina_montaje"),
      incluye_ventanas: scope?.incluye_ventanas ?? inferredActions.includes("carpinteria_exterior"),
      incluye_climatizacion: scope?.incluye_climatizacion ?? inferredActions.includes("climatizacion"),
      estancias: Array.isArray(scope?.estancias) ? scope.estancias.filter((room: unknown): room is string => typeof room === "string") : [],
      actuaciones: inferredActions,
      calidad: ["basica", "media", "alta"].includes(scope?.calidad) ? scope.calidad : "media",
      ubicacion: String(scope?.ubicacion || ""),
    };

    const selectedTechnicalDocumentIds = Array.isArray(technical_document_ids)
      ? technical_document_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];

    const [
      { count: sharedTrackerProductsCount, error: trackerCountError },
      { count: privateTrackerProductsCount },
      { data: technicalDocumentsData },
    ] = await Promise.all([
      trackerDb
        .from("pb_products")
        .select("id, pb_providers!inner(company_id)", { count: "exact", head: true })
        .eq("sector", activeSector)
        .eq("is_active", true)
        .eq("is_available", true)
        .is("pb_providers.company_id", null)
        .gt("unit_price", 0),
      supabase
        .from("price_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("sector", activeSector)
        .eq("is_active", true)
        .gt("unit_price", 0),
      selectedTechnicalDocumentIds.length > 0 && project_id
        ? supabase
            .from("project_documents")
            .select("id, name, description, file_url, mime_type, doc_type, extracted_measurements")
            .eq("user_id", user.id)
            .eq("project_id", project_id)
            .in("id", selectedTechnicalDocumentIds)
        : Promise.resolve({ data: [] }),
    ]);
    if (trackerCountError) {
      console.error("[budget-analysis] Tracker count failed:", trackerCountError.message);
    }
    // Some legacy n8n workflows wrote the tracked catalogue to price_items.
    // Prefer the shared V2 count, but retain that catalogue as a safe fallback.
    const trackerProductsCount =
      (sharedTrackerProductsCount ?? 0) > 0
        ? sharedTrackerProductsCount ?? 0
        : privateTrackerProductsCount ?? 0;

    const technicalDocuments = await Promise.all((technicalDocumentsData || []).map(async (document: any) => {
      const publicMarker = "/storage/v1/object/public/project-docs/";
      const storedValue = String(document.file_url || "");
      const storedPath = storedValue.includes(publicMarker)
        ? decodeURIComponent(storedValue.split(publicMarker)[1] || "")
        : storedValue;
      if (!storedPath || (/^https?:\/\//i.test(storedPath) && !storedValue.includes(publicMarker))) {
        return { ...document, analysis_url: storedPath };
      }
      const { data: signed } = await supabase.storage
        .from("project-docs")
        .createSignedUrl(storedPath, 600);
      return { ...document, analysis_url: signed?.signedUrl || "" };
    }));

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
    const news = sectorData?.filter(d => d.data_type === "news") || [];

    // Extract location from scope for zone-specific pricing
    const ubicacion = scope?.ubicacion || "";

    // Build context
    let priceContext = "NO HAY PRECIOS PRIVADOS EN BBDD.\n";
    if (priceItems && priceItems.length > 0) {
      priceContext = "CATALOGO PRIVADO DEL USUARIO:\n" + priceItems.map(p => `- ${p.name} | Proveedor: ${p.supplier_name || 'Generico'} | ${p.unit_price} EUR/${p.unit}`).join("\n");
    }

    let regContext = "";
    if (regulations.length > 0) {
      regContext = "NORMATIVAS Y BOE ACTUALES (sincronizado por agente n8n):\n" + regulations.map(r => `- ${r.title}: ${r.description} (Fuente: ${r.source || "n8n"})`).join("\n");
    }

    let marketPriceContext = "";
    if (refPrices.length > 0) {
      marketPriceContext = "PRECIOS DE MERCADO REALES (sincronizados por agente n8n desde proveedores):\n" + refPrices.map(r => {
        const supplier = r.metadata?.supplier_name || r.source || "mercado";
        return `- ${r.title}: ${r.value} EUR/${r.unit} | Proveedor: ${supplier} | Fuente: ${r.source}`;
      }).join("\n");
      marketPriceContext += `\n\nIMPORTANTE: Usa estos precios de mercado reales como REFERENCIA PRINCIPAL. Son datos actualizados de proveedores reales en Espana.`;
    }

    let newsContext = "";
    if (news.length > 0) {
      newsContext = "NOTICIAS Y ACTUALIZACIONES DEL SECTOR (agente n8n):\n" + news.slice(0, 5).map(n => `- ${n.title}: ${n.description}`).join("\n");
    }

    const trackerContext = `
RASTREADOR DE PRECIOS ENLAZE:
- Hay ${trackerProductsCount ?? 0} productos activos, disponibles y con precio comprobado en el rastreador para este sector.
- Tu funcion es definir las NECESIDADES TECNICAS, cantidades, unidades y capitulos.
- Los importes de materiales que propongas son solo provisionales. Tras tu analisis, ENLAZE resolvera de forma determinista cada material contra el rastreador y guardara proveedor, fuente, fecha y fiabilidad.
- No afirmes que un material tiene precio real si no se aporta una coincidencia concreta en el contexto.`;

    const technicalDocumentsContext = technicalDocuments.length > 0
      ? `DOCUMENTACION TECNICA SELECCIONADA:
${technicalDocuments.map((doc: any) => {
  const extracted = doc.extracted_measurements
    ? ` | Mediciones extraidas: ${JSON.stringify(doc.extracted_measurements).slice(0, 1500)}`
    : "";
  return `- ${doc.name}${doc.description ? `: ${doc.description}` : ""}${extracted}`;
}).join("\n")}

REGLA: las mediciones, unidades, calidades y especificaciones de estos documentos tienen prioridad sobre cualquier estimacion generica. Si falta un dato, indicalo en missing_questions; no lo inventes.`
      : "No se ha seleccionado documentacion tecnica del arquitecto.";

    // Location-based pricing context
    let locationContext = "";
    if (ubicacion) {
      locationContext = `\nUBICACION DE LA OBRA: ${ubicacion}
INSTRUCCIONES POR ZONA GEOGRAFICA:
- Calcula la mano de obra y los servicios con una base nacional coherente. ENLAZE aplicara despues un coeficiente geografico visible y auditable.
- NO multipliques el precio de los productos del rastreador por la ubicacion: el producto conserva su precio comprobado.
- Considera las normativas urbanisticas locales y ordenanzas municipales de "${ubicacion}"
- Incluye en regulatory_notes cualquier normativa especifica de la zona (CTE, DB-HE, ordenanzas locales)
- Los costes de mano de obra y transporte dependen de la ubicacion`;
    }

    // --- CONSTRUCTION-SPECIFIC PRICING INSTRUCTIONS ---
    let pricingInstructions = "";
    if (activeSector === "construccion") {
      pricingInstructions = `
INSTRUCCIONES CRITICAS PARA CONSTRUCCION:
- La superficie, estancias, actuaciones, calidad y ubicacion del FORMULARIO son vinculantes.
- No uses la descripcion para ampliar el alcance ni para cambiar una seleccion del formulario.
- Si solo se seleccionan algunas estancias, calcula cantidades para esas estancias, no para toda la vivienda.
- Si hay actuaciones seleccionadas, genera exclusivamente esas actuaciones y sus auxiliares tecnicamente imprescindibles.
- Los unit_cost son provisionales: no los presentes como precios comprobados. ENLAZE los contrastara despues con tarifas, BC3 y rastreador.

NIVEL DE DETALLE OBLIGATORIO PARA CONSTRUCCION:
Solo para una reforma integral sin actuaciones limitadas, genera MINIMO 20 partidas (suggested_items) organizadas por capitulos. Ejemplo de capitulos:
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

DATOS DEL AGENTE N8N DE CONSTRUCCION (datos reales sincronizados):
${regContext || "Sin normativas sincronizadas por n8n todavia."}
${marketPriceContext || "Sin precios de mercado sincronizados por n8n todavia."}
${newsContext || ""}
${locationContext}
${trackerContext}
${technicalDocumentsContext}

${priceContext}

PRIORIDAD DE FUENTES DE PRECIOS:
1. Precios de mercado reales del agente n8n (PRECIOS DE MERCADO REALES) — MAXIMA prioridad
2. Catalogo privado del usuario — segunda prioridad
3. Referencias de mercado espanol general (2024-2026) — si no hay datos n8n
${pricingInstructions}

DEVUELVE UNICAMENTE UN JSON CON LA SIGUIENTE ESTRUCTURA EXACTA:
{
  "summary": "Resumen corto de 1 linea",
  "confidence_score": 90,
  "source": "supabase_agent_data_claude",
  "detected_scope": {
    "sector": "${activeSector}",
    "service_type": "${service_type || 'general'}",
    "area_m2": ${scope?.superficie_m2 || "null"},
    "location": "${ubicacion || ""}"
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
      "chapter": "Demoliciones",
      "estimated_hours": 16
    }
  ],
  "suggested_materials": [
    {
      "concept": "Nombre material concreto",
      "quantity": 5,
      "unit": "sacos",
      "unit_cost": 12.50,
      "supplier_name": "Leroy Merlin",
      "source": "provisional_pending_tracker"
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
      "description": "Demolicion y retirada de escombros",
      "depends_on": []
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
4. Genera datos coherentes con el alcance estructurado; la descripcion solo complementa.
5. Para construccion integral: MINIMO 20 suggested_items y MINIMO 15 suggested_materials. Para alcance parcial, incluye solo las actuaciones seleccionadas con el detalle necesario.
6. Incluye SIEMPRE estimated_timeline y calendar_phases.
7. Incluye SIEMPRE estimated_price_range con el rango de mercado para el tipo de trabajo.
8. Incluye estimated_hours en cada partida y depends_on en cada fase para poder planificar la ejecucion.
9. Los precios de suggested_materials son provisionales hasta que el rastreador confirme una coincidencia.
10. No afirmes que un precio es real o actual: la verificacion ocurre despues en el motor de ENLAZE.`;

    const userPrompt = scope
      ? `DATOS ESTRUCTURADOS DEL PROYECTO (FUENTE PRINCIPAL — usa estos datos para dimensionar partidas, cantidades y precios):
- Tipo de obra: ${service_type || "general"}
- Superficie: ${scope.superficie_m2 || "no indicada"} m2
- Ubicacion: ${scope.ubicacion || "no indicada (usar base nacional)"}
- Estancias afectadas: ${(scope.estancias || []).join(", ") || "no seleccionadas"}
- Actuaciones previstas: ${(scope.actuaciones || []).join(", ") || "no seleccionadas"}
- Nivel de calidad: ${scope.calidad || "media"}
- N. banos afectados: ${engineScope.num_banos}
- Incluye cocina: ${scope.incluye_cocina ? "si" : "no"}
- Incluye cambio ventanas: ${scope.incluye_ventanas ? "si" : "no"}
- Incluye climatizacion: ${scope.incluye_climatizacion ? "si" : "no"}

DESCRIPCION COMPLEMENTARIA del usuario:
"${description}"

INSTRUCCIONES:
1. Genera partidas para CADA actuacion seleccionada, dimensionadas segun la superficie y estancias.
2. Si el usuario marca "cocina", genera capitulo de cocina. Si marca "ventanas", genera carpinteria exterior. Etc.
3. La cantidad de cada partida debe calcularse a partir de los m2, banos, estancias y documentos tecnicos indicados.
4. Si no hay actuaciones limitadas y es una reforma integral, genera MINIMO 20 partidas y 15 materiales. Si hay actuaciones seleccionadas, no añadas capítulos ajenos a ellas.
5. La duracion debe ser realista para el alcance estructurado y debe incluir dependencias entre fases.
6. Si la descripcion contradice el formulario, ignora la contradiccion y conserva el formulario.`
      : `Analiza esta peticion de presupuesto y genera la estructura JSON completa:

Descripcion:
"${description}"

Tipo: ${service_type || "general"}

Para construccion necesito MINIMO 20 partidas y 15 materiales. Los precios de producto son provisionales hasta la verificacion del rastreador.`;

    const messageContent: any[] = [];
    for (const doc of technicalDocuments as any[]) {
      const analysisUrl = doc.analysis_url || doc.file_url;
      if (!analysisUrl) continue;
      const mimeType = String(doc.mime_type || "").toLowerCase();
      if (mimeType === "application/pdf" || String(doc.file_url).toLowerCase().endsWith(".pdf")) {
        messageContent.push({
          type: "document",
          source: { type: "url", url: analysisUrl },
          title: doc.name,
          context: "Proyecto de ejecucion, planos o mediciones aportados por el usuario. Extrae solo datos visibles y no inventes medidas.",
        });
      } else if (mimeType.startsWith("image/")) {
        messageContent.push({
          type: "image",
          source: { type: "url", url: analysisUrl },
        });
      }
    }
    messageContent.push({ type: "text", text: userPrompt });

    let result: any;
    let aiFallbackReason = "";
    try {
      if (!anthropic) throw new Error("ANTHROPIC_API_KEY no configurada");
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: messageContent,
          }
        ]
      });

      const responseText = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map(block => block.text)
        .join("");
      try {
        result = JSON.parse(extractJson(responseText));
      } catch {
        console.error("[budget-analysis] Failed to parse JSON. Raw response length:", responseText.length);
        throw new Error("El agente devolvió un formato inválido");
      }
    } catch (analysisError: unknown) {
      if (activeSector !== "construccion") throw analysisError;
      const rawMessage = analysisError instanceof Error ? analysisError.message : String(analysisError);
      aiFallbackReason = /credit balance|credits|billing/i.test(rawMessage)
        ? "Claude no tiene saldo disponible; cálculo realizado por el motor técnico ENLAZE."
        : "Claude no está disponible; cálculo realizado por el motor técnico ENLAZE.";
      console.warn("[budget-analysis] usando motor determinista", {
        status: analysisError && typeof analysisError === "object" && "status" in analysisError
          ? (analysisError as { status?: unknown }).status
          : null,
      });
      result = buildDeterministicBudgetAnalysis({
        sector: activeSector,
        serviceType: service_type || "reforma",
        scope: engineScope,
        trackerProductsCount: trackerProductsCount ?? 0,
        reason: aiFallbackReason,
      });
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
      ...(result.data_sources || {}),
      price_items_count: priceItems.length,
      n8n_items_count: n8nItemsCount,
      tracker_products_count: trackerProductsCount ?? 0,
      default_items_count: defaultItemsCount,
      sector_price_count: refPrices.length,
      sector_regulation_count: regulations.length,
      real_suppliers: realSuppliers,
      documents_used: technicalDocuments.map((doc: any) => ({ id: doc.id, name: doc.name })),
      analysis_mode: result.analysis_mode || "claude",
      using_ai_fallback: result.analysis_mode === "deterministic_engine",
      ai_fallback_reason: aiFallbackReason || result.data_sources?.ai_fallback_reason || "",
      using_fallback: (trackerProductsCount ?? 0) === 0,
      fallback_reason: (trackerProductsCount ?? 0) === 0
        ? "No hay productos activos con precio en el rastreador"
        : "",
    };

    // Log summary for debugging
    console.log(`[budget-analysis] OK: ${result.suggested_items.length} partidas, ${result.suggested_materials.length} materials, area=${result.detected_scope?.area_m2}m2`);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[budget-analysis] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
