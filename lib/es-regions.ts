// lib/es-regions.ts
// Provincias españolas y su comunidad autónoma.
//
// La lista canónica de provincias es EXACTAMENTE la que ya usaba
// app/dashboard/settings/fiscal (más Ceuta y Melilla, que faltaban), para no
// invalidar los valores ya guardados en `fiscal_settings.province`.
// `comunidadForProvince()` acepta además los nombres cooficiales/alternativos
// (Girona, Bizkaia, A Coruña, València…) por si llegan de datos antiguos o de
// una importación externa.

export const ES_PROVINCES = [
  "Álava", "Albacete", "Alicante", "Almería", "Asturias", "Ávila", "Badajoz", "Barcelona",
  "Burgos", "Cáceres", "Cádiz", "Cantabria", "Castellón", "Ceuta", "Ciudad Real", "Córdoba",
  "Cuenca", "Gerona", "Granada", "Guadalajara", "Guipúzcoa", "Huelva", "Huesca",
  "Islas Baleares", "Jaén", "La Coruña", "La Rioja", "Las Palmas", "León", "Lérida", "Lugo",
  "Madrid", "Málaga", "Melilla", "Murcia", "Navarra", "Orense", "Palencia", "Pontevedra",
  "Salamanca", "Santa Cruz de Tenerife", "Segovia", "Sevilla", "Soria", "Tarragona", "Teruel",
  "Toledo", "Valencia", "Valladolid", "Vizcaya", "Zamora", "Zaragoza",
] as const;

export type EsProvince = (typeof ES_PROVINCES)[number];

/** Las 17 comunidades autónomas + las 2 ciudades autónomas. */
export const ES_COMUNIDADES = [
  "Andalucía",
  "Aragón",
  "Canarias",
  "Cantabria",
  "Castilla-La Mancha",
  "Castilla y León",
  "Cataluña",
  "Ceuta",
  "Comunidad de Madrid",
  "Comunidad Foral de Navarra",
  "Comunitat Valenciana",
  "Extremadura",
  "Galicia",
  "Illes Balears",
  "La Rioja",
  "Melilla",
  "País Vasco",
  "Principado de Asturias",
  "Región de Murcia",
] as const;

export type EsComunidad = (typeof ES_COMUNIDADES)[number];

/**
 * Provincia → comunidad autónoma. Incluye variantes cooficiales como claves
 * extra para que la deducción funcione con cualquier grafía razonable.
 */
const PROVINCE_TO_CCAA: Record<string, string> = {
  // Andalucía
  "Almería": "Andalucía", "Cádiz": "Andalucía", "Córdoba": "Andalucía", "Granada": "Andalucía",
  "Huelva": "Andalucía", "Jaén": "Andalucía", "Málaga": "Andalucía", "Sevilla": "Andalucía",
  // Aragón
  "Huesca": "Aragón", "Teruel": "Aragón", "Zaragoza": "Aragón",
  // Principado de Asturias
  "Asturias": "Principado de Asturias",
  // Illes Balears
  "Islas Baleares": "Illes Balears", "Illes Balears": "Illes Balears", "Baleares": "Illes Balears",
  // Canarias
  "Las Palmas": "Canarias", "Santa Cruz de Tenerife": "Canarias",
  // Cantabria
  "Cantabria": "Cantabria",
  // Castilla-La Mancha
  "Albacete": "Castilla-La Mancha", "Ciudad Real": "Castilla-La Mancha", "Cuenca": "Castilla-La Mancha",
  "Guadalajara": "Castilla-La Mancha", "Toledo": "Castilla-La Mancha",
  // Castilla y León
  "Ávila": "Castilla y León", "Burgos": "Castilla y León", "León": "Castilla y León",
  "Palencia": "Castilla y León", "Salamanca": "Castilla y León", "Segovia": "Castilla y León",
  "Soria": "Castilla y León", "Valladolid": "Castilla y León", "Zamora": "Castilla y León",
  // Cataluña
  "Barcelona": "Cataluña", "Gerona": "Cataluña", "Girona": "Cataluña",
  "Lérida": "Cataluña", "Lleida": "Cataluña", "Tarragona": "Cataluña",
  // Comunitat Valenciana
  "Alicante": "Comunitat Valenciana", "Alacant": "Comunitat Valenciana",
  "Castellón": "Comunitat Valenciana", "Castelló": "Comunitat Valenciana",
  "Valencia": "Comunitat Valenciana", "València": "Comunitat Valenciana",
  // Extremadura
  "Badajoz": "Extremadura", "Cáceres": "Extremadura",
  // Galicia
  "La Coruña": "Galicia", "A Coruña": "Galicia", "Lugo": "Galicia",
  "Orense": "Galicia", "Ourense": "Galicia", "Pontevedra": "Galicia",
  // Comunidad de Madrid
  "Madrid": "Comunidad de Madrid",
  // Región de Murcia
  "Murcia": "Región de Murcia",
  // Comunidad Foral de Navarra
  "Navarra": "Comunidad Foral de Navarra", "Nafarroa": "Comunidad Foral de Navarra",
  // País Vasco
  "Álava": "País Vasco", "Araba": "País Vasco", "Araba/Álava": "País Vasco",
  "Guipúzcoa": "País Vasco", "Gipuzkoa": "País Vasco",
  "Vizcaya": "País Vasco", "Bizkaia": "País Vasco",
  // La Rioja
  "La Rioja": "La Rioja",
  // Ciudades autónomas
  "Ceuta": "Ceuta", "Melilla": "Melilla",
};

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const NORMALIZED_LOOKUP: Record<string, string> = Object.entries(PROVINCE_TO_CCAA).reduce(
  (acc, [province, ccaa]) => {
    acc[normalizeKey(province)] = ccaa;
    return acc;
  },
  {} as Record<string, string>,
);

/**
 * Deduce la comunidad autónoma a partir de la provincia.
 * Devuelve "" si la provincia está vacía o no se reconoce (el usuario puede
 * entonces elegirla a mano: opera en otra comunidad o el dato viene sucio).
 */
export function comunidadForProvince(province: string | null | undefined): string {
  if (!province) return "";
  return NORMALIZED_LOOKUP[normalizeKey(province)] || "";
}
