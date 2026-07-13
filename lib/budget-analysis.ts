/**
 * budget-analysis.ts
 *
 * FASE 1 del generador de presupuestos v2.
 * Analiza un proyecto de construccion y devuelve una estructura ProjectAnalysis
 * que sirve de input para la FASE 2 (generacion de partidas).
 *
 * Usa Claude Sonnet para el analisis, pero NO para precios.
 * Claude recibe los datos del formulario (BudgetScopeV2) y devuelve:
 *   - Fases del proyecto
 *   - Capitulos necesarios
 *   - Partidas requeridas con formulas de cantidad
 *   - Trabajos auxiliares
 *   - Partidas que normalmente se olvidan
 *   - Permisos necesarios
 *   - Asunciones y datos faltantes
 *   - Oficios necesarios con dias estimados
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  BudgetScopeV2,
  ProjectAnalysis,
  ChapterCode,
} from "./types/budget-v2";

// ─── Prompt de analisis ─────────────────────────────────────────────────────

const ANALYSIS_SYSTEM_PROMPT = `Eres un técnico presupuestador profesional con 25 años de experiencia en construcción y reformas en España. Tu trabajo es ANALIZAR un proyecto antes de presupuestarlo.

REGLAS ESTRICTAS:
1. Los datos del FORMULARIO tienen PRIORIDAD ABSOLUTA sobre la descripción libre.
   Si el formulario dice 2 baños, analizas para 2 baños aunque la descripción diga 1.
2. Identifica TODOS los trabajos necesarios, incluyendo los que normalmente se olvidan:
   - Impermeabilización de zonas húmedas antes de alicatado
   - Protección de zonas comunes del edificio
   - Regularización de superficies antes de revestimiento
   - Gestión de residuos y tasa de vertedero
   - Limpieza final de obra
   - Seguridad básica
3. Clasifica cada trabajo usando EXCLUSIVAMENTE estos capítulos:
   protecciones, demoliciones, albanileria, fontaneria, electricidad,
   impermeabilizacion, revestimientos, pavimentos, rodapie, pintura,
   carpinteria_interior, carpinteria_exterior, sanitarios, cocina,
   climatizacion, falsos_techos, residuos, limpieza, seguridad, otros
4. Estima cantidades usando fórmulas basadas en los datos del formulario.
   Ejemplo: "perimetro_bano * altura * num_banos = (2*(2.0+1.6)) * 2.5 * 2 = 36 m2"
5. Identifica dependencias entre fases (qué debe ir antes de qué).
6. Señala qué información falta y qué has tenido que asumir.
7. NO inventes precios. Solo analiza trabajos, cantidades y fases.
8. Los oficios deben ser de esta lista:
   oficial_albanil, peon, peon_especialista, fontanero, electricista,
   pintor, alicatador, carpintero, cerrajero, cristalero, climatizador,
   encargado, subcontrata

RESPONDE ÚNICAMENTE con un JSON válido siguiendo este esquema exacto:
{
  "project_summary": {
    "project_type": "reforma_integral|reforma_parcial|reforma_bano|...",
    "work_category": "residencial|comercial|industrial|comunitario",
    "location": "string",
    "surface_m2": number,
    "quality_level": "basica|media|alta",
    "complexity": "baja|media|alta",
    "risk_level": "bajo|medio|alto"
  },
  "phases": [
    { "order": 1, "name": "string", "trades": ["string"], "estimated_days": number, "depends_on": [] }
  ],
  "required_chapters": [
    { "code": "chapter_code", "name": "string", "reason": "string", "estimated_weight_percent": number }
  ],
  "required_items": [
    { "chapter": "chapter_code", "concept": "string", "unit": "string", "quantity_formula": "string", "quantity_estimated": number, "priority": "obligatoria|recomendada|opcional" }
  ],
  "auxiliary_items": [
    { "chapter": "chapter_code", "concept": "string", "reason": "string" }
  ],
  "commonly_forgotten": ["string"],
  "permits_needed": ["string"],
  "assumptions": ["string"],
  "missing_information": ["string"],
  "incompatibilities": [],
  "trades_needed": [
    { "trade": "trade_code", "estimated_days": number }
  ]
}`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

function extractJsonObject(text: string): string {
  const cleaned = stripCodeFences(text);
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) return cleaned.slice(first, last + 1).trim();
  return cleaned;
}

/**
 * Build the user message from scope data.
 * Structured data is presented first (PRIORITY) then description (complementary).
 */
function buildUserMessage(scope: BudgetScopeV2): string {
  const lines: string[] = [];

  lines.push("DATOS DEL FORMULARIO (PRIORIDAD ABSOLUTA):");
  lines.push(`- Tipo de proyecto: ${scope.project_type}`);
  lines.push(`- Categoria: ${scope.work_category}`);
  lines.push(`- Ubicacion: ${scope.location}`);
  lines.push(`- Superficie: ${scope.surface_m2} m2`);
  lines.push(`- Numero de banos: ${scope.num_bathrooms}`);
  lines.push(`- Numero de habitaciones: ${scope.num_rooms}`);
  lines.push(`- Incluye cocina: ${scope.includes_kitchen ? "SI" : "NO"}`);
  lines.push(`- Incluye ventanas: ${scope.includes_windows ? "SI" : "NO"}`);
  lines.push(`- Incluye climatizacion: ${scope.includes_hvac ? "SI" : "NO"}`);
  lines.push(`- Estado actual: ${scope.current_state}`);
  lines.push(`- Calidad deseada: ${scope.quality}`);

  if (scope.rooms.length > 0) {
    lines.push(`- Estancias: ${scope.rooms.join(", ")}`);
  }
  if (scope.works_requested.length > 0) {
    lines.push(`- Trabajos solicitados: ${scope.works_requested.join(", ")}`);
  }
  if (scope.start_date) {
    lines.push(`- Fecha inicio prevista: ${scope.start_date}`);
  }
  if (scope.deadline_date) {
    lines.push(`- Fecha limite: ${scope.deadline_date}`);
  }

  if (scope.description && scope.description.trim().length > 0) {
    lines.push("");
    lines.push("DESCRIPCION DEL USUARIO (complementaria, NO contradice lo anterior):");
    lines.push(scope.description.trim());
  }

  lines.push("");
  lines.push("Analiza este proyecto y devuelve el ProjectAnalysis completo en JSON.");

  return lines.join("\n");
}

// ─── Validacion basica de la respuesta ──────────────────────────────────────

const VALID_CHAPTERS: Set<string> = new Set<string>([
  "protecciones", "demoliciones", "albanileria", "fontaneria", "electricidad",
  "impermeabilizacion", "revestimientos", "pavimentos", "rodapie", "pintura",
  "carpinteria_interior", "carpinteria_exterior", "sanitarios", "cocina",
  "climatizacion", "falsos_techos", "residuos", "limpieza", "seguridad", "otros",
]);

/**
 * Basic validation and sanitization of the parsed analysis.
 * Ensures required fields exist and chapter codes are valid.
 */
function sanitizeAnalysis(raw: Record<string, unknown>): ProjectAnalysis {
  const analysis = raw as unknown as ProjectAnalysis;

  // Ensure required top-level fields
  if (!analysis.project_summary) {
    throw new Error("ProjectAnalysis missing project_summary");
  }
  if (!analysis.required_chapters || !Array.isArray(analysis.required_chapters)) {
    throw new Error("ProjectAnalysis missing required_chapters array");
  }
  if (!analysis.required_items || !Array.isArray(analysis.required_items)) {
    throw new Error("ProjectAnalysis missing required_items array");
  }

  // Sanitize chapter codes
  for (const ch of analysis.required_chapters) {
    if (!VALID_CHAPTERS.has(ch.code)) {
      ch.code = "otros" as ChapterCode;
    }
  }
  for (const item of analysis.required_items) {
    if (!VALID_CHAPTERS.has(item.chapter)) {
      item.chapter = "otros" as ChapterCode;
    }
  }
  if (analysis.auxiliary_items) {
    for (const item of analysis.auxiliary_items) {
      if (!VALID_CHAPTERS.has(item.chapter)) {
        item.chapter = "otros" as ChapterCode;
      }
    }
  }

  // Ensure optional arrays exist
  analysis.phases = analysis.phases || [];
  analysis.auxiliary_items = analysis.auxiliary_items || [];
  analysis.commonly_forgotten = analysis.commonly_forgotten || [];
  analysis.permits_needed = analysis.permits_needed || [];
  analysis.assumptions = analysis.assumptions || [];
  analysis.missing_information = analysis.missing_information || [];
  analysis.incompatibilities = analysis.incompatibilities || [];
  analysis.trades_needed = analysis.trades_needed || [];

  return analysis;
}

// ─── API publica ────────────────────────────────────────────────────────────

export interface AnalyzeProjectOptions {
  /** Anthropic API key (from env) */
  apiKey: string;
  /** Model to use (default: claude-sonnet-4-6) */
  model?: string;
  /** Max tokens for response (default: 4096) */
  maxTokens?: number;
}

export interface AnalyzeProjectResult {
  ok: boolean;
  analysis: ProjectAnalysis | null;
  /** Raw response text from Claude (for debugging) */
  rawResponse?: string;
  /** Error message if ok=false */
  error?: string;
  /** Time taken in ms */
  durationMs: number;
}

/**
 * FASE 1: Analiza un proyecto de construccion usando Claude.
 *
 * Input: BudgetScopeV2 (datos del formulario + descripcion)
 * Output: ProjectAnalysis (estructura completa del proyecto)
 *
 * Claude NO genera precios. Solo analiza:
 *   - Que capitulos son necesarios
 *   - Que partidas hacen falta (con formulas de cantidad)
 *   - Que fases y dependencias existen
 *   - Que oficios intervienen
 *   - Que se suele olvidar
 *
 * Puro: no accede a base de datos. El caller se encarga del cache.
 */
export async function analyzeProject(
  scope: BudgetScopeV2,
  options: AnalyzeProjectOptions
): Promise<AnalyzeProjectResult> {
  const start = Date.now();

  try {
    const anthropic = new Anthropic({ apiKey: options.apiKey });
    const model = options.model || "claude-sonnet-4-6";
    const maxTokens = options.maxTokens || 4096;

    const userMessage = buildUserMessage(scope);

    const message = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Parse JSON
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(extractJsonObject(responseText));
    } catch {
      // Attempt repair with a second call
      const repair = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: `El siguiente texto debería ser un JSON válido con la estructura ProjectAnalysis, pero tiene errores de formato. Corrígelo y devuelve SOLO el JSON válido, sin explicación:\n\n${responseText}`,
          },
        ],
      });
      const repairText = repair.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      parsed = JSON.parse(extractJsonObject(repairText));
    }

    const analysis = sanitizeAnalysis(parsed);

    return {
      ok: true,
      analysis,
      rawResponse: responseText,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      analysis: null,
      error: errorMessage,
      durationMs: Date.now() - start,
    };
  }
}

// ─── Utilidades para cache ──────────────────────────────────────────────────

/**
 * Generate a deterministic hash for a BudgetScopeV2.
 * Used to cache analysis results (24h TTL).
 * Excludes description and client data for cache key
 * (same structure = same analysis even with different wording).
 */
export function buildScopeHash(scope: BudgetScopeV2): string {
  const key = {
    pt: scope.project_type,
    wc: scope.work_category,
    loc: scope.location,
    m2: scope.surface_m2,
    nb: scope.num_bathrooms,
    nr: scope.num_rooms,
    ik: scope.includes_kitchen,
    iw: scope.includes_windows,
    ih: scope.includes_hvac,
    cs: scope.current_state,
    q: scope.quality,
    rooms: scope.rooms.sort(),
    works: scope.works_requested.sort(),
  };
  // Simple hash: JSON string -> djb2
  const str = JSON.stringify(key);
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}
