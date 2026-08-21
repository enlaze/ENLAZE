/**
 * Canonical provider identity for tracker rows.
 *
 * Some historical feeds used combined labels such as
 * "Leroy Merlin / OBRAMAT". The product URL is the authoritative signal for
 * deciding which retailer owns an offer. When the URL cannot disambiguate the
 * row, the label remains explicitly identified as a comparator instead of
 * attributing the price to the wrong provider.
 */

const PROVIDER_RULES: Array<{ name: string; patterns: RegExp[] }> = [
  { name: "Leroy Merlin", patterns: [/leroy\s*merlin/i, /leroymerlin\./i] },
  { name: "OBRAMAT", patterns: [/obramat/i, /bricomart/i] },
  { name: "ManoMano", patterns: [/mano\s*mano/i, /manomano\./i] },
  { name: "Roca", patterns: [/\broca\b/i, /roca\./i] },
  { name: "Porcelanosa", patterns: [/porcelanosa/i] },
  { name: "Eurocasa", patterns: [/eurocasa/i] },
  { name: "IKEA", patterns: [/\bikea\b/i, /ikea\./i] },
  { name: "Grupo Puma", patterns: [/grupo\s*puma/i, /grupopuma\./i] },
];

export function canonicalProviderName(providerName: string | null | undefined, sourceUrl?: string | null) {
  const rawName = String(providerName || "").trim();
  const url = String(sourceUrl || "").trim();

  // A product URL is more precise than a legacy aggregate feed name.
  for (const rule of PROVIDER_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(url))) return rule.name;
  }

  const isCombinedLeroyObramat = /leroy/i.test(rawName) && /(obramat|bricomart)/i.test(rawName);
  if (isCombinedLeroyObramat) return "Comparador Leroy Merlin / OBRAMAT";

  for (const rule of PROVIDER_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(rawName))) return rule.name;
  }

  return rawName || "Rastreador ENLAZE";
}

export function providerIdentitySlug(providerName: string | null | undefined, sourceUrl?: string | null) {
  return canonicalProviderName(providerName, sourceUrl)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "rastreador-enlaze";
}
