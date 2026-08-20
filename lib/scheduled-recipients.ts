/**
 * Resolución de los destinatarios de un envío programado.
 *
 * La usa el dispatcher (app/api/cron/dispatch-scheduled) en cada disparo, y es
 * donde vive la diferencia entre los dos modos de audiencia:
 *
 *   * `manual` → la foto de clientes que el usuario eligió al programarlo.
 *     Si alguno se borra o se queda sin teléfono/email, simplemente sale de la
 *     lista; no se sustituye por nadie.
 *
 *   * `filter` → SOLO se guardó el criterio, así que la lista se recalcula
 *     aquí en cada disparo. Es lo que hace que "cada lunes a quien tenga una
 *     factura vencida" signifique lo que parece: quien la tenga ESE lunes.
 *
 * Los importes pendiente/vencido se agregan igual que en las pantallas de
 * WhatsApp y Emails, para que la vista previa y el envío real resuelvan
 * {importe} con el mismo número.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { OPEN_BUDGET_STATUSES, type MessagingVars } from "@/lib/messaging-vars";
import type { Audience, MessageChannel } from "@/lib/scheduled-messages";

/** Un destinatario listo para enviar: variables resueltas + dirección. */
export type ScheduledRecipient = MessagingVars & {
  id: string;
  /** Teléfono o email según el canal. */
  address: string;
};

export type ResolvedAudience = {
  recipients: ScheduledRecipient[];
  /** Clientes que encajaban con la audiencia pero no tienen teléfono/email. */
  skippedNoAddress: number;
};

type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: string | null;
};

export async function resolveRecipients(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  channel: MessageChannel,
  audience: Audience
): Promise<ResolvedAudience> {
  const [clientsRes, budgetsRes, invoicesRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, email, phone, company, status")
      .eq("user_id", userId)
      .order("name"),
    supabase
      .from("budgets")
      .select("client_id, status, total")
      .eq("user_id", userId)
      /* El dispatcher entra con la service role key y esa salta RLS, incluida
         la política restrictiva que esconde la papelera (budgets_hide_trashed).
         Sin este filtro contaría presupuestos borrados y las pantallas y el
         envío real no coincidirían. */
      .is("deleted_at", null),
    supabase
      .from("issued_invoices")
      .select("client_id, total, due_date, payment_status, status")
      .eq("user_id", userId)
      .is("deleted_at", null),
  ]);

  const pending = new Map<string, number>();
  for (const b of (budgetsRes.data || []) as { client_id: string | null; status: string; total: number | null }[]) {
    if (!b.client_id || !OPEN_BUDGET_STATUSES.includes(b.status)) continue;
    pending.set(b.client_id, (pending.get(b.client_id) || 0) + Number(b.total || 0));
  }

  const now = Date.now();
  const overdue = new Map<string, number>();
  for (const i of (invoicesRes.data || []) as {
    client_id: string | null;
    total: number | null;
    due_date: string | null;
    payment_status: string;
    status: string;
  }[]) {
    if (!i.client_id || !i.due_date) continue;
    if (i.payment_status === "paid" || i.status === "cancelled") continue;
    if (new Date(i.due_date).getTime() >= now) continue;
    overdue.set(i.client_id, (overdue.get(i.client_id) || 0) + Number(i.total || 0));
  }

  const all = (clientsRes.data || []) as ClientRow[];

  const matches = (c: ClientRow) => {
    if (audience.mode === "manual") return audience.client_ids.includes(c.id);
    if (audience.filter === "pending_budget") return (pending.get(c.id) || 0) > 0;
    if (audience.filter === "overdue_invoice") return (overdue.get(c.id) || 0) > 0;
    if (audience.filter === "active") return c.status === "active";
    return true; // "all"
  };

  const chosen = all.filter(matches);

  const recipients: ScheduledRecipient[] = [];
  for (const c of chosen) {
    const address = ((channel === "whatsapp" ? c.phone : c.email) || "").trim();
    if (!address) continue;
    recipients.push({
      id: c.id,
      name: c.name,
      company: c.company || "",
      address,
      pending: pending.get(c.id) || 0,
      overdue: overdue.get(c.id) || 0,
    });
  }

  return { recipients, skippedNoAddress: chosen.length - recipients.length };
}
