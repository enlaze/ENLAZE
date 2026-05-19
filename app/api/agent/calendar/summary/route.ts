import { NextRequest, NextResponse } from "next/server";
import { verifyAgentOrBrowserRequest, isErrorResponse } from "../../_lib/auth";
import { getAccessTokenInfo } from "@/lib/services/google-api";
import {
  CalendarIntel,
  CalendarStatus,
  emptyCalendarIntel,
  fetchCalendarIntel,
} from "@/lib/agent/intelligence/calendar";

function tokenStatusToCalendar(status: string): CalendarStatus {
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

function summaryLine(intel: CalendarIntel): string {
  if (!intel.connected) return `Google Calendar no operativo (${intel.status}). ${intel.error_message ?? ""}`.trim();
  const t = intel.today;
  const parts: string[] = [];
  parts.push(`Hoy ${t.total_events} eventos`);
  if (t.is_packed) parts.push("agenda apretada");
  if (t.free_blocks.length > 0) {
    const total = t.free_blocks.reduce((a, b) => a + b.duration_hours, 0);
    parts.push(`${total.toFixed(1)}h libres`);
  }
  if (intel.upcoming_important.length > 0) {
    parts.push(`${intel.upcoming_important.length} eventos importantes próximos`);
  }
  return parts.join(" · ");
}

/**
 * GET /api/agent/calendar/summary?user_id=xxx
 *
 * Enriched calendar intel: today/tomorrow with free blocks, this-week stats,
 * upcoming-important and recurring patterns. Pulls every visible secondary
 * calendar (selected & not hidden), not just `primary`. Heuristic-only.
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
      .eq("module", "google_calendar")
      .maybeSingle();

    if (!connection || !connection.connected) {
      const intel = emptyCalendarIntel("not_connected", "Google Calendar not connected");
      return NextResponse.json({
        ok: true,
        ...intel,
        summary:
          "Google Calendar no conectado — conecta tu cuenta para ver tu agenda diaria, huecos libres y recordatorios automáticos.",
        last_sync_at: null,
      });
    }

    const tokenInfo = await getAccessTokenInfo(supabase, userId, "google_calendar");
    if (tokenInfo.status !== "active" || !tokenInfo.token) {
      const intel = emptyCalendarIntel(tokenStatusToCalendar(tokenInfo.status), tokenInfo.error_message);
      return NextResponse.json({
        ok: true,
        ...intel,
        summary: `Google Calendar no operativo (${tokenInfo.status}). ${tokenInfo.error_message ?? ""}`.trim(),
        last_sync_at: new Date().toISOString(),
      });
    }

    const intel = await fetchCalendarIntel(tokenInfo.token);
    return NextResponse.json({
      ok: true,
      ...intel,
      summary: summaryLine(intel),
      last_sync_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/calendar/summary] Unexpected error:", message);
    return NextResponse.json({
      ok: true,
      ...emptyCalendarIntel("api_error", message),
      summary: `Google Calendar no operativo (error inesperado). ${message}`,
      last_sync_at: new Date().toISOString(),
    });
  }
}
