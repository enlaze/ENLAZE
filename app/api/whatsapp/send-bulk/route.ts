/**
 * Envío masivo de WhatsApp: un solo request para todos los destinatarios.
 *
 * La pantalla de WhatsApp escribe a listas enteras de clientes. Hacerlo con
 * /api/whatsapp/send (una llamada por cliente) chocaba con su límite de 10
 * peticiones/minuto a partir del undécimo destinatario, así que aquí se
 * resuelven las credenciales UNA vez y el fan-out ocurre en el servidor.
 *
 * Devuelve el resultado por destinatario para que el cliente sepa cuáles
 * guardar como `sent` y cuáles como `failed` en la tabla `messages`.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { sanitizeText } from "@/lib/sanitize";
import { rateLimitSensitive } from "@/lib/rate-limit";
import { normalizePhone, resolveWhatsAppSender, sendWhatsAppText } from "@/lib/whatsapp";

/** Tope por request; evita que un fallo de UI dispare un envío ilimitado. */
const MAX_RECIPIENTS = 200;

interface Recipient {
  client_id?: unknown;
  to?: unknown;
  message?: unknown;
}

export async function POST(request: Request) {
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

  const credentials = await resolveWhatsAppSender(supabase, user.id);
  if (!credentials.ok) {
    return NextResponse.json(
      { error: credentials.error, ...(credentials.code ? { code: credentials.code } : {}) },
      { status: credentials.status }
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
    const to = normalizePhone(recipient.to);
    const message = sanitizeText(
      typeof recipient.message === "string" ? recipient.message : "",
      4096
    );

    if (to.length < 8 || to.length > 15 || !message) {
      results.push({
        client_id: clientId,
        sent: false,
        code: "invalid_recipient",
        error: "Teléfono (con prefijo internacional) o mensaje no válidos.",
      });
      continue;
    }

    const sent = await sendWhatsAppText(credentials.sender, to, message);
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
    results,
  });
}
