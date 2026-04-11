import { SupabaseClient } from "@supabase/supabase-js";

export interface LogActivityParams {
  action: string;
  entity_type?: string;
  entity_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget activity logger.
 * Never throws — if it fails, it silently logs to console.
 */
export async function logActivity(
  supabase: SupabaseClient,
  params: LogActivityParams
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("activity_log").insert({
      user_id: user.id,
      action: params.action,
      entity_type: params.entity_type || null,
      entity_id: params.entity_id || null,
      metadata: params.metadata || {},
      // IP and user_agent are best captured server-side;
      // from client we store what we can
      ip_address: null,
      user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch (e) {
    console.warn("[activity-log] failed:", e);
  }
}

/**
 * Record a legal document acceptance with full traceability.
 */
export async function recordLegalAcceptance(
  supabase: SupabaseClient,
  documentType: string,
  documentVersion: string
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("legal_acceptances").insert({
      user_id: user.id,
      document_type: documentType,
      document_version: documentVersion,
      ip_address: null,
      user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent : null,
    });

    await logActivity(supabase, {
      action: "legal.accepted",
      entity_type: "legal_document",
      metadata: { document_type: documentType, version: documentVersion },
    });
  } catch (e) {
    console.warn("[legal-acceptance] failed:", e);
  }
}

/**
 * Record marketing consent (grant or revoke).
 */
export async function recordMarketingConsent(
  supabase: SupabaseClient,
  consentType: string,
  granted: boolean,
  source: string = "settings"
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("marketing_consents").insert({
      user_id: user.id,
      consent_type: consentType,
      status: granted ? "granted" : "revoked",
      granted_at: granted ? new Date().toISOString() : null,
      revoked_at: granted ? null : new Date().toISOString(),
      source,
      ip_address: null,
      user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent : null,
    });

    await logActivity(supabase, {
      action: granted ? "marketing.opted_in" : "marketing.opted_out",
      metadata: { consent_type: consentType, source },
    });
  } catch (e) {
    console.warn("[marketing-consent] failed:", e);
  }
}
