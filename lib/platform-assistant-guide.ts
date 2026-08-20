export interface PlatformGuideEntry {
  path: string;
  label: string;
  purpose: string;
  suggestions: string[];
}

export const PLATFORM_GUIDE: PlatformGuideEntry[] = [
  {
    path: "/dashboard",
    label: "Inicio",
    purpose: "Resumen del negocio, avisos y próximos pasos.",
    suggestions: ["¿Qué debería revisar hoy?", "Explícame el panel principal"],
  },
  {
    path: "/dashboard/budgets/generate",
    label: "Generador de presupuestos",
    purpose: "Define el alcance, genera partidas, contrasta precios y prepara el presupuesto.",
    suggestions: ["¿Cómo consigo un cálculo realista?", "¿Qué significa precio verificado?"],
  },
  {
    path: "/dashboard/budgets",
    label: "Presupuestos",
    purpose: "Crea, revisa, envía y controla presupuestos.",
    suggestions: ["¿Cómo creo un presupuesto?", "¿Cómo lo convierto en factura?"],
  },
  {
    path: "/dashboard/prices/import",
    label: "Importar precios",
    purpose: "Importa tarifas CSV, Excel, PDF y bases técnicas de construcción.",
    suggestions: ["¿Cómo importo un PDF?", "¿Qué datos reviso antes de importar?"],
  },
  {
    path: "/dashboard/prices",
    label: "Rastreador de precios",
    purpose: "Consulta proveedores, cambios, cobertura y fuentes de precio.",
    suggestions: ["¿Cómo actualizo los precios?", "¿Cómo sé si un precio es real?"],
  },
  {
    path: "/dashboard/projects",
    label: "Obras y proyectos",
    purpose: "Controla avance, documentos, costes y actividad de cada obra.",
    suggestions: ["¿Cómo creo una obra?", "¿Dónde añado planos o mediciones?"],
  },
  {
    path: "/dashboard/clientes",
    label: "Clientes",
    purpose: "Gestiona contactos, historial y trabajos relacionados.",
    suggestions: ["¿Cómo añado un cliente?", "¿Dónde veo su historial?"],
  },
  {
    path: "/dashboard/issued-invoices",
    label: "Facturas emitidas",
    purpose: "Emite y controla facturas y cobros.",
    suggestions: ["¿Cómo emito una factura?", "¿Cómo marco un cobro?"],
  },
  {
    path: "/dashboard/facturas",
    label: "Facturas recibidas",
    purpose: "Registra gastos y facturas de proveedores.",
    suggestions: ["¿Cómo subo una factura?", "¿Cómo reviso el OCR?"],
  },
  {
    path: "/dashboard/suppliers",
    label: "Proveedores",
    purpose: "Centraliza contactos y relaciones con proveedores.",
    suggestions: ["¿Cómo añado un proveedor?", "¿Cómo lo vinculo a una obra?"],
  },
  {
    path: "/dashboard/settings",
    label: "Ajustes",
    purpose: "Configura empresa, fiscalidad, módulos e integraciones.",
    suggestions: ["¿Qué debo configurar primero?", "¿Dónde cambio mis datos?"],
  },
];

export function getGuideForPath(pathname: string): PlatformGuideEntry {
  return PLATFORM_GUIDE
    .filter((entry) => pathname === entry.path || pathname.startsWith(`${entry.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0] || PLATFORM_GUIDE[0];
}

export function suggestPathForQuestion(question: string): string | null {
  const text = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const matchers: Array<[RegExp, string]> = [
    [/import.*(pdf|csv|excel)|subir.*tarifa/, "/dashboard/prices/import"],
    [/rastread|precio.*proveedor|actualizar.*precio/, "/dashboard/prices"],
    [/presupuesto|recalcular|partida/, "/dashboard/budgets/generate"],
    [/obra|proyecto|plano|medicion/, "/dashboard/projects"],
    [/cliente/, "/dashboard/clientes"],
    [/factura.*(emit|cliente)|cobro/, "/dashboard/issued-invoices"],
    [/factura.*(recib|proveedor)|gasto/, "/dashboard/facturas"],
    [/proveedor/, "/dashboard/suppliers"],
    [/ajuste|configur|empresa|fiscal/, "/dashboard/settings"],
  ];
  return matchers.find(([pattern]) => pattern.test(text))?.[1] || null;
}

export interface LocalAssistantAnswer {
  answer: string;
  suggestedPath: string | null;
  suggestedLabel: string | null;
}

/**
 * Useful offline guidance for the most common ENLAZE questions. It keeps the
 * assistant functional if the external AI provider has no credit or is down.
 */
export function buildLocalAssistantAnswer(
  question: string,
  pathname: string,
): LocalAssistantAnswer {
  const text = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const currentGuide = getGuideForPath(pathname);
  const suggestedPath = suggestPathForQuestion(question);
  const suggestedEntry = suggestedPath
    ? PLATFORM_GUIDE.find((entry) => entry.path === suggestedPath) || null
    : null;

  let answer: string;
  if (/panel principal|inicio|que.*revisar.*hoy|centro de control/.test(text)) {
    answer = "El panel principal es tu centro de control. 1. Revisa los avisos que requieren atención. 2. Completa los primeros pasos pendientes. 3. Usa el menú para entrar en clientes, presupuestos, obras, facturas o precios. 4. Comprueba la actividad reciente antes de empezar el día.";
  } else if (/recalcul|precio.*realista|no.*cuadra|eur.*m2|m2/.test(text)) {
    answer = "Para revisar un cálculo: 1. Abre el presupuesto en el Generador. 2. Comprueba superficie, ubicación, estancias, actuaciones y calidad. 3. En Partidas pulsa «Volver a calcular». 4. Revisa los precios contrastados, el importe por m² y las advertencias. Las selecciones del formulario tienen prioridad sobre la descripción libre.";
  } else if (/hacer.*presupuesto|crear.*presupuesto|nuevo.*presupuesto|presupuesto/.test(text)) {
    answer = "Para crear un presupuesto: 1. Entra en Presupuestos y abre el Generador. 2. Selecciona cliente y tipo de trabajo. 3. Indica ubicación, superficie, estancias, actuaciones y calidad. 4. Genera las partidas. 5. Revisa precios y proveedores. 6. Guarda y prepara el PDF antes de enviarlo.";
  } else if (/precio.*verific|precio.*real|banco tecnico|estimacion/.test(text)) {
    answer = "ENLAZE distingue tres niveles: «Precio verificado» procede de una tarifa o proveedor con evidencia; «Banco técnico» procede de BC3 u otra base de construcción; «Estimación» es una referencia provisional. Antes de enviar un presupuesto, prioriza partidas verificadas y revisa fecha, proveedor y unidad.";
  } else if (/import.*pdf|subir.*pdf|tarifa.*pdf/.test(text)) {
    answer = "Para importar una tarifa PDF: 1. Ve a Rastreador de precios → Importar. 2. Elige Tarifa de proveedor. 3. Sube el PDF e indica el proveedor. 4. Revisa nombres, unidades y precios extraídos. 5. Confirma solo las filas válidas. No se importan referencias sin un precio visible.";
  } else if (/rastread|actualizar.*precio|proveedor/.test(text)) {
    answer = "En el Rastreador de precios puedes consultar proveedores, cobertura y fecha de cada precio. Usa Actualizar precios para iniciar una revisión y Detener búsqueda si necesitas cancelarla. Comprueba siempre la fuente: proveedor autorizado, tarifa importada, banco técnico o estimación.";
  } else {
    answer = `Estás en ${currentGuide.label}. Esta sección sirve para ${currentGuide.purpose.toLowerCase()} Puedes preguntarme, por ejemplo: «${currentGuide.suggestions[0]}» o «${currentGuide.suggestions[1]}».`;
  }

  return {
    answer,
    suggestedPath,
    suggestedLabel: suggestedEntry?.label || null,
  };
}
