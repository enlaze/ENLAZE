/**
 * Strict commercial-product equivalence checks.
 *
 * Technical budget lines describe the product that must be bought. A tracker
 * row is only comparable when its identity, format and sale unit agree with
 * that requirement. This module deliberately preserves measurements inside
 * parentheses: they are often the most important part of the match.
 */

import { auditAtomicMaterialName } from "./material-procurement";

export interface CommercialProductMatchInput {
  requestedName: string;
  candidateName: string;
  requestedUnit?: string | null;
  candidateUnit?: string | null;
  unitsPerPackage?: number | null;
  referenceUnitPrice?: number | null;
  candidateUnitPrice?: number | null;
}

export interface CommercialProductMatchResult {
  isExact: boolean;
  score: number;
  identityCompatible: boolean;
  formatCompatible: boolean;
  unitCompatible: boolean;
  priceCompatible: boolean;
  bundleCompatible: boolean;
  accessoryCompatible: boolean;
  reasons: string[];
}

interface ConceptGroup {
  id: string;
  role: "primary" | "attribute";
  aliases: string[];
}

const CONCEPT_GROUPS: ConceptGroup[] = [
  { id: "metal_profile", role: "primary", aliases: ["perfil metalico", "perfil para pladur", "montante metalico", "montante pladur", "montante placo", "montante ega", "canal metalico"] },
  { id: "gypsum_board", role: "primary", aliases: ["placa de yeso", "placa yeso", "yeso laminado", "carton yeso", "pladur", "glasroc"] },
  { id: "tile_adhesive", role: "primary", aliases: ["mortero cola", "cemento cola", "adhesivo ceramico", "adhesivo porcelanico"] },
  { id: "self_leveling_mortar", role: "primary", aliases: ["mortero autonivelante", "autonivelante"] },
  { id: "mortar", role: "primary", aliases: ["mortero"] },
  { id: "pipe", role: "primary", aliases: ["tuberia", "tubo"] },
  { id: "multilayer", role: "attribute", aliases: ["multicapa", "multicapa reticulada"] },
  { id: "pvc_drain", role: "attribute", aliases: ["pvc evacuacion", "pvc de evacuacion", "desague pvc", "pvc compacto"] },
  { id: "fitting", role: "primary", aliases: ["racor", "racores", "accesorio multicapa"] },
  { id: "angle_stop_valve", role: "primary", aliases: ["llave de corte", "llave escuadra", "llave de escuadra"] },
  { id: "plumbing_manifold", role: "primary", aliases: ["colector de fontaneria", "colector multicapa"] },
  { id: "basin_waste", role: "primary", aliases: ["valvula de desague para lavabo", "valvula lavabo", "valvula click clack lavabo"] },
  { id: "sink_basket_waste", role: "primary", aliases: ["valvula cesta para fregadero", "valvula cesta"] },
  { id: "basin_trap", role: "primary", aliases: ["sifon botella para lavabo", "sifon para lavabo"] },
  { id: "sink_trap", role: "primary", aliases: ["sifon para fregadero", "sifon fregadero"] },
  { id: "electric_cable", role: "primary", aliases: ["cable electrico", "cable h07", "h07v k", "h07vk"] },
  { id: "electric_panel", role: "primary", aliases: ["cuadro electrico", "cuadro de proteccion", "cuadro premontado"] },
  { id: "electric_protection", role: "attribute", aliases: ["protecciones electricas", "protecciones"] },
  { id: "circuit_breaker", role: "primary", aliases: ["interruptor magnetotermico", "magnetotermico"] },
  { id: "residual_current_device", role: "primary", aliases: ["interruptor diferencial", "diferencial"] },
  { id: "surge_protector", role: "primary", aliases: ["protector de sobretensiones", "sobretensiones transitorias"] },
  { id: "mechanism", role: "primary", aliases: ["mecanismo electrico", "mecanismos electricos"] },
  { id: "socket", role: "primary", aliases: ["enchufe", "enchufes", "toma electrica"] },
  { id: "switch", role: "primary", aliases: ["interruptor unipolar", "interruptor de luz", "interruptores de luz"] },
  { id: "luminaire", role: "primary", aliases: ["luminaria", "lampara", "plafon", "downlight"] },
  { id: "led", role: "attribute", aliases: ["led"] },
  { id: "ceramic_tile", role: "primary", aliases: ["azulejo", "baldosa ceramica", "revestimiento ceramico", "revestimiento porcelanico"] },
  { id: "porcelain", role: "attribute", aliases: ["porcelanico", "porcelanica"] },
  { id: "laminate_underlay", role: "primary", aliases: ["base aislante para suelo laminado", "base para suelo laminado", "subsuelo laminado"] },
  { id: "flooring", role: "primary", aliases: ["pavimento", "suelo laminado", "suelo ceramico", "tarima"] },
  { id: "skirting", role: "primary", aliases: ["rodapie"] },
  { id: "paint", role: "primary", aliases: ["pintura"] },
  { id: "primer", role: "primary", aliases: ["imprimacion", "fondo fijador", "sellador de paredes"] },
  { id: "putty", role: "primary", aliases: ["masilla", "plaste"] },
  { id: "masking", role: "primary", aliases: ["cinta de enmascarar", "plastico protector"] },
  { id: "paint_roller", role: "primary", aliases: ["rodillo", "rodillos"] },
  { id: "paint_brush", role: "primary", aliases: ["brocha", "brochas"] },
  { id: "paint_tray", role: "primary", aliases: ["cubeta", "cubetas"] },
  { id: "toilet", role: "primary", aliases: ["inodoro", "wc"] },
  {
    id: "basin",
    role: "primary",
    aliases: [
      "lavabo sobre encimera",
      "lavabo mural",
      "lavabo suspendido",
      "lavabo de pedestal",
      "lavabo pedestal",
      "lavabo de porcelana",
      "lavabo ceramico",
      "lavabo roca",
    ],
  },
  { id: "faucet", role: "primary", aliases: ["griferia", "grifo", "monomando"] },
  { id: "shower_tray", role: "primary", aliases: ["plato de ducha"] },
  { id: "shower_screen", role: "primary", aliases: ["mampara"] },
  { id: "door", role: "primary", aliases: ["puerta interior", "puerta de paso"] },
  { id: "waterproof_membrane", role: "primary", aliases: ["lamina impermeabilizante", "membrana impermeabilizante"] },
  { id: "silicone", role: "primary", aliases: ["silicona"] },
  { id: "waste_container", role: "primary", aliases: ["contenedor de escombros", "contenedor escombros"] },
];

const ACCESSORY_WORDS = new Set([
  "adaptador", "broca", "codo", "espátula", "espatula", "herramienta",
  "elevador", "llana", "malla", "manguito", "paleta", "punta", "recambio",
  "refuerzo", "repuesto", "soporte", "te", "tee", "tes", "tornillo",
  "tornillos",
]);

const TOKEN_STOP_WORDS = new Set([
  "para", "con", "sin", "tipo", "color", "blanco", "blanca", "negro",
  "negra", "material", "suministro", "unidad", "unidades", "saco", "sacos",
  "rollo", "rollos", "cubo", "cubos", "bote", "lote", "kit", "pack", "de",
  "del", "la", "el", "los", "las", "y", "en", "por", "a", "al",
]);

const UNIT_ALIASES: Record<string, string> = {
  "m²": "m2", "m2": "m2", "metros cuadrados": "m2", "metro cuadrado": "m2",
  "ml": "ml", "metros lineales": "ml", "metro lineal": "ml",
  "m³": "m3", "m3": "m3", "metros cubicos": "m3",
  "u": "ud", "ud": "ud", "uds": "ud", "unidad": "ud", "unidades": "ud",
  "saco": "saco", "sacos": "saco",
  "rollo": "rollo", "rollos": "rollo",
  "cubo": "cubo", "cubos": "cubo", "bote": "cubo", "botes": "cubo", "bidon": "cubo",
  "lote": "lote", "lotes": "lote", "kit": "lote", "conjunto": "lote", "pack": "lote",
  "kg": "kg", "kilogramo": "kg", "kilogramos": "kg",
  "l": "l", "litro": "l", "litros": "l",
};

interface Measurement {
  kind: string;
  value: number | string;
  display: string;
}

export function normalizeCommercialMatchText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/,/g, ".")
    .replace(/[‐‑–—]/g, "-")
    .replace(/[^a-z0-9.+×x\/\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCommercialUnit(value: string | null | undefined): string {
  const normalized = normalizeCommercialMatchText(String(value || ""));
  return UNIT_ALIASES[normalized] || normalized;
}

function roundMeasurement(value: number) {
  return Math.round(value * 1000) / 1000;
}

function convertScalarMeasurement(value: number, unit: string): Measurement {
  switch (unit) {
    case "m": return { kind: "length", value: roundMeasurement(value * 1000), display: `${value}m` };
    case "cm": return { kind: "length", value: roundMeasurement(value * 10), display: `${value}cm` };
    case "mm": return { kind: "length", value: roundMeasurement(value), display: `${value}mm` };
    case "m2": return { kind: "area", value: roundMeasurement(value * 1_000_000), display: `${value}m2` };
    case "cm2": return { kind: "area", value: roundMeasurement(value * 100), display: `${value}cm2` };
    case "mm2": return { kind: "area", value: roundMeasurement(value), display: `${value}mm2` };
    case "m3": return { kind: "volume", value: roundMeasurement(value * 1_000_000_000), display: `${value}m3` };
    case "cm3": return { kind: "volume", value: roundMeasurement(value * 1000), display: `${value}cm3` };
    case "mm3": return { kind: "volume", value: roundMeasurement(value), display: `${value}mm3` };
    case "kg": return { kind: "mass", value: roundMeasurement(value * 1000), display: `${value}kg` };
    case "g": return { kind: "mass", value: roundMeasurement(value), display: `${value}g` };
    case "l": return { kind: "liquid", value: roundMeasurement(value * 1000), display: `${value}l` };
    case "ml": return { kind: "liquid", value: roundMeasurement(value), display: `${value}ml` };
    case "w": return { kind: "power", value: roundMeasurement(value), display: `${value}w` };
    default: return { kind: unit, value: roundMeasurement(value), display: `${value}${unit}` };
  }
}

function extractMeasurements(value: string): Measurement[] {
  let normalized = normalizeCommercialMatchText(value);
  const measurements: Measurement[] = [];
  normalized = normalized.replace(
    /(\d+)\s*\/\s*(\d+)\s*[x×]\s*(\d+)\s*\/\s*(\d+)\s*(?:pulgadas?)?/g,
    (_match, firstNumerator: string, firstDenominator: string, secondNumerator: string, secondDenominator: string) => {
      const first = Number(firstNumerator) / Number(firstDenominator);
      const second = Number(secondNumerator) / Number(secondDenominator);
      if (Number.isFinite(first) && Number.isFinite(second)) {
        measurements.push(
          { kind: "thread", value: roundMeasurement(first), display: `${firstNumerator}/${firstDenominator}\"` },
          { kind: "thread", value: roundMeasurement(second), display: `${secondNumerator}/${secondDenominator}\"` },
        );
      }
      return " ";
    },
  );
  // BC3 and product-page titles commonly spell plumbing threads as
  // `1/2\"-3/8\"` rather than `1/2 x 3/8 pulgadas`. The quote characters are
  // removed during normalization, so collect each remaining fraction after
  // the compound form above has been consumed.
  normalized = normalized.replace(
    /\b(\d+)\s*\/\s*(\d+)\b/g,
    (_match, numeratorRaw: string, denominatorRaw: string) => {
      const numerator = Number(numeratorRaw);
      const denominator = Number(denominatorRaw);
      const value = numerator / denominator;
      if (Number.isFinite(value) && denominator > 0) {
        measurements.push({
          kind: "thread",
          value: roundMeasurement(value),
          display: `${numeratorRaw}/${denominatorRaw}\"`,
        });
      }
      return " ";
    },
  );
  normalized = normalized.replace(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/g,
    (_match, firstRaw: string, secondRaw: string, thirdRaw: string, unit: string) => {
      const rawValues = [firstRaw, secondRaw, thirdRaw];
      const converted = rawValues.map((raw) => convertScalarMeasurement(Number(raw), unit));
      const ordered = converted
        .map((measurement) => measurement.value as number)
        .sort((left, right) => left - right);
      measurements.push({
        kind: "dimensions",
        value: ordered.join("x"),
        display: `${firstRaw}x${secondRaw}x${thirdRaw}${unit}`,
      });
      // Catalogue titles commonly write width x height x thickness while the
      // technical requirement only names the thickness. Keep every axis so a
      // requested 13 mm board can match a 2000 x 1200 x 13 mm product.
      measurements.push(...converted);
      return " ";
    },
  );
  normalized = normalized.replace(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/g,
    (_match, firstRaw: string, secondRaw: string, unit: string) => {
      const first = convertScalarMeasurement(Number(firstRaw), unit).value as number;
      const second = convertScalarMeasurement(Number(secondRaw), unit).value as number;
      const ordered = [first, second].sort((left, right) => left - right);
      measurements.push({
        kind: "dimensions",
        value: `${ordered[0]}x${ordered[1]}`,
        display: `${firstRaw}x${secondRaw}${unit}`,
      });
      measurements.push(
        convertScalarMeasurement(Number(firstRaw), unit),
        convertScalarMeasurement(Number(secondRaw), unit),
      );
      return " ";
    },
  );

  const scalarPattern = /(\d+(?:\.\d+)?)\s*(mm2|cm2|m2|mm3|cm3|m3|mm|cm|kg|ml|g|l|m|w)\b/g;
  for (const match of normalized.matchAll(scalarPattern)) {
    measurements.push(convertScalarMeasurement(Number(match[1]), match[2]));
  }

  return measurements;
}

function extractMortarGrade(value: string): number | null {
  const match = normalizeCommercialMatchText(value).match(/\bm\s*-?\s*(\d+(?:\.\d+)?)\b/);
  if (!match) return null;
  const grade = Number(match[1]);
  return Number.isFinite(grade) ? grade : null;
}

function hasRequiredAttributes(requestedName: string, candidateName: string) {
  const requested = normalizeCommercialMatchText(requestedName);
  const candidate = normalizeCommercialMatchText(candidateName);
  const requirements = [
    { requested: /\blacad[oa]\b/, candidate: /\blacad[oa]\b/ },
    { requested: /\bcompact[oa]\b/, candidate: /\bcompact[oa]\b/ },
    { requested: /\b(?:salida\s+)?dual\b/, candidate: /\b(?:salida\s+)?dual\b/ },
    { requested: /\bfrontal\b/, candidate: /\bfrontal\b/ },
    { requested: /\bresina\b/, candidate: /\bresina\b/ },
    { requested: /\bantideslizante\b/, candidate: /\b(?:antideslizante|antislip)\b/ },
    { requested: /\bsanitari[oa]\b/, candidate: /\b(?:sanitari[oa]|banos?|cocinas?)\b/ },
    { requested: /\bmate\b/, candidate: /\bmate\b/ },
    { requested: /\bblanc[oa]\b/, candidate: /\bblanc[oa]\b/ },
    { requested: /\brectificad[oa]\b/, candidate: /\brectificad[oa]\b/ },
    { requested: /\bcorredera\b/, candidate: /\bcorredera\b/ },
    { requested: /\btransparente\b/, candidate: /\btransparente\b/ },
    { requested: /\btermostatic[oa]\b/, candidate: /\btermostatic[oa]\b/ },
    { requested: /\bcromad[oa]\b/, candidate: /\bcromad[oa]\b/ },
    { requested: /\bempotrable\b/, candidate: /\b(?:empotrable|empotrar)\b/ },
    { requested: /\bschuko\b/, candidate: /\bschuko\b/ },
    { requested: /\bac5\b/, candidate: /\bac5\b/ },
    { requested: /\broble\b/, candidate: /\broble\b/ },
    { requested: /\bpex\s*-?\s*al\s*-?\s*pex\b/, candidate: /\bpex\s*\/?\s*al\s*\/?\s*pex\b/ },
    { requested: /\b4000\s*k\b/, candidate: /\b4000\s*(?:k|ºk)\b/ },
    { requested: /\bip20\b/, candidate: /\bip20\b/ },
    { requested: /\bcurva\s*c\b/, candidate: /\bcurva\s*c\b/ },
    { requested: /\bizquierda\b/, candidate: /\bizquierda\b/ },
    { requested: /\bderecha\b/, candidate: /\bderecha\b/ },
    { requested: /\bredond[oa]\b/, candidate: /\bredond[oa]\b/ },
    { requested: /\bsobre\s+encimera\b/, candidate: /\b(?:sobre\s+encimera|encimera)\b/ },
    { requested: /\badosad[oa]\s+a\s+pared\b/, candidate: /\badosad[oa]\s+a\s+pared\b/ },
    { requested: /\binterior\b/, candidate: /\binterior\b/ },
    { requested: /\bal\s+agua\b/, candidate: /\b(?:al\s+agua|base\s+agua|acuos[oa])\b/ },
    { requested: /\bplastic[oa]\b/, candidate: /\bplastic[oa]\b/ },
    { requested: /\bmdf\b/, candidate: /\b(?:mdf|dm)\b/ },
    { requested: /\bba\b/, candidate: /\bba\b/ },
    { requested: /\b(?:exterior|vista)\b/, candidate: /\b(?:exterior|vista)\b/ },
    { requested: /\blavabo\b/, candidate: /\blavabo\b/ },
    { requested: /\bducha\b/, candidate: /\bducha\b/ },
  ];
  if (requirements.some((requirement) => requirement.requested.test(requested) && !requirement.candidate.test(candidate))) {
    return false;
  }
  return true;
}

function hasCompatibleGypsumBoardClass(requestedName: string, candidateName: string) {
  const requested = normalizeCommercialMatchText(requestedName);
  const candidate = normalizeCommercialMatchText(candidateName);
  const asksForStandardTypeA = /\b(?:tipo\s*a|estandar)\b/.test(requested);
  if (!asksForStandardTypeA) return true;

  const conflictingSpecialBoard = /\b(?:glasroc\s*h|pph|fk|tipo\s*(?:h1?|f|i|r|e)|hidrofug[oa]|ignifug[oa]|fuego)\b/.test(candidate);
  if (conflictingSpecialBoard) return false;
  return /\b(?:tipo\s*a|estandar)\b/.test(candidate);
}

function extractElectricalRating(value: string, pattern: RegExp): number | null {
  const match = normalizeCommercialMatchText(value).match(pattern);
  if (!match) return null;
  const rating = Number(match[1]);
  return Number.isFinite(rating) ? rating : null;
}

function hasCompatibleElectricalRatings(requestedName: string, candidateName: string) {
  const requested = normalizeCommercialMatchText(requestedName);
  const candidate = normalizeCommercialMatchText(candidateName);
  const ratingPatterns = [
    /\b(\d+)\s*p(?:\s*\+\s*n)?\b/,
    /\b(\d+(?:\.\d+)?)\s*a\b/,
    /\b(\d+(?:\.\d+)?)\s*ma\b/,
  ];

  return ratingPatterns.every((pattern) => {
    const requestedRating = extractElectricalRating(requested, pattern);
    if (requestedRating === null) return true;
    const candidateRating = extractElectricalRating(candidate, pattern);
    return candidateRating !== null && Math.abs(candidateRating - requestedRating) <= 0.001;
  });
}

function measurementEquals(left: Measurement, right: Measurement) {
  if (left.kind !== right.kind) return false;
  if (typeof left.value === "string" || typeof right.value === "string") {
    return left.value === right.value;
  }
  const tolerance = Math.max(Math.abs(left.value), Math.abs(right.value), 1) * 0.005;
  return Math.abs(left.value - right.value) <= tolerance;
}

function findConceptGroups(value: string) {
  const normalized = normalizeCommercialMatchText(value);
  return CONCEPT_GROUPS.filter((group) =>
    group.aliases.some((alias) => normalized.includes(normalizeCommercialMatchText(alias)))
  );
}

function significantTokens(value: string) {
  return Array.from(new Set(
    normalizeCommercialMatchText(value)
      .replace(/[()+]/g, " ")
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9]/g, ""))
      .filter((token) => token.length >= 3 && !TOKEN_STOP_WORDS.has(token) && !/^\d/.test(token)),
  ));
}

function requestedPrimaryGroups(requestedName: string, groups: ConceptGroup[]) {
  const primary = groups.filter((group) => group.role === "primary");
  if (normalizeCommercialMatchText(requestedName).includes("+") && primary.length > 1) return primary;
  return primary.slice(0, 1);
}

function isUnitCompatible(input: CommercialProductMatchInput) {
  const requested = normalizeCommercialUnit(input.requestedUnit);
  const candidate = normalizeCommercialUnit(input.candidateUnit);
  if (!requested || !candidate) return false;
  if (requested === candidate) return true;

  if (candidate === "ud" && ["saco", "rollo", "cubo", "lote"].includes(requested)) {
    const candidateText = normalizeCommercialMatchText(input.candidateName);
    const packageAliases: Record<string, string[]> = {
      saco: ["saco", "bolsa"],
      rollo: ["rollo", "bobina"],
      cubo: ["cubo", "bote", "bidon"],
      lote: ["lote", "kit", "pack", "conjunto"],
    };
    if (packageAliases[requested].some((word) => candidateText.includes(word))) return true;

    // Supplier catalogues often store a packaged product as "ud". It is only
    // comparable when the title proves the exact package content (25 kg,
    // 100 m, 15 L, etc.).
    const requestedMeasurements = extractMeasurements(input.requestedName);
    const candidateMeasurements = extractMeasurements(input.candidateName);
    return requested !== "lote" && requestedMeasurements.length > 0 && requestedMeasurements.every(
      (measurement) => candidateMeasurements.some((candidateMeasurement) =>
        measurementEquals(measurement, candidateMeasurement)
      ),
    );
  }

  // Dimensional prices require an explicit conversion. units_per_package is a
  // piece count and must never be treated as m2, metres, kilograms or litres.
  return false;
}

function isBundleCompatible(requestedName: string, candidateName: string) {
  const requested = normalizeCommercialMatchText(requestedName);
  if (!requested.includes("+")) return true;
  const candidate = normalizeCommercialMatchText(candidateName);
  return /\+|\bkit\b|\bpack\b|\bconjunto\b|\bincluye\b|\bcon\b|\by\b|\bequipad[oa]\b|\bpremontad[oa]\b|\bcomplet[oa]\b/.test(candidate);
}

function isAccessoryCompatible(requestedName: string, candidateName: string) {
  const requestedTokens = new Set(normalizeCommercialMatchText(requestedName).split(/\s+/));
  const candidateTokens = normalizeCommercialMatchText(candidateName).split(/\s+/);
  return !candidateTokens.some((token) => ACCESSORY_WORDS.has(token) && !requestedTokens.has(token));
}

export function evaluateCommercialProductMatch(
  input: CommercialProductMatchInput,
): CommercialProductMatchResult {
  const reasons: string[] = [];
  const atomicAudit = auditAtomicMaterialName(input.requestedName);
  const requestedGroups = findConceptGroups(input.requestedName);
  const candidateGroups = findConceptGroups(input.candidateName);
  const candidateGroupIds = new Set(candidateGroups.map((group) => group.id));
  const requiredPrimary = requestedPrimaryGroups(input.requestedName, requestedGroups);
  const requiredAttributes = requestedGroups.filter((group) => group.role === "attribute");
  const requiredGroups = [...requiredPrimary, ...requiredAttributes];

  const requestedTokens = significantTokens(input.requestedName);
  const candidateTokens = significantTokens(input.candidateName);
  const tokenMatches = requestedTokens.filter((token) =>
    candidateTokens.some((candidate) => candidate.includes(token) || token.includes(candidate))
  );
  const tokenCoverage = requestedTokens.length > 0 ? tokenMatches.length / requestedTokens.length : 0;
  const compactRequested = normalizeCommercialMatchText(input.requestedName).replace(/[^a-z0-9]/g, "");
  const compactCandidate = normalizeCommercialMatchText(input.candidateName).replace(/[^a-z0-9]/g, "");
  const requiredPrimaryIds = new Set(requiredPrimary.map((group) => group.id));
  const hasConflictingPrimary = requiredPrimary.length > 0 && candidateGroups
    .filter((group) => group.role === "primary")
    .some((group) => !requiredPrimaryIds.has(group.id));
  const requestedMortarGrade = extractMortarGrade(input.requestedName);
  const candidateMortarGrade = extractMortarGrade(input.candidateName);
  const mortarGradeCompatible = requestedMortarGrade === null || (
    candidateMortarGrade !== null
    && Math.abs(candidateMortarGrade - requestedMortarGrade) <= 0.01
  );
  const attributesCompatible = hasRequiredAttributes(input.requestedName, input.candidateName)
    && hasCompatibleGypsumBoardClass(input.requestedName, input.candidateName)
    && hasCompatibleElectricalRatings(input.requestedName, input.candidateName);
  const groupIdentity = (requiredGroups.length > 0
    ? requiredGroups.every((group) => candidateGroupIds.has(group.id))
    : compactRequested.includes(compactCandidate) || compactCandidate.includes(compactRequested) || tokenCoverage >= 0.6)
    && !hasConflictingPrimary
    && mortarGradeCompatible
    && atomicAudit.isAtomic
    && attributesCompatible;
  const identityCompatible = groupIdentity && (tokenCoverage >= 0.2 || requiredGroups.length > 0);
  if (!identityCompatible) {
    reasons.push(
      hasConflictingPrimary || !mortarGradeCompatible || !attributesCompatible
        ? "La variante o resistencia del producto no coincide con la solicitada"
        : "El producto no corresponde al concepto solicitado",
    );
  }
  if (!atomicAudit.isAtomic) reasons.push(...atomicAudit.reasons);

  const requestedMeasurements = extractMeasurements(input.requestedName);
  const candidateMeasurements = extractMeasurements(input.candidateName);
  const missingMeasurements = requestedMeasurements.filter((requested) =>
    !candidateMeasurements.some((candidate) => measurementEquals(requested, candidate))
  );
  const formatCompatible = missingMeasurements.length === 0;
  if (!formatCompatible) {
    reasons.push(`Formato incompatible o incompleto: falta ${missingMeasurements.map((measurement) => measurement.display).join(", ")}`);
  }

  const unitCompatible = isUnitCompatible(input);
  if (!unitCompatible) reasons.push("La unidad de venta no es comparable");

  const referencePrice = Number(input.referenceUnitPrice);
  const candidatePrice = Number(input.candidateUnitPrice);
  const ratio = referencePrice > 0 && candidatePrice > 0 ? candidatePrice / referencePrice : null;
  const priceCompatible = ratio === null || (ratio >= 0.2 && ratio <= 5);
  if (!priceCompatible) reasons.push("El precio apunta a una unidad o formato diferente");

  const bundleCompatible = isBundleCompatible(input.requestedName, input.candidateName);
  if (!bundleCompatible) reasons.push("La partida solicita un conjunto, pero el producto es un componente aislado");

  const accessoryCompatible = isAccessoryCompatible(input.requestedName, input.candidateName);
  if (!accessoryCompatible) reasons.push("Se ha encontrado un accesorio o herramienta, no el producto solicitado");

  const groupCoverage = requiredGroups.length > 0
    ? requiredGroups.filter((group) => candidateGroupIds.has(group.id)).length / requiredGroups.length
    : tokenCoverage;
  const score = Math.max(0, Math.min(1,
    groupCoverage * 0.45 +
    Math.min(tokenCoverage, 1) * 0.15 +
    Number(formatCompatible) * 0.15 +
    Number(unitCompatible) * 0.1 +
    Number(priceCompatible) * 0.05 +
    Number(bundleCompatible) * 0.05 +
    Number(accessoryCompatible) * 0.05
  ));

  return {
    isExact:
      identityCompatible &&
      formatCompatible &&
      unitCompatible &&
      priceCompatible &&
      bundleCompatible &&
      accessoryCompatible &&
      score >= 0.8,
    score: Math.round(score * 1000) / 1000,
    identityCompatible,
    formatCompatible,
    unitCompatible,
    priceCompatible,
    bundleCompatible,
    accessoryCompatible,
    reasons,
  };
}

export function isProductSpecificSourceUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return false;
    if (host === "view.publitas.com" || host.endsWith(".publitas.com")) return false;
    if (/\.(?:zip|bc3|pdf|csv|xlsx?)$/i.test(path)) return false;
    if (/^\/(?:es|es-es|productos?|catalogo|catalogos)$/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}
