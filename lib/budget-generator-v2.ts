/**
 * budget-generator-v2.ts
 *
 * FASE 2 del generador de presupuestos v2.
 * Genera partidas detalladas a partir del ProjectAnalysis (FASE 1).
 *
 * Usa Claude Sonnet para generar la estructura de partidas con:
 *   - Descripcion tecnica profesional
 *   - Cantidades calculadas con formulas explicitas
 *   - Precios del banco tecnico cuando hay coincidencia
 *   - Oficios y horas estimadas
 *   - Codigos de partida con formato NN.CAP.NNN
 *
 * Claude genera estructura + cantidades. Los precios finales se resuelven
 * en FASE 3 (price-resolver.ts). Este modulo puede sugerir precios de
 * referencia del banco tecnico, pero la resolucion real es determinista.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  BudgetScopeV2,
  BudgetItemV2,
  ProjectAnalysis,
  BudgetPreferences,
  ChapterCode,
  TradeCode,
  PriceSourceV2,
} from "./types/budget-v2";
import type { TechnicalPriceEntry } from "./price-resolver";

// ─── Chapter order for code generation ──────────────────────────────────────

const CHAPTER_ORDER: Record<ChapterCode, string> = {
  protecciones: "01",
  demoliciones: "02",
  albanileria: "03",
  fontaneria: "04",
  electricidad: "05",
  impermeabilizacion: "06",
  revestimientos: "07",
  pavimentos: "08",
  rodapie: "09",
  pintura: "10",
  carpinteria_interior: "11",
  carpinteria_exterior: "12",
  sanitarios: "13",
  cocina: "14",
  climatizacion: "15",
  falsos_techos: "16",
  residuos: "17",
  limpieza: "18",
  seguridad: "19",
  otros: "20",
};

const CHAPTER_CODE_PREFIX: Record<ChapterCode, string> = {
  protecciones: "PROT",
  demoliciones: "DEM",
  albanileria: "ALB",
  fontaneria: "FON",
  electricidad: "ELE",
  impermeabilizacion: "IMP",
  revestimientos: "REV",
  pavimentos: "PAV",
  rodapie: "ROD",
  pintura: "PIN",
  carpinteria_interior: "CIN",
  carpinteria_exterior: "CEX",
  sanitarios: "SAN",
  cocina: "COC",
  climatizacion: "CLI",
  falsos_techos: "FTC",
  residuos: "RES",
  limpieza: "LIM",
  seguridad: "SEG",
  otros: "OTR",
};

// ─── Cost coefficients by chapter (when no decomposition available) ─────────

const COST_COEFFICIENTS: Record<string, { material: number; labor: number; machinery: number; waste: number }> = {
  demoliciones:           { material: 0.05, labor: 0.80, machinery: 0.10, waste: 0.05 },
  albanileria:            { material: 0.40, labor: 0.50, machinery: 0.05, waste: 0.05 },
  fontaneria:             { material: 0.55, labor: 0.40, machinery: 0.03, waste: 0.02 },
  electricidad:           { material: 0.50, labor: 0.45, machinery: 0.02, waste: 0.03 },
  impermeabilizacion:     { material: 0.45, labor: 0.48, machinery: 0.02, waste: 0.05 },
  revestimientos:         { material: 0.45, labor: 0.48, machinery: 0.02, waste: 0.05 },
  pavimentos:             { material: 0.50, labor: 0.42, machinery: 0.03, waste: 0.05 },
  rodapie:                { material: 0.50, labor: 0.42, machinery: 0.03, waste: 0.05 },
  pintura:                { material: 0.30, labor: 0.65, machinery: 0.02, waste: 0.03 },
  carpinteria_interior:   { material: 0.65, labor: 0.30, machinery: 0.02, waste: 0.03 },
  carpinteria_exterior:   { material: 0.70, labor: 0.25, machinery: 0.02, waste: 0.03 },
  sanitarios:             { material: 0.70, labor: 0.25, machinery: 0.02, waste: 0.03 },
  cocina:                 { material: 0.75, labor: 0.20, machinery: 0.02, waste: 0.03 },
  climatizacion:          { material: 0.60, labor: 0.30, machinery: 0.08, waste: 0.02 },
  falsos_techos:          { material: 0.45, labor: 0.48, machinery: 0.02, waste: 0.05 },
  residuos:               { material: 0.10, labor: 0.30, machinery: 0.60, waste: 0.00 },
  limpieza:               { material: 0.15, labor: 0.80, machinery: 0.05, waste: 0.00 },
  protecciones:           { material: 0.40, labor: 0.50, machinery: 0.05, waste: 0.05 },
  seguridad:              { material: 0.50, labor: 0.40, machinery: 0.05, waste: 0.05 },
  otros:                  { material: 0.40, labor: 0.50, machinery: 0.05, waste: 0.05 },
};

// ─── Prompt FASE 2 ──────────────────────────────────────────────────────────

const GENERATION_SYSTEM_PROMPT = `Eres un presupuestador profesional con 25 años de experiencia en construcción y reformas en España. A partir del análisis de proyecto que recibes, genera las partidas detalladas con cantidades calculadas.

REGLAS ESTRICTAS:
1. Genera EXACTAMENTE las partidas identificadas en el análisis (required_items + auxiliary_items). No omitas ninguna. Puedes añadir partidas auxiliares que falten.
2. Cada partida debe tener descripción técnica profesional (no genérica).
   Ejemplo: NO "Demolición baño" SINO "Demolición de alicatado cerámico existente en paredes de baño, incluyendo enfoscado base, con retirada de escombros a contenedor."
3. Las cantidades deben calcularse con fórmulas explícitas basadas en los datos del formulario. Incluye quantity_calculation explicando de dónde sale cada número.
   Ejemplo: "perimetro_bano * altura * num_banos = (2*(2.0+1.6)) * 2.5 * 2 = 36 m2, ajustado -10% por puerta = 32.4 m2"
4. Cuando el BANCO DE PRECIOS TÉCNICO tenga una partida similar, usa ese precio como referencia para unit_cost. Marca price_source como "technical_bank".
5. Cuando NO haya coincidencia en el banco técnico, proporciona tu mejor estimación profesional del coste unitario total. Marca price_source como "estimated" y confidence_score como 0.40.
6. Separa el coste unitario en material_cost_per_unit y labor_cost_per_unit cuando sea posible. Si no puedes separar, pon el total en material_cost_per_unit y labor_cost_per_unit = 0.
7. Incluye trade (oficio responsable) y estimated_hours por partida.
8. El código de partida sigue el formato: NN.CAP.NNN (ej: 01.DEM.001, 07.REV.003)
9. Asigna id único a cada partida: formato "cap-NNN" (ej: "dem-001", "rev-003")
10. Las dependencias son los capítulos que deben completarse antes de esta partida.

CAMPOS REQUERIDOS POR PARTIDA (JSON):
{
  "id": "cap-NNN",
  "chapter": "chapter_code",
  "code": "NN.CAP.NNN",
  "name": "Nombre técnico de la partida",
  "description": "Descripción técnica detallada",
  "unit": "m2|ml|ud|m3|pa|kg|h|punto",
  "quantity": number,
  "quantity_calculation": "fórmula explícita",
  "trade": "trade_code",
  "estimated_hours": number,
  "priority": "obligatoria|recomendada|opcional",
  "dependencies": ["chapter_code"],
  "material_cost_per_unit": number,
  "labor_cost_per_unit": number,
  "labor_hours_per_unit": number,
  "machinery_cost_per_unit": number,
  "unit_cost": number,
  "confidence_score": number (0.0-1.0),
  "price_source": "technical_bank|estimated",
  "price_source_detail": "string",
  "materials": [
    { "name": "string", "quantity": number, "unit": "string", "unit_price": number }
  ]
}

Responde ÚNICAMENTE con un array JSON de partidas: [{ ... }, { ... }]`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

function extractJsonArray(text: string): string {
  const cleaned = stripCodeFences(text);
  const first = cleaned.indexOf("[");
  const last = cleaned.lastIndexOf("]");
  if (first !== -1 && last > first) return cleaned.slice(first, last + 1).trim();
  // Fallback: try as object wrapper
  const objFirst = cleaned.indexOf("{");
  const objLast = cleaned.lastIndexOf("}");
  if (objFirst !== -1 && objLast > objFirst) {
    const obj = cleaned.slice(objFirst, objLast + 1);
    // Maybe it's { "items": [...] }
    try {
      const parsed = JSON.parse(obj);
      if (Array.isArray(parsed.items)) return JSON.stringify(parsed.items);
      if (Array.isArray(parsed.partidas)) return JSON.stringify(parsed.partidas);
    } catch {
      // ignore
    }
  }
  return cleaned;
}

/**
 * Build the user message for FASE 2.
 */
function buildGenerationMessage(
  analysis: ProjectAnalysis,
  scope: BudgetScopeV2,
  technicalPrices: TechnicalPriceEntry[],
  userPrices: Array<{ name: string; unit_price: number; unit: string }>,
): string {
  const lines: string[] = [];

  // Analysis context
  lines.push("ANALISIS DEL PROYECTO:");
  lines.push(JSON.stringify(analysis, null, 2));

  lines.push("");
  lines.push("DATOS DEL FORMULARIO:");
  lines.push(`- Tipo: ${scope.project_type}`);
  lines.push(`- Superficie: ${scope.surface_m2} m2`);
  lines.push(`- Banos: ${scope.num_bathrooms}`);
  lines.push(`- Habitaciones: ${scope.num_rooms}`);
  lines.push(`- Cocina: ${scope.includes_kitchen ? "SI" : "NO"}`);
  lines.push(`- Ventanas: ${scope.includes_windows ? "SI" : "NO"}`);
  lines.push(`- Climatizacion: ${scope.includes_hvac ? "SI" : "NO"}`);
  lines.push(`- Calidad: ${scope.quality}`);
  lines.push(`- Ubicacion: ${scope.location}`);
  lines.push(`- Estado actual: ${scope.current_state}`);

  if (scope.rooms.length > 0) {
    lines.push(`- Estancias: ${scope.rooms.join(", ")}`);
  }

  // Technical prices (filtered to relevant chapters only)
  if (technicalPrices.length > 0) {
    const relevantChapters = new Set(analysis.required_chapters.map(c => c.code));
    const relevantPrices = technicalPrices.filter(p => {
      // Include prices whose name might match any required chapter
      const nameLower = p.name.toLowerCase();
      for (const ch of relevantChapters) {
        if (nameLower.includes(ch.replace("_", " ")) || nameLower.includes(ch)) return true;
      }
      return true; // Include all if we can't filter well — Claude will pick relevant ones
    }).slice(0, 100); // Limit to avoid token overflow

    lines.push("");
    lines.push("BANCO DE PRECIOS TECNICO DISPONIBLE:");
    lines.push(JSON.stringify(relevantPrices.map(p => ({
      name: p.name,
      code: p.item_code,
      unit: p.unit,
      price: p.unit_price,
      source: p.source,
    })), null, 2));
  } else {
    lines.push("");
    lines.push("BANCO DE PRECIOS TECNICO: No hay precios tecnicos disponibles. Usa estimaciones profesionales.");
  }

  // User prices
  if (userPrices.length > 0) {
    lines.push("");
    lines.push("PRECIOS DEL USUARIO:");
    lines.push(JSON.stringify(userPrices.slice(0, 50), null, 2));
  }

  lines.push("");
  lines.push("Genera todas las partidas detalladas como array JSON.");

  return lines.join("\n");
}

// ─── Validation / sanitization ──────────────────────────────────────────────

const VALID_CHAPTERS = new Set<string>([
  "protecciones", "demoliciones", "albanileria", "fontaneria", "electricidad",
  "impermeabilizacion", "revestimientos", "pavimentos", "rodapie", "pintura",
  "carpinteria_interior", "carpinteria_exterior", "sanitarios", "cocina",
  "climatizacion", "falsos_techos", "residuos", "limpieza", "seguridad", "otros",
]);

const VALID_TRADES = new Set<string>([
  "oficial_albanil", "peon", "peon_especialista", "fontanero", "electricista",
  "pintor", "alicatador", "carpintero", "cerrajero", "cristalero",
  "climatizador", "encargado", "subcontrata",
]);

const VALID_PRIORITIES = new Set(["obligatoria", "recomendada", "opcional"]);

/**
 * Sanitize and complete raw items from Claude output.
 * Fills in missing fields, validates enums, generates codes if missing.
 */
function sanitizeItems(
  rawItems: Record<string, unknown>[],
  preferences: BudgetPreferences,
): BudgetItemV2[] {
  const chapterCounters: Record<string, number> = {};

  return rawItems.map((raw, idx) => {
    const item = raw as Record<string, unknown>;

    // Validate chapter
    let chapter = String(item.chapter || "otros").toLowerCase() as ChapterCode;
    if (!VALID_CHAPTERS.has(chapter)) chapter = "otros" as ChapterCode;

    // Generate code if missing
    chapterCounters[chapter] = (chapterCounters[chapter] || 0) + 1;
    const chapterNum = CHAPTER_ORDER[chapter] || "20";
    const prefix = CHAPTER_CODE_PREFIX[chapter] || "OTR";
    const counter = String(chapterCounters[chapter]).padStart(3, "0");
    const code = String(item.code || `${chapterNum}.${prefix}.${counter}`);

    // Validate trade
    let trade = String(item.trade || "peon").toLowerCase() as TradeCode;
    if (!VALID_TRADES.has(trade)) trade = "peon" as TradeCode;

    // Validate priority
    let priority = String(item.priority || "obligatoria").toLowerCase();
    if (!VALID_PRIORITIES.has(priority)) priority = "obligatoria";

    // Parse numeric fields
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const materialCostPerUnit = Math.max(0, Number(item.material_cost_per_unit) || 0);
    const laborCostPerUnit = Math.max(0, Number(item.labor_cost_per_unit) || 0);
    const laborHoursPerUnit = Math.max(0, Number(item.labor_hours_per_unit) || 0);
    const machineryCostPerUnit = Math.max(0, Number(item.machinery_cost_per_unit) || 0);
    const unitCost = Number(item.unit_cost) || (materialCostPerUnit + laborCostPerUnit + machineryCostPerUnit);
    const confidenceScore = Math.min(1, Math.max(0, Number(item.confidence_score) || 0.40));

    // Calculate sale price with margin
    const marginPercent = preferences.margin_percent || 25;
    const unitPriceSale = Number((unitCost * (1 + marginPercent / 100)).toFixed(2));
    const subtotalCost = Number((quantity * unitCost).toFixed(2));
    const subtotalSale = Number((quantity * unitPriceSale).toFixed(2));

    // Price source
    let priceSource = String(item.price_source || "estimated") as PriceSourceV2;
    if (!["user_catalog", "technical_bank", "enlaze_base", "n8n_market", "web_search", "estimated"].includes(priceSource)) {
      priceSource = "estimated" as PriceSourceV2;
    }

    // ID
    const id = String(item.id || `${chapter.replace(/_/g, "").slice(0, 3)}-${counter}`);

    // Dependencies
    let dependencies: ChapterCode[] = [];
    if (Array.isArray(item.dependencies)) {
      dependencies = (item.dependencies as string[])
        .map(d => String(d).toLowerCase() as ChapterCode)
        .filter(d => VALID_CHAPTERS.has(d));
    }

    // Materials
    let materials: BudgetItemV2["materials"] = [];
    if (Array.isArray(item.materials)) {
      materials = (item.materials as Record<string, unknown>[]).map(m => ({
        name: String(m.name || ""),
        quantity: Number(m.quantity) || 0,
        unit: String(m.unit || "ud"),
        unit_price: Number(m.unit_price) || 0,
        subtotal: Number((Number(m.quantity) || 0) * (Number(m.unit_price) || 0)),
        supplier: "",
        source: priceSource,
        confidence: confidenceScore,
      }));
    }

    return {
      id,
      chapter,
      code,
      name: String(item.name || `Partida ${idx + 1}`),
      description: String(item.description || ""),
      unit: String(item.unit || "ud"),
      quantity,
      quantity_calculation: String(item.quantity_calculation || ""),
      trade,
      estimated_hours: Math.max(0, Number(item.estimated_hours) || 0),
      priority: priority as BudgetItemV2["priority"],
      dependencies,

      material_cost_per_unit: materialCostPerUnit,
      labor_cost_per_unit: laborCostPerUnit,
      labor_hours_per_unit: laborHoursPerUnit,
      machinery_cost_per_unit: machineryCostPerUnit,
      unit_cost: Number(unitCost.toFixed(2)),
      unit_price_sale: unitPriceSale,
      subtotal_cost: subtotalCost,
      subtotal_sale: subtotalSale,

      margin_percent: marginPercent,
      confidence_score: confidenceScore,
      price_source: priceSource,
      price_source_detail: String(item.price_source_detail || ""),
      supplier: null,

      materials,
    };
  });
}

/**
 * Apply cost coefficient breakdown when Claude only provides unit_cost
 * without separating material/labor/machinery.
 */
export function applyCostCoefficients(items: BudgetItemV2[]): BudgetItemV2[] {
  return items.map(item => {
    // If Claude already separated costs, keep them
    if (item.material_cost_per_unit > 0 && item.labor_cost_per_unit > 0) {
      return item;
    }

    // If only unit_cost is set, apply coefficients
    if (item.unit_cost > 0 && item.material_cost_per_unit === 0 && item.labor_cost_per_unit === 0) {
      const coeffs = COST_COEFFICIENTS[item.chapter] || COST_COEFFICIENTS.otros;
      return {
        ...item,
        material_cost_per_unit: Number((item.unit_cost * coeffs.material).toFixed(2)),
        labor_cost_per_unit: Number((item.unit_cost * coeffs.labor).toFixed(2)),
        machinery_cost_per_unit: Number((item.unit_cost * coeffs.machinery).toFixed(2)),
      };
    }

    return item;
  });
}

// ─── API publica ────────────────────────────────────────────────────────────

export interface GenerateBudgetOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export interface GenerateBudgetResult {
  ok: boolean;
  items: BudgetItemV2[];
  rawResponse?: string;
  error?: string;
  durationMs: number;
}

/**
 * FASE 2: Genera partidas detalladas a partir de un ProjectAnalysis.
 *
 * Input:
 *   - analysis: resultado de FASE 1 (analyzeProject)
 *   - scope: datos del formulario del usuario
 *   - preferences: margen, calidad, etc.
 *   - technicalPrices: precios del banco tecnico (pre-fetched)
 *   - userPrices: precios del catalogo del usuario (pre-fetched)
 *
 * Output:
 *   - BudgetItemV2[] con cantidades, costes estimados, fuentes
 *
 * Puro: no accede a base de datos. El caller pasa los datos pre-fetched.
 * Los precios que genera Claude son ESTIMACIONES que seran refinadas
 * por price-resolver en FASE 3.
 */
export async function generateBudgetItems(
  analysis: ProjectAnalysis,
  scope: BudgetScopeV2,
  preferences: BudgetPreferences,
  technicalPrices: TechnicalPriceEntry[],
  userPrices: Array<{ name: string; unit_price: number; unit: string }>,
  options: GenerateBudgetOptions,
): Promise<GenerateBudgetResult> {
  const start = Date.now();

  try {
    const anthropic = new Anthropic({ apiKey: options.apiKey });
    const model = options.model || "claude-sonnet-4-6";
    const maxTokens = options.maxTokens || 8192;

    const userMessage = buildGenerationMessage(analysis, scope, technicalPrices, userPrices);

    const message = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      system: GENERATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Parse JSON array
    let parsed: Record<string, unknown>[];
    try {
      parsed = JSON.parse(extractJsonArray(responseText));
      if (!Array.isArray(parsed)) {
        throw new Error("Response is not an array");
      }
    } catch {
      // Attempt repair
      const repair = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: `El siguiente texto debería ser un array JSON válido de partidas de presupuesto, pero tiene errores de formato. Corrígelo y devuelve SOLO el array JSON válido, sin explicación:\n\n${responseText}`,
          },
        ],
      });
      const repairText = repair.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      parsed = JSON.parse(extractJsonArray(repairText));
      if (!Array.isArray(parsed)) {
        throw new Error("Repaired response is not an array");
      }
    }

    // Sanitize and complete items
    let items = sanitizeItems(parsed, preferences);

    // Apply cost coefficients where needed
    items = applyCostCoefficients(items);

    return {
      ok: true,
      items,
      rawResponse: responseText,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      items: [],
      error: errorMessage,
      durationMs: Date.now() - start,
    };
  }
}
