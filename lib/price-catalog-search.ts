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
    matches: (name) => /\b(perfil|montante)\b/.test(name) && /\b(pladur|placo|yeso)\b/.test(name),
    alternatives: [["montante"], ["perfil", "placo"]],
  },
  {
    matches: (name) => /\b(tuberia|tubo)\b/.test(name) && /\bmulticapa\b/.test(name),
    alternatives: [["tubo", "multicapa"], ["multicapa"]],
  },
  {
    matches: (name) => /\bpvc\b/.test(name) && /\b(evacuacion|desague)\b/.test(name),
    alternatives: [["tubo", "pvc"], ["pvc", "compacto"]],
  },
  {
    matches: (name) => /\bcable\b/.test(name) && /\bh07/.test(name),
    alternatives: [["h07v"], ["cable", "h07"]],
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
    matches: (name) => /\bimprimacion\b/.test(name),
    alternatives: [["imprimacion"], ["fijador"]],
  },
  {
    matches: (name) => /\bmasilla\b/.test(name),
    alternatives: [["masilla", "interior"], ["masilla", "reparacion"]],
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
