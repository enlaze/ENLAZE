"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventIcons = exports.eventLabels = void 0;
exports.recordFiscalEvent = recordFiscalEvent;
exports.getFiscalTimeline = getFiscalTimeline;
const eventLabels = {
    created: "Factura creada",
    issued: "Factura emitida",
    hash_generated: "Hash Verifactu generado",
    xml_generated: "XML Facturae generado",
    sent: "Enviada al cliente",
    paid: "Cobrada",
    corrected: "Factura rectificada",
    cancelled: "Factura anulada",
};
exports.eventLabels = eventLabels;
const eventIcons = {
    created: "📝",
    issued: "✅",
    hash_generated: "🔐",
    xml_generated: "📄",
    sent: "📤",
    paid: "💰",
    corrected: "🔄",
    cancelled: "❌",
};
exports.eventIcons = eventIcons;
/**
 * Record a fiscal event for an invoice. Fire-and-forget.
 */
async function recordFiscalEvent(supabase, params) {
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
    }
    catch (e) {
        console.warn("[fiscal-events] failed:", e);
    }
}
/**
 * Get the full fiscal event timeline for an invoice.
 */
async function getFiscalTimeline(supabase, invoice_id) {
    try {
        const { data } = await supabase
            .from("fiscal_events")
            .select("id, event_type, event_data, created_at, software_version_id")
            .eq("invoice_id", invoice_id)
            .order("created_at", { ascending: true });
        return (data || []).map((ev) => ({
            ...ev,
            label: eventLabels[ev.event_type] || ev.event_type,
            icon: eventIcons[ev.event_type] || "📋",
        }));
    }
    catch {
        return [];
    }
}
