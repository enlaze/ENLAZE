"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyCostCoefficients = applyCostCoefficients;
exports.generateBudgetItems = generateBudgetItems;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
// ─── Chapter order for code generation ──────────────────────────────────────
const CHAPTER_ORDER = {
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
const CHAPTER_CODE_PREFIX = {
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
const COST_COEFFICIENTS = {
    demoliciones: { material: 0.05, labor: 0.80, machinery: 0.10, waste: 0.05 },
    albanileria: { material: 0.40, labor: 0.50, machinery: 0.05, waste: 0.05 },
    fontaneria: { material: 0.55, labor: 0.40, machinery: 0.03, waste: 0.02 },
    electricidad: { material: 0.50, labor: 0.45, machinery: 0.02, waste: 0.03 },
    impermeabilizacion: { material: 0.45, labor: 0.48, machinery: 0.02, waste: 0.05 },
    revestimientos: { material: 0.45, labor: 0.48, machinery: 0.02, waste: 0.05 },
    pavimentos: { material: 0.50, labor: 0.42, machinery: 0.03, waste: 0.05 },
    rodapie: { material: 0.50, labor: 0.42, machinery: 0.03, waste: 0.05 },
    pintura: { material: 0.30, labor: 0.65, machinery: 0.02, waste: 0.03 },
    carpinteria_interior: { material: 0.65, labor: 0.30, machinery: 0.02, waste: 0.03 },
    carpinteria_exterior: { material: 0.70, labor: 0.25, machinery: 0.02, waste: 0.03 },
    sanitarios: { material: 0.70, labor: 0.25, machinery: 0.02, waste: 0.03 },
    cocina: { material: 0.75, labor: 0.20, machinery: 0.02, waste: 0.03 },
    climatizacion: { material: 0.60, labor: 0.30, machinery: 0.08, waste: 0.02 },
    falsos_techos: { material: 0.45, labor: 0.48, machinery: 0.02, waste: 0.05 },
    residuos: { material: 0.10, labor: 0.30, machinery: 0.60, waste: 0.00 },
    limpieza: { material: 0.15, labor: 0.80, machinery: 0.05, waste: 0.00 },
    protecciones: { material: 0.40, labor: 0.50, machinery: 0.05, waste: 0.05 },
    seguridad: { material: 0.50, labor: 0.40, machinery: 0.05, waste: 0.05 },
    otros: { material: 0.40, labor: 0.50, machinery: 0.05, waste: 0.05 },
};
// ─── Prompt FASE 2 ──────────────────────────────────────────────────────────
const GENERATION_SYSTEM_PROMPT = `Presupuestador profesional construcción España. Genera partidas detalladas en JSON array.

REGLAS:
- Genera TODAS las partidas del análisis (required_items + auxiliary_items). Añade auxiliares faltantes.
- Descripción técnica profesional, NO genérica. Ej: "Demolición de alicatado cerámico existente en paredes de baño, incluyendo enfoscado base, con retirada de escombros a contenedor."
- Cantidades con fórmula: "perimetro*altura*num = (2*(2.0+1.6))*2.5*2 = 36 m2"
- Si el BANCO TÉCNICO tiene precio similar: usa como unit_cost, price_source="technical_bank".
- Sin coincidencia: estima unit_cost, price_source="estimated", confidence_score=0.40.
- Separa material_cost_per_unit y labor_cost_per_unit. Si no puedes, pon total en material y labor=0.
- id="cap-NNN", code="NN.CAP.NNN", dependencies=["chapter_code"]

Campos por partida: id,chapter,code,name,description,unit,quantity,quantity_calculation,trade,estimated_hours,priority,dependencies,material_cost_per_unit,labor_cost_per_unit,labor_hours_per_unit,machinery_cost_per_unit,unit_cost,confidence_score,price_source,price_source_detail,materials[{name,quantity,unit,unit_price}]

Responde SOLO con JSON array: [{...},{...}]`;
// ─── Helpers ────────────────────────────────────────────────────────────────
function stripCodeFences(text) {
    let cleaned = text.trim();
    if (cleaned.startsWith("```json"))
        cleaned = cleaned.slice(7);
    else if (cleaned.startsWith("```"))
        cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```"))
        cleaned = cleaned.slice(0, -3);
    return cleaned.trim();
}
function extractJsonArray(text) {
    const cleaned = stripCodeFences(text);
    const first = cleaned.indexOf("[");
    if (first === -1) {
        // Fallback: try as object wrapper
        return tryObjectWrapper(cleaned);
    }
    // Try direct parse first — fastest path
    const candidate = cleaned.slice(first);
    try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed))
            return candidate;
    }
    catch {
        // Direct parse failed — need repair
    }
    // Try finding matching closing bracket
    const last = cleaned.lastIndexOf("]");
    if (last > first) {
        const slice = cleaned.slice(first, last + 1);
        try {
            const parsed = JSON.parse(slice);
            if (Array.isArray(parsed))
                return slice;
        }
        catch {
            // Slice also invalid (inner ] was found, not outer)
        }
    }
    // Truncated or malformed — try progressive repair
    return repairTruncatedJsonArray(cleaned.slice(first));
}
function tryObjectWrapper(cleaned) {
    const objFirst = cleaned.indexOf("{");
    const objLast = cleaned.lastIndexOf("}");
    if (objFirst !== -1 && objLast > objFirst) {
        const obj = cleaned.slice(objFirst, objLast + 1);
        try {
            const parsed = JSON.parse(obj);
            if (Array.isArray(parsed.items))
                return JSON.stringify(parsed.items);
            if (Array.isArray(parsed.partidas))
                return JSON.stringify(parsed.partidas);
        }
        catch {
            // ignore
        }
    }
    return cleaned;
}
/**
 * Repair a truncated JSON array by progressively removing content
 * from the end until we get valid JSON.
 *
 * Strategy:
 *   1. Find each top-level '},\n' boundary (separating array elements)
 *   2. Try parsing from the start up to each boundary + ']'
 *   3. Return the longest valid parse
 */
function repairTruncatedJsonArray(text) {
    // Find all positions where a top-level object ends: '},\n' or '},  {'
    // We search for '},\n' pattern which marks boundaries between array elements
    const boundaries = [];
    const re = /\},\s*(?=\{|$)/g;
    let match;
    while ((match = re.exec(text)) !== null) {
        boundaries.push(match.index + 1); // position right after the '}'
    }
    // Try from longest to shortest
    for (let i = boundaries.length - 1; i >= 0; i--) {
        const attempt = text.slice(0, boundaries[i]) + "]";
        try {
            const parsed = JSON.parse(attempt);
            if (Array.isArray(parsed) && parsed.length > 0) {
                console.warn(`[GenerateV2] Repaired truncated JSON: kept ${parsed.length} items ` +
                    `(cut at position ${boundaries[i]} of ${text.length})`);
                return attempt;
            }
        }
        catch {
            // This boundary wasn't clean, try the next one
        }
    }
    // Last resort: nothing was salvageable
    return text;
}
/**
 * Safely parse a JSON array from Claude's response text.
 * Tries multiple strategies in order:
 *   1. Direct parse of extracted JSON
 *   2. Progressive truncation repair (cut last incomplete object)
 *   3. Object-by-object extraction with regex
 *
 * Returns the parsed array or null if nothing works.
 */
function parseJsonArraySafe(responseText) {
    const cleaned = stripCodeFences(responseText);
    // Strategy 1: Try direct extraction and parse
    const extracted = extractJsonArray(cleaned);
    try {
        const result = JSON.parse(extracted);
        if (Array.isArray(result) && result.length > 0)
            return result;
    }
    catch {
        // continue to repair strategies
    }
    // Strategy 2: Find the opening '[', then try closing at each '},' boundary
    const firstBracket = cleaned.indexOf("[");
    if (firstBracket !== -1) {
        const fromBracket = cleaned.slice(firstBracket);
        const repaired = repairTruncatedJsonArray(fromBracket);
        try {
            const result = JSON.parse(repaired);
            if (Array.isArray(result) && result.length > 0) {
                console.warn(`[GenerateV2] JSON repaired via truncation repair: ${result.length} items`);
                return result;
            }
        }
        catch {
            // continue
        }
    }
    // Strategy 3: Extract individual JSON objects with bracket counting
    const objects = extractObjectsByBracketCounting(cleaned);
    if (objects.length > 0) {
        console.warn(`[GenerateV2] JSON repaired via bracket counting: ${objects.length} items`);
        return objects;
    }
    console.error(`[GenerateV2] All JSON parse strategies failed. Response length: ${responseText.length}`);
    console.error(`[GenerateV2] First 500 chars: ${responseText.slice(0, 500)}`);
    console.error(`[GenerateV2] Last 500 chars: ${responseText.slice(-500)}`);
    return null;
}
/**
 * Extract individual top-level JSON objects from text by counting
 * curly braces. This handles truncated arrays where the last object
 * is incomplete — it simply discards incomplete objects.
 */
function extractObjectsByBracketCounting(text) {
    const results = [];
    let depth = 0;
    let inString = false;
    let escape = false;
    let objStart = -1;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === "\\") {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (ch === "{") {
            if (depth === 0)
                objStart = i;
            depth++;
        }
        else if (ch === "}") {
            depth--;
            if (depth === 0 && objStart !== -1) {
                const objStr = text.slice(objStart, i + 1);
                try {
                    const parsed = JSON.parse(objStr);
                    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                        results.push(parsed);
                    }
                }
                catch {
                    // Skip malformed object
                }
                objStart = -1;
            }
        }
    }
    return results;
}
/**
 * Build the user message for FASE 2.
 *
 * OPTIMIZED: Only sends essential data to minimize tokens.
 * - Analysis summary (not full JSON)
 * - Required items list (compact)
 * - Technical prices (compact, max 40)
 * - User prices (compact, max 20)
 */
function buildGenerationMessage(analysis, scope, technicalPrices, userPrices) {
    const lines = [];
    // Compact scope
    lines.push(`PROYECTO: ${scope.project_type}, ${scope.surface_m2}m2, ${scope.location}, calidad ${scope.quality}, estado ${scope.current_state}`);
    lines.push(`ESTANCIAS: ${scope.num_bathrooms} banos, ${scope.num_rooms} habitaciones, cocina=${scope.includes_kitchen ? "SI" : "NO"}, ventanas=${scope.includes_windows ? "SI" : "NO"}, clima=${scope.includes_hvac ? "SI" : "NO"}`);
    if (scope.rooms.length > 0)
        lines.push(`ESTANCIAS: ${scope.rooms.join(", ")}`);
    // Compact analysis — only required items and chapters
    lines.push("");
    lines.push("CAPITULOS NECESARIOS: " + analysis.required_chapters.map(c => c.code).join(", "));
    lines.push("");
    lines.push("PARTIDAS A GENERAR:");
    for (const item of analysis.required_items) {
        lines.push(`- [${item.chapter}] ${item.concept} | ${item.quantity_estimated} ${item.unit} | ${item.priority}`);
    }
    if (analysis.auxiliary_items?.length > 0) {
        lines.push("");
        lines.push("PARTIDAS AUXILIARES:");
        for (const item of analysis.auxiliary_items) {
            lines.push(`- [${item.chapter}] ${item.concept}`);
        }
    }
    // Compact technical prices (no pretty-print, max 40 entries)
    if (technicalPrices.length > 0) {
        const relevantChapters = new Set(analysis.required_chapters.map(c => c.code));
        const relevantPrices = technicalPrices.filter(p => {
            const nameLower = p.name.toLowerCase();
            for (const ch of relevantChapters) {
                if (nameLower.includes(ch.replace("_", " ")) || nameLower.includes(ch))
                    return true;
            }
            return false;
        }).slice(0, 40);
        if (relevantPrices.length > 0) {
            lines.push("");
            lines.push("BANCO PRECIOS TECNICO:");
            // Compact: one line per price, no JSON overhead
            for (const p of relevantPrices) {
                lines.push(`- ${p.name} | ${p.unit_price}€/${p.unit} | ${p.source}`);
            }
        }
    }
    // Compact user prices (max 20)
    if (userPrices.length > 0) {
        lines.push("");
        lines.push("PRECIOS USUARIO:");
        for (const p of userPrices.slice(0, 20)) {
            lines.push(`- ${p.name} | ${p.unit_price}€/${p.unit}`);
        }
    }
    lines.push("");
    lines.push("Genera todas las partidas como array JSON. Incluye materials[] solo si hay materiales especificos relevantes.");
    return lines.join("\n");
}
// ─── Validation / sanitization ──────────────────────────────────────────────
const VALID_CHAPTERS = new Set([
    "protecciones", "demoliciones", "albanileria", "fontaneria", "electricidad",
    "impermeabilizacion", "revestimientos", "pavimentos", "rodapie", "pintura",
    "carpinteria_interior", "carpinteria_exterior", "sanitarios", "cocina",
    "climatizacion", "falsos_techos", "residuos", "limpieza", "seguridad", "otros",
]);
const VALID_TRADES = new Set([
    "oficial_albanil", "peon", "peon_especialista", "fontanero", "electricista",
    "pintor", "alicatador", "carpintero", "cerrajero", "cristalero",
    "climatizador", "encargado", "subcontrata",
]);
const VALID_PRIORITIES = new Set(["obligatoria", "recomendada", "opcional"]);
/**
 * Sanitize and complete raw items from Claude output.
 * Fills in missing fields, validates enums, generates codes if missing.
 */
function sanitizeItems(rawItems, preferences) {
    const chapterCounters = {};
    return rawItems.map((raw, idx) => {
        const item = raw;
        // Validate chapter
        let chapter = String(item.chapter || "otros").toLowerCase();
        if (!VALID_CHAPTERS.has(chapter))
            chapter = "otros";
        // Generate code if missing
        chapterCounters[chapter] = (chapterCounters[chapter] || 0) + 1;
        const chapterNum = CHAPTER_ORDER[chapter] || "20";
        const prefix = CHAPTER_CODE_PREFIX[chapter] || "OTR";
        const counter = String(chapterCounters[chapter]).padStart(3, "0");
        const code = String(item.code || `${chapterNum}.${prefix}.${counter}`);
        // Validate trade
        let trade = String(item.trade || "peon").toLowerCase();
        if (!VALID_TRADES.has(trade))
            trade = "peon";
        // Validate priority
        let priority = String(item.priority || "obligatoria").toLowerCase();
        if (!VALID_PRIORITIES.has(priority))
            priority = "obligatoria";
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
        let priceSource = String(item.price_source || "estimated");
        if (!["user_catalog", "technical_bank", "enlaze_base", "n8n_market", "web_search", "estimated"].includes(priceSource)) {
            priceSource = "estimated";
        }
        // ID
        const id = String(item.id || `${chapter.replace(/_/g, "").slice(0, 3)}-${counter}`);
        // Dependencies
        let dependencies = [];
        if (Array.isArray(item.dependencies)) {
            dependencies = item.dependencies
                .map(d => String(d).toLowerCase())
                .filter(d => VALID_CHAPTERS.has(d));
        }
        // Materials
        let materials = [];
        if (Array.isArray(item.materials)) {
            materials = item.materials.map(m => ({
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
            priority: priority,
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
function applyCostCoefficients(items) {
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
async function generateBudgetItems(analysis, scope, preferences, technicalPrices, userPrices, options) {
    const start = Date.now();
    try {
        const anthropic = new sdk_1.default({ apiKey: options.apiKey });
        const model = options.model || "claude-haiku-4-5-20251001";
        const maxTokens = options.maxTokens || 16000;
        const userMessage = buildGenerationMessage(analysis, scope, technicalPrices, userPrices);
        const message = await anthropic.messages.create({
            model,
            max_tokens: maxTokens,
            temperature: 0,
            system: GENERATION_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
        });
        const responseText = message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
        if (message.stop_reason === "max_tokens") {
            console.warn(`[GenerateV2] FASE 2 response truncated (max_tokens=${maxTokens}, ` +
                `${responseText.length} chars). Attempting repair.`);
        }
        // Parse JSON array (includes automatic truncation repair)
        const parsed = parseJsonArraySafe(responseText);
        if (!parsed || parsed.length === 0) {
            throw new Error("No se pudo parsear la respuesta de IA. " +
                "Intenta generar de nuevo o simplifica el presupuesto.");
        }
        console.log(`[GenerateV2] FASE 2 parsed ${parsed.length} items from ${responseText.length} chars ` +
            `(stop_reason=${message.stop_reason})`);
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
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            items: [],
            error: errorMessage,
            durationMs: Date.now() - start,
        };
    }
}
