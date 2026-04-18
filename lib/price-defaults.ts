/**
 * Hardcoded per-sector price defaults.
 * Used as fallback when sector_config.default_prices is empty in the DB.
 * Also provides fallback categories, subcategories, and units per sector.
 */

export interface DefaultPriceItem {
  name: string;
  category: string;
  subcategory: string;
  unit: string;
  price: number;
}

export interface SectorPriceConfig {
  categories: { value: string; label: string }[];
  subcategories: Record<string, string[]>;
  units: string[];
  defaults: DefaultPriceItem[];
  placeholder: string;
}

const construccion: SectorPriceConfig = {
  categories: [
    { value: "material", label: "Material" },
    { value: "mano_obra", label: "Mano de obra" },
    { value: "maquinaria", label: "Maquinaria" },
    { value: "otros", label: "Otros" },
  ],
  subcategories: {
    material: ["Fontanería", "Electricidad", "Albañilería", "Pintura", "Carpintería", "Climatización", "Cristalería", "Cerrajería", "Impermeabilización", "Otros"],
    mano_obra: ["Oficial 1ª", "Oficial 2ª", "Peón", "Especialista", "Subcontrata", "Otros"],
    maquinaria: ["Alquiler", "Transporte", "Herramientas"],
    otros: ["Gestión residuos", "Permisos", "Seguros", "Otros"],
  },
  units: ["ud", "m2", "ml", "h", "kg", "global", "m3", "l"],
  defaults: [
    { name: "Azulejo porcelánico m²", category: "material", subcategory: "Albañilería", unit: "m2", price: 22.50 },
    { name: "Cemento cola flexible 25kg", category: "material", subcategory: "Albañilería", unit: "ud", price: 8.90 },
    { name: "Plato ducha resina 120x80", category: "material", subcategory: "Fontanería", unit: "ud", price: 185.00 },
    { name: "Mampara cristal 8mm", category: "material", subcategory: "Fontanería", unit: "ud", price: 320.00 },
    { name: "Grifo monomando lavabo", category: "material", subcategory: "Fontanería", unit: "ud", price: 65.00 },
    { name: "Cable libre halógenos 2.5mm (100m)", category: "material", subcategory: "Electricidad", unit: "ud", price: 42.00 },
    { name: "Mecanismo Schuko empotrable", category: "material", subcategory: "Electricidad", unit: "ud", price: 8.50 },
    { name: "Downlight LED 18W empotrable", category: "material", subcategory: "Electricidad", unit: "ud", price: 12.90 },
    { name: "Pintura plástica mate 15L", category: "material", subcategory: "Pintura", unit: "ud", price: 45.00 },
    { name: "Oficial albañilería (h)", category: "mano_obra", subcategory: "Oficial 1ª", unit: "h", price: 28.00 },
    { name: "Oficial fontanero (h)", category: "mano_obra", subcategory: "Oficial 1ª", unit: "h", price: 32.00 },
    { name: "Oficial electricista (h)", category: "mano_obra", subcategory: "Oficial 1ª", unit: "h", price: 30.00 },
    { name: "Oficial pintor (h)", category: "mano_obra", subcategory: "Oficial 1ª", unit: "h", price: 25.00 },
  ],
  placeholder: "Ej: Azulejo porcelánico 30x60",
};

const comercio_local: SectorPriceConfig = {
  categories: [
    { value: "producto", label: "Producto" },
    { value: "servicio", label: "Servicio" },
    { value: "logistica", label: "Logística" },
    { value: "packaging", label: "Packaging" },
    { value: "marketing", label: "Marketing" },
    { value: "otros", label: "Otros" },
  ],
  subcategories: {
    producto: ["Ropa", "Calzado", "Accesorios", "Alimentación", "Hogar", "Electrónica", "Otros"],
    servicio: ["Reparación", "Personalización", "Asesoría", "Instalación", "Otros"],
    logistica: ["Transporte nacional", "Transporte internacional", "Almacenaje", "Mensajería", "Otros"],
    packaging: ["Cajas", "Embalaje", "Etiquetado", "Bolsas", "Otros"],
    marketing: ["Cartelería", "Digital", "Escaparate", "Eventos", "Otros"],
    otros: ["Seguros", "Licencias", "Software", "Otros"],
  },
  units: ["ud", "pack", "caja", "palet", "kg", "h", "mes", "global"],
  defaults: [
    { name: "Envío nacional estándar", category: "logistica", subcategory: "Transporte nacional", unit: "ud", price: 5.50 },
    { name: "Envío express 24h", category: "logistica", subcategory: "Transporte nacional", unit: "ud", price: 8.90 },
    { name: "Envío internacional EU", category: "logistica", subcategory: "Transporte internacional", unit: "ud", price: 12.00 },
    { name: "Almacenaje palet (mes)", category: "logistica", subcategory: "Almacenaje", unit: "palet", price: 25.00 },
    { name: "Caja cartón 40x30x20", category: "packaging", subcategory: "Cajas", unit: "ud", price: 0.85 },
    { name: "Sobre acolchado", category: "packaging", subcategory: "Embalaje", unit: "ud", price: 0.35 },
    { name: "Etiquetas adhesivas (rollo 500)", category: "packaging", subcategory: "Etiquetado", unit: "ud", price: 12.00 },
    { name: "Film estirable (rollo)", category: "packaging", subcategory: "Embalaje", unit: "ud", price: 6.50 },
    { name: "Bolsa de papel con asa (100 uds)", category: "packaging", subcategory: "Bolsas", unit: "pack", price: 18.00 },
    { name: "Tarjetas de visita (500 uds)", category: "marketing", subcategory: "Cartelería", unit: "pack", price: 25.00 },
    { name: "Campaña Google Ads (gestión mes)", category: "marketing", subcategory: "Digital", unit: "mes", price: 150.00 },
    { name: "Diseño banner promocional", category: "marketing", subcategory: "Digital", unit: "ud", price: 35.00 },
    { name: "Escaparate estacional", category: "marketing", subcategory: "Escaparate", unit: "ud", price: 80.00 },
    { name: "TPV software (licencia mes)", category: "otros", subcategory: "Software", unit: "mes", price: 29.90 },
    { name: "Seguro responsabilidad civil", category: "otros", subcategory: "Seguros", unit: "global", price: 350.00 },
  ],
  placeholder: "Ej: Camiseta básica algodón M/L/XL",
};

const sectorPriceConfigs: Record<string, SectorPriceConfig> = {
  construccion,
  comercio_local,
};

/**
 * Returns the price config for a normalized sector.
 * Normalized sector is either "construccion" or "comercio_local".
 */
export function getSectorPriceConfig(normalizedSector: string): SectorPriceConfig {
  return sectorPriceConfigs[normalizedSector] || construccion;
}

/**
 * Returns all possible sector aliases for querying sector_data.
 * e.g., "comercio_local" → ["comercio_local", "comercio", "retail"]
 */
export function getSectorAliases(normalizedSector: string): string[] {
  if (normalizedSector === "comercio_local") {
    return ["comercio_local", "comercio", "retail"];
  }
  return [normalizedSector];
}
