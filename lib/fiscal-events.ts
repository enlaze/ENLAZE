import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fiscal event types for issued invoices.
 * Tracks the complete lifecycle: creation → hash → XML → send → payment → correction → cancellation.
 */
export type FiscalEventType =
  | "created"
  | "issued"
  | "hash_generated"
  | "xml_generated"
  | "sent"
  | "paid"
  | "corrected"
  | "cancelled";

const eventLabels: Record<FiscalEventType, string> = {
  created: "Factura creada",
  issued: "Factura emitida",
  hash_generated: "Hash Verifactu generado",
  xml_generated: "XML Facturae generado",
  sent: "Enviada al cliente",
  paid: "Cobrada",
  corrected: "Factura rectificada",
  cancelled: "Factura anulada",
};

const eventIcons: Record<FiscalEventType, string> = {
  created: "📝",
  issued: "✅",
  hash_generated: "🔐",
  xml_generated: "📄",
  sent: "📤",
  paid: "💰",
  corrected: "🔄",
  cancelled: "❌",
};

export { eventLabels, eventIcons };

/**
 * Record a fiscal event for an invoice. Fire-and-forget.
 */
export async function recordFiscalEvent(
  supabase: SupabaseClient,
  params: {
    invoice_id: string;
    event_type: FiscalEventType;
    event_data?: Record<string, unknown>;
  }
) {
  try {
    // Get current software version
    const { data: sv } = await supabase
      .from("software_versions")
      .select("id")
      .eq("is_current", true)
      .limit(1)
      .single();

    await supabase.from("fiscal_events").insert({
      invoice_id: params.invoice_id,
      event_type: params.event_type,
      event_data: params.event_data || {},
      software_version_id: sv?.id || null,
    });
  } catch (e) {
    console.warn("[fiscal-events] failed:", e);
  }
}

/**
 * Get the full fiscal event timeline for an invoice.
 */
export async function getFiscalTimeline(
  supabase: SupabaseClient,
  invoice_id: string
) {
  try {
    const { data } = await supabase
      .from("fiscal_events")
      .select("id, event_type, event_data, created_at, software_version_id")
      .eq("invoice_id", invoice_id)
      .order("created_at", { ascending: true });

    return (data || []).map((ev) => ({
      ...ev,
      label: eventLabels[ev.event_type as FiscalEventType] || ev.event_type,
      icon: eventIcons[ev.event_type as FiscalEventType] || "📋",
    }));
  } catch {
    return [];
  }
}
