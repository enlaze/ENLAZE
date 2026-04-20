/**
 * Hardcoded per-sector price defaults.
 * Used as fallback when sector_config.default_prices is empty in the DB.
 * Also provides fallback categories, subcategories, and units per sector.
 */

/* ---------- Base interface (backwards-compatible) ---------- */
export interface DefaultPriceItem {
  name: string;
  category: string;
  subcategory: string;
  unit: string;
  /** For construction = unit_price.  For retail = recommended sale price (sin IVA). */
  price: number;
  /* ---- Retail-only optional fields ---- */
  brand?: string;
  format?: string;
  purchase_price?: number;
  recommended_sale_price?: number;
  vat_rate?: number;
  gross_margin_pct?: number;
  supplier_name?: string;
  business_subsector?: string;
  family?: string;
}

export interface SectorPriceConfig {
  categories: { value: string; label: string }[];
  subcategories: Record<string, string[]>;
  units: string[];
  defaults: DefaultPriceItem[];
  placeholder: string;
}

/* =========================================================
   CONSTRUCCIÓN  (unchanged — do not touch)
   ========================================================= */
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

/* =========================================================
   COMERCIO LOCAL / RETAIL
   ========================================================= */
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
    // ─── PACKAGING ───
    { name: "Caja cartón envíos 40x30x20", category: "packaging", subcategory: "Cajas", unit: "ud", price: 0.85, purchase_price: 0.45, recommended_sale_price: 0.85, gross_margin_pct: 47.1, vat_rate: 21, supplier_name: "Cartonajes Ibéricos", family: "packaging", business_subsector: "retail_general" },
    { name: "Bolsa papel Kraft asa rizada (100 uds)", category: "packaging", subcategory: "Bolsas", unit: "pack", price: 18.00, purchase_price: 10.50, recommended_sale_price: 18.00, gross_margin_pct: 41.7, vat_rate: 21, supplier_name: "EcoBolsas", family: "packaging", business_subsector: "retail_general" },
    { name: "Papel de seda relleno (resma)", category: "packaging", subcategory: "Embalaje", unit: "ud", price: 15.00, purchase_price: 8.50, recommended_sale_price: 15.00, gross_margin_pct: 43.3, vat_rate: 21, supplier_name: "Papelera del Norte", family: "packaging", business_subsector: "retail_general" },

    // ─── LOGÍSTICA ───
    { name: "Envío estándar península (2-3 días)", category: "logistica", subcategory: "Transporte nacional", unit: "ud", price: 4.90, purchase_price: 3.50, recommended_sale_price: 4.90, gross_margin_pct: 28.6, vat_rate: 21, supplier_name: "Correos Express", family: "logística", business_subsector: "retail_general" },
    { name: "Envío express 24h", category: "logistica", subcategory: "Transporte nacional", unit: "ud", price: 8.50, purchase_price: 6.00, recommended_sale_price: 8.50, gross_margin_pct: 29.4, vat_rate: 21, supplier_name: "Seur", family: "logística", business_subsector: "retail_general" },

    // ─── TPV/OPERACIONES ───
    { name: "Licencia software TPV (mensual)", category: "otros", subcategory: "Software", unit: "mes", price: 39.00, purchase_price: 39.00, recommended_sale_price: 39.00, gross_margin_pct: 0.0, vat_rate: 21, brand: "Square", supplier_name: "Square Inc", family: "TPV/operaciones", business_subsector: "retail_general" },
    { name: "Rollo papel térmico tickets (pack 8)", category: "otros", subcategory: "Material oficina", unit: "pack", price: 6.50, purchase_price: 3.80, recommended_sale_price: 6.50, gross_margin_pct: 41.5, vat_rate: 21, supplier_name: "OfiMarket", family: "TPV/operaciones", business_subsector: "retail_general" },

    // ─── CONSUMIBLES TIENDA ───
    { name: "Ambientador profesional tienda", category: "otros", subcategory: "Limpieza", unit: "ud", price: 12.50, purchase_price: 8.00, recommended_sale_price: 12.50, gross_margin_pct: 36.0, vat_rate: 21, brand: "Scentia", supplier_name: "Aromas Store", family: "consumibles tienda", business_subsector: "retail_general" },
    { name: "Bolsas de basura 50L (rollo)", category: "otros", subcategory: "Limpieza", unit: "ud", price: 3.50, purchase_price: 2.10, recommended_sale_price: 3.50, gross_margin_pct: 40.0, vat_rate: 21, supplier_name: "Distribuciones Limpieza", family: "consumibles tienda", business_subsector: "retail_general" },

    // ─── MARKETING/MERCHANDISING ───
    { name: "Tarjetas de fidelización (500 uds)", category: "marketing", subcategory: "Cartelería", unit: "pack", price: 35.00, purchase_price: 20.00, recommended_sale_price: 35.00, gross_margin_pct: 42.9, vat_rate: 21, supplier_name: "Imprenta Online", family: "marketing/merchandising", business_subsector: "retail_general" },
    { name: "Display escaparate temporada", category: "marketing", subcategory: "Escaparate", unit: "ud", price: 85.00, purchase_price: 50.00, recommended_sale_price: 85.00, gross_margin_pct: 41.2, vat_rate: 21, supplier_name: "Visual Merchandising Pro", family: "marketing/merchandising", business_subsector: "retail_general" },

    // ─── COMISIONES PAGOS / MARKETPLACE ───
    { name: "Comisión pasarela de pago (tarjeta)", category: "otros", subcategory: "Financiero", unit: "ud", price: 0.35, purchase_price: 0.35, recommended_sale_price: 0.35, gross_margin_pct: 0.0, vat_rate: 0, supplier_name: "Redsys", family: "comisiones pagos / marketplace", business_subsector: "retail_general" },
    { name: "Comisión venta marketplace", category: "otros", subcategory: "Financiero", unit: "ud", price: 15.00, purchase_price: 15.00, recommended_sale_price: 15.00, gross_margin_pct: 0.0, vat_rate: 21, supplier_name: "Miravia/Amazon", family: "comisiones pagos / marketplace", business_subsector: "retail_general" },

    // ─── DEVOLUCIONES / ATENCIÓN AL CLIENTE ───
    { name: "Gestión etiqueta retorno", category: "servicio", subcategory: "Atención al cliente", unit: "ud", price: 3.50, purchase_price: 3.50, recommended_sale_price: 3.50, gross_margin_pct: 0.0, vat_rate: 21, supplier_name: "Correos Express", family: "devoluciones / atención al cliente", business_subsector: "retail_general" },
    { name: "Vale descuento compensación", category: "marketing", subcategory: "Atención al cliente", unit: "ud", price: 10.00, purchase_price: 10.00, recommended_sale_price: 10.00, gross_margin_pct: 0.0, vat_rate: 21, supplier_name: "Interno", family: "devoluciones / atención al cliente", business_subsector: "retail_general" }
  ],
  placeholder: "Ej: Camiseta básica algodón M/L/XL",
};

/* ========================================================= */

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
