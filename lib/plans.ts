/**
 * Planes de Enlaze — ÚNICA fuente de verdad de precios, límites y funciones.
 *
 * Nada de estos números debe repetirse en otro sitio del código. La base de
 * datos necesita los límites y las funciones para aplicarlos en los triggers
 * (las escrituras del navegador van directas a Supabase), así que se copian a
 * la tabla `plan_catalog` con `npm run plans:sync`. `npm run build` ejecuta
 * antes `npm run plans:check` (prebuild) y falla si la tabla no coincide con
 * este fichero, o si los precios de Stripe no cuadran con los de aquí.
 *
 * ⚠️ LÍMITES PROVISIONALES: son criterio, no datos. No hay todavía histórico
 * de uso real; se ajustarán cuando veamos cómo lo usa la gente. Para
 * cambiarlos: edita LIMITS más abajo → `npm run plans:sync` → despliega.
 */

export const PLAN_IDS = ["prueba", "basico", "profesional", "empresa"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Planes que se pagan en Stripe (la prueba no tiene precio ni tarjeta). */
export const PAID_PLAN_IDS = ["basico", "profesional", "empresa"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Prueba gratuita: sin tarjeta, se registran y entran directos. */
export const TRIAL_DAYS = 5;

/** Descuento del pago anual sobre 12 mensualidades. */
export const ANNUAL_DISCOUNT = 0.2;

/** Precio mensual en céntimos de euro (sin cálculo de IVA: pendiente de decidir). */
export const MONTHLY_PRICE_CENTS: Record<PaidPlanId, number> = {
  basico: 2900,
  profesional: 5900,
  empresa: 17900,
};

export function priceCents(plan: PaidPlanId, interval: BillingInterval): number {
  const monthly = MONTHLY_PRICE_CENTS[plan];
  if (interval === "month") return monthly;
  return Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT));
}

// ── Límites ──────────────────────────────────────────────────────────────

export const LIMITED_RESOURCES = [
  "clientes",
  "presupuestos",
  "facturas",
  "whatsapp",
  "emails",
  "generaciones_ia",
  "escaneos_ocr",
  "mensajes_asistente",
] as const;
export type LimitedResource = (typeof LIMITED_RESOURCES)[number];

/**
 * Recursos que nos cuestan dinero por uso (Meta por conversación, IA por
 * token, envío de email). NUNCA pueden ser ilimitados en ningún plan: hay una
 * prueba automática que lo comprueba.
 */
export const PAY_PER_USE_RESOURCES: readonly LimitedResource[] = [
  "whatsapp",
  "emails",
  "generaciones_ia",
  "escaneos_ocr",
  "mensajes_asistente",
];

/** `null` = sin límite. */
type LimitTable = Record<Exclude<LimitedResource, "generaciones_ia">, number | null>;

// ⚠️ PROVISIONALES — ajustar con uso real.
//  - prueba: TOTAL durante los 5 días de prueba.
//  - planes de pago: POR MES NATURAL (hora de Madrid), salvo `clientes`, que
//    es un stock (filas vivas en cada momento).
//  - escaneos_ocr: facturas de PROVEEDOR escaneadas con IA (gastos). Contador
//    propio a propósito: si contaran contra `facturas` (EMITIDAS), escanear
//    tickets dejaría a un usuario sin poder facturar.
//  - mensajes_asistente: preguntas al asistente de la plataforma (Haiku,
//    barato por mensaje; por eso no cuenta contra `presupuestos`).
export const LIMITS: Record<PlanId, LimitTable> = {
  prueba:      { clientes: 10,   presupuestos: 5,   facturas: 5,    whatsapp: 20,   emails: 50,   escaneos_ocr: 10,  mensajes_asistente: 30 },
  basico:      { clientes: 50,   presupuestos: 10,  facturas: 15,   whatsapp: 50,   emails: 150,  escaneos_ocr: 30,  mensajes_asistente: 100 },
  profesional: { clientes: 500,  presupuestos: 50,  facturas: 100,  whatsapp: 400,  emails: 1000, escaneos_ocr: 150, mensajes_asistente: 500 },
  empresa:     { clientes: null, presupuestos: 200, facturas: null, whatsapp: 1500, emails: 5000, escaneos_ocr: 500, mensajes_asistente: 2000 },
};

/**
 * Cómo se cuenta cada recurso:
 *  - stock: filas vivas ahora mismo (lo borrado no cuenta).
 *  - window: uso registrado dentro de la ventana del plan (mes natural en los
 *    planes de pago, toda la prueba en 'prueba'). Borrar NO devuelve cupo.
 */
export const RESOURCE_KIND: Record<LimitedResource, "stock" | "window"> = {
  clientes: "stock",
  presupuestos: "window",
  facturas: "window",
  whatsapp: "window",
  emails: "window",
  generaciones_ia: "window",
  escaneos_ocr: "window",
  mensajes_asistente: "window",
};

export type LimitPeriod = "stock" | "month" | "trial";

export function limitPeriod(plan: PlanId, resource: LimitedResource): LimitPeriod {
  if (RESOURCE_KIND[resource] === "stock") return "stock";
  return plan === "prueba" ? "trial" : "month";
}

/**
 * Límite efectivo de un recurso en un plan.
 *
 * Las generaciones con IA (generate-budget, budgets/generate-v2,
 * agent/budgets/generate, budgets/analyze, agent/budget-analysis) tienen el MISMO número que los presupuestos, pero
 * con contador propio: así generar un presupuesto con IA y luego guardarlo no
 * cuenta dos veces contra el mismo cupo.
 */
export function planLimit(plan: PlanId, resource: LimitedResource): number | null {
  if (resource === "generaciones_ia") return LIMITS[plan].presupuestos;
  return LIMITS[plan][resource];
}

// ── Funciones por plan ───────────────────────────────────────────────────

export const FEATURES = [
  "clientes",
  "presupuestos",
  "facturas",
  "firma",
  "portal_cliente",
  "briefing_diario",
  "seguimiento_precios",
  "programacion_envios",
] as const;
export type Feature = (typeof FEATURES)[number];

const CORE_FEATURES: Feature[] = ["clientes", "presupuestos", "facturas", "firma", "portal_cliente"];

export const PLAN_FEATURES: Record<PlanId, readonly Feature[]> = {
  // La prueba lo tiene TODO desbloqueado, sin excepción: es el gancho.
  prueba: FEATURES,
  basico: CORE_FEATURES,
  profesional: FEATURES,
  empresa: FEATURES,
};

export function planHasFeature(plan: PlanId, feature: Feature): boolean {
  return PLAN_FEATURES[plan].includes(feature);
}

// ── Nombres visibles (para los mensajes del 402) ─────────────────────────

export const PLAN_LABELS: Record<PlanId, string> = {
  prueba: "Prueba gratuita",
  basico: "Básico",
  profesional: "Profesional",
  empresa: "Empresa",
};

export const RESOURCE_LABELS: Record<LimitedResource, string> = {
  clientes: "clientes",
  presupuestos: "presupuestos",
  facturas: "facturas",
  whatsapp: "mensajes de WhatsApp",
  emails: "emails",
  generaciones_ia: "generaciones con IA",
  escaneos_ocr: "facturas de proveedor escaneadas",
  mensajes_asistente: "mensajes al asistente",
};

export const FEATURE_LABELS: Record<Feature, string> = {
  clientes: "Clientes",
  presupuestos: "Presupuestos",
  facturas: "Facturas",
  firma: "Firma de documentos",
  portal_cliente: "Portal del cliente",
  briefing_diario: "Briefing diario del agente",
  seguimiento_precios: "Seguimiento de precios de proveedores",
  programacion_envios: "Programación de envíos y automatización",
};

// ── Price IDs de Stripe (solo por variable de entorno) ───────────────────

/** Nombre de la variable de entorno con el price ID de cada plan y periodicidad. */
export function stripePriceEnvVar(plan: PaidPlanId, interval: BillingInterval): string {
  return `STRIPE_PRICE_${plan.toUpperCase()}_${interval === "month" ? "MONTHLY" : "YEARLY"}`;
}

// ── Lo que se copia a la base de datos ───────────────────────────────────

export interface PlanCatalogRow {
  plan: PlanId;
  trial_days: number | null;
  limits: Record<LimitedResource, { max: number | null; period: LimitPeriod }>;
  features: Feature[];
}

/** Filas exactas que deben existir en `public.plan_catalog`. */
export function planCatalogRows(): PlanCatalogRow[] {
  return PLAN_IDS.map((plan) => ({
    plan,
    trial_days: plan === "prueba" ? TRIAL_DAYS : null,
    limits: Object.fromEntries(
      LIMITED_RESOURCES.map((r) => [r, { max: planLimit(plan, r), period: limitPeriod(plan, r) }]),
    ) as PlanCatalogRow["limits"],
    features: [...PLAN_FEATURES[plan]].sort(),
  }));
}
