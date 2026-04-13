import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Log an AI run for compliance traceability.
 * Fire-and-forget — never blocks the main operation.
 */
export async function logAiRun(
  supabase: SupabaseClient,
  params: {
    run_type: string; // 'budget_generation', 'ocr_invoice', 'chat', etc.
    model: string;
    prompt_version?: string;
    input_hash?: string;
    output_hash?: string;
    tokens_in?: number;
    tokens_out?: number;
    duration_ms?: number;
    entity_type?: string;
    entity_id?: string;
  }
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

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
  } catch (e) {
    console.warn("[ai-logger] failed:", e);
  }
}

/**
 * Helper to compute SHA-256 hash of a string (for input/output hashing).
 */
export async function hashText(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
