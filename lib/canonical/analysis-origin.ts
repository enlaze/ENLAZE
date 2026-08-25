/**
 * analysis-origin.ts — Discriminador de procedencia del análisis de presupuesto.
 *
 * Existe por un motivo muy concreto: `data.suggested_items` NO siempre viene del
 * modelo. Cuando el enriquecimiento externo falla, `buildDeterministicBudgetAnalysis`
 * rellena ese mismo campo con la salida de `buildDeterministicBudgetItems`, y lo hace
 * por dos caminos independientes (la ruta de servidor y el fallback de cliente). Sellar
 * `ai` a ciegas sobre `suggested_items` etiquetaría como propuesta del modelo unas
 * líneas que fabricó el motor determinista, que es justo la mentira que la fase 2D
 * intenta impedir.
 *
 * Este módulo es puro: no lee base de datos, no toca dinero, no tiene estado. Se aísla
 * aquí en lugar de vivir dentro del provider para que pueda probarse sin montar React.
 */

import type { ResolutionOrigin } from "../types/canonical";

/**
 * Las DOS únicas señales admitidas. Ambas las escribe el propio fallback determinista
 * en el mismo acto en que fabrica las líneas, así que son testimonio del emisor sobre
 * lo que acaba de hacer, no una inferencia nuestra sobre el resultado.
 */
const DETERMINISTIC_ANALYSIS_MODE = "deterministic_engine";

/** Forma mínima que este discriminador necesita. Deliberadamente laxa: la respuesta
 *  de la ruta es `any` en el provider y no queremos que un campo ausente sea un error
 *  de tipos en vez de una decisión explícita. */
export interface BudgetAnalysisOriginInput {
  analysis_mode?: unknown;
  data_sources?: { using_ai_fallback?: unknown } | null;
}

/**
 * Decide dónde NACEN las líneas de `suggested_items` de un análisis.
 *
 * Regla, y no hay otra:
 *   `analysis_mode === "deterministic_engine"` **Y** `data_sources.using_ai_fallback === true`
 *   → "engine". Cualquier otro caso → "ai".
 *
 * Se exigen las dos señales a la vez, no una. Son emitidas por el mismo emisor en el
 * mismo momento, así que si discrepan es que el payload no es el que creemos, y en ese
 * caso preferimos el origen SIN privilegio.
 *
 * Por qué el caso dudoso cae en "ai" y no en "engine": `engine` es el único de los dos
 * que otorga NIVEL 1 privilegiado en el resolver, es decir, permite a una línea ganar
 * un concepto canónico saltándose el ranking general y por delante de la curación
 * manual de la empresa. Un error hacia "engine" concede autoridad que no se ha
 * acreditado; un error hacia "ai" sólo obliga a la línea a competir en igualdad. La
 * asimetría es deliberada: ante la duda, se pierde privilegio, no se gana.
 *
 * Lo que esta función NO mira, y no debe empezar a mirar nunca: `price_source`,
 * `price_source_detail`, `source`, los textos de las partidas, los capítulos, los
 * precios y el número de líneas. Todos ellos son correlaciones, no testimonio. En
 * particular `price_source === "engine_scope"` acompaña hoy a las líneas deterministas
 * por coincidencia de implementación, y derivar de ahí la procedencia sería confundir
 * "de dónde salió el PRECIO" con "dónde nació la LÍNEA", que es exactamente la
 * distinción que `canonical_origin` existe para mantener.
 */
export function originForBudgetAnalysis(data: BudgetAnalysisOriginInput | null | undefined): Extract<ResolutionOrigin, "engine" | "ai"> {
  const isDeterministicMode = data?.analysis_mode === DETERMINISTIC_ANALYSIS_MODE;
  const declaresFallback = data?.data_sources?.using_ai_fallback === true;
  return isDeterministicMode && declaresFallback ? "engine" : "ai";
}
