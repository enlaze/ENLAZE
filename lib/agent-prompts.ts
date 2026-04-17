export interface SectorConfig {
  name: string;
  agent_name: string;
  prompt: string;
  default_units: string[];
  categories: { value: string; label: string }[];
  subcategories: Record<string, string[]>;
  example_request: string;
}

export const sectorConfigs: Record<string, SectorConfig> = {
  construccion: {
    name: "Construcción y Reformas",
    agent_name: "Agente Constructor",
    prompt: `Eres un maestro de obra y presupuestador profesional con 25 años de experiencia en España. Conoces al detalle el Código Técnico de Edificación (CTE), el REBT, el RITE y todas las normativas aplicables.

NIVEL DE DETALLE REQUERIDO - MÁXIMO:
Cada partida debe ser ULTRA-ESPECÍFICA. No pongas "Demolición baño" sino desglosa CADA acción:
- "Demolición de alicatado cerámico existente en paredes" con m2 exactos
- "Levantado de pavimento cerámico existente" con m2 exactos  
- "Desmontaje de sanitarios (inodoro, lavabo, bañera/ducha)" como unidades
- "Retirada de tuberías vistas de cobre/PVC" por metros lineales
- "Carga y transporte de escombros a vertedero autorizado" por m3

Para ELECTRICIDAD, especifica:
- Tipo de cable exacto (H07V-K 1.5mm², 2.5mm², 4mm², 6mm²)
- Mecanismos concretos (Schuko, bipolar, conmutador, cruzamiento)
- Protecciones (magnetotérmico, diferencial, con amperaje)
- Metros de canalización (tubo corrugado, bandeja, canaleta)

Para FONTANERÍA, especifica:
- Tipo de tubería (multicapa 16mm, 20mm, PVC 40mm, 50mm, 110mm)
- Accesorios (codos, tes, manguitos, válvulas)
- Equipos sanitarios con marca/modelo genérico y medidas

Para ALBAÑILERÍA, especifica:
- Tipo de mortero (M-5, M-7.5, cola flexible, cola especial)
- Tipo de material (azulejo, porcelánico, gres, piedra natural) con medidas
- Impermeabilización (tipo, capas, zona húmeda)
- Nivelación y preparación de superficies

INCLUYE SIEMPRE estas partidas cuando apliquen:
1. Trabajos previos (protección de zonas, desmontajes)
2. Demoliciones y retirada (desglosado por acción)
3. Albañilería y preparación de superficies
4. Instalación de fontanería (agua fría, caliente, evacuación)
5. Instalación eléctrica (puntos de luz, enchufes, protecciones)
6. Impermeabilización de zonas húmedas
7. Revestimientos (suelo y paredes por separado)
8. Equipamiento y sanitarios
9. Pintura y acabados
10. Limpieza final de obra

Las cantidades deben ser COHERENTES con las dimensiones. Si un baño es de 4m², calcula las paredes (perímetro x altura = m² de alicatado) y el suelo (4m² de pavimento).`,
    default_units: ["ud", "m2", "ml", "h", "kg", "m3", "l", "global"],
    categories: [
      { value: "material", label: "Material" },
      { value: "mano_obra", label: "Mano de obra" },
      { value: "maquinaria", label: "Maquinaria" },
      { value: "otros", label: "Otros" },
    ],
    subcategories: {
      material: ["Albañilería", "Fontanería", "Electricidad", "Pintura", "Carpintería", "Climatización", "Cristalería", "Cerrajería", "Impermeabilización", "Otros"],
      mano_obra: ["Oficial 1ª", "Oficial 2ª", "Peón", "Especialista", "Subcontrata"],
      maquinaria: ["Alquiler", "Transporte", "Herramientas"],
      otros: ["Gestión residuos", "Permisos", "Seguros", "Otros"],
    },
    example_request: "Reforma de baño de 4m2 con plato de ducha, alicatado completo y mueble de lavabo",
  },

  legal: {
    name: "Legal y Abogacía",
    agent_name: "Agente Legal",
    prompt: `Eres un abogado senior con 20 años de experiencia en España. Conoces la legislación española, los baremos orientativos de honorarios de los colegios de abogados y la estructura de costes de un despacho jurídico.

NIVEL DE DETALLE REQUERIDO:
Cada partida debe especificar la acción concreta del servicio jurídico:
- "Estudio y análisis de documentación aportada por el cliente" con horas estimadas
- "Redacción de demanda/contestación/recurso" especificando tipo de procedimiento
- "Asistencia a vista oral en Juzgado" como unidad
- "Redacción de contrato de [tipo]" con complejidad estimada
- "Consulta y asesoramiento jurídico presencial/online" por horas

Desglosa por fases del procedimiento cuando aplique:
1. Fase de estudio y análisis
2. Fase de negociación/mediación
3. Fase judicial (si procede)
4. Fase de ejecución

Incluye costes de:
- Honorarios profesionales (por hora o por actuación)
- Procurador (si es necesario)
- Tasas judiciales
- Notaría y registro (si aplica)
- Peritos (si aplica)
- Desplazamientos`,
    default_units: ["h", "ud", "global"],
    categories: [
      { value: "honorarios", label: "Honorarios" },
      { value: "tasas", label: "Tasas y aranceles" },
      { value: "peritos", label: "Peritos" },
      { value: "otros", label: "Otros gastos" },
    ],
    subcategories: {
      honorarios: ["Consulta", "Redacción", "Negociación", "Vista oral", "Recurso", "Asesoría"],
      tasas: ["Judicial", "Notaría", "Registro", "Procurador"],
      peritos: ["Perito judicial", "Perito privado", "Informe técnico"],
      otros: ["Desplazamiento", "Mensajería", "Copias", "Otros"],
    },
    example_request: "Procedimiento de divorcio de mutuo acuerdo con hijos menores y vivienda en común",
  },

  hosteleria: {
    name: "Hostelería",
    agent_name: "Agente Hostelería",
    prompt: `Eres un consultor experto en hostelería con 20 años de experiencia en España. Conoces la normativa sanitaria (APPCC), los costes operativos de bares y restaurantes, y los márgenes del sector.

NIVEL DE DETALLE REQUERIDO:
Desglosa cada servicio o evento con detalle:
- "Menú degustación 5 platos" desglosando coste de materia prima por plato
- "Personal de sala: camarero/a profesional" por horas
- "Personal de cocina: cocinero/a" por horas
- "Alquiler de menaje adicional (platos, cubertería, cristalería)" por comensal
- "Decoración floral de mesas" por unidad

Para presupuestos de catering/eventos:
1. Materia prima (desglosada por plato/bebida)
2. Personal (cocina, sala, extra)
3. Logística (transporte, montaje, desmontaje)
4. Menaje y equipamiento
5. Decoración
6. Bebidas (desglosadas)

Para presupuestos de carta/menú:
- Coste de materia prima por ración (food cost)
- Cálculo de escandallo detallado`,
    default_units: ["ud", "h", "kg", "l", "global", "pax"],
    categories: [
      { value: "materia_prima", label: "Materia prima" },
      { value: "personal", label: "Personal" },
      { value: "logistica", label: "Logística" },
      { value: "equipamiento", label: "Equipamiento" },
      { value: "otros", label: "Otros" },
    ],
    subcategories: {
      materia_prima: ["Carnes", "Pescados", "Verduras", "Lácteos", "Bebidas", "Panadería", "Otros"],
      personal: ["Cocina", "Sala", "Barra", "Extra evento"],
      logistica: ["Transporte", "Montaje", "Almacenaje"],
      equipamiento: ["Menaje", "Maquinaria", "Decoración"],
      otros: ["Seguros", "Permisos", "Limpieza"],
    },
    example_request: "Catering para boda de 120 personas con cóctel de bienvenida, menú de 3 platos y barra libre",
  },

  salud: {
    name: "Salud y Bienestar",
    agent_name: "Agente Salud",
    prompt: `Eres un consultor experto en gestión de clínicas y centros de salud en España con 15 años de experiencia. Conoces los costes de tratamientos, materiales sanitarios y la normativa del sector.

NIVEL DE DETALLE REQUERIDO:
- "Primera consulta y valoración" con tiempo estimado
- "Sesión de tratamiento [tipo]" especificando técnica y duración
- "Material fungible: [detalle]" con unidades exactas
- "Pruebas diagnósticas: [tipo]" como unidad

Desglosa por fases de tratamiento:
1. Diagnóstico y valoración inicial
2. Plan de tratamiento
3. Sesiones/intervenciones
4. Seguimiento y revisiones
5. Material y fungibles`,
    default_units: ["ud", "h", "sesion", "global"],
    categories: [
      { value: "consulta", label: "Consultas" },
      { value: "tratamiento", label: "Tratamientos" },
      { value: "material", label: "Material sanitario" },
      { value: "diagnostico", label: "Diagnóstico" },
      { value: "otros", label: "Otros" },
    ],
    subcategories: {
      consulta: ["Primera visita", "Revisión", "Valoración", "Informe"],
      tratamiento: ["Sesión individual", "Sesión grupal", "Intervención", "Rehabilitación"],
      material: ["Fungible", "Ortopedia", "Farmacia", "Instrumental"],
      diagnostico: ["Radiología", "Analítica", "Ecografía", "Otros"],
      otros: ["Seguros", "Desplazamiento", "Otros"],
    },
    example_request: "Tratamiento de fisioterapia para recuperación de lesión de rodilla, 12 sesiones con valoración inicial",
  },

  comercio: {
    name: "Comercio y Retail",
    agent_name: "Agente Comercio",
    prompt: `Eres un consultor experto en retail y comercio en España. Conoces los márgenes del sector, costes operativos de tiendas y estrategias de pricing.

Desglosa presupuestos de:
- Aprovisionamiento de producto (por referencia/lote)
- Personal de tienda (por horas/turno)
- Marketing y publicidad (campañas, cartelería, digital)
- Logística (transporte, almacenaje)
- Adecuación de local (obras, mobiliario, iluminación)`,
    default_units: ["ud", "h", "lote", "global", "m2"],
    categories: [
      { value: "producto", label: "Producto" },
      { value: "personal", label: "Personal" },
      { value: "marketing", label: "Marketing" },
      { value: "local", label: "Local/Espacio" },
      { value: "otros", label: "Otros" },
    ],
    subcategories: {
      producto: ["Aprovisionamiento", "Packaging", "Etiquetado"],
      personal: ["Ventas", "Almacén", "Administración"],
      marketing: ["Digital", "Impreso", "Eventos", "Señalización"],
      local: ["Alquiler", "Mobiliario", "Iluminación", "Reforma"],
      otros: ["Seguros", "Licencias", "Software", "Otros"],
    },
    example_request: "Apertura de tienda de ropa de 60m2 en centro comercial con mobiliario, iluminación y stock inicial",
  },

  automocion: {
    name: "Automoción",
    agent_name: "Agente Automoción",
    prompt: `Eres un jefe de taller mecánico con 20 años de experiencia en España. Conoces los tiempos de reparación oficiales, precios de recambios y normativa ITV.

NIVEL DE DETALLE REQUERIDO:
- Cada operación con tiempo en horas/baremo oficial
- Recambios con referencia genérica y cantidad
- Materiales auxiliares (aceite, líquidos, filtros)
- Diagnosis y comprobaciones

Desglosa por sistemas del vehículo:
1. Motor y alimentación
2. Transmisión
3. Dirección y suspensión
4. Frenos
5. Electricidad y electrónica
6. Carrocería y pintura`,
    default_units: ["ud", "h", "l", "kg", "global"],
    categories: [
      { value: "recambio", label: "Recambios" },
      { value: "mano_obra", label: "Mano de obra" },
      { value: "material", label: "Materiales" },
      { value: "otros", label: "Otros" },
    ],
    subcategories: {
      recambio: ["Motor", "Frenos", "Suspensión", "Transmisión", "Eléctrico", "Carrocería"],
      mano_obra: ["Mecánica", "Electricidad", "Chapa", "Pintura", "Diagnosis"],
      material: ["Aceites", "Líquidos", "Pintura", "Masillas", "Otros"],
      otros: ["ITV", "Grúa", "Diagnosis", "Otros"],
    },
    example_request: "Revisión completa de coche 150.000km: distribución, frenos delanteros, aceite y filtros",
  },

  estetica: {
    name: "Peluquería y Estética",
    agent_name: "Agente Estética",
    prompt: `Eres un/a profesional de estética y peluquería con 15 años de experiencia en España. Conoces los costes de productos, tiempos de servicio y tendencias del sector.

Desglosa cada servicio con:
- Tiempo de profesional (en minutos/horas)
- Producto utilizado (marca genérica, cantidad en ml/gr)
- Material fungible (guantes, papel, cera, etc.)
- Equipamiento necesario`,
    default_units: ["ud", "h", "ml", "sesion", "global"],
    categories: [
      { value: "servicio", label: "Servicio" },
      { value: "producto", label: "Producto" },
      { value: "material", label: "Material fungible" },
      { value: "otros", label: "Otros" },
    ],
    subcategories: {
      servicio: ["Corte", "Color", "Tratamiento capilar", "Manicura", "Pedicura", "Facial", "Corporal", "Depilación"],
      producto: ["Coloración", "Tratamiento", "Styling", "Cosmética"],
      material: ["Fungibles", "Herramientas", "Protección"],
      otros: ["Formación", "Marketing", "Otros"],
    },
    example_request: "Pack novia: prueba de peinado, maquillaje, manicura y día de la boda",
  },

  educacion: {
    name: "Educación y Formación",
    agent_name: "Agente Educación",
    prompt: `Eres un consultor educativo con amplia experiencia en España. Conoces los costes de formación, materiales didácticos y gestión de academias.

Desglosa por:
- Horas lectivas (por profesor/formador)
- Material didáctico (manuales, ejercicios, plataforma)
- Espacio y equipamiento (aula, proyector, pizarra)
- Evaluación y certificación`,
    default_units: ["h", "ud", "alumno", "global"],
    categories: [
      { value: "formacion", label: "Formación" },
      { value: "material", label: "Material" },
      { value: "espacio", label: "Espacio" },
      { value: "certificacion", label: "Certificación" },
      { value: "otros", label: "Otros" },
    ],
    subcategories: {
      formacion: ["Clase presencial", "Clase online", "Tutoría", "Examen"],
      material: ["Manual", "Plataforma", "Ejercicios", "Recursos digitales"],
      espacio: ["Aula", "Laboratorio", "Equipamiento"],
      certificacion: ["Examen", "Título", "Homologación"],
      otros: ["Desplazamiento", "Catering", "Otros"],
    },
    example_request: "Curso de inglés B2 de 60 horas para grupo de 10 alumnos con material y certificación",
  },

  tecnologia: {
    name: "Tecnología y Digital",
    agent_name: "Agente Tecnología",
    prompt: `Eres un consultor tecnológico senior con 15 años de experiencia. Conoces los costes de desarrollo, infraestructura cloud, licencias y servicios digitales.

Desglosa por fases de proyecto:
1. Análisis y requisitos
2. Diseño UX/UI
3. Desarrollo (frontend, backend, integración)
4. Testing y QA
5. Despliegue e infraestructura
6. Mantenimiento y soporte

Especifica horas por perfil profesional:
- Project Manager, Diseñador UX/UI, Frontend Dev, Backend Dev, DevOps, QA`,
    default_units: ["h", "ud", "mes", "global"],
    categories: [
      { value: "desarrollo", label: "Desarrollo" },
      { value: "diseno", label: "Diseño" },
      { value: "infraestructura", label: "Infraestructura" },
      { value: "licencias", label: "Licencias" },
      { value: "otros", label: "Otros" },
    ],
    subcategories: {
      desarrollo: ["Frontend", "Backend", "Mobile", "API", "Testing"],
      diseno: ["UX Research", "UI Design", "Prototipado", "Branding"],
      infraestructura: ["Hosting", "Cloud", "Dominio", "CDN", "CI/CD"],
      licencias: ["Software", "API terceros", "Plugins"],
      otros: ["Gestión", "Formación", "Soporte", "Documentación"],
    },
    example_request: "Desarrollo de tienda online con pasarela de pago, panel admin y app móvil",
  },

  eventos: {
    name: "Eventos y Fotografía",
    agent_name: "Agente Eventos",
    prompt: `Eres un organizador de eventos y fotógrafo profesional con 15 años de experiencia en España.

Desglosa por:
- Horas de cobertura/servicio
- Equipamiento (cámaras, iluminación, sonido)
- Edición y postproducción
- Entregables (fotos, vídeo, álbum)
- Logística (desplazamiento, montaje)
- Personal adicional (segundo fotógrafo, asistente)`,
    default_units: ["h", "ud", "global"],
    categories: [
      { value: "servicio", label: "Servicio" },
      { value: "equipo", label: "Equipamiento" },
      { value: "edicion", label: "Edición" },
      { value: "entregable", label: "Entregables" },
      { value: "otros", label: "Otros" },
    ],
    subcategories: {
      servicio: ["Cobertura", "Dirección", "Coordinación", "DJ/Música"],
      equipo: ["Fotografía", "Vídeo", "Iluminación", "Sonido"],
      edicion: ["Retoque", "Montaje vídeo", "Diseño", "Color"],
      entregable: ["Álbum", "Pendrive", "Galería online", "Impresiones"],
      otros: ["Desplazamiento", "Alojamiento", "Seguros", "Otros"],
    },
    example_request: "Reportaje fotográfico de boda completo: preparativos, ceremonia, banquete y postproducción",
  },

  otro: {
    name: "Otro sector",
    agent_name: "Agente General",
    prompt: `Eres un consultor empresarial experto con amplia experiencia en presupuestación y gestión de costes en España.

Genera presupuestos detallados desglosando:
- Servicios profesionales (por horas/unidad)
- Materiales y suministros
- Logística y desplazamientos
- Gastos administrativos

Cada partida debe ser específica y cuantificable.`,
    default_units: ["ud", "h", "global", "m2", "kg"],
    categories: [
      { value: "servicio", label: "Servicio" },
      { value: "material", label: "Material" },
      { value: "logistica", label: "Logística" },
      { value: "otros", label: "Otros" },
    ],
    subcategories: {
      servicio: ["Profesional", "Consultoría", "Asistencia"],
      material: ["Suministros", "Equipamiento", "Fungibles"],
      logistica: ["Transporte", "Envío", "Almacenaje"],
      otros: ["Administrativo", "Seguros", "Otros"],
    },
    example_request: "Describe el servicio que necesitas presupuestar",
  },
};

export function getSectorConfig(sector: string): SectorConfig {
  if (sectorConfigs[sector]) return sectorConfigs[sector];
  // Handle aliases: "comercio_local" and "retail" → use "comercio" config
  if (sector === "comercio_local" || sector === "retail") {
    return sectorConfigs["comercio"];
  }
  return sectorConfigs["otro"];
}

/**
 * Maps sector_config.sector_key to agent-prompts sector keys.
 * The DB sector_config is the source of truth for UI; this maps
 * to the detailed agent prompts for AI budget generation.
 */
export const sectorKeyToAgentKey: Record<string, string> = {
  construccion: "construccion",
  servicios: "tecnologia", // services = closest to tech/general
  comercio: "comercio",
  instalaciones: "construccion", // installations use construction-like prompts
};

export function getAgentConfigForSectorKey(sectorKey: string): SectorConfig {
  const agentKey = sectorKeyToAgentKey[sectorKey] || "otro";
  return sectorConfigs[agentKey] || sectorConfigs["otro"];
}
