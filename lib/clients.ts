/**
 * Clientes: tipos y totales.
 *
 * `clients` no guarda importes. Igual que `suppliers`, los totales se suman al
 * leerlos sobre las facturas del cliente — aquí `issued_invoices` en vez de
 * `received_invoices`. Ver `getSuppliersInvoiceTotals` en lib/suppliers.ts: es
 * el mismo patrón y se mantiene deliberadamente en paralelo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Client {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  status: string;
  /** Etiquetas libres. La columna es `not null default '{}'`, pero las filas
      que se leyeron antes de la migración pueden llegar sin el campo. */
  tags: string[] | null;
  created_at: string;
  updated_at: string | null;
  last_contacted_at: string | null;
}

/** Estados que usa el formulario. Son los tres que la tabla ya contenía. */
export const CLIENT_STATUSES = ["lead", "active", "inactive"] as const;

export const clientStatusLabels: Record<string, string> = {
  lead: "Lead",
  active: "Activo",
  inactive: "Inactivo",
};

export interface ClientInvoiceTotals {
  /** Vencido y sin cobrar: lo que el cliente debe HOY. */
  overdue: number;
  /** Emitido y sin cobrar pero todavía en plazo. */
  pending: number;
  /** Total facturado, anuladas aparte. */
  invoiced: number;
  invoice_count: number;
  overdue_count: number;
  pending_count: number;
  /** Vencimiento más lejano de lo vencido / lo pendiente, para el subtítulo. */
  oldest_overdue_date: string | null;
  next_due_date: string | null;
}

export const EMPTY_CLIENT_TOTALS: ClientInvoiceTotals = {
  overdue: 0,
  pending: 0,
  invoiced: 0,
  invoice_count: 0,
  overdue_count: 0,
  pending_count: 0,
  oldest_overdue_date: null,
  next_due_date: null,
};

/** Las columnas mínimas para sumar. Se listan para no traerse el XML de
    Facturae ni el hash de VeriFactu en el listado. */
const TOTALS_COLUMNS =
  "client_id, total, amount_paid, status, payment_status, due_date";

interface TotalsRow {
  client_id: string | null;
  total: number | null;
  amount_paid: number | null;
  status: string | null;
  payment_status: string | null;
  due_date: string | null;
}

/**
 * Totales facturados de varios clientes, en una sola consulta.
 *
 * Reglas, que son las que ya usa el hub de Facturación (`isOverdueInvoice`):
 *  - una factura ANULADA (`status = 'cancelled'`) no cuenta para nada;
 *  - lo que queda por cobrar de una factura es `total - amount_paid`, nunca
 *    negativo, y es cero en cuanto `payment_status = 'paid'`;
 *  - está VENCIDA si tiene `due_date` pasado y no está cobrada. Sin `due_date`
 *    no puede vencer, así que cae en pendiente.
 *
 * La política `issued_invoices_hide_trashed` ya excluye la papelera, igual que
 * en proveedores: no hace falta filtrar `deleted_at` aquí.
 *
 * Devuelve un Map por client_id. Los clientes sin facturas no aparecen: usa
 * EMPTY_CLIENT_TOTALS como valor por defecto.
 */
export async function getClientsInvoiceTotals(
  supabase: SupabaseClient,
  clientIds: string[]
): Promise<Map<string, ClientInvoiceTotals>> {
  const totals = new Map<string, ClientInvoiceTotals>();
  if (clientIds.length === 0) return totals;

  const { data } = await supabase
    .from("issued_invoices")
    .select(TOTALS_COLUMNS)
    .in("client_id", clientIds);

  /* Un solo "hoy" para toda la pasada: si se recalculara por fila, una
     factura que vence justo hoy podría contarse como vencida y como
     pendiente en la misma tabla. */
  const today = new Date().toISOString().slice(0, 10);

  for (const invoice of (data || []) as TotalsRow[]) {
    if (!invoice.client_id) continue;
    if (invoice.status === "cancelled") continue;

    const current = totals.get(invoice.client_id) ?? EMPTY_CLIENT_TOTALS;
    const total = Number(invoice.total || 0);
    const paid = Number(invoice.amount_paid || 0);
    const settled = invoice.payment_status === "paid";
    const outstanding = settled ? 0 : Math.max(total - paid, 0);
    const overdue = outstanding > 0 && !!invoice.due_date && invoice.due_date < today;

    totals.set(invoice.client_id, {
      invoiced: current.invoiced + total,
      invoice_count: current.invoice_count + 1,
      overdue: current.overdue + (overdue ? outstanding : 0),
      overdue_count: current.overdue_count + (overdue ? 1 : 0),
      pending: current.pending + (!overdue ? outstanding : 0),
      pending_count: current.pending_count + (!overdue && outstanding > 0 ? 1 : 0),
      oldest_overdue_date:
        overdue && invoice.due_date
          ? minDate(current.oldest_overdue_date, invoice.due_date)
          : current.oldest_overdue_date,
      next_due_date:
        !overdue && outstanding > 0 && invoice.due_date
          ? minDate(current.next_due_date, invoice.due_date)
          : current.next_due_date,
    });
  }

  return totals;
}

function minDate(a: string | null, b: string): string {
  return a === null || b < a ? b : a;
}

/** Totales de un único cliente. Misma suma que el listado, un solo sitio. */
export async function getClientInvoiceTotals(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientInvoiceTotals> {
  const totals = await getClientsInvoiceTotals(supabase, [clientId]);
  return totals.get(clientId) ?? EMPTY_CLIENT_TOTALS;
}

/* ─── Formato ──────────────────────────────────────────────────────────── */

export function eur(n: number): string {
  return Number(n || 0).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });
}

export function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString("es-ES") : "—";
}

/** "12 ago" — la forma corta que usan los subtítulos de la ficha. */
export function fmtDayMonth(d: string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

/** "hace 2 días" / "hace 3 meses". Devuelve "hoy" para el mismo día. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(months / 12);
  return `hace ${years} ${years === 1 ? "año" : "años"}`;
}

/** Iniciales para el avatar: dos letras como mucho, sin signos. */
export function initials(name: string): string {
  const words = (name || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/* ─── Vocabularios de estado de lo que cuelga del cliente ──────────────
   Los valores son los que la base de datos contiene de verdad. `budgets`
   mezcla castellano e inglés a propósito (ver el comentario de la columna
   en Supabase), así que el mapa acepta los dos. Lo que no reconozca cae en
   "neutral" y muestra el valor crudo: mejor eso que inventar una etiqueta. */

export const budgetStatusLabels: Record<string, string> = {
  borrador: "Borrador", draft: "Borrador",
  pendiente: "Pendiente", pending: "Pendiente",
  enviado: "Enviado", sent: "Enviado",
  aceptado: "Aceptado", accepted: "Aceptado",
  rechazado: "Rechazado", rejected: "Rechazado",
};

export const invoiceStatusLabels: Record<string, string> = {
  draft: "Borrador",
  issued: "Emitida",
  sent: "Enviada",
  paid: "Cobrada",
  overdue: "Vencida",
  cancelled: "Anulada",
  rectified: "Rectificada",
};

export const projectStatusLabels: Record<string, string> = {
  planning: "Planificación",
  in_progress: "En ejecución",
  active: "En ejecución",
  paused: "Pausada",
  completed: "Finalizada",
  cancelled: "Cancelada",
};

export const messageStatusLabels: Record<string, string> = {
  sent: "Enviado",
  pending: "Pendiente",
  failed: "Fallido",
};
