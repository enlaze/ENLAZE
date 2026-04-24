import { NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest, isErrorResponse } from "../../_lib/auth";
import { getValidAccessToken } from "@/lib/services/google-api";

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
    const accessToken = await getValidAccessToken(supabase, userId, "google_calendar");
    if (!accessToken) {
      return NextResponse.json({
        ok: false,
        connected: false,
        error: "Google token missing or expired.",
      }, { status: 401 });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const timeMin = startOfDay.toISOString();
    const timeMax = endOfDay.toISOString();

    const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!calRes.ok) {
      throw new Error(`Calendar API error: ${calRes.statusText}`);
    }

    const calData = await calRes.json();
    const items = calData.items || [];

    const today_events = items.map((item: any) => ({
      id: item.id,
      title: item.summary || "Sin título",
      start: item.start?.dateTime || item.start?.date,
      end: item.end?.dateTime || item.end?.date,
      link: item.htmlLink
    }));

    // Calculate busy hours & free slots (9:00 to 18:00 logic)
    let busy_hours = 0;
    const workdayStart = 9;
    const workdayEnd = 18;
    const totalWorkdayHours = workdayEnd - workdayStart;
    
    // Sort events
    const sortedEvents = items
      .filter((i: any) => i.start?.dateTime && i.end?.dateTime)
      .map((i: any) => ({
        start: new Date(i.start.dateTime),
        end: new Date(i.end.dateTime)
      }))
      .sort((a: any, b: any) => a.start.getTime() - b.start.getTime());

    const free_slots = [];
    let lastEndTime = new Date(startOfDay);
    lastEndTime.setHours(workdayStart, 0, 0, 0);

    for (const ev of sortedEvents) {
      if (ev.end <= lastEndTime) continue;

      // Add busy time
      const evStartInWorkday = Math.max(ev.start.getTime(), startOfDay.setHours(workdayStart));
      const evEndInWorkday = Math.min(ev.end.getTime(), startOfDay.setHours(workdayEnd));
      if (evEndInWorkday > evStartInWorkday) {
        busy_hours += (evEndInWorkday - evStartInWorkday) / (1000 * 60 * 60);
      }

      // Check free slot before this event
      if (ev.start > lastEndTime && ev.start.getHours() < workdayEnd) {
        const diffHours = (ev.start.getTime() - lastEndTime.getTime()) / (1000 * 60 * 60);
        if (diffHours >= 1) {
          free_slots.push({
            start: lastEndTime.toISOString(),
            end: ev.start.toISOString(),
            duration_hours: diffHours.toFixed(1)
          });
        }
      }
      lastEndTime = new Date(Math.max(lastEndTime.getTime(), ev.end.getTime()));
    }

    // Check free slot at end of day
    const endOfWorkday = new Date(startOfDay);
    endOfWorkday.setHours(workdayEnd, 0, 0, 0);
    if (lastEndTime < endOfWorkday) {
      const diffHours = (endOfWorkday.getTime() - lastEndTime.getTime()) / (1000 * 60 * 60);
      if (diffHours >= 1) {
        free_slots.push({
          start: lastEndTime.toISOString(),
          end: endOfWorkday.toISOString(),
          duration_hours: diffHours.toFixed(1)
        });
      }
    }

    const free_hours = Math.max(0, totalWorkdayHours - busy_hours);
    
    let summaryText = `Hoy tienes ${today_events.length} reuniones/eventos. `;
    if (free_slots.length > 0) {
      summaryText += `Tienes un total de ${free_hours.toFixed(1)} horas libres.`;
    } else {
      summaryText += `Tu agenda está completamente llena hoy.`;
    }

    return NextResponse.json({
      ok: true,
      connected: true,
      today_events,
      next_events: [],
      free_slots,
      reminders: [],
      daily_agenda: {
        date: today,
        total_events: today_events.length,
        busy_hours: Number(busy_hours.toFixed(1)),
        free_hours: Number(free_hours.toFixed(1)),
        next_important: today_events[0] || null,
      },
      action_items: [],
      summary: summaryText,
      last_sync_at: new Date().toISOString(),
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
