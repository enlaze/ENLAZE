/**
 * Hechos del negocio para el resumen diario: lo que la cuenta tiene en Enlaze.
 *
 * Hasta ahora el resumen solo se construía con lo que el agente de n8n trae de
 * fuera (Gmail, Calendar, Sheets, mercado, reseñas, noticias) y no miraba las
 * facturas ni los presupuestos de la propia app. Este módulo calcula, en
 * código y sin IA, las tres cosas que el resumen promete cada mañana:
 *
 *  - qué cobrar: facturas emitidas vencidas;
 *  - a quién contestar: presupuestos enviados sin respuesta;
 *  - qué presupuesto mandar: presupuestos terminados sin enviar;
 *
 * y además los avisos de subida de precio de proveedores sin leer y las
 * facturas de proveedor que vencen pronto.
 *
 * Es una función pura: recibe las filas y la fecha de hoy y devuelve las
 * acciones. Así se prueba sin base de datos y funciona aunque la IA no esté
 * disponible. Las reglas de cobro son las mismas que usa Facturación
 * (`lib/clients.ts`): anuladas fuera, lo pendiente es `total - amount_paid`
 * y vence si `due_date` es anterior a hoy.
 */

export type BusinessFactKind =
  | "cobrar"
  | "contestar"
  | "enviar"
  | "precio";

export type BusinessFactPriority = "alta" | "media" | "baja";

export interface BusinessAction {
  kind: BusinessFactKind;
  title: string;
  reason: string;
  moment?: string;
  priority: BusinessFactPriority;
  /** Dónde está preparado lo que hay que hacer. */
  href: string;
}

export interface IssuedInvoiceFactRow {
  id: string;
  invoice_number: string | null;
  client_name: string | null;
  total: number | string | null;
  amount_paid: number | string | null;
  due_date: string | null;
  status: string | null;
  payment_status: string | null;
}

export interface BudgetFactRow {
  id: string;
  title: string | null;
  client_name: string | null;
  total: number | string | null;
  status: string | null;
  sent_at: string | null;
  updated_at: string | null;
  valid_until: string | null;
}

export interface PriceNotificationFactRow {
  id: string;
  product_name: string;
  provider_name: string | null;
  old_price: number | string | null;
  new_price: number | string | null;
  change_pct: number | string | null;
  direction: string | null;
  is_read: boolean | null;
  created_at: string;
}

export interface ReceivedInvoiceFactRow {
  id: string;
  supplier_name: string | null;
  total: number | string | null;
  amount_paid: number | string | null;
  due_date: string | null;
  status: string | null;
  payment_status: string | null;
}

export interface BusinessFactsInput {
  /** Hoy en hora de Madrid, AAAA-MM-DD. */
  today: string;
  issuedInvoices: readonly IssuedInvoiceFactRow[];
  budgets: readonly BudgetFactRow[];
  priceNotifications: readonly PriceNotificationFactRow[];
  receivedInvoices: readonly ReceivedInvoiceFactRow[];
}

export interface BusinessFacts {
  actions: BusinessAction[];
  watchOuts: string[];
  overdue: { count: number; amount: number };
  unanswered: { count: number; amount: number };
  toSend: { count: number };
  priceRises: { count: number };
  /** Titular mecánico, o null si no hay nada que contar. */
  headline: string | null;
  /** Narrativa mecánica, o null si no hay nada que contar. */
  narrative: string | null;
}

/** Cuántas acciones del negocio entran, como mucho, en el resumen. */
export const MAX_BUSINESS_ACTIONS = 5;
/** Un presupuesto enviado cuenta como «sin respuesta» desde este día. */
export const UNANSWERED_AFTER_DAYS = 2;
/** Los avisos de precio más antiguos que esto ya no salen. */
export const PRICE_NOTICE_MAX_AGE_DAYS = 7;
/** Una factura de proveedor sale en «Ojo con» si vence en estos días. */
export const SUPPLIER_DUE_SOON_DAYS = 7;

const UNPAYABLE_STATUSES = new Set(["cancelled", "draft", "rectified"]);
const SENT_STATUSES = new Set(["enviado", "sent"]);
const READY_STATUSES = new Set(["pendiente", "pending"]);

function n(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Días enteros entre dos fechas AAAA-MM-DD (o ISO); positivo si `from` es anterior. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Hoy en Madrid como AAAA-MM-DD (el resumen es «de hoy» en España). */
export function madridToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(now);
}

export function formatEur(amount: number): string {
  const whole = Math.abs(amount % 1) < 0.005;
  return (
    new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    }).format(amount) + " €"
  );
}

function days(count: number): string {
  return count === 1 ? "1 día" : `${count} días`;
}

function pct(value: number): string {
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value)} %`;
}

function price(value: number): string {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).format(value) + " €";
}

const PRIORITY_RANK: Record<BusinessFactPriority, number> = { alta: 0, media: 1, baja: 2 };

export function buildBusinessFacts(input: BusinessFactsInput): BusinessFacts {
  const { today } = input;

  // ── Qué cobrar ──────────────────────────────────────────────────────
  const overdue = input.issuedInvoices
    .filter((inv) => !UNPAYABLE_STATUSES.has(inv.status ?? ""))
    .filter((inv) => inv.payment_status !== "paid" && inv.status !== "paid")
    .map((inv) => ({
      inv,
      pending: Math.max(n(inv.total) - n(inv.amount_paid), 0),
      late: inv.due_date ? daysBetween(inv.due_date, today) : 0,
    }))
    .filter((x) => x.pending > 0 && !!x.inv.due_date && x.late > 0)
    .sort((a, b) => b.late - a.late || b.pending - a.pending);

  const cobrar: BusinessAction[] = overdue.map(({ inv, pending, late }) => ({
    kind: "cobrar",
    title: `Reclamar la factura ${inv.invoice_number || "sin número"}${inv.client_name ? ` a ${inv.client_name}` : ""}`,
    reason: `${formatEur(pending)}, vencida hace ${days(late)}. El recordatorio está preparado.`,
    moment: "Esta mañana",
    priority: late >= 7 || pending >= 1000 ? "alta" : "media",
    href: `/dashboard/facturacion?tab=emitidas&reclamar=${encodeURIComponent(inv.id)}`,
  }));

  // ── A quién contestar ───────────────────────────────────────────────
  const unanswered = input.budgets
    .filter((b) => SENT_STATUSES.has(b.status ?? "") && !!b.sent_at)
    .filter((b) => !b.valid_until || b.valid_until >= today)
    .map((b) => ({ b, waiting: daysBetween(b.sent_at!.slice(0, 10), today) }))
    .filter((x) => x.waiting >= UNANSWERED_AFTER_DAYS)
    .sort((a, b) => n(b.b.total) - n(a.b.total) || b.waiting - a.waiting);

  const contestar: BusinessAction[] = unanswered.map(({ b, waiting }) => ({
    kind: "contestar",
    title: b.client_name
      ? `Llamar a ${b.client_name} por el presupuesto «${b.title || "sin título"}»`
      : `Preguntar por el presupuesto «${b.title || "sin título"}»`,
    reason: `${formatEur(n(b.total))}, enviado hace ${days(waiting)} y sin respuesta.`,
    moment: "Hoy",
    priority: n(b.total) >= 1000 ? "alta" : "media",
    href: `/dashboard/budgets/${encodeURIComponent(b.id)}`,
  }));

  // ── Qué presupuesto mandar ──────────────────────────────────────────
  const ready = input.budgets
    .filter((b) => READY_STATUSES.has(b.status ?? ""))
    .filter((b) => !b.valid_until || b.valid_until >= today)
    .sort((a, b) => n(b.total) - n(a.total));

  const enviar: BusinessAction[] = ready.map((b) => {
    const idle = b.updated_at ? daysBetween(b.updated_at.slice(0, 10), today) : 0;
    return {
      kind: "enviar",
      title: `Mandar el presupuesto «${b.title || "sin título"}»${b.client_name ? ` a ${b.client_name}` : ""}`,
      reason:
        idle > 0
          ? `${formatEur(n(b.total))}. Está terminado y sin enviar desde hace ${days(idle)}.`
          : `${formatEur(n(b.total))}. Está terminado y sin enviar.`,
      priority: "media",
      href: `/dashboard/budgets/${encodeURIComponent(b.id)}`,
    };
  });

  // ── Avisos de precio ────────────────────────────────────────────────
  const rises = input.priceNotifications
    .filter((p) => p.direction === "up" && p.is_read !== true)
    .filter((p) => daysBetween(p.created_at.slice(0, 10), today) <= PRICE_NOTICE_MAX_AGE_DAYS)
    .sort((a, b) => n(b.change_pct) - n(a.change_pct));

  const precio: BusinessAction[] = rises.map((p) => ({
    kind: "precio",
    title: `Revisar el precio de ${p.product_name}`,
    reason: `${p.provider_name ? `${p.provider_name} lo ha subido` : "Ha subido"} de ${price(n(p.old_price))} a ${price(n(p.new_price))} (+${pct(n(p.change_pct))}).`,
    moment: "Antes del próximo presupuesto",
    priority: "media",
    href: "/dashboard/prices?tab=alertas",
  }));

  // Orden: prioridad y, a igualdad, cobrar > contestar > enviar > precio.
  const order: BusinessFactKind[] = ["cobrar", "contestar", "enviar", "precio"];
  const actions = [...cobrar, ...contestar, ...enviar, ...precio]
    .map((a, i) => ({ a, i }))
    .sort(
      (x, y) =>
        PRIORITY_RANK[x.a.priority] - PRIORITY_RANK[y.a.priority] ||
        order.indexOf(x.a.kind) - order.indexOf(y.a.kind) ||
        x.i - y.i,
    )
    .map((x) => x.a)
    .slice(0, MAX_BUSINESS_ACTIONS);

  // ── Ojo con: facturas de proveedor que vencen pronto ────────────────
  const watchOuts = input.receivedInvoices
    .filter((r) => r.payment_status !== "paid" && r.status !== "paid" && r.status !== "rejected")
    .map((r) => ({ r, left: r.due_date ? daysBetween(today, r.due_date) : -1, pending: Math.max(n(r.total) - n(r.amount_paid), 0) }))
    .filter((x) => x.pending > 0 && x.left >= 0 && x.left <= SUPPLIER_DUE_SOON_DAYS)
    .sort((a, b) => a.left - b.left)
    .map(({ r, left, pending }) =>
      left === 0
        ? `Hoy vence la factura de ${r.supplier_name || "un proveedor"} (${formatEur(pending)}).`
        : `La factura de ${r.supplier_name || "un proveedor"} (${formatEur(pending)}) vence en ${days(left)}.`,
    );

  const overdueAmount = overdue.reduce((s, x) => s + x.pending, 0);
  const unansweredAmount = unanswered.reduce((s, x) => s + n(x.b.total), 0);

  return {
    actions,
    watchOuts,
    overdue: { count: overdue.length, amount: overdueAmount },
    unanswered: { count: unanswered.length, amount: unansweredAmount },
    toSend: { count: ready.length },
    priceRises: { count: rises.length },
    headline: mechanicalHeadline(overdue.length, overdueAmount, unanswered.length, ready.length, rises.length),
    narrative: mechanicalNarrative(overdue.length, overdueAmount, unanswered.length, ready.length, rises.length),
  };
}

function mechanicalHeadline(
  overdueCount: number,
  overdueAmount: number,
  unansweredCount: number,
  readyCount: number,
  risesCount: number,
): string | null {
  const parts: string[] = [];
  if (overdueCount > 0) parts.push(`cobrar ${formatEur(overdueAmount)}`);
  if (unansweredCount > 0) {
    parts.push(unansweredCount === 1 ? "contestar un presupuesto" : `contestar ${unansweredCount} presupuestos`);
  }
  if (readyCount > 0) {
    parts.push(readyCount === 1 ? "mandar un presupuesto" : `mandar ${readyCount} presupuestos`);
  }
  if (parts.length === 0) {
    if (risesCount === 0) return null;
    return risesCount === 1 ? "Un proveedor te ha subido un precio" : `Te han subido ${risesCount} precios`;
  }
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
  return `Hoy toca ${list}`;
}

function mechanicalNarrative(
  overdueCount: number,
  overdueAmount: number,
  unansweredCount: number,
  readyCount: number,
  risesCount: number,
): string | null {
  const s: string[] = [];
  if (overdueCount === 1) s.push(`Tienes una factura vencida de ${formatEur(overdueAmount)}.`);
  else if (overdueCount > 1) s.push(`Tienes ${overdueCount} facturas vencidas que suman ${formatEur(overdueAmount)}.`);
  if (unansweredCount === 1) s.push("Un presupuesto enviado sigue sin respuesta.");
  else if (unansweredCount > 1) s.push(`${unansweredCount} presupuestos enviados siguen sin respuesta.`);
  if (readyCount === 1) s.push("Tienes un presupuesto terminado sin enviar.");
  else if (readyCount > 1) s.push(`Tienes ${readyCount} presupuestos terminados sin enviar.`);
  if (risesCount === 1) s.push("Un proveedor ha subido el precio de un material que vigilas.");
  else if (risesCount > 1) s.push(`Han subido ${risesCount} materiales que vigilas.`);
  return s.length ? s.join(" ") : null;
}
