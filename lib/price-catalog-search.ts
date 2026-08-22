import { normalizeMaterialName } from "./price-resolver";

const GENERIC_SEARCH_WORDS = new Set([
  "para", "con", "sin", "tipo", "color", "blanco", "blanca", "negro",
  "negra", "pack", "unidad", "unidades", "material", "suministro",
  "instalacion", "colocacion", "completo", "completa", "juego", "varios",
]);

interface CatalogSearchRule {
  matches: (normalizedName: string) => boolean;
  alternatives: string[][];
}

// Technical budgets and supplier catalogues frequently name the same product
// with different trade terms. These groups only broaden candidate retrieval;
// the strict matcher still has to prove identity, measurements, sale unit and
// price scale before ENLAZE can mark a price as verified.
const CATALOG_SEARCH_RULES: CatalogSearchRule[] = [
  {
    matches: (name) => /\bmortero\b/.test(name) && /\bm\s*-?\s*7[.,]?5\b/.test(name),
    alternatives: [["mortero", "m7"], ["mortero", "seco"]],
  },
  {
    matches: (name) => /\bplaca\b/.test(name) && /\byeso\b/.test(name) && /\b(?:estandar|tipo\s+a)\b/.test(name),
    alternatives: [["placa", "yeso", "estandar"], ["placa", "yeso", "tipo", "a"]],
  },
  {
    matches: (name) => /\b(perfil|montante)\b/.test(name) && /\b(pladur|placo|yeso)\b/.test(name),
    alternatives: [["montante"], ["perfil", "placo"]],
  },
  {
    matches: (name) => /\b(tuberia|tubo)\b/.test(name) && /\bmulticapa\b/.test(name),
    alternatives: [["tubo", "multicapa"], ["multicapa"]],
  },
  {
    matches: (name) => /\bracor\b/.test(name) && /\bmulticapa\b/.test(name),
    alternatives: [["racor", "multicapa"], ["racor", "16"]],
  },
  {
    matches: (name) => /\bcodo\b/.test(name) && /\bmulticapa\b/.test(name),
    alternatives: [["codo", "multicapa"], ["codo", "16"]],
  },
  {
    matches: (name) => /\bllave\b/.test(name) && /\bescuadra\b/.test(name),
    alternatives: [["llave", "escuadra"], ["llave", "corte"]],
  },
  {
    matches: (name) => /\bcolector\b/.test(name) && /\bfontaneria\b/.test(name),
    alternatives: [["colector", "multicapa"], ["colector", "4", "salidas"]],
  },
  {
    matches: (name) => /\bsifon\b/.test(name) && /\blavabo\b/.test(name),
    alternatives: [["sifon", "lavabo"], ["sifon", "botella"]],
  },
  {
    matches: (name) => /\bsifon\b/.test(name) && /\bfregadero\b/.test(name),
    alternatives: [["sifon", "fregadero"]],
  },
  {
    matches: (name) => /\bvalvula\b/.test(name) && /\blavabo\b/.test(name),
    alternatives: [["valvula", "lavabo"], ["valvula", "desague"]],
  },
  {
    matches: (name) => /\bvalvula\b/.test(name) && /\bfregadero\b/.test(name),
    alternatives: [["valvula", "cesta"], ["valvula", "fregadero"]],
  },
  {
    matches: (name) => /\bpvc\b/.test(name) && /\b(evacuacion|desague)\b/.test(name),
    alternatives: [["tubo", "pvc"], ["pvc", "compacto"]],
  },
  {
    matches: (name) => /\b(?:cable|hilo)\b/.test(name) && /\bh07/.test(name),
    alternatives: [["h07v"], ["cable", "h07"], ["hilo", "h07"]],
  },
  {
    matches: (name) => /\bcuadro\b/.test(name) && /\b(?:caja|empotrar|modulos)\b/.test(name),
    alternatives: [["caja", "cuadro", "12"], ["cuadro", "12", "modulos"]],
  },
  {
    matches: (name) => /\bmagnetotermic/.test(name),
    alternatives: [["magnetotermico"], ["interruptor", "magnetotermico"]],
  },
  {
    matches: (name) => /\bdiferencial\b/.test(name),
    alternatives: [["diferencial"], ["interruptor", "diferencial"]],
  },
  {
    matches: (name) => /\bsobretension/.test(name),
    alternatives: [["sobretension"], ["sobretension", "transitoria"]],
  },
  {
    matches: (name) => /\benchufe\b/.test(name),
    alternatives: [["base", "enchufe"], ["mecanismo", "enchufe"]],
  },
  {
    matches: (name) => /\binterruptor\b/.test(name) && !/\b(?:diferencial|magnetotermic)/.test(name),
    alternatives: [["mecanismo", "interruptor"], ["interruptor", "empotrar"]],
  },
  {
    matches: (name) => /\b(azulejo|baldosa|revestimiento)\b/.test(name) && /\bporcelanic/.test(name),
    alternatives: [["revestimiento", "porcelanico"], ["porcelanico"]],
  },
  {
    matches: (name) => /\badhesivo\b/.test(name) && /\bc2te\b/.test(name),
    alternatives: [["adhesivo", "c2te"], ["cemento", "cola", "c2te"]],
  },
  {
    matches: (name) => /\bsuelo\b/.test(name) && /\blaminado\b/.test(name) && /\bac5\b/.test(name),
    alternatives: [["suelo", "laminado", "ac5"], ["laminado", "ac5", "roble"]],
  },
  {
    matches: (name) => /\bbase\b/.test(name) && /\bsuelo\b/.test(name) && /\blaminado\b/.test(name),
    alternatives: [["base", "suelo", "laminado"], ["base", "aislante", "5"]],
  },
  {
    matches: (name) => /\brodapie/.test(name) && /\b(?:mdf|dm)\b/.test(name),
    alternatives: [["rodapie", "mdf"], ["rodapie", "dm"], ["rodapie", "blanco"]],
  },
  {
    matches: (name) => /\b(?:imprimacion|fondo fijador)\b/.test(name),
    alternatives: [["imprimacion"], ["fondo", "fijador"], ["fijador"]],
  },
  {
    matches: (name) => /\b(?:downlight|luminaria|plafon)\b/.test(name) && /\bled\b/.test(name),
    alternatives: [["downlight", "led", "superficie"], ["downlight", "20w"], ["luminaria", "led"]],
  },
  {
    matches: (name) => /\bcinta\b/.test(name) && /\benmascarar\b/.test(name),
    alternatives: [["cinta", "enmascarar"], ["cinta", "pintor"]],
  },
  {
    matches: (name) => /\bplastico\b/.test(name) && /\bprotector\b/.test(name),
    alternatives: [["plastico", "protector"], ["plastico", "pintura"]],
  },
  {
    matches: (name) => /\b(?:masilla|plaste)\b/.test(name),
    alternatives: [["plaste", "renovacion", "15"], ["masilla", "interior"], ["masilla", "reparacion"]],
  },
  {
    matches: (name) => /\b(?:rodillo|brocha|cubeta)\b/.test(name),
    alternatives: [["rodillo", "pintura"], ["brocha", "pintura"], ["cubeta", "pintura"]],
  },
  {
    matches: (name) => /\blavabo\b/.test(name) && /\b(?:grifo|monomando)\b/.test(name),
    alternatives: [["grifo", "lavabo"], ["monomando", "lavabo"]],
  },
  {
    matches: (name) => /\bducha\b/.test(name) && /\b(?:grifo|termostatic)/.test(name),
    alternatives: [["grifo", "ducha"], ["termostatico", "ducha"]],
  },
  {
    matches: (name) => /\binodoro\b/.test(name),
    alternatives: [["inodoro"], ["wc", "compacto"]],
  },
  {
    matches: (name) => /\blavabo\b/.test(name) && /\bencimera\b/.test(name),
    alternatives: [["lavabo", "sobre", "encimera"], ["lavabo", "redondo", "400"]],
  },
  {
    matches: (name) => /\bplato\b/.test(name) && /\bducha\b/.test(name),
    alternatives: [["plato", "ducha"], ["plato", "resina"]],
  },
  {
    matches: (name) => /\bmampara\b/.test(name),
    alternatives: [["mampara"], ["mampara", "frontal"]],
  },
  {
    matches: (name) => /\bsilicona\b/.test(name),
    alternatives: [["silicona", "neutra"], ["silicona"]],
  },
  {
    matches: (name) => /\bpuerta\b/.test(name) && /\bblock\b/.test(name),
    alternatives: [["puerta", "block", "lacada"], ["puerta", "72", "derecha"], ["puerta", "72", "izquierda"]],
  },
  {
    matches: (name) => /\blamina\b/.test(name) && /\bimpermeabil/.test(name),
    alternatives: [["lamina", "impermeabilizante"], ["lamina", "zonas", "humedas"]],
  },
];

/**
 * Produces a small, supplier-agnostic token set for one technical material.
 * Each material gets its own catalogue query so a 40k-row bank is not reduced
 * to one arbitrary global page of results.
 */
export function buildCatalogSearchTokens(materialName: string, limit = 3) {
  return Array.from(new Set(
    normalizeMaterialName(materialName)
      .split(" ")
      .map((word) => word.replace(/[^a-z0-9]/g, ""))
      .filter((word) => word.length >= 4 && !GENERIC_SEARCH_WORDS.has(word)),
  )).slice(0, limit);
}

export function buildCatalogSearchTokenGroups(materialName: string) {
  const normalizedName = normalizeMaterialName(materialName);
  const groups = [buildCatalogSearchTokens(materialName)];
  for (const rule of CATALOG_SEARCH_RULES) {
    if (rule.matches(normalizedName)) groups.push(...rule.alternatives);
  }

  const unique = new Map<string, string[]>();
  for (const group of groups) {
    const normalizedGroup = Array.from(new Set(group.filter(Boolean)));
    if (normalizedGroup.length > 0) {
      unique.set(normalizedGroup.join("|"), normalizedGroup);
    }
  }
  return Array.from(unique.values());
}

export function buildUniqueCatalogTokenGroups(materialNames: string[]) {
  const groups = new Map<string, string[]>();
  for (const materialName of materialNames) {
    for (const tokens of buildCatalogSearchTokenGroups(materialName)) {
      groups.set(tokens.join("|"), tokens);
    }
  }
  return Array.from(groups.values());
}
