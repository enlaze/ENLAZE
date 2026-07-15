"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAiRun = logAiRun;
exports.hashText = hashText;
/**
 * Log an AI run for compliance traceability.
 * Fire-and-forget — never blocks the main operation.
 */
async function logAiRun(supabase, params) {
    try {
        const { data: { user }, } = await supabase.auth.getUser();
        await supabase.from("ai_runs").insert({
            user_id: user?.id || null,
            run_type: params.run_type,
            model: params.model,
            prompt_version: params.prompt_version || null,
            input_hash: params.input_hash || null,
            output_hash: params.output_hash || null,
            tokens_in: params.tokens_in || null,
            tokens_out: params.tokens_out || null,
            duration_ms: params.duration_ms || null,
            entity_type: params.entity_type || null,
            entity_id: params.entity_id || null,
        });
    }
    catch (e) {
        console.warn("[ai-logger] failed:", e);
    }
}
/**
 * Helper to compute SHA-256 hash of a string (for input/output hashing).
 */
async function hashText(text) {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
