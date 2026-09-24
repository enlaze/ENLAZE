import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { sanitizeText } from "@/lib/sanitize";
import { rateLimitSensitive } from "@/lib/rate-limit";
import { normalizePhone, resolveWhatsAppSender, sendWhatsAppText } from "@/lib/whatsapp";
import { releaseUsage, reserveUsage } from "@/lib/subscription";

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

  const body = await request.json();
  const to = normalizePhone(body.to);
  const message = sanitizeText(body.message, 4096);
  if (to.length < 8 || to.length > 15 || !message) {
    return NextResponse.json(
      {
        error:
          "Revisa el teléfono del cliente (con prefijo internacional) y el mensaje.",
      },
      { status: 400 }
    );
  }

  // Muro de pago: reserva el cupo antes de nada (cada conversación se le paga
  // a Meta). Si luego no se envía, se devuelve.
  const blocked = await reserveUsage(user.id, "whatsapp", 1, { source: "api:whatsapp/send" });
  if (blocked) return blocked;

  const credentials = await resolveWhatsAppSender(supabase, user.id);
  if (!credentials.ok) {
    await releaseUsage(user.id, "whatsapp", 1, "release:whatsapp/send");
    return NextResponse.json(
      { error: credentials.error, ...(credentials.code ? { code: credentials.code } : {}) },
      { status: credentials.status }
    );
  }

  const sent = await sendWhatsAppText(credentials.sender, to, message);
  if (!sent.ok) {
    await releaseUsage(user.id, "whatsapp", 1, "release:whatsapp/send");
    return NextResponse.json({ error: sent.error, code: sent.code }, { status: 502 });
  }

  return NextResponse.json({ success: true, id: sent.id });
}
