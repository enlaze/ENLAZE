import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { sanitizeEmail, sanitizeText } from "@/lib/sanitize";
import { rateLimitSensitive } from "@/lib/rate-limit";
import { resolveGmailSender, sendGmailMessage } from "@/lib/gmail-send";

export async function POST(request: Request) {
  try {
    const rl = rateLimitSensitive(request);
    if (!rl.allowed) {
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

    const body = await request.json();
    const to = sanitizeEmail(body.to);
    const subject = sanitizeText(body.subject, 200);
    const message = sanitizeText(body.message, 5000);

    if (!to) {
      return NextResponse.json(
        { error: "El email del destinatario no es válido." },
        { status: 400 }
      );
    }
    if (!subject || !message) {
      return NextResponse.json(
        { error: "Completa el asunto y el mensaje." },
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

    const sent = await sendGmailMessage(resolved.sender, to, subject, message);
    if (!sent.ok) {
      return NextResponse.json(
        { error: sent.error, code: sent.code },
        { status: sent.reconnect ? 409 : 502 }
      );
    }

    return NextResponse.json({
      success: true,
      id: sent.id,
      provider: "gmail",
      from: resolved.sender.email,
    });
  } catch (error: unknown) {
    console.error("[send-email] Unexpected error", error);
    return NextResponse.json(
      { error: "No se pudo enviar el email. Inténtalo de nuevo." },
      { status: 500 }
    );
  }
}
