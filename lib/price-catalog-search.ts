import { normalizeMaterialName } from "./price-resolver";

const GENERIC_SEARCH_WORDS = new Set([
  "para", "con", "sin", "tipo", "color", "blanco", "blanca", "negro",
  "negra", "pack", "unidad", "unidades", "material", "suministro",
  "instalacion", "colocacion", "completo", "completa", "juego", "varios",
]);

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

export function buildUniqueCatalogTokenGroups(materialNames: string[]) {
  const groups = new Map<string, string[]>();
  for (const materialName of materialNames) {
    const tokens = buildCatalogSearchTokens(materialName);
    if (tokens.length > 0) groups.set(tokens.join("|"), tokens);
  }
  return Array.from(groups.values());
}
