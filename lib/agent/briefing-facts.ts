/**
 * Motor de hechos del briefing diario.
 *
 * Toma el mismo `ctx` que ya construía el nodo "Build Claude Prompt" y devuelve
 * un bloque de TEXTO PLANO en castellano con los hechos del día ya resueltos:
 * los números formateados, las esperas convertidas a días, las fechas dichas en
 * palabras, los umbrales aplicados y el ruido descartado.
 *
 * El objetivo es que el modelo NO tenga que calcular ni interpretar cifras.
 * Solo redacta: titular, narrativa, orden de prioridad y tono.
 *
 * ── RESTRICCIONES DEL FICHERO ────────────────────────────────────────────────
 * Este módulo se inyecta tal cual dentro del nodo Code de n8n
 * (`scripts/sync-briefing-facts.mjs` lo transpila y lo pega entre marcadores),
 * así que tiene que ser AUTOCONTENIDO:
 *   - sin imports,
 *   - sin APIs de Node,
 *   - sin `Intl` (el sandbox de n8n no lo garantiza): todo se formatea a mano.
 * `npm run sync:briefing-facts` regenera el nodo y
 * `__tests__/agent-briefing-reliability.test.mjs` falla si los dos se separan.
 */

/* ─── Formato en castellano ──────────────────────────────────────────────── */

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const DIAS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** 1240.5 → "1.240,50" · 1240 → "1.240" (sin decimales si son cero). */
export function numeroEs(valor: number | null | undefined, decimales = 2): string {
  if (valor === null || valor === undefined || !isFinite(Number(valor))) return "";
  const n = Number(valor);
  const negativo = n < 0;
  const abs = Math.abs(n);
  const redondeado = abs.toFixed(decimales);
  let [entera, decimal] = redondeado.split(".");
  entera = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (decimal && /^0+$/.test(decimal)) decimal = "";
  const cuerpo = decimal ? entera + "," + decimal : entera;
  return (negativo ? "-" : "") + cuerpo;
}

/** 2480 → "2.480,00 €". Siempre con dos decimales: son importes. */
export function eurosEs(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !isFinite(Number(valor))) return "";
  const n = Number(valor);
  const negativo = n < 0;
  let entera = Math.abs(n).toFixed(2);
  const decimal = entera.slice(-2);
  entera = entera.slice(0, -3).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (negativo ? "-" : "") + entera + "," + decimal + " €";
}

/** -12.4 → "baja un 12,4 %" · 22 → "sube un 22 %" · 0 → "se mantiene". */
export function variacionEs(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !isFinite(Number(pct))) return "";
  const n = Number(pct);
  if (Math.abs(n) < 0.5) return "se mantiene";
  return (n > 0 ? "sube un " : "baja un ") + numeroEs(Math.abs(n), 1) + " %";
}

/** -2.4 → "-2,4 %" · 2.4 → "+2,4 %". Para indicadores sueltos. */
export function porcentajeConSignoEs(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !isFinite(Number(pct))) return "";
  const n = Number(pct);
  return (n > 0 ? "+" : n < 0 ? "-" : "") + numeroEs(Math.abs(n), 1) + " %";
}

/**
 * Convierte horas de espera a la unidad que se dice en voz alta.
 * 107 → "4 días" (no "107h", que era la queja concreta del prompt viejo).
 */
export function esperaEs(horas: number | null | undefined): string {
  if (horas === null || horas === undefined || !isFinite(Number(horas))) return "";
  const h = Math.max(0, Math.round(Number(horas)));
  if (h < 1) return "menos de una hora";
  if (h < 24) return h === 1 ? "1 hora" : h + " horas";
  const dias = Math.floor(h / 24);
  return dias === 1 ? "1 día" : dias + " días";
}

/** "2026-09-25" → "25 de septiembre" (añade el año si no es el de hoy). */
export function fechaLargaEs(iso: string | null | undefined, anioActual?: number): string {
  if (!iso) return "";
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso);
  const anio = Number(m[1]);
  const mes = MESES_ES[Number(m[2]) - 1];
  const dia = Number(m[3]);
  if (!mes) return String(iso);
  const base = dia + " de " + mes;
  return anioActual && anio !== anioActual ? base + " de " + anio : base;
}

/** "2026-09-23" → "miércoles". Con tilde, a diferencia del array del nodo. */
export function diaSemanaEs(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(String(iso).slice(0, 10) + "T00:00:00Z");
  if (!isFinite(ms)) return "";
  return DIAS_ES[new Date(ms).getUTCDay()];
}

/** "2026-09-23T10:00:00+02:00" → "10:00". */
export function horaEs(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = String(iso).match(/T(\d{2}):(\d{2})/);
  return m ? m[1] + ":" + m[2] : "";
}

/** "en 2 días" / "hoy" / "mañana" / "hace 4 días". */
export function plazoEs(dias: number | null | undefined): string {
  if (dias === null || dias === undefined || !isFinite(Number(dias))) return "";
  const d = Math.round(Number(dias));
  if (d === 0) return "hoy";
  if (d === 1) return "mañana";
  if (d === -1) return "ayer";
  return d > 0 ? "dentro de " + d + " días" : "hace " + Math.abs(d) + " días";
}

/** Días naturales entre dos fechas ISO. null si alguna no es una fecha. */
export function diasEntre(desdeIso: string | null | undefined, hastaIso: string | null | undefined): number | null {
  if (!desdeIso || !hastaIso) return null;
  const a = Date.parse(String(desdeIso).slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(String(hastaIso).slice(0, 10) + "T00:00:00Z");
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** "1 cita" / "3 citas". Evita el "(s)" que no se dice en voz alta. */
export function plural(n: number | null | undefined, singular: string, pluralForma: string): string {
  const v = Number(n || 0);
  return v + " " + (Math.abs(v) === 1 ? singular : pluralForma);
}

/** Une frases en una lista natural: "a, b y c". */
export function listaEs(partes: Array<string | null | undefined>): string {
  const limpias = partes.filter((p): p is string => !!p && String(p).trim().length > 0);
  if (limpias.length === 0) return "";
  if (limpias.length === 1) return limpias[0];
  return limpias.slice(0, -1).join(", ") + " y " + limpias[limpias.length - 1];
}

/** Recorta y normaliza un texto libre para meterlo entre comillas españolas. */
export function cita(texto: string | null | undefined, max = 160): string {
  if (!texto) return "";
  const plano = String(texto).replace(/\s+/g, " ").trim();
  if (!plano) return "";
  const corto = plano.length > max ? plano.slice(0, max).trimEnd() + "…" : plano;
  return "«" + corto.replace(/[«»]/g, '"') + "»";
}

/* ─── Forma del ctx que entra ────────────────────────────────────────────── */
/* Todo opcional a propósito: el ctx llega de n8n y cualquier módulo puede
   venir caído, vacío o a medias. El motor nunca lanza: lo que falta, no se
   escribe. */

export interface FactsThread {
  from_name?: string | null;
  from_email?: string | null;
  subject?: string | null;
  snippet?: string | null;
  hours_waiting?: number | null;
  is_recurring_contact?: boolean;
  category?: string | null;
  priority_signal?: string | null;
  importance?: string | null;
  importance_reason?: string | null;
}

export interface FactsInvoice {
  supplier?: string | null;
  amount?: number | null;
  due_date?: string | null;
  snippet?: string | null;
}

export interface FactsMeetingRequest {
  from?: string | null;
  proposed_dates?: string[] | null;
  snippet?: string | null;
}

export interface FactsGmail {
  status?: string | null;
  total_unread?: number | null;
  emails_processed?: number | null;
  fetched_range_days?: number | null;
  importance_counts?: Record<string, number> | null;
  threads_awaiting_reply?: FactsThread[] | null;
  invoices_detected?: FactsInvoice[] | null;
  meeting_requests?: FactsMeetingRequest[] | null;
  threads_count_by_category?: Record<string, number> | null;
  top_senders_30d?: Array<{ name?: string | null; email?: string | null; count?: number | null; is_customer?: boolean }> | null;
}

export interface FactsEvent {
  start?: string | null;
  end?: string | null;
  title?: string | null;
  location?: string | null;
  attendees?: number | null;
}

export interface FactsDay {
  date?: string | null;
  total_events?: number | null;
  total_busy_hours?: number | null;
  is_packed?: boolean;
  events?: FactsEvent[] | null;
  free_blocks?: Array<{ start?: string | null; end?: string | null; duration_hours?: number | null }> | null;
}

export interface FactsCalendar {
  status?: string | null;
  today?: FactsDay | null;
  tomorrow?: FactsDay | null;
  this_week?: {
    total_events?: number | null;
    busiest_day?: { date?: string | null; count?: number | null } | null;
    quietest_day?: { date?: string | null; count?: number | null } | null;
  } | null;
  upcoming_important?: Array<{ date?: string | null; title?: string | null; why_important?: string | null; days_until?: number | null }> | null;
  recurring_patterns?: Array<{ description?: string | null; occurrences?: number | null }> | null;
}

export interface FactsSalesWindow {
  revenue?: number | null;
  units?: number | null;
  transactions?: number | null;
  vs_last_week_pct?: number | null;
  vs_last_month_pct?: number | null;
}

export interface FactsSales {
  status?: string | null;
  detection_confidence?: string | null;
  rows_analyzed?: number | null;
  active_sheet_name?: string | null;
  sales_summary?: {
    today?: FactsSalesWindow | null;
    yesterday?: FactsSalesWindow | null;
    this_week?: FactsSalesWindow | null;
    this_month?: FactsSalesWindow | null;
  } | null;
  top_products_7d?: Array<{ name?: string | null; units?: number | null; revenue?: number | null; trend?: string | null; vs_previous_pct?: number | null }> | null;
  alerts?: Array<{ type?: string | null; message?: string | null }> | null;
}

export interface FactsRetailEvent {
  name?: string | null;
  date?: string | null;
  in_days?: number | null;
  days_ago?: number | null;
}

export interface FactsSectorIntel {
  sector_key?: string | null;
  kpis_focus?: string[] | null;
  seasonal_focus?: Array<{ key?: string | null; name?: string | null; months?: number[] | null; note?: string | null }> | null;
  campaign_archetypes?: string[] | null;
  regulatory_notes?: string[] | null;
  supplier_types?: string[] | null;
}

export interface FactsContext {
  config?: {
    business_name?: string | null;
    business_type?: string | null;
    city?: string | null;
    sector?: string | null;
  } | null;
  date?: string | null;
  weekday_today?: string | null;
  agent_name?: string | null;
  can_suggest_connecting_tools?: boolean;
  modules_state?: Record<string, string> | null;
  mechanical_summary?: { margin_pressure?: string | null } | null;
  gmail_intel?: FactsGmail | null;
  calendar_intel?: FactsCalendar | null;
  sales_intel?: FactsSales | null;
  high_priority_tasks?: Array<{ type?: string | null; title?: string | null; time_estimate?: string | null; estimated_impact?: string | null; category?: string | null }> | null;
  medium_priority_tasks?: Array<{ type?: string | null; title?: string | null; time_estimate?: string | null }> | null;
  cost_alerts?: Array<{ category?: string | null; severity?: string | null; title?: string | null; recommendation?: string | null }> | null;
  competitive_signals?: Array<{ title?: string | null; type?: string | null; is_local?: boolean; relevance?: number | null }> | null;
  market_indicators?: {
    connected?: boolean;
    has_competitors?: boolean;
    competitors_count?: number | null;
    price_signals?: Array<{ title?: string | null; impact?: string | null }> | null;
    supplier_alerts?: Array<{ supplier?: string | null; title?: string | null; impact?: string | null; alternative?: string | null }> | null;
    market_signals?: Array<{ title?: string | null }> | null;
  } | null;
  radar_subsidies?: Array<{ title?: string | null; type?: string | null; amount_range?: string | null; deadline?: string | null; target?: string | null }> | null;
  radar_regulations?: Array<{ title?: string | null; impact?: string | null; action_required?: string | null }> | null;
  radar_news?: Array<{ title?: string | null; source?: string | null }> | null;
  reputation_urgent?: Array<{ author?: string | null; rating?: number | null; text?: string | null; date?: string | null }> | null;
  reputation_stats?: { current_rating?: number | null; total_reviews?: number | null; new_reviews_count?: number | null; trend?: string | null } | null;
  news?: Array<{ title?: string | null; source?: string | null; published_at?: string | null; why_relevant?: string | null }> | null;
  sector_intel?: FactsSectorIntel | null;
  upcoming_retail_events?: FactsRetailEvent[] | null;
  recently_passed_retail_events?: FactsRetailEvent[] | null;
}

/* ─── Utilidades internas ────────────────────────────────────────────────── */

function arr<T>(valor: T[] | null | undefined): T[] {
  return Array.isArray(valor) ? valor : [];
}

function txt(valor: unknown, max = 200): string {
  if (valor === null || valor === undefined) return "";
  const plano = String(valor).replace(/\s+/g, " ").trim();
  return plano.length > max ? plano.slice(0, max).trimEnd() + "…" : plano;
}

/** Recorta un texto libre y lo cierra con punto, para que encadene. */
function frase(valor: unknown, max = 200): string {
  const t = txt(valor, max);
  if (!t) return "";
  return /[.!?…]$/.test(t) ? t : t + ".";
}

/** Clave para detectar el mismo titular llegando por dos fuentes distintas. */
function claveTitular(titulo: string): string {
  return titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

const ORDEN_IMPORTANCIA: Record<string, number> = { critical: 0, important: 1, normal: 2, noise: 3 };
const IMPORTANCIA_ES: Record<string, string> = {
  critical: "crítico",
  important: "importante",
  normal: "normal",
};
const CATEGORIA_ES: Record<string, string> = {
  customer: "cliente",
  supplier: "proveedor",
  lead: "posible cliente",
  internal: "interno",
  spam: "spam",
};
const SEVERIDAD_ES: Record<string, string> = { high: "alta", medium: "media", low: "baja" };
const CATEGORIA_COSTE_ES: Record<string, string> = {
  energia: "energía",
  costes_producto: "coste de producto",
  costes_local: "coste del local",
  costes_logistica: "logística",
  proveedor: "proveedor",
};
const PRESION_ES: Record<string, string> = {
  high: "alta — los costes suben con fuerza",
  medium: "media — ligera subida de costes",
  favorable: "favorable — los costes están bajando",
  low: "estable",
};
const COMPETENCIA_ES: Record<string, string> = {
  new_competitor: "abre un competidor",
  competitor_exit: "cierra un competidor",
  competitor_promo: "promoción de un competidor",
  consumer_trend: "tendencia de consumo",
};

/** Una sección con título; se descarta entera si no tiene líneas. */
interface Seccion {
  titulo: string;
  lineas: string[];
}

function seccion(titulo: string, lineas: Array<string | null | undefined>): Seccion | null {
  const limpias = lineas.filter((l): l is string => !!l && l.trim().length > 0);
  return limpias.length > 0 ? { titulo, lineas: limpias } : null;
}

/* ─── Secciones ──────────────────────────────────────────────────────────── */

function seccionNegocio(ctx: FactsContext, anio: number): Seccion | null {
  const cfg = ctx.config || {};
  const nombre = txt(cfg.business_name) || "El negocio";
  const tipo = txt(cfg.business_type);
  const ciudad = txt(cfg.city);
  let linea = nombre;
  if (tipo) linea += ", " + tipo;
  if (ciudad) linea += " en " + ciudad;
  linea += ".";
  const sector = txt(cfg.sector);
  if (sector) linea += " Sector: " + sector.replace(/_/g, " ") + ".";

  const dia = diaSemanaEs(ctx.date) || txt(ctx.weekday_today);
  const fecha = fechaLargaEs(ctx.date, anio);
  const hoy = dia && fecha ? "Hoy es " + dia + ", " + fecha + " de " + anio + "." : "";

  const estado = ctx.modules_state || {};
  const nombresModulo: Record<string, string> = {
    gmail: "correo",
    calendar: "agenda",
    sheets: "ventas",
    reputation: "reseñas",
  };
  const conectados: string[] = [];
  const sinConectar: string[] = [];
  for (const clave of Object.keys(nombresModulo)) {
    if (!(clave in estado)) continue;
    (estado[clave] === "CONECTADO" ? conectados : sinConectar).push(nombresModulo[clave]);
  }
  let integraciones = "";
  if (conectados.length > 0) integraciones = "Tiene conectado: " + listaEs(conectados) + ".";
  if (sinConectar.length > 0) {
    integraciones += (integraciones ? " " : "") + "Sin conectar: " + listaEs(sinConectar) + ".";
    integraciones += ctx.can_suggest_connecting_tools
      ? " Hoy SÍ puedes sugerir conectar una de ellas, en una línea y sin insistir."
      : " Hoy NO toca sugerir conectar nada: no lo menciones.";
  } else if (conectados.length > 0) {
    integraciones += " No queda nada por conectar: no menciones el tema.";
  }

  return seccion("EL NEGOCIO Y EL DÍA", [hoy, linea, integraciones]);
}

function seccionCorreo(ctx: FactsContext, anio: number): Seccion | null {
  const g = ctx.gmail_intel || {};
  if (!g || (g.status && g.status !== "ok")) {
    return g.status && g.status !== "not_connected"
      ? seccion("CORREO", ["El correo está conectado pero hoy no se ha podido leer. No hay datos de la bandeja."])
      : null;
  }

  const lineas: string[] = [];
  const counts = g.importance_counts || {};
  const resumen: string[] = [];
  if (g.total_unread) resumen.push(g.total_unread + " sin leer");
  if (counts.critical) resumen.push(plural(counts.critical, "crítico", "críticos"));
  if (counts.important) resumen.push(plural(counts.important, "importante", "importantes"));
  if (resumen.length > 0) lineas.push("Bandeja: " + listaEs(resumen) + ".");

  const hilos = arr(g.threads_awaiting_reply)
    .filter((t) => t && t.importance !== "noise")
    .sort((a, b) => {
      const ra = ORDEN_IMPORTANCIA[String(a.importance)] ?? 2;
      const rb = ORDEN_IMPORTANCIA[String(b.importance)] ?? 2;
      if (ra !== rb) return ra - rb;
      return Number(b.hours_waiting || 0) - Number(a.hours_waiting || 0);
    })
    .slice(0, 6);

  if (hilos.length > 0) {
    lineas.push("Esperando respuesta:");
    for (const t of hilos) {
      const quien = txt(t.from_name) || txt(t.from_email) || "Remitente desconocido";
      const etiquetas = [
        IMPORTANCIA_ES[String(t.importance)] || "",
        CATEGORIA_ES[String(t.category)] || "",
        t.is_recurring_contact ? "contacto habitual" : "",
      ].filter(Boolean);
      let l = "- " + quien;
      if (etiquetas.length > 0) l += " (" + etiquetas.join(", ") + ")";
      const asunto = cita(t.subject, 90);
      if (asunto) l += ": " + asunto;
      const espera = esperaEs(t.hours_waiting);
      if (espera) l += ". Lleva " + espera + " esperando";
      l += ".";
      const motivo = txt(t.importance_reason, 120);
      if (motivo) l += " " + (motivo.endsWith(".") ? motivo : motivo + ".");
      lineas.push(l);
    }
  } else if (resumen.length > 0) {
    lineas.push("Ningún correo relevante espera respuesta.");
  }

  const facturas = arr(g.invoices_detected).slice(0, 4);
  if (facturas.length > 0) {
    lineas.push("Facturas detectadas en el correo:");
    for (const f of facturas) {
      let l = "- " + (txt(f.supplier) || "Proveedor sin identificar");
      const importe = eurosEs(f.amount);
      if (importe) l += ": " + importe;
      if (f.due_date) {
        const dias = diasEntre(ctx.date, f.due_date);
        const cuando = fechaLargaEs(f.due_date, anio);
        if (dias !== null && dias < 0) l += ". VENCIDA el " + cuando + " (" + plazoEs(dias) + ")";
        else if (dias !== null) l += ". Vence el " + cuando + " (" + plazoEs(dias) + ")";
        else l += ". Vence el " + cuando;
      }
      lineas.push(l + ".");
    }
  }

  const citas = arr(g.meeting_requests).slice(0, 3);
  if (citas.length > 0) {
    lineas.push("Piden cita:");
    for (const c of citas) {
      const fechas = arr(c.proposed_dates)
        .slice(0, 3)
        .map((d) => fechaLargaEs(d, anio) || txt(d))
        .filter(Boolean);
      lineas.push(
        "- " + (txt(c.from) || "Alguien") + (fechas.length > 0 ? ", propone " + listaEs(fechas) : "") + ".",
      );
    }
  }

  return seccion("CORREO", lineas);
}

function seccionAgenda(ctx: FactsContext, anio: number): Seccion | null {
  const c = ctx.calendar_intel || {};
  if (!c || (c.status && c.status !== "ok")) {
    return c.status && c.status !== "not_connected"
      ? seccion("AGENDA", ["La agenda está conectada pero hoy no se ha podido leer."])
      : null;
  }

  const lineas: string[] = [];
  const hoy = c.today || null;
  if (hoy) {
    const n = Number(hoy.total_events || 0);
    const horas = Number(hoy.total_busy_hours || 0);
    let cabecera =
      n === 0 ? "Hoy no hay ninguna cita." : n === 1 ? "Hoy hay 1 cita" : "Hoy hay " + n + " citas";
    if (n > 0) {
      if (horas > 0) cabecera += ", " + numeroEs(horas, 1) + " h ocupadas";
      cabecera += hoy.is_packed ? ". Es un día cargado." : ".";
    }
    lineas.push(cabecera);
    for (const e of arr(hoy.events).slice(0, 6)) {
      const franja = [horaEs(e.start), horaEs(e.end)].filter(Boolean).join("-");
      const extras = [
        txt(e.location, 60),
        e.attendees ? plural(e.attendees, "asistente", "asistentes") : "",
      ].filter(Boolean);
      lineas.push(
        "- " + (franja ? franja + " " : "") + (txt(e.title, 90) || "Sin título") +
        (extras.length > 0 ? " (" + extras.join(", ") + ")" : "") + ".",
      );
    }
    const huecos = arr(hoy.free_blocks).filter((b) => Number(b.duration_hours || 0) >= 1).slice(0, 3);
    if (huecos.length > 0) {
      lineas.push(
        "Huecos libres de más de una hora hoy: " +
          listaEs(
            huecos.map(
              (b) => horaEs(b.start) + "-" + horaEs(b.end) + " (" + numeroEs(b.duration_hours, 1) + " h)",
            ),
          ) + ".",
      );
    }
  }

  const manana = c.tomorrow || null;
  if (manana && Number(manana.total_events || 0) > 0) {
    const eventos = arr(manana.events)
      .slice(0, 4)
      .map((e) => (horaEs(e.start) ? horaEs(e.start) + " " : "") + txt(e.title, 70));
    lineas.push("Mañana: " + plural(manana.total_events, "cita", "citas") + ". " + listaEs(eventos) + ".");
  }
  // Los huecos de mañana hacen falta para proponer una franja a quien pide cita.
  const huecosManana = arr(manana?.free_blocks).filter((b) => Number(b.duration_hours || 0) >= 1).slice(0, 2);
  if (huecosManana.length > 0) {
    lineas.push(
      "Huecos libres mañana: " +
        listaEs(
          huecosManana.map(
            (b) => horaEs(b.start) + "-" + horaEs(b.end) + " (" + numeroEs(b.duration_hours, 1) + " h)",
          ),
        ) + ".",
    );
  }

  const semana = c.this_week || null;
  if (semana && Number(semana.total_events || 0) > 0) {
    let l = "Esta semana: " + plural(semana.total_events, "cita", "citas") + " en total.";
    const pico = semana.busiest_day;
    if (pico && pico.date) l += " El día más cargado es el " + fechaLargaEs(pico.date, anio) + " (" + pico.count + ").";
    lineas.push(l);
  }

  for (const u of arr(c.upcoming_important).slice(0, 3)) {
    const cuando = u.days_until !== null && u.days_until !== undefined ? plazoEs(u.days_until) : fechaLargaEs(u.date, anio);
    lineas.push(
      "Se acerca: " + (txt(u.title, 90) || "evento") + ", " + cuando +
      (u.why_important ? ". " + txt(u.why_important, 110) : "") + ".",
    );
  }

  const rutinas = arr(c.recurring_patterns).slice(0, 2);
  if (rutinas.length > 0) {
    lineas.push(
      "Rutinas fijas: " +
        listaEs(rutinas.map((r) => txt(r.description, 60) + (r.occurrences ? " (" + r.occurrences + " veces)" : ""))) +
        ".",
    );
  }

  return seccion("AGENDA", lineas);
}

function seccionVentas(ctx: FactsContext): Seccion | null {
  const s = ctx.sales_intel || {};
  if (!s || (s.status && s.status !== "ok")) {
    return s.status && s.status !== "not_connected"
      ? seccion("VENTAS", ["La hoja de ventas está conectada pero hoy no se ha podido leer."])
      : null;
  }
  // Umbral aplicado en código: con detección baja, la hoja no vale como dato.
  if (String(s.detection_confidence || "low") === "low") {
    return seccion("VENTAS", [
      "La hoja de ventas está conectada pero no se ha podido interpretar con fiabilidad. No hay cifras de ventas utilizables hoy: no hables de ventas.",
    ]);
  }

  const lineas: string[] = [];
  const origen: string[] = [];
  if (s.active_sheet_name) origen.push("hoja " + cita(s.active_sheet_name, 50));
  if (s.rows_analyzed) origen.push(numeroEs(s.rows_analyzed, 0) + " filas analizadas");
  if (origen.length > 0) lineas.push("Fuente: " + listaEs(origen) + ".");

  const v = s.sales_summary || {};
  const ventana = (etiqueta: string, w: FactsSalesWindow | null | undefined, comparativa?: string): string => {
    if (!w) return "";
    const partes: string[] = [];
    const ingresos = eurosEs(w.revenue);
    if (ingresos) partes.push(ingresos);
    if (w.units) partes.push(numeroEs(w.units, 0) + " unidades");
    if (w.transactions) partes.push(numeroEs(w.transactions, 0) + " tickets");
    if (partes.length === 0) return "";
    let l = etiqueta + ": " + listaEs(partes);
    if (comparativa) l += ", " + comparativa;
    return l + ".";
  };

  lineas.push(ventana("Hoy", v.today));
  lineas.push(ventana("Ayer", v.yesterday));
  lineas.push(
    ventana(
      "Esta semana",
      v.this_week,
      v.this_week && v.this_week.vs_last_week_pct !== null && v.this_week.vs_last_week_pct !== undefined
        ? variacionEs(v.this_week.vs_last_week_pct) + " respecto a la semana pasada"
        : undefined,
    ),
  );
  lineas.push(
    ventana(
      "Este mes",
      v.this_month,
      v.this_month && v.this_month.vs_last_month_pct !== null && v.this_month.vs_last_month_pct !== undefined
        ? variacionEs(v.this_month.vs_last_month_pct) + " respecto al mes pasado"
        : undefined,
    ),
  );

  const productos = arr(s.top_products_7d).slice(0, 6);
  if (productos.length > 0) {
    const frases = productos.map((p) => {
      const partes = [numeroEs(p.units, 0) ? numeroEs(p.units, 0) + " uds" : "", eurosEs(p.revenue)].filter(Boolean);
      // Umbral aplicado en código: un movimiento solo es "notable" a partir del 15 %.
      const notable =
        (p.trend === "up" || p.trend === "down") && Math.abs(Number(p.vs_previous_pct || 0)) >= 15;
      return (
        txt(p.name, 60) +
        (partes.length > 0 ? " (" + partes.join(", ") + ")" : "") +
        (notable ? ", " + variacionEs(p.vs_previous_pct) + " — movimiento notable" : "")
      );
    });
    lineas.push("Productos de los últimos 7 días: " + frases.join("; ") + ".");
  }

  const avisos = arr(s.alerts).slice(0, 4).map((a) => txt(a.message, 140)).filter(Boolean);
  if (avisos.length > 0) lineas.push("Avisos de la hoja: " + avisos.join(" · ") + ".");

  return seccion("VENTAS", lineas);
}

function seccionCostes(ctx: FactsContext): Seccion | null {
  const lineas: string[] = [];
  for (const a of arr(ctx.cost_alerts).slice(0, 6)) {
    const sev = SEVERIDAD_ES[String(a.severity)] || "";
    const cat = CATEGORIA_COSTE_ES[String(a.category)] || txt(a.category).replace(/_/g, " ");
    const etiqueta = [sev, cat].filter(Boolean).join(", ");
    let l = "- " + (etiqueta ? "(" + etiqueta + ") " : "") + frase(a.title, 120);
    const rec = txt(a.recommendation, 120);
    if (rec) l += " " + frase(rec, 120);
    lineas.push(l);
  }
  const presion = PRESION_ES[String(ctx.mechanical_summary?.margin_pressure)];
  if (presion) lineas.push("Presión sobre el margen: " + presion + ".");

  const m = ctx.market_indicators || {};
  for (const p of arr(m.price_signals).slice(0, 3)) {
    lineas.push("- Señal de precio" + (p.impact === "high" ? " (alta)" : "") + ": " + txt(p.title, 120) + ".");
  }
  for (const p of arr(m.supplier_alerts).slice(0, 3)) {
    lineas.push(
      "- Proveedor " + (txt(p.supplier) || "sin identificar") + ": " + txt(p.title, 110) +
      (p.alternative ? ". Alternativa apuntada: " + txt(p.alternative, 80) : "") + ".",
    );
  }
  return seccion("COSTES Y PRECIOS", lineas);
}

function seccionResenas(ctx: FactsContext, anio: number): Seccion | null {
  const lineas: string[] = [];
  const st = ctx.reputation_stats || null;
  if (st && st.total_reviews) {
    let l = "Nota media " + numeroEs(st.current_rating, 1) + " sobre " + numeroEs(st.total_reviews, 0) + " reseñas";
    if (st.new_reviews_count) l += ", " + plural(st.new_reviews_count, "nueva", "nuevas");
    if (st.trend && st.trend !== "unknown") l += ", tendencia " + txt(st.trend);
    lineas.push(l + ".");
  }
  const urgentes = arr(ctx.reputation_urgent).slice(0, 4);
  if (urgentes.length > 0) {
    lineas.push("Sin contestar:");
    for (const r of urgentes) {
      const partes = [
        txt(r.author) || "Anónimo",
        r.rating ? plural(r.rating, "estrella", "estrellas") : "",
        fechaLargaEs(r.date, anio),
      ].filter(Boolean);
      const texto = cita(r.text, 130);
      lineas.push("- " + partes.join(", ") + (texto ? ": " + texto : "") + ".");
    }
  }
  return seccion("RESEÑAS", lineas);
}

function seccionEntorno(ctx: FactsContext): Seccion | null {
  const lineas: string[] = [];

  const competencia = arr(ctx.competitive_signals).slice(0, 3);
  for (const c of competencia) {
    const tipo = COMPETENCIA_ES[String(c.type)] || "movimiento de la competencia";
    lineas.push("- " + tipo.charAt(0).toUpperCase() + tipo.slice(1) + (c.is_local ? " (en su zona)" : "") + ": " + txt(c.title, 120) + ".");
  }
  for (const e of arr(ctx.market_indicators?.market_signals).slice(0, 2)) {
    lineas.push("- Evento local: " + txt(e.title, 110) + ".");
  }

  const ayudas = arr(ctx.radar_subsidies).slice(0, 4);
  for (const a of ayudas) {
    const detalles = [txt(a.type), txt(a.amount_range), txt(a.deadline) ? "plazo " + txt(a.deadline) : ""].filter(Boolean);
    lineas.push("- Ayuda pública" + (detalles.length > 0 ? " (" + detalles.join(", ") + ")" : "") + ": " + txt(a.title, 130) + ".");
  }

  const normas = arr(ctx.radar_regulations).slice(0, 4);
  for (const n of normas) {
    lineas.push(
      "- Normativa" + (n.impact === "high" ? " de impacto alto" : "") + ": " + txt(n.title, 130) +
      (n.action_required ? ". " + txt(n.action_required, 90) : "") + ".",
    );
  }

  return seccion("ENTORNO: COMPETENCIA, AYUDAS Y NORMATIVA", lineas);
}

function seccionNoticias(ctx: FactsContext, anio: number): Seccion | null {
  const lineas: string[] = [];
  // El feed de sector y el radar genérico traen los mismos titulares muy a
  // menudo. Se quedan una sola vez, y gana la versión que trae why_relevant.
  const vistos: Record<string, true> = {};
  for (const n of arr(ctx.news).slice(0, 6)) {
    const titulo = txt(n.title, 140);
    if (!titulo) continue;
    const clave = claveTitular(titulo);
    if (vistos[clave]) continue;
    vistos[clave] = true;
    const fuente = [txt(n.source, 40), fechaLargaEs(n.published_at, anio)].filter(Boolean).join(", ");
    let l = "- " + cita(titulo, 140) + (fuente ? " (" + fuente + ")" : "");
    if (n.why_relevant) l += ". Le afecta porque: " + txt(n.why_relevant, 140);
    lineas.push(frase(l, 400));
  }
  for (const n of arr(ctx.radar_news).slice(0, 3)) {
    const titulo = txt(n.title, 140);
    if (!titulo) continue;
    const clave = claveTitular(titulo);
    if (vistos[clave]) continue;
    vistos[clave] = true;
    lineas.push("- " + cita(titulo, 140) + (n.source ? " (" + txt(n.source, 40) + ")" : "") + ".");
  }
  return seccion("NOTICIAS DEL SECTOR", lineas);
}

function seccionFechas(ctx: FactsContext, anio: number): Seccion | null {
  const lineas: string[] = [];
  const proximos = arr(ctx.upcoming_retail_events)
    .slice()
    .sort((a, b) => Number(a.in_days || 0) - Number(b.in_days || 0))
    .slice(0, 4);
  for (const e of proximos) {
    lineas.push("- " + txt(e.name, 70) + ": " + fechaLargaEs(e.date, anio) + ", " + plazoEs(e.in_days) + ".");
  }
  const pasados = arr(ctx.recently_passed_retail_events).slice(0, 3);
  if (pasados.length > 0) {
    lineas.push(
      "Ya pasaron (solo sirven para mirar atrás, nunca como algo que llega): " +
        listaEs(pasados.map((e) => txt(e.name, 60) + ", " + plazoEs(e.days_ago !== null && e.days_ago !== undefined ? -Number(e.days_ago) : null))) +
        ".",
    );
  }
  if (proximos.length === 0 && pasados.length === 0) {
    lineas.push("No hay ninguna fecha del calendario comercial cerca. No menciones ninguna.");
  }
  return seccion("CALENDARIO COMERCIAL", lineas);
}

function seccionSector(ctx: FactsContext): Seccion | null {
  const si = ctx.sector_intel || null;
  if (!si) return null;
  const lineas: string[] = [];

  const kpis = arr(si.kpis_focus).slice(0, 5).map((k) => txt(k, 60)).filter(Boolean);
  if (kpis.length > 0) lineas.push("Indicadores que importan en este sector: " + listaEs(kpis) + ".");

  // Estacionalidad YA resuelta al mes en curso: el modelo no tiene que decidir
  // qué ventana toca, solo si la puede atar a un dato real de arriba.
  const mes = Number(String(ctx.date || "").slice(5, 7));
  const ahora = arr(si.seasonal_focus).filter((s) => arr(s.months).indexOf(mes) !== -1);
  for (const s of ahora.slice(0, 2)) {
    lineas.push("Toca ahora en el sector: " + txt(s.name, 60) + " — " + txt(s.note, 160) + ".");
  }

  const campanas = arr(si.campaign_archetypes).slice(0, 4).map((c) => txt(c, 70)).filter(Boolean);
  if (campanas.length > 0) {
    lineas.push("Campañas típicas del sector (solo valen si las puedes atar a un dato de arriba): " + listaEs(campanas) + ".");
  }

  const normas = arr(si.regulatory_notes).slice(0, 3).map((n) => txt(n, 90)).filter(Boolean);
  if (normas.length > 0) {
    lineas.push("Normativa habitual del sector (solo si hoy viene a cuento por algo de arriba): " + listaEs(normas) + ".");
  }

  const proveedores = arr(si.supplier_types).slice(0, 5).map((p) => txt(p, 40)).filter(Boolean);
  if (proveedores.length > 0) lineas.push("Tipos de proveedor habituales: " + listaEs(proveedores) + ".");

  return seccion("CONOCIMIENTO DEL SECTOR", lineas);
}

/**
 * Tipos de tarea que ya se cuentan, con más detalle, en otra sección: el correo,
 * los costes, las reseñas, las ayudas, la normativa o las noticias. Repetirlos
 * aquí solo servía para que el mismo hecho ocupara sitio dos veces.
 */
const TAREAS_YA_CONTADAS: Record<string, true> = {
  email_reply: true,
  review_reply: true,
  cost_review: true,
  price_review: true,
  subsidy_check: true,
  regulation_review: true,
  competitive_action: true,
};

function seccionPendientes(ctx: FactsContext): Seccion | null {
  const lineas: string[] = [];
  const nuevas = <T extends { type?: string | null }>(tareas: T[]): T[] =>
    tareas.filter((t) => !TAREAS_YA_CONTADAS[String(t && t.type)]);
  const altas = nuevas(arr(ctx.high_priority_tasks)).slice(0, 5);
  if (altas.length > 0) {
    lineas.push("Urgentes según el sistema:");
    for (const t of altas) {
      const tiempo = txt(t.time_estimate, 20);
      lineas.push("- " + txt(t.title, 110) + (tiempo ? " (" + tiempo + ")" : "") + ".");
    }
  }
  const medias = nuevas(arr(ctx.medium_priority_tasks)).slice(0, 4).map((t) => txt(t.title, 90)).filter(Boolean);
  if (medias.length > 0) lineas.push("Menos urgentes: " + medias.join("; ") + ".");
  return seccion("OTROS PENDIENTES DETECTADOS", lineas);
}

/* ─── Punto de entrada ───────────────────────────────────────────────────── */

/**
 * Convierte el ctx en el bloque de hechos que ve el modelo.
 * Texto plano, sin claves JSON, sin indentación y sin URLs.
 */
export function buildBriefingFacts(ctx: FactsContext | null | undefined): string {
  const c = ctx || {};
  const anio = Number(String(c.date || "").slice(0, 4)) || new Date().getUTCFullYear();

  const secciones = [
    seccionNegocio(c, anio),
    seccionCorreo(c, anio),
    seccionAgenda(c, anio),
    seccionVentas(c),
    seccionCostes(c),
    seccionResenas(c, anio),
    seccionEntorno(c),
    seccionNoticias(c, anio),
    seccionFechas(c, anio),
    seccionSector(c),
    seccionPendientes(c),
  ].filter((s): s is Seccion => s !== null);

  const bloques = secciones.map((s) => s.titulo + "\n" + s.lineas.join("\n"));
  if (bloques.length === 0) {
    return "HOY\nNo hay ningún dato del negocio disponible hoy. No inventes nada: dilo en una frase.";
  }
  return bloques.join("\n\n");
}
