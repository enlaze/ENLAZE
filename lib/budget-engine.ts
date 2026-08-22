/**
 * budget-engine.ts
 * Pure, stateless functions for construction budget generation.
 * No React, no Supabase, no side-effects. Fully idempotent.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BudgetScope {
  superficie_m2: number;
  num_banos: number;
  incluye_cocina: boolean;
  incluye_ventanas: boolean;
  incluye_climatizacion: boolean;
  estancias: string[];
  actuaciones: string[];
  calidad: "basica" | "media" | "alta";
  ubicacion: string;
  /** Physical starting point. A refurbishment never starts from a blank site. */
  project_context?: "existing_renovation" | "new_build" | "rehabilitation";
  existing_condition?: "good" | "fair" | "poor" | "unknown";
  conservation_strategy?: "preserve" | "balanced" | "replace";
  occupied_during_works?: boolean;
  building_age_band?: "pre_1940" | "1940_1979" | "1980_2006" | "post_2006" | "unknown";
}

export function resolveProjectContext(
  serviceType: string,
  explicit?: BudgetScope["project_context"],
): NonNullable<BudgetScope["project_context"]> {
  if (explicit) return explicit;
  const normalized = String(serviceType || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/obra nueva|nueva construccion|new build/.test(normalized)) return "new_build";
  if (/rehabilit/.test(normalized)) return "rehabilitation";
  return "existing_renovation";
}

export function normalizeBathroomCount(value: unknown, fallback = 1): number {
  if (value === null || value === undefined || value === "") return fallback;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(10, Math.max(0, Math.round(numericValue)));
}

export interface ScopeQuantities {
  floorArea: number;
  demolitionArea: number;
  pavementArea: number;
  ceilingArea: number;
  wallPaintArea: number;
  wetWallArea: number;
  bathroomsCount: number;
  kitchenIncluded: boolean;
  windowsCountEstimated: number;
  electricalPointsEstimated: number;
  wasteContainersEstimated: number;
  baseboardMlEstimated: number;
  doorsEstimated: number;
  partitionArea: number;
}

export interface CostBreakdown {
  material_cost: number;
  labor_cost: number;
  equipment_cost: number;
  waste_cost: number;
  margin: number;
  pvp: number;
  source: string;
  confidence_score: number;
  price_type: "real" | "market_ref" | "estimated";
}

export interface TimelinePhase {
  title: string;
  duration_days_min: number;
  duration_days_max: number;
  description: string;
  depends_on?: string[];
}

export interface RealisticTimeline {
  preparation_weeks_min: number;
  preparation_weeks_max: number;
  execution_working_days_min: number;
  execution_working_days_max: number;
  execution_weeks_min: number;
  execution_weeks_max: number;
  total_weeks_min: number;
  total_weeks_max: number;
  phase_breakdown: TimelinePhase[];
  critical_path: string[];
  assumptions: string[];
  supply_readiness_percent: number;
  confidence_percent: number;
  uncertainty_level: "baja" | "media" | "alta";
  schedule_risks: string[];
  optimization_actions: string[];
}

export interface TimelineSupplyContext {
  total_materials?: number;
  verified_materials?: number;
  max_delivery_days?: number;
  unavailable_materials?: number;
  unknown_delivery_materials?: number;
}

export interface MarketAdjustmentMeta {
  applied: boolean;
  factor: number;
  reason: string;
  original_unit_price: number;
  adjusted_unit_price: number;
  adjusted_at: string;
}

export interface EnginePartida {
  id: string;
  concept: string;
  description: string;
  quantity: number;
  unit: string;
  category: string;
  chapter: string;
  unit_price: number;
  subtotal_cost: number;
  unit_price_client: number;
  subtotal_client: number;
  status: "incluida" | "estimada" | "opcional";
  cost_breakdown?: CostBreakdown;
  market_adjustment?: MarketAdjustmentMeta;
  base_unit_price?: number;
  geographic_factor?: number;
  geographic_profile?: string;
  price_source?: string;
  estimated_hours?: number;
}

export interface EngineMaterial {
  id: string;
  name: string;
  specification: string;
  procurementKind: "product" | "service";
  quantity: number;
  unit: string;
  unit_price: number;
  subtotal: number;
  included: boolean;
  provider_id: string;
  linked_chapter: string;
  isRealData: boolean;
  sourceType: string;
  market_adjustment?: MarketAdjustmentMeta;
}

export interface MarketAdjustResult {
  items: EnginePartida[];
  materials: EngineMaterial[];
  adjusted: boolean;
  adjustmentType: "none" | "chapters_added" | "prices_scaled" | "both";
  message: string;
  isUndervalued: boolean;
  pricePerM2: number;
  marketFloor: number;
  marketCeiling: number;
}

const ACTION_CHAPTERS: Record<string, string[]> = {
  demoliciones: ["diagnostico", "demoliciones", "protecciones", "residuos", "seguridad"],
  albanileria: ["albanileria", "protecciones", "seguridad"],
  electricidad: ["electricidad"],
  iluminacion: ["electricidad"],
  fontaneria: ["fontaneria"],
  climatizacion: ["climatizacion"],
  alicatados: ["revestimientos", "impermeabilizacion"],
  pavimentos: ["pavimentos", "rodapie"],
  pintura: ["pintura"],
  carpinteria_interior: ["carpinteria_interior"],
  carpinteria_exterior: ["carpinteria_exterior"],
  cocina_montaje: ["cocina"],
  banos_sanitarios: ["sanitarios", "impermeabilizacion"],
  limpieza_final: ["limpieza"],
  gestion_residuos: ["residuos"],
};

/** Infer partial construction actions only when the form has no explicit ones. */
export function inferBudgetActions(text: string): string[] {
  const normalized = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const matchers: Array<[RegExp, string]> = [
    [/demolic|derribo/, "demoliciones"],
    [/albanil|tabiquer|pladur/, "albanileria"],
    [/electric|enchufe|cuadro electrico/, "electricidad"],
    [/ilumin|luminaria|punto de luz/, "iluminacion"],
    [/fontaner|tuberia|desague/, "fontaneria"],
    [/climat|aire acondicionado|calefaccion/, "climatizacion"],
    [/alicat|revestimiento ceramico/, "alicatados"],
    [/pavimento|suelo|solado/, "pavimentos"],
    [/pintur|pintar/, "pintura"],
    [/carpinteria interior|puertas? interiores?/, "carpinteria_interior"],
    [/carpinteria exterior|ventanas?/, "carpinteria_exterior"],
    [/cocina|muebles de cocina|encimera/, "cocina_montaje"],
    [/sanitario|inodoro|lavabo|plato de ducha|reforma de bano/, "banos_sanitarios"],
    [/limpieza/, "limpieza_final"],
    [/residuos|escombros|contenedor/, "gestion_residuos"],
  ];
  return Array.from(
    new Set(matchers.filter(([pattern]) => pattern.test(normalized)).map(([, action]) => action)),
  );
}

/**
 * Chapters explicitly selected by the user. A null result means the user did
 * not constrain the scope, so the integral/default flow remains available.
 * Safety and waterproofing chapters are included only when technically tied
 * to an explicit action.
 */
export function getRequestedChapters(scope: BudgetScope): Set<string> | null {
  const actions = (scope.actuaciones || []).filter(Boolean);
  if (actions.length === 0) return null;

  const chapters = new Set<string>();
  for (const action of actions) {
    for (const chapter of ACTION_CHAPTERS[action] || [action]) chapters.add(chapter);
  }
  return chapters;
}

/**
 * Estimate the surface actually affected by the selected rooms. The total
 * dwelling area remains the upper bound. This prevents a kitchen-only job in
 * a 145 m2 home from being priced as if all 145 m2 were refurbished.
 */
export function getAffectedArea(scope: BudgetScope): number {
  const totalArea = Math.max(Number(scope.superficie_m2) || 60, 20);
  const rooms = Array.from(new Set((scope.estancias || []).filter(Boolean)));
  if (rooms.length === 0 || rooms.includes("vivienda_completa")) return totalArea;

  const fixedOrRelative: Record<string, number> = {
    cocina: Math.min(Math.max(totalArea * 0.08, 6), 14),
    bano_1: 5,
    bano_2: 5,
    salon: totalArea * 0.25,
    dormitorios: totalArea * 0.35,
    pasillo: totalArea * 0.12,
    terraza: totalArea * 0.12,
    otros: totalArea * 0.10,
  };

  const selectedArea = rooms.reduce(
    (sum, room) => sum + (fixedOrRelative[room] || totalArea * 0.10),
    0,
  );
  return Math.round(Math.min(totalArea, Math.max(selectedArea, 3)) * 10) / 10;
}

// ─── A. Scope Quantities ────────────────────────────────────────────────────

export function buildScopeQuantities(scope: BudgetScope): ScopeQuantities {
  const area = getAffectedArea(scope);
  const configuredBathrooms = normalizeBathroomCount(scope.num_banos);
  const rooms = Array.from(new Set((scope.estancias || []).filter(Boolean)));
  const wholeProperty = rooms.length === 0 || rooms.includes("vivienda_completa");
  const selectedBathrooms = rooms.filter((room) => /^bano_\d+$/.test(room)).length;
  const banos = wholeProperty
    ? configuredBathrooms
    : Math.min(configuredBathrooms, selectedBathrooms);
  const kitchenIncluded = scope.incluye_cocina && (wholeProperty || rooms.includes("cocina"));
  const avgBathroomM2 = 5;
  const avgKitchenM2 = Math.min(Math.max(area * 0.08, 6), 14);

  // Wet areas: bathrooms + kitchen if included
  const wetFloorArea = banos * avgBathroomM2 + (kitchenIncluded ? avgKitchenM2 : 0);
  // Wall height ~2.5m, perimeter approx = 4 * sqrt(area)
  const perimeter = 4 * Math.sqrt(area);
  const wallHeight = 2.5;
  const totalWallArea = perimeter * wallHeight;
  // Wet walls: ~3x floor area of wet zones (3 walls of ~wallHeight)
  const wetWallArea = wetFloorArea * 3;
  const projectContext = scope.project_context || "existing_renovation";
  const conservationStrategy = scope.conservation_strategy || "balanced";
  const conditionFactor = scope.existing_condition === "poor"
    ? 1.15
    : scope.existing_condition === "good"
      ? 0.82
      : 1;
  const demolitionRatio = projectContext === "new_build"
    ? 0
    : conservationStrategy === "preserve"
      ? 0.25
      : conservationStrategy === "replace"
        ? 0.85
        : 0.55;
  const partitionRatio = projectContext === "new_build"
    ? 0.40
    : conservationStrategy === "preserve"
      ? 0.10
      : conservationStrategy === "replace"
        ? 0.40
        : 0.24;
  const demolitionArea = Math.round(area * demolitionRatio * conditionFactor);

  return {
    floorArea: area,
    demolitionArea,
    pavementArea: area,
    ceilingArea: area,
    wallPaintArea: Math.round(totalWallArea - wetWallArea),
    wetWallArea: Math.round(wetWallArea),
    bathroomsCount: banos,
    kitchenIncluded,
    windowsCountEstimated: scope.incluye_ventanas ? Math.max(Math.ceil(area / 15), 3) : 0,
    electricalPointsEstimated: Math.round(area * 0.7),
    wasteContainersEstimated: projectContext === "new_build"
      ? Math.max(Math.ceil(area / 55), 1)
      : Math.max(Math.ceil(Math.max(demolitionArea, area * 0.15) / 30), 1),
    baseboardMlEstimated: Math.round(perimeter * 0.85),
    doorsEstimated: Math.max(Math.ceil(area / 14), 3),
    partitionArea: Math.max(Math.round(area * partitionRatio), projectContext === "new_build" ? 6 : 2),
  };
}

// ─── B. Normalize Items to Scope ────────────────────────────────────────────

const CHAPTER_KEY_MAP: Record<string, string[]> = {
  protecciones: ["protecci", "forrado", "ascensor"],
  demoliciones: ["demolici", "derribo", "levantado", "picado", "arranque"],
  albanileria: ["albañil", "tabiq", "pladur", "ladrillo"],
  falsos_techos: ["falso techo", "techo continuo", "escayola"],
  fontaneria: ["fontane", "agua fria", "agua caliente", "desague", "saneamiento"],
  electricidad: ["electri", "cuadro", "cableado", "punto de luz", "enchufe", "mecanismo"],
  impermeabilizacion: ["impermeab", "lamina", "tela asfaltica"],
  revestimientos: ["alicat", "revestim", "azulejo", "ceramico pared"],
  pavimentos: ["pavim", "solad", "suelo", "porcelan", "laminad", "tarima"],
  rodapie: ["rodapi", "zocalo"],
  pintura: ["pintura", "alisado", "gotele", "masilla pared"],
  carpinteria_interior: ["puerta de paso", "puerta interior", "carpint.*inter", "premarco"],
  carpinteria_exterior: ["ventana", "carpint.*exter", "aluminio rpt", "pvc.*acristal"],
  sanitarios: ["sanitario", "inodoro", "lavabo", "plato de ducha", "bañera", "griferia"],
  cocina: ["cocina", "encimera", "mueble.*alto", "mueble.*bajo", "fregadero"],
  climatizacion: ["climatiz", "aire acondicionado", "split", "conducto.*aire", "calefacc"],
  limpieza: ["limpieza final", "limpieza de obra", "limpieza profes"],
  residuos: ["residuo", "escombro", "contenedor", "vertedero"],
  seguridad: ["seguridad", "epi", "medio.*auxiliar", "señalizacion"],
};

function detectChapter(concept: string, description: string): string {
  const text = (concept + " " + description).toLowerCase();
  for (const [chapter, keywords] of Object.entries(CHAPTER_KEY_MAP)) {
    for (const kw of keywords) {
      if (new RegExp(kw, "i").test(text)) return chapter;
    }
  }
  return "otros";
}

/**
 * Assigns the correct chapter to each item and normalizes quantities
 * to match the scope. Idempotent: always produces the same output
 * for the same input, never duplicates items.
 */
export function normalizeBudgetItemsToScope(
  scope: BudgetScope,
  items: EnginePartida[],
  marginMultiplier: number
): EnginePartida[] {
  const q = buildScopeQuantities(scope);
  const requestedChapters = getRequestedChapters(scope);
  const projectContext = scope.project_context || "existing_renovation";
  const isExistingBuilding = projectContext !== "new_build";
  const conservationStrategy = scope.conservation_strategy || "balanced";

  // 1. Assign chapter to each item
  const tagged = items
    .map(item => ({
      ...item,
      chapter: item.chapter || detectChapter(item.concept, item.description),
    }))
    .filter(item => !requestedChapters || requestedChapters.has(item.chapter));

  // 2. Correct quantities based on chapter
  const corrected = tagged.map(item => {
    let newQty = item.quantity;
    const ch = item.chapter;
    const u = item.unit.toLowerCase();

    // Area-based chapters
    if (ch === "demoliciones" && (u === "m2" || u === "m²")) {
      newQty = q.demolitionArea;
    } else if (ch === "pavimentos" && (u === "m2" || u === "m²")) {
      newQty = q.pavementArea;
    } else if (ch === "falsos_techos" && (u === "m2" || u === "m²")) {
      newQty = q.ceilingArea;
    } else if (ch === "revestimientos" && (u === "m2" || u === "m²")) {
      newQty = q.wetWallArea;
    } else if (ch === "pintura" && (u === "m2" || u === "m²")) {
      // Painting: walls + ceiling (non-wet areas)
      const concept = item.concept.toLowerCase();
      if (concept.includes("techo")) {
        newQty = q.ceilingArea;
      } else if (concept.includes("pared") || concept.includes("alisado") || concept.includes("prepar")) {
        newQty = q.wallPaintArea;
      } else {
        newQty = q.wallPaintArea + q.ceilingArea;
      }
    } else if (ch === "rodapie" && (u === "ml" || u === "m")) {
      newQty = q.baseboardMlEstimated;
    } else if (ch === "albanileria" && (u === "m2" || u === "m²")) {
      newQty = q.partitionArea;
    }

    // Unit-based chapters
    if (ch === "electricidad" && (u === "ud" || u === "uds" || u === "punto")) {
      const concept = item.concept.toLowerCase();
      if (concept.includes("cuadro")) {
        newQty = 1;
      } else {
        newQty = q.electricalPointsEstimated;
      }
    }
    if (ch === "carpinteria_interior" && (u === "ud" || u === "uds")) {
      const concept = item.concept.toLowerCase();
      if (concept.includes("entrada") || concept.includes("seguridad")) {
        newQty = 1;
      } else {
        newQty = q.doorsEstimated;
      }
    }
    if (ch === "carpinteria_exterior" && (u === "ud" || u === "uds")) {
      newQty = q.windowsCountEstimated;
    }
    if (ch === "residuos" && (u === "ud" || u === "uds")) {
      newQty = q.wasteContainersEstimated;
    }

    // Bathroom-related: scale by bathroom count
    if (ch === "sanitarios") {
      if (u === "pa" || u === "global" || u === "lote") {
        // If it's a PA for "all bathrooms", scale the price, not qty
        // But if qty is 1 and we have 2+ banos, adjust
        if (newQty === 1 && q.bathroomsCount > 1) {
          newQty = q.bathroomsCount;
        }
      } else if (u === "ud" || u === "uds") {
        // Items per bathroom (inodoro, lavabo, etc.)
        if (newQty < q.bathroomsCount) {
          newQty = q.bathroomsCount;
        }
      }
    }
    if (ch === "fontaneria") {
      const concept = item.concept.toLowerCase();
      if (concept.includes("baño") || concept.includes("bano")) {
        if (newQty === 1 && q.bathroomsCount > 1 && (u === "pa" || u === "ud")) {
          newQty = q.bathroomsCount;
        }
      }
    }

    // Recalculate subtotals
    newQty = Math.max(Math.round(newQty), 1);
    const subtotal_cost = newQty * item.unit_price;
    const unit_price_client = item.unit_price * marginMultiplier;
    const subtotal_client = newQty * unit_price_client;

    return {
      ...item,
      quantity: newQty,
      subtotal_cost,
      unit_price_client,
      subtotal_client,
    };
  });

  // 3. Ensure required chapters exist; add missing ones
  const existingChapters = new Set(corrected.map(i => i.chapter));
  const missing: EnginePartida[] = [];
  let nextIdx = corrected.length;

  const add = (
    chapter: string, concept: string, desc: string,
    qty: number, unit: string, price: number, cat: string
  ) => {
    if (requestedChapters && !requestedChapters.has(chapter)) return;
    const id = `scope-${chapter}-${nextIdx++}`;
    // Avoid adding if we already have this chapter
    if (existingChapters.has(chapter)) return;
    existingChapters.add(chapter);
    const subtotal_cost = qty * price;
    missing.push({
      id, concept, description: desc, quantity: qty, unit, category: cat,
      chapter,
      unit_price: price,
      subtotal_cost,
      unit_price_client: price * marginMultiplier,
      subtotal_client: qty * price * marginMultiplier,
      status: "incluida",
    });
  };

  // A refurbishment starts from an existing asset. The engine must first
  // inspect and protect what remains; it must never silently price a blank site.
  if (isExistingBuilding) {
    add("diagnostico", "Inspección previa y comprobación de preexistencias",
      "Levantamiento del estado actual, comprobación de soportes e instalaciones y registro de los elementos que se conservan, reparan o sustituyen.",
      1, "PA", Math.max(q.floorArea * 3.5, 280), "mano_obra");
    add("protecciones", "Protección de elementos que se conservan",
      "Protección de accesos, zonas comunes, carpinterías, instalaciones y acabados que permanecen en la vivienda.",
      1, "PA", Math.max(q.floorArea * 1.5, 150), "otros");
    if (q.demolitionArea > 0) {
      add("demoliciones", "Desmontajes y demoliciones selectivas",
        `Retirada controlada solo de los elementos definidos para sustitución; estrategia: ${conservationStrategy === "preserve" ? "máxima conservación" : conservationStrategy === "replace" ? "sustitución amplia" : "reforma equilibrada"}.`,
        q.demolitionArea, "m2", 15, "mano_obra");
    }
  } else {
    add("protecciones", "Implantación y protecciones de obra",
      "Cerramientos provisionales, protección de accesos y medios auxiliares para la ejecución.",
      1, "PA", Math.max(q.floorArea * 1.5, 150), "otros");
  }

  add("albanileria", isExistingBuilding ? "Adaptación de tabiquería existente" : "Formación de tabiquería",
    isExistingBuilding
      ? "Aperturas, cierres, reparaciones y nueva tabiquería únicamente donde lo requiere la distribución seleccionada."
      : "Suministro e instalación de nueva tabiquería interior según proyecto.",
    q.partitionArea, "m2", 38, "mano_obra");

  if (!isExistingBuilding || conservationStrategy === "replace" || scope.existing_condition === "poor") {
    add("falsos_techos", isExistingBuilding ? "Reposición selectiva de falsos techos" : "Falsos techos continuos",
      isExistingBuilding
        ? "Reposición en las zonas afectadas por instalaciones o con soporte deteriorado."
        : "Formación de falso techo de placa de yeso laminado.",
      q.ceilingArea, "m2", 28, "mano_obra");
  }

  if (q.bathroomsCount > 0 || q.kitchenIncluded) {
    add("fontaneria", `${isExistingBuilding ? "Adecuación" : "Instalación"} de fontanería (${q.bathroomsCount} baño${q.bathroomsCount !== 1 ? "s" : ""}${q.kitchenIncluded ? " + cocina" : ""})`,
      isExistingBuilding
        ? `Inspección y adecuación de las redes existentes; sustitución limitada a ${q.bathroomsCount} baño(s)${q.kitchenIncluded ? " y cocina" : ""}.`
        : `Nueva red de agua fría, caliente y desagües para ${q.bathroomsCount} baño(s)${q.kitchenIncluded ? " y cocina" : ""}.`,
      1, "PA", (q.bathroomsCount * 950) + (q.kitchenIncluded ? 650 : 0), "mano_obra");
  }

  add("electricidad", isExistingBuilding ? "Revisión y adecuación eléctrica" : "Instalación eléctrica completa",
    isExistingBuilding
      ? `Comprobación de la instalación existente y adecuación de cuadro, circuitos y ${q.electricalPointsEstimated} puntos conforme al alcance seleccionado.`
      : `Cuadro general, ${q.electricalPointsEstimated} puntos de luz/enchufes, mecanismos y protecciones.`,
    q.electricalPointsEstimated, "ud", 42, "mano_obra");

  if (q.wetWallArea > 0) {
    add("impermeabilizacion", "Impermeabilización de zonas húmedas afectadas",
      "Sistema impermeable en baños y cocina incluidos en el alcance.",
      Math.round(q.wetWallArea * 0.4), "m2", 22, "material");

    add("revestimientos", isExistingBuilding ? "Reposición de revestimientos en zonas afectadas" : "Alicatado de zonas húmedas",
      "Colocación de revestimiento cerámico exclusivamente en los paramentos incluidos.",
      q.wetWallArea, "m2", 38, "mano_obra");
  }

  add("pavimentos", "Solado general de vivienda",
    "Colocacion de pavimento ceramico o laminado.",
    q.pavementArea, "m2", 32, "mano_obra");

  add("rodapie", "Rodapie",
    "Suministro y colocacion de rodapie a juego.",
    q.baseboardMlEstimated, "ml", 9, "mano_obra");

  add("pintura", "Pintura plastica lisa (paredes y techos)",
    "Preparacion de superficie y aplicacion de dos manos de pintura plastica lavable.",
    q.wallPaintArea + q.ceilingArea, "m2", 9, "mano_obra");

  add("carpinteria_interior", "Carpinteria interior (puertas de paso)",
    "Suministro y colocacion de puertas de paso lacadas con herrajes.",
    q.doorsEstimated, "ud", 380, "material");

  if (scope.incluye_ventanas) {
    add("carpinteria_exterior", "Carpinteria exterior (ventanas)",
      "Suministro y colocacion de ventanas aluminio RPT con doble acristalamiento.",
      q.windowsCountEstimated, "ud", 650, "material");
  }

  if (q.bathroomsCount > 0) {
    add("sanitarios", `Sanitarios y grifería (${q.bathroomsCount} baño${q.bathroomsCount > 1 ? "s" : ""})`,
      `Suministro e instalación para los ${q.bathroomsCount} baño(s) expresamente incluidos.`,
      q.bathroomsCount, "lote", 1800, "material");
  }

  if (scope.incluye_cocina) {
    add("cocina", "Cocina completa",
      "Muebles altos y bajos, encimera, fregadero y griferia de cocina.",
      1, "PA", q.floorArea > 120 ? 7000 : q.floorArea > 80 ? 5500 : 4500, "material");
  }

  if (scope.incluye_climatizacion) {
    const clima = inferClimaSystem(scope);
    const climaQty = clima.system === "conductos" ? 1 : clima.unitsNeeded;
    const climaUnit = clima.system === "conductos" ? "PA" : "ud";
    const climaPrice = clima.system === "conductos" ? Math.max(q.floorArea * 35, 4500) :
                       clima.system === "multisplit" ? 1400 :
                       clima.system === "splits_individuales" ? 1200 : 600;
    add("climatizacion", `Climatizacion — ${clima.label}`,
      clima.description,
      climaQty, climaUnit, climaPrice, "mano_obra");
  }

  add("residuos", "Gestion de residuos y contenedores",
    "Carga, transporte a vertedero autorizado y tasa.",
    q.wasteContainersEstimated, "ud", 290, "otros");

  add("seguridad", "Seguridad y medios auxiliares",
    "Protecciones colectivas, EPI, señalizacion y medios auxiliares durante obra.",
    1, "PA", Math.max(q.floorArea * 6, 400), "otros");

  add("limpieza", "Limpieza final de obra",
    "Limpieza profesional exhaustiva de todas las estancias.",
    1, "PA", Math.max(q.floorArea * 3.5, 300), "mano_obra");

  return [...corrected, ...missing];
}

/**
 * Build a complete, deterministic set of budget lines from the structured
 * scope. Unlike the single-line safety fallback in normalizeBudgetItemsToScope,
 * this produces enough technical detail for partial trades such as plumbing,
 * lighting or painting and can be priced against the tracker/technical bank.
 */
export function buildDeterministicBudgetItems(
  scope: BudgetScope,
  marginMultiplier: number,
): EnginePartida[] {
  const actions = Array.from(new Set((scope.actuaciones || []).filter(Boolean)));
  if (actions.length === 0) {
    return normalizeBudgetItemsToScope(scope, [], marginMultiplier);
  }

  const q = buildScopeQuantities(scope);
  const isExistingBuilding = (scope.project_context || "existing_renovation") !== "new_build";
  const conservationStrategy = scope.conservation_strategy || "balanced";
  const qualityMultiplier = scope.calidad === "alta" ? 1.22 : scope.calidad === "basica" ? 0.88 : 1;
  const lightingPoints = Math.max(Math.round(q.floorArea / 6), 4);
  const waterPoints = Math.max(q.bathroomsCount * 4 + (q.kitchenIncluded ? 3 : 0), 3);
  const supplyLength = Math.max(Math.round(q.floorArea * 0.55), 15);
  const drainageLength = Math.max(Math.round(q.floorArea * 0.30), 10);
  const kitchenLength = Math.max(Math.round(q.floorArea * 0.08 * 0.55), 3);
  const items: EnginePartida[] = [];

  const add = (
    chapter: string,
    concept: string,
    description: string,
    quantity: number,
    unit: string,
    unitPrice: number,
    category: string,
    estimatedHours?: number,
  ) => {
    const adjustedPrice = Math.round(
      unitPrice * (category === "otros" ? 1 : qualityMultiplier) * 100,
    ) / 100;
    const safeQuantity = Math.max(Math.round(quantity * 10) / 10, 1);
    const subtotalCost = safeQuantity * adjustedPrice;
    items.push({
      id: `engine-${chapter}-${items.length}`,
      concept,
      description,
      quantity: safeQuantity,
      unit,
      category,
      chapter,
      unit_price: adjustedPrice,
      subtotal_cost: subtotalCost,
      unit_price_client: adjustedPrice * marginMultiplier,
      subtotal_client: subtotalCost * marginMultiplier,
      status: "incluida",
      estimated_hours: estimatedHours,
      price_source: "engine_scope",
    });
  };

  for (const action of actions) {
    switch (action) {
      case "demoliciones":
        if (isExistingBuilding) {
          add("diagnostico", "Inspección y levantamiento del estado actual", "Comprobación previa de soportes, instalaciones y elementos que se conservan, reparan o sustituyen.", 1, "PA", Math.max(q.floorArea * 3.5, 280), "mano_obra", Math.max(q.floorArea * 0.04, 4));
        }
        add("protecciones", isExistingBuilding ? "Protección de elementos que se conservan" : "Implantación y protecciones de obra", "Protección de pasos, accesos y elementos fuera del alcance.", 1, "PA", Math.max(q.floorArea * 1.6, 140), "otros", 4);
        if (q.demolitionArea > 0) {
          add("demoliciones", "Demolición selectiva de acabados", `Levantado controlado únicamente en la superficie afectada (${conservationStrategy === "preserve" ? "máxima conservación" : conservationStrategy === "replace" ? "sustitución amplia" : "reforma equilibrada"}).`, q.demolitionArea, "m2", 19, "mano_obra", q.demolitionArea * 0.35);
          add("demoliciones", "Desmontaje de instalaciones y elementos", "Desmontaje selectivo, clasificación, protección de recuperables y acopio para retirada.", 1, "PA", Math.max(q.demolitionArea * 7, 320), "mano_obra", Math.max(q.demolitionArea * 0.18, 6));
        }
        add("residuos", "Contenedor y transporte a gestor autorizado", "Carga, transporte, tasa y justificante de gestión de residuos.", q.wasteContainersEstimated, "ud", 310, "otros");
        break;
      case "albanileria":
        add("albanileria", "Replanteo de albañilería", "Trazado de particiones, encuentros y pasos de instalaciones.", 1, "PA", 220, "mano_obra", 4);
        add("albanileria", isExistingBuilding ? "Adaptación y reparación de tabiquería" : "Formación de tabiquería", isExistingBuilding ? "Aperturas, cierres y reparaciones solo donde cambia la distribución; se conserva el resto." : "Ejecución de tabiquería y remates según proyecto.", q.partitionArea, "m2", 46, "mano_obra", q.partitionArea * 0.55);
        add("albanileria", "Guarnecido y regularización de paramentos", "Regularización previa a revestimientos y pintura.", Math.max(q.wallPaintArea * 0.25, 8), "m2", 18, "mano_obra");
        add("albanileria", "Ayudas a instalaciones", "Rozas, pasos, recibido de cajas y posterior tapado.", 1, "PA", Math.max(q.floorArea * 9, 360), "mano_obra");
        break;
      case "electricidad":
        add("electricidad", "Canalizaciones y cableado eléctrico", isExistingBuilding ? "Comprobación y adecuación de circuitos existentes; renovación solo de los conductores y tramos incluidos conforme al REBT." : "Ejecución de circuitos y conductores nuevos conforme al REBT.", q.electricalPointsEstimated, "punto", 52, "mano_obra", q.electricalPointsEstimated * 0.65);
        add("electricidad", "Mecanismos eléctricos", "Suministro e instalación de enchufes, interruptores y cajas.", q.electricalPointsEstimated, "ud", 24, "material");
        add("electricidad", "Cuadro eléctrico y protecciones", "Cuadro, diferenciales, magnetotérmicos, sobretensiones y rotulación.", 1, "ud", 760, "material", 7);
        add("electricidad", "Comprobaciones y certificado", "Mediciones, pruebas de seguridad y documentación final.", 1, "PA", 320, "mano_obra", 4);
        break;
      case "iluminacion":
        add("electricidad", "Puntos de iluminación", "Canalización, cableado y conexión de los puntos de luz seleccionados.", lightingPoints, "punto", 48, "mano_obra", lightingPoints * 0.75);
        add("electricidad", "Interruptores y mecanismos de iluminación", "Mecanismos, cajas y conexiones para el control de las luminarias.", Math.max(Math.ceil(lightingPoints * 0.65), 2), "ud", 31, "material");
        add("electricidad", "Luminarias LED", "Suministro de luminarias LED de la calidad seleccionada.", lightingPoints, "ud", 62, "material");
        add("electricidad", "Montaje, regulación y pruebas", "Instalación, orientación y comprobación final de todos los puntos.", 1, "PA", Math.max(lightingPoints * 28, 160), "mano_obra", Math.max(lightingPoints * 0.4, 3));
        break;
      case "fontaneria":
        add("fontaneria", isExistingBuilding ? "Adecuación de la red de suministro de agua" : "Red de suministro de agua", isExistingBuilding ? "Inspección de la red actual y sustitución de los tramos incluidos con tubería multicapa, aislamiento y accesorios." : "Tubería multicapa nueva, aislamiento, accesorios y fijaciones.", supplyLength, "ml", 27, "mano_obra", supplyLength * 0.45);
        add("fontaneria", "Red de evacuación", "Tubería de PVC, piezas especiales, soportes y conexión a bajantes.", drainageLength, "ml", 34, "mano_obra", drainageLength * 0.5);
        add("fontaneria", "Puntos de consumo y desagüe", "Conexiones completas para aparatos, sanitarios y cocina incluidos.", waterPoints, "ud", 118, "mano_obra", waterPoints * 1.2);
        add("fontaneria", "Llaves de corte y accesorios", "Llaves, colectores, sifones, válvulas y pequeños accesorios.", Math.max(q.bathroomsCount + (q.kitchenIncluded ? 1 : 0), 1), "lote", 185, "material");
        add("fontaneria", "Prueba de presión y estanqueidad", "Llenado, purgado, prueba de presión y comprobación de evacuación.", 1, "PA", 240, "mano_obra", 4);
        add("fontaneria", "Ayudas de albañilería para fontanería", "Rozas, pasos y reposición básica de paramentos afectados.", 1, "PA", Math.max(q.floorArea * 5, 260), "mano_obra");
        break;
      case "climatizacion": {
        const clima = inferClimaSystem(scope);
        const units = clima.system === "conductos" ? 1 : Math.max(clima.unitsNeeded, 1);
        add("climatizacion", `Equipos de climatización — ${clima.label}`, clima.description, units, clima.system === "conductos" ? "PA" : "ud", clima.system === "conductos" ? Math.max(q.floorArea * 48, 5200) : 1450, "material");
        add("climatizacion", "Líneas frigoríficas y eléctricas", "Tuberías, aislamiento, interconexión y soportación.", Math.max(Math.round(q.floorArea * 0.35), 12), "ml", 38, "mano_obra");
        add("climatizacion", "Evacuación de condensados", "Desagüe de condensados con pendiente y prueba de funcionamiento.", Math.max(units * 5, 5), "ml", 24, "mano_obra");
        add("climatizacion", "Puesta en marcha y pruebas", "Vacío, carga si procede, regulación y comprobación de rendimiento.", 1, "PA", 360, "mano_obra", 5);
        break;
      }
      case "alicatados":
        add("revestimientos", "Preparación de soportes para alicatado", "Limpieza, saneado y regularización del soporte.", q.wetWallArea, "m2", 13, "mano_obra");
        add("impermeabilizacion", "Impermeabilización de zonas húmedas", "Sistema impermeable continuo en duchas y encuentros críticos.", Math.max(q.wetWallArea * 0.4, 5), "m2", 29, "material");
        add("revestimientos", "Colocación de revestimiento cerámico", "Colocación con adhesivo flexible, nivelación y cortes.", q.wetWallArea, "m2", 44, "mano_obra");
        add("revestimientos", "Rejuntado y sellado", "Rejuntado, juntas elásticas y limpieza final del revestimiento.", q.wetWallArea, "m2", 9, "mano_obra");
        break;
      case "pavimentos":
        add("pavimentos", "Preparación y nivelación del soporte", "Saneado, reparación y regularización previa del soporte.", q.pavementArea, "m2", 14, "mano_obra");
        add("pavimentos", "Suministro de pavimento", "Pavimento de la calidad seleccionada con merma incluida.", q.pavementArea, "m2", 29, "material");
        add("pavimentos", "Colocación de pavimento", "Instalación, cortes, encuentros y juntas.", q.pavementArea, "m2", 34, "mano_obra");
        add("rodapie", "Rodapié y remates perimetrales", "Suministro, corte, colocación y sellado de rodapié.", q.baseboardMlEstimated, "ml", 13, "mano_obra");
        break;
      case "pintura":
        add("pintura", "Protección de superficies y mobiliario", "Enmascarado de suelos, carpinterías y elementos conservados.", 1, "PA", Math.max(q.floorArea * 2.2, 160), "otros", 4);
        add("pintura", "Preparación y reparación de paredes", "Lijado, sellado de fisuras y masillado puntual de paramentos.", q.wallPaintArea, "m2", 5.5, "mano_obra", q.wallPaintArea * 0.12);
        add("pintura", "Imprimación de paredes y techos", "Aplicación de imprimación compatible según absorción del soporte.", q.wallPaintArea + q.ceilingArea, "m2", 3.4, "material");
        add("pintura", "Pintura plástica en paredes", "Dos manos de pintura plástica lavable en el color seleccionado.", q.wallPaintArea, "m2", 9.5, "mano_obra", q.wallPaintArea * 0.13);
        add("pintura", "Pintura de techos", "Dos manos de pintura transpirable y acabado uniforme.", q.ceilingArea, "m2", 10.5, "mano_obra", q.ceilingArea * 0.14);
        break;
      case "carpinteria_interior":
        add("carpinteria_interior", "Desmontaje de carpintería interior", "Desmontaje cuidadoso de hojas, tapetas y cercos existentes.", q.doorsEstimated, "ud", 48, "mano_obra");
        add("carpinteria_interior", "Puertas interiores y herrajes", "Suministro de puertas, cercos, tapetas, manillas y herrajes.", q.doorsEstimated, "ud", 295, "material");
        add("carpinteria_interior", "Montaje y ajuste de puertas", "Colocación, aplomado, ajuste de herrajes y sellado.", q.doorsEstimated, "ud", 125, "mano_obra");
        break;
      case "carpinteria_exterior":
        add("carpinteria_exterior", "Desmontaje de ventanas existentes", "Desmontaje, acopio y retirada de carpinterías existentes.", q.windowsCountEstimated, "ud", 85, "mano_obra");
        add("carpinteria_exterior", "Ventanas con aislamiento térmico", "Suministro de carpintería con RPT/PVC y doble acristalamiento.", q.windowsCountEstimated, "ud", 590, "material");
        add("carpinteria_exterior", "Instalación, sellado y remates", "Colocación, anclajes, espuma, sellado y remate interior.", q.windowsCountEstimated, "ud", 210, "mano_obra");
        break;
      case "cocina_montaje":
        add("cocina", "Mobiliario de cocina", "Muebles altos y bajos, herrajes y frentes de la calidad seleccionada.", kitchenLength, "ml", 720, "material");
        add("cocina", "Encimera y copete", "Suministro y mecanizado de encimera con huecos y remates.", kitchenLength, "ml", 285, "material");
        add("cocina", "Montaje y ajuste de mobiliario", "Montaje, nivelación, fijación y regulación de herrajes.", 1, "PA", Math.max(kitchenLength * 240, 900), "mano_obra");
        add("cocina", "Fregadero, grifería y conexiones", "Suministro básico, instalación y conexión a redes existentes.", 1, "lote", 690, "material");
        break;
      case "banos_sanitarios":
        add("impermeabilizacion", "Impermeabilización de duchas", "Impermeabilización de zonas de ducha y encuentros con paramentos.", Math.max(q.bathroomsCount * 6, 6), "m2", 31, "material");
        add("sanitarios", "Aparatos sanitarios y griferías", "Inodoro, lavabo, ducha y griferías de la calidad seleccionada.", q.bathroomsCount, "lote", 1850, "material");
        add("sanitarios", "Instalación de sanitarios", "Montaje, conexiones, sellados y pruebas de los aparatos.", q.bathroomsCount, "lote", 620, "mano_obra", q.bathroomsCount * 12);
        add("sanitarios", "Mamparas y accesorios", "Suministro e instalación de mampara, espejo y accesorios básicos.", q.bathroomsCount, "lote", 620, "material");
        break;
      case "limpieza_final":
        add("limpieza", "Limpieza fina de obra", "Eliminación de polvo, adhesivos y restos en todas las superficies afectadas.", q.floorArea, "m2", 5.2, "mano_obra");
        add("limpieza", "Limpieza de vidrios y repasos", "Limpieza de vidrios, carpinterías, sanitarios y repaso final.", 1, "PA", Math.max(q.floorArea * 1.8, 120), "mano_obra");
        break;
      case "gestion_residuos":
        add("residuos", "Contenedores y transporte", "Contenedor, retirada y transporte a gestor autorizado.", q.wasteContainersEstimated, "ud", 310, "otros");
        add("residuos", "Tasas y documentación de residuos", "Tasas, pesaje y justificantes de entrega al gestor.", 1, "PA", Math.max(q.wasteContainersEstimated * 95, 120), "otros");
        break;
      default: {
        const chapter = ACTION_CHAPTERS[action]?.[0] || action;
        add(chapter, `Trabajos de ${action.replace(/_/g, " ")}`, "Partida dimensionada según el alcance seleccionado.", 1, "PA", Math.max(q.floorArea * 45, 450), "mano_obra");
      }
    }
  }

  return normalizeBudgetItemsToScope(scope, items, marginMultiplier);
}

// ─── C. Cost Breakdown ──────────────────────────────────────────────────────

export function calculateItemCostBreakdown(
  item: EnginePartida,
  _scope: BudgetScope,
  marginPct: number
): EnginePartida {
  const ch = item.chapter;
  const cost = item.quantity * item.unit_price;
  const marginMultiplier = 1 + marginPct / 100;

  // Heuristic split by chapter type
  let materialRatio = 0.4;
  let laborRatio = 0.5;
  let equipmentRatio = 0.05;
  let wasteRatio = 0.05;

  if (["pavimentos", "revestimientos", "carpinteria_interior", "carpinteria_exterior", "sanitarios", "cocina"].includes(ch)) {
    materialRatio = 0.55;
    laborRatio = 0.35;
    equipmentRatio = 0.05;
    wasteRatio = 0.05;
  } else if (["demoliciones", "limpieza", "pintura"].includes(ch)) {
    materialRatio = 0.15;
    laborRatio = 0.75;
    equipmentRatio = 0.05;
    wasteRatio = 0.05;
  } else if (["residuos"].includes(ch)) {
    materialRatio = 0;
    laborRatio = 0.3;
    equipmentRatio = 0.2;
    wasteRatio = 0.5;
  } else if (["seguridad", "protecciones"].includes(ch)) {
    materialRatio = 0.4;
    laborRatio = 0.2;
    equipmentRatio = 0.35;
    wasteRatio = 0.05;
  }

  // Determine category from ratios
  let category = item.category;
  if (materialRatio > laborRatio && materialRatio > 0.45) {
    category = "material";
  } else if (laborRatio > materialRatio) {
    category = "mano_obra";
  }
  // Override: specific chapters that are clearly "suministro y colocacion"
  if (["sanitarios", "cocina", "carpinteria_interior", "carpinteria_exterior"].includes(ch)) {
    category = "material"; // "Suministro y colocacion"
  }

  const pvp = cost * marginMultiplier;

  return {
    ...item,
    category,
    subtotal_cost: cost,
    unit_price_client: item.unit_price * marginMultiplier,
    subtotal_client: pvp,
    cost_breakdown: {
      material_cost: Math.round(cost * materialRatio * 100) / 100,
      labor_cost: Math.round(cost * laborRatio * 100) / 100,
      equipment_cost: Math.round(cost * equipmentRatio * 100) / 100,
      waste_cost: Math.round(cost * wasteRatio * 100) / 100,
      margin: Math.round((pvp - cost) * 100) / 100,
      pvp: Math.round(pvp * 100) / 100,
      source: "engine_estimate",
      confidence_score: 70,
      price_type: "estimated",
    },
  };
}

// ─── D. Materials from Partidas ─────────────────────────────────────────────

export interface MaterialSpec {
  id: string;
  name: string;
  specification: string;
  procurementKind?: "product" | "service";
  unit: string;
  unit_price: number;
  provider_id: string;
  qtyFn: (q: ScopeQuantities) => number;
  chapter: string;
}

export const MATERIAL_SPECS: MaterialSpec[] = [
  // Albañilería: cada línea representa un formato comprable concreto.
  { id: "mortar-m75-25kg", name: "Mortero seco de cemento M-7.5 gris saco 25 kg", specification: "Clase M-7.5; color gris; envase de 25 kg", unit: "sacos", unit_price: 3.50, provider_id: "obramat", qtyFn: q => Math.ceil(q.partitionArea / 3), chapter: "albanileria" },
  { id: "gypsum-standard-a-2000-1200-13", name: "Placa de yeso laminado BA 2000x1200x13 mm", specification: "Placa BA estándar; 2000x1200 mm; espesor 13 mm; precio normalizado por m²", unit: "m2", unit_price: 2.81, provider_id: "obramat", qtyFn: q => Math.ceil(q.partitionArea * 1.1), chapter: "albanileria" },
  { id: "metal-stud-48-3000", name: "Montante metálico para placa de yeso 48 mm 3 m", specification: "Montante galvanizado; ancho 48 mm; longitud 3 m", unit: "ud", unit_price: 3.20, provider_id: "obramat", qtyFn: q => Math.ceil(q.partitionArea * 0.8), chapter: "albanileria" },

  // Fontanería: los antiguos lotes se descomponen en tubo, racores, llaves y desagües.
  { id: "multilayer-pipe-16-50", name: "Tubo multicapa PEX-AL-PEX 16 mm rollo 50 m", specification: "Diámetro 16 mm; rollo de 50 m; uso agua fría y caliente", unit: "rollos", unit_price: 42.0, provider_id: "saltoki", qtyFn: q => Math.ceil((q.bathroomsCount + (q.kitchenIncluded ? 1 : 0)) * 1.2), chapter: "fontaneria" },
  { id: "pvc-drain-110-3", name: "Tubo PVC evacuación 110 mm longitud 3 m", specification: "PVC evacuación; diámetro 110 mm; barra de 3 m", unit: "ud", unit_price: 12.90, provider_id: "bauhaus", qtyFn: q => Math.ceil(q.bathroomsCount * 3 + (q.kitchenIncluded ? 2 : 0)), chapter: "fontaneria" },
  { id: "multilayer-straight-fitting-16", name: "Racor recto para tubo multicapa 16 mm", specification: "Racor recto; conexión para tubo multicapa de 16 mm", unit: "ud", unit_price: 3.14, provider_id: "manomano", qtyFn: q => Math.max((q.bathroomsCount * 8) + (q.kitchenIncluded ? 4 : 0), 2), chapter: "fontaneria" },
  { id: "multilayer-elbow-16", name: "Codo 90 grados para tubo multicapa 16 mm", specification: "Codo de 90°; conexión para tubo multicapa de 16 mm", unit: "ud", unit_price: 4.91, provider_id: "manomano", qtyFn: q => Math.max((q.bathroomsCount * 6) + (q.kitchenIncluded ? 3 : 0), 2), chapter: "fontaneria" },
  { id: "angle-stop-valve-half-three-eighth", name: "Llave de corte escuadra 1/2 x 3/8 pulgadas", specification: "Entrada 1/2; salida 3/8; cierre individual de aparato", unit: "ud", unit_price: 7.50, provider_id: "obramat", qtyFn: q => Math.max((q.bathroomsCount * 2) + (q.kitchenIncluded ? 2 : 0), 1), chapter: "fontaneria" },
  { id: "multilayer-manifold-four-16", name: "Colector de fontanería 4 salidas para tubo 16 mm", specification: "Colector de 4 salidas; conexiones de 16 mm", unit: "ud", unit_price: 35.0, provider_id: "saltoki", qtyFn: q => Math.max(q.bathroomsCount + (q.kitchenIncluded ? 1 : 0), 1), chapter: "fontaneria" },
  { id: "basin-bottle-trap-32", name: "Sifón botella para lavabo salida 32 mm", specification: "Sifón botella; salida de 32 mm; conexión de lavabo", unit: "ud", unit_price: 12.0, provider_id: "obramat", qtyFn: q => q.bathroomsCount, chapter: "fontaneria" },
  { id: "basin-waste-valve-32", name: "Válvula de desagüe para lavabo 1 1/4 pulgadas", specification: "Válvula de lavabo; rosca 1 1/4; acabado cromado", unit: "ud", unit_price: 10.0, provider_id: "obramat", qtyFn: q => q.bathroomsCount, chapter: "fontaneria" },
  { id: "sink-trap-40", name: "Sifón para fregadero salida 40 mm", specification: "Sifón para fregadero; salida de 40 mm", unit: "ud", unit_price: 15.0, provider_id: "obramat", qtyFn: q => q.kitchenIncluded ? 1 : 0, chapter: "fontaneria" },
  { id: "sink-basket-waste", name: "Válvula cesta para fregadero 3 1/2 pulgadas", specification: "Válvula cesta; diámetro 3 1/2; acero inoxidable", unit: "ud", unit_price: 12.0, provider_id: "obramat", qtyFn: q => q.kitchenIncluded ? 1 : 0, chapter: "fontaneria" },

  // Electricidad: cuadro, protecciones y mecanismos se verifican por separado.
  { id: "cable-h07vk-25-100", name: "Cable H07V-K 2.5 mm2 rollo 100 m", specification: "Sección 2,5 mm²; rollo 100 m; conductor flexible", unit: "rollos", unit_price: 28.0, provider_id: "obramat", qtyFn: q => Math.ceil(q.electricalPointsEstimated / 30), chapter: "electricidad" },
  { id: "panel-box-12-flush", name: "Caja para cuadro eléctrico empotrable 12 módulos", specification: "Instalación empotrada; capacidad 12 módulos DIN", unit: "ud", unit_price: 22.0, provider_id: "obramat", qtyFn: () => 1, chapter: "electricidad" },
  { id: "rcd-2p-40a-30ma", name: "Interruptor diferencial 2P 40A 30mA", specification: "2 polos; intensidad 40 A; sensibilidad 30 mA", unit: "ud", unit_price: 45.0, provider_id: "obramat", qtyFn: () => 1, chapter: "electricidad" },
  { id: "mcb-1pn-16a-c", name: "Magnetotérmico 1P+N 16A curva C", specification: "1P+N; intensidad 16 A; curva C", unit: "ud", unit_price: 12.50, provider_id: "obramat", qtyFn: q => Math.max(Math.ceil(q.electricalPointsEstimated / 14), 3), chapter: "electricidad" },
  { id: "surge-protection-2p", name: "Protector de sobretensiones transitorias 2P", specification: "Protección transitoria; 2 polos; montaje en carril DIN", unit: "ud", unit_price: 64.0, provider_id: "obramat", qtyFn: () => 1, chapter: "electricidad" },
  { id: "socket-schuko-16a-white", name: "Base de enchufe Schuko 16A empotrable blanca", specification: "Tipo Schuko; 16 A; instalación empotrada; color blanco", unit: "ud", unit_price: 4.80, provider_id: "obramat", qtyFn: q => Math.max(Math.round(q.electricalPointsEstimated * 0.65), 1), chapter: "electricidad" },
  { id: "switch-one-way-10a-white", name: "Interruptor unipolar 10A empotrable blanco", specification: "Interruptor unipolar; 10 A; instalación empotrada; color blanco", unit: "ud", unit_price: 4.50, provider_id: "obramat", qtyFn: q => Math.max(Math.round(q.electricalPointsEstimated * 0.35), 1), chapter: "electricidad" },
  { id: "led-surface-20w-4000k", name: "Luminaria LED de superficie 20W 4000K IP20", specification: "Potencia 20 W; temperatura 4000 K; protección IP20; montaje en superficie", unit: "ud", unit_price: 5.95, provider_id: "manomano", qtyFn: q => Math.max(Math.round(q.floorArea / 6), 4), chapter: "electricidad" },

  // Acabados: se elimina la alternativa cerámico/laminado y se define una solución completa.
  { id: "porcelain-wall-60-60", name: "Revestimiento porcelánico rectificado 60x60 cm mate", specification: "Porcelánico rectificado; formato 60x60 cm; acabado mate", unit: "m2", unit_price: 28.0, provider_id: "porcelanosa", qtyFn: q => Math.ceil(q.wetWallArea * 1.1), chapter: "revestimientos" },
  { id: "adhesive-c2te-25", name: "Adhesivo cementoso flexible C2TE gris saco 25 kg", specification: "Clasificación C2TE; color gris; saco de 25 kg", unit: "sacos", unit_price: 12.50, provider_id: "obramat", qtyFn: q => Math.ceil((q.wetWallArea + q.pavementArea) / 5), chapter: "revestimientos" },
  { id: "laminate-ac5-oak-10", name: "Suelo laminado AC5 10 mm acabado roble", specification: "Clase de uso AC5; espesor 10 mm; acabado roble; precio normalizado por m²", unit: "m2", unit_price: 12.90, provider_id: "obramat", qtyFn: q => Math.ceil(q.pavementArea * 1.1), chapter: "pavimentos" },
  { id: "laminate-underlay-5", name: "Base aislante para suelo laminado 5 mm", specification: "Espesor 5 mm; apta para suelo laminado flotante", unit: "m2", unit_price: 3.40, provider_id: "obramat", qtyFn: q => Math.ceil(q.pavementArea * 1.1), chapter: "pavimentos" },
  { id: "skirting-mdf-white-2200", name: "Pack 5 rodapiés DM melamina blanco 2200x70x9 mm", specification: "Pack de 5 piezas; DM melaminado blanco; 11 m lineales por pack; 2200x70x9 mm por pieza", unit: "lote", unit_price: 21.0, provider_id: "obramat", qtyFn: q => Math.ceil((q.baseboardMlEstimated * 1.05) / 11), chapter: "rodapie" },

  // Pintura: protección y herramientas dejan de ser lotes genéricos.
  { id: "paint-white-matt-15", name: "Pintura plástica blanca mate interior 15 L", specification: "Interior; color blanco; acabado mate; envase 15 L", unit: "cubos", unit_price: 37.0, provider_id: "obramat", qtyFn: q => Math.ceil((q.wallPaintArea + q.ceilingArea) / 80), chapter: "pintura" },
  { id: "primer-water-15", name: "Imprimación fijadora al agua 15 L", specification: "Fijadora al agua; envase 15 L; uso interior", unit: "cubos", unit_price: 35.0, provider_id: "obramat", qtyFn: q => Math.ceil((q.wallPaintArea + q.ceilingArea) / 120), chapter: "pintura" },
  { id: "interior-repair-putty-15", name: "Masilla de reparación interior saco 15 kg", specification: "Uso interior; saco de 15 kg; lijable", unit: "sacos", unit_price: 18.0, provider_id: "obramat", qtyFn: q => Math.max(Math.ceil(q.wallPaintArea / 100), 1), chapter: "pintura" },
  { id: "masking-tape-50-50", name: "Cinta de enmascarar 50 mm x 50 m", specification: "Ancho 50 mm; longitud 50 m; uso pintura interior", unit: "ud", unit_price: 5.50, provider_id: "obramat", qtyFn: q => Math.max(Math.ceil(q.floorArea / 25), 2), chapter: "pintura" },
  { id: "protective-film-4-5", name: "Plástico protector para pintura 4x5 m", specification: "Lámina protectora; formato 4x5 m", unit: "ud", unit_price: 4.50, provider_id: "obramat", qtyFn: q => Math.max(Math.ceil(q.floorArea / 20), 1), chapter: "pintura" },
  { id: "paint-roller-22", name: "Rodillo para pintura plástica interior 22 cm", specification: "Ancho 22 cm; apto para pintura plástica en paredes", unit: "ud", unit_price: 8.0, provider_id: "obramat", qtyFn: q => Math.max(Math.ceil(q.floorArea / 80), 1), chapter: "pintura" },
  { id: "paint-brush-40", name: "Brocha plana para pintura 40 mm", specification: "Ancho 40 mm; uso en recortes y encuentros", unit: "ud", unit_price: 4.0, provider_id: "obramat", qtyFn: q => Math.max(Math.ceil(q.floorArea / 100), 1), chapter: "pintura" },
  { id: "paint-tray-16", name: "Cubeta de pintura con rejilla 16 L", specification: "Capacidad 16 L; rejilla escurridora incluida", unit: "ud", unit_price: 9.0, provider_id: "obramat", qtyFn: q => Math.max(Math.ceil(q.floorArea / 100), 1), chapter: "pintura" },

  // Sanitarios: cada aparato y cada grifería conservan su precio independiente.
  { id: "toilet-compact-dual-white", name: "Inodoro compacto adosado a pared salida dual blanco", specification: "Compacto; adosado a pared; salida dual; porcelana blanca", unit: "ud", unit_price: 189.0, provider_id: "roca", qtyFn: q => q.bathroomsCount, chapter: "sanitarios" },
  { id: "countertop-basin-round-400", name: "Lavabo sobre encimera redondo 400 mm blanco", specification: "Instalación sobre encimera; diámetro 400 mm; porcelana blanca", unit: "ud", unit_price: 195.0, provider_id: "roca", qtyFn: q => q.bathroomsCount, chapter: "sanitarios" },
  { id: "basin-mixer-chrome", name: "Grifo monomando de lavabo cromado", specification: "Monomando; instalación sobre lavabo; acabado cromado", unit: "ud", unit_price: 65.0, provider_id: "roca", qtyFn: q => q.bathroomsCount, chapter: "sanitarios" },
  { id: "shower-tray-resin-120-80", name: "Plato de ducha de resina antideslizante 120x80 cm blanco", specification: "Resina; 120x80 cm; antideslizante; color blanco", unit: "ud", unit_price: 295.0, provider_id: "roca", qtyFn: q => q.bathroomsCount, chapter: "sanitarios" },
  { id: "shower-screen-sliding-120", name: "Mampara frontal corredera 120 cm vidrio transparente", specification: "Frontal; corredera; ancho 120 cm; vidrio transparente", unit: "ud", unit_price: 320.0, provider_id: "roca", qtyFn: q => q.bathroomsCount, chapter: "sanitarios" },
  { id: "shower-thermostatic-chrome", name: "Grifo termostático exterior de ducha cromado", specification: "Termostático; instalación vista/exterior; acabado cromado", unit: "ud", unit_price: 185.0, provider_id: "roca", qtyFn: q => q.bathroomsCount, chapter: "sanitarios" },

  // Carpintería: la hipótesis de mano se hace explícita y medible.
  { id: "door-block-white-725-left", name: "Puerta interior en block lacada blanca ciega 72.5 cm izquierda", specification: "Block completo; hoja ciega lacada blanca; ancho 72,5 cm; mano izquierda", unit: "ud", unit_price: 109.0, provider_id: "obramat", qtyFn: q => Math.ceil(q.doorsEstimated / 2), chapter: "carpinteria_interior" },
  { id: "door-block-white-725-right", name: "Puerta interior en block lacada blanca ciega 72.5 cm derecha", specification: "Block completo; hoja ciega lacada blanca; ancho 72,5 cm; mano derecha", unit: "ud", unit_price: 109.0, provider_id: "obramat", qtyFn: q => Math.floor(q.doorsEstimated / 2), chapter: "carpinteria_interior" },

  // Impermeabilización y sellado.
  { id: "waterproof-membrane-1-10", name: "Lámina impermeabilizante para zonas húmedas rollo 1x10 m", specification: "Rollo de 1x10 m; apta para zonas húmedas bajo revestimiento", unit: "rollos", unit_price: 42.0, provider_id: "obramat", qtyFn: q => Math.max(Math.ceil((q.wetWallArea * 0.4) / 10), 1), chapter: "impermeabilizacion" },
  { id: "sanitary-silicone-clear-300", name: "Silicona sanitaria transparente cartucho 300 ml", specification: "Uso sanitario; transparente; cartucho de 300 ml", unit: "ud", unit_price: 5.50, provider_id: "obramat", qtyFn: q => Math.max(q.bathroomsCount * 3, 4), chapter: "sanitarios" },

  // Los servicios se presupuestan por oferta local y no inflan la cobertura de productos.
  { id: "waste-container-service-6", name: "Servicio de contenedor de escombros 6 m3", specification: "Alquiler, transporte, retirada y tasa de gestor autorizado", procurementKind: "service", unit: "ud", unit_price: 290.0, provider_id: "proveedor-local", qtyFn: q => q.wasteContainersEstimated, chapter: "residuos" },
];

/**
 * Generate materials linked to scope quantities. Idempotent.
 * Always produces the same output for the same scope.
 */
export function buildScopeMaterials(scope: BudgetScope): EngineMaterial[] {
  const q = buildScopeQuantities(scope);
  const qualityMult = scope.calidad === "alta" ? 1.35 : scope.calidad === "basica" ? 0.75 : 1.0;
  const requestedChapters = getRequestedChapters(scope);

  return MATERIAL_SPECS
    .filter((spec) => !requestedChapters || requestedChapters.has(spec.chapter))
    .map((spec) => {
    const qty = spec.qtyFn(q);
    const adjustedPrice = Math.round(spec.unit_price * qualityMult * 100) / 100;
    return {
      id: `mat-${spec.id}`,
      name: spec.name,
      specification: spec.specification,
      procurementKind: spec.procurementKind || "product",
      quantity: qty,
      unit: spec.unit,
      unit_price: adjustedPrice,
      subtotal: Math.round(qty * adjustedPrice * 100) / 100,
      included: true,
      provider_id: spec.provider_id,
      linked_chapter: spec.chapter,
      isRealData: false,
      sourceType: "market_reference",
    };
    })
    .filter((material) => material.quantity > 0 && material.subtotal > 0);
}

/**
 * Replace the provisional material component of each chapter with the current
 * material basket. The basket is evidence for the chapter cost, not an extra
 * charge, so this prevents materials from being counted twice.
 */
export function applyMaterialBasketToItems(
  items: EnginePartida[],
  materials: EngineMaterial[],
  marginMultiplier: number,
): EnginePartida[] {
  const authoritativeSources = new Set([
    "user_catalog", "manual_locked", "private_tariff", "negotiated",
    "historical_approved", "preferred_supplier", "provider_updated",
    "n8n_market", "authorized_supplier", "web_search", "private_bc3",
    "technical_bank",
  ]);
  const basketByChapter = new Map<string, { total: number; verified: boolean }>();
  for (const material of materials) {
    if (!material.included) continue;
    const current = basketByChapter.get(material.linked_chapter);
    const isVerified = Boolean(
      material.isRealData || authoritativeSources.has(String(material.sourceType || "")),
    );
    basketByChapter.set(
      material.linked_chapter,
      {
        total: (current?.total || 0) + material.subtotal,
        verified: (current?.verified ?? true) && isVerified,
      },
    );
  }

  const itemIndexesByChapter = new Map<string, number[]>();
  items.forEach((item, index) => {
    if (authoritativeSources.has(String(item.price_source || ""))) return;
    if (!item.cost_breakdown || item.cost_breakdown.material_cost <= 0) return;
    const indexes = itemIndexesByChapter.get(item.chapter) || [];
    indexes.push(index);
    itemIndexesByChapter.set(item.chapter, indexes);
  });

  const result = items.map((item) => ({ ...item }));
  for (const [chapter, indexes] of itemIndexesByChapter) {
    const basket = basketByChapter.get(chapter);
    if (!(basket && basket.total > 0)) continue;
    const provisionalMaterialCost = indexes.reduce(
      (sum, index) => sum + (items[index].cost_breakdown?.material_cost || 0),
      0,
    );
    if (provisionalMaterialCost <= 0) continue;

    for (const index of indexes) {
      const item = items[index];
      const previousMaterialCost = item.cost_breakdown?.material_cost || 0;
      const share = previousMaterialCost / provisionalMaterialCost;
      const resolvedMaterialCost = basket.total * share;
      const subtotalCost = Math.max(
        item.subtotal_cost - previousMaterialCost + resolvedMaterialCost,
        0,
      );
      const unitPrice = subtotalCost / Math.max(item.quantity, 1);
      result[index] = {
        ...item,
        unit_price: Math.round(unitPrice * 100) / 100,
        subtotal_cost: Math.round(subtotalCost * 100) / 100,
        unit_price_client: Math.round(unitPrice * marginMultiplier * 100) / 100,
        subtotal_client: Math.round(subtotalCost * marginMultiplier * 100) / 100,
        cost_breakdown: item.cost_breakdown ? {
          ...item.cost_breakdown,
          material_cost: Math.round(resolvedMaterialCost * 100) / 100,
          pvp: Math.round(subtotalCost * marginMultiplier * 100) / 100,
          margin: Math.round(subtotalCost * (marginMultiplier - 1) * 100) / 100,
          source: basket.verified ? "tracker_material_basket" : "mixed_material_basket",
          price_type: basket.verified ? "real" : "market_ref",
        } : undefined,
      };
    }
  }

  return result;
}

// ─── E. Market Adjustment ───────────────────────────────────────────────────

export function getMarketRange(
  scope: BudgetScope,
  serviceType: string
): { min: number; max: number } {
  const st = serviceType.toLowerCase();
  const qualityMult = scope.calidad === "alta" ? 1.35 : scope.calidad === "basica" ? 0.80 : 1.0;
  const affectedArea = getAffectedArea(scope);

  let minPerM2 = 350;
  let maxPerM2 = 1000;

  const actionBands: Record<string, [number, number]> = {
    demoliciones: [35, 90],
    albanileria: [80, 220],
    electricidad: [80, 180],
    iluminacion: [25, 90],
    fontaneria: [70, 190],
    climatizacion: [70, 180],
    alicatados: [70, 180],
    pavimentos: [60, 180],
    pintura: [25, 70],
    carpinteria_interior: [70, 220],
    carpinteria_exterior: [120, 350],
    cocina_montaje: [120, 350],
    banos_sanitarios: [120, 350],
    limpieza_final: [8, 25],
    gestion_residuos: [15, 50],
  };
  const quantities = buildScopeQuantities(scope);
  const actionFixedRanges: Record<string, [number, number]> = {
    demoliciones: [900, 4200],
    albanileria: [1200, 6500],
    electricidad: [2600, 12000],
    iluminacion: [900, 5200],
    fontaneria: [1800, 8200],
    climatizacion: [1800, 9500],
    alicatados: [1400, 7200],
    pavimentos: [1500, 8500],
    pintura: [900, 5200],
    carpinteria_interior: [900, 6500],
    carpinteria_exterior: [1200, 9500],
    cocina_montaje: [4500, 18000],
    banos_sanitarios: [2800 * quantities.bathroomsCount, 8500 * quantities.bathroomsCount],
    limpieza_final: [350, 1800],
    gestion_residuos: [450, 2400],
  };

  const selectedActions = Array.from(new Set((scope.actuaciones || []).filter(Boolean)));
  let fixedMin = 0;
  let fixedMax = 0;
  if (selectedActions.length > 0) {
    const actionRange = selectedActions.reduce(
      (range, action) => {
        const band = actionBands[action] || [30, 100];
        return { min: range.min + band[0], max: range.max + band[1] };
      },
      { min: 0, max: 0 },
    );
    minPerM2 = Math.max(actionRange.min, 25);
    maxPerM2 = Math.max(actionRange.max, minPerM2 * 1.35);
    for (const action of selectedActions) {
      const fixed = actionFixedRanges[action] || [500, 3000];
      fixedMin += fixed[0];
      fixedMax += fixed[1];
    }
  } else if (st.includes("obra nueva")) {
    minPerM2 = 1300; maxPerM2 = 2600;
  } else if (st.includes("integral") || st.includes("completa") || st === "reforma") {
    minPerM2 = 750; maxPerM2 = 1600;
  } else if (st.includes("baño") || st.includes("cocina")) {
    minPerM2 = 850; maxPerM2 = 2200;
  } else if (st.includes("parcial") || st.includes("pintura")) {
    minPerM2 = 150; maxPerM2 = 650;
  }

  // A renovation is not a new build with a different label. Its range depends
  // on how much of the existing asset is retained and on its surveyed state.
  const projectContext = resolveProjectContext(serviceType, scope.project_context);
  if (projectContext !== "new_build") {
    const conservationMultiplier = scope.conservation_strategy === "preserve"
      ? 0.76
      : scope.conservation_strategy === "replace"
        ? 1.08
        : 0.92;
    const conditionMultiplier = scope.existing_condition === "good"
      ? 0.90
      : scope.existing_condition === "poor"
        ? 1.16
        : 1;
    const rehabilitationMultiplier = projectContext === "rehabilitation" ? 1.12 : 1;
    const occupancyMultiplier = scope.occupied_during_works ? 1.06 : 1;
    minPerM2 *= conservationMultiplier * conditionMultiplier * rehabilitationMultiplier * occupancyMultiplier;
    maxPerM2 *= conservationMultiplier * conditionMultiplier * rehabilitationMultiplier * occupancyMultiplier;
    fixedMin *= conservationMultiplier * conditionMultiplier * rehabilitationMultiplier * occupancyMultiplier;
    fixedMax *= conservationMultiplier * conditionMultiplier * rehabilitationMultiplier * occupancyMultiplier;
  }

  // Location adjustment
  const loc = (scope.ubicacion || "").toLowerCase();
  let locationMult = 1.0;
  if (/madrid|barcelona|baleares|pais vasco|bilbao|san sebastian|ibiza|mallorca/.test(loc)) {
    locationMult = 1.12;
  } else if (/valencia|alicante|malaga|sevilla|murcia|granada/.test(loc)) {
    locationMult = 1.0;
  } else if (/interior|rural|zamora|teruel|soria|caceres|badajoz/.test(loc)) {
    locationMult = 0.88;
  }

  minPerM2 = Math.round(minPerM2 * qualityMult * locationMult);
  maxPerM2 = Math.round(maxPerM2 * qualityMult * locationMult);

  const perAreaMin = minPerM2 * affectedArea;
  const perAreaMax = maxPerM2 * affectedArea;
  const adjustedFixedMin = fixedMin * qualityMult * locationMult;
  const adjustedFixedMax = fixedMax * qualityMult * locationMult;

  return {
    min: Math.round(Math.max(perAreaMin, adjustedFixedMin)),
    max: Math.round(Math.max(perAreaMax, adjustedFixedMax)),
  };
}

/**
 * Adjust budget to market range. Idempotent and safe against mixed states.
 *
 * Four guards make this function safe to call repeatedly:
 *
 *   GUARD A — SAFE AREA
 *     If scope.superficie_m2 is null/0/undefined/negative, returns input
 *     unchanged instead of dividing by zero.
 *
 *   GUARD B — FULL IDEMPOTENCY
 *     If EVERY item already carries market_adjustment.applied = true,
 *     the budget was already adjusted. Return totals without re-scaling.
 *
 *   GUARD C — MIXED STATE
 *     If SOME items are tagged and SOME are not (0 < adjustedCount < total),
 *     refuse to scale. Doing so would double-scale the tagged subset.
 *
 *   GUARD D — TRACEABILITY PRESERVATION
 *     cost_breakdown.source, confidence_score, price_type are NEVER mutated.
 *     EngineMaterial.sourceType is NEVER mutated.
 *     Numeric fields of cost_breakdown ARE scaled coherently.
 *
 * Items and included materials that get scaled receive market_adjustment
 * metadata. Non-included materials are returned as-is.
 *
 * Guarantee:
 *   adjustToMarket(adjustToMarket(x)) === adjustToMarket(x)
 */
export function adjustToMarket(
  scope: BudgetScope,
  items: EnginePartida[],
  materials: EngineMaterial[],
  serviceType: string,
  marginMultiplier: number,
  materialsIncludedInItems = false,
): MarketAdjustResult {
  // ─── GUARD A: SAFE AREA ──────────────────────────────────────────────
  const rawArea = getAffectedArea(scope);
  if (!rawArea || rawArea <= 0) {
    return {
      items,
      materials,
      adjusted: false,
      adjustmentType: "none",
      message: "Sin superficie fiable: no se aplica ajuste a mercado.",
      isUndervalued: false,
      pricePerM2: 0,
      marketFloor: 0,
      marketCeiling: 0,
    };
  }
  const area = rawArea;

  // getMarketRange returns ABSOLUTE TOTALS (€), not €/m².
  const range = getMarketRange(scope, serviceType);
  const marketFloor = range.min;
  const marketCeiling = range.max;
  const floorPerM2 = marketFloor / area;
  const ceilingPerM2 = marketCeiling / area;

  const computeCurrentPerM2 = () => {
    const itemsTotal = items.reduce((s, i) => s + i.subtotal_client, 0);
    const matsTotal = materialsIncludedInItems
      ? 0
      : materials.filter(m => m.included).reduce((s, m) => s + m.subtotal, 0);
    const total = itemsTotal + matsTotal * marginMultiplier;
    return total / area;
  };

  // ─── GUARDS B & C: IDEMPOTENCY + MIXED STATE ─────────────────────────
  const adjustedCount = items.filter(i => i.market_adjustment?.applied === true).length;
  const totalItems = items.length;

  // GUARD B — fully adjusted, return as-is (idempotent)
  if (totalItems > 0 && adjustedCount === totalItems) {
    const perM2 = computeCurrentPerM2();
    return {
      items,
      materials,
      adjusted: false,
      adjustmentType: "none",
      message: "Presupuesto ya ajustado a mercado previamente. No se re-escala.",
      isUndervalued: false,
      pricePerM2: Math.round(perM2),
      marketFloor: Math.round(floorPerM2),
      marketCeiling: Math.round(ceilingPerM2),
    };
  }

  // GUARD C — mixed state, refuse to scale
  if (adjustedCount > 0 && adjustedCount < totalItems) {
    const perM2 = computeCurrentPerM2();
    return {
      items,
      materials,
      adjusted: false,
      adjustmentType: "none",
      message: `Estado mixto de ajuste a mercado detectado (${adjustedCount}/${totalItems} items marcados). Recalcular desde presupuesto base para evitar doble escalado.`,
      isUndervalued: false,
      pricePerM2: Math.round(perM2),
      marketFloor: Math.round(floorPerM2),
      marketCeiling: Math.round(ceilingPerM2),
    };
  }

  // ─── Calculate current total ─────────────────────────────────────────
  const itemsTotal = items.reduce((s, i) => s + i.subtotal_client, 0);
  const matsTotal = materialsIncludedInItems
    ? 0
    : materials.filter(m => m.included).reduce((s, m) => s + m.subtotal, 0);
  const matsTotalWithMargin = matsTotal * marginMultiplier;
  const currentClientTotal = itemsTotal + matsTotalWithMargin;
  const currentPerM2 = currentClientTotal / area;

  if (currentPerM2 >= floorPerM2) {
    return {
      items,
      materials,
      adjusted: false,
      adjustmentType: "none",
      message: currentPerM2 > ceilingPerM2
        ? `Presupuesto por encima del rango de mercado (${Math.round(currentPerM2)} EUR/m2 vs ${Math.round(floorPerM2)}-${Math.round(ceilingPerM2)} EUR/m2).`
        : "",
      isUndervalued: false,
      pricePerM2: Math.round(currentPerM2),
      marketFloor: Math.round(floorPerM2),
      marketCeiling: Math.round(ceilingPerM2),
    };
  }

  // ─── Below floor → scale proportionally ──────────────────────────────
  const targetTotal = marketFloor;
  const authoritativeSources = new Set([
    "user_catalog", "manual_locked", "private_tariff", "negotiated",
    "historical_approved", "preferred_supplier", "provider_updated",
    "n8n_market", "authorized_supplier", "web_search", "private_bc3",
    "technical_bank",
  ]);
  const isAuthoritative = (source?: string) => authoritativeSources.has(String(source || ""));
  const scalableItemsTotal = items
    .filter((item) => !isAuthoritative(item.price_source))
    .reduce((sum, item) => sum + item.subtotal_client, 0);
  const scalableMaterialsTotal = materialsIncludedInItems ? 0 : materials
    .filter((material) => material.included && !material.isRealData && !isAuthoritative(material.sourceType))
    .reduce((sum, material) => sum + material.subtotal * marginMultiplier, 0);
  const scalableTotal = scalableItemsTotal + scalableMaterialsTotal;

  if (scalableTotal <= 0) {
    return {
      items,
      materials,
      adjusted: false,
      adjustmentType: "none",
      message: `El importe queda por debajo de la referencia (${Math.round(currentPerM2)} EUR/m2), pero no se alteran precios ya comprobados. Revisa cantidades o alcance.`,
      isUndervalued: true,
      pricePerM2: Math.round(currentPerM2),
      marketFloor: Math.round(floorPerM2),
      marketCeiling: Math.round(ceilingPerM2),
    };
  }

  const shortfall = Math.max(targetTotal - currentClientTotal, 0);
  const scaleFactor = 1 + shortfall / scalableTotal;
  const adjustedAt = new Date().toISOString();
  const reason = "Calibrado al umbral inferior de referencia";

  // Scale items and tag them
  const scaledItems = items.map(p => {
    if (isAuthoritative(p.price_source)) return p;
    const originalUnitPrice = p.unit_price;
    const newPrice = Math.round(originalUnitPrice * scaleFactor * 100) / 100;
    const newSubtotalCost = Math.round(p.quantity * newPrice * 100) / 100;
    const newUnitPriceClient = Math.round(newPrice * marginMultiplier * 100) / 100;
    const newSubtotalClient = Math.round(p.quantity * newPrice * marginMultiplier * 100) / 100;

    // Scale only the real numeric fields of CostBreakdown.
    // PRESERVED via spread: source, confidence_score, price_type.
    const newCostBreakdown: CostBreakdown | undefined = p.cost_breakdown
      ? {
          ...p.cost_breakdown,
          material_cost: Math.round(p.cost_breakdown.material_cost * scaleFactor * 100) / 100,
          labor_cost: Math.round(p.cost_breakdown.labor_cost * scaleFactor * 100) / 100,
          equipment_cost: Math.round(p.cost_breakdown.equipment_cost * scaleFactor * 100) / 100,
          waste_cost: Math.round(p.cost_breakdown.waste_cost * scaleFactor * 100) / 100,
          margin: Math.round(p.cost_breakdown.margin * scaleFactor * 100) / 100,
          pvp: Math.round(p.cost_breakdown.pvp * scaleFactor * 100) / 100,
        }
      : undefined;

    return {
      ...p,
      unit_price: newPrice,
      subtotal_cost: newSubtotalCost,
      unit_price_client: newUnitPriceClient,
      subtotal_client: newSubtotalClient,
      cost_breakdown: newCostBreakdown,
      market_adjustment: {
        applied: true,
        factor: scaleFactor,
        reason,
        original_unit_price: originalUnitPrice,
        adjusted_unit_price: newPrice,
        adjusted_at: adjustedAt,
      },
    };
  });

  // Scale included materials and tag them.
  // Non-included materials: returned as-is (not scaled, not tagged).
  // sourceType is preserved.
  const scaledMaterials = materials.map(m => {
    if (materialsIncludedInItems) return m;
    if (!m.included || m.isRealData || isAuthoritative(m.sourceType)) return m;

    const originalUnitPrice = m.unit_price;
    const newPrice = Math.round(originalUnitPrice * scaleFactor * 100) / 100;
    return {
      ...m,
      unit_price: newPrice,
      subtotal: Math.round(m.quantity * newPrice * 100) / 100,
      market_adjustment: {
        applied: true,
        factor: scaleFactor,
        reason,
        original_unit_price: originalUnitPrice,
        adjusted_unit_price: newPrice,
        adjusted_at: adjustedAt,
      },
    };
  });

  const newItemsTotal = scaledItems.reduce((s, i) => s + i.subtotal_client, 0);
  const newMatsTotal = materialsIncludedInItems
    ? 0
    : scaledMaterials.filter(m => m.included).reduce((s, m) => s + m.subtotal, 0);
  const newTotal = newItemsTotal + newMatsTotal * marginMultiplier;
  const newPerM2 = newTotal / area;

  return {
    items: scaledItems,
    materials: scaledMaterials,
    adjusted: true,
    adjustmentType: "both",
    message: `Estimación calibrada al umbral inferior de referencia (${Math.round(newPerM2)} EUR/m2). No equivale a una oferta cerrada: debe confirmarse con mediciones, estado existente y precios trazables.`,
    isUndervalued: false,
    pricePerM2: Math.round(newPerM2),
    marketFloor: Math.round(floorPerM2),
    marketCeiling: Math.round(ceilingPerM2),
  };
}

// ─── F. Realistic Timeline ──────────────────────────────────────────────────

export function estimateRealisticTimeline(
  scope: BudgetScope,
  items: EnginePartida[],
  supplyContext: TimelineSupplyContext = {},
): RealisticTimeline {
  const area = getAffectedArea(scope);
  const quantities = buildScopeQuantities({ ...scope, superficie_m2: area });
  const banos = quantities.bathroomsCount;
  const includedItems = items.filter((item) => item.status !== "opcional");
  const chapters = new Set(includedItems.map((item) => item.chapter));
  const phases: TimelinePhase[] = [];

  const hasAny = (...names: string[]) => names.some((name) => chapters.has(name));
  const addPhase = (
    title: string,
    durationMin: number,
    durationMax: number,
    description: string,
  ) => {
    const previous = phases[phases.length - 1]?.title;
    phases.push({
      title,
      duration_days_min: Math.max(1, Math.ceil(durationMin)),
      duration_days_max: Math.max(Math.ceil(durationMin), Math.ceil(durationMax)),
      description,
      ...(previous ? { depends_on: [previous] } : {}),
    });
  };

  const effortDays = (phaseChapters: string[], crewSize: number) => {
    const hours = includedItems
      .filter((item) => phaseChapters.includes(item.chapter))
      .reduce((sum, item) => sum + Math.max(Number(item.estimated_hours) || 0, 0), 0);
    if (hours <= 0) return { min: 0, max: 0 };
    return {
      min: Math.ceil(hours / (Math.max(crewSize, 1) * 8 * 0.9)),
      max: Math.ceil(hours / (Math.max(crewSize, 1) * 8 * 0.65)),
    };
  };

  const hasDemolition = hasAny("protecciones", "demoliciones");
  const hasExistingDiagnosis = chapters.has("diagnostico");
  const hasMasonry = hasAny("albanileria", "falsos_techos");
  const hasPlumbing = chapters.has("fontaneria");
  const hasElectrical = chapters.has("electricidad");
  const hasClima = chapters.has("climatizacion");
  const hasWetFinishes = hasAny("impermeabilizacion", "revestimientos", "pavimentos", "rodapie");
  const hasPainting = chapters.has("pintura");
  const hasInteriorCarpentry = chapters.has("carpinteria_interior");
  const hasExteriorCarpentry = chapters.has("carpinteria_exterior");
  const hasKitchen = chapters.has("cocina");
  const hasSanitary = chapters.has("sanitarios");
  const hasCleaning = chapters.has("limpieza");
  const hasWaste = chapters.has("residuos");

  if (hasExistingDiagnosis) {
    const conditionUnknown = !scope.existing_condition || scope.existing_condition === "unknown";
    addPhase(
      "Inspeccion, calas y validacion de preexistencias",
      conditionUnknown ? 3 : 2,
      conditionUnknown ? 7 : scope.existing_condition === "poor" ? 6 : 4,
      "Levantamiento del estado actual, calas no destructivas cuando proceda y validacion de los elementos que se conservan, reparan o sustituyen.",
    );
  }

  if (hasDemolition) {
    const effort = effortDays(["protecciones", "demoliciones"], 2);
    const demolitionArea = Math.max(quantities.demolitionArea, area * 0.25);
    addPhase(
      "Implantacion, protecciones y demoliciones",
      Math.max(4, Math.ceil(demolitionArea / 22), effort.min),
      Math.max(7, Math.ceil(demolitionArea / 12), effort.max),
      "Implantacion de obra, protecciones, desmontajes, demolicion selectiva y retirada progresiva de escombros.",
    );
  }

  if (hasMasonry) {
    const effort = effortDays(["albanileria", "falsos_techos"], 2);
    addPhase(
      "Replanteo y albanileria base",
      Math.max(4, Math.ceil(quantities.partitionArea / 10) + 2, effort.min),
      Math.max(7, Math.ceil(quantities.partitionArea / 6) + 3, effort.max),
      "Replanteo, nueva tabiqueria, regularizacion inicial y preparacion de pasos para instalaciones.",
    );
  }

  const installationTrades = [hasPlumbing, hasElectrical, hasClima].filter(Boolean).length;
  if (installationTrades > 0) {
    const crewSize = Math.min(Math.max(installationTrades * 2, 2), 5);
    const effort = effortDays(["fontaneria", "electricidad", "climatizacion"], crewSize);
    const installMin = installationTrades === 1
      ? Math.ceil(area / 45) + 2
      : installationTrades === 2
        ? Math.ceil(area / 35) + 4
        : Math.ceil(area / 28) + 5;
    const installMax = installationTrades === 1
      ? Math.ceil(area / 28) + 4
      : installationTrades === 2
        ? Math.ceil(area / 22) + 6
        : Math.ceil(area / 18) + 7;
    const extraWetRooms = hasPlumbing ? Math.max(banos - 1, 0) : 0;
    addPhase(
      "Instalaciones empotradas y coordinacion de gremios",
      Math.max(4, installMin + extraWetRooms, effort.min),
      Math.max(7, installMax + extraWetRooms * 2, effort.max),
      `Primera fase de ${[
        hasPlumbing ? "fontaneria" : "",
        hasElectrical ? "electricidad" : "",
        hasClima ? "climatizacion" : "",
      ].filter(Boolean).join(", ")}; incluye pruebas antes de cerrar rozas y falsos techos.`,
    );
  }

  if ((hasMasonry && (installationTrades > 0 || hasWetFinishes)) || (installationTrades > 0 && hasWetFinishes)) {
    addPhase(
      "Cierres, recrecidos, falsos techos y secados",
      Math.max(3, Math.ceil(area / 55) + 2),
      Math.max(6, Math.ceil(area / 30) + 4),
      "Cierre de rozas, ayudas de albanileria, recrecidos y tiempos tecnicos de curado y secado antes de revestir.",
    );
  }

  if (hasWetFinishes) {
    const finishArea =
      (chapters.has("pavimentos") ? quantities.pavementArea : 0) +
      (chapters.has("revestimientos") || chapters.has("impermeabilizacion") ? quantities.wetWallArea : 0);
    addPhase(
      "Impermeabilizacion, alicatados, solados y remates",
      Math.max(5, Math.ceil(Math.max(finishArea, 10) / 22) + 2),
      Math.max(9, Math.ceil(Math.max(finishArea, 10) / 13) + 4),
      "Preparacion de soportes, impermeabilizacion, colocacion, rejuntado, rodapie y curado de adhesivos.",
    );
  }

  if (hasPainting) {
    const effort = effortDays(["pintura"], 2);
    const paintArea = quantities.wallPaintArea + quantities.ceilingArea;
    addPhase(
      "Preparacion, pintura y tiempos entre manos",
      Math.max(4, Math.ceil(paintArea / 45) + 2, effort.min),
      Math.max(7, Math.ceil(paintArea / 28) + 4, effort.max),
      "Proteccion, reparacion y lijado, imprimacion, dos manos y secados entre aplicaciones.",
    );
  }

  const completionCandidatesMin: number[] = [];
  const completionCandidatesMax: number[] = [];
  const completionScopes: string[] = [];
  if (hasInteriorCarpentry) {
    completionCandidatesMin.push(Math.ceil(quantities.doorsEstimated / 3) + 1);
    completionCandidatesMax.push(Math.ceil(quantities.doorsEstimated / 2) + 2);
    completionScopes.push(`${quantities.doorsEstimated} puertas interiores`);
  }
  if (hasExteriorCarpentry) {
    completionCandidatesMin.push(Math.ceil(quantities.windowsCountEstimated / 3) + 1);
    completionCandidatesMax.push(Math.ceil(quantities.windowsCountEstimated / 2) + 2);
    completionScopes.push(`${quantities.windowsCountEstimated} ventanas`);
  }
  if (hasKitchen) {
    completionCandidatesMin.push(5);
    completionCandidatesMax.push(9);
    completionScopes.push("mobiliario y encimera de cocina");
  }
  if (hasSanitary) {
    completionCandidatesMin.push(2 + banos * 2);
    completionCandidatesMax.push(4 + banos * 2);
    completionScopes.push(`aparatos de ${banos} bano(s)`);
  }
  if (hasElectrical) {
    completionCandidatesMin.push(2);
    completionCandidatesMax.push(4);
    completionScopes.push("mecanismos y comprobaciones electricas");
  }
  if (hasClima) {
    completionCandidatesMin.push(4);
    completionCandidatesMax.push(7);
    completionScopes.push("equipos y puesta en marcha de climatizacion");
  }

  if (completionCandidatesMin.length > 0) {
    const workstreams = completionCandidatesMin.length;
    const coordinationMin = Math.min(Math.max(workstreams - 1, 0), 3) + (phases.length >= 5 ? Math.ceil(area / 80) : 0);
    const coordinationMax = Math.min(Math.max((workstreams - 1) * 2, 0), 8);
    addPhase(
      "Carpinterias, equipamiento y terminaciones",
      Math.max(...completionCandidatesMin) + coordinationMin,
      Math.max(...completionCandidatesMax) + coordinationMax,
      `Montaje y ajuste de ${completionScopes.join(", ")}. Los gremios se solapan solo en zonas compatibles.`,
    );
  }

  if (hasCleaning || phases.length >= 4) {
    addPhase(
      "Pruebas, repasos, limpieza y entrega",
      Math.max(2, Math.ceil(area / 100) + 1),
      Math.max(4, Math.ceil(area / 60) + 3),
      "Pruebas finales, correccion de incidencias, limpieza fina y entrega documentada.",
    );
  } else if (hasWaste && !hasDemolition) {
    addPhase(
      "Gestion y retirada de residuos",
      1,
      Math.max(2, Math.ceil(area / 80)),
      "Carga, retirada, tasas y entrega a gestor autorizado.",
    );
  }

  if (phases.length === 0) {
    addPhase(
      "Ejecucion del alcance seleccionado",
      Math.max(2, Math.ceil(area / 40)),
      Math.max(4, Math.ceil(area / 25)),
      "Planificacion provisional pendiente de completar las partidas del presupuesto.",
    );
  }

  // The phases above already group tasks that can genuinely run in parallel.
  // Therefore there is no blanket overlap discount. The upper duration uses a
  // likely adverse percentile instead of adding every worst case at once.
  const rawMinDays = phases.reduce((sum, phase) => sum + phase.duration_days_min, 0);
  const rawMaxDays = phases.reduce((sum, phase) => sum + phase.duration_days_max, 0);
  const complexProject = phases.length >= 5 || chapters.size >= 8;
  const coordinationMinFactor = complexProject ? 1.08 : phases.length >= 3 ? 1.03 : 1;
  const coordinationMaxFactor = complexProject ? 1.10 : phases.length >= 3 ? 1.05 : 1;
  const executionDaysMin = Math.max(1, Math.ceil(rawMinDays * coordinationMinFactor));
  const likelyAdverseDays = rawMinDays + (rawMaxDays - rawMinDays) * 0.72;
  const executionDaysMax = Math.max(
    executionDaysMin + 2,
    Math.ceil(likelyAdverseDays * coordinationMaxFactor),
  );
  const executionWeeksMin = Math.ceil(executionDaysMin / 5);
  const executionWeeksMax = Math.ceil(executionDaysMax / 5);

  // Preparation and supply lead times are a separate critical path. For a
  // comprehensive project part of it can overlap demolition and rough works;
  // for a single long-lead trade (windows/kitchen) it cannot be hidden.
  let preparationDaysMin = complexProject ? 15 : 3;
  let preparationDaysMax = complexProject ? 30 : 7;
  if (hasDemolition || hasMasonry) {
    preparationDaysMin = Math.max(preparationDaysMin, 5);
    preparationDaysMax = Math.max(preparationDaysMax, 15);
  }
  if (hasKitchen) {
    preparationDaysMin = Math.max(preparationDaysMin, 15);
    preparationDaysMax = Math.max(preparationDaysMax, 30);
  }
  if (hasClima) {
    preparationDaysMin = Math.max(preparationDaysMin, 10);
    preparationDaysMax = Math.max(preparationDaysMax, 20);
  }
  if (hasExteriorCarpentry) {
    preparationDaysMin = Math.max(preparationDaysMin, 25);
    preparationDaysMax = Math.max(preparationDaysMax, 45);
  }

  const totalMaterials = Math.max(0, Math.floor(Number(supplyContext.total_materials) || 0));
  const verifiedMaterials = Math.min(
    totalMaterials,
    Math.max(0, Math.floor(Number(supplyContext.verified_materials) || 0)),
  );
  const pendingMaterials = Math.max(totalMaterials - verifiedMaterials, 0);
  const supplyReadinessPercent = totalMaterials > 0
    ? Math.round((verifiedMaterials / totalMaterials) * 100)
    : 100;
  const maxDeliveryDays = Math.max(0, Math.ceil(Number(supplyContext.max_delivery_days) || 0));
  const unavailableMaterials = Math.max(0, Math.floor(Number(supplyContext.unavailable_materials) || 0));
  const unknownDeliveryMaterials = Math.max(0, Math.floor(Number(supplyContext.unknown_delivery_materials) || 0));

  if (maxDeliveryDays > 0) {
    preparationDaysMin = Math.max(preparationDaysMin, Math.ceil(maxDeliveryDays * 0.7));
    preparationDaysMax = Math.max(preparationDaysMax, maxDeliveryDays);
  }
  if (pendingMaterials > 0) {
    // Only the adverse end grows: pending equivalences are uncertainty, not
    // work that should be silently added to the optimistic commitment.
    preparationDaysMax += Math.min(12, Math.ceil(pendingMaterials / 3) * 2);
  }
  if (unavailableMaterials > 0) {
    preparationDaysMax += Math.min(15, unavailableMaterials * 3);
  }
  const preparationWeeksMin = Math.ceil(preparationDaysMin / 5);
  const preparationWeeksMax = Math.ceil(preparationDaysMax / 5);
  const canOverlapSupplies = phases.length >= 4;
  const nonOverlappingPreparationMin = canOverlapSupplies
    ? Math.max(1, Math.ceil(preparationWeeksMin * 0.35))
    : preparationWeeksMin;
  const nonOverlappingPreparationMax = canOverlapSupplies
    ? Math.max(1, Math.ceil(preparationWeeksMax * 0.55))
    : preparationWeeksMax;
  const contingencyMin = executionWeeksMin >= 10 ? 1 : 0;
  const contingencyMax = executionWeeksMax >= 10
    ? Math.max(2, Math.ceil(executionWeeksMax * 0.10))
    : 1;
  const totalWeeksMin = executionWeeksMin + nonOverlappingPreparationMin + contingencyMin;
  const totalWeeksMax = executionWeeksMax + nonOverlappingPreparationMax + contingencyMax;

  const confidencePenalty =
    Math.round((100 - supplyReadinessPercent) * 0.32) +
    Math.min(15, unknownDeliveryMaterials * 2) +
    Math.min(20, unavailableMaterials * 5);
  const confidencePercent = Math.max(35, Math.min(95, 94 - confidencePenalty));
  const uncertaintyLevel: RealisticTimeline["uncertainty_level"] =
    confidencePercent >= 82 ? "baja" : confidencePercent >= 65 ? "media" : "alta";
  const scheduleRisks: string[] = [];
  const optimizationActions: string[] = [];
  if (pendingMaterials > 0) {
    scheduleRisks.push(`${pendingMaterials} materiales aún no tienen equivalencia comercial confirmada.`);
    optimizationActions.push(`Cerrar las ${pendingMaterials} referencias pendientes antes de fijar la fecha contractual.`);
  }
  if (unknownDeliveryMaterials > 0) {
    scheduleRisks.push(`${unknownDeliveryMaterials} materiales no tienen plazo de entrega confirmado.`);
    optimizationActions.push("Confirmar stock y entrega de la ruta crítica en una única ronda de compras.");
  }
  if (unavailableMaterials > 0) {
    scheduleRisks.push(`${unavailableMaterials} materiales seleccionados figuran sin disponibilidad.`);
    optimizationActions.push("Sustituir inmediatamente las referencias sin stock por alternativas equivalentes trazables.");
  }
  if (hasKitchen || hasExteriorCarpentry) {
    optimizationActions.push("Medir y encargar los elementos fabricados a medida antes de iniciar demoliciones.");
  }
  if (phases.length >= 4) {
    optimizationActions.push("Reservar gremios por fase y validar semanalmente la ruta crítica para evitar esperas entre oficios.");
  }
  if (optimizationActions.length === 0) {
    optimizationActions.push("Confirmar materiales y cuadrilla antes del inicio para mantener el plazo calculado.");
  }

  const assumptions: string[] = [
    "Calendario calculado por ruta critica; los solapes solo se aplican entre gremios y zonas compatibles.",
    "Jornadas de 8 horas, 5 dias por semana, con cuadrillas especializadas de 1-2 operarios por gremio.",
    `Alcance considerado: ${Math.round(area)} m2 y ${banos} bano(s).`,
    `Preparacion, validacion tecnica y aprovisionamiento: ${preparationWeeksMin}-${preparationWeeksMax} semanas; parte puede solaparse con la ejecucion.`,
    `Cobertura comercial de materiales: ${supplyReadinessPercent}%; confianza del plazo: ${confidencePercent}%.`,
    "El plazo total incluye coordinacion, secados, suministros habituales y una contingencia de obra razonable.",
    "No incluye paralizaciones extraordinarias, amianto, vicios ocultos ni cambios de alcance posteriores.",
  ];
  if (hasKitchen) assumptions.push("La cocina requiere medicion definitiva antes de fabricar mobiliario y encimera.");
  if (hasExteriorCarpentry) assumptions.push("Las ventanas se consideran fabricadas a medida y condicionadas por su plazo de suministro.");
  if (hasDemolition || hasExteriorCarpentry) assumptions.push("Licencias y permisos municipales deben confirmarse antes de comprometer la fecha de inicio.");

  return {
    preparation_weeks_min: preparationWeeksMin,
    preparation_weeks_max: preparationWeeksMax,
    execution_working_days_min: executionDaysMin,
    execution_working_days_max: executionDaysMax,
    execution_weeks_min: executionWeeksMin,
    execution_weeks_max: executionWeeksMax,
    total_weeks_min: totalWeeksMin,
    total_weeks_max: totalWeeksMax,
    phase_breakdown: phases,
    critical_path: phases.map((phase) => phase.title),
    assumptions,
    supply_readiness_percent: supplyReadinessPercent,
    confidence_percent: confidencePercent,
    uncertainty_level: uncertaintyLevel,
    schedule_risks: scheduleRisks,
    optimization_actions: optimizationActions,
  };
}

// ─── G. Climatización System Inference ─────────────────────────────────────

export type ClimaSystem =
  | "conductos"
  | "multisplit"
  | "splits_individuales"
  | "preinstalacion";

export interface ClimaSystemSpec {
  system: ClimaSystem;
  label: string;
  description: string;
  unitsNeeded: number;
  assumptions: string[];
  frigorias_estimated: number;
}

/**
 * Infer the most appropriate HVAC system based on scope.
 * Never returns ambiguous "splits o conductos".
 */
export function inferClimaSystem(scope: BudgetScope): ClimaSystemSpec {
  const area = scope.superficie_m2;
  const rooms = scope.estancias?.length || Math.ceil(area / 15);
  // ~100 frigorias/m2 baseline, adjust by location
  const loc = (scope.ubicacion || "").toLowerCase();
  let frigMultiplier = 1.0;
  if (/alicante|murcia|sevilla|cordoba|huelva|almeria|badajoz|malaga/.test(loc)) {
    frigMultiplier = 1.15; // hotter zones
  } else if (/bilbao|asturias|cantabria|galicia|leon/.test(loc)) {
    frigMultiplier = 0.85; // milder zones
  }
  const frigorias = Math.round(area * 100 * frigMultiplier);

  // Decision logic
  if (area >= 120 && scope.calidad !== "basica") {
    // Large homes: conductos if quality allows
    return {
      system: "conductos",
      label: "Sistema por conductos",
      description: `Instalacion de sistema centralizado por conductos con maquina en falso techo. ${Math.ceil(area / 20)} rejillas de impulsion y ${Math.ceil(area / 40)} de retorno.`,
      unitsNeeded: 1, // 1 central unit
      assumptions: [
        `Superficie: ${area} m2, requiere sistema centralizado`,
        `Potencia estimada: ${frigorias} frigorias (${Math.round(frigorias / 860)} kW)`,
        "Requiere falso techo con espacio para conductos (min 25cm)",
        `${Math.ceil(area / 20)} bocas de impulsion, ${Math.ceil(area / 40)} de retorno`,
        "Incluye termostato centralizado con zonificacion basica",
      ],
      frigorias_estimated: frigorias,
    };
  }

  if (rooms >= 4 && area >= 80) {
    // Multi-room: multisplit
    const innerUnits = Math.min(rooms, 5);
    return {
      system: "multisplit",
      label: "Sistema multisplit",
      description: `Instalacion de sistema multisplit: 1 unidad exterior + ${innerUnits} unidades interiores (split pared). Tuberia frigorifica preinstalada.`,
      unitsNeeded: innerUnits,
      assumptions: [
        `Superficie: ${area} m2, ${rooms} estancias climatizables`,
        `Potencia estimada: ${frigorias} frigorias (${Math.round(frigorias / 860)} kW)`,
        `1 unidad exterior + ${innerUnits} unidades interiores`,
        "Tuberia frigorifica de cobre preaislada por falso techo/rozas",
        "Desagues por gravedad a bajante mas cercano",
      ],
      frigorias_estimated: frigorias,
    };
  }

  if (area >= 40) {
    // Small/medium: splits individuales
    const splits = Math.max(Math.ceil(area / 25), 2);
    return {
      system: "splits_individuales",
      label: "Splits individuales",
      description: `Instalacion de ${splits} equipos split de pared independientes con unidades exteriores individuales.`,
      unitsNeeded: splits,
      assumptions: [
        `Superficie: ${area} m2`,
        `Potencia estimada: ${frigorias} frigorias (${Math.round(frigorias / 860)} kW)`,
        `${splits} equipos split independientes (1x1)`,
        "Cada equipo con su unidad exterior",
        "Instalacion electrica independiente por equipo",
      ],
      frigorias_estimated: frigorias,
    };
  }

  // Very small or basic: preinstalacion only
  return {
    system: "preinstalacion",
    label: "Preinstalacion de climatizacion",
    description: "Preinstalacion de tuberia frigorifica, desague y alimentacion electrica para futura instalacion de equipo split.",
    unitsNeeded: Math.max(Math.ceil(area / 30), 1),
    assumptions: [
      `Superficie: ${area} m2`,
      "Solo preinstalacion (tuberia, desague, linea electrica)",
      "No incluye equipos de climatizacion",
      "Preparado para instalacion posterior de split individual",
    ],
    frigorias_estimated: frigorias,
  };
}

// ─── H. Technical Breakdown per Chapter ─────────────────────────────────────

export interface TechnicalDetail {
  task: string;
  description: string;
  unit: string;
  estimated_qty: number;
}

export interface ChapterTechnicalBreakdown {
  chapter: string;
  chapterLabel: string;
  assumptions: string[];
  includedTasks: TechnicalDetail[];
}

export const CHAPTER_LABELS: Record<string, string> = {
  protecciones: "Protecciones y forrados",
  demoliciones: "Demoliciones y retiradas",
  albanileria: "Albanileria y tabiqueria",
  falsos_techos: "Falsos techos",
  fontaneria: "Fontaneria y saneamiento",
  electricidad: "Electricidad",
  impermeabilizacion: "Impermeabilizacion",
  revestimientos: "Revestimientos ceramicos",
  pavimentos: "Pavimentos",
  rodapie: "Rodapie",
  pintura: "Pintura y acabados de pared",
  carpinteria_interior: "Carpinteria interior",
  carpinteria_exterior: "Carpinteria exterior",
  sanitarios: "Sanitarios y griferia",
  cocina: "Cocina",
  climatizacion: "Climatizacion",
  residuos: "Gestion de residuos",
  seguridad: "Seguridad y salud",
  limpieza: "Limpieza final de obra",
  otros: "Otros",
};

/**
 * Build technical breakdown for a specific chapter.
 * Returns detailed assumptions and included sub-tasks.
 */
export function buildChapterTechnicalBreakdown(
  chapter: string,
  scope: BudgetScope,
  q: ScopeQuantities
): ChapterTechnicalBreakdown {
  const label = CHAPTER_LABELS[chapter] || chapter;

  switch (chapter) {
    case "demoliciones":
      return {
        chapter, chapterLabel: label,
        assumptions: [
          `Superficie a demoler: ${q.demolitionArea} m2 (85% de ${q.floorArea} m2)`,
          "Incluye pavimento existente, revestimientos de pared y falso techo",
          "Demolicion selectiva conservando estructura portante",
          `Estimacion de ${q.wasteContainersEstimated} contenedores de escombro`,
        ],
        includedTasks: [
          { task: "Levantado de pavimento existente", description: "Picado y retirada de pavimento ceramico/terrazo incluido mortero de agarre", unit: "m2", estimated_qty: q.demolitionArea },
          { task: "Picado de alicatados", description: "Retirada de alicatado en zonas humedas hasta soporte", unit: "m2", estimated_qty: q.wetWallArea },
          { task: "Demolicion de tabiqueria", description: "Demolicion de tabiques divisorios no estructurales", unit: "m2", estimated_qty: Math.round(q.partitionArea * 0.6) },
          { task: "Desmontaje de falso techo", description: "Retirada de falso techo existente de escayola/pladur", unit: "m2", estimated_qty: q.ceilingArea },
          { task: "Retirada de sanitarios existentes", description: `Desmontaje y retirada de aparatos sanitarios (${q.bathroomsCount} bano/s)`, unit: "ud", estimated_qty: q.bathroomsCount * 3 },
          { task: "Carga y retirada de escombros", description: "Carga mecanica a contenedor y transporte a vertedero", unit: "ud", estimated_qty: q.wasteContainersEstimated },
        ],
      };

    case "electricidad":
      return {
        chapter, chapterLabel: label,
        assumptions: [
          `Puntos electricos estimados: ${q.electricalPointsEstimated} (0.7 puntos/m2)`,
          "Instalacion completa con cuadro general de proteccion segun REBT",
          "Cableado empotrado en rozas o por falso techo",
          "Incluye toma de tierra y protecciones diferenciales",
        ],
        includedTasks: [
          { task: "Cuadro general de proteccion", description: "Suministro e instalacion de cuadro con magnetotermicos, diferenciales y protecciones segun REBT", unit: "ud", estimated_qty: 1 },
          { task: "Cableado general", description: "Tendido de lineas H07V-K de distintas secciones empotradas en tubo corrugado", unit: "ml", estimated_qty: Math.round(q.electricalPointsEstimated * 8) },
          { task: "Puntos de luz", description: "Punto de luz sencillo con mecanismo incluido", unit: "ud", estimated_qty: Math.round(q.electricalPointsEstimated * 0.4) },
          { task: "Bases de enchufe", description: "Base de enchufe schuko 16A empotrada con mecanismo", unit: "ud", estimated_qty: Math.round(q.electricalPointsEstimated * 0.5) },
          { task: "Puntos especiales", description: "Tomas para cocina (horno, vitro, lavavajillas), banos (secador, espejo), lavadero", unit: "ud", estimated_qty: Math.round(q.electricalPointsEstimated * 0.1) },
          { task: "Toma de tierra", description: "Revision y adecuacion de toma de tierra existente", unit: "ud", estimated_qty: 1 },
        ],
      };

    case "climatizacion": {
      const clima = inferClimaSystem(scope);
      return {
        chapter, chapterLabel: label,
        assumptions: clima.assumptions,
        includedTasks: clima.system === "conductos" ? [
          { task: "Unidad exterior", description: "Suministro e instalacion de maquina exterior tipo bomba de calor inverter", unit: "ud", estimated_qty: 1 },
          { task: "Unidad interior de conductos", description: "Maquina interior para falso techo con plenum de impulsion", unit: "ud", estimated_qty: 1 },
          { task: "Red de conductos", description: "Conducto de fibra/chapa aislada desde maquina a rejillas de impulsion", unit: "ml", estimated_qty: Math.round(q.floorArea * 0.4) },
          { task: "Rejillas de impulsion", description: "Rejillas de impulsion de aluminio regulables en falso techo", unit: "ud", estimated_qty: Math.ceil(q.floorArea / 20) },
          { task: "Rejillas de retorno", description: "Rejillas de retorno en zonas comunes", unit: "ud", estimated_qty: Math.ceil(q.floorArea / 40) },
          { task: "Termostato de control", description: "Termostato digital con zonificacion basica", unit: "ud", estimated_qty: 1 },
        ] : clima.system === "multisplit" ? [
          { task: "Unidad exterior multisplit", description: `Maquina exterior multisplit inverter para ${clima.unitsNeeded} unidades interiores`, unit: "ud", estimated_qty: 1 },
          { task: "Unidades interiores split pared", description: "Split de pared con control remoto individual", unit: "ud", estimated_qty: clima.unitsNeeded },
          { task: "Tuberia frigorifica", description: "Tuberia de cobre preaislada desde exterior a cada interior", unit: "ml", estimated_qty: Math.round(clima.unitsNeeded * 8) },
          { task: "Desagues", description: "Linea de desague por gravedad de cada unidad a bajante", unit: "ud", estimated_qty: clima.unitsNeeded },
          { task: "Linea electrica", description: "Alimentacion electrica desde cuadro a unidad exterior", unit: "ml", estimated_qty: 15 },
        ] : clima.system === "splits_individuales" ? [
          { task: "Equipos split 1x1", description: "Suministro e instalacion de equipo split individual (interior + exterior)", unit: "ud", estimated_qty: clima.unitsNeeded },
          { task: "Tuberia frigorifica", description: "Conexion frigorifica interior-exterior por equipo", unit: "ml", estimated_qty: Math.round(clima.unitsNeeded * 5) },
          { task: "Desagues individuales", description: "Linea de desague por equipo a bajante o fachada", unit: "ud", estimated_qty: clima.unitsNeeded },
          { task: "Alimentacion electrica", description: "Linea electrica independiente por equipo desde cuadro", unit: "ud", estimated_qty: clima.unitsNeeded },
        ] : [
          // preinstalacion
          { task: "Preinstalacion frigorifica", description: "Tuberia de cobre preaislada empotrada desde interior a exterior", unit: "ud", estimated_qty: clima.unitsNeeded },
          { task: "Preinstalacion desague", description: "Tuberia de desague desde ubicacion interior a bajante", unit: "ud", estimated_qty: clima.unitsNeeded },
          { task: "Preinstalacion electrica", description: "Linea electrica desde cuadro hasta ubicacion de equipo", unit: "ud", estimated_qty: clima.unitsNeeded },
        ],
      };
    }

    case "fontaneria":
      return {
        chapter, chapterLabel: label,
        assumptions: [
          `${q.bathroomsCount} bano(s) completo(s)${q.kitchenIncluded ? " + cocina" : ""}`,
          "Tuberia multicapa para agua fria y caliente",
          "PVC para evacuacion",
          "Llaves de corte individuales por aparato",
        ],
        includedTasks: [
          { task: "Acometida y llave general", description: "Revision de acometida existente y sustitucion de llave general de corte", unit: "ud", estimated_qty: 1 },
          { task: "Red de agua fria", description: "Distribucion en tuberia multicapa desde llave general a todos los puntos de consumo", unit: "ud", estimated_qty: q.bathroomsCount + (q.kitchenIncluded ? 1 : 0) },
          { task: "Red de agua caliente", description: "Circuito de agua caliente desde calentador/caldera a puntos de consumo", unit: "ud", estimated_qty: q.bathroomsCount + (q.kitchenIncluded ? 1 : 0) },
          { task: "Red de evacuacion", description: `Desagues en PVC 40-110mm con sifones y bajantes (${q.bathroomsCount} banos)`, unit: "ud", estimated_qty: q.bathroomsCount + (q.kitchenIncluded ? 1 : 0) },
          { task: "Llaves de corte", description: "Llaves de escuadra cromadas en cada punto de consumo", unit: "ud", estimated_qty: (q.bathroomsCount * 4) + (q.kitchenIncluded ? 2 : 0) },
          ...(q.kitchenIncluded ? [{ task: "Tomas de cocina", description: "Tomas de fregadero, lavavajillas y lavadora (si aplica)", unit: "ud", estimated_qty: 3 }] : []),
        ],
      };

    case "sanitarios":
      return {
        chapter, chapterLabel: label,
        assumptions: [
          `${q.bathroomsCount} bano(s) completo(s)`,
          `Calidad ${scope.calidad}: gama ${scope.calidad === "alta" ? "alta (Roca Inspira, Grohe, Hansgrohe)" : scope.calidad === "basica" ? "economica (Roca Victoria, griferia basica)" : "media (Roca, griferia monomando estandar)"}`,
          "Incluye aparatos, griferia, accesorios y conexion a instalaciones",
        ],
        includedTasks: [
          { task: "Inodoro", description: scope.calidad === "alta" ? "Inodoro suspendido rimless con cisterna empotrada Geberit" : "Inodoro compacto con salida dual", unit: "ud", estimated_qty: q.bathroomsCount },
          { task: "Lavabo", description: scope.calidad === "alta" ? "Lavabo sobre encimera de diseno con mueble suspendido" : "Lavabo sobre encimera con mueble y monomando", unit: "ud", estimated_qty: q.bathroomsCount },
          { task: "Plato de ducha", description: "Plato de ducha extraplano de resina con textura antideslizante", unit: "ud", estimated_qty: q.bathroomsCount },
          { task: "Mampara de ducha", description: scope.calidad === "alta" ? "Mampara fija de cristal templado 8mm con herrajes ocultos" : "Mampara frontal de cristal templado 6mm", unit: "ud", estimated_qty: q.bathroomsCount },
          { task: "Griferia", description: scope.calidad === "alta" ? "Griferia premium empotrada (lavabo + ducha tipo lluvia)" : "Griferia monomando para lavabo y ducha", unit: "ud", estimated_qty: q.bathroomsCount * 2 },
          { task: "Accesorios de bano", description: "Juego de accesorios (portarrollos, toallero, espejo)", unit: "ud", estimated_qty: q.bathroomsCount },
        ],
      };

    case "cocina":
      return {
        chapter, chapterLabel: label,
        assumptions: [
          `Cocina estimada: ${Math.min(Math.max(q.floorArea * 0.08, 6), 14)} m2 aprox.`,
          `Calidad ${scope.calidad}`,
          scope.calidad === "alta" ? "Muebles lacados, encimera Silestone/Dekton, electrodomesticos gama alta" :
          scope.calidad === "basica" ? "Muebles melamina, encimera laminada, electrodomesticos basicos" :
          "Muebles lacados/estratificados, encimera cuarzo, electrodomesticos gama media",
        ],
        includedTasks: [
          { task: "Muebles bajos", description: "Modulos bajos con cajones, herrajes de cierre amortiguado", unit: "ml", estimated_qty: Math.round(Math.min(Math.max(q.floorArea * 0.08, 6), 14) * 0.7) },
          { task: "Muebles altos", description: "Modulos altos con puertas abatibles", unit: "ml", estimated_qty: Math.round(Math.min(Math.max(q.floorArea * 0.08, 6), 14) * 0.5) },
          { task: "Encimera", description: scope.calidad === "alta" ? "Encimera Silestone/Dekton con faldones" : "Encimera postformada o de cuarzo compacto", unit: "ml", estimated_qty: Math.round(Math.min(Math.max(q.floorArea * 0.08, 6), 14) * 0.7) },
          { task: "Fregadero y griferia", description: "Fregadero de acero inoxidable/bajo encimera y griferia extraible", unit: "ud", estimated_qty: 1 },
          { task: "Zocalo y remates", description: "Zocalo inferior, cornisa superior y remates de acabado", unit: "ml", estimated_qty: Math.round(Math.min(Math.max(q.floorArea * 0.08, 6), 14) * 0.7) },
        ],
      };

    case "pavimentos":
      return {
        chapter, chapterLabel: label,
        assumptions: [
          `Superficie a pavimentar: ${q.pavementArea} m2`,
          `Calidad ${scope.calidad}: ${scope.calidad === "alta" ? "porcelanico rectificado gran formato" : scope.calidad === "basica" ? "ceramico/laminado estandar" : "porcelanico 60x60 estandar"}`,
          "Incluye material + colocacion + borada",
        ],
        includedTasks: [
          { task: "Nivelacion del soporte", description: "Regularizacion del soporte con mortero autonivelante donde sea necesario", unit: "m2", estimated_qty: Math.round(q.pavementArea * 0.3) },
          { task: "Pavimento general", description: `Suministro y colocacion de pavimento ${scope.calidad === "alta" ? "porcelanico rectificado" : "ceramico/laminado"} en toda la vivienda`, unit: "m2", estimated_qty: q.pavementArea },
          { task: "Borada / Rejuntado", description: "Rejuntado con mortero de juntas del color elegido", unit: "m2", estimated_qty: q.pavementArea },
        ],
      };

    case "pintura":
      return {
        chapter, chapterLabel: label,
        assumptions: [
          `Paredes: ${q.wallPaintArea} m2, Techos: ${q.ceilingArea} m2`,
          "Dos manos de pintura plastica lisa lavable",
          "Preparacion de superficie: plastecido, lijado e imprimacion",
        ],
        includedTasks: [
          { task: "Preparacion de paredes", description: "Plastecido de imperfecciones, lijado y aplicacion de imprimacion fijadora", unit: "m2", estimated_qty: q.wallPaintArea },
          { task: "Pintura de paredes", description: "Aplicacion de dos manos de pintura plastica lisa lavable en paredes", unit: "m2", estimated_qty: q.wallPaintArea },
          { task: "Pintura de techos", description: "Aplicacion de dos manos de pintura plastica blanca mate en techos", unit: "m2", estimated_qty: q.ceilingArea },
        ],
      };

    case "carpinteria_interior":
      return {
        chapter, chapterLabel: label,
        assumptions: [
          `Puertas estimadas: ${q.doorsEstimated} uds`,
          `Calidad ${scope.calidad}: ${scope.calidad === "alta" ? "macizas lacadas premium o de roble" : scope.calidad === "basica" ? "huecas lisas en melamina" : "ciega lacada blanca con herrajes calidad media"}`,
        ],
        includedTasks: [
          { task: "Puertas de paso", description: `Suministro y colocacion de puerta de paso ${scope.calidad === "alta" ? "maciza lacada" : "ciega lacada"} con premarco, tapajuntas y herrajes`, unit: "ud", estimated_qty: q.doorsEstimated },
          { task: "Armarios empotrados (si procede)", description: "Frentes de armario abatibles o correderas lacados, con interiores de melamina", unit: "ud", estimated_qty: 0 },
        ],
      };

    case "carpinteria_exterior":
      return {
        chapter, chapterLabel: label,
        assumptions: [
          `Ventanas estimadas: ${q.windowsCountEstimated} uds`,
          `Calidad ${scope.calidad}: ${scope.calidad === "alta" ? "aluminio RPT premium o PVC alta gama, doble/triple acristalamiento bajo emisivo" : scope.calidad === "basica" ? "aluminio sin RPT, doble acristalamiento estandar" : "aluminio RPT, doble acristalamiento 4/16/4"}`,
          "Puede requerir licencia municipal de obras",
        ],
        includedTasks: [
          { task: "Ventanas", description: `Suministro y colocacion de ventana de aluminio ${scope.calidad === "alta" ? "RPT premium" : "RPT"} con doble acristalamiento`, unit: "ud", estimated_qty: q.windowsCountEstimated },
          { task: "Persianas/estores (si aplica)", description: "Sustitucion de persiana enrollable monoblock si se cambia el hueco completo", unit: "ud", estimated_qty: q.windowsCountEstimated },
        ],
      };

    default:
      return {
        chapter, chapterLabel: label,
        assumptions: [],
        includedTasks: [],
      };
  }
}

// ─── I. Client View (for PDF Cliente) ───────────────────────────────────────

export interface ClientViewChapter {
  chapter: string;
  chapterLabel: string;
  title: string;
  clientDescription: string;
  includedTasks: string[];
  quantity: number;
  unit: string;
  unitPrice: number;
  subtotal: number;
  technicalAssumptions: string[];
}

export interface BudgetClientView {
  chapters: ClientViewChapter[];
  subtotal: number;
  ivaPct: number;
  ivaAmount: number;
  total: number;
  qualityLabel: string;
  climaSpec?: ClimaSystemSpec;
}

/**
 * Build the client-facing view: grouped by chapters, no internal escandallo.
 * Each chapter shows: title, description, included tasks (as text), price.
 * Materials are NOT separate line items — they're PART of the chapter cost.
 */
export function buildClientView(
  scope: BudgetScope,
  items: EnginePartida[],
  ivaPct: number
): BudgetClientView {
  const q = buildScopeQuantities(scope);
  const climaSpec = scope.incluye_climatizacion ? inferClimaSystem(scope) : undefined;

  // Group items by chapter
  const chapterGroups = new Map<string, EnginePartida[]>();
  for (const item of items) {
    const ch = item.chapter || "otros";
    if (!chapterGroups.has(ch)) chapterGroups.set(ch, []);
    chapterGroups.get(ch)!.push(item);
  }

  // Define display order
  const chapterOrder = [
    "protecciones", "demoliciones", "albanileria", "falsos_techos",
    "fontaneria", "electricidad", "impermeabilizacion",
    "revestimientos", "pavimentos", "rodapie", "pintura",
    "carpinteria_interior", "carpinteria_exterior",
    "sanitarios", "cocina", "climatizacion",
    "residuos", "seguridad", "limpieza", "otros",
  ];

  const chapters: ClientViewChapter[] = [];

  for (const ch of chapterOrder) {
    const group = chapterGroups.get(ch);
    if (!group || group.length === 0) continue;

    const technical = buildChapterTechnicalBreakdown(ch, scope, q);

    // Aggregate all items in this chapter
    const chapterSubtotal = group.reduce((s, i) => s + i.subtotal_client, 0);
    const mainItem = group[0];

    // Build client-facing description
    let clientDesc = technical.includedTasks.length > 0
      ? technical.assumptions[0] || mainItem.description
      : mainItem.description;

    // Override climatizacion description with specific system
    if (ch === "climatizacion" && climaSpec) {
      clientDesc = climaSpec.description;
    }

    const includedTaskTexts = technical.includedTasks.length > 0
      ? technical.includedTasks.map(t => t.task)
      : group.map(i => i.concept);

    // For chapters with multiple items, sum them up as one chapter entry
    const primaryQty = mainItem.quantity;
    const primaryUnit = mainItem.unit;

    chapters.push({
      chapter: ch,
      chapterLabel: CHAPTER_LABELS[ch] || ch,
      title: group.length === 1 ? mainItem.concept : (CHAPTER_LABELS[ch] || ch),
      clientDescription: clientDesc,
      includedTasks: includedTaskTexts,
      quantity: primaryQty,
      unit: primaryUnit,
      unitPrice: chapterSubtotal / Math.max(primaryQty, 1),
      subtotal: Math.round(chapterSubtotal * 100) / 100,
      technicalAssumptions: technical.assumptions,
    });
  }

  const subtotal = chapters.reduce((s, c) => s + c.subtotal, 0);
  const ivaAmount = Math.round(subtotal * (ivaPct / 100) * 100) / 100;
  const total = Math.round((subtotal + ivaAmount) * 100) / 100;

  const qualityLabels: Record<string, string> = {
    basica: "Gama basica / economica",
    media: "Gama media / estandar",
    alta: "Gama alta / premium",
  };

  return {
    chapters,
    subtotal: Math.round(subtotal * 100) / 100,
    ivaPct,
    ivaAmount,
    total,
    qualityLabel: qualityLabels[scope.calidad] || "Gama media",
    climaSpec,
  };
}

// ─── J. Internal View (for PDF Interno) ─────────────────────────────────────

export interface InternalMaterialLine {
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  subtotal: number;
  qualityTier: string;
  sourceType: string;
  supplier: string;
  confidenceScore: number;
}

export interface InternalItemLine {
  concept: string;
  description: string;
  quantity: number;
  unit: string;
  baseUnitPrice: number;
  geographicFactor: number;
  unitCost: number;
  subtotalCost: number;
  clientPrice: number;
  margin: number;
  estimatedHours: number | null;
}

export interface InternalViewChapter {
  chapter: string;
  chapterLabel: string;
  // Cost breakdown
  laborCost: number;
  materialCost: number;
  equipmentCost: number;
  wasteCost: number;
  directCost: number;
  // Client pricing
  clientPrice: number;
  margin: number;
  marginPct: number;
  // Details
  items: InternalItemLine[];
  materials: InternalMaterialLine[];
  sourceTypes: string[];
  avgConfidence: number;
  qualityTier: string;
}

export interface BudgetInternalView {
  chapters: InternalViewChapter[];
  totals: {
    directCost: number;
    materialsCost: number;
    laborCost: number;
    equipmentCost: number;
    wasteCost: number;
    clientSubtotal: number;
    totalMargin: number;
    totalMarginPct: number;
    ivaPct: number;
    ivaAmount: number;
    clientTotal: number;
  };
  avgConfidence: number;
  qualityTier: string;
  climaSpec?: ClimaSystemSpec;
}

/**
 * Build the internal view: full escandallo with costs, margins, materials, sources.
 * Materials are linked to their chapter and shown with price source and confidence.
 */
export function buildInternalView(
  scope: BudgetScope,
  items: EnginePartida[],
  materials: EngineMaterial[],
  ivaPct: number,
  _resolvedPrices?: Array<{
    materialName: string;
    normalizedName: string;
    selectedPrice: number;
    qualityTier: string;
    sourceType: string;
    selectedSupplier: string;
    confidenceScore: number;
  }>
): BudgetInternalView {
  const climaSpec = scope.incluye_climatizacion ? inferClimaSystem(scope) : undefined;

  // Group items and materials by chapter
  const chapterGroups = new Map<string, EnginePartida[]>();
  const materialsByChapter = new Map<string, EngineMaterial[]>();

  for (const item of items) {
    const ch = item.chapter || "otros";
    if (!chapterGroups.has(ch)) chapterGroups.set(ch, []);
    chapterGroups.get(ch)!.push(item);
  }
  for (const mat of materials) {
    const ch = mat.linked_chapter || "otros";
    if (!materialsByChapter.has(ch)) materialsByChapter.set(ch, []);
    materialsByChapter.get(ch)!.push(mat);
  }

  const chapterOrder = [
    "protecciones", "demoliciones", "albanileria", "falsos_techos",
    "fontaneria", "electricidad", "impermeabilizacion",
    "revestimientos", "pavimentos", "rodapie", "pintura",
    "carpinteria_interior", "carpinteria_exterior",
    "sanitarios", "cocina", "climatizacion",
    "residuos", "seguridad", "limpieza", "otros",
  ];

  const internalChapters: InternalViewChapter[] = [];

  for (const ch of chapterOrder) {
    const group = chapterGroups.get(ch);
    if (!group || group.length === 0) continue;

    const chMaterials = materialsByChapter.get(ch) || [];

    // Sum costs from items' breakdowns
    let laborCost = 0, materialCost = 0, equipmentCost = 0, wasteCost = 0;
    const sourceTypes = new Set<string>();
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const item of group) {
      if (item.cost_breakdown) {
        laborCost += item.cost_breakdown.labor_cost;
        materialCost += item.cost_breakdown.material_cost;
        equipmentCost += item.cost_breakdown.equipment_cost;
        wasteCost += item.cost_breakdown.waste_cost;
        sourceTypes.add(item.cost_breakdown.source);
        confidenceSum += item.cost_breakdown.confidence_score;
        confidenceCount++;
      } else {
        // Fallback: all cost is from subtotal_cost
        laborCost += item.subtotal_cost * 0.5;
        materialCost += item.subtotal_cost * 0.4;
        equipmentCost += item.subtotal_cost * 0.05;
        wasteCost += item.subtotal_cost * 0.05;
        sourceTypes.add("engine_estimate");
        confidenceSum += 50;
        confidenceCount++;
      }
    }

    const directCost = laborCost + materialCost + equipmentCost + wasteCost;
    const clientPrice = group.reduce((s, i) => s + i.subtotal_client, 0);
    const margin = clientPrice - directCost;
    const marginPct = directCost > 0 ? (margin / directCost) * 100 : 0;

    // Build material lines with resolved price info if available
    const materialLines: InternalMaterialLine[] = chMaterials.map(mat => {
      // Try to find resolved price for this material
      const matNameLower = mat.name.toLowerCase();
      const resolved = _resolvedPrices?.find(rp => {
        const rpNameLower = rp.materialName.toLowerCase();
        return rpNameLower.includes(matNameLower.slice(0, 15)) ||
               matNameLower.includes(rpNameLower.slice(0, 15));
      });

      return {
        name: mat.name,
        quantity: mat.quantity,
        unit: mat.unit,
        unitPrice: resolved?.selectedPrice || mat.unit_price,
        subtotal: resolved ? resolved.selectedPrice * mat.quantity : mat.subtotal,
        qualityTier: resolved?.qualityTier || scope.calidad,
        sourceType: resolved?.sourceType || mat.sourceType,
        supplier: resolved?.selectedSupplier || mat.provider_id,
        confidenceScore: resolved?.confidenceScore || (mat.isRealData ? 0.80 : 0.40),
      };
    });

    const itemLines: InternalItemLine[] = group.map((item) => ({
      concept: item.concept,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      baseUnitPrice: item.base_unit_price ?? item.unit_price,
      geographicFactor: item.geographic_factor ?? 1,
      unitCost: item.unit_price,
      subtotalCost: item.subtotal_cost,
      clientPrice: item.subtotal_client,
      margin: item.subtotal_client - item.subtotal_cost,
      estimatedHours: item.estimated_hours ?? null,
    }));

    const avgConf = confidenceCount > 0 ? Math.round(confidenceSum / confidenceCount) : 50;

    internalChapters.push({
      chapter: ch,
      chapterLabel: CHAPTER_LABELS[ch] || ch,
      laborCost: Math.round(laborCost * 100) / 100,
      materialCost: Math.round(materialCost * 100) / 100,
      equipmentCost: Math.round(equipmentCost * 100) / 100,
      wasteCost: Math.round(wasteCost * 100) / 100,
      directCost: Math.round(directCost * 100) / 100,
      clientPrice: Math.round(clientPrice * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      marginPct: Math.round(marginPct * 10) / 10,
      items: itemLines,
      materials: materialLines,
      sourceTypes: Array.from(sourceTypes),
      avgConfidence: avgConf,
      qualityTier: scope.calidad,
    });
  }

  // Totals
  const totalDirectCost = internalChapters.reduce((s, c) => s + c.directCost, 0);
  const totalMaterials = internalChapters.reduce((s, c) => s + c.materialCost, 0);
  const totalLabor = internalChapters.reduce((s, c) => s + c.laborCost, 0);
  const totalEquipment = internalChapters.reduce((s, c) => s + c.equipmentCost, 0);
  const totalWaste = internalChapters.reduce((s, c) => s + c.wasteCost, 0);
  const totalClient = internalChapters.reduce((s, c) => s + c.clientPrice, 0);
  const totalMargin = totalClient - totalDirectCost;
  const totalMarginPct = totalDirectCost > 0 ? (totalMargin / totalDirectCost) * 100 : 0;

  const ivaAmount = Math.round(totalClient * (ivaPct / 100) * 100) / 100;

  const allConfidences = internalChapters
    .filter(c => c.avgConfidence > 0)
    .map(c => c.avgConfidence);
  const avgConf = allConfidences.length > 0
    ? Math.round(allConfidences.reduce((s, c) => s + c, 0) / allConfidences.length)
    : 50;

  return {
    chapters: internalChapters,
    totals: {
      directCost: Math.round(totalDirectCost * 100) / 100,
      materialsCost: Math.round(totalMaterials * 100) / 100,
      laborCost: Math.round(totalLabor * 100) / 100,
      equipmentCost: Math.round(totalEquipment * 100) / 100,
      wasteCost: Math.round(totalWaste * 100) / 100,
      clientSubtotal: Math.round(totalClient * 100) / 100,
      totalMargin: Math.round(totalMargin * 100) / 100,
      totalMarginPct: Math.round(totalMarginPct * 10) / 10,
      ivaPct,
      ivaAmount,
      clientTotal: Math.round((totalClient + ivaAmount) * 100) / 100,
    },
    avgConfidence: avgConf,
    qualityTier: scope.calidad,
    climaSpec,
  };
}
