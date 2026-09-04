/**
 * Piezas compartidas por el hub de Facturación.
 *
 * Se extraen tal cual estaban en las páginas originales (facturas emitidas y
 * recibidas) para que el hub reutilice la MISMA lógica: nada de reglas de
 * negocio nuevas, solo un sitio común donde vivir.
 */

import type { FactTone } from "./ui";

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

/**
 * Estados de una factura emitida.
 *
 * El `tone` es el del sistema de tokens (neutral / info / success / warning /
 * danger), no una utilidad de color suelta: `StatusPill` lo traduce a
 * `--color-danger`, `--color-warning`... que ya cambian solos entre claro y
 * oscuro. Antes esto era un `variant` del `Badge` genérico, que pinta con
 * emerald/amber/purple ajenos a la paleta.
 */
export const statusMap: Record<string, { label: string; tone: FactTone }> = {
  draft: { label: "Borrador", tone: "neutral" },
  issued: { label: "Emitida", tone: "neutral" },
  sent: { label: "Enviada", tone: "info" },
  paid: { label: "Cobrada", tone: "success" },
  overdue: { label: "Vencida", tone: "danger" },
  cancelled: { label: "Anulada", tone: "neutral" },
  rectified: { label: "Rectificada", tone: "warning" },
};

/**
 * Estados de una factura recibida.
 *
 * Las etiquetas de "Recibidas" venían de `receivedInvoiceStatusLabels`
 * (lib/suppliers.ts), que trae clases pensadas SOLO para tema oscuro
 * (`bg-yellow-900/30 text-yellow-300`); sobre fondo claro quedaban lavadas y
 * casi ilegibles. El hub se queda con las etiquetas de ese mapa —siguen
 * siendo la fuente de verdad, y las otras pantallas de proveedores lo usan
 * igual— y sustituye solo el color por un tono del sistema.
 */
export const receivedStatusTone: Record<string, FactTone> = {
  pending: "warning",
  approved: "neutral",
  paid: "success",
  partial: "info",
  rejected: "danger",
  overdue: "danger",
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

/** Campo del formulario de alta: mismo alto (42px) y esquina (12px) que los
    filtros de la tabla, que es lo que alinea la rejilla del rediseño. */
export const inputCls =
  "w-full h-[42px] bg-white dark:bg-zinc-900 text-navy-900 dark:text-white placeholder:text-navy-400 dark:placeholder:text-zinc-500 rounded-xl px-3.5 border border-navy-200 dark:border-zinc-800 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/20 transition-colors text-sm";
