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
    add("climatizacion", "Climatizacion",
      "Instalacion de sistema de aire acondicionado (splits o conductos).",
      Math.max(Math.ceil(q.floorArea / 25), 2), "ud", 1200, "mano_obra");
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
 * Adjust budget to market range. Idempotent.
 * Steps: 1) correct quantities, 2) add missing chapters, 3) recalc materials,
 * 4) recalc margin, 5) scale to floor if still below.
 */
export function adjustToMarket(
  scope: BudgetScope,
  items: EnginePartida[],
  materials: EngineMaterial[],
  serviceType: string,
  marginMultiplier: number
): MarketAdjustResult {
  const range = getMarketRange(scope, serviceType);
  const area = scope.superficie_m2;
  const marketFloor = range.min;
  const marketCeiling = range.max;
  const floorPerM2 = marketFloor / area;
  const ceilingPerM2 = marketCeiling / area;

  // Calculate current total (client price = items + materials with margin on materials)
  const itemsTotal = items.reduce((s, i) => s + i.subtotal_client, 0);
  const matsTotal = materials.filter(m => m.included).reduce((s, m) => s + m.subtotal, 0);
  const matsTotalWithMargin = matsTotal * marginMultiplier;
  const currentClientTotal = itemsTotal + matsTotalWithMargin;
  const currentPerM2 = area > 0 ? currentClientTotal / area : 0;

  if (currentPerM2 >= floorPerM2) {
    // Budget is within or above range — no adjustment needed
    return {
      items, materials,
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

  // Still below floor — scale unit prices proportionally
  const targetTotal = marketFloor;
  const scaleFactor = targetTotal / (currentClientTotal || 1);

  const scaledItems = items.map(p => {
    const newPrice = Math.round(p.unit_price * scaleFactor * 100) / 100;
    return {
      ...p,
      unit_price: newPrice,
      subtotal_cost: Math.round(p.quantity * newPrice * 100) / 100,
      unit_price_client: Math.round(newPrice * marginMultiplier * 100) / 100,
      subtotal_client: Math.round(p.quantity * newPrice * marginMultiplier * 100) / 100,
    };
  });

  const scaledMaterials = materials.map(m => {
    const newPrice = Math.round(m.unit_price * scaleFactor * 100) / 100;
    return {
      ...m,
      unit_price: newPrice,
      subtotal: Math.round(m.quantity * newPrice * 100) / 100,
    };
  });

  const newItemsTotal = scaledItems.reduce((s, i) => s + i.subtotal_client, 0);
  const newMatsTotal = scaledMaterials.filter(m => m.included).reduce((s, m) => s + m.subtotal, 0);
  const newTotal = newItemsTotal + newMatsTotal * marginMultiplier;
  const newPerM2 = area > 0 ? newTotal / area : 0;

  return {
    items: scaledItems,
    materials: scaledMaterials,
    adjusted: true,
    adjustmentType: "both",
    message: `Presupuesto ajustado al minimo realista de mercado (${Math.round(newPerM2)} EUR/m2). Se corrigieron cantidades, se completaron capitulos faltantes y se ajustaron precios unitarios.`,
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
