import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";

/**
 * GET /api/agent/calendar/summary?user_id=xxx
 *
 * Returns Google Calendar summary with automation-ready data:
 * - Today's events and upcoming events
 * - Free slots for the day (useful for marketing campaigns)
 * - Reminders and preparation items
 * - Daily agenda overview (total events, busy/free hours)
 * - Action items derived from calendar context
 *
 * Graceful degradation: if not connected → connected:false + empty structures.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = verifyAgentRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    const { data: connection } = await supabase
      .from("agent_connections")
      .select("connected, status, config, last_sync_at")
      .eq("user_id", userId)
      .eq("module", "google_calendar")
      .maybeSingle();

    const today = new Date().toISOString().split("T")[0];

    if (!connection || !connection.connected) {
      return NextResponse.json({
        ok: true,
        connected: false,
        today_events: [],
        next_events: [],
        free_slots: [],
        reminders: [],
        daily_agenda: {
          date: today,
          total_events: 0,
          busy_hours: 0,
          free_hours: 8,
          next_important: null,
        },
        action_items: [],
        summary:
          "Google Calendar no conectado — conecta tu cuenta para ver tu agenda diaria, huecos libres y recordatorios automáticos.",
      });
    }

    // ── Calendar IS connected ──
    // TODO: Replace with real Google Calendar API calls when OAuth is configured.
    // When implementing:
    //   - today_events: events for today with start/end times
    //   - next_events: next 7 days events
    //   - free_slots: gaps between events > 1h (for promos like "huecos libres")
    //   - reminders: events marked as reminders or with specific keywords
    //   - action_items: preparation tasks derived from upcoming events
    //     e.g. "Preparar pedido para evento de catering mañana"

    return NextResponse.json({
      ok: true,
      connected: true,
      today_events: [],
      next_events: [],
      free_slots: [],
      reminders: [],
      daily_agenda: {
        date: today,
        total_events: 0,
        busy_hours: 0,
        free_hours: 8,
        next_important: null,
      },
      action_items: [],
      summary: "Google Calendar conectado — sin eventos. La integración completa se activará con OAuth.",
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
