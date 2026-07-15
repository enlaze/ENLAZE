"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveDocumentVersion = saveDocumentVersion;
exports.getNextVersion = getNextVersion;
exports.getVersionHistory = getVersionHistory;
const activity_log_1 = require("./activity-log");
/**
 * Save a snapshot of an entity for audit/versioning purposes.
 * Fire-and-forget — never blocks the main operation.
 */
async function saveDocumentVersion(supabase, params) {
    try {
        const { data: { user }, } = await supabase.auth.getUser();
        await supabase.from("document_versions").insert({
            entity_type: params.entity_type,
            entity_id: params.entity_id,
            version: params.version,
            snapshot: params.snapshot,
            changed_by: user?.id || null,
            change_summary: params.change_summary || null,
        });
        await (0, activity_log_1.logActivity)(supabase, {
            action: `${params.entity_type}.version_saved`,
            entity_type: params.entity_type,
            entity_id: params.entity_id,
            metadata: {
                version: params.version,
                summary: params.change_summary,
            },
        });
    }
    catch (e) {
        console.warn("[document-versions] failed:", e);
    }
}
/**
 * Get the next version number for an entity.
 */
async function getNextVersion(supabase, entity_type, entity_id) {
    try {
        const { data } = await supabase
            .from("document_versions")
            .select("version")
            .eq("entity_type", entity_type)
            .eq("entity_id", entity_id)
            .order("version", { ascending: false })
            .limit(1)
            .single();
        return (data?.version || 0) + 1;
    }
    catch {
        return 1;
    }
}
/**
 * Get version history for an entity.
 */
async function getVersionHistory(supabase, entity_type, entity_id) {
    try {
        const { data } = await supabase
            .from("document_versions")
            .select("id, version, change_summary, changed_by, created_at")
            .eq("entity_type", entity_type)
            .eq("entity_id", entity_id)
            .order("version", { ascending: false });
        return data || [];
    }
    catch {
        return [];
    }
}
