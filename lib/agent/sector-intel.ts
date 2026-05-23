// lib/agent/sector-intel.ts
// Fuente de verdad de la "inteligencia" específica por subsector de comercio local.
// Se resuelve por profiles.business_sector (mismas claves que sectorConfigs).

export interface SectorSeasonalFocus {
  key: string;
  name: string;
  months: number[]; // 1-12
  note: string; // qué debe hacer/recordar el negocio en esa ventana
}

export interface SectorIntelProfile {
  sector_key: string;
  news_queries: string[]; // Google News RSS; {ciudad} se interpola server-side
  news_max_items: number;
  kpis_focus: string[];
  seasonal_focus: SectorSeasonalFocus[];
  campaign_archetypes: string[];
  regulatory_notes: string[];
  supplier_types: string[];
}

const hosteleria: SectorIntelProfile = {
  sector_key: "hosteleria",
  news_queries: [
    "hostelería España noticias",
    "precio materias primas restauración",
    "precio aceite de oliva mayorista",
    "normativa terrazas {ciudad}",
    "convenio hostelería {ciudad}",
    "tendencias restauración 2026",
  ],
  news_max_items: 5,
  kpis_focus: [
    "Ticket medio",
    "Food cost % (coste de materia prima / ventas)",
    "Ocupación y rotación de mesas",
    "Mermas y desperdicio",
    "Ventas por franja (comida vs cena)",
    "Coste de personal / ventas",
  ],
  seasonal_focus: [
    { key: "terrazas_verano", name: "Temporada de terrazas", months: [5, 6, 7, 8, 9], note: "Buen tiempo: maximiza terraza, carta fresca y de temporada, amplía horario de tarde." },
    { key: "cenas_empresa", name: "Cenas de empresa de Navidad", months: [11, 12], note: "Abre reservas de grupos en noviembre; menús cerrados y anticipo de reserva." },
    { key: "comuniones_bodas", name: "Comuniones y celebraciones", months: [4, 5, 6], note: "Menús de grupo y catering; promociona salón/reservados." },
    { key: "cuesta_enero", name: "Cuesta de enero", months: [1], note: "Menús económicos y fidelización para sostener afluencia en mes flojo." },
    { key: "san_valentin", name: "San Valentín", months: [2], note: "Menú para parejas con reserva anticipada." },
    { key: "verano_turistico", name: "Verano turístico", months: [7, 8], note: "Carta en inglés, horarios adaptados a turistas, platos estrella visibles." },
  ],
  campaign_archetypes: [
    "Menú del día rotativo con producto de temporada",
    "Happy hour en franja valle (17-19h) para llenar horas muertas",
    "Reserva anticipada de cenas de empresa con detalle de regalo",
    "Programa de fidelización: la 10ª comida con descuento",
    "Evento temático entre semana (cata, música en vivo) para días flojos",
    "Promo de terraza + bebida de bienvenida cuando hace buen tiempo",
    "Destacar opciones sin alérgenos / veganas para captar público nuevo",
  ],
  regulatory_notes: [
    "APPCC: registro de temperaturas de cámaras y partes de limpieza",
    "Información de alérgenos obligatoria en carta (Reglamento UE 1169/2011)",
    "Carné de manipulador de alimentos del personal",
    "Licencia y normativa municipal de terrazas / ocupación de vía pública",
    "Registro horario de jornada (convenio de hostelería)",
  ],
  supplier_types: [
    "Distribuidor de alimentación/horeca (Makro, Mercadona Negocios)",
    "Bodega / distribuidor de bebidas",
    "Producto fresco (mercado, lonja, frutería mayorista)",
    "Lavandería de mantelería y uniformes",
    "Mantenimiento de cocina y cámaras frigoríficas",
  ],
};

const estetica: SectorIntelProfile = {
  sector_key: "estetica",
  news_queries: [
    "tendencias peluquería 2026",
    "novedades productos estética profesional",
    "normativa centros de estética {ciudad}",
    "precio productos peluquería mayorista",
    "formación coloración tendencias",
  ],
  news_max_items: 5,
  kpis_focus: [
    "Ocupación de agenda (% de horas reservadas)",
    "Tasa de rebooking (clientes que dejan la siguiente cita reservada)",
    "Ticket medio por servicio",
    "Ratio venta de producto vs servicio",
    "Nuevos clientes vs recurrentes",
    "Huecos sin cubrir por franja horaria",
  ],
  seasonal_focus: [
    { key: "temporada_bodas", name: "Temporada de bodas", months: [4, 5, 6, 7, 8, 9], note: "Recogidos y color; paquetes novia/invitada con prueba previa." },
    { key: "navidad_fiesta", name: "Navidad y Nochevieja", months: [12], note: "Peinados y maquillaje de fiesta; packs regalo y venta de bonos." },
    { key: "post_verano", name: "Recuperación post-verano", months: [9], note: "Tratamientos post-sol y recuperación capilar; retomar rutina." },
    { key: "san_valentin", name: "San Valentín", months: [2], note: "Bonos pareja y tarjetas regalo." },
    { key: "pre_verano", name: "Puesta a punto pre-verano", months: [4, 5], note: "Depilación, uñas y cambios de look antes del verano." },
  ],
  campaign_archetypes: [
    "Bono prepago de X sesiones con descuento por adelantado",
    "Promo 'trae a una amiga' con descuento para ambas",
    "Paquete novia/invitada (prueba + día del evento)",
    "Tarjeta de fidelización: 10º servicio con descuento",
    "Recordatorio automático de rebooking a las 4-6 semanas",
    "Venta cruzada de producto profesional en cabina",
    "Promo de franja valle (mañanas entre semana) para llenar agenda",
  ],
  regulatory_notes: [
    "Gestión de residuos de productos químicos (tintes, peróxidos)",
    "RGPD en fotos antes/después: consentimiento explícito del cliente",
    "Esterilización y desinfección de material (normativa sanitaria)",
    "Autorización del centro según normativa de la CCAA",
  ],
  supplier_types: [
    "Distribuidor de producto profesional (L'Oréal Pro, Wella, Schwarzkopf...)",
    "Proveedor de aparatología estética",
    "Consumibles (toallas, guantes, papel, productos de un solo uso)",
    "Software de gestión de citas",
  ],
};

const comercio: SectorIntelProfile = {
  sector_key: "comercio",
  news_queries: [
    "comercio minorista España noticias",
    "tendencias retail 2026",
    "calendario rebajas {ciudad}",
    "consumo minorista IPC España",
    "campaña comercial {ciudad}",
  ],
  news_max_items: 5,
  kpis_focus: [
    "Ticket medio",
    "Unidades por ticket",
    "Rotación de stock / días de inventario",
    "Margen bruto por familia de producto",
    "Conversión de visitantes (si hay tráfico medible)",
    "Stock muerto (productos sin rotación)",
  ],
  seasonal_focus: [
    { key: "rebajas_invierno", name: "Rebajas de invierno", months: [1], note: "Liquida temporada; comunica precio anterior y descuento real." },
    { key: "rebajas_verano", name: "Rebajas de verano", months: [7], note: "Liquidación de temporada y captación con ofertas." },
    { key: "black_friday", name: "Black Friday / Cyber Monday", months: [11], note: "Campaña fuerte; prepara stock y comunicación con antelación." },
    { key: "navidad", name: "Campaña de Navidad", months: [12], note: "Horario ampliado, envoltorio regalo, packs y tarjetas regalo." },
    { key: "dias_especiales", name: "Día de la Madre/Padre y San Valentín", months: [2, 3, 5], note: "Ideas de regalo destacadas y packs temáticos." },
  ],
  campaign_archetypes: [
    "Liquidación de stock estacional o de baja rotación",
    "Programa de puntos / fidelización",
    "Click & collect: reserva online y recogida en tienda",
    "Pack producto + complemento con descuento",
    "Escaparate temático por campaña",
    "Promo flash de fin de semana",
    "Preventa de novedades a clientes VIP",
  ],
  regulatory_notes: [
    "Normativa de rebajas: mostrar el precio anterior",
    "Etiquetado, precios y garantías legales",
    "Hoja de reclamaciones disponible",
    "Política de devoluciones según la ley de consumidores",
  ],
  supplier_types: [
    "Marcas y mayoristas del producto",
    "Proveedor de packaging y bolsas",
    "Logística y transporte (envíos)",
    "Software TPV y pasarela de pago",
  ],
};

const salud: SectorIntelProfile = {
  sector_key: "salud",
  news_queries: [
    "sector clínicas privadas España",
    "normativa sanitaria centros {ciudad}",
    "tendencias fisioterapia odontología",
    "precios tratamientos sanitarios privados",
  ],
  news_max_items: 4,
  kpis_focus: [
    "Ocupación de agenda por profesional",
    "Tasa de no-show (citas perdidas)",
    "Ticket medio por tratamiento",
    "Adherencia / recurrencia a tratamientos",
    "Nuevos pacientes",
    "Tiempo medio por sesión",
  ],
  seasonal_focus: [
    { key: "vuelta_vacaciones", name: "Vuelta de vacaciones", months: [9], note: "Revisiones y retomar tratamientos interrumpidos en verano." },
    { key: "propositos_año", name: "Propósitos de año nuevo", months: [1], note: "Nutrición, fisio y salud: capta los buenos propósitos." },
    { key: "pre_verano", name: "Puesta a punto pre-verano", months: [4, 5], note: "Campañas de prevención y revisión antes del verano." },
  ],
  campaign_archetypes: [
    "Primera visita / revisión con descuento de captación",
    "Bono de sesiones (fisioterapia, nutrición)",
    "Recordatorio de revisión anual",
    "Programa de seguimiento y adherencia al tratamiento",
    "Convenios con empresas y mutuas",
    "Recordatorio automático de cita para reducir no-shows",
  ],
  regulatory_notes: [
    "Datos de salud: RGPD categoría especial, consentimiento informado",
    "Autorización sanitaria del centro y profesionales colegiados",
    "Gestión de residuos sanitarios",
    "Conservación de historia clínica según normativa",
  ],
  supplier_types: [
    "Material sanitario y fungible",
    "Laboratorio (dental / análisis)",
    "Aparatología médica",
    "Software de gestión clínica",
  ],
};

const automocion: SectorIntelProfile = {
  sector_key: "automocion",
  news_queries: [
    "sector taller automoción España",
    "normativa ITV {ciudad}",
    "precio recambios automóvil",
    "taller vehículo eléctrico tendencias",
  ],
  news_max_items: 4,
  kpis_focus: [
    "Ocupación de elevadores / box",
    "Ticket medio por reparación",
    "Tasa de retorno de clientes",
    "Tiempo medio de reparación",
    "Ratio mano de obra vs recambios",
    "Garantías y reclamaciones",
  ],
  seasonal_focus: [
    { key: "pre_verano", name: "Revisión pre-vacaciones", months: [5, 6], note: "Aire acondicionado, neumáticos y revisión de viaje (operación salida)." },
    { key: "pre_invierno", name: "Puesta a punto de invierno", months: [10, 11], note: "Batería, anticongelante y neumáticos de cara al frío." },
  ],
  campaign_archetypes: [
    "Revisión pre-vacaciones con descuento",
    "Cambio de neumáticos por temporada",
    "Mantenimiento programado con recordatorio automático",
    "Promo cambio de aceite + filtros",
    "Diagnóstico gratuito de aire acondicionado",
    "Fidelización: revisión gratuita tras X reparaciones",
  ],
  regulatory_notes: [
    "Gestión de residuos peligrosos (aceites usados, baterías)",
    "Placa de identificación y registro del taller",
    "Presupuesto previo obligatorio; conservar piezas sustituidas si el cliente lo pide",
    "Garantía legal de la reparación",
  ],
  supplier_types: [
    "Distribuidor de recambios",
    "Proveedor de neumáticos",
    "Aceites y lubricantes",
    "Software de gestión de taller",
  ],
};

const defaultProfile: SectorIntelProfile = {
  sector_key: "default",
  news_queries: [
    "pequeño comercio {ciudad} noticias",
    "ayudas autónomos pymes España",
    "consumo España IPC",
  ],
  news_max_items: 4,
  kpis_focus: [
    "Ventas del periodo y comparativa",
    "Ticket medio",
    "Clientes nuevos vs recurrentes",
    "Productos/servicios más vendidos",
  ],
  seasonal_focus: [
    { key: "rebajas", name: "Rebajas", months: [1, 7], note: "Aprovecha las ventanas de rebajas para liquidar y captar." },
    { key: "navidad", name: "Campaña de Navidad", months: [11, 12], note: "Pico de consumo: prepara stock, regalos y comunicación." },
  ],
  campaign_archetypes: [
    "Programa de fidelización básico",
    "Promo de temporada",
    "Captación 'recomienda y gana'",
    "Pack o descuento por volumen",
  ],
  regulatory_notes: [
    "RGPD en datos de clientes",
    "Hoja de reclamaciones y condiciones de venta visibles",
  ],
  supplier_types: [
    "Proveedor principal de producto/servicio",
    "Logística / transporte",
    "Software de gestión y cobro",
  ],
};

export const SECTOR_INTEL: Record<string, SectorIntelProfile> = {
  hosteleria,
  estetica,
  comercio,
  salud,
  automocion,
  default: defaultProfile,
};

/**
 * Resuelve el perfil de inteligencia para una clave de sector.
 * Acepta alias de comercio local genérico y cae al default si no hay match.
 */
export function getSectorIntel(sectorKey: string | null | undefined): SectorIntelProfile {
  const key = (sectorKey || "").toLowerCase().trim();
  if (SECTOR_INTEL[key]) return SECTOR_INTEL[key];
  if (key === "comercio_local" || key === "retail" || key === "comercio") return SECTOR_INTEL.comercio;
  if (key === "peluqueria" || key === "belleza") return SECTOR_INTEL.estetica;
  if (key === "restaurante" || key === "bar" || key === "cafeteria") return SECTOR_INTEL.hosteleria;
  return SECTOR_INTEL.default;
}

/**
 * Interpola {ciudad} (y futuros placeholders) en las queries de noticias.
 * Llamar en /api/agent/config con la ciudad del negocio.
 */
export function resolveNewsQueries(profile: SectorIntelProfile, city: string | null | undefined): string[] {
  const c = (city || "España").trim();
  return profile.news_queries.map((q) => q.replace(/\{ciudad\}/g, c));
}
