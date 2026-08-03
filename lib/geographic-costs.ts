export interface GeographicCostProfile {
  code: "high" | "medium_high" | "national" | "lower";
  label: string;
  laborFactor: number;
  logisticsFactor: number;
  explanation: string;
}

const HIGH_COST_AREAS = [
  "madrid",
  "barcelona",
  "baleares",
  "illes balears",
  "ibiza",
  "eivissa",
  "formentera",
  "bizkaia",
  "vizcaya",
  "gipuzkoa",
  "guipuzcoa",
  "alava",
  "araba",
];

const MEDIUM_HIGH_AREAS = [
  "alicante",
  "alacant",
  "malaga",
  "valencia",
  "sevilla",
  "navarra",
  "girona",
  "gerona",
  "tarragona",
  "canarias",
  "palmas",
  "tenerife",
  "marbella",
  "palma",
];

const LOWER_COST_AREAS = [
  "badajoz",
  "caceres",
  "ciudad real",
  "cuenca",
  "jaen",
  "zamora",
  "avila",
  "teruel",
  "soria",
  "palencia",
  "lugo",
  "ourense",
  "orense",
];

function normalizeLocation(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesArea(location: string, areas: string[]) {
  return areas.some((area) => location.includes(normalizeLocation(area)));
}

/**
 * Deterministic, visible geographic coefficients.
 *
 * Tracked material prices are never multiplied by this profile. The
 * coefficients only model local labour and logistics differences so the same
 * input always produces the same output and the adjustment can be audited.
 */
export function getGeographicCostProfile(location: string): GeographicCostProfile {
  const normalized = normalizeLocation(location);

  if (!normalized) {
    return {
      code: "national",
      label: "Media nacional",
      laborFactor: 1,
      logisticsFactor: 1,
      explanation: "Sin ubicación: se usa la referencia media nacional.",
    };
  }

  if (includesArea(normalized, HIGH_COST_AREAS)) {
    return {
      code: "high",
      label: "Zona de coste alto",
      laborFactor: 1.18,
      logisticsFactor: 1.08,
      explanation: "Mano de obra +18% y logística +8% frente a la media nacional.",
    };
  }

  if (includesArea(normalized, MEDIUM_HIGH_AREAS)) {
    return {
      code: "medium_high",
      label: "Zona de coste medio-alto",
      laborFactor: 1.08,
      logisticsFactor: 1.05,
      explanation: "Mano de obra +8% y logística +5% frente a la media nacional.",
    };
  }

  if (includesArea(normalized, LOWER_COST_AREAS)) {
    return {
      code: "lower",
      label: "Zona de coste moderado",
      laborFactor: 0.92,
      logisticsFactor: 0.96,
      explanation: "Mano de obra -8% y logística -4% frente a la media nacional.",
    };
  }

  return {
    code: "national",
    label: "Media nacional",
    laborFactor: 1,
    logisticsFactor: 1,
    explanation: "Se usa la referencia media nacional para mano de obra y logística.",
  };
}

export function getGeographicFactorForCategory(
  category: string,
  profile: GeographicCostProfile,
) {
  const normalized = category.toLowerCase();
  if (normalized === "mano_obra" || normalized.includes("labor")) {
    return profile.laborFactor;
  }
  if (
    normalized === "maquinaria" ||
    normalized === "transporte" ||
    normalized === "otros" ||
    normalized.includes("residuo")
  ) {
    return profile.logisticsFactor;
  }
  return 1;
}
