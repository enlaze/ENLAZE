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
  execution_weeks_min: number;
  execution_weeks_max: number;
  total_weeks_min: number;
  total_weeks_max: number;
  phase_breakdown: TimelinePhase[];
  critical_path: string[];
  assumptions: string[];
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
}

export interface EngineMaterial {
  id: string;
  name: string;
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

// ─── A. Scope Quantities ────────────────────────────────────────────────────

export function buildScopeQuantities(scope: BudgetScope): ScopeQuantities {
  const area = Math.max(scope.superficie_m2 || 60, 20);
  const banos = Math.max(scope.num_banos || 1, 1);
  const avgBathroomM2 = 5;
  const avgKitchenM2 = Math.min(Math.max(area * 0.08, 6), 14);

  // Wet areas: bathrooms + kitchen if included
  const wetFloorArea = banos * avgBathroomM2 + (scope.incluye_cocina ? avgKitchenM2 : 0);
  // Wall height ~2.5m, perimeter approx = 4 * sqrt(area)
  const perimeter = 4 * Math.sqrt(area);
  const wallHeight = 2.5;
  const totalWallArea = perimeter * wallHeight;
  // Wet walls: ~3x floor area of wet zones (3 walls of ~wallHeight)
  const wetWallArea = wetFloorArea * 3;

  return {
    floorArea: area,
    demolitionArea: Math.round(area * 0.85),
    pavementArea: area,
    ceilingArea: area,
    wallPaintArea: Math.round(totalWallArea - wetWallArea),
    wetWallArea: Math.round(wetWallArea),
    bathroomsCount: banos,
    kitchenIncluded: scope.incluye_cocina,
    windowsCountEstimated: scope.incluye_ventanas ? Math.max(Math.ceil(area / 15), 3) : 0,
    electricalPointsEstimated: Math.round(area * 0.7),
    wasteContainersEstimated: Math.max(Math.ceil(area / 30), 2),
    baseboardMlEstimated: Math.round(perimeter * 0.85),
    doorsEstimated: Math.max(Math.ceil(area / 14), 3),
    partitionArea: Math.round(area * 0.4),
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

  // 1. Assign chapter to each item
  const tagged = items.map(item => ({
    ...item,
    chapter: item.chapter || detectChapter(item.concept, item.description),
  }));

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
      if (concept.includes("alisado") || concept.includes("prepar")) {
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
      const concept = item.concept.toLowerCase();
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

  // Always required for integral reform
  add("protecciones", "Proteccion de zonas comunes y ascensor",
    "Forrado de ascensor, pasillos y elementos comunes con carton ondulado y plastico.",
    1, "PA", Math.max(q.floorArea * 1.5, 150), "otros");

  add("demoliciones", "Demoliciones y retirada",
    "Demolicion de revestimientos, tabiques y pavimentos existentes.",
    q.demolitionArea, "m2", 15, "mano_obra");

  add("albanileria", "Formacion de tabiqueria",
    "Suministro e instalacion de nueva tabiqueria interior (Pladur/Ladrillo).",
    q.partitionArea, "m2", 38, "mano_obra");

  add("falsos_techos", "Falsos techos continuos",
    "Formacion de falso techo de placa de yeso laminado.",
    q.ceilingArea, "m2", 28, "mano_obra");

  add("fontaneria", `Instalacion de fontaneria (${q.bathroomsCount} bano${q.bathroomsCount > 1 ? "s" : ""} + ${q.kitchenIncluded ? "cocina" : "sin cocina"})`,
    `Red de agua fria, caliente y desagues para ${q.bathroomsCount} bano(s)${q.kitchenIncluded ? " y cocina" : ""}.`,
    1, "PA", (q.bathroomsCount * 950) + (q.kitchenIncluded ? 650 : 0), "mano_obra");

  add("electricidad", "Instalacion electrica completa",
    `Cuadro general, ${q.electricalPointsEstimated} puntos de luz/enchufes, mecanismos y protecciones.`,
    q.electricalPointsEstimated, "ud", 42, "mano_obra");

  add("impermeabilizacion", "Impermeabilizacion zonas humedas",
    "Lamina impermeabilizante en banos y cocina.",
    Math.round(q.wetWallArea * 0.4), "m2", 22, "material");

  add("revestimientos", "Alicatado de zonas humedas",
    "Colocacion de revestimiento ceramico en paredes de banos y cocina.",
    q.wetWallArea, "m2", 38, "mano_obra");

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

  add("sanitarios", `Sanitarios y griferia (${q.bathroomsCount} bano${q.bathroomsCount > 1 ? "s" : ""})`,
    `Suministro e instalacion de inodoro, lavabo, plato de ducha y griferia para ${q.bathroomsCount} bano(s).`,
    q.bathroomsCount, "lote", 1800, "material");

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

interface MaterialSpec {
  name: string;
  unit: string;
  unit_price: number;
  provider_id: string;
  qtyFn: (q: ScopeQuantities) => number;
  chapter: string;
}

const MATERIAL_SPECS: MaterialSpec[] = [
  // Albanileria
  { name: "Mortero de cemento M-7.5 (saco 25kg)", unit: "sacos", unit_price: 3.50, provider_id: "leroy-merlin", qtyFn: q => Math.ceil(q.partitionArea / 3), chapter: "albanileria" },
  { name: "Placa de yeso laminado 13mm (Pladur N)", unit: "ud", unit_price: 5.80, provider_id: "leroy-merlin", qtyFn: q => Math.ceil(q.partitionArea * 1.1), chapter: "albanileria" },
  { name: "Perfil metalico para Pladur (montante 48mm)", unit: "ud", unit_price: 3.20, provider_id: "obramat", qtyFn: q => Math.ceil(q.partitionArea * 0.8), chapter: "albanileria" },
  // Fontaneria
  { name: "Tuberia multicapa 16mm (rollo 50m)", unit: "rollos", unit_price: 42.0, provider_id: "saltoki", qtyFn: q => Math.ceil((q.bathroomsCount + (q.kitchenIncluded ? 1 : 0)) * 1.2), chapter: "fontaneria" },
  { name: "Tuberia PVC evacuacion 110mm (3m)", unit: "ud", unit_price: 8.50, provider_id: "saltoki", qtyFn: q => Math.ceil(q.bathroomsCount * 3 + (q.kitchenIncluded ? 2 : 0)), chapter: "fontaneria" },
  // Electricidad
  { name: "Cable H07V-K 2.5mm2 (rollo 100m)", unit: "rollos", unit_price: 32.0, provider_id: "leroy-merlin", qtyFn: q => Math.ceil(q.electricalPointsEstimated / 30), chapter: "electricidad" },
  { name: "Cuadro electrico + protecciones", unit: "ud", unit_price: 220.0, provider_id: "saltoki", qtyFn: () => 1, chapter: "electricidad" },
  { name: "Mecanismos electricos (enchufes + interruptores)", unit: "ud", unit_price: 8.50, provider_id: "leroy-merlin", qtyFn: q => q.electricalPointsEstimated, chapter: "electricidad" },
  // Revestimientos / Pavimentos
  { name: "Azulejo porcelanico 60x60cm", unit: "m2", unit_price: 18.50, provider_id: "leroy-merlin", qtyFn: q => Math.ceil(q.wetWallArea * 1.1), chapter: "revestimientos" },
  { name: "Cemento cola porcelanico flexible (saco 25kg)", unit: "sacos", unit_price: 12.0, provider_id: "obramat", qtyFn: q => Math.ceil((q.wetWallArea + q.pavementArea) / 5), chapter: "revestimientos" },
  { name: "Pavimento ceramico/laminado", unit: "m2", unit_price: 22.0, provider_id: "leroy-merlin", qtyFn: q => Math.ceil(q.pavementArea * 1.1), chapter: "pavimentos" },
  { name: "Rodapie a juego", unit: "ml", unit_price: 4.50, provider_id: "leroy-merlin", qtyFn: q => Math.ceil(q.baseboardMlEstimated * 1.05), chapter: "rodapie" },
  // Pintura
  { name: "Pintura plastica blanca mate (cubo 15L)", unit: "cubos", unit_price: 35.0, provider_id: "leroy-merlin", qtyFn: q => Math.ceil((q.wallPaintArea + q.ceilingArea) / 80), chapter: "pintura" },
  { name: "Imprimacion fijadora (cubo 15L)", unit: "cubos", unit_price: 28.0, provider_id: "leroy-merlin", qtyFn: q => Math.ceil((q.wallPaintArea + q.ceilingArea) / 120), chapter: "pintura" },
  // Sanitarios
  { name: "Inodoro compacto salida dual", unit: "ud", unit_price: 155.0, provider_id: "leroy-merlin", qtyFn: q => q.bathroomsCount, chapter: "sanitarios" },
  { name: "Lavabo sobre encimera + monomando", unit: "ud", unit_price: 130.0, provider_id: "leroy-merlin", qtyFn: q => q.bathroomsCount, chapter: "sanitarios" },
  { name: "Plato de ducha resina antideslizante", unit: "ud", unit_price: 195.0, provider_id: "obramat", qtyFn: q => q.bathroomsCount, chapter: "sanitarios" },
  { name: "Mampara de ducha frontal", unit: "ud", unit_price: 220.0, provider_id: "leroy-merlin", qtyFn: q => q.bathroomsCount, chapter: "sanitarios" },
  { name: "Griferia monomando (lavabo + ducha)", unit: "ud", unit_price: 85.0, provider_id: "leroy-merlin", qtyFn: q => q.bathroomsCount * 2, chapter: "sanitarios" },
  // Carpinteria
  { name: "Puerta interior ciega lacada blanca", unit: "ud", unit_price: 155.0, provider_id: "leroy-merlin", qtyFn: q => q.doorsEstimated, chapter: "carpinteria_interior" },
  // Impermeabilizacion
  { name: "Lamina impermeabilizante zonas humedas (rollo 20m2)", unit: "rollos", unit_price: 42.0, provider_id: "obramat", qtyFn: q => Math.max(Math.ceil(q.wetWallArea * 0.4 / 20), 1), chapter: "impermeabilizacion" },
  // Auxiliares
  { name: "Silicona neutra sanitaria (cartucho 300ml)", unit: "ud", unit_price: 5.50, provider_id: "leroy-merlin", qtyFn: q => Math.max(q.bathroomsCount * 3, 4), chapter: "sanitarios" },
  { name: "Contenedor de escombros 6m3 (alquiler+transporte)", unit: "ud", unit_price: 290.0, provider_id: "referencia-mercado", qtyFn: q => q.wasteContainersEstimated, chapter: "residuos" },
];

/**
 * Generate materials linked to scope quantities. Idempotent.
 * Always produces the same output for the same scope.
 */
export function buildScopeMaterials(scope: BudgetScope): EngineMaterial[] {
  const q = buildScopeQuantities(scope);
  const qualityMult = scope.calidad === "alta" ? 1.35 : scope.calidad === "basica" ? 0.75 : 1.0;

  return MATERIAL_SPECS.map((spec, idx) => {
    const qty = spec.qtyFn(q);
    const adjustedPrice = Math.round(spec.unit_price * qualityMult * 100) / 100;
    return {
      id: `mat-${idx}`,
      name: spec.name,
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
  });
}

// ─── E. Market Adjustment ───────────────────────────────────────────────────

export function getMarketRange(
  scope: BudgetScope,
  serviceType: string
): { min: number; max: number } {
  const st = serviceType.toLowerCase();
  const qualityMult = scope.calidad === "alta" ? 1.35 : scope.calidad === "basica" ? 0.75 : 1.0;

  let minPerM2 = 400;
  let maxPerM2 = 900;

  if (st.includes("integral") || st.includes("completa")) {
    minPerM2 = 500; maxPerM2 = 1200;
  } else if (st.includes("baño") || st.includes("cocina")) {
    minPerM2 = 600; maxPerM2 = 1500;
  } else if (st.includes("parcial") || st.includes("pintura")) {
    minPerM2 = 100; maxPerM2 = 400;
  }

  // Location adjustment
  const loc = (scope.ubicacion || "").toLowerCase();
  let locationMult = 1.0;
  if (/madrid|barcelona|baleares|pais vasco|bilbao|san sebastian|ibiza|mallorca/.test(loc)) {
    locationMult = 1.18;
  } else if (/valencia|alicante|malaga|sevilla|murcia|granada/.test(loc)) {
    locationMult = 1.0;
  } else if (/interior|rural|zamora|teruel|soria|caceres|badajoz/.test(loc)) {
    locationMult = 0.88;
  }

  minPerM2 = Math.round(minPerM2 * qualityMult * locationMult);
  maxPerM2 = Math.round(maxPerM2 * qualityMult * locationMult);

  return {
    min: minPerM2 * scope.superficie_m2,
    max: maxPerM2 * scope.superficie_m2,
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
  marginMultiplier: number
): MarketAdjustResult {
  // ─── GUARD A: SAFE AREA ──────────────────────────────────────────────
  const rawArea = scope.superficie_m2;
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
    const matsTotal = materials.filter(m => m.included).reduce((s, m) => s + m.subtotal, 0);
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
  const matsTotal = materials.filter(m => m.included).reduce((s, m) => s + m.subtotal, 0);
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
  const scaleFactor = targetTotal / (currentClientTotal || 1);
  const adjustedAt = new Date().toISOString();
  const reason = "Ajustado al mínimo realista de mercado";

  // Scale items and tag them
  const scaledItems = items.map(p => {
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
    if (!m.included) return m;

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
  const newMatsTotal = scaledMaterials.filter(m => m.included).reduce((s, m) => s + m.subtotal, 0);
  const newTotal = newItemsTotal + newMatsTotal * marginMultiplier;
  const newPerM2 = newTotal / area;

  return {
    items: scaledItems,
    materials: scaledMaterials,
    adjusted: true,
    adjustmentType: "both",
    message: `Presupuesto ajustado al mínimo realista de mercado (${Math.round(newPerM2)} EUR/m2). Se corrigieron cantidades, se completaron capítulos faltantes y se ajustaron precios unitarios.`,
    isUndervalued: false,
    pricePerM2: Math.round(newPerM2),
    marketFloor: Math.round(floorPerM2),
    marketCeiling: Math.round(ceilingPerM2),
  };
}

// ─── F. Realistic Timeline ──────────────────────────────────────────────────

export function estimateRealisticTimeline(
  scope: BudgetScope,
  items: EnginePartida[]
): RealisticTimeline {
  const area = scope.superficie_m2;
  const banos = scope.num_banos;
  const chapters = new Set(items.map(i => i.chapter));

  const phases: TimelinePhase[] = [];
  const criticalPath: string[] = [];

  // Phase 1: Protections + Demolitions (parallel start)
  if (chapters.has("protecciones") || chapters.has("demoliciones")) {
    const demoMin = Math.max(Math.ceil(area / 40), 3);
    const demoMax = Math.max(Math.ceil(area / 25), 5);
    phases.push({
      title: "Protecciones y demoliciones",
      duration_days_min: demoMin,
      duration_days_max: demoMax,
      description: "Proteccion de zonas comunes, demolicion de tabiques, pavimentos y revestimientos.",
    });
    criticalPath.push("Protecciones y demoliciones");
  }

  // Phase 2: Rough installations (plumbing + electrical) — partially parallel
  if (chapters.has("fontaneria") || chapters.has("electricidad")) {
    const instMin = Math.max(5, Math.ceil(area / 30));
    const instMax = Math.max(8, Math.ceil(area / 20));
    phases.push({
      title: "Instalaciones (fontaneria y electricidad)",
      duration_days_min: instMin + (banos > 1 ? (banos - 1) * 2 : 0),
      duration_days_max: instMax + (banos > 1 ? (banos - 1) * 3 : 0),
      description: `Primera fijacion de fontaneria (${banos} banos${scope.incluye_cocina ? " + cocina" : ""}), cableado electrico y cuadro.`,
      depends_on: ["Protecciones y demoliciones"],
    });
    criticalPath.push("Instalaciones (fontaneria y electricidad)");
  }

  // Phase 3: Masonry + ceilings
  if (chapters.has("albanileria") || chapters.has("falsos_techos")) {
    const masonMin = Math.max(4, Math.ceil(area / 35));
    const masonMax = Math.max(7, Math.ceil(area / 22));
    phases.push({
      title: "Albanileria y falsos techos",
      duration_days_min: masonMin,
      duration_days_max: masonMax,
      description: "Levantado de tabiqueria, formacion de falsos techos, ayudas de albanileria.",
      depends_on: ["Instalaciones (fontaneria y electricidad)"],
    });
    criticalPath.push("Albanileria y falsos techos");
  }

  // Phase 4: Waterproofing + tiling
  if (chapters.has("impermeabilizacion") || chapters.has("revestimientos") || chapters.has("pavimentos")) {
    const tileMin = Math.max(5, Math.ceil(area / 20));
    const tileMax = Math.max(10, Math.ceil(area / 12));
    phases.push({
      title: "Impermeabilizacion, alicatados y solados",
      duration_days_min: tileMin,
      duration_days_max: tileMax,
      description: "Impermeabilizacion de zonas humedas, alicatado, solado y rodapie.",
      depends_on: ["Albanileria y falsos techos"],
    });
    criticalPath.push("Impermeabilizacion, alicatados y solados");
  }

  // Phase 5: Painting
  if (chapters.has("pintura")) {
    const paintMin = Math.max(3, Math.ceil(area / 40));
    const paintMax = Math.max(5, Math.ceil(area / 25));
    phases.push({
      title: "Pintura y acabados",
      duration_days_min: paintMin,
      duration_days_max: paintMax,
      description: "Preparacion de superficies, alisado y dos manos de pintura.",
      depends_on: ["Impermeabilizacion, alicatados y solados"],
    });
    criticalPath.push("Pintura y acabados");
  }

  // Phase 6: Carpentry (can overlap with painting)
  if (chapters.has("carpinteria_interior") || chapters.has("carpinteria_exterior")) {
    phases.push({
      title: "Carpinteria interior y exterior",
      duration_days_min: 3,
      duration_days_max: Math.max(5, Math.ceil(area / 40)),
      description: `Instalacion de ${Math.ceil(area / 14)} puertas${scope.incluye_ventanas ? ` y ${Math.ceil(area / 15)} ventanas` : ""}.`,
      depends_on: ["Pintura y acabados"],
    });
  }

  // Phase 7: Fixtures (sanitarios, cocina, mecanismos)
  if (chapters.has("sanitarios") || chapters.has("cocina")) {
    const fixMin = 3 + (scope.incluye_cocina ? 3 : 0) + (banos > 1 ? 2 : 0);
    const fixMax = 5 + (scope.incluye_cocina ? 5 : 0) + (banos > 1 ? 3 : 0);
    phases.push({
      title: "Aparatos sanitarios, cocina y mecanismos",
      duration_days_min: fixMin,
      duration_days_max: fixMax,
      description: `Montaje de sanitarios (${banos} banos)${scope.incluye_cocina ? ", muebles y encimera de cocina" : ""}, mecanismos electricos.`,
      depends_on: ["Carpinteria interior y exterior"],
    });
    criticalPath.push("Aparatos sanitarios, cocina y mecanismos");
  }

  // Phase 8: AC
  if (scope.incluye_climatizacion && chapters.has("climatizacion")) {
    phases.push({
      title: "Climatizacion",
      duration_days_min: 3,
      duration_days_max: 5,
      description: "Instalacion de unidades interiores/exteriores de aire acondicionado.",
      depends_on: ["Pintura y acabados"],
    });
  }

  // Phase 9: Cleanup
  if (chapters.has("limpieza")) {
    phases.push({
      title: "Limpieza final y repasos",
      duration_days_min: 2,
      duration_days_max: 4,
      description: "Limpieza profesional, repasos de pintura y verificacion de instalaciones.",
      depends_on: ["Aparatos sanitarios, cocina y mecanismos"],
    });
    criticalPath.push("Limpieza final y repasos");
  }

  // Sum critical path durations (sequential)
  const execMin = phases.reduce((s, p) => s + p.duration_days_min, 0);
  const execMax = phases.reduce((s, p) => s + p.duration_days_max, 0);

  // Apply overlap factor (~15% for parallel phases)
  const overlapFactor = 0.85;
  const adjustedExecMin = Math.round(execMin * overlapFactor);
  const adjustedExecMax = Math.round(execMax * overlapFactor);

  // Buffer for permits, weather, supply delays: +15-20%
  const bufferMin = Math.ceil(adjustedExecMin * 1.12);
  const bufferMax = Math.ceil(adjustedExecMax * 1.22);

  const execWeeksMin = Math.ceil(adjustedExecMin / 5);
  const execWeeksMax = Math.ceil(adjustedExecMax / 5);
  const totalWeeksMin = Math.ceil(bufferMin / 5);
  const totalWeeksMax = Math.ceil(bufferMax / 5);

  const assumptions: string[] = [
    "Jornadas de 8h, 5 dias/semana.",
    "Un equipo de obra operativo desde el inicio.",
    `Superficie: ${area} m2, ${banos} bano(s).`,
  ];
  if (scope.incluye_cocina) assumptions.push("Incluye cocina completa (mobiliario + instalaciones).");
  if (scope.incluye_ventanas) assumptions.push("Incluye cambio de ventanas (puede requerir licencia municipal).");
  if (scope.incluye_climatizacion) assumptions.push("Incluye climatizacion (coordinacion con instalador externo).");
  assumptions.push("No se consideran retrasos por permisos, suministros o inclemencias.");

  return {
    execution_weeks_min: execWeeksMin,
    execution_weeks_max: execWeeksMax,
    total_weeks_min: totalWeeksMin,
    total_weeks_max: totalWeeksMax,
    phase_breakdown: phases,
    critical_path: criticalPath,
    assumptions,
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

const CHAPTER_LABELS: Record<string, string> = {
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
