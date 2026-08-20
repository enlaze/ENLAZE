/**
 * CRUD de los envíos programados (pestaña "Programados" de WhatsApp y Emails).
 *
 *   GET  → los envíos del usuario, opcionalmente de un solo canal.
 *   POST → crea uno y calcula su primer `next_run_at`.
 *
 * Pausar, reanudar y cancelar están en [id]/route.ts.
 *
 * Quien los dispara después es app/api/cron/dispatch-scheduled/route.ts; aquí
 * solo se persiste la intención. El envío "Ahora" no pasa por esta ruta: sigue
 * yendo directo a /api/whatsapp/send-bulk o /api/email/send-bulk.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { sanitizeText } from "@/lib/sanitize";
import { rateLimitStandard } from "@/lib/rate-limit";
import {
  computeNextRun,
  validateAudience,
  validateSchedule,
  type MessageChannel,
} from "@/lib/scheduled-messages";

/** Las columnas que la UI necesita; `user_id` no hace falta enviarlo de vuelta. */
const COLUMNS =
  "id, channel, title, audience, subject, body, schedule_type, send_time, days_of_week, day_of_month, start_date, next_run_at, last_run_at, last_error, status, created_at, updated_at";

/** Tope del listado: la cola de un usuario no crece de forma razonable más allá. */
const LIST_LIMIT = 100;

const CHANNELS: MessageChannel[] = ["whatsapp", "email"];

/** El cuerpo de WhatsApp y el de Gmail tienen topes distintos en sus rutas de envío. */
const BODY_LIMIT: Record<MessageChannel, number> = { whatsapp: 4096, email: 5000 };

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const channel = new URL(request.url).searchParams.get("channel");

  let query = supabase
    .from("scheduled_messages")
    .select(COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (channel && CHANNELS.includes(channel as MessageChannel)) {
    query = query.eq("channel", channel);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[scheduled-messages] list failed", error.message);
    return NextResponse.json(
      { error: "No se pudieron cargar los envíos programados." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, scheduled: data || [] });
}

export async function POST(request: Request) {
  const rateLimit = rateLimitStandard(request);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Demasiadas peticiones. Inténtalo de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Petición no válida." }, { status: 400 });
  }
  const raw = payload as Record<string, unknown>;

  const channel = raw.channel;
  if (typeof channel !== "string" || !CHANNELS.includes(channel as MessageChannel)) {
    return NextResponse.json({ error: "Canal no válido." }, { status: 400 });
  }
  const messageChannel = channel as MessageChannel;

  const body = sanitizeText(typeof raw.body === "string" ? raw.body : "", BODY_LIMIT[messageChannel]);
  if (!body) {
    return NextResponse.json({ error: "El mensaje no puede estar vacío." }, { status: 400 });
  }

  /* El asunto solo existe en email; en WhatsApp se guarda a null aunque la UI
     lo mande, para que la fila no mienta sobre lo que se va a enviar. */
  let subject: string | null = null;
  if (messageChannel === "email") {
    subject = sanitizeText(typeof raw.subject === "string" ? raw.subject : "", 200);
    if (!subject) {
      return NextResponse.json({ error: "El asunto no puede estar vacío." }, { status: 400 });
    }
  }

  const audience = validateAudience(raw.audience);
  if (!audience.ok) {
    return NextResponse.json({ error: audience.error }, { status: 400 });
  }

  const schedule = validateSchedule(raw as Record<string, unknown>);
  if (!schedule.ok) {
    return NextResponse.json({ error: schedule.error }, { status: 400 });
  }

  /* Una selección manual con ids que no son del usuario no llegaría a enviar
     nada (el resolver filtra por user_id); mejor decirlo aquí que dejar un
     programado fantasma en la cola. */
  if (audience.audience.mode === "manual") {
    const { data: owned } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .in("id", audience.audience.client_ids);
    if (!owned || owned.length === 0) {
      return NextResponse.json(
        { error: "Ninguno de los clientes seleccionados existe ya." },
        { status: 400 }
      );
    }
    audience.audience = { mode: "manual", client_ids: owned.map((c) => c.id as string) };
  }

  const nextRun = computeNextRun(schedule.spec, new Date());
  if (!nextRun) {
    return NextResponse.json(
      {
        error:
          schedule.spec.schedule_type === "once"
            ? "Esa fecha y hora ya han pasado. Elige un momento futuro."
            : "Con esos datos el envío no llegaría a dispararse nunca.",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("scheduled_messages")
    .insert({
      user_id: user.id,
      channel: messageChannel,
      title: sanitizeText(typeof raw.title === "string" ? raw.title : "", 120) || null,
      audience: audience.audience,
      subject,
      body,
      schedule_type: schedule.spec.schedule_type,
      send_time: schedule.spec.send_time,
      days_of_week: schedule.spec.days_of_week,
      day_of_month: schedule.spec.day_of_month,
      start_date: schedule.spec.start_date,
      next_run_at: nextRun.toISOString(),
      status: "active",
    })
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("[scheduled-messages] insert failed", error.message);
    return NextResponse.json(
      { error: "No se pudo guardar el envío programado." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, scheduled: data }, { status: 201 });
}
