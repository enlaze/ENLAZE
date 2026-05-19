import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { verifyAgentOrBrowserRequest, isErrorResponse } from "../../_lib/auth";
import { getAccessTokenInfo } from "@/lib/services/google-api";
import {
  emptyGmailIntel,
  fetchGmailIntel,
  GmailIntel,
  GmailStatus,
} from "@/lib/agent/intelligence/gmail";

async function syncModuleState(
  supabase: SupabaseClient,
  userId: string,
  moduleName: string,
  data: { connected: boolean; status: string; error_message?: string | null },
) {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("agent_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("module", moduleName)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("agent_connections")
      .update({
        connected: data.connected,
        status: data.status,
        last_sync_at: now,
        error_message: data.error_message ?? null,
        updated_at: now,
      })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("agent_connections")
      .insert({
        user_id: userId,
        module: moduleName,
        connected: data.connected,
        status: data.status,
        last_sync_at: now,
        error_message: data.error_message ?? null,
        config: {},
        created_at: now,
        updated_at: now,
      });
  }
}

/**
 * Map a token-info status to a GmailIntel status. Keeps the route from
 * inventing labels and keeps the intelligence module the single source of
 * truth for the status enum the workflow consumes.
 */
function tokenStatusToGmail(status: string): GmailStatus {
  switch (status) {
    case "decrypt_failed":
      return "decrypt_failed";
    case "no_refresh_token":
    case "refresh_failed":
      return "expired_token";
    case "not_connected":
    case "no_credentials":
      return "not_connected";
    default:
      return "api_error";
  }
}

function summaryLine(intel: GmailIntel): string {
  if (!intel.connected) return `Gmail no operativo (${intel.status}). ${intel.error_message ?? ""}`.trim();
  const parts: string[] = [];
  parts.push(`${intel.total_unread} sin leer`);
  if (intel.threads_awaiting_reply.length > 0) {
    parts.push(`${intel.threads_awaiting_reply.length} pendientes de respuesta`);
  }
  const urgent = intel.threads_awaiting_reply.filter((t) => t.priority_signal === "urgent").length;
  const high = intel.threads_awaiting_reply.filter((t) => t.priority_signal === "high").length;
  if (urgent) parts.push(`${urgent} urgente(s)`);
  if (high) parts.push(`${high} prioridad alta`);
  if (intel.invoices_detected.length > 0) parts.push(`${intel.invoices_detected.length} facturas`);
  if (intel.meeting_requests.length > 0) parts.push(`${intel.meeting_requests.length} solicitudes de reunión`);
  return parts.join(" · ");
}

/**
 * GET /api/agent/gmail/summary?user_id=xxx
 *
 * Returns the enriched Gmail intel payload consumed by the n8n agent and the
 * dev inspector. Heuristic-only (no LLM in this iteration). Degrades to a
 * 200 with a precise `status` when Gmail is unavailable; never 500s.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await verifyAgentOrBrowserRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    const { data: connection } = await supabase
      .from("agent_connections")
      .select("connected, status")
      .eq("user_id", userId)
      .eq("module", "gmail")
      .maybeSingle();

    if (!connection || !connection.connected) {
      const intel = emptyGmailIntel("not_connected", "Gmail not connected");
      return NextResponse.json({
        ok: true,
        ...intel,
        summary:
          "Gmail no conectado — conecta tu cuenta en Ajustes > Integraciones para recibir resumen de bandeja, detección de emails pendientes y sugerencias de respuesta.",
        last_sync_at: null,
      });
    }

    const tokenInfo = await getAccessTokenInfo(supabase, userId, "gmail");
    if (tokenInfo.status !== "active" || !tokenInfo.token) {
      const gmailStatus = tokenStatusToGmail(tokenInfo.status);
      await syncModuleState(supabase, userId, "gmail", {
        connected: false,
        status: tokenInfo.status,
        error_message: tokenInfo.error_message,
      });
      const intel = emptyGmailIntel(gmailStatus, tokenInfo.error_message);
      return NextResponse.json({
        ok: true,
        ...intel,
        summary: `Gmail no operativo (${tokenInfo.status}). ${tokenInfo.error_message ?? ""}`.trim(),
        last_sync_at: new Date().toISOString(),
      });
    }

    const intel = await fetchGmailIntel(tokenInfo.token, tokenInfo.email ?? null);

    await syncModuleState(supabase, userId, "gmail", {
      connected: intel.connected,
      status: intel.status === "ok" ? "active" : intel.status,
      error_message: intel.error_message,
    });

    return NextResponse.json({
      ok: true,
      ...intel,
      summary: summaryLine(intel),
      last_sync_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/gmail/summary] Unexpected error:", message);
    // Per brief: NEVER 500. Degrade with a status field.
    return NextResponse.json({
      ok: true,
      ...emptyGmailIntel("api_error", message),
      summary: `Gmail no operativo (error inesperado). ${message}`,
      last_sync_at: new Date().toISOString(),
    });
  }
}
