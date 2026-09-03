/**
 * Piezas compartidas por el hub de Facturación.
 *
 * Se extraen tal cual estaban en las páginas originales (facturas emitidas y
 * recibidas) para que el hub reutilice la MISMA lógica: nada de reglas de
 * negocio nuevas, solo un sitio común donde vivir.
 */

export interface IssuedInvoice {
  id: string; client_id: string | null; project_id: string | null;
  series: string; number: number; invoice_number: string;
  client_name: string; client_nif: string; client_email?: string | null;
  clients?: { id: string; name: string; email?: string | null } | null;
  issue_date: string; due_date: string | null;
  subtotal: number; iva_percent: number; iva_amount: number;
  irpf_percent: number; irpf_amount: number; total: number;
  status: string; payment_status: string; payment_date: string | null;
  verifactu_hash: string; verifactu_registered: boolean;
  created_at: string;
}

export interface Client { id: string; name: string; email: string | null; }
export interface Project { id: string; name: string; }

export const statusMap: Record<string, { label: string; variant: "gray" | "blue" | "purple" | "green" | "red" | "yellow" | "orange" }> = {
  draft: { label: "Borrador", variant: "gray" },
  issued: { label: "Emitida", variant: "blue" },
  sent: { label: "Enviada", variant: "purple" },
  paid: { label: "Cobrada", variant: "green" },
  overdue: { label: "Vencida", variant: "red" },
  cancelled: { label: "Anulada", variant: "gray" },
  rectified: { label: "Rectificada", variant: "orange" },
};

export function eur(n: number) {
  return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

export function fmtDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString("es-ES") : "—";
}

export function daysSince(d: string) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

/** Vencida = tiene vencimiento pasado, no está cobrada y no está anulada. */
export function isOverdueInvoice(inv: IssuedInvoice): boolean {
  return !!(
    inv.due_date &&
    inv.payment_status !== "paid" &&
    inv.status !== "cancelled" &&
    new Date(inv.due_date) < new Date()
  );
}

export const inputCls =
  "w-full bg-white dark:bg-zinc-900 text-navy-900 dark:text-white placeholder:text-navy-400 dark:placeholder:text-zinc-500 rounded-lg px-4 py-2 border border-navy-200 dark:border-zinc-800 focus:border-brand-green focus:outline-none text-sm";
