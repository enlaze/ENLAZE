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
  const text = question.toLowerCase();
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
