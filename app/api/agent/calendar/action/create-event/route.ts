import { NextRequest, NextResponse } from "next/server";
import { verifyAgentOrBrowserRequest, isErrorResponse } from "../../../_lib/auth";
import { getValidAccessToken } from "@/lib/services/google-api";

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAgentOrBrowserRequest(req);
    if (isErrorResponse(auth)) return auth;
    const { supabase, userId } = auth;

    const body = await req.json();
    const { summary, description, start_time, end_time, attendees } = body;

    if (!summary || !start_time || !end_time) {
      return NextResponse.json({ error: "Missing required fields: summary, start_time, end_time" }, { status: 400 });
    }

    const accessToken = await getValidAccessToken(supabase, userId, "google_calendar");
    if (!accessToken) {
      return NextResponse.json({ error: "Calendar token missing or expired" }, { status: 401 });
    }

    const eventPayload: any = {
      summary,
      description: description || "",
      start: { dateTime: start_time },
      end: { dateTime: end_time }
    };

    if (attendees && Array.isArray(attendees)) {
      eventPayload.attendees = attendees.map((email: string) => ({ email }));
    }

    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(eventPayload)
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Calendar API Error: ${res.status} ${res.statusText} - ${errorText}`);
    }

    const data = await res.json();

    return NextResponse.json({
      ok: true,
      event_id: data.id,
      event_url: data.htmlLink,
      message: "Evento agendado correctamente"
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Agent/calendar/action/create-event] Error:", message);
    return NextResponse.json({ error: "Internal server error", detail: message }, { status: 500 });
  }
}
