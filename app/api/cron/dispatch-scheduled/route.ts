/**
 * Dispatcher de envíos programados: el que hace que un envío salga a su hora
 * aunque el usuario tenga el navegador cerrado.
 *
 * Recorre las filas de `scheduled_messages` con status='active' y
 * `next_run_at` vencido, resuelve destinatarios y variables, envía por el
 * canal que toque reutilizando la misma fontanería que el envío inmediato
 * (lib/whatsapp.ts y lib/gmail-send.ts), lo registra en `messages` y avanza la
 * recurrencia. Las horas se interpretan en Europe/Madrid (lib/scheduled-messages.ts).
 *
 * ── Cómo se activa el reloj (pendiente, al desplegar) ───────────────────────
 *
 * Esta ruta NO se llama sola: necesita un cron externo que la despierte cada
 * pocos minutos. Cada cinco es un buen punto de partida — el retraso máximo de
 * un envío es el intervalo del cron. Dos opciones, cualquiera vale:
 *
 *   A) Vercel Cron — añadir a vercel.json y definir CRON_SECRET en el proyecto:
 *
 *        { "crons": [ { "path": "/api/cron/dispatch-scheduled", "schedule": "*\/5 * * * *" } ] }
 *
 *      Vercel manda su propia cabecera `Authorization: Bearer $CRON_SECRET`,
 *      que es justo la que se valida aquí abajo. Ojo: en el plan Hobby los
 *      crons son diarios; para "cada 5 minutos" hace falta plan Pro.
 *
 *   B) Supabase pg_cron + pg_net — desde el SQL Editor del proyecto:
 *
 *        select cron.schedule(
 *          'dispatch-scheduled-messages',
 *          '*\/5 * * * *',
 *          $$ select net.http_post(
 *               url     := 'https://enlaze.es/api/cron/dispatch-scheduled',
 *               headers := jsonb_build_object(
 *                 'Content-Type',  'application/json',
 *                 'Authorization', 'Bearer ' || current_setting('app.cron_secret')
 *               )
 *             ) $$
 *        );
 *
 * Mientras tanto se prueba a mano, que es lo que hace falta para validarla:
 *
 *   curl -s -X POST http://localhost:3000/api/cron/dispatch-scheduled \
 *        -H "Authorization: Bearer $CRON_SECRET" | jq
 *
 * ── Por qué no se dispara dos veces ─────────────────────────────────────────
 *
 * Antes de enviar, la fila se reserva con un compare-and-swap: se pasa a
 * status='sending' solo si seguía en 'active'. Dos ticks solapados del cron
 * compiten por esa actualización y solo uno se la lleva; el otro se la salta.
 * Si el proceso muere a media tanda la fila se queda en 'sending', y el
 * "reaper" del principio de cada tick la devuelve a 'active' pasados
 * STUCK_MINUTES para que se reintente en el siguiente.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase-service-role";
import { sanitizeEmail, sanitizeText } from "@/lib/sanitize";
import { personalize } from "@/lib/messaging-vars";
import { resolveRecipients, type ScheduledRecipient } from "@/lib/scheduled-recipients";
import {
  computeNextRun,
  type Audience,
  type MessageChannel,
  type ScheduleSpec,
  type ScheduleStatus,
} from "@/lib/scheduled-messages";
import {
  normalizePhone,
  resolveWhatsAppSender,
  sendWhatsAppText,
  type WhatsAppSender,
} from "@/lib/whatsapp";
import { resolveGmailSender, sendGmailMessage, type GmailSender } from "@/lib/gmail-send";

/* Enviar a mucha gente por HTTP tarda; el tope de Vercel para funciones. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Envíos que se procesan por tick. Lo que no entre, entra en el siguiente. */
const BATCH_SIZE = 20;

/** Mismo tope por envío que /api/whatsapp/send-bulk y /api/email/send-bulk. */
const MAX_RECIPIENTS = 200;

/** Una fila 'sending' más vieja que esto es un proceso que murió a medias. */
const STUCK_MINUTES = 15;

type ScheduledRow = ScheduleSpec & {
  id: string;
  user_id: string;
  channel: MessageChannel;
  title: string | null;
  audience: Audience;
  subject: string | null;
  body: string;
  next_run_at: string | null;
  status: ScheduleStatus;
};

type Outcome = {
  id: string;
  channel: MessageChannel;
  title: string | null;
  recipients: number;
  sent: number;
  failed: number;
  status: ScheduleStatus;
  next_run_at: string | null;
  error?: string;
};

/* ── Autorización ────────────────────────────────────────────────────────── */

/** Comparación en tiempo constante: la longitud no debe filtrar el secreto. */
function secretMatches(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isAuthorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return { ok: false as const, status: 503, error: "CRON_SECRET no está configurado en el servidor." };

  const header = request.headers.get("authorization") || "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const custom = (request.headers.get("x-cron-secret") || "").trim();
  const provided = bearer || custom;

  if (!provided || !secretMatches(provided, expected)) {
    return { ok: false as const, status: 401, error: "No autorizado" };
  }
  return { ok: true as const };
}

/* ── Envío de un programado ──────────────────────────────────────────────── */

type SenderCache = {
  whatsapp: Map<string, Awaited<ReturnType<typeof resolveWhatsAppSender>>>;
  email: Map<string, Awaited<ReturnType<typeof resolveGmailSender>>>;
};

type SendReport = {
  sent: number;
  failed: number;
  /** Error que exige intervención del usuario (canal desconectado, token caducado). */
  hardError?: string;
  /** Aviso que no impide seguir con la recurrencia (algún mensaje no salió). */
  softError?: string;
};

async function sendRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  row: ScheduledRow,
  recipients: ScheduledRecipient[],
  senders: SenderCache
): Promise<SendReport> {
  const cacheKey = row.user_id;
  const now = new Date().toISOString();

  /* Filas para `messages`, el mismo formato que escriben las pantallas cuando
     el envío es inmediato, para que el historial salga mezclado y coherente. */
  const logs: Record<string, unknown>[] = [];
  let sent = 0;
  let failed = 0;
  let lastError = "";

  if (row.channel === "whatsapp") {
    let credentials = senders.whatsapp.get(cacheKey);
    if (!credentials) {
      credentials = await resolveWhatsAppSender(supabase, row.user_id);
      senders.whatsapp.set(cacheKey, credentials);
    }
    if (!credentials.ok) return { sent: 0, failed: 0, hardError: credentials.error };

    const sender: WhatsAppSender = credentials.sender;
    for (const r of recipients) {
      const message = sanitizeText(personalize(row.body, r), 4096);
      const to = normalizePhone(r.address);
      if (to.length < 8 || to.length > 15 || !message) {
        failed++;
        lastError = "Teléfono (con prefijo internacional) o mensaje no válidos.";
        logs.push({ user_id: row.user_id, client_id: r.id, channel: "whatsapp", content: message || row.body, status: "failed", sent_at: null });
        continue;
      }
      const result = await sendWhatsAppText(sender, to, message);
      if (result.ok) sent++;
      else {
        failed++;
        lastError = result.error;
      }
      logs.push({
        user_id: row.user_id,
        client_id: r.id,
        channel: "whatsapp",
        content: message,
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? now : null,
      });
    }
  } else {
    let resolved = senders.email.get(cacheKey);
    if (!resolved) {
      resolved = await resolveGmailSender(supabase, row.user_id);
      senders.email.set(cacheKey, resolved);
    }
    if (!resolved.ok) return { sent: 0, failed: 0, hardError: resolved.error };

    const sender: GmailSender = resolved.sender;
    for (const r of recipients) {
      const subject = sanitizeText(personalize(row.subject || "", r), 200);
      const message = sanitizeText(personalize(row.body, r), 5000);
      const to = sanitizeEmail(r.address);
      const content = subject + " | " + message;

      if (!to || !subject || !message) {
        failed++;
        lastError = !to ? "El email del destinatario no es válido." : "El envío no tiene asunto o cuerpo.";
        logs.push({ user_id: row.user_id, client_id: r.id, channel: "email", content, status: "failed", sent_at: null });
        continue;
      }
      const result = await sendGmailMessage(sender, to, subject, message);
      if (result.ok) sent++;
      else {
        failed++;
        lastError = result.error;
        /* Si Gmail pide reconectar, no tiene sentido intentar el resto de la
           tanda ni cachear un token que ya no vale. */
        if (result.reconnect) {
          senders.email.set(cacheKey, { ok: false, error: result.error, code: result.code, status: 409 });
          logs.push({ user_id: row.user_id, client_id: r.id, channel: "email", content, status: "failed", sent_at: null });
          if (logs.length) await supabase.from("messages").insert(logs);
          return { sent, failed, hardError: result.error };
        }
      }
      logs.push({
        user_id: row.user_id,
        client_id: r.id,
        channel: "email",
        content,
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? now : null,
      });
    }
  }

  if (logs.length) {
    const { error } = await supabase.from("messages").insert(logs);
    /* Que falle el registro no invalida lo ya enviado: se avisa y se sigue. */
    if (error) console.error("[dispatch-scheduled] no se pudo registrar en messages", error.message);
  }

  return { sent, failed, softError: failed > 0 ? lastError : undefined };
}

/* ── Tick ────────────────────────────────────────────────────────────────── */

async function dispatch(request: Request) {
  const auth = isAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    console.error("[dispatch-scheduled] falta SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json(
      { error: "El servidor no tiene configurado el acceso a la base de datos." },
      { status: 503 }
    );
  }

  const startedAt = new Date();

  /* Reaper: filas que se quedaron reservadas por un proceso que no terminó.
     Vuelven a 'active' con su next_run_at intacto, así que el propio bucle de
     abajo las recoge en este mismo tick. */
  const stuckBefore = new Date(startedAt.getTime() - STUCK_MINUTES * 60_000).toISOString();
  const { data: recovered } = await supabase
    .from("scheduled_messages")
    .update({ status: "active", updated_at: startedAt.toISOString() })
    .eq("status", "sending")
    .lt("last_run_at", stuckBefore)
    .select("id");

  const { data: due, error: dueError } = await supabase
    .from("scheduled_messages")
    .select(
      "id, user_id, channel, title, audience, subject, body, schedule_type, send_time, days_of_week, day_of_month, start_date, next_run_at, status"
    )
    .eq("status", "active")
    .not("next_run_at", "is", null)
    .lte("next_run_at", startedAt.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (dueError) {
    console.error("[dispatch-scheduled] no se pudieron leer los envíos vencidos", dueError.message);
    return NextResponse.json({ error: "No se pudo consultar la cola de envíos." }, { status: 500 });
  }

  const rows = (due || []) as ScheduledRow[];
  const senders: SenderCache = { whatsapp: new Map(), email: new Map() };
  const outcomes: Outcome[] = [];

  for (const row of rows) {
    /* Reserva. `.eq("status", "active")` es el compare-and-swap: si otro tick
       se adelantó, esto no devuelve ninguna fila y aquí se pasa de largo. */
    const { data: claimed } = await supabase
      .from("scheduled_messages")
      .update({ status: "sending", last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    let report: SendReport = { sent: 0, failed: 0 };
    let recipientCount = 0;

    try {
      const audience = await resolveRecipients(supabase, row.user_id, row.channel, row.audience);
      const recipients = audience.recipients.slice(0, MAX_RECIPIENTS);
      recipientCount = recipients.length;

      if (recipients.length === 0) {
        /* Sin destinatarios no es un fallo: un filtro dinámico puede no
           encontrar a nadie esta semana y sí la que viene. */
        report = {
          sent: 0,
          failed: 0,
          softError:
            audience.skippedNoAddress > 0
              ? `Nadie recibió el envío: ${audience.skippedNoAddress} ${audience.skippedNoAddress === 1 ? "cliente no tiene" : "clientes no tienen"} ${row.channel === "whatsapp" ? "teléfono" : "email"}.`
              : "Ningún cliente encajaba con los destinatarios de este envío.",
        };
      } else {
        report = await sendRow(supabase, row, recipients, senders);
      }
    } catch (error: unknown) {
      console.error("[dispatch-scheduled] fallo inesperado en", row.id, error);
      report = {
        sent: 0,
        failed: 0,
        hardError: "Error inesperado al procesar el envío. Revísalo y vuelve a programarlo.",
      };
    }

    /* Cierre de la fila. Ninguna rama deja `next_run_at` en el pasado, así que
       un envío que falla nunca se queda reintentándose en bucle. */
    const finishedAt = new Date();
    let status: ScheduleStatus;
    let nextRunAt: string | null = null;

    if (report.hardError) {
      status = "failed";
    } else if (row.schedule_type === "once") {
      status = "done";
    } else {
      const next = computeNextRun(row, finishedAt);
      status = next ? "active" : "done";
      nextRunAt = next ? next.toISOString() : null;
    }

    await supabase
      .from("scheduled_messages")
      .update({
        status,
        next_run_at: nextRunAt,
        last_run_at: finishedAt.toISOString(),
        last_error: report.hardError || report.softError || null,
        updated_at: finishedAt.toISOString(),
      })
      .eq("id", row.id);

    outcomes.push({
      id: row.id,
      channel: row.channel,
      title: row.title,
      recipients: recipientCount,
      sent: report.sent,
      failed: report.failed,
      status,
      next_run_at: nextRunAt,
      ...(report.hardError || report.softError ? { error: report.hardError || report.softError } : {}),
    });
  }

  return NextResponse.json({
    ok: true,
    at: startedAt.toISOString(),
    recovered: recovered?.length || 0,
    due: rows.length,
    dispatched: outcomes,
    sent: outcomes.reduce((total, o) => total + o.sent, 0),
    failed: outcomes.reduce((total, o) => total + o.failed, 0),
  });
}

/** GET para Vercel Cron; POST para pg_net y para probarlo a mano con curl. */
export async function GET(request: Request) {
  return dispatch(request);
}

export async function POST(request: Request) {
  return dispatch(request);
}
