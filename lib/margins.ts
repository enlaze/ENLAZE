// Punto único de verdad del margen comercial.
//
// Antes de este módulo el margen por defecto estaba escrito a mano en varios
// sitios con valores distintos (20 en el asistente y en /api/generate-budget,
// 25 en los generadores v2), y la resolución "margen específico del servicio,
// si no el general, si no el defecto" estaba duplicada. Aquí vive una sola vez.

/**
 * Margen aplicado cuando el usuario no ha configurado ninguno: ni específico
 * para el tipo de servicio, ni general. Es el único literal del proyecto.
 */
export const DEFAULT_MARGIN_PERCENT = 20;

/** Tipo de servicio que representa "todos los que no tengan margen propio". */
export const GENERAL_SERVICE_TYPE = "general";

/**
 * Una fila de `margin_config`. `margin_percent` llega como `string` desde
 * PostgREST (la columna es `numeric`), así que se acepta de las dos formas y
 * la conversión ocurre dentro.
 */
export interface MarginConfigRow {
  service_type: string;
  margin_percent: number | string | null;
}

/**
 * Convierte a número descartando lo que no lo sea. `numeric` puede llegar como
 * cadena, y un `NaN` colado en un multiplicador envenena todos los precios del
 * presupuesto sin dar ningún error visible.
 */
function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resuelve el margen aplicable a un tipo de servicio.
 *
 * Prioridad: margen específico del servicio → margen general → defecto.
 * Es la misma regla que ya usaba `/api/generate-budget`, extraída para que el
 * asistente pueda aplicarla también.
 */
export function resolveMarginPercent(
  margins: readonly MarginConfigRow[] | null | undefined,
  serviceType: string | null | undefined,
): number {
  if (!margins || margins.length === 0) return DEFAULT_MARGIN_PERCENT;

  const wanted = (serviceType || "").trim().toLowerCase();

  if (wanted && wanted !== GENERAL_SERVICE_TYPE) {
    const specific = margins.find(
      (m) => (m.service_type || "").trim().toLowerCase() === wanted,
    );
    const specificValue = toFiniteNumber(specific?.margin_percent);
    if (specificValue !== null) return specificValue;
  }

  const general = margins.find(
    (m) => (m.service_type || "").trim().toLowerCase() === GENERAL_SERVICE_TYPE,
  );
  const generalValue = toFiniteNumber(general?.margin_percent);
  if (generalValue !== null) return generalValue;

  return DEFAULT_MARGIN_PERCENT;
}

/** Multiplicador a aplicar sobre el coste para obtener el precio de cliente. */
export function marginMultiplier(marginPercent: number): number {
  const safe = Number.isFinite(marginPercent) ? marginPercent : DEFAULT_MARGIN_PERCENT;
  return 1 + safe / 100;
}

/**
 * Acota un margen introducido a mano. El asistente permite ajustarlo por
 * presupuesto, y un valor vacío, negativo o no numérico no debe poder
 * convertirse en un precio de cliente.
 */
export function clampMarginPercent(value: unknown): number {
  // `Number("")` es 0, no NaN. Sin este descarte, vaciar el campo del margen
  // para teclear otro valor pondría el presupuesto a coste durante el tecleo.
  if (value === null || value === undefined) return DEFAULT_MARGIN_PERCENT;
  if (typeof value === "string" && value.trim() === "") return DEFAULT_MARGIN_PERCENT;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MARGIN_PERCENT;
  if (parsed < 0) return 0;
  if (parsed > 1000) return 1000;
  return Math.round(parsed * 100) / 100;
}

/** Cliente mínimo necesario para leer `margin_config`. */
export interface MarginConfigReader {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{ data: MarginConfigRow[] | null; error: unknown }>;
    };
  };
}

/**
 * Lee `margin_config` del usuario y resuelve el margen del tipo de servicio.
 * Ante cualquier error devuelve el defecto: quedarse sin margen configurado no
 * debe impedir presupuestar.
 */
export async function fetchMarginPercent(
  supabase: MarginConfigReader,
  userId: string,
  serviceType: string | null | undefined,
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("margin_config")
      .select("service_type, margin_percent")
      .eq("user_id", userId);
    if (error) return DEFAULT_MARGIN_PERCENT;
    return resolveMarginPercent(data, serviceType);
  } catch {
    return DEFAULT_MARGIN_PERCENT;
  }
}
