/**
 * Envío masivo de emails por Gmail: un solo request para todos los
 * destinatarios.
 *
 * Espejo de /api/whatsapp/send-bulk. Hacerlo con /api/send-email (una llamada
 * por cliente) chocaba con su límite de 10 peticiones/minuto a partir del
 * undécimo destinatario, así que aquí se resuelven token y firma UNA vez y el
 * fan-out ocurre en el servidor.
 *
 * Devuelve el resultado por destinatario para que el cliente sepa cuáles
 * guardar como `sent` y cuáles como `failed` en la tabla `messages`.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { sanitizeEmail, sanitizeText } from "@/lib/sanitize";
import { rateLimitSensitive } from "@/lib/rate-limit";
import { resolveGmailSender, sendGmailMessage } from "@/lib/gmail-send";

/** Tope por request; evita que un fallo de UI dispare un envío ilimitado. */
const MAX_RECIPIENTS = 200;

interface Recipient {
  client_id?: unknown;
  to?: unknown;
  subject?: unknown;
  message?: unknown;
}

export async function POST(request: Request) {
  try {
    const rateLimit = rateLimitSensitive(request);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Demasiados envíos. Inténtalo de nuevo en unos minutos." },
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

    const body = await request.json().catch(() => null);
    const raw: Recipient[] = Array.isArray(body?.recipients) ? body.recipients : [];
    if (raw.length === 0) {
      return NextResponse.json(
        { error: "No hay destinatarios en el envío." },
        { status: 400 }
      );
    }
    if (raw.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_RECIPIENTS} destinatarios por envío.` },
        { status: 400 }
      );
    }

    const resolved = await resolveGmailSender(supabase, user.id);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error, code: resolved.code },
        { status: resolved.status }
      );
    }

    const results: {
      client_id: string | null;
      sent: boolean;
      id?: string | null;
      error?: string;
      code?: string;
    }[] = [];

    for (const recipient of raw) {
      const clientId = typeof recipient.client_id === "string" ? recipient.client_id : null;
      const to = sanitizeEmail(typeof recipient.to === "string" ? recipient.to : "");
      const subject = sanitizeText(
        typeof recipient.subject === "string" ? recipient.subject : "",
        200
      );
      const message = sanitizeText(
        typeof recipient.message === "string" ? recipient.message : "",
        5000
      );

      if (!to || !subject || !message) {
        results.push({
          client_id: clientId,
          sent: false,
          code: "invalid_recipient",
          error: !to
            ? "El email del destinatario no es válido."
            : "Completa el asunto y el mensaje.",
        });
        continue;
      }

      const sent = await sendGmailMessage(resolved.sender, to, subject, message);
      results.push(
        sent.ok
          ? { client_id: clientId, sent: true, id: sent.id }
          : { client_id: clientId, sent: false, error: sent.error, code: sent.code }
      );
    }

    const delivered = results.filter((r) => r.sent).length;
    return NextResponse.json({
      success: delivered > 0,
      sent: delivered,
      failed: results.length - delivered,
      from: resolved.sender.email,
      results,
    });
  } catch (error: unknown) {
    console.error("[email/send-bulk] Unexpected error", error);
    return NextResponse.json(
      { error: "No se pudo completar el envío. Inténtalo de nuevo." },
      { status: 500 }
    );
  }
}
