import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAccessTokenInfo } from "@/lib/services/google-api";
import { sanitizeText } from "@/lib/sanitize";

const CALENDAR_API =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TIME_ZONE = "Europe/Madrid";

interface GoogleCalendarEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function addMinutes(date: string, time: string, minutes: number) {
  const value = new Date(`${date}T${time}:00Z`);
  value.setUTCMinutes(value.getUTCMinutes() + minutes);
  return value.toISOString().slice(0, 19);
}

function zonedBoundary(date: string, endOfDay = false) {
  const [year, month, day] = date.split("-").map(Number);
  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  const offset = representedAsUtc - utcGuess;
  return new Date(utcGuess - offset).toISOString();
}

export async function GET(request: Request) {
  const { supabase, user } = await getSession();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const tokenInfo = await getAccessTokenInfo(
    supabase,
    user.id,
    "google_calendar"
  );
  if (!tokenInfo.token) {
    return NextResponse.json({
      connected: false,
      status: tokenInfo.status,
      events: [],
    });
  }

  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (
    !start ||
    !end ||
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end)
  ) {
    return NextResponse.json(
      { error: "Rango de fechas no válido" },
      { status: 400 }
    );
  }

  const googleUrl = new URL(CALENDAR_API);
  googleUrl.searchParams.set("timeMin", zonedBoundary(start));
  googleUrl.searchParams.set("timeMax", zonedBoundary(end, true));
  googleUrl.searchParams.set("singleEvents", "true");
  googleUrl.searchParams.set("orderBy", "startTime");
  googleUrl.searchParams.set("timeZone", TIME_ZONE);
  googleUrl.searchParams.set("maxResults", "250");

  const response = await fetch(googleUrl, {
    headers: { Authorization: `Bearer ${tokenInfo.token}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      {
        connected: false,
        status:
          response.status === 401 || response.status === 403
            ? "reconnect_required"
            : "google_error",
        events: [],
      },
      { status: response.status === 401 || response.status === 403 ? 409 : 502 }
    );
  }

  const events = ((payload?.items || []) as GoogleCalendarEvent[])
    .filter((event) => event.id && event.status !== "cancelled" && event.start)
    .map((event) => {
      const startValue = event.start?.dateTime || event.start?.date || "";
      const endValue = event.end?.dateTime || event.end?.date || startValue;
      const startDate = new Date(startValue);
      const endDate = new Date(endValue);
      const duration =
        Number.isFinite(startDate.getTime()) && Number.isFinite(endDate.getTime())
          ? Math.max(
              15,
              Math.round((endDate.getTime() - startDate.getTime()) / 60000)
            )
          : 30;

      return {
        id: event.id,
        title: event.summary || "Evento de Google Calendar",
        description: event.description || "",
        event_date: startValue.slice(0, 10),
        event_time: event.start?.dateTime ? startValue.slice(11, 16) : "00:00",
        duration_minutes: duration,
        html_link: event.htmlLink || "",
        all_day: Boolean(event.start?.date),
      };
    });

  return NextResponse.json({
    connected: true,
    email: tokenInfo.email || null,
    events,
  });
}

export async function POST(request: Request) {
  const { supabase, user } = await getSession();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const tokenInfo = await getAccessTokenInfo(
    supabase,
    user.id,
    "google_calendar"
  );
  if (!tokenInfo.token) {
    return NextResponse.json(
      {
        error:
          "Conecta Google Calendar en Ajustes → Integraciones para sincronizar esta cita.",
        code: "calendar_not_connected",
      },
      { status: 409 }
    );
  }

  const body = await request.json();
  const title = sanitizeText(body.title, 180);
  const description = sanitizeText(body.description, 2000);
  const eventDate =
    typeof body.event_date === "string" ? body.event_date : "";
  const eventTime =
    typeof body.event_time === "string" ? body.event_time : "10:00";
  const duration = Math.max(
    15,
    Math.min(1440, Number(body.duration_minutes) || 30)
  );
  if (
    !title ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
    !/^\d{2}:\d{2}$/.test(eventTime)
  ) {
    return NextResponse.json(
      { error: "Datos de la cita no válidos" },
      { status: 400 }
    );
  }

  const response = await fetch(CALENDAR_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenInfo.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: title,
      description,
      start: {
        dateTime: `${eventDate}T${eventTime}:00`,
        timeZone: TIME_ZONE,
      },
      end: {
        dateTime: addMinutes(eventDate, eventTime, duration),
        timeZone: TIME_ZONE,
      },
      extendedProperties: {
        private: { enlaze_user_id: user.id },
      },
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const reconnectRequired =
      response.status === 401 || response.status === 403;
    return NextResponse.json(
      {
        error: reconnectRequired
          ? "Google Calendar necesita renovar sus permisos. Reconéctalo en Integraciones."
          : "Google Calendar no pudo guardar la cita.",
        code: reconnectRequired
          ? "calendar_reconnect_required"
          : "calendar_create_failed",
      },
      { status: reconnectRequired ? 409 : 502 }
    );
  }

  return NextResponse.json({
    success: true,
    id: result?.id || null,
    html_link: result?.htmlLink || null,
  });
}

export async function DELETE(request: Request) {
  const { supabase, user } = await getSession();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const tokenInfo = await getAccessTokenInfo(
    supabase,
    user.id,
    "google_calendar"
  );
  if (!tokenInfo.token) {
    return NextResponse.json(
      { error: "Google Calendar no está conectado." },
      { status: 409 }
    );
  }

  const body = await request.json();
  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  if (!/^[A-Za-z0-9_-]{5,1024}$/.test(eventId)) {
    return NextResponse.json(
      { error: "Identificador de evento no válido" },
      { status: 400 }
    );
  }

  const response = await fetch(`${CALENDAR_API}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${tokenInfo.token}` },
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    return NextResponse.json(
      { error: "No se pudo eliminar la cita de Google Calendar." },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}
