import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";

/**
 * GET /api/agent/calendar/summary?user_id=xxx
 *
 * Returns Google Calendar summary for a user.
 * If Calendar is not connected, returns connected:false with empty structures.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    // Check if Calendar module is connected
    const { data: connection } = await supabase
      .from("agent_connections")
      .select("connected, status, config, last_sync_at")
      .eq("user_id", userId)
      .eq("module", "google_calendar")
      .maybeSingle();

    if (!connection || !connection.connected) {
      return NextResponse.json({
        ok: true,
        connected: false,
        today_events: [],
        next_events: [],
        free_slots: [],
        reminders: [],
        summary: "Google Calendar no conectado — conecta tu cuenta para ver tu agenda.",
      });
    }

    // ── Calendar IS connected: fetch real data ──
    // TODO: Implement actual Google Calendar API integration when OAuth is set up.
    return NextResponse.json({
      ok: true,
      connected: true,
      today_events: [],
      next_events: [],
      free_slots: [],
      reminders: [],
      summary: "Google Calendar conectado — sin eventos nuevos por ahora.",
      last_sync_at: connection.last_sync_at,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/calendar/summary] Error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 },
    );
  }
}
