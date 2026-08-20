/**
 * Canonical units accepted by public.budget_items_unit_check.
 *
 * AI/provider inputs often use plurals or human labels (for example
 * "lotes", "unidades" or "m²"). Persisting only these canonical values keeps
 * every budget creation path compatible with the database constraint.
 */
export const BUDGET_ITEM_UNITS = new Set([
  "m2", "ml", "m3", "ud", "pa", "h", "jornada", "kg", "l", "lote",
  "punto", "estancia", "sacos", "rollos", "cubos", "kit", "global",
  "partida", "m", "tn", "cm",
]);

const UNIT_ALIASES: Record<string, string> = {
  "m²": "m2",
  "m^2": "m2",
  "metro cuadrado": "m2",
  "metros cuadrados": "m2",
  "m³": "m3",
  "m^3": "m3",
  "metro cubico": "m3",
  "metros cubicos": "m3",
  "metro lineal": "ml",
  "metros lineales": "ml",
  unidad: "ud",
  unidades: "ud",
  uds: "ud",
  u: "ud",
  "partida alzada": "pa",
  hora: "h",
  horas: "h",
  jornadas: "jornada",
  kilogramo: "kg",
  kilogramos: "kg",
  litro: "l",
  litros: "l",
  lotes: "lote",
  saco: "sacos",
  rollo: "rollos",
  cubo: "cubos",
  packs: "kit",
  pack: "kit",
  kits: "kit",
  puntos: "punto",
  estancias: "estancia",
  partidas: "partida",
  metro: "m",
  metros: "m",
  tonelada: "tn",
  toneladas: "tn",
  centimetro: "cm",
  centimetros: "cm",
};

function normalizeUnitText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function normalizeBudgetItemUnit(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (BUDGET_ITEM_UNITS.has(raw)) return raw;

  const normalized = normalizeUnitText(value);
  const aliased = UNIT_ALIASES[normalized] || normalized;
  return BUDGET_ITEM_UNITS.has(aliased) ? aliased : "ud";
}

export function isCanonicalBudgetItemUnit(value: unknown): boolean {
  return BUDGET_ITEM_UNITS.has(String(value ?? "").trim().toLowerCase());
}
